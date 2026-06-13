import * as THREE from "three";
import { ARENA_RADIUS } from "../render/arena";
import { clamp01, damp } from "../core/math";
import type { Ctx } from "./ctx";

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

  constructor(private ctx: Ctx) {}

  get dodging(): boolean {
    return this.dodgeTimer >= 0 && this.dodgeTimer < DODGE_DURATION;
  }

  get invulnerable(): boolean {
    return this.dodging;
  }

  get inPerfectWindow(): boolean {
    return this.dodging && this.dodgeTimer < PERFECT_WINDOW && !this.perfectConsumed;
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
      return;
    }

    // Facing: always toward cursor
    const aim = input.aimPoint;
    const dx = aim.x - player.pos.x;
    const dz = aim.z - player.pos.z;
    if (dx * dx + dz * dz > 0.04) {
      player.facing = Math.atan2(dx, dz);
    }
    this.ctx.cam.aimPoint.copy(aim);

    // Input direction
    let ix = 0;
    let iz = 0;
    if (input.down("KeyW") || input.down("ArrowUp")) iz -= 1;
    if (input.down("KeyS") || input.down("ArrowDown")) iz += 1;
    if (input.down("KeyA") || input.down("ArrowLeft")) ix -= 1;
    if (input.down("KeyD") || input.down("ArrowRight")) ix += 1;
    const inputLen = Math.hypot(ix, iz);
    if (inputLen > 0) {
      ix /= inputLen;
      iz /= inputLen;
    }

    this.dodgeCooldown -= dt;
    this.externalMoveTimer = Math.max(0, this.externalMoveTimer - dt);

    // Start dodge
    if (
      (input.pressed("Space") || input.pressed("ShiftLeft") || input.mousePressed[2]) &&
      this.dodgeCooldown <= 0 &&
      !this.dodging
    ) {
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

    player.animMoveAmount = clamp01(this.vel.length() / player.hero.speed);
    this.ctx.cam.target.set(player.pos.x, 0, player.pos.z);
  }
}
