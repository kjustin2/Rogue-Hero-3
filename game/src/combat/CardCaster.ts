import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Player } from "../player/Player";
import { Enemy } from "../enemies/Enemy";
import { EnemyManager } from "../enemies/EnemyManager";
import { TempoSystem } from "../tempo/TempoSystem";
import { ProjectileSystem } from "./handlers/projectile";
import { CardDef } from "../deck/CardDefinitions";
import { events } from "../engine/EventBus";

/** Payload for a card's visual arc/line — consumed by main.ts to spawn an ephemeral fx mesh. */
export interface CardArcFx {
  /** Visual kind drives which pooled mesh family is used. */
  kind: "arc" | "dash" | "aoe" | "slam" | "chain" | "shield";
  /** meters — for arc: swing radius; for dash: distance; for aoe/slam: radius */
  range: number;
  /** degrees — arc cards only */
  arcDegrees?: number;
  /** world origin (player feet) */
  x: number;
  z: number;
  /** world forward unit vector (for arc center / dash direction) */
  fx: number;
  fz: number;
  /** chain arcs: list of x/z target points to draw ribbons between (origin → t0 → t1 → ...). */
  chainPoints?: number[];
  /** aerial slam: world Y of the impact point (for ground-disc placement). */
  y?: number;
}

/**
 * Dispatches a played card to its handler. Six type buckets are wired:
 *
 *   melee        — wide arc swing in front of the player
 *   projectile   — Bolt / Chain Lightning (latter is a projectile that arcs to N targets)
 *   dash         — line-segment sweep with teleport at the end
 *   aoe          — radial-from-player burst (Frost Nova) with optional status effect
 *   aerial       — downward slam, gated by Player.isAirborne(); resolves on landing
 *   utility      — non-damage support (Aegis grants an absorb-shield)
 *
 * Damage composition: tempo.damageMultiplier × items.damageMultiplier(card) × card.damage.
 * Item hooks (onCardCast / onEnemyHit / onKill / cardCostOverride / damageMultiplier)
 * are intentionally read by reference — main.ts wires the ItemManager via setItemHooks().
 */
export interface ItemHooks {
  cardCostOverride(card: CardDef): number | null;
  damageMultiplier(card: CardDef): number;
  onCardCast(card: CardDef, hits: Enemy[]): void;
  onEnemyHit(enemy: Enemy, dmg: number, card: CardDef): void;
  onKill(enemy: Enemy, card: CardDef): void;
}

const NULL_HOOKS: ItemHooks = {
  cardCostOverride: () => null,
  damageMultiplier: () => 1.0,
  onCardCast: () => {},
  onEnemyHit: () => {},
  onKill: () => {},
};

export class CardCaster {
  private hooks: ItemHooks = NULL_HOOKS;

  constructor(
    private player: Player,
    private enemies: EnemyManager,
    private tempo: TempoSystem,
    private projectiles: ProjectileSystem,
  ) {}

  setItemHooks(hooks: ItemHooks): void {
    this.hooks = hooks;
  }

  /** Returns true if the card was successfully played (AP was sufficient + gating passed). */
  cast(card: CardDef, aimPoint: Vector3 | null): boolean {
    // Aerial gating BEFORE AP cost so a misclick mid-walk doesn't burn AP.
    if (card.requiresAirborne && !this.player.isAirborne()) {
      events.emit("CARD_FAIL", { reason: "not_airborne" });
      return false;
    }
    // Dashes and ground-only attacks should not fire mid-air. Aerial cards
    // are the only thing castable while airborne.
    if (this.player.isAirborne() && !card.requiresAirborne && card.type !== "utility") {
      events.emit("CARD_FAIL", { reason: "airborne_block" });
      return false;
    }

    const cost = this.hooks.cardCostOverride(card) ?? card.cost;
    if (this.player.ap < cost) {
      events.emit("CARD_FAIL", { reason: "no_ap" });
      return false;
    }
    this.player.ap -= cost;

    const dmgMult = this.tempo.damageMultiplier() * this.hooks.damageMultiplier(card);
    const dmg = Math.max(0, Math.round(card.damage * dmgMult));

    let hits: Enemy[] = [];
    switch (card.type) {
      case "melee":
        hits = this.castMelee(card, dmg);
        break;
      case "projectile":
        hits = this.castProjectile(card, dmg, aimPoint);
        break;
      case "dash":
        hits = this.castDash(card, dmg);
        break;
      case "aoe":
        hits = this.castAoe(card, dmg);
        break;
      case "aerial":
        hits = this.castAerial(card, dmg);
        break;
      case "utility":
        hits = this.castUtility(card, dmg);
        break;
    }

    this.tempo.add(card.tempoShift);
    this.hooks.onCardCast(card, hits);
    events.emit("CARD_PLAYED", { id: card.id });
    return true;
  }

