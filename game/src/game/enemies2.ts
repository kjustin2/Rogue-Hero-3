import * as THREE from "three";
import { forgeGuardian } from "../render/guardianForge";
import { forgeBrute, forgeLeaper } from "../render/beastForge";
import { forgeCaster } from "../render/casterForge";
import { forgeFlier } from "../render/flierForge";
import { forgeWraith } from "../render/wraithForge";
import { forgeSplitter, forgeVoidling } from "../render/broodForge";
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
  private wings: THREE.Group[];
  private strafeDir = this.ctx.rng.next() < 0.5 ? 1 : -1;

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 10;
    this.speed = 3.0;
    this.radius = 0.5;
    this.pos.y = 1.25;
    const rig = forgeFlier(this.root, this.stdMat.bind(this), "wisp");
    this.wings = rig.wings;
    this.orbMat = rig.focusMat;
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
    for (const [i, wing] of this.wings.entries()) {
      const beat = this.windup >= 0 ? 0.45 : 0.16 + Math.sin(this.t * 14) * 0.24;
      wing.rotation.z = (i === 0 ? -1 : 1) * beat;
    }

    const d = this.distToPlayer();
    if (this.windup < 0) {
      if (d < 7) this.seek(this.pos.x * 2 - p.pos.x, this.pos.z * 2 - p.pos.z, dt, 0.8);
      else if (d > 11.5) this.seek(p.pos.x, p.pos.z, dt);
      else {
        const ang = Math.atan2(this.pos.x - p.pos.x, this.pos.z - p.pos.z) + this.strafeDir * 0.4 * dt;
        this.seek(p.pos.x + Math.sin(ang) * d, p.pos.z + Math.cos(ang) * d, dt, 0.5);
        if (this.ctx.rng.next() < dt * 0.25) this.strafeDir *= -1;
      }
      this.fireTimer -= dt;
      if (this.fireTimer <= 0 && d < 15) {
        this.windup = 0.4;
        this.fireTimer = 2.8;
        this.lockedAngle = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
        this.warnLine(this.pos.x, this.pos.z, this.lockedAngle, 5, 0.9, 0.4, 0x3effd2);
      }
    } else {
      this.windup -= dt;
      this.orbMat.emissiveIntensity = 1.1 + (0.4 - this.windup) * 2;
      if (this.windup <= 0) {
        this.windup = -1;
        this.orbMat.emissiveIntensity = 1.1;
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
  private rig: ReturnType<typeof forgeLeaper>;

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 26;
    this.speed = 4.0;
    this.radius = 0.65;
    this.rig = forgeLeaper(this.root, this.stdMat.bind(this));
    this.eyeMat = this.rig.eyes;
    this.lastPlayer.set(ctx.player.pos.x, ctx.player.pos.z);
  }

  protected deathColor(): number {
    return 0xcc55ff;
  }

  protected tick(dt: number): void {
    const p = this.ctx.player;
    this.timer -= dt;
    const crouch = this.state === "crouch", jumping = this.state === "leap";
    this.rig.body.position.y = 0.77 - (crouch ? 0.16 : 0);
    this.rig.body.rotation.x = crouch ? -0.12 : jumping ? 0.17 : 0;
    this.rig.head.rotation.x = crouch ? 0.18 : jumping ? -0.12 : 0;
    for (let i = 0; i < this.rig.legs.length; i++) {
      const target = crouch ? (i < 2 ? -0.28 : 0.45) : jumping ? (i < 2 ? -0.75 : 0.8)
        : this.state === "stalk" ? Math.sin(this.t * 10 + (i === 0 || i === 3 ? 0 : Math.PI)) * 0.4 : 0;
      const leg = this.rig.legs[i];
      leg.rotation.x += (target - leg.rotation.x) * Math.min(1, dt * 18);
    }
    this.eyeMat.emissiveIntensity = crouch ? 1.6 : 1.2;
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
        if (d < 8 && this.timer <= 0 && this.commitMelee(1.2)) {
          this.state = "crouch";
          this.timer = 0.5;
          this.eyeMat.emissiveIntensity = 1.6;
        }
        break;
      }
      case "crouch": {
        this.facePlayer(dt);
        if (this.timer <= 0) {
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
          this.ctx.arena.resolveObstacles(this.leapTo, this.radius);
          tx = this.leapTo.x; tz = this.leapTo.z;
          this.leapT = 0;
          this.state = "leap";
          this.warnCircle(tx, tz, 2.2, 0.55, 0xcc55ff);
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
          this.eyeMat.emissiveIntensity = 1.2;
          this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: 2.2, color: 0xcc55ff, duration: 0.4 });
          this.ctx.fx.burst({
            x: this.pos.x, y: 0.4, z: this.pos.z,
            count: 10, color: [0xba9baf, 0x796879],
            speed: [2, 8], up: 0.7, size: [0.12, 0.3], life: [0.2, 0.5], gravity: -6, drag: 3,
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
  private strafeDir = this.ctx.rng.next() < 0.5 ? 1 : -1;

  private arms: THREE.Group[];

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 24;
    this.speed = 2.4;
    this.radius = 0.5;
    const rig = forgeCaster(this.root, this.stdMat.bind(this), "tether");
    this.arms = rig.arms;
    this.crystal = rig.focus; this.crystalMat = rig.focusMat;
  }

  protected deathColor(): number {
    return 0xffb84d;
  }

  protected tick(dt: number): void {
    const p = this.ctx.player;
    const d = this.distToPlayer();
    this.facePlayer(dt);
    for (const arm of this.arms) arm.rotation.x += ((this.windup >= 0 ? -0.35 : 0) - arm.rotation.x) * Math.min(1, dt * 14);
    this.crystal.rotation.y += dt * 1.1;
    this.crystal.position.y = 1.8 + Math.sin(this.t * 2.4) * 0.1;

    if (this.windup < 0) {
      if (d < 8.5) this.seek(this.pos.x * 2 - p.pos.x, this.pos.z * 2 - p.pos.z, dt, 0.85);
      else if (d > 13) this.seek(p.pos.x, p.pos.z, dt);
      else {
        const ang = Math.atan2(this.pos.x - p.pos.x, this.pos.z - p.pos.z) + this.strafeDir * 0.45 * dt;
        this.seek(p.pos.x + Math.sin(ang) * d, p.pos.z + Math.cos(ang) * d, dt, 0.5);
        if (this.ctx.rng.next() < dt * 0.2) this.strafeDir *= -1;
      }
      this.volleyTimer -= dt;
      if (this.volleyTimer <= 0 && d < 15) {
        this.windup = 0.45;
        this.volleyTimer = 3.2;
        const aim = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
        this.lockedAngles = [aim - 0.35, aim, aim + 0.35];
        for (const a of this.lockedAngles) {
          this.warnLine(this.pos.x, this.pos.z, a, 10, 1.0, 0.45, 0xffb84d);
        }
      }
    } else {
      this.windup -= dt;
      this.crystalMat.emissiveIntensity = 1.1 + (0.45 - this.windup) * 1.8;
      if (this.windup <= 0) {
        this.windup = -1;
        this.crystalMat.emissiveIntensity = 1.1;
        for (const a of this.lockedAngles) {
          this.ctx.hostiles.fire(this.pos.x, this.pos.z, a, { speed: 10, dmg: 7, color: 0xffb84d, radius: 0.28 });
        }
        this.ctx.sfx.enemyShoot();
      }
    }
  }
}

// ---------------------------------------------------------------- Mirror
/** Walking bulwark. At half HP it raises a mirror shield; breaking it opens a punish window. */
export class Mirror extends Enemy {
  readonly kind: EnemyKind = "mirror";
  private state: "walk" | "windup" | "recover" = "walk";
  private timer = 0;
  private slamX = 0;
  private slamZ = 0;
  private shieldTimer = 0;
  private shieldUsed = false;
  private strikeArm: THREE.Group;
  private bubble: THREE.Mesh;
  private bubbleMat: THREE.MeshBasicMaterial;

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 80;
    this.speed = 2.0;
    this.radius = 0.7;
    this.shieldBarColor = 0x99ddff;
    const rig = forgeGuardian(this.root, (color, emissive, intensity) => this.stdMat(color, emissive, intensity), "mirror");
    this.legL = rig.legL;
    this.legR = rig.legR;
    this.strikeArm = rig.armR;

    this.bubbleMat = new THREE.MeshBasicMaterial({
      color: 0x99ddff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
    });
    this.bubble = new THREE.Mesh(new THREE.SphereGeometry(1.5, 18, 12), this.bubbleMat);
    this.bubble.position.y = 1.1;
    this.root.add(this.bubble);
    this.mergeStaticRootMeshes([this.bubble]);
  }

  protected deathColor(): number {
    return 0x99ccff;
  }

  protected barHeight(): number {
    return 2.5;
  }

  takeDamage(amount: number, opts: DamageOpts = {}): boolean {
    if (!this.alive) return false;
    // Bubble is omnidirectional but now BREAKABLE — burst it down to pop it early.
    if (this.shieldTimer > 0 && this.shieldHp > 0) {
      this.ctx.fx.burst({
        x: this.pos.x, y: 1.2, z: this.pos.z,
        count: 6, color: 0x99ddff, speed: [2, 5], up: 0.6, size: [0.3, 0.55], life: [0.15, 0.3], gravity: -2, drag: 3,
      });
      this.ctx.sfx.shieldHit();
      return this.hitShield(amount, opts, 0.25, 0x99ddff, "SHATTERED");
    }
    const killed = super.takeDamage(amount, opts);
    if (!killed && !this.shieldUsed && this.hp <= this.maxHp * 0.5) {
      this.shieldUsed = true;
      this.shieldTimer = 3.5;
      this.shieldHp = this.shieldMaxHp = 60; // pops early under ~50-75 burst, or waits out 3.5s
      this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: 2.4, color: 0x99ddff, duration: 0.5 });
      this.ctx.sfx.shieldHit();
      this.ctx.floaters.spawn(this.pos.x, 2.0, this.pos.z, "WARDING", "label");
    }
    return killed;
  }

  protected onShieldBreak(opts?: DamageOpts): void {
    this.shieldTimer = 0;
    if (opts?.allowShieldStagger !== false) {
      this.cancelWarnings();
      this.stagger = 0.8; // bigger achievement than the Bastion's wall → longer punish window
      this.state = "recover";
      this.timer = 0;
    }
    this.bubbleMat.opacity = 0;
    this.bubble.visible = false;
  }

  protected tick(dt: number): void {
    const raise = this.state === "windup" ? Math.min(1, (0.6 - this.timer) / 0.28) : 0;
    this.strikeArm.rotation.x += (-raise * 1.5 - this.strikeArm.rotation.x) * Math.min(1, dt * (raise ? 13 : 24));
    const p = this.ctx.player;
    this.timer -= dt;
    if (this.shieldTimer > 0) {
      this.shieldTimer -= dt;
      // Bubble visibly thins as it is beaten down — "keep hitting, it is about to pop".
      const sFrac = this.shieldMaxHp > 0 ? this.shieldHp / this.shieldMaxHp : 0;
      this.bubbleMat.opacity = Math.min(0.3, this.shieldTimer) * (0.4 + 0.6 * sFrac);
      this.bubble.rotation.y += dt;
      this.bubble.scale.setScalar(0.85 + 0.15 * sFrac);
      if (this.shieldTimer <= 0) {
        // Timer ran out (never broken) — quiet fade, no payoff; clear shield HP so the bar hides.
        this.shieldTimer = 0;
        this.shieldHp = 0;
      }
    } else {
      this.bubbleMat.opacity = Math.max(0, this.bubbleMat.opacity - dt * 2);
    }
    this.bubble.visible = this.bubbleMat.opacity > 0.01;

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
          this.warnCircle(this.slamX, this.slamZ, 2.0, 0.6, 0x99ccff);
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
  private blinkTimer = -1;
  private blinkTarget = new THREE.Vector3();
  private pendingBlast: { x: number; z: number; timer: number } | null = null;
  private orbMat: THREE.MeshStandardMaterial;
  private orb: THREE.Mesh;

  private arms: THREE.Group[];

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 22;
    this.speed = 1.6;
    this.radius = 0.55;
    const rig = forgeCaster(this.root, this.stdMat.bind(this), "caster");
    this.arms = rig.arms;
    this.orb = rig.focus; this.orbMat = rig.focusMat;
  }

  protected deathColor(): number {
    return 0xff7733;
  }

  protected tick(dt: number): void {
    const p = this.ctx.player;
    this.facePlayer(dt);
    this.blinkCd -= dt;
    this.orb.position.y = 1.5 + Math.sin(this.t * 3) * 0.04;
    for (const arm of this.arms) arm.rotation.x += ((this.pendingBlast ? -0.3 : 0) - arm.rotation.x) * Math.min(1, dt * 12);
    this.orbMat.emissiveIntensity = this.pendingBlast ? 1.7 : 1.1;

    // Commit to a visible gathering beat before the escape. The destination
    // is resolved before the effect appears, so the arrival cannot jump a pillar.
    if (this.blinkTimer >= 0) {
      this.blinkTimer -= dt;
      this.pos.y = Math.sin(Math.max(0, this.blinkTimer) / 0.22 * Math.PI) * 0.12;
      if (this.blinkTimer <= 0) {
        const fromX = this.pos.x, fromZ = this.pos.z;
        this.pos.copy(this.blinkTarget); this.blinkTimer = -1;
        for (const [x, z] of [[fromX, fromZ], [this.pos.x, this.pos.z]]) {
          this.ctx.fx.burst({ x, y: 0.8, z, count: 9, color: [0xc4a287, 0xffa873], speed: [1, 4], up: 0.6, size: [0.1, 0.25], life: [0.16, 0.32], gravity: -1, drag: 3 });
        }
        this.ctx.sfx.spawn();
      }
    } else if (this.distToPlayer() < 4 && this.blinkCd <= 0) {
      this.blinkCd = 2.8; this.blinkTimer = 0.22;
      const away = Math.atan2(this.pos.x - p.pos.x, this.pos.z - p.pos.z) + this.ctx.rng.range(-0.7, 0.7);
      this.blinkTarget.set(this.pos.x + Math.sin(away) * 8, 0, this.pos.z + Math.cos(away) * 8);
      const radius = Math.hypot(this.blinkTarget.x, this.blinkTarget.z), limit = ARENA_RADIUS - 2;
      if (radius > limit) { this.blinkTarget.x *= limit / radius; this.blinkTarget.z *= limit / radius; }
      this.ctx.arena.resolveObstacles(this.blinkTarget, this.radius);
      this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: 0.65, color: 0xe3b890, duration: 0.22 });
    } else {
      const drift = Math.sin(this.t * 0.7) * 4;
      this.seek(p.pos.x + Math.sin(this.t * 0.5) * 9, p.pos.z + drift, dt, 0.5);
    }

    // Place a blast on the player's position
    this.castTimer -= dt;
    if (this.castTimer <= 0 && !this.pendingBlast && this.distToPlayer() < 18) {
      this.castTimer = 3.0;
      this.pendingBlast = { x: p.pos.x, z: p.pos.z, timer: 1.0 };
      this.warnCircle(p.pos.x, p.pos.z, 2.6, 1.0, 0xff7733);
      this.orbMat.emissiveIntensity = 1.7;
    }
    if (this.pendingBlast) {
      this.pendingBlast.timer -= dt;
      if (this.pendingBlast.timer <= 0) {
        const b = this.pendingBlast;
        this.pendingBlast = null;
        this.orbMat.emissiveIntensity = 1.1;
        this.ctx.fx.ring(b.x, b.z, { radius: 2.6, color: 0xff7733, duration: 0.45 });
        this.ctx.fx.burst({
          x: b.x, y: 0.4, z: b.z,
          count: 16, color: [0xff935c, 0xe7bf82],
          speed: [3, 9], up: 1.0, size: [0.14, 0.38], life: [0.25, 0.6], gravity: -5, drag: 2.5,
        });
        this.ctx.sfx.explosion();
        if (Math.hypot(p.pos.x - b.x, p.pos.z - b.z) < 2.6 + p.radius) {
          this.ctx.combat.damagePlayer(13, b.x, b.z);
        }
      }
    }
  }

}

