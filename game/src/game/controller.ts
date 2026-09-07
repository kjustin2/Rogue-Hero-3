import * as THREE from "three";
import { ARENA_RADIUS } from "../render/arena";
import { clamp01, damp } from "../core/math";
import type { Ctx } from "./ctx";
import type { Enemy } from "./enemies";

const DODGE_DURATION = 0.18;
const DODGE_SPEED = 21;
const DASH_RECHARGE = 0.72;
const DASH_STOCK = 2;
const PERFECT_WINDOW = 0.11;

/** Cards follow this actual movement lifecycle, including cancellation and the last step. */
export interface MovementBurst {
  readonly started: boolean;
  readonly finished: boolean;
  readonly cancelled: boolean;
}

/**
 * Input → hero movement. Snappy damped velocity, twin-stick facing (always
 * toward the cursor), and a two-charge dash with i-frames + a perfect-dodge
 * window at the start that pays out tempo when an attack whiffs through it.
 */
export class Controller {
  private vel = new THREE.Vector2();
  /** Damped RESOLVED movement, for the locomotion pose only — never the sim. */
  private animVel = new THREE.Vector2();
  private dodgeTimer = -1;
  private dodgeCooldown = 0;
  private dashStock = DASH_STOCK;
  private rechargeTimer = 0;
  private dodgeDir = new THREE.Vector2(0, 1);
  private ghostAcc = 0;
  /** One perfect-dodge payout per dash. */
  private perfectConsumed = false;
  /** Attack immediately after a dash for a lunging follow-up. */
  followUpWindow = 0;
  private dodgeBuffer = 0;
  /** External recoil and knockback. Card travel uses a bounded movement burst. */
  private impulse = new THREE.Vector2();
  private burst: { x: number; z: number; speed: number; remaining: number; started: boolean; finished: boolean; cancelled: boolean } | null = null;

  // --- Gamepad auto-aim / lock-on
  /** Auto-aim ON (Settings): face & target the focused enemy when the right stick is idle. */
  autoAim = true;
  /** The enemy auto-aim currently locks onto (gamepad only). null on mouse/keyboard. */
  private target: Enemy | null = null;
  private reticle: THREE.Mesh | null = null;
  private reticleSpin = 0;

  constructor(private ctx: Ctx) {}

  /** The locked-on enemy, for HUD / reticle consumers. */
  get focusTarget(): Enemy | null {
    return this.target && this.target.alive ? this.target : null;
  }

  get dodging(): boolean {
    return this.dodgeTimer >= 0 && this.dodgeTimer < DODGE_DURATION;
  }

  get dashCharges(): number { return this.dashStock; }
  get dashRechargeProgress(): number {
    return this.dashStock === DASH_STOCK ? 1 : clamp01(1 - this.rechargeTimer / DASH_RECHARGE);
  }

  /** External i-frame grants (Dash Strike etc.) — independent of the dodge roll. */
  private iframeTimer = 0;

  grantIframes(sec: number): void {
    this.iframeTimer = Math.max(this.iframeTimer, sec);
  }

  get invulnerable(): boolean {
    return this.dodging || this.iframeTimer > 0;
  }

  get inPerfectWindow(): boolean {
    // Ascension can shrink the window (dodgeWindowMult < 1) to demand tighter timing.
    const window = PERFECT_WINDOW * this.ctx.difficulty.dodgeWindowMult;
    return this.dodging && this.dodgeTimer < window && !this.perfectConsumed;
  }

  consumePerfect(): void {
    this.perfectConsumed = true;
  }

  /** Instant shove, e.g. crash recoil or card dashes. */
  push(x: number, z: number): void {
    this.impulse.x += x;
    this.impulse.y += z;
  }

  moveBurst(x: number, z: number, distance: number, duration: number): MovementBurst {
    this.cancelBurst();
    this.dodgeTimer = -1;
    this.ctx.player.animDodge = null;
    this.vel.set(0, 0); this.impulse.set(0, 0);
    const length = Math.hypot(x, z) || 1;
    this.burst = { x: x / length, z: z / length, speed: distance / duration, remaining: duration, started: false, finished: false, cancelled: false };
    return this.burst;
  }

  private cancelBurst(): void {
    if (this.burst) { this.burst.cancelled = this.burst.finished = true; this.burst = null; }
  }

