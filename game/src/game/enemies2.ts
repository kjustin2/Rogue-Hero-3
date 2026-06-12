import * as THREE from "three";
import { ARENA_RADIUS } from "../render/arena";
import { Enemy, registerEnemy, type EnemyKind, type DamageOpts } from "./enemies";
import type { Ctx } from "./ctx";

/**
 * Act II/III roster. Same contract as the base set: every attack telegraphs,
 * damage flows through combat.damagePlayer, resources are owned + disposed.
 * Registered into the EnemyManager constructor registry at the bottom;
 * main.ts imports this module once for the side effect.
 */

// ---------------------------------------------------------------- Wisp
/** Hovering glass mote. Paper HP, lazy orbits, slow glowing bolts. */
export class Wisp extends Enemy {
  readonly kind: EnemyKind = "wisp";
  private fireTimer = 2.2;
  private windup = -1;
  private lockedAngle = 0;
  private orbMat: THREE.MeshStandardMaterial;
  private strafeDir = Math.random() < 0.5 ? 1 : -1;

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 10;
    this.speed = 3.0;
    this.radius = 0.42;

    this.orbMat = this.stdMat(0x0a2a24, 0x3effd2, 2.4);
    const shellMat = this.stdMat(0x10312a, 0x1a8a70, 0.5);
    this.addMesh(new THREE.IcosahedronGeometry(0.34, 1), this.orbMat, 0, 0);
    const halo = this.addMesh(new THREE.TorusGeometry(0.52, 0.045, 8, 24), shellMat, 0, 0);
    halo.rotation.x = Math.PI / 2;
  }

  protected deathColor(): number {
    return 0x3effd2;
  }

  protected barHeight(): number {
    return 0.9;
  }

  protected tick(dt: number): void {
    const p = this.ctx.player;
    // Hover: the whole body floats — melee still connects (sweeps are 2D),
    // which is the intended balance against its paper HP.
    this.pos.y = 1.25 + Math.sin(this.t * 2.6) * 0.18;
    this.facePlayer(dt);

    const d = this.distToPlayer();
    if (this.windup < 0) {
      if (d < 7) this.seek(this.pos.x * 2 - p.pos.x, this.pos.z * 2 - p.pos.z, dt, 0.8);
      else if (d > 11.5) this.seek(p.pos.x, p.pos.z, dt);
      else {
        const ang = Math.atan2(this.pos.x - p.pos.x, this.pos.z - p.pos.z) + this.strafeDir * 0.4 * dt;
        this.seek(p.pos.x + Math.sin(ang) * d, p.pos.z + Math.cos(ang) * d, dt, 0.5);
        if (Math.random() < dt * 0.25) this.strafeDir *= -1;
      }
      this.fireTimer -= dt;
      if (this.fireTimer <= 0 && d < 15) {
        this.windup = 0.4;
        this.fireTimer = 2.8;
        this.lockedAngle = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
        this.ctx.tele.line(this.pos.x, this.pos.z, this.lockedAngle, 5, 0.9, 0.4, 0x3effd2);
      }
    } else {
      this.windup -= dt;
      this.orbMat.emissiveIntensity = 2.4 + (0.4 - this.windup) * 8;
      if (this.windup <= 0) {
        this.windup = -1;
        this.orbMat.emissiveIntensity = 2.4;
        this.ctx.hostiles.fire(this.pos.x, this.pos.z, this.lockedAngle, {
          speed: 6.5, dmg: 7, color: 0x3effd2, radius: 0.32, y: 1.1,
        });
        this.ctx.sfx.enemyShoot();
      }
    }
  }
}

// ---------------------------------------------------------------- Leaper
/** Stalks, crouches, then leaps to where you're GOING. Keep changing direction. */
export class Leaper extends Enemy {
  readonly kind: EnemyKind = "leaper";
  private state: "stalk" | "crouch" | "leap" | "recover" = "stalk";
  private timer = 0;
  private leapFrom = new THREE.Vector3();
  private leapTo = new THREE.Vector3();
  private leapT = 0;
  private playerVel = new THREE.Vector2();
  private lastPlayer = new THREE.Vector2();
  private eyeMat: THREE.MeshStandardMaterial;

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 26;
    this.speed = 4.0;
    this.radius = 0.55;