// ---------------------------------------------------------------- Shade
/** Half-real assassin. Fades out, reappears BEHIND you — watch your back. */
export class Shade extends Enemy {
  readonly kind: EnemyKind = "shade";
  private state: "lurk" | "fade" | "strike" | "recover" = "lurk";
  private timer = 2.2;
  private strikeX = 0;
  private strikeZ = 0;
  private body: THREE.Group;
  private arms: THREE.Group[];
  private bodyMats: THREE.MeshStandardMaterial[] = [];
  private opacity = 0.75;
  private strafeDir = this.ctx.rng.next() < 0.5 ? 1 : -1;

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 20;
    this.speed = 3.6;
    this.radius = 0.45;
    const material = (color: number, emissive = 0, intensity = 0) => {
      const m = this.stdMat(color, emissive, intensity);
      m.transparent = true; m.opacity = 0.75;
      this.bodyMats.push(m); return m;
    };
    const rig = forgeWraith(this.root, material, "shade");
    this.body = rig.body; this.arms = rig.arms;
  }

  protected deathColor(): number {
    return 0xcc2266;
  }

  protected tick(dt: number): void {
    const p = this.ctx.player;
    this.timer -= dt;

    const poised = this.state === "strike" ? 1 : this.state === "recover" ? -0.35 : 0;
    for (let i = 0; i < this.arms.length; i++) {
      const arm = this.arms[i], side = i === 0 ? -1 : 1;
      arm.rotation.x += ((-0.1 - poised * 0.8) - arm.rotation.x) * Math.min(1, dt * 18);
      arm.rotation.z += ((side * (0.08 + poised * 0.3)) - arm.rotation.z) * Math.min(1, dt * 18);
    }
    this.body.rotation.x += ((this.state === "recover" ? 0.18 : -poised * 0.12) - this.body.rotation.x) * Math.min(1, dt * 14);

    // Opacity follows state
    const targetOpacity = this.state === "fade" ? 0.06 : this.state === "lurk" ? 0.55 : 0.95;
    this.opacity += (targetOpacity - this.opacity) * Math.min(1, dt * 8);
    for (const m of this.bodyMats) m.opacity = this.opacity;

    switch (this.state) {
      case "lurk": {
        const d = this.distToPlayer();
        this.facePlayer(dt);
        const ang = Math.atan2(this.pos.x - p.pos.x, this.pos.z - p.pos.z) + this.strafeDir * 0.6 * dt;
        this.seek(p.pos.x + Math.sin(ang) * Math.max(6, d), p.pos.z + Math.cos(ang) * Math.max(6, d), dt, 0.7);
        if (this.ctx.rng.next() < dt * 0.2) this.strafeDir *= -1;
        if (this.timer <= 0 && d < 14) {
          this.state = "fade";
          this.timer = 0.5;
          this.ctx.sfx.spawn();
        }
        break;
      }
      case "fade":
        if (this.timer <= 0) {
          // Materialize behind the player's current facing
          const bx = p.pos.x - Math.sin(p.facing) * 2.2;
          const bz = p.pos.z - Math.cos(p.facing) * 2.2;
          this.pos.x = bx;
          this.pos.z = bz;
          const radius = Math.hypot(this.pos.x, this.pos.z), limit = ARENA_RADIUS - 2;
          if (radius > limit) { this.pos.x *= limit / radius; this.pos.z *= limit / radius; }
          this.ctx.arena.resolveObstacles(this.pos, this.radius);
          this.strikeX = p.pos.x;
          this.strikeZ = p.pos.z;
          this.warnCircle(p.pos.x, p.pos.z, 1.8, 0.55, 0xff2266);
          this.facePlayer(1);
          this.state = "strike";
          this.timer = 0.55;
          this.ctx.fx.burst({
            x: this.pos.x, y: 1, z: this.pos.z,
            count: 8, color: [0xa67795, 0xe2bfd1], speed: [1, 4], up: 0.6, size: [0.1, 0.23], life: [0.2, 0.45], gravity: -1, drag: 3,
          });
        }
        break;
      case "strike":
        this.facePlayer(dt * 2);
        if (this.timer <= 0) {
          if (Math.hypot(p.pos.x - this.strikeX, p.pos.z - this.strikeZ) < 1.8 + p.radius
            && !this.ctx.arena.blocksSegment(this.pos.x, this.pos.z, p.pos.x, p.pos.z)) {
            this.ctx.combat.damagePlayer(12, this.pos.x, this.pos.z);
          }
          this.ctx.fx.ring(this.strikeX, this.strikeZ, { radius: 1.8, color: 0xff2266, duration: 0.3 });
          this.ctx.sfx.enemyLunge();
          this.state = "recover";
          this.timer = 1.0;
        }
        break;
      case "recover":
        if (this.timer <= 0) {
          this.state = "lurk";
          this.timer = 2.6 + this.ctx.rng.next();
        }
        break;
    }
  }
}

