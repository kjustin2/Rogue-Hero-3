import * as THREE from "three";
import { ARENA_RADIUS } from "../render/arena";
import { clamp01, damp } from "../core/math";
import type { Ctx } from "./ctx";
import type { Enemy } from "./enemies";

const DODGE_DURATION = 0.22;
const DODGE_SPEED = 17;
const DODGE_COOLDOWN = 0.5;
const PERFECT_WINDOW = 0.11;

/**
 * Input → hero movement. Snappy damped velocity, twin-stick facing (always
 * toward the cursor), and the dodge roll with i-frames + a perfect-dodge
 * window at the start that pays out tempo when an attack whiffs through it.
 */
export class Controller {
  private vel = new THREE.Vector2();
  private dodgeTimer = -1;
  private dodgeCooldown = 0;
  private dodgeDir = new THREE.Vector2(0, 1);
  private ghostAcc = 0;
  /** One perfect-dodge payout per roll. */
  private perfectConsumed = false;
  /** External pushes (cards like Dash Strike drive movement through this). */
  private impulse = new THREE.Vector2();
  /** While >0, normal input movement is suppressed (dash cards). */
  externalMoveTimer = 0;

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

  get invulnerable(): boolean {
    return this.dodging;
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
      this.updateReticle();
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

    this.dodgeCooldown -= dt;
    this.externalMoveTimer = Math.max(0, this.externalMoveTimer - dt);

    // Start dodge
    if (input.actionPressed("dodge") && this.dodgeCooldown <= 0 && !this.dodging) {
      this.dodgeTimer = 0;
      this.dodgeCooldown = DODGE_DURATION + DODGE_COOLDOWN;
      this.perfectConsumed = false;
      this.ghostAcc = 0;
      if (inputLen > 0) this.dodgeDir.set(ix, iz);
      else this.dodgeDir.set(Math.sin(player.facing), Math.cos(player.facing));
      this.ctx.events.emit("DODGE", {});
      this.ctx.fx.burst({
        x: player.pos.x, y: 0.3, z: player.pos.z,
        count: 10, color: 0x66ddff,
        speed: [1, 4], up: 0.6, size: [0.3, 0.6], life: [0.2, 0.45], gravity: -2, drag: 3,
      });
    }

    const speedMult = tempo.zone.speedMult;

    if (this.dodging) {
      this.dodgeTimer += dt;
      this.vel.set(this.dodgeDir.x, this.dodgeDir.y).multiplyScalar(DODGE_SPEED * (0.8 + speedMult * 0.2));
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
        player.animDodge = null;
      }
    } else if (this.externalMoveTimer <= 0) {
      const target = player.hero.speed * speedMult;
      this.vel.x = damp(this.vel.x, ix * target, 11, dt);
      this.vel.y = damp(this.vel.y, iz * target, 11, dt);
    }

    // Apply impulse (decays quickly)
    this.vel.x += this.impulse.x;
    this.vel.y += this.impulse.y;
    this.impulse.set(0, 0);

    player.pos.x += this.vel.x * dt;
    player.pos.z += this.vel.y * dt;

    // Arena bounds (circle)
    const r = Math.hypot(player.pos.x, player.pos.z);
    const maxR = ARENA_RADIUS - player.radius;
    if (r > maxR) {
      player.pos.x *= maxR / r;
      player.pos.z *= maxR / r;
    }
    this.ctx.arena.resolveObstacles(player.pos, player.radius);

    const speedBase = Math.max(0.001, player.hero.speed);
    const rightX = Math.cos(player.facing);
    const rightZ = -Math.sin(player.facing);
    const fwdX = Math.sin(player.facing);
    const fwdZ = Math.cos(player.facing);
    player.animMoveAmount = clamp01(this.vel.length() / speedBase);
    player.animMoveX = Math.max(-1, Math.min(1, (this.vel.x * rightX + this.vel.y * rightZ) / speedBase));
    player.animMoveZ = Math.max(-1, Math.min(1, (this.vel.x * fwdX + this.vel.y * fwdZ) / speedBase));
    this.ctx.cam.target.set(player.pos.x, 0, player.pos.z);
  }

  // ------------------------------------------------------------- lock-on / auto-aim
  private livingTargets(): Enemy[] {
    return this.ctx.enemies.living().filter((e) => e.alive && e.hp > 0);
  }

  /** Ensure a live target, picking the nearest if we have none. Returns whether one exists. */
  private acquireTarget(): boolean {
    if (!this.target || !this.target.alive || this.target.hp <= 0) {
      const p = this.ctx.player.pos;
      let best: Enemy | null = null, bd = Infinity;
      for (const e of this.livingTargets()) {
        const d = (e.pos.x - p.x) ** 2 + (e.pos.z - p.z) ** 2;
        if (d < bd) { bd = d; best = e; }
      }
      this.target = best;
    }
    return !!this.target;
  }

  /** [Y] — cycle to the next enemy by distance (wraps). */
  private cycleTarget(): void {
    const p = this.ctx.player.pos;
    const list = this.livingTargets().sort(
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
    for (const e of this.livingTargets()) {
      const ex = e.pos.x - p.x, ez = e.pos.z - p.z;
      const el = Math.hypot(ex, ez) || 1;
      const dot = (ex / el) * ax + (ez / el) * az;
      if (dot > bestDot) { bestDot = dot; best = e; }
    }
    if (best) this.target = best;
  }

  private updateReticle(): void {
    if (!this.reticle) {
      const geo = new THREE.RingGeometry(0.78, 0.96, 4, 1); // a diamond bracket
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({ color: 0xff5a6e, transparent: true, opacity: 0.92, depthWrite: false });
      this.reticle = new THREE.Mesh(geo, mat);
      this.reticle.renderOrder = 6;
      this.ctx.stage.scene.add(this.reticle);
    }
    const t = this.target;
    if (t && t.alive) {
      this.reticle.visible = true;
      this.reticleSpin += 0.9 * (1 / 60);
      const s = (t.radius || 0.8) * 2.2;
      this.reticle.position.set(t.pos.x, 0.07, t.pos.z);
      this.reticle.rotation.y = this.reticleSpin;
      this.reticle.scale.setScalar(s);
    } else {
      this.reticle.visible = false;
    }
  }
}
