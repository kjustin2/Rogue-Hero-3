import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

/**
 * Pooled, fire-and-forget telegraph shapes used by enemies + bosses to warn the
 * player before an attack lands. Pools are pre-allocated; call `spawn*` and the
 * shape grows + pulses alpha for `duration` seconds, then auto-disables.
 *
 * Shapes:
 *  - line:   ground bar pointing along a direction (dash, sky-lance line)
 *  - ring:   expanding torus annulus (slam, eruption — "stay outside this")
 *  - disc:   filled circle (caster AoE, geyser — "this whole circle hits")
 *  - cone:   sector wedge (sweeping beam, breath cone)
 *
 * Per-frame `update(dt)` advances all active slots; missing the call means
 * telegraphs freeze where they spawned. `clearAll()` is wired by RunManager
 * via the room transition to nuke leftover telegraphs from the prior room.
 *
 * All slots use `disableLighting` materials and additive-feel emissive — they
 * read above the floor on every grading preset without a light dependency.
 */

interface BaseSlot {
  mesh: Mesh;
  mat: StandardMaterial;
  active: boolean;
  ttl: number;
  total: number;
  baseAlpha: number;
}

interface LineSlot extends BaseSlot {
  finalLength: number;
  finalWidth: number;
}
interface RingSlot extends BaseSlot {
  finalRadius: number;
}
interface DiscSlot extends BaseSlot {
  finalRadius: number;
}
interface ConeSlot extends BaseSlot {
  finalRange: number;
  halfAngle: number;
}

const DEFAULT_COLOR: [number, number, number] = [1.0, 0.35, 0.1];

export class Telegraph {
  private lines: LineSlot[] = [];
  private rings: RingSlot[] = [];
  private discs: DiscSlot[] = [];
  private cones: ConeSlot[] = [];

  constructor(private scene: Scene) {
    // Pool sizes sized for the worst-case boss tick. Colossus P4 can have up
    // to ~14 active rings (Tectonic Slam 3 + Mine 6 + Pound + Geyser + a
    // couple of player crash rings) and ~14 active discs (mines + lava trail
    // patches + boulder craters). Lines need headroom for Spire Convergence
    // (5 simultaneous) plus mirror-spire echoes plus Brawler fissures.
    for (let i = 0; i < 24; i++) this.lines.push(this.makeLineSlot(i));
    for (let i = 0; i < 24; i++) this.rings.push(this.makeRingSlot(i));
    for (let i = 0; i < 16; i++) this.discs.push(this.makeDiscSlot(i));
    for (let i = 0; i < 8; i++) this.cones.push(this.makeConeSlot(i));
  }

  private makeMat(name: string): StandardMaterial {
    const mat = new StandardMaterial(name, this.scene);
    mat.diffuseColor = new Color3(DEFAULT_COLOR[0], DEFAULT_COLOR[1], DEFAULT_COLOR[2]);
    mat.emissiveColor = new Color3(DEFAULT_COLOR[0] * 0.95, DEFAULT_COLOR[1] * 0.95, DEFAULT_COLOR[2] * 0.95);
    mat.specularColor = new Color3(0, 0, 0);
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mat.alpha = 0.7;
    return mat;
  }

  private makeLineSlot(i: number): LineSlot {
    // Unit-length box on +Z axis; width along X, thin Y, scaled per spawn.
    const mesh = MeshBuilder.CreateBox(`tg_line_${i}`, { width: 1, height: 0.05, depth: 1 }, this.scene);
    mesh.position.y = 0.06;
    mesh.isPickable = false;
    mesh.doNotSyncBoundingInfo = true;
    mesh.setEnabled(false);
    const mat = this.makeMat(`tg_line_mat_${i}`);
    mesh.material = mat;
    return { mesh, mat, active: false, ttl: 0, total: 0, baseAlpha: 0.7, finalLength: 1, finalWidth: 1 };
  }

  private makeRingSlot(i: number): RingSlot {
    // Torus diameter=1; scaling.x/z drives final radius. Thin band reads as
    // "outline of danger area" without filling the floor.
    const mesh = MeshBuilder.CreateTorus(`tg_ring_${i}`, { diameter: 1, thickness: 0.08, tessellation: 36 }, this.scene);
    mesh.position.y = 0.06;
    mesh.isPickable = false;
    mesh.doNotSyncBoundingInfo = true;
    mesh.setEnabled(false);
    const mat = this.makeMat(`tg_ring_mat_${i}`);
    mat.alpha = 0.85;
    mesh.material = mat;
    return { mesh, mat, active: false, ttl: 0, total: 0, baseAlpha: 0.85, finalRadius: 1 };
  }