  private castMelee(card: CardDef, dmg: number): Enemy[] {
    const px = this.player.root.position.x;
    const pz = this.player.root.position.z;
    const fx = this.player.facing.x;
    const fz = this.player.facing.z;
    const arcDeg = card.arcDegrees ?? 140;
    const halfArcCos = Math.cos((arcDeg / 2) * (Math.PI / 180));
    const isOmni = arcDeg >= 360;
    const knockForce = card.id === "crashing_blow" ? 9 : 5.5;
    const out: Enemy[] = [];
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
        e.knockback(fx, fz, knockForce);
        this.hooks.onEnemyHit(e, dmg, card);
        if (!e.alive) this.hooks.onKill(e, card);
        out.push(e); hits++;
        continue;
      }
      const dot = (dx / dist) * fx + (dz / dist) * fz;
      if (isOmni || dot >= halfArcCos) {
        e.takeDamage(dmg);
        e.knockback(dx / dist, dz / dist, knockForce);
        this.hooks.onEnemyHit(e, dmg, card);
        if (!e.alive) this.hooks.onKill(e, card);
        out.push(e); hits++;
      }
    }
    if (hits > 0) events.emit("COMBO_HIT", { hitNum: 1, count: hits });
    events.emit<CardArcFx>("CARD_FX", {
      kind: "arc",
      range: card.range,
      arcDegrees: arcDeg,
      x: px, z: pz, fx, fz,
    });
    return out;
  }

  private castProjectile(card: CardDef, dmg: number, aimPoint: Vector3 | null): Enemy[] {
    const origin = this.player.root.position;
    let dir: Vector3;
    if (aimPoint) {
      dir = new Vector3(aimPoint.x - origin.x, 0, aimPoint.z - origin.z);
    } else {
      dir = new Vector3(this.player.facing.x, 0, this.player.facing.z);
    }
    const len = Math.hypot(dir.x, dir.z);
    const offsetDist = 0.7;
    const spawn = len > 1e-4
      ? new Vector3(origin.x + (dir.x / len) * offsetDist, origin.y, origin.z + (dir.z / len) * offsetDist)
      : origin;

    if (card.chainCount && card.chainCount > 1) {
      // Instant-resolve chain: pick the closest enemy in cone, then jump up to
      // (chainCount-1) more times to nearest within 6m. Damage applies per hop;
      // the FX layer renders ribbons between the picked points.
      const out = this.resolveChain(card, dmg, spawn, dir);
      this.player.triggerCast("bolt");
      events.emit("CAST_FX", { kind: "bolt", x: spawn.x, y: 1.2, z: spawn.z });
      return out;
    }

    this.projectiles.fire(spawn, dir, 28, dmg, card.range / 28 + 0.1);
    this.player.triggerCast("bolt");
    events.emit("CAST_FX", { kind: "bolt", x: spawn.x, y: 1.2, z: spawn.z });
    // Real hits resolved by ProjectileSystem on contact — return empty for now;
    // hook resolution happens via the PROJECTILE_HIT event in main.ts.
    return [];
  }

  /** Chain Lightning resolution: instant-hit, jumps to chainCount-1 nearest neighbors. */
  private resolveChain(card: CardDef, dmg: number, origin: Vector3, dir: Vector3): Enemy[] {
    const maxRange = card.range;
    const dirLen = Math.hypot(dir.x, dir.z) || 1;
    const dirNx = dir.x / dirLen;
    const dirNz = dir.z / dirLen;
    const used = new Set<Enemy>();
    const path: Enemy[] = [];
    const points: number[] = [origin.x, origin.z];

    // First target: nearest enemy in a 60° cone in front, within maxRange.
    let primary: Enemy | null = null;
    let primaryDist = Infinity;
    for (const e of this.enemies.enemies) {
      if (!e.alive) continue;
      const dx = e.root.position.x - origin.x;
      const dz = e.root.position.z - origin.z;
      const d = Math.hypot(dx, dz);
      if (d > maxRange) continue;
      const dot = (dx / (d || 1)) * dirNx + (dz / (d || 1)) * dirNz;
      if (dot < 0.5) continue; // 60° cone
      if (d < primaryDist) { primaryDist = d; primary = e; }
    }
    if (!primary) {
      // No target: still emit a forward-cast FX so the cast doesn't feel dead.
      events.emit<CardArcFx>("CARD_FX", {
        kind: "chain", range: maxRange, x: origin.x, z: origin.z, fx: dirNx, fz: dirNz,
        chainPoints: [...points, origin.x + dirNx * maxRange, origin.z + dirNz * maxRange],
      });
      return [];
    }
    path.push(primary); used.add(primary);
    points.push(primary.root.position.x, primary.root.position.z);

    // Hop up to chainCount-1 more times, jumping to nearest unused within 6m.
    const total = card.chainCount ?? 3;
    const jumpRadius = 6;
    let cur: Enemy = primary;
    for (let h = 1; h < total; h++) {
      let next: Enemy | null = null;
      let nextDist = jumpRadius;
      for (const e of this.enemies.enemies) {
        if (!e.alive || used.has(e)) continue;
        const dx = e.root.position.x - cur.root.position.x;
        const dz = e.root.position.z - cur.root.position.z;
        const d = Math.hypot(dx, dz);
        if (d <= nextDist) { nextDist = d; next = e; }
      }
      if (!next) break;
      path.push(next); used.add(next);
      points.push(next.root.position.x, next.root.position.z);
      cur = next;
    }

    // Apply damage along the path. Each hop deals card.damage (no falloff for now).
    for (const e of path) {
      e.takeDamage(dmg);
      const dx = e.root.position.x - origin.x;
      const dz = e.root.position.z - origin.z;
      const dl = Math.hypot(dx, dz) || 1;
      e.knockback(dx / dl, dz / dl, 3.0);
      this.hooks.onEnemyHit(e, dmg, card);
      if (!e.alive) this.hooks.onKill(e, card);
    }
    if (path.length > 0) events.emit("COMBO_HIT", { hitNum: 1, count: path.length });

    events.emit<CardArcFx>("CARD_FX", {
      kind: "chain", range: maxRange, x: origin.x, z: origin.z, fx: dirNx, fz: dirNz,
      chainPoints: points,
    });
    return path;
  }

  private castDash(card: CardDef, dmg: number): Enemy[] {
    const dir = new Vector3(this.player.facing.x, 0, this.player.facing.z);
    const dist = card.range;
    const startX = this.player.root.position.x;
    const startZ = this.player.root.position.z;
    const endX = startX + dir.x * dist;
    const endZ = startZ + dir.z * dist;

    const dxLine = endX - startX;
    const dzLine = endZ - startZ;
    const lenSq = dxLine * dxLine + dzLine * dzLine;
    const out: Enemy[] = [];
    let hits = 0;
    if (!card.iframeOnly) {
      for (const e of this.enemies.enemies) {
        if (!e.alive) continue;
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
          e.knockback(dir.x, dir.z, 7);
          this.hooks.onEnemyHit(e, dmg, card);
          if (!e.alive) this.hooks.onKill(e, card);
          out.push(e); hits++;
        }
      }
    }
    if (hits > 0) events.emit("COMBO_HIT", { hitNum: 1, count: hits });

    events.emit<CardArcFx>("CARD_FX", {
      kind: "dash", range: dist, x: startX, z: startZ, fx: dir.x, fz: dir.z,
    });

    this.player.root.position.x = endX;
    this.player.root.position.z = endZ;
    this.player.isDodging = true;
    // Phase Step grants longer i-frames to compensate for the lost damage.
    this.player.dodgeTimer = card.iframeOnly ? 0.45 : 0.12;
    this.player.triggerCast("dash");
    this.player.snapFacingNextFrame();
    return out;
  }

  /** Radial-from-player AoE (Frost Nova). Applies optional freeze. */
  private castAoe(card: CardDef, dmg: number): Enemy[] {
    const px = this.player.root.position.x;
    const pz = this.player.root.position.z;
    const radius = card.aoeRadius ?? card.range;
    const out: Enemy[] = [];
    let hits = 0;
    for (const e of this.enemies.enemies) {
      if (!e.alive) continue;
      const dx = e.root.position.x - px;
      const dz = e.root.position.z - pz;
      const reach = radius + e.def.radius;
      if (dx * dx + dz * dz > reach * reach) continue;
      e.takeDamage(dmg);
      const d = Math.hypot(dx, dz) || 1;
      e.knockback(dx / d, dz / d, 2.5);
      if (card.effect === "freeze") e.applyFreeze?.(1.2);
      this.hooks.onEnemyHit(e, dmg, card);
      if (!e.alive) this.hooks.onKill(e, card);
      out.push(e); hits++;
    }
    if (hits > 0) events.emit("COMBO_HIT", { hitNum: 1, count: hits });
    events.emit<CardArcFx>("CARD_FX", {
      kind: "aoe", range: radius, x: px, z: pz, fx: 0, fz: 1,
    });
    return out;
  }

  /**
   * Aerial slam — pins player into a downward dive and stores the card id; the
   * actual radial damage resolves on PLAYER_LANDED in main.ts so the impact
   * lines up visually with the ground hit. Damage isn't applied here.
   */
  private castAerial(card: CardDef, _dmg: number): Enemy[] {
    this.player.aerialSlamming = true;
    this.player.pendingAerialCardId = card.id;
    this.player.verticalVelocity = -22;
    this.player.triggerCast("dash");
    return [];
  }

  /** Utility cards apply a non-damage effect to the player or party. */
  private castUtility(card: CardDef, _dmg: number): Enemy[] {
    if (card.effect === "shield") {
      this.player.grantShield(25, 4);
      events.emit<CardArcFx>("CARD_FX", {
        kind: "shield",
        range: 1,
        x: this.player.root.position.x,
        z: this.player.root.position.z,
        fx: this.player.facing.x,
        fz: this.player.facing.z,
      });
    }
    return [];
  }
}
