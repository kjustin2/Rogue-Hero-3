import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { getQuality } from "../engine/Quality";

type DecalKind = "blood" | "scorch" | "crack" | "frost";

/** One slot in the pre-allocated decal pool. Reused — never disposed mid-run. */
interface DecalSlot {
  mesh: Mesh;
  mat: StandardMaterial;
  ttl: number;
  initialTtl: number;
  /** Total life in seconds. */
  life: number;
  active: boolean;
  /** Insertion order — used for FIFO eviction when all slots are busy. */
  spawnSeq: number;
}

/**
 * Pooled ground decals — blood splats on kills + scorch rings after Caster
 * AoEs + Crash scorch/crack + Cold-Crash frost.
 *
 * Pool sizing: HIGH_TIER_CAP slots pre-allocated up front so heavy combat
 * doesn't pay for `MeshBuilder.CreateGround` + `new StandardMaterial` per hit.
 * Slots are square 1m planes at construction; each `spawn()` re-skins one with
 * the right texture/colors and rescales it via `mesh.scaling`. When all slots
 * are active and a new spawn is requested, the slot with the lowest spawnSeq
 * (= earliest spawn) is recycled — same FIFO behavior as the old shift-based
 * design, but without disposal.
 *
 * On low quality `decalCap === 0` and `spawn()` is a no-op.
 *
 * Textures are built once at construction and shared across all decals of that
 * kind — one DynamicTexture per decal kind.
 */
export class Decals {
  private bloodTex: Texture;
  private scorchTex: Texture;
  private crackTex: Texture;
  private frostTex: Texture;
  /** Maximum decals we'll ever pre-allocate (matches HIGH tier `decalCap`). */
  private readonly POOL_SIZE = 28;
  private pool: DecalSlot[] = [];
  private nextSeq = 0;

  constructor(private scene: Scene) {
    this.bloodTex = buildBloodTex(scene);
    this.scorchTex = buildScorchTex(scene);
    this.crackTex = buildCrackTex(scene);
    this.frostTex = buildFrostTex(scene);
    for (let i = 0; i < this.POOL_SIZE; i++) this.pool.push(this.allocate(i));
  }

  private allocate(idx: number): DecalSlot {
    const mesh = MeshBuilder.CreateGround(
      `decal_${idx}`,
      { width: 1, height: 1, subdivisions: 1 },
      this.scene,
    );
    mesh.isPickable = false;
    mesh.doNotSyncBoundingInfo = true;
    mesh.setEnabled(false);
    const mat = new StandardMaterial(`decal_${idx}_mat`, this.scene);
    mat.disableLighting = true;
    mat.specularColor = new Color3(0, 0, 0);
    mesh.material = mat;
    return {
      mesh, mat,
      ttl: 0, initialTtl: 0, life: 0,
      active: false, spawnSeq: 0,
    };
  }

  private acquire(): DecalSlot | null {
    // Prefer a free slot.
    for (const s of this.pool) if (!s.active) return s;
    // All busy — evict the slot with the smallest spawnSeq (oldest spawn).
    let oldest = this.pool[0];
    for (const s of this.pool) if (s.spawnSeq < oldest.spawnSeq) oldest = s;
    return oldest;
  }

