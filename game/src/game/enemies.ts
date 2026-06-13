import * as THREE from "three";
import { ARENA_RADIUS } from "../render/arena";
import { dampAngle, TAU } from "../core/math";
import type { Ctx } from "./ctx";

export type EnemyKind =
  | "husk" | "spitter" | "swarmer" | "bomber" | "sentinel"
  | "wisp" | "leaper" | "tether" | "mirror" | "caster"
  | "boss";

let NEXT_ID = 1;

interface FlashMat {
  mat: THREE.MeshStandardMaterial;
  baseEmissive: THREE.Color;
  baseIntensity: number;
}

export interface DamageOpts {
  kbX?: number;
  kbZ?: number;
  kb?: number;
  heavy?: boolean;
}

/**
 * Base enemy: HP, knockback physics, hit-flash, freeze, billboard HP bar and
 * a per-type `tick` brain. All attacks must telegraph — that's the contract.
 */
export abstract class Enemy {
  readonly id = NEXT_ID++;
  abstract readonly kind: EnemyKind;
  readonly pos = new THREE.Vector3();
  radius = 0.5;
  hp = 30;
  maxHp = 30;
  speed = 3;
  alive = true;
  frozen = 0;
  contactDmg = 0;
  protected contactCd = 0;

  readonly root = new THREE.Group();
  protected heading = 0;
  protected kb = new THREE.Vector2();
  protected hitFlash = 0;
  protected flashMats: FlashMat[] = [];
  protected t = Math.random() * 10;

  private hpBg: THREE.Sprite;
  private hpFill: THREE.Sprite;

  constructor(protected ctx: Ctx, x: number, z: number) {
    this.pos.set(x, 0, z);
    this.root.position.copy(this.pos);
    ctx.stage.scene.add(this.root);

    const barMatBg = new THREE.SpriteMaterial({ color: 0x000000, opacity: 0.55, transparent: true, depthWrite: false });
    const barMatFill = new THREE.SpriteMaterial({ color: 0xff5544, opacity: 0.95, transparent: true, depthWrite: false });
    this.hpBg = new THREE.Sprite(barMatBg);
    this.hpFill = new THREE.Sprite(barMatFill);
    this.hpBg.scale.set(1.1, 0.09, 1);
    this.hpFill.scale.set(1.06, 0.055, 1);
    this.hpFill.center.set(0, 0.5);
    this.hpBg.visible = this.hpFill.visible = false;
    this.root.add(this.hpBg, this.hpFill);
  }

  protected registerFlash(mat: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
    this.flashMats.push({ mat, baseEmissive: mat.emissive.clone(), baseIntensity: mat.emissiveIntensity });
    return mat;
  }

  protected stdMat(color: number, emissive = 0x000000, intensity = 0): THREE.MeshStandardMaterial {
    return this.registerFlash(
      new THREE.MeshStandardMaterial({
        color, emissive, emissiveIntensity: intensity, roughness: 0.6, metalness: 0.2, flatShading: true,
      })
    );
  }