// ---------------------------------------------------------------- Bastion
/** A walking wall. Its front blocks everything — hit it from behind. */
export class Bastion extends Enemy {
  readonly kind: EnemyKind = "bastion";
  private slamTimer = 2.5;
  private slamWindup = -1;
  // Shield + plate are NOT stdMat (kept out of the flash loop) so the break-dim
  // we drive each frame off shieldHp isn't overwritten by the hit-flash lerp.
  private shieldMat: THREE.MeshStandardMaterial;
  private plateMat: THREE.MeshStandardMaterial;
  private regenAfterBreak = false;
  /** Seconds since the last hit of any kind — the wall only re-forms if you back off. */
  private sinceHit = 99;

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 45;
    this.speed = 1.8;
    this.radius = 0.7;
    this.shieldHp = this.shieldMaxHp = 36; // ≈ one full melee combo (9+9+18) at neutral tempo
    this.shieldBarColor = 0xff8a3a;
    const rig = forgeGuardian(this.root, (color, emissive, intensity) => this.stdMat(color, emissive, intensity), "bastion");
    this.shieldMat = rig.shieldMat;
    this.plateMat = rig.plateMat;
    this.legL = rig.legL;
    this.legR = rig.legR;
  }

  protected deathColor(): number {
    return 0xff7a2a;
  }

  protected barHeight(): number {
    return 2.4;
  }

  takeDamage(amount: number, opts: DamageOpts = {}): boolean {
    if (!this.alive) return false;
    this.sinceHit = 0; // any hit (shield or body) keeps the wall from re-forming
    // Front-arc hits feed the breakable shield instead of glancing off forever;
    // flank/rear hits (and post-break hits) take full body damage — the fast route.
    if (this.shieldHp > 0) {
      let shielded = true; // no-direction (DoT) hits are a neutral chip
      if (opts.kbX !== undefined && opts.kbZ !== undefined) {
        const len = Math.hypot(opts.kbX, opts.kbZ);
        if (len > 0.001) {
          const inX = -opts.kbX / len;
          const inZ = -opts.kbZ / len;
          const fx = Math.sin(this.heading);
          const fz = Math.cos(this.heading);
          shielded = inX * fx + inZ * fz > 0.34; // within ~140° front arc
        }
      }
      if (shielded) {
        const fx = Math.sin(this.heading);
        const fz = Math.cos(this.heading);
        this.ctx.fx.burst({
          x: this.pos.x + fx * 0.8, y: 1.1, z: this.pos.z + fz * 0.8,
          count: 6, color: 0xff7a2a, speed: [2, 5], up: 0.5, size: [0.3, 0.55], life: [0.15, 0.3], gravity: -2, drag: 3,
        });
        this.ctx.sfx.shieldHit();
        return this.hitShield(amount, opts, 0.25, 0xff7a2a, "SHIELD BREAK");
      }
    }
    return super.takeDamage(amount, opts);
  }

  protected onShieldBreak(opts?: DamageOpts): void {
    if (opts?.allowShieldStagger !== false) {
      this.cancelWarnings();
      this.stagger = 0.6;
      this.slamWindup = -1;
      this.slamTimer = Math.max(this.slamTimer, 0.9);
    }
    this.regenAfterBreak = true; // becomes a wall again once the window closes
  }

  update(dt: number): void {
    super.update(dt);
    // These mats are outside the flash loop (so the shield-HP glow isn't clobbered),
    // which also means we owe them the freeze tint the base loop gives flashMats.
    if (this.frozen > 0) {
      this.shieldMat.emissive.set(0x5599ff);
      this.plateMat.emissive.set(0x5599ff);
      this.shieldMat.emissiveIntensity = 1;
      this.plateMat.emissiveIntensity = 1;
      return;
    }
    // Drive shield/plate glow off shield HP (restore ember after any freeze tint).
    this.shieldMat.emissive.set(0xff7a2a);
    this.plateMat.emissive.set(0xff7a2a);
    const frac = this.shieldHp / this.shieldMaxHp;
    this.shieldMat.emissiveIntensity = 0.06 + frac * 0.34;
    this.plateMat.emissiveIntensity = 0.02 + frac * 0.16;
  }

  protected tick(dt: number): void {
    const p = this.ctx.player;
    this.sinceHit += dt;
    // Regenerate the wall ONLY once you've stopped pressuring it (1.5s untouched);
    // sustained aggression keeps the shield broken so the body stays killable head-on.
    if (this.regenAfterBreak && this.sinceHit > 1.5 && this.shieldHp < this.shieldMaxHp) {
      this.shieldHp = Math.min(this.shieldMaxHp, this.shieldHp + (this.shieldMaxHp / 1.2) * dt);
      if (this.shieldHp >= this.shieldMaxHp) this.regenAfterBreak = false;
    }
    if (this.slamWindup < 0) {
      const d = this.seek(p.pos.x, p.pos.z, dt);
      // A slow, heavy stomp bob so "the walking wall" reads as ponderous mass hauling
      // itself forward, not a statue gliding on rails (its legs step; this adds weight).
      this.pos.y = Math.abs(Math.sin(this.t * 2.2)) * 0.05;
      this.slamTimer -= dt;
      if (d < 3.0 && this.slamTimer <= 0) {
        this.slamWindup = 0.6;
        this.slamTimer = 3.0;
        const fx = Math.sin(this.heading);
        const fz = Math.cos(this.heading);
        this.warnCircle(this.pos.x + fx * 1.6, this.pos.z + fz * 1.6, 2.2, 0.6, 0xff7a2a);
      }
    } else {
      this.facePlayer(dt * 0.4);
      this.slamWindup -= dt;
      if (this.slamWindup <= 0) {
        this.slamWindup = -1;
        const fx = Math.sin(this.heading);
        const fz = Math.cos(this.heading);
        const sx = this.pos.x + fx * 1.6;
        const sz = this.pos.z + fz * 1.6;
        this.ctx.fx.ring(sx, sz, { radius: 2.2, color: 0xff7a2a, duration: 0.35 });
        this.ctx.cam.addTrauma(0.15);
        this.ctx.sfx.bossSlam();
        if (Math.hypot(p.pos.x - sx, p.pos.z - sz) < 2.2 + p.radius) {
          this.ctx.combat.damagePlayer(15, this.pos.x, this.pos.z);
        }
      }
    }
  }
}