    const bodyMat = this.stdMat(0x2a1535, 0x551177, 0.4);
    const clawMat = this.stdMat(0x1a0d22);
    this.eyeMat = this.stdMat(0x000000, 0xff44ff, 2.6);

    const torso = this.addMesh(new THREE.BoxGeometry(0.7, 0.5, 0.95), bodyMat, 0, 0.5);
    torso.rotation.x = -0.2;
    this.addMesh(new THREE.BoxGeometry(0.45, 0.35, 0.4), bodyMat, 0, 0.72, 0.55);
    this.addMesh(new THREE.BoxGeometry(0.09, 0.07, 0.05), this.eyeMat, -0.11, 0.78, 0.76);
    this.addMesh(new THREE.BoxGeometry(0.09, 0.07, 0.05), this.eyeMat, 0.11, 0.78, 0.76);
    // Haunches
    const hl = this.addMesh(new THREE.ConeGeometry(0.22, 0.7, 4), clawMat, -0.35, 0.4, -0.25);
    hl.rotation.z = 0.5;
    const hr = this.addMesh(new THREE.ConeGeometry(0.22, 0.7, 4), clawMat, 0.35, 0.4, -0.25);
    hr.rotation.z = -0.5;
    this.lastPlayer.set(ctx.player.pos.x, ctx.player.pos.z);
  }

  protected deathColor(): number {
    return 0xcc55ff;
  }

  protected tick(dt: number): void {
    const p = this.ctx.player;
    this.timer -= dt;
    // Smoothed player velocity estimate for leap prediction
    const vx = (p.pos.x - this.lastPlayer.x) / Math.max(dt, 0.001);
    const vz = (p.pos.z - this.lastPlayer.y) / Math.max(dt, 0.001);
    this.playerVel.x += (vx - this.playerVel.x) * Math.min(1, dt * 8);
    this.playerVel.y += (vz - this.playerVel.y) * Math.min(1, dt * 8);
    this.lastPlayer.set(p.pos.x, p.pos.z);

    switch (this.state) {
      case "stalk": {
        const d = this.seek(p.pos.x, p.pos.z, dt);
        this.pos.y = Math.abs(Math.sin(this.t * 6)) * 0.08;
        if (d < 8 && this.timer <= 0) {
          this.state = "crouch";
          this.timer = 0.5;
          this.eyeMat.emissiveIntensity = 6;
        }
        break;
      }
      case "crouch": {
        this.facePlayer(dt);
        this.root.scale.y = 0.75 + (this.timer / 0.5) * 0.25;
        if (this.timer <= 0) {
          this.root.scale.y = 1;
          // Lead the player — clamped into the arena
          let tx = p.pos.x + this.playerVel.x * 0.55;
          let tz = p.pos.z + this.playerVel.y * 0.55;
          const r = Math.hypot(tx, tz);
          const maxR = ARENA_RADIUS - 1.5;
          if (r > maxR) {
            tx *= maxR / r;
            tz *= maxR / r;
          }
          this.leapFrom.copy(this.pos);
          this.leapTo.set(tx, 0, tz);
          this.leapT = 0;
          this.state = "leap";
          this.ctx.tele.circle(tx, tz, 2.2, 0.55, 0xcc55ff);
          this.ctx.sfx.enemyLunge();
        }
        break;
      }
      case "leap": {
        this.leapT += dt / 0.55;
        const k = Math.min(1, this.leapT);
        this.pos.x = this.leapFrom.x + (this.leapTo.x - this.leapFrom.x) * k;
        this.pos.z = this.leapFrom.z + (this.leapTo.z - this.leapFrom.z) * k;
        this.pos.y = Math.sin(k * Math.PI) * 2.6;
        this.heading = Math.atan2(this.leapTo.x - this.leapFrom.x, this.leapTo.z - this.leapFrom.z);
        if (k >= 1) {
          this.pos.y = 0;
          this.state = "recover";
          this.timer = 0.9;
          this.eyeMat.emissiveIntensity = 2.6;
          this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: 2.2, color: 0xcc55ff, duration: 0.4 });
          this.ctx.fx.burst({
            x: this.pos.x, y: 0.4, z: this.pos.z,
            count: 16, color: [0xcc55ff, 0x885599],
            speed: [2, 8], up: 0.7, size: [0.35, 0.8], life: [0.2, 0.5], gravity: -6, drag: 3,
          });
          if (Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) < 2.2 + p.radius) {
            this.ctx.combat.damagePlayer(14, this.pos.x, this.pos.z);
          }
        }
        break;
      }
      case "recover":
        if (this.timer <= 0) {
          this.state = "stalk";
          this.timer = 0.6;
        }
        break;
    }
  }
}