  protected addMesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = this.root): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  takeDamage(amount: number, opts: DamageOpts = {}): boolean {
    if (!this.alive) return false;
    this.hp -= amount;
    this.hitFlash = 1;
    const kbStrength = (opts.kb ?? 0) * (opts.heavy ? 1.4 : 1);
    if (kbStrength > 0) {
      const len = Math.hypot(opts.kbX ?? 0, opts.kbZ ?? 0) || 1;
      this.kb.x += ((opts.kbX ?? 0) / len) * kbStrength;
      this.kb.y += ((opts.kbZ ?? 0) / len) * kbStrength;
    }
    if (this.hp <= 0) {
      this.die();
      return true;
    }
    return false;
  }

  freeze(duration: number): void {
    this.frozen = Math.max(this.frozen, duration);
  }

  /** Damage-free knockback along (x, z) — pulls when pointed inward. Bosses shrug it off. */
  shove(x: number, z: number, strength: number): void {
    if (this.kind === "boss") return;
    const len = Math.hypot(x, z) || 1;
    this.kb.x += (x / len) * strength;
    this.kb.y += (z / len) * strength;
  }

  die(): void {
    if (!this.alive) return;
    this.alive = false;
    this.onDeath();
    this.ctx.events.emit("KILL", { x: this.pos.x, z: this.pos.z, kind: this.kind });
    const c = this.deathColor();
    this.ctx.fx.burst({
      x: this.pos.x, y: 0.8, z: this.pos.z,
      count: 26, color: [c, 0xffffff, c],
      speed: [3, 11], up: 0.7, size: [0.4, 1.0], life: [0.3, 0.8], gravity: -8, drag: 2.5,
    });
    this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: this.radius * 3.2, color: c, duration: 0.4 });
    this.dispose();
  }

  protected onDeath(): void {}

  protected deathColor(): number {
    return 0xff6644;
  }

  dispose(): void {
    this.ctx.stage.scene.remove(this.root);
    // Each enemy builds its own geometries/materials — release them or rooms leak GPU memory
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
        const m = o.material as THREE.Material | THREE.Material[];
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    });
  }

  /** Per-type brain. Only called when not frozen. */
  protected abstract tick(dt: number): void;

  update(dt: number): void {
    if (!this.alive) return;
    this.t += dt;
    this.contactCd -= dt;

    if (this.frozen > 0) {
      this.frozen -= dt;
      for (const f of this.flashMats) {
        f.mat.emissive.set(0x5599ff);
        f.mat.emissiveIntensity = 0.9 + Math.sin(this.t * 6) * 0.2;
      }
    } else {
      this.tick(dt);
      // Hit flash: spike emissive to white, settle back
      this.hitFlash = Math.max(0, this.hitFlash - dt * 7);
      for (const f of this.flashMats) {
        f.mat.emissive.copy(f.baseEmissive).lerp(new THREE.Color(0xffffff), this.hitFlash);
        f.mat.emissiveIntensity = f.baseIntensity + this.hitFlash * 3;
      }
    }

    // Knockback decay
    this.pos.x += this.kb.x * dt;
    this.pos.z += this.kb.y * dt;
    this.kb.multiplyScalar(Math.exp(-6 * dt));

    // Bounds
    const r = Math.hypot(this.pos.x, this.pos.z);
    const maxR = ARENA_RADIUS - this.radius * 0.5;
    if (r > maxR) {
      this.pos.x *= maxR / r;
      this.pos.z *= maxR / r;
    }

    this.root.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.root.rotation.y = this.heading;

    // HP bar
    const frac = Math.max(0, this.hp / this.maxHp);
    const show = frac < 1;
    this.hpBg.visible = this.hpFill.visible = show;
    if (show) {
      const h = this.barHeight();
      this.hpBg.position.set(0, h, 0);
      this.hpFill.position.set(-0.53, h, 0.001);
      this.hpFill.scale.x = 1.06 * frac;
    }
  }

  protected barHeight(): number {
    return 2.0;
  }

  /** Damped walk toward a point; returns distance remaining. */
  protected seek(tx: number, tz: number, dt: number, speedScale = 1): number {
    const dx = tx - this.pos.x;
    const dz = tz - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.05) {
      const sp = this.speed * speedScale;
      this.pos.x += (dx / d) * sp * dt;
      this.pos.z += (dz / d) * sp * dt;
      this.heading = dampAngle(this.heading, Math.atan2(dx, dz), 8, dt);
    }
    return d;
  }

  protected facePlayer(dt: number): void {
    const p = this.ctx.player.pos;
    this.heading = dampAngle(this.heading, Math.atan2(p.x - this.pos.x, p.z - this.pos.z), 8, dt);
  }

  protected distToPlayer(): number {
    const p = this.ctx.player.pos;
    return Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
  }

  protected tryContactDamage(range = 0.45): void {
    if (this.contactDmg <= 0 || this.contactCd > 0) return;
    const p = this.ctx.player;
    if (this.distToPlayer() < this.radius + p.radius + range) {
      if (this.ctx.combat.damagePlayer(this.contactDmg, this.pos.x, this.pos.z) !== "dodged") {
        this.contactCd = 0.9;
      }
    }
  }
}

// ---------------------------------------------------------------- Husk
/** Melee chaser. Telegraphed lunge bite. The bread-and-butter threat. */
export class Husk extends Enemy {
  readonly kind: EnemyKind = "husk";
  private state: "chase" | "windup" | "lunge" | "recover" = "chase";
  private timer = 0;
  private lungeDir = new THREE.Vector2();
  private struck = false;
  private eyeMat: THREE.MeshStandardMaterial;

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 30;
    this.speed = 3.4;
    this.radius = 0.55;