// ---------------------------------------------------------------- Brute
/** Big armored charger. Telegraphs a straight lane, then dashes through it — sidestep and punish the long recovery. */
export class Brute extends Enemy {
  readonly kind: EnemyKind = "brute";
  private state: "chase" | "windup" | "charge" | "recover" = "chase";
  private timer = 0;
  private chargeDir = new THREE.Vector2();
  private struck = false;
  private eyeMat: THREE.MeshStandardMaterial;
  private rig: ReturnType<typeof forgeBrute>;
  private rushDistance = 0;
  override get anchored(): boolean { return this.state === "windup" || this.state === "charge"; }

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 85;
    this.speed = 1.5;
    this.radius = 0.9;
    this.rig = forgeBrute(this.root, this.stdMat.bind(this));
    this.eyeMat = this.rig.eyes;
    this.legL = this.rig.legs[0]; this.legR = this.rig.legs[1];
  }

  protected deathColor(): number {
    return 0xff5511;
  }

  protected barHeight(): number {
    return 2.5;
  }

  protected tick(dt: number): void {
    const p = this.ctx.player;
    this.timer -= dt;
    this.pos.y = 0;
    const winding = this.state === "windup", rushing = this.state === "charge";
    const blend = Math.min(1, dt * 14);
    this.rig.body.rotation.x += ((winding ? -0.13 : rushing ? 0.28 : 0) - this.rig.body.rotation.x) * blend;
    this.rig.head.rotation.x += ((winding ? 0.22 : rushing ? -0.18 : 0) - this.rig.head.rotation.x) * blend;
    for (const [i, arm] of this.rig.arms.entries()) {
      const target = winding ? -0.5 : rushing ? -1.15 : this.state === "chase" ? Math.sin(this.t * 4 + i * Math.PI) * 0.12 : 0;
      arm.rotation.x += (target - arm.rotation.x) * blend;
    }
    this.eyeMat.emissiveIntensity = winding ? 1.8 : 1.2;
    if (this.anchored) this.kb.set(0, 0);

    switch (this.state) {
      case "chase": {
        const d = this.seek(p.pos.x, p.pos.z, dt);
        if (d < 7 && this.timer <= 0 && this.commitMelee(1.4)) {
          this.state = "windup";
          this.timer = 0.7;
          this.struck = false;
          const dx = p.pos.x - this.pos.x;
          const dz = p.pos.z - this.pos.z;
          const len = Math.hypot(dx, dz) || 1;
          this.chargeDir.set(dx / len, dz / len);
          const ang = Math.atan2(this.chargeDir.x, this.chargeDir.y);
          // Warn the full committed rush, including the reach of the battering body.
          this.warnLine(this.pos.x, this.pos.z, ang, 10, (this.radius + 0.6) * 2, 0.7, 0xff5511);
          this.eyeMat.emissiveIntensity = 1.8;
        }
        break;
      }
      case "windup":
        // The displayed lane is locked. Tracking the player here redirected the rush off its warning.
        this.heading = Math.atan2(this.chargeDir.x, this.chargeDir.y);
        if (this.timer <= 0) {
          this.state = "charge";
          this.timer = 0.58;
          this.rushDistance = 0;
          this.ctx.cam.addTrauma(0.18);
          this.ctx.sfx.bossDash();
        }
        break;
      case "charge": {
        const travel = Math.min(8.5 - this.rushDistance, 16 * dt);
        const steps = Math.max(1, Math.ceil(travel / 0.25));
        let blocked = false;
        for (let i = 0; i < steps; i++) {
          const ox = this.pos.x, oz = this.pos.z, step = travel / steps;
          this.pos.x += this.chargeDir.x * step; this.pos.z += this.chargeDir.y * step;
          const r = Math.hypot(this.pos.x, this.pos.z), limit = ARENA_RADIUS - this.radius;
          if (r > limit) { this.pos.x *= limit / r; this.pos.z *= limit / r; }
          this.ctx.arena.resolveObstacles(this.pos, this.radius);
          const dx = this.pos.x - ox, dz = this.pos.z - oz, lengthSq = dx * dx + dz * dz;
          const along = lengthSq > 0 ? Math.max(0, Math.min(1, ((p.pos.x - ox) * dx + (p.pos.z - oz) * dz) / lengthSq)) : 0;
          if (!this.struck && Math.hypot(p.pos.x - ox - dx * along, p.pos.z - oz - dz * along) < this.radius + p.radius + 0.6) {
            this.struck = true;
            this.ctx.combat.damagePlayer(18, this.pos.x, this.pos.z);
          }
          this.rushDistance += step;
          if (dx * this.chargeDir.x + dz * this.chargeDir.y < step * 0.5) { blocked = true; break; }
        }
        if (blocked || this.rushDistance >= 8.5 || this.timer <= 0) {
          this.state = "recover";
          this.timer = blocked ? 1.25 : 1.0;
          this.eyeMat.emissiveIntensity = 1.2;
          this.ctx.fx.burst({ x: this.pos.x, y: 0.15, z: this.pos.z, count: 8, color: [0xa2927b, 0x696875], speed: [1, 4], up: 0.5, size: [0.1, 0.25], life: [0.2, 0.4], gravity: -4, drag: 4 });
          this.ctx.cam.addTrauma(blocked ? 0.16 : 0.08);
          this.ctx.sfx.bossSlam();
        }
        break;
      }
      case "recover":
        if (this.timer <= 0) {
          this.state = "chase";
          this.timer = 0.5;
        }
        break;
    }
  }
}

