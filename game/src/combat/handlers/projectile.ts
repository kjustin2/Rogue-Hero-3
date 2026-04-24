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

interface ActiveProjectile {
  mesh: Mesh;
  vel: Vector3;
  damage: number;
  ttl: number;
  alreadyHit: Set<string>;
  trail: ParticleSystem;
}

export class ProjectileSystem {
  private active: ActiveProjectile[] = [];
  private mat: StandardMaterial;
  private trailTex: Texture;

  constructor(private scene: Scene, private enemies: EnemyManager) {
    this.mat = new StandardMaterial("projectileMat", scene);
    this.mat.emissiveColor = new Color3(0.9, 0.7, 0.2);
    this.mat.diffuseColor = new Color3(1, 0.85, 0.3);
    this.mat.disableLighting = true;

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
  }

  fire(origin: Vector3, dir: Vector3, speed: number, damage: number, ttl = 1.6): void {
    const mesh = MeshBuilder.CreateSphere("proj", { diameter: 0.35, segments: 8 }, this.scene);
    mesh.position = origin.clone();
    mesh.position.y = 1;
    mesh.material = this.mat;
    const v = dir.clone();
    v.y = 0;
    const len = Math.hypot(v.x, v.z);
    if (len < 1e-4) return;
    v.x /= len;
    v.z /= len;
    v.scaleInPlace(speed);

    // Trail: emits additive glowing sprites from the mesh each frame. Particles
    // inherit no velocity so they hang in place while the bolt pulls ahead, which
    // reads as a streak. Capacity 120 covers the bolt's ~1s flight at 200/s.
    const trail = new ParticleSystem(`${mesh.name}_trail`, 120, this.scene);
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
    trail.start();

    this.active.push({ mesh, vel: v, damage, ttl, alreadyHit: new Set(), trail });
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.ttl -= dt;
      p.mesh.position.x += p.vel.x * dt;
      p.mesh.position.z += p.vel.z * dt;

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

      if (consumed || p.ttl <= 0) {
        // Stop emission but let in-flight particles finish fading, then dispose after a short delay.
        p.trail.stop();
        p.trail.disposeOnStop = true;
        p.mesh.dispose();
        this.active.splice(i, 1);
      }
    }
  }

  /** Drop all in-flight projectiles — for in-place run restart. */
  reset(): void {
    for (const p of this.active) {
      p.trail.stop();
      p.trail.disposeOnStop = true;
      p.mesh.dispose();
    }
    this.active.length = 0;
  }

  dispose(): void {
    for (const p of this.active) {
      p.trail.stop();
      p.trail.disposeOnStop = true;
      p.mesh.dispose();
    }
    this.active.length = 0;
    this.mat.dispose();
    this.trailTex.dispose();
  }
}