    const bodyMat = this.stdMat(0x4a1f24, 0x771111, 0.25);
    const boneMat = this.stdMat(0x8a7766);
    this.eyeMat = this.stdMat(0x000000, 0xff4422, 2.5);

    const torso = this.addMesh(new THREE.BoxGeometry(0.8, 0.7, 0.7), bodyMat, 0, 0.75);
    torso.rotation.x = 0.35;
    this.addMesh(new THREE.BoxGeometry(0.5, 0.4, 0.45), bodyMat, 0, 1.15, 0.35); // head
    this.addMesh(new THREE.BoxGeometry(0.1, 0.08, 0.06), this.eyeMat, -0.12, 1.2, 0.59);
    this.addMesh(new THREE.BoxGeometry(0.1, 0.08, 0.06), this.eyeMat, 0.12, 1.2, 0.59);
    // Bone spikes along the back
    for (let i = 0; i < 3; i++) {
      const sp = this.addMesh(new THREE.ConeGeometry(0.09, 0.4 - i * 0.07, 4), boneMat, 0, 1.05 - i * 0.2, -0.25 - i * 0.16);
      sp.rotation.x = -0.5;
    }
    this.addMesh(new THREE.BoxGeometry(0.22, 0.5, 0.25), bodyMat, -0.25, 0.25, 0);
    this.addMesh(new THREE.BoxGeometry(0.22, 0.5, 0.25), bodyMat, 0.25, 0.25, 0);
  }

  protected deathColor(): number {
    return 0xff4422;
  }

  protected tick(dt: number): void {
    const p = this.ctx.player;
    this.timer -= dt;
    this.pos.y = Math.abs(Math.sin(this.t * 5)) * 0.07 * (this.state === "chase" ? 1 : 0);

    switch (this.state) {
      case "chase": {
        const d = this.seek(p.pos.x, p.pos.z, dt);
        if (d < 2.4) {
          this.state = "windup";
          this.timer = 0.45;
          this.struck = false;
          const dx = p.pos.x - this.pos.x;
          const dz = p.pos.z - this.pos.z;
          const len = Math.hypot(dx, dz) || 1;
          this.lungeDir.set(dx / len, dz / len);
          // Covers the lunge's moving strike zone (~1.75 around the husk over ~2.2m travel)
          this.ctx.tele.circle(this.pos.x + this.lungeDir.x * 1.5, this.pos.z + this.lungeDir.y * 1.5, 1.7, 0.45);
          this.eyeMat.emissiveIntensity = 5;
        }
        break;
      }
      case "windup":
        this.facePlayer(dt);
        if (this.timer <= 0) {
          this.state = "lunge";
          this.timer = 0.22;
          this.kb.x += this.lungeDir.x * 13;
          this.kb.y += this.lungeDir.y * 13;
          this.ctx.sfx.enemyLunge();
        }
        break;
      case "lunge":
        if (!this.struck && this.distToPlayer() < this.radius + p.radius + 0.7) {
          this.struck = true;
          this.ctx.combat.damagePlayer(12, this.pos.x, this.pos.z);
        }
        if (this.timer <= 0) {
          this.state = "recover";
          this.timer = 0.75;
          this.eyeMat.emissiveIntensity = 2.5;
        }
        break;
      case "recover":
        if (this.timer <= 0) this.state = "chase";
        break;
    }
  }
}

// ---------------------------------------------------------------- Spitter
/** Ranged kiter. Keeps distance, lobs glowing bolts on a visible windup. */
export class Spitter extends Enemy {
  readonly kind: EnemyKind = "spitter";
  private fireTimer = 1.6;
  private windup = -1;
  private orb: THREE.Mesh;
  private orbMat: THREE.MeshStandardMaterial;
  private strafeDir = Math.random() < 0.5 ? 1 : -1;

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 22;
    this.speed = 2.6;
    this.radius = 0.5;