  private makeDiscSlot(i: number): DiscSlot {
    // Disc as a thin cylinder lying flat; scaling.x/z controls radius.
    const mesh = MeshBuilder.CreateCylinder(
      `tg_disc_${i}`,
      { diameter: 1, height: 0.05, tessellation: 36 },
      this.scene,
    );
    mesh.position.y = 0.04;
    mesh.isPickable = false;
    mesh.doNotSyncBoundingInfo = true;
    mesh.setEnabled(false);
    const mat = this.makeMat(`tg_disc_mat_${i}`);
    mat.alpha = 0.5;
    mesh.material = mat;
    return { mesh, mat, active: false, ttl: 0, total: 0, baseAlpha: 0.5, finalRadius: 1 };
  }

  private makeConeSlot(i: number): ConeSlot {
    // Built procedurally: a triangle-fan slice from the origin, lying flat on
    // XZ. Range = 1 unit, full-angle = 60°. Per-spawn we scale.x/z by range
    // and rotate around Y.
    // Use a flat triangle approximation: a thin custom mesh would be ideal,
    // but a stretched cylinder slice is good enough — we render it as a solid
    // wedge by carving the cylinder height. Simpler approach: a disc but
    // alpha-masked via a half-cone-shaped triangle.
    //
    // Pragmatic compromise: build a 12-segment partial torus / arc using
    // MeshBuilder.CreateRibbon. To keep this dependency-light, we use a
    // CustomMesh built from a ribbon between two paths (origin + arc).
    const segments = 18;
    const halfAngle = Math.PI / 6; // 30° → 60° cone width
    const path1: Vector3[] = [];
    const path2: Vector3[] = [];
    for (let s = 0; s <= segments; s++) {
      const t = s / segments;
      const a = -halfAngle + t * 2 * halfAngle;
      // Cone fans along +Z (forward). Origin at 0, far edge at z = 1.
      path1.push(new Vector3(0, 0.05, 0));
      path2.push(new Vector3(Math.sin(a), 0.05, Math.cos(a)));
    }
    const mesh = MeshBuilder.CreateRibbon(
      `tg_cone_${i}`,
      { pathArray: [path1, path2], sideOrientation: Mesh.DOUBLESIDE },
      this.scene,
    );
    mesh.isPickable = false;
    mesh.doNotSyncBoundingInfo = true;
    mesh.setEnabled(false);
    const mat = this.makeMat(`tg_cone_mat_${i}`);
    mat.alpha = 0.45;
    mesh.material = mat;
    return { mesh, mat, active: false, ttl: 0, total: 0, baseAlpha: 0.45, finalRange: 1, halfAngle };
  }

  private acquire<T extends BaseSlot>(pool: T[]): T | null {
    for (const s of pool) if (!s.active) return s;
    return null;
  }

  private setColor(mat: StandardMaterial, color: [number, number, number]): void {
    mat.diffuseColor.set(color[0], color[1], color[2]);
    mat.emissiveColor.set(color[0] * 0.95, color[1] * 0.95, color[2] * 0.95);
  }

  /** Spawn a flat ground line of given length pointing along (dirX, dirZ). */
  spawnLine(
    pos: Vector3,
    dirX: number,
    dirZ: number,
    length: number,
    width: number,
    duration: number,
    color: [number, number, number] = DEFAULT_COLOR,
  ): boolean {
    const s = this.acquire(this.lines);
    if (!s) return false;
    s.active = true;
    s.ttl = duration;
    s.total = duration;
    s.finalLength = length;
    s.finalWidth = width;
    // Center the bar at pos + halfLen along dir so it starts at pos and extends forward.
    const halfLen = length / 2;
    s.mesh.position.x = pos.x + dirX * halfLen;
    s.mesh.position.z = pos.z + dirZ * halfLen;
    s.mesh.rotation.y = Math.atan2(dirX, dirZ);
    s.mesh.scaling.x = width;
    s.mesh.scaling.z = length;
    s.mesh.setEnabled(true);
    this.setColor(s.mat, color);
    return true;
  }

  /** Expanding ring — grows from 0 to `radius` over duration, alpha pulses high near the end. */
  spawnRing(
    pos: Vector3,
    radius: number,
    duration: number,
    color: [number, number, number] = DEFAULT_COLOR,
  ): boolean {
    const s = this.acquire(this.rings);
    if (!s) return false;
    s.active = true;
    s.ttl = duration;
    s.total = duration;
    s.finalRadius = radius;
    s.mesh.position.x = pos.x;
    s.mesh.position.z = pos.z;
    s.mesh.scaling.x = 0.05;
    s.mesh.scaling.z = 0.05;
    s.mesh.setEnabled(true);
    this.setColor(s.mat, color);
    return true;
  }

