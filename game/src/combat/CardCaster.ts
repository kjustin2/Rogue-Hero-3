import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Player } from "../player/Player";
import { EnemyManager } from "../enemies/EnemyManager";
import { TempoSystem } from "../tempo/TempoSystem";
import { ProjectileSystem } from "./handlers/projectile";
import { CardDef } from "../deck/CardDefinitions";
import { events } from "../engine/EventBus";

/** Payload for a card's visual arc/line — consumed by main.ts to spawn an ephemeral fx mesh. */
export interface CardArcFx {
  kind: "arc" | "dash";
  /** meters — for arc: swing radius; for dash: distance */
  range: number;
  /** degrees — arc cards only */
  arcDegrees?: number;
  /** world origin (player feet) */
  x: number;
  z: number;
  /** world forward unit vector (for arc center / dash direction) */
  fx: number;
  fz: number;
}

/**
 * Dispatches a played card to its handler.
 * Mirrors rogue-hero-2/src/Combat.js executeCard() type→handler dispatch table,
 * but only the three MVP types (melee, projectile, dash) are implemented.
 */
export class CardCaster {
  constructor(
    private player: Player,
    private enemies: EnemyManager,
    private tempo: TempoSystem,
    private projectiles: ProjectileSystem,
  ) {}

  /** Returns true if the card was successfully played (AP was sufficient). */
  cast(card: CardDef, aimPoint: Vector3 | null): boolean {
    if (this.player.ap < card.cost) {
      events.emit("CARD_FAIL", { reason: "no_ap" });
      return false;
    }
    this.player.ap -= card.cost;

    const dmgMult = this.tempo.damageMultiplier();
    const dmg = Math.round(card.damage * dmgMult);

    switch (card.type) {
      case "melee":
        this.castMelee(card, dmg);
        break;
      case "projectile":
        this.castProjectile(card, dmg, aimPoint);
        break;
      case "dash":
        this.castDash(card, dmg);
        break;
    }

    this.tempo.add(card.tempoShift);
    events.emit("CARD_PLAYED", { id: card.id });
    return true;
  }

  private castMelee(card: CardDef, dmg: number): void {
    const px = this.player.root.position.x;
    const pz = this.player.root.position.z;
    const fx = this.player.facing.x;
    const fz = this.player.facing.z;
    const arcDeg = 140; // wide cleave
    const halfArcCos = Math.cos((arcDeg / 2) * (Math.PI / 180));
    let hits = 0;
    for (const e of this.enemies.enemies) {
      if (!e.alive) continue;
      const dx = e.root.position.x - px;
      const dz = e.root.position.z - pz;
      const reach = card.range + e.def.radius;
      if (dx * dx + dz * dz > reach * reach) continue;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 1e-4) {
        e.takeDamage(dmg);
        // Knock outward along the enemy-from-player vector; fall back to facing
        // when the enemy is exactly on top of us.
        e.knockback(fx, fz, 5.5);
        hits++;
        continue;
      }
      const dot = (dx / dist) * fx + (dz / dist) * fz;
      if (dot >= halfArcCos) {
        e.takeDamage(dmg);
        // Melee knockback is radial-from-player so enemies scatter outward, not all sideways.
        e.knockback(dx / dist, dz / dist, 5.5);
        hits++;
      }
    }
    if (hits > 0) events.emit("COMBO_HIT", { hitNum: 1, count: hits });
    events.emit<CardArcFx>("CARD_FX", {
      kind: "arc",
      range: card.range,
      arcDegrees: arcDeg,
      x: px, z: pz, fx, fz,
    });
  }

  private castProjectile(card: CardDef, dmg: number, aimPoint: Vector3 | null): void {
    const origin = this.player.root.position;
    let dir: Vector3;
    if (aimPoint) {
      dir = new Vector3(aimPoint.x - origin.x, 0, aimPoint.z - origin.z);
    } else {
      dir = new Vector3(this.player.facing.x, 0, this.player.facing.z);
    }
    this.projectiles.fire(origin, dir, 28, dmg, card.range / 28 + 0.1);
  }

  private castDash(card: CardDef, dmg: number): void {
    const dir = new Vector3(this.player.facing.x, 0, this.player.facing.z);
    const dist = card.range;
    const startX = this.player.root.position.x;
    const startZ = this.player.root.position.z;
    const endX = startX + dir.x * dist;
    const endZ = startZ + dir.z * dist;

    // Damage anything within 1.0m of the swept line segment
    const dxLine = endX - startX;
    const dzLine = endZ - startZ;
    const lenSq = dxLine * dxLine + dzLine * dzLine;
    let hits = 0;
    for (const e of this.enemies.enemies) {
      if (!e.alive) continue;
      // Project enemy position onto the line, clamp to [0, len], measure perpendicular distance.
      const ex = e.root.position.x - startX;
      const ez = e.root.position.z - startZ;
      const t = lenSq > 1e-6 ? Math.max(0, Math.min(1, (ex * dxLine + ez * dzLine) / lenSq)) : 0;
      const cx = startX + dxLine * t;
      const cz = startZ + dzLine * t;
      const ddx = e.root.position.x - cx;
      const ddz = e.root.position.z - cz;
      const reach = 1.0 + e.def.radius;
      if (ddx * ddx + ddz * ddz <= reach * reach) {
        e.takeDamage(dmg);
        // Dash knockback pushes along the dash direction — sells the "sweeping through" read.
        e.knockback(dir.x, dir.z, 7);
        hits++;
      }
    }
    if (hits > 0) events.emit("COMBO_HIT", { hitNum: 1, count: hits });

    events.emit<CardArcFx>("CARD_FX", {
      kind: "dash",
      range: dist,
      x: startX, z: startZ,
      fx: dir.x, fz: dir.z,
    });

    // Move player (the caller — main.ts — is responsible for arena clamping; we just teleport here)
    this.player.root.position.x = endX;
    this.player.root.position.z = endZ;
    this.player.isDodging = true;
    this.player.dodgeTimer = 0.12; // brief i-frames after dash
  }
}
