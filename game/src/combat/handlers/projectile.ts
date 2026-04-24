import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { EnemyManager } from "../../enemies/EnemyManager";
import { events } from "../../engine/EventBus";

interface PooledProjectile {
  mesh: Mesh;
  /** Larger additive halo sphere parented to `mesh` — breathes in size for life. */
  halo: Mesh;
  trail: ParticleSystem;
  vel: Vector3;
  damage: number;
  ttl: number;
  elapsed: number;
  alreadyHit: Set<string>;
  active: boolean;
}

/**
 * Pooled projectile system — 16 pre-allocated sphere+particle-system pairs.
 *
 * Previously each shot called MeshBuilder.CreateSphere + new ParticleSystem and
 * disposed both when consumed. During sustained fire that's the single biggest
 * GC source in the hot path. Pre-allocating a fixed pool and toggling visibility
 * eliminates those allocations. Follows the same pattern as HitParticles.
 */
export class ProjectileSystem {
  private readonly POOL_SIZE = 16;
  private pool: PooledProjectile[] = [];
  private mat: StandardMaterial;
  private haloMat: StandardMaterial;
  private trailTex: Texture;

  constructor(private scene: Scene, private enemies: EnemyManager) {
    this.mat = new StandardMaterial("projectileMat", scene);
    this.mat.emissiveColor = new Color3(0.9, 0.7, 0.2);
    this.mat.diffuseColor = new Color3(1, 0.85, 0.3);
    this.mat.disableLighting = true;
    this.mat.freeze();

    // Halo — additive, low alpha. Shared across all pooled projectiles since
    // every halo looks the same; per-slot scaling drives the breathing motion.
    this.haloMat = new StandardMaterial("projectileHaloMat", scene);
    this.haloMat.emissiveColor = new Color3(1.0, 0.85, 0.35);
    this.haloMat.diffuseColor = new Color3(0, 0, 0);
    this.haloMat.disableLighting = true;
    this.haloMat.alpha = 0.45;
    this.haloMat.alphaMode = 1; // BABYLON.Engine.ALPHA_ADD
    this.haloMat.backFaceCulling = false;
    this.haloMat.freeze();

    // Procedural soft-glow sprite for the trail — one shared texture across all projectiles.
    const dt = new DynamicTexture("projTrailTex", { width: 64, height: 64 }, scene, false);
    const ctx = dt.getContext();
    const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.5, "rgba(255,235,180,0.55)");
    grad.addColorStop(1, "rgba(255,180,60,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    dt.update();
    this.trailTex = dt;

    for (let i = 0; i < this.POOL_SIZE; i++) this.pool.push(this.allocate(i));
  }

  private allocate(idx: number): PooledProjectile {
    const mesh = MeshBuilder.CreateSphere(`proj_${idx}`, { diameter: 0.35, segments: 8 }, this.scene);
    mesh.material = this.mat;
    mesh.doNotSyncBoundingInfo = true;
    mesh.isPickable = false;
    mesh.setEnabled(false);

    // Halo child — slightly larger additive sphere that breathes in size while
    // the bolt flies. Parented to the core so it tracks position for free.
    const halo = MeshBuilder.CreateSphere(`proj_${idx}_halo`, { diameter: 0.72, segments: 8 }, this.scene);
    halo.material = this.haloMat;
    halo.parent = mesh;
    halo.doNotSyncBoundingInfo = true;
    halo.isPickable = false;

    const trail = new ParticleSystem(`proj_${idx}_trail`, 120, this.scene);
    trail.particleTexture = this.trailTex;
    trail.emitter = mesh;
    trail.minEmitBox = new Vector3(-0.05, -0.05, -0.05);
    trail.maxEmitBox = new Vector3(0.05, 0.05, 0.05);
    trail.color1 = new Color4(1.0, 0.85, 0.35, 1);
    trail.color2 = new Color4(1.0, 0.55, 0.15, 1);
    trail.colorDead = new Color4(0, 0, 0, 0);
    trail.minSize = 0.12;
    trail.maxSize = 0.42;
    trail.minLifeTime = 0.15;
    trail.maxLifeTime = 0.32;
    trail.emitRate = 200;
    trail.minEmitPower = 0;
    trail.maxEmitPower = 0.3;
    trail.gravity = new Vector3(0, 0, 0);
    trail.blendMode = ParticleSystem.BLENDMODE_ADD;
    trail.updateSpeed = 0.016;

    return {
      mesh,
      halo,
      trail,
      vel: new Vector3(),
      damage: 0,
      ttl: 0,
      elapsed: 0,
      alreadyHit: new Set(),
      active: false,
    };
  }