    const robeMat = this.stdMat(0x1c2a4a, 0x223a88, 0.3);
    this.orbMat = this.stdMat(0x113355, 0x44aaff, 2.2);
    this.addMesh(new THREE.ConeGeometry(0.5, 1.5, 6), robeMat, 0, 0.75);
    this.addMesh(new THREE.SphereGeometry(0.22, 8, 6), robeMat, 0, 1.62);
    this.orb = this.addMesh(new THREE.SphereGeometry(0.16, 10, 8), this.orbMat, 0, 1.25, 0.55);
  }

  protected deathColor(): number {
    return 0x44aaff;
  }

  protected tick(dt: number): void {
    const p = this.ctx.player;
    const d = this.distToPlayer();
    this.facePlayer(dt);
    this.pos.y = Math.sin(this.t * 2.2) * 0.08;
    this.orb.position.y = 1.25 + Math.sin(this.t * 3.1) * 0.08;

    // Kite band 8–12, strafe inside it
    if (this.windup < 0) {
      if (d < 7.5) this.seek(this.pos.x * 2 - p.pos.x, this.pos.z * 2 - p.pos.z, dt, 0.9);
      else if (d > 12) this.seek(p.pos.x, p.pos.z, dt);
      else {
        const ang = Math.atan2(this.pos.x - p.pos.x, this.pos.z - p.pos.z) + this.strafeDir * 0.5 * dt;
        const tx = p.pos.x + Math.sin(ang) * d;
        const tz = p.pos.z + Math.cos(ang) * d;
        this.seek(tx, tz, dt, 0.55);
        if (Math.random() < dt * 0.2) this.strafeDir *= -1;
      }
      this.fireTimer -= dt;
      if (this.fireTimer <= 0 && d < 16) {
        this.windup = 0.38;
        this.fireTimer = 2.3;
      }
    } else {
      this.windup -= dt;
      this.orbMat.emissiveIntensity = 2.2 + (0.38 - this.windup) * 9;
      this.orb.scale.setScalar(1 + (0.38 - this.windup) * 1.6);
      if (this.windup <= 0) {
        this.windup = -1;
        this.orbMat.emissiveIntensity = 2.2;
        this.orb.scale.setScalar(1);
        const ang = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
        this.ctx.hostiles.fire(this.pos.x, this.pos.z, ang, { speed: 9, dmg: 8, color: 0x55bbff, radius: 0.3 });
        this.ctx.sfx.enemyShoot();
      }
    }
  }
}

// ---------------------------------------------------------------- Swarmer
/** Tiny, fast, jittery. Dangerous in packs, dies to anything. */
export class Swarmer extends Enemy {
  readonly kind: EnemyKind = "swarmer";
  private phase = Math.random() * TAU;

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 12;
    this.speed = 5.4;
    this.radius = 0.35;
    this.contactDmg = 6;

    const bodyMat = this.stdMat(0x3a1410, 0xff5511, 0.8);
    this.addMesh(new THREE.IcosahedronGeometry(0.32, 0), bodyMat, 0, 0.4);
    const spikeMat = this.stdMat(0x221111);
    for (let i = 0; i < 3; i++) {
      const sp = this.addMesh(new THREE.ConeGeometry(0.05, 0.3, 4), spikeMat, 0, 0.62, 0);
      sp.rotation.z = (i - 1) * 0.5;
      sp.position.x = (i - 1) * 0.14;
    }
  }

  protected deathColor(): number {
    return 0xff7733;
  }

  protected barHeight(): number {
    return 1.1;
  }

  protected tick(dt: number): void {
    const p = this.ctx.player;
    // Perpendicular jitter sells "swarm"
    const dx = p.pos.x - this.pos.x;
    const dz = p.pos.z - this.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const jit = Math.sin(this.t * 6 + this.phase) * 0.8;
    const tx = p.pos.x + (-dz / d) * jit;
    const tz = p.pos.z + (dx / d) * jit;
    this.seek(tx, tz, dt);
    this.pos.y = Math.abs(Math.sin(this.t * 9 + this.phase)) * 0.12;
    this.tryContactDamage();
  }
}

// ---------------------------------------------------------------- Bomber
/** Sprints in, lights a fuse, erases a chunk of arena. Kill it early — it detonates either way. */
export class Bomber extends Enemy {
  readonly kind: EnemyKind = "bomber";
  private fuse = -1;
  private coreMat: THREE.MeshStandardMaterial;
  private exploded = false;

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 18;
    this.speed = 4.3;
    this.radius = 0.5;