// ---------------------------------------------------------------- Harrier
/** Fast aerial strafer. Hovers out of reach and circles, firing quick bolts on a brief glowing windup. */
export class Harrier extends Enemy {
  readonly kind: EnemyKind = "harrier";
  private fireTimer = 1.4;
  private windup = -1;
  private lockedAngle = 0;
  private orb: THREE.Mesh;
  private orbMat: THREE.MeshStandardMaterial;
  private wings: THREE.Group[];
  private strafeDir = this.ctx.rng.next() < 0.5 ? 1 : -1;

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 16;
    this.speed = 5.0;
    this.radius = 0.5;
    this.pos.y = 1.6;
    const rig = forgeFlier(this.root, this.stdMat.bind(this), "harrier");
    this.wings = rig.wings;
    this.orbMat = rig.focusMat;
    this.orb = rig.focus;
  }

  protected deathColor(): number {
    return 0x33ccff;
  }

  protected barHeight(): number {
    return 0.85;
  }

  protected tick(dt: number): void {
    const p = this.ctx.player;
    const d = this.distToPlayer();
    this.facePlayer(dt);
    for (const [i, wing] of this.wings.entries()) {
      const beat = this.windup >= 0 ? 0.45 : 0.16 + Math.sin(this.t * 8) * 0.24;
      wing.rotation.z = (i === 0 ? -1 : 1) * beat;
    }
    // Hovers high and bobs — hard to corner, but melee sweeps (2D) still reach it.
    this.pos.y = 1.6 + Math.sin(this.t * 4) * 0.22;

    if (this.windup < 0) {
      // Circle the player in a medium band, banking on the strafe
      if (d < 6) this.seek(this.pos.x * 2 - p.pos.x, this.pos.z * 2 - p.pos.z, dt, 0.95);
      else if (d > 10) this.seek(p.pos.x, p.pos.z, dt);
      else {
        const ang = Math.atan2(this.pos.x - p.pos.x, this.pos.z - p.pos.z) + this.strafeDir * 0.9 * dt;
        this.seek(p.pos.x + Math.sin(ang) * d, p.pos.z + Math.cos(ang) * d, dt, 0.85);
        if (this.ctx.rng.next() < dt * 0.3) this.strafeDir *= -1;
      }
      this.fireTimer -= dt;
      if (this.fireTimer <= 0 && d < 14) {
        this.windup = 0.32;
        this.fireTimer = 1.7;
        this.lockedAngle = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
        this.warnLine(this.pos.x, this.pos.z, this.lockedAngle, 6, 0.7, 0.32, 0x33ccff);
      }
    } else {
      this.windup -= dt;
      this.orbMat.emissiveIntensity = 1.1 + (0.32 - this.windup) * 2.5;
      this.orb.scale.setScalar(1 + (0.32 - this.windup) * 2.0);
      if (this.windup <= 0) {
        this.windup = -1;
        this.orbMat.emissiveIntensity = 1.1;
        this.orb.scale.setScalar(1);
        this.ctx.hostiles.fire(this.pos.x, this.pos.z, this.lockedAngle, {
          speed: 12, dmg: 7, color: 0x55ddff, radius: 0.26, y: 1.4,
        });
        this.ctx.sfx.enemyShoot();
      }
    }
  }
}