  /** Test/run-boundary transient reset. Does not alter player position or stats. */
  clearTransient(): void {
    this.vel.set(0, 0);
    this.impulse.set(0, 0);
    this.animVel.set(0, 0);
    this.dodgeTimer = -1;
    this.dodgeCooldown = 0;
    this.dashStock = DASH_STOCK;
    this.rechargeTimer = 0;
    this.iframeTimer = 0;
    this.cancelBurst();
    this.target = null;
    this.followUpWindow = 0;
    this.dodgeBuffer = 0;
    this.ctx.player.animDodge = null;
  }

  update(dt: number): void {
    const { input, player, tempo } = this.ctx;
    if (!player.alive) {
      player.animMoveAmount = 0;
      player.animMoveX = 0;
      player.animMoveZ = 0;
      return;
    }

    // Movement direction (keyboard or analog left stick)
    const mv = input.moveVector();
    const ix = mv.x;
    const iz = mv.z;
    const inputLen = Math.hypot(ix, iz);

    // Facing: cursor (mouse) or right-stick / auto-aim (gamepad)
    if (input.usingGamepad) {
      if (this.autoAim) {
        if (this.target && (!this.target.alive || this.target.hp <= 0)) this.target = null;
        if (input.actionPressed("target")) this.cycleTarget();
      } else {
        this.target = null;
      }
      const a = input.aimDir();
      if (a) {
        // Right stick aims manually; flicking it also re-locks toward the stick.
        player.facing = Math.atan2(a.x, a.z);
        if (this.autoAim) this.targetTowardDir(a.x, a.z);
        input.aimPoint.set(player.pos.x + Math.sin(player.facing) * 8, 0, player.pos.z + Math.cos(player.facing) * 8);
      } else if (this.autoAim && this.acquireTarget()) {
        // Auto-aim: face and target-with-cards the locked enemy.
        const t = this.target!;
        player.facing = Math.atan2(t.pos.x - player.pos.x, t.pos.z - player.pos.z);
        input.aimPoint.set(t.pos.x, 0, t.pos.z);
      } else {
        if (inputLen > 0.1) player.facing = Math.atan2(ix, iz);
        input.aimPoint.set(player.pos.x + Math.sin(player.facing) * 8, 0, player.pos.z + Math.cos(player.facing) * 8);
      }
      this.updateReticle(dt);
    } else {
      this.target = null;
      if (this.reticle) this.reticle.visible = false;
      const aim = input.aimPoint;
      const dx = aim.x - player.pos.x;
      const dz = aim.z - player.pos.z;
      // Hold facing when the cursor sits on/near the hero — at point-blank the
      // aim angle is ill-defined, and camera shake makes it jitter, which would
      // spin the body (and its ground rings) until you walk out from under it.
      if (dx * dx + dz * dz > 0.64) {
        player.facing = Math.atan2(dx, dz);
      }
    }
    this.ctx.cam.aimPoint.copy(input.aimPoint);

    this.dodgeCooldown = Math.max(0, this.dodgeCooldown - dt);
    if (this.dashStock < DASH_STOCK) {
      this.rechargeTimer -= dt;
      while (this.rechargeTimer <= 0 && this.dashStock < DASH_STOCK) {
        this.dashStock++;
        this.rechargeTimer = this.dashStock < DASH_STOCK ? this.rechargeTimer + DASH_RECHARGE : 0;
      }
    }
    this.followUpWindow = Math.max(0, this.followUpWindow - dt);
    this.dodgeBuffer = Math.max(0, this.dodgeBuffer - dt);
    if (input.actionPressed("dodge")) this.dodgeBuffer = 0.12;
    this.iframeTimer = Math.max(0, this.iframeTimer - dt);

    // Start dodge
    if (this.dodgeBuffer > 0 && this.dashStock > 0 && this.dodgeCooldown <= 0 && !this.dodging) {
      this.dodgeBuffer = 0;
      this.dodgeTimer = 0;
      this.dodgeCooldown = DODGE_DURATION + 0.055;
      if (this.dashStock === DASH_STOCK) this.rechargeTimer = DASH_RECHARGE;
      this.dashStock--;
      this.cancelBurst();
      this.perfectConsumed = false;
      this.ghostAcc = 0;
      if (inputLen > 0) this.dodgeDir.set(ix, iz).normalize();
      else this.dodgeDir.set(Math.sin(player.facing), Math.cos(player.facing));
      this.ctx.events.emit("DODGE", {});
      this.ctx.combat.cancelSwing();
      this.ctx.fx.burst({
        x: player.pos.x, y: 0.3, z: player.pos.z,
        count: 6, color: player.bladeColor,
        speed: [1, 3], up: 0.25, size: [0.08, 0.2], life: [0.12, 0.28], gravity: -2, drag: 3,
      });
    }

    const speedMult = tempo.zone.speedMult;
    const burst = this.burst;
    const dashedThisFrame = this.dodging;

    if (this.dodging) {
      const remaining = DODGE_DURATION - this.dodgeTimer;
      this.dodgeTimer += dt;
      const portion = dt > 0 ? Math.min(1, remaining / dt) : 1;
      this.vel.set(this.dodgeDir.x, this.dodgeDir.y).multiplyScalar(DODGE_SPEED * (0.8 + speedMult * 0.2) * portion);
      this.ghostAcc += dt;
      if (this.ghostAcc > 0.045) {
        this.ghostAcc = 0;
        player.spawnGhost();
      }
      player.animDodge = {
        phase: clamp01(this.dodgeTimer / DODGE_DURATION),
        dirX: this.dodgeDir.x,
        dirZ: this.dodgeDir.y,
      };
      if (this.dodgeTimer >= DODGE_DURATION) {
        this.dodgeTimer = -1;
        this.followUpWindow = 0.34;
        player.animDodge = null;
      }
    } else if (burst) {
      const portion = dt > 0 ? Math.min(1, burst.remaining / dt) : 0;
      this.vel.set(burst.x, burst.z).multiplyScalar(burst.speed * portion);
      burst.started = dt > 0 || burst.started;
      burst.remaining = Math.max(0, burst.remaining - dt);
      if (burst.remaining <= 0) burst.finished = true;
    } else {
      const target = player.hero.speed * speedMult;
      const response = inputLen > 0.05 ? 22 : 30;
      this.vel.x = damp(this.vel.x, ix * target, response, dt);
      this.vel.y = damp(this.vel.y, iz * target, response, dt);
    }

    // Apply impulse (decays quickly)
    this.vel.x += this.impulse.x;
    this.vel.y += this.impulse.y;
    this.impulse.set(0, 0);

    const preX = player.pos.x, preZ = player.pos.z;
    const maxR = ARENA_RADIUS - player.radius;
    // Short swept steps keep high-speed cards and pushes from tunnelling through
    // a pillar on a slow frame. Normal walking generally needs just one step.
    const steps = Math.max(1, Math.ceil(this.vel.length() * dt / 0.25));
    for (let i = 0; i < steps; i++) {
      player.pos.x += this.vel.x * dt / steps;
      player.pos.z += this.vel.y * dt / steps;
      const r = Math.hypot(player.pos.x, player.pos.z);
      if (r > maxR) { player.pos.x *= maxR / r; player.pos.z *= maxR / r; }
      this.ctx.arena.resolveObstacles(player.pos, player.radius);
    }
    if (burst?.finished) { this.burst = null; this.vel.set(0, 0); }

    // Player↔enemy soft separation: the player rides the SURFACE of a body, never
    // stands inside it (the "looks wrong when interacting with another character"
    // bug — bodies could freely interpenetrate). Push the player out to touching
    // distance (radii sum), which is still inside melee reach, so it doesn't hurt
    // combat. SKIPPED mid-dodge: the dash grants i-frames THROUGH enemies by design.
    if (!dashedThisFrame && !burst) {
      for (const e of this.ctx.enemies.living()) {
        // Boss exempt (matches shove()/clamp): a large boss radius would push the
        // player out of melee reach. Separation is for the regular-enemy case.
        if (e.hp <= 0 || e.kind === "boss") continue;
        let dx = player.pos.x - e.pos.x;
        let dz = player.pos.z - e.pos.z;
        const min = player.radius + e.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min) continue;
        if (d2 <= 1e-6) { dx = Math.sin(player.facing); dz = Math.cos(player.facing); }
        const d = d2 <= 1e-6 ? 1 : Math.sqrt(d2);
        if (d2 <= 1e-6) { player.pos.x += dx * min; player.pos.z += dz * min; continue; }
        const push = (min - d) / d;
        player.pos.x += dx * push;
        player.pos.z += dz * push;
      }
      this.ctx.arena.resolveObstacles(player.pos, player.radius);
      // being shoved off an enemy must not eject the player past the arena rim.
      const r2 = Math.hypot(player.pos.x, player.pos.z);
      if (r2 > maxR) { player.pos.x *= maxR / r2; player.pos.z *= maxR / r2; }
    }

