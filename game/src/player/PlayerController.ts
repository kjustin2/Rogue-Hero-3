import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Player } from "./Player";
import { FrameInput } from "../input/InputController";
import { Mesh } from "@babylonjs/core/Meshes/mesh";

export interface ArenaCollision {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  pillars: Mesh[];
}

/**
 * Kinematic controller — directly translates the player transform.
 * Havok CharacterController upgrade slated for M2 (alongside enemy collision).
 */
export class PlayerController {
  arena: ArenaCollision;

  constructor(private player: Player, arena: ArenaCollision) {
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

    // Begin dodge
    if (input.dodgePressed && !p.isDodging && p.dodgeCooldownTimer <= 0) {
      const dir =
        input.move.lengthSquared() > 1e-3
          ? input.move.clone().normalize()
          : p.facing.clone();
      p.dodgeDir.copyFrom(dir);
      p.isDodging = true;
      p.dodgeTimer = p.stats.dodgeDuration;
    }

    // Compute movement vector
    let mv: Vector3;
    let speed: number;
    if (p.isDodging) {
      mv = p.dodgeDir;
      speed = p.stats.dodgeSpeed;
    } else {
      mv = input.move;
      speed = p.stats.moveSpeed;
    }

    const dx = mv.x * speed * dt;
    const dz = mv.z * speed * dt;

    // Tentative new position
    let nx = p.root.position.x + dx;
    let nz = p.root.position.z + dz;

    // Bounds clamp
    const r = p.stats.radius;
    if (nx < this.arena.bounds.minX + r) nx = this.arena.bounds.minX + r;
    if (nx > this.arena.bounds.maxX - r) nx = this.arena.bounds.maxX - r;
    if (nz < this.arena.bounds.minZ + r) nz = this.arena.bounds.minZ + r;
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

    // Aim & facing
    p.setAimMarker(input.aimPoint);
    if (input.aimPoint) {
      p.faceTowards(input.aimPoint);
    } else if (mv.lengthSquared() > 1e-3) {
      // Fall back to facing in move direction
      const tmp = new Vector3(p.root.position.x + mv.x, 0, p.root.position.z + mv.z);
      p.faceTowards(tmp);
    }

    // Drive the humanoid's walk bob + sword arm sway + dodge lean.
    const moving = !p.isDodging && mv.lengthSquared() > 1e-3;
    p.tickAnim(dt, moving);
  }
}