// ---------------------------------------------------------------- Splitter
/** Plated brood carrier. Harmless to touch; two egg cases split into swarmers. */
export class Splitter extends Enemy {
  readonly kind: EnemyKind = "splitter";

  private sacs: THREE.Group[];
  private legs: THREE.Group[];

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 28;
    this.speed = 1.9;
    this.radius = 0.65;
    const rig = forgeSplitter(this.root, this.stdMat.bind(this));
    this.sacs = rig.sacs; this.legs = rig.legs;
  }

  protected deathColor(): number {
    return 0x33cc55;
  }

  protected barHeight(): number {
    return 1.6;
  }

  protected onDeath(): void {
    // Each egg case hatches one swarmer with the usual arrival warning.
    this.ctx.enemies.spawn("swarmer", this.pos.x - 0.6, this.pos.z, 0.5);
    this.ctx.enemies.spawn("swarmer", this.pos.x + 0.6, this.pos.z, 0.5);
  }

  protected tick(dt: number): void {
    const p = this.ctx.player;
    this.seek(p.pos.x, p.pos.z, dt);
    this.facePlayer(dt);
    for (let i = 0; i < this.legs.length; i++) this.legs[i].rotation.x = Math.sin(this.t * 9 + i * Math.PI / 3) * 0.28;
    for (let i = 0; i < this.sacs.length; i++) this.sacs[i].rotation.z = Math.sin(this.t * 3 + i * Math.PI) * 0.04;
    this.pos.y = Math.abs(Math.sin(this.t * 9)) * 0.018;
  }
}