    const shellMat = this.stdMat(0x33231a, 0x331100, 0.2);
    this.coreMat = this.stdMat(0x441100, 0xff6600, 1.6);
    this.addMesh(new THREE.SphereGeometry(0.5, 10, 8), shellMat, 0, 0.55);
    this.addMesh(new THREE.SphereGeometry(0.3, 8, 6), this.coreMat, 0, 0.85, 0.15);
    this.addMesh(new THREE.ConeGeometry(0.08, 0.3, 4), this.coreMat, 0, 1.15, 0.15);
  }

  protected deathColor(): number {
    return 0xff8800;
  }

  protected onDeath(): void {
    // A lit fuse always pays off
    if (this.fuse >= 0) this.explode();
  }

  private explode(): void {
    if (this.exploded) return;
    this.exploded = true;
    const R = 3.6;
    this.ctx.events.emit("EXPLOSION", { x: this.pos.x, z: this.pos.z, radius: R });
    this.ctx.fx.burst({
      x: this.pos.x, y: 0.7, z: this.pos.z,
      count: 45, color: [0xff8800, 0xffcc44, 0xff4400],
      speed: [4, 14], up: 0.8, size: [0.6, 1.4], life: [0.35, 0.9], gravity: -7, drag: 2.2,
    });
    this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: R, color: 0xff8800, duration: 0.5 });
    this.ctx.cam.addTrauma(0.4);
    this.ctx.sfx.explosion();
    if (this.distToPlayer() < R + this.ctx.player.radius) {
      this.ctx.combat.damagePlayer(22, this.pos.x, this.pos.z);
    }
    // Splash hits other enemies too — bait potential
    for (const e of this.ctx.enemies.living()) {
      if (e === (this as Enemy)) continue;
      const dd = Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z);
      if (dd < R) this.ctx.combat.dealDamage(e, 20, { kbX: e.pos.x - this.pos.x, kbZ: e.pos.z - this.pos.z, kb: 6, heavy: true });
    }
  }

  protected tick(dt: number): void {
    const p = this.ctx.player;
    if (this.fuse < 0) {
      const d = this.seek(p.pos.x, p.pos.z, dt);
      this.pos.y = Math.abs(Math.sin(this.t * 7)) * 0.1;
      if (d < 3.0) {
        this.fuse = 0.95;
        this.ctx.tele.circle(this.pos.x, this.pos.z, 3.6, 0.95, 0xff8822);
        this.ctx.sfx.fuse();
      }
    } else {
      this.fuse -= dt;
      this.seek(p.pos.x, p.pos.z, dt, 0.3);
      const k = 1 - Math.max(0, this.fuse) / 0.95;
      this.coreMat.emissiveIntensity = 1.6 + k * 7 + Math.sin(this.t * (10 + k * 40)) * 1.5;
      this.root.scale.setScalar(1 + k * 0.25);
      if (this.fuse <= 0) {
        this.explode();
        this.die();
      }
    }
  }
}

// ---------------------------------------------------------------- Sentinel
/** Slow armored artillery. Locks a beam line, then fires a hitscan lance. */
export class Sentinel extends Enemy {
  readonly kind: EnemyKind = "sentinel";
  private cycle = 2.2;
  private aiming = -1;
  private lockedAngle = 0;
  private tipMat: THREE.MeshStandardMaterial;
  private beamMesh: THREE.Mesh;
  private beamMat: THREE.MeshBasicMaterial;
  private beamFade = 0;

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 60;
    this.speed = 1.7;
    this.radius = 0.7;

    const armorMat = this.stdMat(0x2a2a3a, 0x222244, 0.3);
    const trimMat = this.stdMat(0x55456a, 0x8844ff, 0.7);
    this.tipMat = this.stdMat(0x221133, 0xbb66ff, 2.0);