// ---------------------------------------------------------------- Tether
/** Kiting crystal — locks three telegraphed lanes, then fires the fan. */
export class Tether extends Enemy {
  readonly kind: EnemyKind = "tether";
  private volleyTimer = 2.0;
  private windup = -1;
  private lockedAngles: number[] = [];
  private crystal: THREE.Mesh;
  private crystalMat: THREE.MeshStandardMaterial;
  private strafeDir = Math.random() < 0.5 ? 1 : -1;

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 24;
    this.speed = 2.4;
    this.radius = 0.5;

    const robeMat = this.stdMat(0x132e3a, 0x115566, 0.4);
    this.crystalMat = this.stdMat(0x0a2030, 0x55bbff, 2.0);
    this.addMesh(new THREE.ConeGeometry(0.5, 1.4, 5), robeMat, 0, 0.7);
    this.crystal = this.addMesh(new THREE.OctahedronGeometry(0.28), this.crystalMat, 0, 1.8);
  }

  protected deathColor(): number {
    return 0x55bbff;
  }

  protected tick(dt: number): void {
    const p = this.ctx.player;
    const d = this.distToPlayer();
    this.facePlayer(dt);
    this.crystal.rotation.y += dt * 2.2;
    this.crystal.position.y = 1.8 + Math.sin(this.t * 2.4) * 0.1;

    if (this.windup < 0) {
      if (d < 8.5) this.seek(this.pos.x * 2 - p.pos.x, this.pos.z * 2 - p.pos.z, dt, 0.85);
      else if (d > 13) this.seek(p.pos.x, p.pos.z, dt);
      else {
        const ang = Math.atan2(this.pos.x - p.pos.x, this.pos.z - p.pos.z) + this.strafeDir * 0.45 * dt;
        this.seek(p.pos.x + Math.sin(ang) * d, p.pos.z + Math.cos(ang) * d, dt, 0.5);
        if (Math.random() < dt * 0.2) this.strafeDir *= -1;
      }
      this.volleyTimer -= dt;
      if (this.volleyTimer <= 0 && d < 15) {
        this.windup = 0.45;
        this.volleyTimer = 3.2;
        const aim = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
        this.lockedAngles = [aim - 0.35, aim, aim + 0.35];
        for (const a of this.lockedAngles) {
          this.ctx.tele.line(this.pos.x, this.pos.z, a, 10, 1.0, 0.45, 0x55bbff);
        }
      }
    } else {
      this.windup -= dt;
      this.crystalMat.emissiveIntensity = 2 + (0.45 - this.windup) * 8;
      if (this.windup <= 0) {
        this.windup = -1;
        this.crystalMat.emissiveIntensity = 2;
        for (const a of this.lockedAngles) {
          this.ctx.hostiles.fire(this.pos.x, this.pos.z, a, { speed: 10, dmg: 7, color: 0x55bbff, radius: 0.28 });
        }
        this.ctx.sfx.enemyShoot();
      }
    }
  }
}

// ---------------------------------------------------------------- Mirror
/** Walking bulwark. At half HP it raises an unbreakable mirror — disengage or burn cards. */
export class Mirror extends Enemy {
  readonly kind: EnemyKind = "mirror";
  private state: "walk" | "windup" | "recover" = "walk";
  private timer = 0;
  private slamX = 0;
  private slamZ = 0;
  private shieldTimer = 0;
  private shieldUsed = false;
  private bubble: THREE.Mesh;
  private bubbleMat: THREE.MeshBasicMaterial;

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 80;
    this.speed = 2.0;
    this.radius = 0.7;