// ---------------------------------------------------------------- Voidling
/**
 * Cosmic swarm mote (Act V). Fast, fragile, drifts in erratic spirals and bites
 * with a planted, telegraphed pulse. Pale-white/violet glow — the Hollow Star's lesser children.
 */
export class Voidling extends Enemy {
  readonly kind: EnemyKind = "voidling";
  private phase = this.ctx.rng.next() * Math.PI * 2;
  private wander = this.ctx.rng.next() * Math.PI * 2;
  private pulseTime = -1;
  private pulseCooldown = 0;
  override get anchored(): boolean { return this.pulseTime >= 0; }
  private jaws: THREE.Group[];
  private tails: THREE.Group[];
  private coreMat: THREE.MeshStandardMaterial;

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 14;
    this.speed = 5.0;
    this.radius = 0.38;
    const rig = forgeVoidling(this.root, this.stdMat.bind(this));
    this.jaws = rig.jaws; this.tails = rig.tails; this.coreMat = rig.coreMat;
  }

  protected deathColor(): number {
    return 0xc8a6ff;
  }

  protected barHeight(): number {
    return 1.0;
  }

  protected tick(dt: number): void {
    const p = this.ctx.player;
    // Erratic drift: a slow wandering bias perpendicular to the approach vector.
    this.wander += (this.ctx.rng.next() - 0.5) * dt * 6;
    const dx = p.pos.x - this.pos.x;
    const dz = p.pos.z - this.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const swirl = Math.sin(this.t * 5 + this.phase) * 1.1 + Math.sin(this.wander) * 0.6;
    const tx = p.pos.x + (-dz / d) * swirl;
    const tz = p.pos.z + (dx / d) * swirl;
    this.pulseCooldown = Math.max(0, this.pulseCooldown - dt);
    if (this.pulseTime >= 0) {
      this.kb.set(0, 0);
      this.pulseTime -= dt;
      if (this.pulseTime <= 0) {
        this.pulseTime = -1;
        this.pulseCooldown = 1.1;
        this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: 1.25, color: 0xb5a2de, duration: .2 });
        if (this.distToPlayer() < 1.25 + p.radius && !this.ctx.arena.blocksSegment(this.pos.x, this.pos.z, p.pos.x, p.pos.z)) {
          this.ctx.combat.damagePlayer(7, this.pos.x, this.pos.z, { sourceId: `enemy:${this.id}`, sourceKind: this.kind, attackFamily: "voidling-pulse" });
        }
      }
    } else if (d < 1.7 && this.pulseCooldown <= 0 && this.commitMelee(.6)) {
      this.pulseTime = .46;
      this.warnCircle(this.pos.x, this.pos.z, 1.25, .46, 0xcd8aca);
    } else if (d > 1.5) this.seek(tx, tz, dt, this.pulseCooldown > .8 ? .35 : 1);
    const charging = this.pulseTime >= 0;
    this.pos.y = charging ? .45 + (1 - this.pulseTime / .46) * .24 : .45 + Math.sin(this.t * 8 + this.phase) * .12;
    this.facePlayer(dt * 2);
    const gape = charging ? .18 + (1 - this.pulseTime / .46) * .48 : .08;
    this.jaws[0].rotation.x = -gape;
    this.jaws[1].rotation.x = gape;
    for (let i = 0; i < this.tails.length; i++) this.tails[i].rotation.y = Math.sin(this.t * 7 + i * 0.7) * 0.18;
    this.coreMat.emissiveIntensity = charging ? 1.05 + (1 - this.pulseTime / .46) * 1.2 : 1.05;
  }
}

// ---------------------------------------------------------------- Warper
/**
 * Ranged blink-striker (Act V). Teleports short hops to reposition (telegraphed
 * with a fade-out and a target ring), then locks a lane and fires a bolt on a
 * telegraphed windup. Pale void glow.
 */