  private acquire(): PooledProjectile | null {
    for (const p of this.pool) if (!p.active) return p;
    // All slots busy — shouldn't happen at POOL_SIZE=16 under normal play, but
    // if someone spams fire faster than projectiles resolve, silently drop the
    // shot rather than allocating. Matches the "degrade gracefully" pattern of
    // the decal FIFO cap.
    return null;
  }

  fire(origin: Vector3, dir: Vector3, speed: number, damage: number, ttl = 1.6): void {
    const v = dir.clone();
    v.y = 0;
    const len = Math.hypot(v.x, v.z);
    if (len < 1e-4) return;
    v.x = (v.x / len) * speed;
    v.z = (v.z / len) * speed;

    const p = this.acquire();
    if (!p) return;

    p.mesh.position.copyFrom(origin);
    p.mesh.position.y = 1;
    p.vel.set(v.x, 0, v.z);
    p.damage = damage;
    p.ttl = ttl;
    p.elapsed = 0;
    p.alreadyHit.clear();
    p.active = true;
    p.mesh.setEnabled(true);
    p.halo.scaling.setAll(1);
    p.trail.start();
  }

  update(dt: number): void {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.ttl -= dt;
      p.elapsed += dt;
      p.mesh.position.x += p.vel.x * dt;
      p.mesh.position.z += p.vel.z * dt;
      // Halo breathe — ~3 Hz pulse, ±12%. Applied in parent's local space so
      // it scales around the core's center.
      const breathe = 1 + 0.12 * Math.sin(p.elapsed * 18);
      p.halo.scaling.x = p.halo.scaling.y = p.halo.scaling.z = breathe;

      // Hit check (squared distance)
      let consumed = false;
      for (const e of this.enemies.enemies) {
        if (!e.alive) continue;
        if (p.alreadyHit.has(e.id)) continue;
        const dx = e.root.position.x - p.mesh.position.x;
        const dz = e.root.position.z - p.mesh.position.z;
        const r = e.def.radius + 0.18;
        if (dx * dx + dz * dz <= r * r) {
          e.takeDamage(p.damage);
          // Light knockback along the projectile's travel direction — sells the "bolt" read.
          const vl = Math.hypot(p.vel.x, p.vel.z);
          if (vl > 1e-4) e.knockback(p.vel.x / vl, p.vel.z / vl, 3.2);
          events.emit("COMBO_HIT", { hitNum: 1, count: 1 });
          consumed = true;
          break;
        }
      }

      if (consumed || p.ttl <= 0) this.release(p);
    }
  }

  private release(p: PooledProjectile): void {
    // Stop emission; in-flight particles finish fading via their own lifetime.
    // The mesh is hidden immediately so the bolt vanishes cleanly at impact.
    p.trail.stop();
    p.mesh.setEnabled(false);
    p.active = false;
  }

  /** Drop all in-flight projectiles — for in-place run restart. */
  reset(): void {
    for (const p of this.pool) {
      if (p.active) this.release(p);
    }
  }

  dispose(): void {
    for (const p of this.pool) {
      p.trail.stop();
      p.trail.dispose();
      p.halo.dispose();
      p.mesh.dispose();
    }
    this.pool.length = 0;
    this.mat.dispose();
    this.haloMat.dispose();
    this.trailTex.dispose();
  }
}