    const plateMat = this.stdMat(0x39414f, 0x4a6a8a, 0.5);
    const trimMat = this.stdMat(0x222831, 0x99ccff, 0.9);
    this.addMesh(new THREE.BoxGeometry(1.2, 1.5, 0.9), plateMat, 0, 0.95);
    this.addMesh(new THREE.BoxGeometry(0.6, 0.45, 0.5), plateMat, 0, 1.9);
    this.addMesh(new THREE.BoxGeometry(1.34, 0.16, 1.0), trimMat, 0, 1.62);
    // Tower-shield arms
    this.addMesh(new THREE.BoxGeometry(0.22, 1.2, 0.7), trimMat, -0.78, 0.95, 0.15);
    this.addMesh(new THREE.BoxGeometry(0.22, 1.2, 0.7), trimMat, 0.78, 0.95, 0.15);
    this.addMesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), plateMat, -0.45, 0.25, 0);
    this.addMesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), plateMat, 0.45, 0.25, 0);

    this.bubbleMat = new THREE.MeshBasicMaterial({
      color: 0x99ddff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
    });
    this.bubble = new THREE.Mesh(new THREE.SphereGeometry(1.5, 18, 12), this.bubbleMat);
    this.bubble.position.y = 1.1;
    this.root.add(this.bubble);
  }

  protected deathColor(): number {
    return 0x99ccff;
  }

  protected barHeight(): number {
    return 2.5;
  }

  takeDamage(amount: number, opts: DamageOpts = {}): boolean {
    if (this.shieldTimer > 0) {
      // Mirror is up — damage glances off
      this.ctx.fx.burst({
        x: this.pos.x, y: 1.2, z: this.pos.z,
        count: 6, color: 0x99ddff, speed: [2, 5], up: 0.6, size: [0.3, 0.55], life: [0.15, 0.3], gravity: -2, drag: 3,
      });
      this.ctx.floaters.spawn(this.pos.x, 1.9, this.pos.z, "IMMUNE", "label");
      this.ctx.sfx.shieldHit();
      return false;
    }
    const killed = super.takeDamage(amount, opts);
    if (!killed && !this.shieldUsed && this.hp <= this.maxHp * 0.5) {
      this.shieldUsed = true;
      this.shieldTimer = 3.5;
      this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: 2.4, color: 0x99ddff, duration: 0.5 });
      this.ctx.sfx.shieldHit();
    }
    return killed;
  }

  protected tick(dt: number): void {
    const p = this.ctx.player;
    this.timer -= dt;
    if (this.shieldTimer > 0) {
      this.shieldTimer -= dt;
      this.bubbleMat.opacity = Math.min(0.3, this.shieldTimer);
      this.bubble.rotation.y += dt;
    } else {
      this.bubbleMat.opacity = Math.max(0, this.bubbleMat.opacity - dt * 2);
    }

    switch (this.state) {
      case "walk": {
        const d = this.seek(p.pos.x, p.pos.z, dt);
        if (d < 2.6) {
          this.state = "windup";
          this.timer = 0.6;
          const fx = Math.sin(this.heading);
          const fz = Math.cos(this.heading);
          this.slamX = this.pos.x + fx * 1.3;
          this.slamZ = this.pos.z + fz * 1.3;
          this.ctx.tele.circle(this.slamX, this.slamZ, 2.0, 0.6, 0x99ccff);
        }
        break;
      }
      case "windup":
        if (this.timer <= 0) {
          this.ctx.fx.ring(this.slamX, this.slamZ, { radius: 2.0, color: 0x99ccff, duration: 0.35 });
          this.ctx.cam.addTrauma(0.15);
          this.ctx.sfx.bossSlam();
          if (Math.hypot(p.pos.x - this.slamX, p.pos.z - this.slamZ) < 2.0 + p.radius) {
            this.ctx.combat.damagePlayer(16, this.pos.x, this.pos.z);
          }
          this.state = "recover";
          this.timer = 1.1;
        }
        break;
      case "recover":
        if (this.timer <= 0) this.state = "walk";
        break;
    }
  }
}