export class Warper extends Enemy {
  readonly kind: EnemyKind = "warper";
  private state: "drift" | "blinkTell" | "aim" = "drift";
  private timer = 1.4;
  private blinkCd = 2.4 + this.ctx.rng.next();
  private blinkTo = new THREE.Vector3();
  private lockedAngle = 0;
  private orb: THREE.Mesh;
  private orbMat: THREE.MeshStandardMaterial;
  private body: THREE.Group;
  private arms: THREE.Group[];
  private bodyMats: THREE.MeshStandardMaterial[] = [];
  private opacity = 1;

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 26;
    this.speed = 2.2;
    this.radius = 0.5;
    const material = (color: number, emissive = 0, intensity = 0) => {
      const m = this.stdMat(color, emissive, intensity);
      m.transparent = true; m.opacity = 1;
      this.bodyMats.push(m); return m;
    };
    const rig = forgeWraith(this.root, material, "warper");
    this.body = rig.body; this.arms = rig.arms;
    this.orb = rig.focus!; this.orbMat = rig.focusMat;
    this.arms[1].rotation.x = -0.55;
  }

  protected deathColor(): number {
    return 0xc8a6ff;
  }

  /** Stop a mid-flight aim/blink so thawing never produces an un-telegraphed bolt. */
  freeze(duration: number): void {
    super.freeze(duration);
    if (this.state !== "drift") {
      this.cancelWarnings();
      this.state = "drift";
      this.timer = 0.6;
      this.orbMat.emissiveIntensity = 1.1;
    }
  }

  private pickBlink(): void {
    const p = this.ctx.player;
    // Hop to a fresh angle around the player, keeping a mid kite distance.
    const ang = Math.atan2(this.pos.x - p.pos.x, this.pos.z - p.pos.z) + this.ctx.rng.range(-1.4, 1.4);
    const dist = 9;
    let tx = p.pos.x + Math.sin(ang) * dist;
    let tz = p.pos.z + Math.cos(ang) * dist;
    const r = Math.hypot(tx, tz);
    const maxR = ARENA_RADIUS - 2;
    if (r > maxR) {
      tx *= maxR / r;
      tz *= maxR / r;
    }
    this.blinkTo.set(tx, 0, tz);
    this.ctx.arena.resolveObstacles(this.blinkTo, this.radius);
    tx = this.blinkTo.x; tz = this.blinkTo.z;
    this.state = "blinkTell";
    this.timer = 0.5;
    // Telegraph the destination so the reposition reads, plus the vanish FX.
    this.ctx.fx.ring(tx, tz, { radius: 0.7, duration: 0.5, color: 0xc8a6ff });
    this.ctx.fx.burst({
      x: this.pos.x, y: 1.0, z: this.pos.z,
      count: 8, color: [0xc8a6ff, 0xb3a2ca], speed: [1, 4], up: 0.6, size: [0.1, 0.22], life: [0.2, 0.45], gravity: -1, drag: 3,
    });
    this.ctx.sfx.spawn();
  }

  protected tick(dt: number): void {
    const p = this.ctx.player;
    const d = this.distToPlayer();
    this.timer -= dt;
    this.blinkCd -= dt;
    this.orb.position.y = 1.45 + Math.sin(this.t * 3) * 0.08;

    const reach = this.state === "aim" ? -0.8 : this.state === "blinkTell" ? -0.4 : 0;
    this.arms[0].rotation.x += (reach - this.arms[0].rotation.x) * Math.min(1, dt * 12);
    this.body.rotation.x += ((this.state === "blinkTell" ? -0.14 : 0) - this.body.rotation.x) * Math.min(1, dt * 12);

    // Opacity dips while blinking, full otherwise.
    const targetOpacity = this.state === "blinkTell" ? 0.18 : 1;
    this.opacity += (targetOpacity - this.opacity) * Math.min(1, dt * 9);
    for (const m of this.bodyMats) m.opacity = this.opacity;

    switch (this.state) {
      case "drift": {
        this.facePlayer(dt);
        // Slow kite drift while cooldowns tick.
        if (d < 7) this.seek(this.pos.x * 2 - p.pos.x, this.pos.z * 2 - p.pos.z, dt, 0.7);
        else if (d > 13) this.seek(p.pos.x, p.pos.z, dt, 0.6);
        this.pos.y = Math.sin(this.t * 2.2) * 0.08;
        // Blink away when crowded or on its own cadence; otherwise line up a shot.
        if ((d < 4.5 || this.blinkCd <= 0) && this.timer <= 0) {
          this.blinkCd = 3.0 + this.ctx.rng.next();
          this.pickBlink();
        } else if (this.timer <= 0 && d < 16) {
          this.state = "aim";
          this.timer = 0.45;
          this.lockedAngle = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
          this.warnLine(this.pos.x, this.pos.z, this.lockedAngle, 14, 1.0, 0.45, 0xc8a6ff);
        }
        break;
      }
      case "blinkTell":
        if (this.timer <= 0) {
          // Arrive at the telegraphed destination.
          this.pos.x = this.blinkTo.x;
          this.pos.z = this.blinkTo.z;
          this.ctx.fx.burst({
            x: this.pos.x, y: 1.0, z: this.pos.z,
            count: 8, color: [0xc8a6ff, 0xb3a2ca], speed: [2, 5], up: 0.7, size: [0.1, 0.23], life: [0.2, 0.5], gravity: -1, drag: 3,
          });
          this.state = "drift";
          this.timer = 0.5;
        }
        break;
      case "aim":
        this.facePlayer(dt * 0.5);
        this.orbMat.emissiveIntensity = 1.1 + (0.45 - this.timer) * 1.7;
        if (this.timer <= 0) {
          this.orbMat.emissiveIntensity = 1.1;
          this.ctx.hostiles.fire(this.pos.x, this.pos.z, this.lockedAngle, {
            speed: 11, dmg: 8, color: 0xc8a6ff, radius: 0.3, y: 1.2,
          });
          this.ctx.sfx.enemyShoot();
          this.state = "drift";
          this.timer = 0.8;
        }
        break;
    }
  }
}

registerEnemy("wisp", Wisp);
registerEnemy("leaper", Leaper);
registerEnemy("tether", Tether);
registerEnemy("mirror", Mirror);
registerEnemy("caster", Caster);
registerEnemy("shade", Shade);
registerEnemy("bastion", Bastion);
registerEnemy("brute", Brute);
registerEnemy("harrier", Harrier);
registerEnemy("splitter", Splitter);
registerEnemy("voidling", Voidling);
registerEnemy("warper", Warper);
