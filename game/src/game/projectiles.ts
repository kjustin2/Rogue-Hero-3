import * as THREE from "three";
import { ARENA_RADIUS } from "../render/arena";
import type { Ctx } from "./ctx";

interface Shot {
  active: boolean;
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  x: number;
  z: number;
  y: number;
  vx: number;
  vz: number;
  dmg: number;
  radius: number;
  traveled: number;
  range: number;
  pierce: boolean;
  hitIds: Set<number>;
  trailAcc: number;
  color: number;
}

function makePool(scene: THREE.Scene, count: number): Shot[] {
  const geo = new THREE.SphereGeometry(1, 10, 8);
  const pool: Shot[] = [];
  for (let i = 0; i < count; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    scene.add(mesh);
    pool.push({
      active: false, mesh, mat,
      x: 0, z: 0, y: 0.9, vx: 0, vz: 0,
      dmg: 0, radius: 0.25, traveled: 0, range: 30,
      pierce: false, hitIds: new Set(), trailAcc: 0, color: 0xffffff,
    });
  }
  return pool;
}

export interface ShotOpts {
  speed: number;
  dmg: number;
  color: number;
  radius?: number;
  range?: number;
  pierce?: boolean;
  y?: number;
}

function fire(pool: Shot[], x: number, z: number, angle: number, opts: ShotOpts): Shot | null {
  const s = pool.find((p) => !p.active);
  if (!s) return null;
  s.active = true;
  s.x = x;
  s.z = z;
  s.y = opts.y ?? 0.95;
  s.vx = Math.sin(angle) * opts.speed;
  s.vz = Math.cos(angle) * opts.speed;
  s.dmg = opts.dmg;
  s.radius = opts.radius ?? 0.28;
  s.range = opts.range ?? 30;
  s.pierce = opts.pierce ?? false;
  s.traveled = 0;
  s.hitIds.clear();
  s.trailAcc = 0;
  s.color = opts.color;
  s.mat.color.set(opts.color);
  s.mesh.visible = true;
  s.mesh.position.set(x, s.y, z);
  // Stretch along travel direction for motion read
  s.mesh.scale.set(s.radius, s.radius, s.radius * 2.6);
  s.mesh.rotation.y = angle;
  return s;
}

function stepShot(s: Shot, dt: number, ctx: Ctx): boolean {
  s.x += s.vx * dt;
  s.z += s.vz * dt;
  s.traveled += Math.hypot(s.vx, s.vz) * dt;
  s.mesh.position.set(s.x, s.y, s.z);
  s.trailAcc += dt;
  if (s.trailAcc > 0.03) {
    s.trailAcc = 0;
    ctx.fx.burst({
      x: s.x, y: s.y, z: s.z, count: 1, color: s.color,
      speed: [0.1, 0.4], up: 0, vertical: 0.4, size: [0.35, 0.6], life: [0.15, 0.3], gravity: 0, drag: 1, jitter: 0.06,
    });
  }
  const r = Math.hypot(s.x, s.z);
  if (s.traveled > s.range || r > ARENA_RADIUS + 4) return false;
  return true;
}

/** Player-owned bullets — collide against enemies. */
export class Projectiles {
  private pool: Shot[];

  constructor(private ctx: Ctx, scene: THREE.Scene) {
    this.pool = makePool(scene, 48);
  }

  fire(x: number, z: number, angle: number, opts: ShotOpts): void {
    fire(this.pool, x, z, angle, opts);
  }

  clear(): void {
    for (const s of this.pool) {
      s.active = false;
      s.mesh.visible = false;
    }
  }

  update(dt: number): void {
    for (const s of this.pool) {
      if (!s.active) continue;
      if (!stepShot(s, dt, this.ctx)) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      for (const e of this.ctx.enemies.living()) {
        if (s.hitIds.has(e.id)) continue;
        const dx = e.pos.x - s.x;
        const dz = e.pos.z - s.z;
        const rr = e.radius + s.radius;
        if (dx * dx + dz * dz < rr * rr) {
          s.hitIds.add(e.id);
          this.ctx.combat.dealDamage(e, s.dmg, { kbX: s.vx, kbZ: s.vz, kb: 2.5, heavy: false });
          this.ctx.fx.burst({
            x: s.x, y: s.y, z: s.z, count: 8, color: s.color,
            speed: [2, 7], up: 0.5, size: [0.3, 0.7], life: [0.15, 0.4], gravity: -4, drag: 4,
          });
          if (!s.pierce) {
            s.active = false;
            s.mesh.visible = false;
            break;
          }
        }
      }
    }
  }
}

/** Enemy-owned bullets — collide against the player. */
export class HostileProjectiles {
  private pool: Shot[];

  constructor(private ctx: Ctx, scene: THREE.Scene) {
    this.pool = makePool(scene, 64);
  }

  fire(x: number, z: number, angle: number, opts: ShotOpts): void {
    fire(this.pool, x, z, angle, opts);
  }

  clear(): void {
    for (const s of this.pool) {
      s.active = false;
      s.mesh.visible = false;
    }
  }

  update(dt: number): void {
    const p = this.ctx.player;
    for (const s of this.pool) {
      if (!s.active) continue;
      if (!stepShot(s, dt, this.ctx)) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      const dx = p.pos.x - s.x;
      const dz = p.pos.z - s.z;
      const rr = p.radius + s.radius;
      if (dx * dx + dz * dz < rr * rr && p.alive) {
        const absorbed = this.ctx.combat.damagePlayer(s.dmg, s.x, s.z);
        // Perfect-dodged shots pass through; anything else pops
        if (absorbed !== "dodged") {
          s.active = false;
          s.mesh.visible = false;
          this.ctx.fx.burst({
            x: s.x, y: s.y, z: s.z, count: 10, color: s.color,
            speed: [2, 6], up: 0.5, size: [0.3, 0.6], life: [0.2, 0.4], gravity: -4, drag: 4,
          });
        }
      }
    }
  }
}
