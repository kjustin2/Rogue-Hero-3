import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Player } from "../../player/Player";
import { events } from "../../engine/EventBus";

interface PooledHostileProjectile {
  mesh: Mesh;
  vel: Vector3;
  damage: number;
  ttl: number;
  hitRadius: number;
  jumpClearanceY: number | null;
  active: boolean;
}

export interface HostileProjectileOptions {
  /** World Y for the projectile center. Low shots can be jumped over. */
  height?: number;
  /** Collision radius. Default matches the 0.4m visual sphere. */
  hitRadius?: number;
  /** If the player's feet are above this Y, treat overlap as a jump-clear. */
  jumpClearanceY?: number;
}

/**
 * Enemy projectiles — pooled. Each pooled slot has its own sphere mesh + a
 * shared material. fire() acquires a free slot; update() advances and tests
 * against the player; release() hides instead of disposing.
 *
 * Pool size 12 covers the boss + a couple of casters firing in parallel
 * without ever growing.
 */
export class HostileProjectileSystem {
  private readonly POOL_SIZE = 12;
  private pool: PooledHostileProjectile[] = [];
  private mat: StandardMaterial;

  constructor(private scene: Scene, private player: Player) {
    this.mat = new StandardMaterial("hostileProjMat", scene);
    this.mat.emissiveColor = new Color3(0.95, 0.25, 0.3);
    this.mat.diffuseColor = new Color3(1, 0.4, 0.4);
    this.mat.disableLighting = true;
    this.mat.freeze();

    for (let i = 0; i < this.POOL_SIZE; i++) this.pool.push(this.allocate(i));
  }

  private allocate(idx: number): PooledHostileProjectile {
    const mesh = MeshBuilder.CreateSphere(`hostileProj_${idx}`, { diameter: 0.4, segments: 8 }, this.scene);
    mesh.material = this.mat;
    mesh.doNotSyncBoundingInfo = true;
    mesh.isPickable = false;
    mesh.setEnabled(false);
    return {
      mesh,
      vel: new Vector3(),
      damage: 0,
      ttl: 0,
      hitRadius: 0.2,
      jumpClearanceY: null,
      active: false,
    };
  }

  private acquire(): PooledHostileProjectile | null {
    for (const p of this.pool) if (!p.active) return p;
    return null; // pool exhausted — silently drop the shot
  }

  fire(
    origin: Vector3,
    dir: Vector3,
    speed: number,
    damage: number,
    ttl = 2.5,
    opts: HostileProjectileOptions = {},
  ): void {
    const len = Math.hypot(dir.x, dir.z);
    if (len < 1e-4) return;
    const p = this.acquire();
    if (!p) return;
    p.mesh.position.copyFrom(origin);
    p.mesh.position.y = opts.height ?? 1;
    p.vel.set((dir.x / len) * speed, 0, (dir.z / len) * speed);
    p.damage = damage;
    p.ttl = ttl;
    p.hitRadius = opts.hitRadius ?? 0.2;
    p.jumpClearanceY = opts.jumpClearanceY ?? null;
    p.active = true;
    const visualScale = p.hitRadius / 0.2;
    p.mesh.scaling.setAll(visualScale);
    p.mesh.setEnabled(true);
  }

  update(dt: number): void {
    const px = this.player.root.position.x;
    const pz = this.player.root.position.z;
    const playerR = this.player.stats.radius;

    for (const p of this.pool) {
      if (!p.active) continue;
      p.ttl -= dt;
      p.mesh.position.x += p.vel.x * dt;
      p.mesh.position.z += p.vel.z * dt;

      let consumed = false;
      const dx = px - p.mesh.position.x;
      const dz = pz - p.mesh.position.z;
      const r = playerR + p.hitRadius;
      if (dx * dx + dz * dz <= r * r) {
        const feetY = this.player.root.position.y;
        const headY = feetY + 1.9;
        const projectileY = p.mesh.position.y;
        const verticalOverlap = projectileY + p.hitRadius >= feetY + 0.05
          && projectileY - p.hitRadius <= headY;
        const jumpedOver = p.jumpClearanceY !== null && feetY >= p.jumpClearanceY;
        if (jumpedOver) {
          events.emit("PERFECT_DODGE", {});
        } else if (verticalOverlap && !this.player.isDodging) {
          events.emit("DAMAGE_TAKEN", { amount: p.damage, source: "projectile" });
        } else if (verticalOverlap && this.player.tryConsumePerfectDodge()) {
          events.emit("PERFECT_DODGE", {});
        } else if (!verticalOverlap) {
          consumed = false;
          continue;
        }
        consumed = true;
      }

      if (consumed || p.ttl <= 0) this.release(p);
    }
  }

  private release(p: PooledHostileProjectile): void {
    p.active = false;
    p.mesh.setEnabled(false);
  }

  /** Drop all in-flight enemy projectiles — for in-place run restart. */
  reset(): void {
    for (const p of this.pool) {
      if (p.active) this.release(p);
    }
  }

  dispose(): void {
    for (const p of this.pool) p.mesh.dispose();
    this.pool.length = 0;
    this.mat.dispose();
  }
}
