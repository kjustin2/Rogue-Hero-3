import * as THREE from "three";
import { ARENA_RADIUS } from "../render/arena";
import { segmentCircleContact as contactTime } from "../core/math";
import type { Ctx } from "./ctx";
import type { Enemy } from "./enemies";
import type { AttackFamily, ImpactElement } from "../presentation/types";

interface Shot {
  active: boolean;
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  x: number;
  z: number;
  previousX: number;
  previousZ: number;
  hitWall: boolean;
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
  sourceId: string;
  sourceKind: string;
  attackFamily: AttackFamily;
  element: ImpactElement;
}

let glowTexture: THREE.CanvasTexture | null = null;

/** Shared radial-falloff sprite texture for projectile glows. */
function getGlowTexture(): THREE.CanvasTexture {
  if (glowTexture) return glowTexture;
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const g = cv.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.32)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowTexture = new THREE.CanvasTexture(cv);
  return glowTexture;
}

function makePool(scene: THREE.Scene, count: number): Shot[] {
  const geo = new THREE.SphereGeometry(1, 10, 8);
  const bladeGeo = new THREE.ConeGeometry(1, 4, 4);
  bladeGeo.rotateX(Math.PI / 2);
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
    // Soft halo around the core — makes every bullet read as a light source
    const glowMat = new THREE.SpriteMaterial({
      map: getGlowTexture(), color: 0xffffff, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.setScalar(7);
    mesh.add(glow);
    mesh.userData.solidity = "fx";
    mesh.userData.orbGeometry = geo;
    mesh.userData.bladeGeometry = bladeGeo;
    scene.add(mesh);
    pool.push({
      active: false, mesh, mat,
      x: 0, z: 0, previousX: 0, previousZ: 0, hitWall: false, y: 0.9, vx: 0, vz: 0,
      dmg: 0, radius: 0.25, traveled: 0, range: 30,
      pierce: false, hitIds: new Set(), trailAcc: 0, color: 0xffffff,
      sourceId: "projectile:unknown", sourceKind: "projectile", attackFamily: "card", element: "steel",
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
  sourceId?: string;
  sourceKind?: string;
  attackFamily?: AttackFamily;
  element?: ImpactElement;
  shape?: "orb" | "blade";
}

function fire(pool: Shot[], x: number, z: number, angle: number, opts: ShotOpts): Shot | null {
  const s = pool.find((p) => !p.active);
  if (!s) return null;
  s.active = true;
  s.x = x;
  s.z = z;
  s.previousX = x; s.previousZ = z; s.hitWall = false;
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
  s.sourceId = opts.sourceId ?? "projectile:unknown";
  s.sourceKind = opts.sourceKind ?? "projectile";
  s.attackFamily = opts.attackFamily ?? "card";
  s.element = opts.element ?? "steel";
  s.mat.color.set(opts.color);
  s.mesh.geometry = opts.shape === "blade" ? s.mesh.userData.bladeGeometry : s.mesh.userData.orbGeometry;
  const glow = s.mesh.children[0] as THREE.Sprite | undefined;
  if (glow) (glow.material as THREE.SpriteMaterial).color.set(opts.color);
  s.mesh.visible = true;
  s.mesh.position.set(x, s.y, z);
  // Stretch along travel direction for motion read
  s.mesh.scale.set(s.radius, opts.shape === "blade" ? s.radius * 0.28 : s.radius, s.radius * (opts.shape === "blade" ? 1.3 : 2.6));
  s.mesh.rotation.y = angle;
  return s;
}

function stepShot(s: Shot, dt: number, ctx: Ctx): boolean {
  s.previousX = s.x; s.previousZ = s.z; s.hitWall = false;
  s.x += s.vx * dt;
  s.z += s.vz * dt;
  const wall = ctx.arena.firstSolidHit(s.previousX,s.previousZ,s.x,s.z,s.radius);
  if (wall !== Infinity) {
    s.x = s.previousX+(s.x-s.previousX)*wall;
    s.z = s.previousZ+(s.z-s.previousZ)*wall;
    s.hitWall = true;
  }
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
  if (s.hitWall) {
      ctx.fx.burst({
        x: s.x, y: s.y, z: s.z, count: 6, color: s.color,
        speed: [1, 5], up: 0.5, size: [0.25, 0.5], life: [0.15, 0.3], gravity: -3, drag: 3,
      });
  }
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
    const enemies = this.ctx.enemies.living();
    for (const s of this.pool) {
      if (!s.active) continue;
      if (!stepShot(s, dt, this.ctx)) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      // Pick the first contact without per-frame arrays. Piercing shots repeat
      // the search with hitIds, usually once, so near targets always resolve first.
      while (s.active) {
        let target: Enemy | null = null, first = Infinity;
        for (const e of enemies) {
          if (!e.alive || s.hitIds.has(e.id)) continue;
          const t = contactTime(s.previousX,s.previousZ,s.x,s.z,e.pos.x,e.pos.z,e.radius+s.radius);
          if (t < first) { first=t; target=e; }
        }
        if (!target) break;
        s.hitIds.add(target.id);
        this.ctx.combat.dealDamage(target,s.dmg,{kbX:s.vx,kbZ:s.vz,kb:2.5,heavy:false,attackFamily:s.attackFamily,element:s.element,impactColor:s.color});
        const x=s.previousX+(s.x-s.previousX)*first, z=s.previousZ+(s.z-s.previousZ)*first;
        this.ctx.fx.burst({x,y:s.y,z,count:6,color:s.color,speed:[2,7],up:.5,size:[.08,.22],life:[.15,.3],gravity:-4,drag:4});
        if (!s.pierce) { s.active=false; s.mesh.visible=false; }
      }
      if (s.hitWall) { s.active = false; s.mesh.visible = false; }
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

  /** Last Bastion turns actual incoming shots back toward the nearest attacker. */
  reflectNear(x: number, z: number, radius: number, damage: number): void {
    for (const s of this.pool) {
      if (!s.active || Math.hypot(s.x-x,s.z-z)>radius+s.radius) continue;
      let angle = Math.atan2(-s.vx,-s.vz), best = Infinity;
      for (const e of this.ctx.enemies.living()) {
        if (!e.alive || e.warded) continue;
        const d = Math.hypot(e.pos.x-s.x,e.pos.z-s.z);
        if (d < best) { best=d; angle=Math.atan2(e.pos.x-s.x,e.pos.z-s.z); }
      }
      this.ctx.projectiles.fire(s.x,s.z,angle,{speed:26,dmg:damage,color:0xa1c8e4,radius:Math.min(0.35,s.radius),range:24,attackFamily:"crash"});
      s.active=false; s.mesh.visible=false;
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
      const rr = p.radius + s.radius;
      if (contactTime(s.previousX,s.previousZ,s.x,s.z,p.pos.x,p.pos.z,rr) !== Infinity && p.alive) {
        const absorbed = this.ctx.combat.damagePlayer(s.dmg, s.x, s.z, {
          parryable: true, sourceId: s.sourceId, sourceKind: s.sourceKind, attackFamily: s.attackFamily,
        });
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
      if (s.hitWall) { s.active=false; s.mesh.visible=false; }
    }
  }
}
