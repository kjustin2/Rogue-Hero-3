import { Scene } from "@babylonjs/core/scene";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";

interface Flare {
  mesh: Mesh;
  mat: StandardMaterial;
  ttl: number;
  initialTtl: number;
  maxScale: number;
  active: boolean; // pool flag — false means it's sitting idle ready for reuse
}

interface PooledBurst {
  ps: ParticleSystem;
  /** ms timestamp when the burst stopped emitting and can be returned to the pool. */
  freeAt: number;
}

/**
 * Pooled hit-burst + ground-flare FX.
 *
 * Previously we allocated `new ParticleSystem(...)` + `new Mesh(...)` + `new
 * StandardMaterial(...)` on EVERY single hit. With 3–6 hits per melee swing
 * and 60fps swings, that's a torrent of GPU resource allocations which
 * manifested as visible lag on attack.
 *
 * Now both pools start empty and grow on demand. Once a burst finishes its
 * lifetime, it's returned to the pool and reused for the next hit — no more
 * per-hit allocations in steady state.
 */
export class HitParticles {
  private particleTex: Texture;
  private flares: Flare[] = [];
  // Burst pool — all share a common capacity so any pooled PS can serve any burst size.
  private readonly PS_CAPACITY = 96;
  private readonly PS_LIFETIME_MS = 700; // how long a burst holds its particles before recycling
  private busyBursts: PooledBurst[] = [];
  private freeBursts: ParticleSystem[] = [];
  // Reused Vector3 so the burst emitter update doesn't allocate each hit.
  private emitterBuf = new Vector3();

  constructor(private scene: Scene) {
    // Procedural soft circular sprite (no asset file needed)
    const dt = new DynamicTexture("hitParticleTex", { width: 64, height: 64 }, scene, false);
    const ctx = dt.getContext();
    const grad = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.4, "rgba(255,255,255,0.6)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    dt.update();
    this.particleTex = dt;
  }

  /**
   * Expanding additive ring on the ground — the "pop" under a crit/kill hit.
   * Flares are pooled (same principle as bursts) so kills in quick succession
   * don't allocate fresh meshes.
   */
  flare(pos: Vector3, color: [number, number, number] = [1, 0.85, 0.35], maxScale = 2.2, ttl = 0.22): void {
    const f = this.acquireFlare();
    f.mesh.position.set(pos.x, Math.max(0.09, pos.y * 0.2 + 0.09), pos.z);
    f.mesh.scaling.x = f.mesh.scaling.z = 1;
    f.mesh.isVisible = true;
    f.mat.emissiveColor.set(color[0], color[1], color[2]);
    f.mat.diffuseColor.set(color[0], color[1], color[2]);
    f.mat.alpha = 0.9;
    f.ttl = ttl;
    f.initialTtl = ttl;
    f.maxScale = maxScale;
    f.active = true;
  }

  private acquireFlare(): Flare {
    // Find an idle flare in the pool; create one if none.
    for (let i = 0; i < this.flares.length; i++) {
      if (!this.flares[i].active) return this.flares[i];
    }
    const mesh = MeshBuilder.CreateDisc(
      `flare_pool_${this.flares.length}`,
      { radius: 0.6, tessellation: 20 },
      this.scene,
    );
    mesh.rotation.x = Math.PI / 2;
    mesh.isPickable = false;
    mesh.doNotSyncBoundingInfo = true;
    mesh.isVisible = false;
    const mat = new StandardMaterial(`${mesh.name}_mat`, this.scene);
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mat.alpha = 0;
    mesh.material = mat;
    const rec: Flare = { mesh, mat, ttl: 0, initialTtl: 0, maxScale: 2.2, active: false };
    this.flares.push(rec);
    return rec;
  }

  updateFlares(dt: number): void {
    for (const f of this.flares) {
      if (!f.active) continue;
      f.ttl -= dt;
      if (f.ttl <= 0) {
        // Return to the pool — hide but DON'T dispose; next flare() call reuses it.
        f.mesh.isVisible = false;
        f.mat.alpha = 0;
        f.active = false;
        continue;
      }
      const t = 1 - f.ttl / f.initialTtl;
      const s = 1 + (f.maxScale - 1) * t;
      f.mesh.scaling.x = f.mesh.scaling.z = s;
      f.mat.alpha = 0.9 * (1 - t);
    }
  }