// ---------------------------------------------------------------- Caster
/** Blink-away artillerist. Marks your position and detonates it — keep moving. */
export class Caster extends Enemy {
  readonly kind: EnemyKind = "caster";
  private castTimer = 1.6;
  private blinkCd = 0;
  private pendingBlast: { x: number; z: number; timer: number } | null = null;
  private orbMat: THREE.MeshStandardMaterial;
  private orb: THREE.Mesh;

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 22;
    this.speed = 1.6;
    this.radius = 0.55;

    const robeMat = this.stdMat(0x33150e, 0x882211, 0.5);
    this.orbMat = this.stdMat(0x331505, 0xff7733, 2.2);
    this.addMesh(new THREE.ConeGeometry(0.55, 1.6, 6), robeMat, 0, 0.8);
    this.addMesh(new THREE.SphereGeometry(0.24, 8, 6), robeMat, 0, 1.75);
    this.orb = this.addMesh(new THREE.SphereGeometry(0.2, 10, 8), this.orbMat, 0.45, 1.5, 0.25);
  }

  protected deathColor(): number {
    return 0xff7733;
  }

  protected tick(dt: number): void {
    const p = this.ctx.player;
    this.facePlayer(dt);
    this.blinkCd -= dt;
    this.orb.position.y = 1.5 + Math.sin(this.t * 3) * 0.1;

    // Blink away when crowded
    if (this.distToPlayer() < 4 && this.blinkCd <= 0) {
      this.blinkCd = 2.2;
      const fromX = this.pos.x;
      const fromZ = this.pos.z;
      const away = Math.atan2(this.pos.x - p.pos.x, this.pos.z - p.pos.z) + this.ctx.rng.range(-0.7, 0.7);
      let tx = this.pos.x + Math.sin(away) * 8;
      let tz = this.pos.z + Math.cos(away) * 8;
      const r = Math.hypot(tx, tz);
      const maxR = ARENA_RADIUS - 2;
      if (r > maxR) {
        tx *= maxR / r;
        tz *= maxR / r;
      }
      this.pos.x = tx;
      this.pos.z = tz;
      for (const [bx, bz] of [[fromX, fromZ], [tx, tz]] as const) {
        this.ctx.fx.burst({
          x: bx, y: 1, z: bz,
          count: 12, color: 0xff7733, speed: [1, 5], up: 0.7, size: [0.3, 0.6], life: [0.2, 0.45], gravity: -1, drag: 3,
        });
      }
      this.ctx.sfx.spawn();
    } else {
      // Slow reposition drift
      const drift = Math.sin(this.t * 0.7) * 4;
      this.seek(p.pos.x + Math.sin(this.t * 0.5) * 9, p.pos.z + drift, dt, 0.5);
    }

    // Place a blast on the player's position
    this.castTimer -= dt;
    if (this.castTimer <= 0 && !this.pendingBlast && this.distToPlayer() < 18) {
      this.castTimer = 3.0;
      this.pendingBlast = { x: p.pos.x, z: p.pos.z, timer: 1.0 };
      this.ctx.tele.circle(p.pos.x, p.pos.z, 2.6, 1.0, 0xff7733);
      this.orbMat.emissiveIntensity = 6;
    }
    if (this.pendingBlast) {
      this.pendingBlast.timer -= dt;
      if (this.pendingBlast.timer <= 0) {
        const b = this.pendingBlast;
        this.pendingBlast = null;
        this.orbMat.emissiveIntensity = 2.2;
        this.ctx.fx.ring(b.x, b.z, { radius: 2.6, color: 0xff7733, duration: 0.45 });
        this.ctx.fx.burst({
          x: b.x, y: 0.4, z: b.z,
          count: 26, color: [0xff7733, 0xffcc66],
          speed: [3, 9], up: 1.0, size: [0.4, 0.85], life: [0.25, 0.6], gravity: -5, drag: 2.5,
        });
        this.ctx.sfx.explosion();
        if (Math.hypot(p.pos.x - b.x, p.pos.z - b.z) < 2.6 + p.radius) {
          this.ctx.combat.damagePlayer(13, b.x, b.z);
        }
      }
    }
  }

}

registerEnemy("wisp", Wisp);
registerEnemy("leaper", Leaper);
registerEnemy("tether", Tether);
registerEnemy("mirror", Mirror);
registerEnemy("caster", Caster);
