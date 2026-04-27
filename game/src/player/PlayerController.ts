import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Player } from "./Player";
import { FrameInput } from "../input/InputController";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TempoSystem } from "../tempo/TempoSystem";

export interface ArenaCollision {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  pillars: Mesh[];
  /** When `active`, the player may step past `bounds.minZ` (south wall) so long
   *  as their X is between `xMin` and `xMax` — used to walk through an unlocked
   *  exit door at the doorway opening. Reference is read live every frame, so
   *  the room's runtime systems can flip it on/off without re-binding. */
  doorPass?: { active: boolean; xMin: number; xMax: number };
}

/**
 * Kinematic controller — directly translates the player transform.
 * Havok CharacterController upgrade slated for M2 (alongside enemy collision).
 *
 * Movement and dodge speed are multiplied by the current tempo.speedMultiplier
 * so high tempo feels physically faster (and low tempo, sluggish). The
 * multiplier is read every frame so zone transitions are immediate.
 */
export class PlayerController {
  arena: ArenaCollision;
  // Reused scratch buffers — `update()` runs every frame, so any new Vector3
  // allocation here is GC pressure during sustained movement.
  private dirBuf = new Vector3();
  private faceBuf = new Vector3();

  constructor(private player: Player, arena: ArenaCollision, private tempo: TempoSystem) {
    this.arena = arena;
  }

  setArena(arena: ArenaCollision): void {
    this.arena = arena;
  }

  update(dt: number, input: FrameInput): void {
    const p = this.player;

    // Tick timers
    if (p.dodgeCooldownTimer > 0) p.dodgeCooldownTimer = Math.max(0, p.dodgeCooldownTimer - dt);
    if (p.isDodging) {
      p.dodgeTimer -= dt;
      if (p.dodgeTimer <= 0) {
        p.isDodging = false;
        p.dodgeCooldownTimer = p.stats.dodgeCooldown;
      }
    }

    // Begin dodge — direction is the move input (normalized) when present,
    // otherwise the current facing. Using the scratch dirBuf so dodge presses
    // don't allocate.
    if (input.dodgePressed && !p.isDodging && p.dodgeCooldownTimer <= 0) {
      if (input.move.lengthSquared() > 1e-3) {
        this.dirBuf.copyFrom(input.move);
        const len = Math.hypot(this.dirBuf.x, this.dirBuf.z);
        if (len > 1e-6) {
          this.dirBuf.x /= len;
          this.dirBuf.z /= len;
        }
      } else {
        this.dirBuf.copyFrom(p.facing);
      }
      p.dodgeDir.copyFrom(this.dirBuf);
      p.isDodging = true;
      p.dodgeTimer = p.stats.dodgeDuration;
    }

    // Compute movement vector. Tempo multiplier shapes everything — at HOT/CRITICAL
    // the player surges forward, at COLD they slog. Dodge inherits the same
    // multiplier so the entire "feel" of high tempo is present in motion, not
    // just damage numbers.
    const tempoMul = this.tempo.speedMultiplier();
    let mv: Vector3;
    let speed: number;
    if (p.isDodging) {
      mv = p.dodgeDir;
      speed = p.stats.dodgeSpeed * tempoMul;
    } else {
      mv = input.move;
      speed = p.stats.moveSpeed * tempoMul;
    }

    const dx = mv.x * speed * dt;
    const dz = mv.z * speed * dt;

    // Tentative new position
    let nx = p.root.position.x + dx;
    let nz = p.root.position.z + dz;

    // Bounds clamp — with one wrinkle: when the room's exit door is unlocked
    // (`doorPass.active`) and the player is centered in the doorway opening,
    // skip the minZ clamp so they can step out into the hallway. The X clamp
    // still holds (player can't walk into the door frame side-walls).
    const r = p.stats.radius;
    if (nx < this.arena.bounds.minX + r) nx = this.arena.bounds.minX + r;
    if (nx > this.arena.bounds.maxX - r) nx = this.arena.bounds.maxX - r;
    const dp = this.arena.doorPass;
    const inDoor = !!dp && dp.active && nx > dp.xMin + r && nx < dp.xMax - r;
    if (!inDoor && nz < this.arena.bounds.minZ + r) nz = this.arena.bounds.minZ + r;
    if (nz > this.arena.bounds.maxZ - r) nz = this.arena.bounds.maxZ - r;

    // Pillar collision (squared-distance check, push out)
    for (const pillar of this.arena.pillars) {
      const px = pillar.position.x;
      const pz = pillar.position.z;
      const ddx = nx - px;
      const ddz = nz - pz;
      const minDist = 0.8 + r; // pillar diameter 1.6 → radius 0.8
      const distSq = ddx * ddx + ddz * ddz;
      if (distSq < minDist * minDist && distSq > 1e-6) {
        const dist = Math.sqrt(distSq);
        const nxn = ddx / dist;
        const nzn = ddz / dist;
        nx = px + nxn * minDist;
        nz = pz + nzn * minDist;
      }
    }

    p.root.position.x = nx;
    p.root.position.z = nz;

    // Aim & facing — fall back to move direction when there's no aim. Reuses
    // faceBuf so the fallback path doesn't allocate every frame the player
    // walks without aiming.
    p.setAimMarker(input.aimPoint);
    if (input.aimPoint) {
      p.faceTowards(input.aimPoint);
    } else if (mv.lengthSquared() > 1e-3) {
      this.faceBuf.set(p.root.position.x + mv.x, 0, p.root.position.z + mv.z);
      p.faceTowards(this.faceBuf);
    }

    // Drive the humanoid's walk bob + sword arm sway + dodge lean.
    const moving = !p.isDodging && mv.lengthSquared() > 1e-3;
    p.tickAnim(dt, moving);
  }
}