  /** Deactivate all active flares — for in-place run restart. Doesn't dispose the pool. */
  resetFlares(): void {
    for (const f of this.flares) {
      f.active = false;
      f.mesh.isVisible = false;
      f.mat.alpha = 0;
    }
  }

  /**
   * Spawn a burst at world position. `count` = particles emitted, `color` base
   * RGB (0..1). Uses the pooled ParticleSystem path — no allocation in the hot
   * loop unless the pool is empty AND needs to grow (one-time cost per slot).
   */
  burst(pos: Vector3, count = 24, color: [number, number, number] = [1, 0.7, 0.3], scale = 1): void {
    // Recycle any finished bursts before we try to grab a fresh one.
    this.reclaimFinishedBursts();
    const ps = this.acquireBurst();

    // Reuse a shared Vector3 for the emitter — we copy into it rather than
    // assigning a new instance so Babylon's internal reference stays valid.
    this.emitterBuf.set(pos.x, pos.y, pos.z);
    ps.emitter = this.emitterBuf;

    ps.color1.set(color[0], color[1], color[2], 1);
    ps.color2.set(color[0] * 0.8, color[1] * 0.6, color[2] * 0.4, 1);
    ps.minSize = 0.15 * scale;
    ps.maxSize = 0.45 * scale;
    ps.start();
    // Clamp to the pool's capacity — large boss kills asked for up to 60
    // which is within the 96 cap, but defensively clamp.
    ps.manualEmitCount = Math.min(count, this.PS_CAPACITY);

    this.busyBursts.push({ ps, freeAt: performance.now() + this.PS_LIFETIME_MS });
  }

  private acquireBurst(): ParticleSystem {
    const ps = this.freeBursts.pop();
    if (ps) return ps;
    // Pool exhausted — create a new one with the shared capacity. Configured
    // once here so per-burst we only change color + size + emitter position.
    const n = new ParticleSystem(`burstPool_${this.busyBursts.length + 1}`, this.PS_CAPACITY, this.scene);
    n.particleTexture = this.particleTex;
    n.minEmitBox = new Vector3(-0.1, 0, -0.1);
    n.maxEmitBox = new Vector3(0.1, 0.4, 0.1);
    n.colorDead = new Color4(0, 0, 0, 0);
    n.minLifeTime = 0.2;
    n.maxLifeTime = 0.55;
    n.emitRate = 0;
    n.minEmitPower = 4;
    n.maxEmitPower = 9;
    n.gravity = new Vector3(0, -8, 0);
    n.updateSpeed = 0.016;
    n.direction1 = new Vector3(-1, 1.5, -1);
    n.direction2 = new Vector3(1, 2.0, 1);
    n.blendMode = ParticleSystem.BLENDMODE_ADD;
    // Allocate once here; subsequent bursts mutate color components via .set().
    n.color1 = new Color4(1, 1, 1, 1);
    n.color2 = new Color4(1, 1, 1, 1);
    return n;
  }

  private reclaimFinishedBursts(): void {
    const now = performance.now();
    for (let i = this.busyBursts.length - 1; i >= 0; i--) {
      const b = this.busyBursts[i];
      if (now < b.freeAt) continue;
      b.ps.stop();
      // `stop()` lets in-flight particles fade naturally. After PS_LIFETIME_MS
      // all particles have been recycled so we can safely re-emit next hit.
      this.freeBursts.push(b.ps);
      this.busyBursts.splice(i, 1);
    }
  }

  dispose(): void {
    this.resetFlares();
    for (const f of this.flares) { f.mesh.dispose(); f.mat.dispose(); }
    this.flares.length = 0;
    for (const b of this.busyBursts) b.ps.dispose();
    this.busyBursts.length = 0;
    for (const ps of this.freeBursts) ps.dispose();
    this.freeBursts.length = 0;
    this.particleTex.dispose();
  }
}