  /** Filled disc on the ground — grows from 0 to `radius`. */
  spawnDisc(
    pos: Vector3,
    radius: number,
    duration: number,
    color: [number, number, number] = DEFAULT_COLOR,
  ): boolean {
    const s = this.acquire(this.discs);
    if (!s) return false;
    s.active = true;
    s.ttl = duration;
    s.total = duration;
    s.finalRadius = radius;
    s.mesh.position.x = pos.x;
    s.mesh.position.z = pos.z;
    s.mesh.scaling.x = 0.05;
    s.mesh.scaling.z = 0.05;
    s.mesh.setEnabled(true);
    this.setColor(s.mat, color);
    return true;
  }

  /** Forward-facing wedge cone, range = `range`, fixed half-angle (set at pool build). */
  spawnCone(
    pos: Vector3,
    dirX: number,
    dirZ: number,
    range: number,
    duration: number,
    color: [number, number, number] = DEFAULT_COLOR,
  ): boolean {
    const s = this.acquire(this.cones);
    if (!s) return false;
    s.active = true;
    s.ttl = duration;
    s.total = duration;
    s.finalRange = range;
    s.mesh.position.x = pos.x;
    s.mesh.position.z = pos.z;
    s.mesh.rotation.y = Math.atan2(dirX, dirZ);
    s.mesh.scaling.x = range;
    s.mesh.scaling.z = range;
    s.mesh.setEnabled(true);
    this.setColor(s.mat, color);
    return true;
  }

  /** Half-angle a cone slot was built with — useful for hit-test logic in the caller. */
  static readonly CONE_HALF_ANGLE = Math.PI / 6;

  update(dt: number): void {
    // Lines: hold final scale, alpha grows toward end (peak just before strike).
    for (const s of this.lines) {
      if (!s.active) continue;
      s.ttl -= dt;
      if (s.ttl <= 0) {
        s.active = false;
        s.mesh.setEnabled(false);
        continue;
      }
      const t = 1 - s.ttl / s.total;
      s.mat.alpha = s.baseAlpha * (0.55 + 0.45 * t);
      // Width grows ~30% over the wind-up so the bar reads as "charging."
      s.mesh.scaling.x = s.finalWidth * (0.85 + 0.3 * t);
    }
    // Rings: scale grows linearly from 0 to final, alpha pulses up near end.
    for (const s of this.rings) {
      if (!s.active) continue;
      s.ttl -= dt;
      if (s.ttl <= 0) {
        s.active = false;
        s.mesh.setEnabled(false);
        continue;
      }
      const t = 1 - s.ttl / s.total;
      const r = Math.max(0.1, s.finalRadius * t);
      s.mesh.scaling.x = r;
      s.mesh.scaling.z = r;
      s.mat.alpha = s.baseAlpha * (0.6 + 0.4 * t);
    }
    // Discs: same growth profile as ring, lower base alpha.
    for (const s of this.discs) {
      if (!s.active) continue;
      s.ttl -= dt;
      if (s.ttl <= 0) {
        s.active = false;
        s.mesh.setEnabled(false);
        continue;
      }
      const t = 1 - s.ttl / s.total;
      const r = Math.max(0.1, s.finalRadius * t);
      s.mesh.scaling.x = r;
      s.mesh.scaling.z = r;
      s.mat.alpha = s.baseAlpha * (0.5 + 0.5 * t);
    }
    // Cones: hold final range; alpha pulses toward strike.
    for (const s of this.cones) {
      if (!s.active) continue;
      s.ttl -= dt;
      if (s.ttl <= 0) {
        s.active = false;
        s.mesh.setEnabled(false);
        continue;
      }
      const t = 1 - s.ttl / s.total;
      s.mat.alpha = s.baseAlpha * (0.55 + 0.45 * t);
    }
  }

  /** Hide every active telegraph immediately — called on room transition. */
  clearAll(): void {
    for (const s of this.lines) { s.active = false; s.mesh.setEnabled(false); }
    for (const s of this.rings) { s.active = false; s.mesh.setEnabled(false); }
    for (const s of this.discs) { s.active = false; s.mesh.setEnabled(false); }
    for (const s of this.cones) { s.active = false; s.mesh.setEnabled(false); }
  }

  dispose(): void {
    for (const s of this.lines) { s.mesh.dispose(); s.mat.dispose(); }
    for (const s of this.rings) { s.mesh.dispose(); s.mat.dispose(); }
    for (const s of this.discs) { s.mesh.dispose(); s.mat.dispose(); }
    for (const s of this.cones) { s.mesh.dispose(); s.mat.dispose(); }
    this.lines.length = 0;
    this.rings.length = 0;
    this.discs.length = 0;
    this.cones.length = 0;
  }
}