    this.addMesh(new THREE.CylinderGeometry(0.55, 0.75, 1.5, 6), armorMat, 0, 0.75);
    // Trim must protrude well past the tapered body (r≈0.62 at this height)
    // or the coincident walls shimmer.
    this.addMesh(new THREE.CylinderGeometry(0.72, 0.72, 0.18, 6), trimMat, 0, 1.0);
    this.addMesh(new THREE.SphereGeometry(0.3, 8, 6), armorMat, 0, 1.75);
    // Lance
    this.addMesh(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 6), trimMat, 0.55, 1.3, 0).rotation.x = Math.PI / 2;
    this.addMesh(new THREE.ConeGeometry(0.12, 0.4, 6), this.tipMat, 0.55, 1.3, 0.95).rotation.x = Math.PI / 2;

    this.beamMat = new THREE.MeshBasicMaterial({
      color: 0xbb66ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.beamMesh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 1), this.beamMat);
    this.beamMesh.visible = false;
    ctx.stage.scene.add(this.beamMesh);
  }

  protected deathColor(): number {
    return 0xbb66ff;
  }

  protected barHeight(): number {
    return 2.4;
  }

  dispose(): void {
    super.dispose();
    this.ctx.stage.scene.remove(this.beamMesh);
    this.beamMesh.geometry.dispose();
    this.beamMat.dispose();
  }

  freeze(duration: number): void {
    super.freeze(duration);
    // Cancel any in-progress aim — thawing into an instant un-telegraphed
    // beam would read as unfair.
    if (this.aiming >= 0) {
      this.aiming = -1;
      this.tipMat.emissiveIntensity = 2;
      this.cycle = Math.max(this.cycle, 1.5);
    }
  }

  protected tick(dt: number): void {
    const p = this.ctx.player;
    this.beamFade = Math.max(0, this.beamFade - dt * 5);
    this.beamMat.opacity = this.beamFade;
    this.beamMesh.visible = this.beamFade > 0;

    if (this.aiming < 0) {
      this.facePlayer(dt);
      const d = this.distToPlayer();
      if (d > 11) this.seek(p.pos.x, p.pos.z, dt);
      else if (d < 6) this.seek(this.pos.x * 2 - p.pos.x, this.pos.z * 2 - p.pos.z, dt, 0.7);
      this.cycle -= dt;
      if (this.cycle <= 0 && d < 17) {
        this.aiming = 1.25;
        this.cycle = 4.6;
      }
    } else {
      const prev = this.aiming;
      this.aiming -= dt;
      // Track until lock at 0.45s remaining, then the line is committed — dodge it
      if (this.aiming > 0.45) {
        this.facePlayer(dt * 0.6);
        this.lockedAngle = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
      }
      if (prev > 0.45 && this.aiming <= 0.45) {
        // Width matches the real hit window: 0.55 beam half-width + player radius
        this.ctx.tele.line(this.pos.x, this.pos.z, this.lockedAngle, 17, 2.0, 0.45, 0xbb66ff);
        this.ctx.sfx.beamCharge();
      }
      this.tipMat.emissiveIntensity = 2 + (1.25 - this.aiming) * 6;
      if (this.aiming <= 0) {
        this.aiming = -1;
        this.tipMat.emissiveIntensity = 2;
        this.fireBeam();
      }
    }
  }

  private fireBeam(): void {
    const p = this.ctx.player;
    const len = 17;
    const sx = Math.sin(this.lockedAngle);
    const cz = Math.cos(this.lockedAngle);
    // Visual beam — widened so the rendered lance matches the telegraphed lane
    this.beamMesh.scale.set(2.4, 2.4, len);
    this.beamMesh.position.set(this.pos.x + sx * len * 0.5, 1.1, this.pos.z + cz * len * 0.5);
    this.beamMesh.rotation.y = this.lockedAngle;
    this.beamFade = 0.9;
    this.ctx.fx.burst({
      x: this.pos.x + sx * 1.2, y: 1.2, z: this.pos.z + cz * 1.2,
      count: 14, color: 0xbb66ff, speed: [3, 9], up: 0.4, size: [0.3, 0.7], life: [0.2, 0.4], gravity: -3, drag: 3,
    });
    this.ctx.sfx.beamFire();
    this.ctx.cam.addTrauma(0.15);
    // Hitscan: perpendicular distance from player to the beam segment
    const px = p.pos.x - this.pos.x;
    const pz = p.pos.z - this.pos.z;
    const along = px * sx + pz * cz;
    if (along > 0 && along < len) {
      const perp = Math.abs(px * cz - pz * sx);
      if (perp < 0.55 + p.radius) {
        this.ctx.combat.damagePlayer(16, this.pos.x, this.pos.z);
      }
    }
  }
}