  /**
   * Spawn a decal at a world position. `size` in meters controls the decal's
   * footprint. Returns true if spawned, false if filtered by quality.
   */
  spawn(kind: DecalKind, pos: Vector3, size = 1.2): boolean {
    const cap = getQuality().decalCap;
    if (cap <= 0) return false;

    // Honor the dynamic cap — count active decals and skip if we're already at
    // the per-tier limit (medium 16, high 28). When a slot must be recycled,
    // we still cap by oldest-eviction semantics.
    let activeCount = 0;
    for (const s of this.pool) if (s.active) activeCount++;
    let slot: DecalSlot;
    if (activeCount >= cap) {
      // Force-evict oldest active to honor the cap.
      let oldest = this.pool[0];
      for (const s of this.pool) {
        if (s.active && s.spawnSeq < oldest.spawnSeq) oldest = s;
      }
      slot = oldest;
    } else {
      const s = this.acquire();
      if (!s) return false;
      slot = s;
    }

    const tex = kind === "blood" ? this.bloodTex
              : kind === "scorch" ? this.scorchTex
              : kind === "crack" ? this.crackTex
              : this.frostTex;
    const lifetime = kind === "blood" ? 18
                   : kind === "scorch" ? 14
                   : kind === "crack" ? 20
                   : 8;
    slot.mesh.scaling.x = size;
    slot.mesh.scaling.z = size;
    slot.mesh.position.set(pos.x, 0.015 + Math.random() * 0.004, pos.z);
    slot.mesh.rotation.y = Math.random() * Math.PI * 2;
    slot.mesh.visibility = 1;
    // Re-skin the shared material per kind. We mutate the slot's own material
    // (one mat per slot) instead of swapping — avoids a mat handoff.
    slot.mat.diffuseTexture = tex;
    slot.mat.opacityTexture = tex;
    if (kind === "blood") {
      slot.mat.diffuseColor.set(0.45, 0.05, 0.05);
      slot.mat.emissiveColor.set(0, 0, 0);
    } else if (kind === "scorch") {
      slot.mat.diffuseColor.set(0.12, 0.10, 0.10);
      slot.mat.emissiveColor.set(0.35, 0.15, 0.05);
    } else if (kind === "crack") {
      slot.mat.diffuseColor.set(0.06, 0.05, 0.04);
      slot.mat.emissiveColor.set(0.45, 0.18, 0.06);
    } else {
      slot.mat.diffuseColor.set(0.85, 0.95, 1.0);
      slot.mat.emissiveColor.set(0.35, 0.55, 0.85);
    }
    slot.ttl = lifetime;
    slot.initialTtl = lifetime;
    slot.life = lifetime;
    slot.active = true;
    slot.spawnSeq = this.nextSeq++;
    slot.mesh.setEnabled(true);
    return true;
  }

  update(dt: number): void {
    for (const s of this.pool) {
      if (!s.active) continue;
      s.ttl -= dt;
      if (s.ttl <= 0) {
        s.active = false;
        s.mesh.setEnabled(false);
        continue;
      }
      // Fade in the last 4s to avoid pop-out.
      if (s.ttl < 4) {
        s.mesh.visibility = s.ttl / 4;
      }
    }
  }

  /** Hide all active decals — for in-place run restart. Pool slots persist. */
  reset(): void {
    for (const s of this.pool) {
      s.active = false;
      s.ttl = 0;
      s.mesh.setEnabled(false);
    }
    this.nextSeq = 0;
  }

  dispose(): void {
    for (const s of this.pool) { s.mesh.dispose(); s.mat.dispose(); }
    this.pool.length = 0;
    this.bloodTex.dispose();
    this.scorchTex.dispose();
    this.crackTex.dispose();
    this.frostTex.dispose();
  }
}

/**
 * Procedural frost burst — radial ice shards on a pale halo. Sells the
 * cold-crash freeze as a literal ground-frost ring under the player.
 */