    const speedBase = Math.max(0.001, player.hero.speed * speedMult);
    const rightX = Math.cos(player.facing);
    const rightZ = -Math.sin(player.facing);
    const fwdX = Math.sin(player.facing);
    const fwdZ = Math.cos(player.facing);
    // Raw displacement/dt is correct but noisy frame-to-frame (it jumps the moment
    // a correction lands, and dt itself varies), which showed up as a 6x rise in
    // measured limb jerk. Damp it into a dedicated ANIMATION velocity: the gait
    // still stops dead against a wall, without the per-frame chatter. Deliberately
    // separate from this.vel so the sim is untouched (no golden re-bless).
    if (dt > 0) {
      this.animVel.x = damp(this.animVel.x, (player.pos.x - preX) / dt, 16, dt);
      this.animVel.y = damp(this.animVel.y, (player.pos.z - preZ) / dt, 16, dt);
    }
    const movX = this.animVel.x, movZ = this.animVel.y;
    player.animMoveAmount = clamp01(Math.hypot(movX, movZ) / speedBase);
    player.animMoveX = Math.max(-1, Math.min(1, (movX * rightX + movZ * rightZ) / speedBase));
    player.animMoveZ = Math.max(-1, Math.min(1, (movX * fwdX + movZ * fwdZ) / speedBase));
    this.ctx.cam.setSpeed(player.animMoveAmount); // speed widens FOV + dollies out (IDEAS-GRAPHICS #49)
    this.ctx.cam.target.set(player.pos.x, 0, player.pos.z);
  }

  // ------------------------------------------------------------- lock-on / auto-aim
  // living() is already alive-filtered; iterate it directly with an inline hp>0 check
  // rather than allocating a second filtered array every gamepad frame.

  /** Ensure a live target, picking the nearest if we have none. Returns whether one exists. */
  private acquireTarget(): boolean {
    if (!this.target || !this.target.alive || this.target.hp <= 0) {
      const p = this.ctx.player.pos;
      let best: Enemy | null = null, bd = Infinity;
      for (const e of this.ctx.enemies.living()) {
        if (e.hp <= 0) continue;
        const d = (e.pos.x - p.x) ** 2 + (e.pos.z - p.z) ** 2;
        if (d < bd) { bd = d; best = e; }
      }
      this.target = best;
    }
    return !!this.target;
  }

  /** [Y] — cycle to the next enemy by distance (wraps). Edge-triggered, so a sort is fine. */
  private cycleTarget(): void {
    const p = this.ctx.player.pos;
    const list = this.ctx.enemies.living().filter((e) => e.hp > 0).sort(
      (a, b) => ((a.pos.x - p.x) ** 2 + (a.pos.z - p.z) ** 2) - ((b.pos.x - p.x) ** 2 + (b.pos.z - p.z) ** 2)
    );
    if (!list.length) { this.target = null; return; }
    const i = this.target ? list.indexOf(this.target) : -1;
    this.target = list[(i + 1) % list.length];
    this.ctx.events.emit("UI_CLICK", {});
  }

  /** Right-stick flick re-locks onto the enemy best aligned with the aim direction. */
  private targetTowardDir(ax: number, az: number): void {
    const p = this.ctx.player.pos;
    let best: Enemy | null = null, bestDot = 0.35; // require reasonable alignment to switch
    for (const e of this.ctx.enemies.living()) {
      if (e.hp <= 0) continue;
      const ex = e.pos.x - p.x, ez = e.pos.z - p.z;
      const el = Math.hypot(ex, ez) || 1;
      const dot = (ex / el) * ax + (ez / el) * az;
      if (dot > bestDot) { bestDot = dot; best = e; }
    }
    if (best) this.target = best;
  }

  private updateReticle(dt: number): void {
    if (!this.reticle) {
      const geo = new THREE.RingGeometry(0.78, 0.96, 4, 1); // a diamond bracket
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({ color: 0xff5a6e, transparent: true, opacity: 0.92, depthWrite: false });
      this.reticle = new THREE.Mesh(geo, mat);
      this.reticle.renderOrder = 6;
      this.reticle.userData.solidity = "fx";
      this.ctx.stage.scene.add(this.reticle);
    }
    const t = this.target;
    if (t && t.alive) {
      this.reticle.visible = true;
      this.reticleSpin += 0.9 * dt;
      const s = (t.radius || 0.8) * 2.2;
      this.reticle.position.set(t.pos.x, 0.07, t.pos.z);
      this.reticle.rotation.y = this.reticleSpin;
      this.reticle.scale.setScalar(s);
    } else {
      this.reticle.visible = false;
    }
  }
}