// ---------------------------------------------------------------- Manager
interface PendingSpawn {
  kind: EnemyKind;
  x: number;
  z: number;
  timer: number;
  make?: (ctx: Ctx, x: number, z: number) => Enemy;
}

type EnemyCtor = new (ctx: Ctx, x: number, z: number) => Enemy;

/**
 * Mutable registry so additional rosters (enemies2.ts) can register without
 * a circular import — main.ts imports them once for the side effect.
 */
const REGISTRY = new Map<Exclude<EnemyKind, "boss">, EnemyCtor>([
  ["husk", Husk],
  ["spitter", Spitter],
  ["swarmer", Swarmer],
  ["bomber", Bomber],
  ["sentinel", Sentinel],
]);

export function registerEnemy(kind: Exclude<EnemyKind, "boss">, ctor: EnemyCtor): void {
  REGISTRY.set(kind, ctor);
}

export function makeEnemy(kind: Exclude<EnemyKind, "boss">, ctx: Ctx, x: number, z: number): Enemy {
  const ctor = REGISTRY.get(kind);
  if (!ctor) throw new Error(`Enemy kind not registered: ${kind}`);
  return new ctor(ctx, x, z);
}

export class EnemyManager {
  private enemies: Enemy[] = [];
  private pending: PendingSpawn[] = [];
  private streakCount = 0;
  private streakTimer = 0;

  constructor(private ctx: Ctx) {
    ctx.events.on("KILL", () => {
      ctx.stats.kills++;
      this.streakCount++;
      this.streakTimer = 2.6;
      if (this.streakCount >= 3) {
        this.ctx.events.emit("KILL_STREAK", { count: this.streakCount });
        if (this.streakCount > ctx.stats.bestStreak) ctx.stats.bestStreak = this.streakCount;
      }
    });
  }

  /** Telegraphed spawn: warning ring, then the enemy erupts from the floor. */
  spawn(kind: Exclude<EnemyKind, "boss">, x: number, z: number, delay = 0.8): void {
    this.pending.push({ kind, x, z, timer: delay });
    this.ctx.tele.circle(x, z, 1.0, delay, 0xffffff);
  }

  /** Direct spawn for custom enemies (boss adds, etc.). */
  spawnCustom(make: (ctx: Ctx, x: number, z: number) => Enemy, x: number, z: number, delay = 0.8): void {
    this.pending.push({ kind: "boss", x, z, timer: delay, make });
    this.ctx.tele.circle(x, z, 1.4, delay, 0xff5533);
  }

  add(e: Enemy): void {
    this.enemies.push(e);
  }

  living(): Enemy[] {
    return this.enemies.filter((e) => e.alive);
  }

  get remaining(): number {
    return this.living().length + this.pending.length;
  }

  freezeAll(duration: number): void {
    for (const e of this.living()) e.freeze(duration);
    this.ctx.events.emit("FREEZE", {});
  }

  clear(): void {
    for (const e of this.enemies) if (e.alive) e.dispose();
    this.enemies = [];
    this.pending = [];
    this.streakCount = 0;
  }

  update(dt: number): void {
    this.streakTimer -= dt;
    if (this.streakTimer <= 0) this.streakCount = 0;

    for (let i = this.pending.length - 1; i >= 0; i--) {
      const s = this.pending[i];
      s.timer -= dt;
      if (s.timer <= 0) {
        this.pending.splice(i, 1);
        const e = s.make ? s.make(this.ctx, s.x, s.z) : makeEnemy(s.kind as Exclude<EnemyKind, "boss">, this.ctx, s.x, s.z);
        this.enemies.push(e);
        this.ctx.fx.burst({
          x: s.x, y: 0.4, z: s.z,
          count: 16, color: 0xddddff, speed: [2, 7], up: 1.2, size: [0.3, 0.7], life: [0.25, 0.5], gravity: -6, drag: 3,
        });
        this.ctx.sfx.spawn();
      }
    }

    for (const e of this.enemies) e.update(dt);
    this.enemies = this.enemies.filter((e) => e.alive);

    // Soft separation so packs don't merge into one blob
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        const min = a.radius + b.radius;
        if (d > 0.001 && d < min) {
          const push = ((min - d) / d) * 0.5;
          a.pos.x -= dx * push;
          a.pos.z -= dz * push;
          b.pos.x += dx * push;
          b.pos.z += dz * push;
        }
      }
    }
  }
}