function buildFrostTex(scene: Scene): Texture {
  const size = 128;
  const dt = new DynamicTexture("decalFrostTex", { width: size, height: size }, scene, false);
  const ctx = dt.getContext();
  ctx.clearRect(0, 0, size, size);
  const cx = size / 2;
  const cy = size / 2;
  // Soft icy halo — bright center fading to transparent.
  const halo = ctx.createRadialGradient(cx, cy, 1, cx, cy, size * 0.5);
  halo.addColorStop(0, "rgba(220,240,255,0.85)");
  halo.addColorStop(0.5, "rgba(150,200,240,0.45)");
  halo.addColorStop(1, "rgba(80,140,200,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, size, size);
  // Thin ice shards radiating out — bright cyan strokes.
  const rays = 14;
  for (let i = 0; i < rays; i++) {
    const baseAngle = (i / rays) * Math.PI * 2 + Math.random() * 0.2;
    const len = size * (0.32 + Math.random() * 0.18);
    ctx.strokeStyle = `rgba(220,240,255,${0.55 + Math.random() * 0.3})`;
    ctx.lineWidth = 1.2 + Math.random() * 1.4;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(baseAngle) * len, cy + Math.sin(baseAngle) * len);
    ctx.stroke();
    // Branch — feather barb halfway out.
    if (Math.random() < 0.7) {
      const midR = len * 0.55;
      const mx = cx + Math.cos(baseAngle) * midR;
      const my = cy + Math.sin(baseAngle) * midR;
      const branchA1 = baseAngle + 0.5 + Math.random() * 0.3;
      const branchA2 = baseAngle - 0.5 - Math.random() * 0.3;
      const blen = len * (0.18 + Math.random() * 0.12);
      ctx.lineWidth = 0.9;
      ctx.strokeStyle = "rgba(220,240,255,0.6)";
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(mx + Math.cos(branchA1) * blen, my + Math.sin(branchA1) * blen);
      ctx.moveTo(mx, my);
      ctx.lineTo(mx + Math.cos(branchA2) * blen, my + Math.sin(branchA2) * blen);
      ctx.stroke();
    }
  }
  dt.hasAlpha = true;
  dt.update();
  return dt;
}

/**
 * Procedural cracked-earth texture — a radial set of jagged lines fanning out
 * from the center, on a transparent background, so the decal reads as a rupture
 * rather than a stain. Opacity is baked into the texture alpha.
 */
function buildCrackTex(scene: Scene): Texture {
  const size = 128;
  const dt = new DynamicTexture("decalCrackTex", { width: size, height: size }, scene, false);
  const ctx = dt.getContext();
  ctx.clearRect(0, 0, size, size);
  const cx = size / 2;
  const cy = size / 2;
  // Draw ~9 primary cracks radiating outward. Each is a polyline with a little
  // zig-zag so it looks organic instead of surveyor's-tape straight.
  const rays = 9;
  for (let i = 0; i < rays; i++) {
    const baseAngle = (i / rays) * Math.PI * 2 + Math.random() * 0.3;
    const segments = 5 + Math.floor(Math.random() * 3);
    const maxLen = size * 0.46;
    let px = cx;
    let py = cy;
    ctx.strokeStyle = `rgba(0,0,0,${0.65 + Math.random() * 0.25})`;
    ctx.lineWidth = 2.5 - i * 0.08;
    ctx.beginPath();
    ctx.moveTo(px, py);
    for (let s = 1; s <= segments; s++) {
      const t = s / segments;
      const r = t * maxLen;
      const jitter = (Math.random() - 0.5) * 0.4;
      const a = baseAngle + jitter;
      px = cx + Math.cos(a) * r;
      py = cy + Math.sin(a) * r;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
    // Short branch at roughly the mid-point.
    if (Math.random() < 0.7) {
      const branchAngle = baseAngle + (Math.random() - 0.5) * 1.1;
      const midR = maxLen * 0.45;
      const bx = cx + Math.cos(baseAngle) * midR;
      const by = cy + Math.sin(baseAngle) * midR;
      const blen = maxLen * 0.22 * Math.random();
      ctx.beginPath();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + Math.cos(branchAngle) * blen, by + Math.sin(branchAngle) * blen);
      ctx.stroke();
    }
  }
  // Glowing core — a faint orange radial at the center so emissive material
  // picks up a hot spot where the crack meets.
  const grad = ctx.createRadialGradient(cx, cy, 1, cx, cy, size * 0.12);
  grad.addColorStop(0, "rgba(255,150,60,0.6)");
  grad.addColorStop(1, "rgba(255,150,60,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  dt.hasAlpha = true;
  dt.update();
  return dt;
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
