import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { getQuality } from "../engine/Quality";

type DecalKind = "blood" | "scorch";

interface Decal {
  mesh: Mesh;
  mat: StandardMaterial;
  ttl: number;
  initialTtl: number;
  /** Total life in seconds. */
  life: number;
}

/**
 * Capped pool of ground decals — blood splats on kills + scorch rings after
 * Caster AoEs and Crash blasts. Cap enforced via FIFO eviction so we can drop
 * the oldest decal when we hit the limit. Fade over `life` seconds and dispose.
 *
 * On low quality the decalCap is 0, so `spawn()` becomes a no-op — no meshes
 * are ever created. Medium 16 / high 28.
 *
 * Textures are built once at construction and shared across all decals of that
 * kind — one DynamicTexture per decal kind.
 */
export class Decals {
  private bloodTex: Texture;
  private scorchTex: Texture;
  private active: Decal[] = [];

  constructor(private scene: Scene) {
    this.bloodTex = buildBloodTex(scene);
    this.scorchTex = buildScorchTex(scene);
  }

  /**
   * Spawn a decal at a world position. `size` in meters controls the decal's
   * footprint. Returns true if spawned, false if filtered by quality / cap.
   */
  spawn(kind: DecalKind, pos: Vector3, size = 1.2): boolean {
    const cap = getQuality().decalCap;
    if (cap <= 0) return false;

    // FIFO eviction — oldest (front of array) gets disposed when we'd overflow.
    while (this.active.length >= cap) {
      const oldest = this.active.shift();
      if (oldest) { oldest.mesh.dispose(); oldest.mat.dispose(); }
    }

    const tex = kind === "blood" ? this.bloodTex : this.scorchTex;
    const lifetime = kind === "blood" ? 18 : 14;
    const mesh = MeshBuilder.CreateGround(
      `decal_${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      { width: size, height: size, subdivisions: 1 },
      this.scene,
    );
    // Decals sit just above the floor to avoid Z-fighting with the arena ground.
    mesh.position.set(pos.x, 0.015 + Math.random() * 0.004, pos.z);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    mesh.isPickable = false;
    mesh.doNotSyncBoundingInfo = true;
    const mat = new StandardMaterial(`${mesh.name}_mat`, this.scene);
    mat.diffuseTexture = tex;
    mat.opacityTexture = tex; // use the texture's alpha for the cut-out shape
    // Use unlit + alpha blend so shadow/fog don't smear the decal's outline.
    mat.disableLighting = true;
    mat.specularColor = new Color3(0, 0, 0);
    if (kind === "blood") {
      mat.diffuseColor = new Color3(0.45, 0.05, 0.05);
    } else {
      mat.diffuseColor = new Color3(0.12, 0.10, 0.10);
      mat.emissiveColor = new Color3(0.35, 0.15, 0.05); // cooling-embers glow
    }
    mesh.material = mat;
    mesh.freezeWorldMatrix();

    this.active.push({ mesh, mat, ttl: lifetime, initialTtl: lifetime, life: lifetime });
    return true;
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const d = this.active[i];
      d.ttl -= dt;
      if (d.ttl <= 0) {
        d.mesh.dispose();
        d.mat.dispose();
        this.active.splice(i, 1);
        continue;
      }
      // Fade in the last 4s to avoid pop-out.
      if (d.ttl < 4) {
        d.mesh.visibility = d.ttl / 4;
      }
    }
  }

  /** Drop all active decals — for in-place run restart. */
  reset(): void {
    for (const d of this.active) { d.mesh.dispose(); d.mat.dispose(); }
    this.active.length = 0;
  }

  dispose(): void {
    this.reset();
    this.bloodTex.dispose();
    this.scorchTex.dispose();
  }
}

function buildBloodTex(scene: Scene): Texture {
  const size = 128;
  const dt = new DynamicTexture("decalBloodTex", { width: size, height: size }, scene, false);
  const ctx = dt.getContext();
  ctx.clearRect(0, 0, size, size);
  // Central irregular splat — one large darker blob + satellite drops.
  ctx.fillStyle = "rgba(200,25,20,0.95)";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.33, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = size * 0.35 * Math.random();
    const x = size / 2 + Math.cos(a) * r;
    const y = size / 2 + Math.sin(a) * r;
    ctx.beginPath();
    ctx.fillStyle = `rgba(140,${Math.round(Math.random() * 20)},${Math.round(Math.random() * 20)},${0.55 + Math.random() * 0.3})`;
    ctx.arc(x, y, 2 + Math.random() * 9, 0, Math.PI * 2);
    ctx.fill();
  }
  dt.hasAlpha = true;
  dt.update();
  return dt;
}

function buildScorchTex(scene: Scene): Texture {
  const size = 128;
  const dt = new DynamicTexture("decalScorchTex", { width: size, height: size }, scene, false);
  const ctx = dt.getContext();
  ctx.clearRect(0, 0, size, size);
  // Dark ring + inner char — radial gradient from dark center to transparent edge.
  const grad = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size * 0.48);
  grad.addColorStop(0, "rgba(20,10,5,0.9)");
  grad.addColorStop(0.6, "rgba(40,18,10,0.6)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  // Scatter ash flecks.
  for (let i = 0; i < 30; i++) {
    ctx.fillStyle = `rgba(120,${60 + Math.round(Math.random() * 20)},${20 + Math.round(Math.random() * 15)},${0.3 + Math.random() * 0.5})`;
    const a = Math.random() * Math.PI * 2;
    const r = size * 0.4 * Math.sqrt(Math.random());
    ctx.beginPath();
    ctx.arc(size / 2 + Math.cos(a) * r, size / 2 + Math.sin(a) * r, 1 + Math.random() * 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  dt.hasAlpha = true;
  dt.update();
  return dt;
}
