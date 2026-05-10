import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Player } from "../player/Player";
import { Enemy } from "../enemies/Enemy";
import { EnemyManager } from "../enemies/EnemyManager";
import { TempoSystem } from "../tempo/TempoSystem";
import { ProjectileSystem } from "./handlers/projectile";
import { HazardZones } from "./HazardZones";
import { CardDef } from "../deck/CardDefinitions";
import { CardUpgrades } from "../deck/CardUpgrades";
import { events } from "../engine/EventBus";
import { isAnomaly } from "../run/Anomalies";

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
  // Reused scratch buffers — castProjectile fires multiple times per second
  // during sustained ranged play; allocating two new Vector3s per cast was
  // showing up as GC pressure during heavy combat.
  private dirBuf = new Vector3();
  private spawnBuf = new Vector3();

  /**
   * Optional hazard-zone manager. When set, cards that drop lingering hazards
   * (Mine Field, Frost Nova field, Dash Strike trail, Phase Step phantom,
   * Meteor Slam pillars) route their patches through it. Left optional so
   * unit tests / smoke runs that don't construct HazardZones still cast.
   */
  private hazards: HazardZones | null = null;
  /** Run-scoped card upgrades + mutators. When set, resolve overrides at cast. */
  private upgrades: CardUpgrades | null = null;

  constructor(
    private player: Player,
    private enemies: EnemyManager,
    private tempo: TempoSystem,
    private projectiles: ProjectileSystem,
  ) {}

  setItemHooks(hooks: ItemHooks): void {
    this.hooks = hooks;
  }

  setHazards(hazards: HazardZones): void {
    this.hazards = hazards;
  }

  setUpgrades(u: CardUpgrades): void {
    this.upgrades = u;
  }

  /**
   * Returns true if the card was successfully played (AP was sufficient + gating passed).
   *
   * `charged = true` (CTRL+LMB in main.ts): the cast costs +1 AP, deals 1.6×
   * damage, and emits a `charged: true` flag on the CARD_PLAYED event so
   * audio/visual layers can amplify their feedback. Utility cards (Aegis)
   * ignore charging — there's no meaningful damage to amplify.
   *
   * `holdSeconds` — how long LMB has been held. Currently consumed only by
   * Charged Beam to pick the tap / piercing-line / wide-beam tier.
   *
   * `isEcho` — internal flag set by the Echo Chamber anomaly's deferred re-cast.
   * Skips AP cost and the further echo schedule so a single original cast
   * produces exactly one replay 0.5 s later.
   */
  cast(rawCard: CardDef, aimPoint: Vector3 | null, charged = false, holdSeconds = 0, isEcho = false): boolean {
    // Resolve upgrades + active mutators on top of the raw card def. Mutator
    // charges decrement on a successful cast (consume = true after AP gate).
    const override = this.upgrades?.resolveOverride(rawCard.id, false) ?? {};
    const card: CardDef = { ...rawCard, ...override };
    // Aerial gating BEFORE AP cost so a misclick mid-walk doesn't burn AP.
    if (card.requiresAirborne && !this.player.isAirborne()) {
      if (!isEcho) events.emit("CARD_FAIL", { reason: "not_airborne" });
      return false;
    }
    // Dashes and ground-only attacks should not fire mid-air. Aerial cards
    // are the only thing castable while airborne.
    if (this.player.isAirborne() && !card.requiresAirborne && card.type !== "utility") {
      if (!isEcho) events.emit("CARD_FAIL", { reason: "airborne_block" });
      return false;
    }

    // Utility cards skip the charge bonus — there's no damage to amplify.
    const isCharged = charged && card.type !== "utility";
    const baseCost = this.hooks.cardCostOverride(card) ?? card.cost;
    const cost = baseCost + (isCharged ? 1 : 0);
    if (!isEcho) {
      if (this.player.ap < cost) {
        events.emit("CARD_FAIL", { reason: "no_ap" });
        return false;
      }
      this.player.ap -= cost;
    }

    const chargeMult = isCharged ? 1.6 : 1.0;
    const dmgMult = this.tempo.damageMultiplier() * this.hooks.damageMultiplier(card) * chargeMult;
    const dmg = Math.max(0, Math.round(card.damage * dmgMult));

    let hits: Enemy[] = [];
    switch (card.type) {
      case "melee":
        hits = this.castMelee(card, dmg, isCharged);
        break;
      case "projectile":
        hits = this.castProjectile(card, dmg, aimPoint, isCharged);
        break;
      case "dash":
        hits = this.castDash(card, dmg, isCharged);
        break;
      case "aoe":
        hits = this.castAoe(card, dmg, isCharged);
        break;
      case "aerial":
        hits = this.castAerial(card, dmg, isCharged);
        break;
      case "utility":
        hits = this.castUtility(card, dmg);
        break;
      case "mine_field":
        hits = this.castMineField(card, dmg, isCharged);
        break;
      case "charged_beam":
        hits = this.castChargedBeam(card, dmg, aimPoint, isCharged, holdSeconds);
        break;
    }

    this.tempo.add(card.tempoShift);
    this.hooks.onCardCast(card, hits);
    // Consume one mutator charge per successful cast (re-resolve with consume=true).
    // Echoes don't consume — the spirit of Echo Chamber is "free re-cast".
    if (!isEcho) this.upgrades?.resolveOverride(rawCard.id, true);
    events.emit("CARD_PLAYED", { id: card.id });
    // Echo Chamber — schedule a free replay of the original card 500 ms later.
    // Only the first cast schedules; the echo flag suppresses recursion.
    if (!isEcho && isAnomaly("echo_chamber")) {
      const echoAim = aimPoint ? aimPoint.clone() : null;
      setTimeout(() => {
        if (this.player.hp > 0) this.cast(rawCard, echoAim, charged, holdSeconds, true);
      }, 500);
    }
    return true;
  }

  private castMelee(card: CardDef, dmg: number, isCharged: boolean): Enemy[] {
    const px = this.player.root.position.x;
    const pz = this.player.root.position.z;
    const fx = this.player.facing.x;
    const fz = this.player.facing.z;
    const arcDeg = card.arcDegrees ?? 140;
    const halfArcCos = Math.cos((arcDeg / 2) * (Math.PI / 180));
    const isOmni = arcDeg >= 360;
    const knockForce = card.id === "crashing_blow" ? 9 : 5.5;
    // Crashing Blow's "Heavy stagger": charged variant launches enemies airborne
    // by emitting a stronger upward knockback. We approximate "airborne" with a
    // larger knock force (no z-axis lift in this engine layer); enemies feel
    // like they get hurled. Setting them airborne by hpSquad is out of scope.
    const chargedCrash = isCharged && card.id === "crashing_blow";
    const finalKnock = chargedCrash ? knockForce * 1.5 : knockForce;
    // Cleave's signature mechanic — Bleed stacks per hit. Charged variant
    // doubles the stacks applied (2 → 4 stacks per hit, still capped at 6).
    const bleedStacks = card.id === "cleave" ? (isCharged ? 4 : 2) : 0;
    const out: Enemy[] = [];
    let hits = 0;
    for (const e of this.enemies.enemies) {
      if (!e.alive) continue;
      const dx = e.root.position.x - px;
      const dz = e.root.position.z - pz;
      const reach = card.range + e.def.radius;
      if (dx * dx + dz * dz > reach * reach) continue;
      const dist = Math.sqrt(dx * dx + dz * dz);
      let inArc = false;
      if (dist < 1e-4) {
        inArc = true;
      } else {
        const dot = (dx / dist) * fx + (dz / dist) * fz;
        if (isOmni || dot >= halfArcCos) inArc = true;
      }
      if (!inArc) continue;
      e.takeDamage(dmg);
      const knockX = dist < 1e-4 ? fx : dx / dist;
      const knockZ = dist < 1e-4 ? fz : dz / dist;
      e.knockback(knockX, knockZ, finalKnock);
      if (bleedStacks > 0) {
        e.applyBleed(bleedStacks);
        events.emit("BLEED_TICK", { enemyId: e.id, dmg: bleedStacks * Enemy.BLEED_DPS_PER_STACK });
      }
      this.hooks.onEnemyHit(e, dmg, card);
      if (!e.alive) this.hooks.onKill(e, card);
      out.push(e); hits++;
    }
    if (hits > 0) events.emit("COMBO_HIT", { hitNum: hits, count: hits });
    if (card.heavy) {
      events.emit(hits > 0 ? "HEAVY_HIT" : "HEAVY_MISS", {});
    }
    events.emit<CardArcFx>("CARD_FX", {
      kind: "arc",
      range: card.range,
      arcDegrees: arcDeg,
      x: px, z: pz, fx, fz,
    });
    return out;
  }

  private castProjectile(card: CardDef, dmg: number, aimPoint: Vector3 | null, isCharged: boolean): Enemy[] {
    const origin = this.player.root.position;
    if (aimPoint) {
      this.dirBuf.set(aimPoint.x - origin.x, 0, aimPoint.z - origin.z);
    } else {
      this.dirBuf.set(this.player.facing.x, 0, this.player.facing.z);
    }
    const dir = this.dirBuf;
    const len = Math.hypot(dir.x, dir.z);
    const offsetDist = 0.7;
    let spawn: Vector3;
    if (len > 1e-4) {
      this.spawnBuf.set(
        origin.x + (dir.x / len) * offsetDist,
        origin.y,
        origin.z + (dir.z / len) * offsetDist,
      );
      spawn = this.spawnBuf;
    } else {
      spawn = origin;
    }

    if (card.chainCount && card.chainCount > 1) {
      // Instant-resolve chain: pick the closest enemy in cone, then jump up to
      // (chainCount-1) more times to nearest within 6m. Damage applies per hop.
      // Charged Chain Lightning starts with 5 jumps instead of 3.
      const out = this.resolveChain(card, dmg, spawn, dir, isCharged);
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

  /**
   * Chain Lightning resolution: instant-hit, jumps to chainCount-1 nearest
   * neighbors. Conduit re-arc — if any alive enemy carries the Conduit mark
   * (set by a previous Chain Lightning hit), the chain auto-extends a free
   * arc from that enemy as the FIRST hop, capped at one re-arc per cast so
   * a chain can't infinitely loop. Charged variant adds 2 extra hops.
   */
  private resolveChain(card: CardDef, dmg: number, origin: Vector3, dir: Vector3, isCharged: boolean): Enemy[] {
    const maxRange = card.range;
    const dirLen = Math.hypot(dir.x, dir.z) || 1;
    const dirNx = dir.x / dirLen;
    const dirNz = dir.z / dirLen;
    const used = new Set<Enemy>();
    const path: Enemy[] = [];
    const points: number[] = [origin.x, origin.z];

    // Conduit re-arc — if any alive enemy carries a Conduit mark, route the
    // chain through it as the very first hit. The mark is consumed.
    let conduitTarget: Enemy | null = null;
    for (const e of this.enemies.enemies) {
      if (!e.alive) continue;
      if (e.conduitTimer > 0) {
        conduitTarget = e;
        break;
      }
    }

    let primary: Enemy | null = null;
    if (conduitTarget) {
      primary = conduitTarget;
      conduitTarget.consumeConduit();
    } else {
      // First target: nearest enemy in a 60° cone in front, within maxRange.
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
    // Charged variant adds +2 hops (5 total) for a wider chain spread.
    const baseTotal = card.chainCount ?? 3;
    const total = isCharged ? baseTotal + 2 : baseTotal;
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
    // Mark the first hit with Conduit so the NEXT Chain Lightning re-arcs from
    // it free. Skip if the conduit already drove this cast — re-using the same
    // target back-to-back loses meaning.
    if (path.length > 0 && !conduitTarget && path[0].alive) {
      path[0].markConduit();
    }
    if (path.length > 0) events.emit("COMBO_HIT", { hitNum: path.length, count: path.length });

    events.emit<CardArcFx>("CARD_FX", {
      kind: "chain", range: maxRange, x: origin.x, z: origin.z, fx: dirNx, fz: dirNz,
      chainPoints: points,
    });
    return path;
  }

  private castDash(card: CardDef, dmg: number, isCharged: boolean): Enemy[] {
    // Phase Step blinks in the player's TRAVEL direction (last WASD input)
    // so it reads as a deliberate dodge maneuver. Damage-dashes (Dash Strike)
    // still use facing so the player can leap toward the enemy they're aiming
    // at. If the player is standing still, both fall back to facing.
    const src = card.iframeOnly && this.player.lastMoveDir.lengthSquared() > 1e-3
      ? this.player.lastMoveDir
      : this.player.facing;
    const dir = new Vector3(src.x, 0, src.z);
    const dirLen = Math.hypot(dir.x, dir.z) || 1;
    dir.x /= dirLen;
    dir.z /= dirLen;
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
    if (hits > 0) {
      events.emit("COMBO_HIT", { hitNum: hits, count: hits });
      if (card.heavy) events.emit("HEAVY_HIT", {});
    } else if (card.heavy && !card.iframeOnly) {
      events.emit("HEAVY_MISS", {});
    }

    events.emit<CardArcFx>("CARD_FX", {
      kind: "dash", range: dist, x: startX, z: startZ, fx: dir.x, fz: dir.z,
    });

    this.player.root.position.x = endX;
    this.player.root.position.z = endZ;
    this.player.isDodging = true;
    // Zero the dodge direction so the i-frame window doesn't drift the player
    // sideways using a stale dodgeDir from a prior regular dodge — the dash
    // is the only motion this card produces. Without this, Phase Step would
    // teleport AND then slide for 0.45s in whatever direction was last dodged.
    this.player.dodgeDir.set(0, 0, 0);
    // Phase Step grants longer i-frames to compensate for the lost damage.
    this.player.dodgeTimer = card.iframeOnly ? 0.45 : 0.12;
    this.player.triggerCast("dash");
    this.player.snapFacingNextFrame();

    // ----- Signature mechanics -----
    if (this.hazards) {
      if (card.id === "dashstrike") {
        // Sundered Line — drop a chain of small damage discs along the dash
        // path. Reads as a glowing trail the enemy crosses; charged variant
        // pierces (already handled by hits = all enemies) and burns longer.
        const segments = 3;
        const trailDmg = isCharged ? 12 : 8;
        const trailDur = isCharged ? 2.6 : 2.0;
        for (let s = 1; s <= segments; s++) {
          const t = s / (segments + 1);
          const tx = startX + dxLine * t;
          const tz = startZ + dzLine * t;
          this.hazards.spawn({
            x: tx, z: tz,
            radius: 1.2,
            duration: trailDur,
            dmgPerTick: trailDmg,
            tickInterval: 0.45,
            color: isCharged ? [1.0, 0.55, 0.10] : [0.95, 0.85, 0.30],
            kind: isCharged ? "fire" : "sword",
            sourceCard: card.id,
          });
        }
      }
      if (card.id === "phase_step") {
        // Phantom Decoy at the start point — short fuse, AoE detonate.
        // Charged variant adds a stronger blast (covered via blastRadius).
        this.hazards.spawn({
          x: startX, z: startZ,
          radius: 1.6,
          duration: 0.8,
          dmgPerTick: isCharged ? 20 : 12,
          tickInterval: 0.4,
          color: [0.7, 0.55, 1.0],
          kind: "phantom",
          sourceCard: card.id,
          blastRadius: isCharged ? 4.0 : 3.0,
        });
      }
    }

    return out;
  }

  /** Radial-from-player AoE (Frost Nova). Applies optional freeze. */
  private castAoe(card: CardDef, dmg: number, isCharged: boolean): Enemy[] {
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
    if (hits > 0) {
      events.emit("COMBO_HIT", { hitNum: hits, count: hits });
      if (card.heavy) events.emit("HEAVY_HIT", {});
    } else if (card.heavy) {
      events.emit("HEAVY_MISS", {});
    }
    events.emit<CardArcFx>("CARD_FX", {
      kind: "aoe", range: radius, x: px, z: pz, fx: 0, fz: 1,
    });
    // Frost Nova signature — leaves a Frost Field that slows enemies entering
    // and (via PlayerController query) speeds the player up while inside.
    if (card.id === "frost_nova" && this.hazards) {
      this.hazards.spawn({
        x: px, z: pz,
        radius: isCharged ? 5.0 : 3.0,
        duration: isCharged ? 6.0 : 4.0,
        dmgPerTick: 0,
        tickInterval: 0.5,
        color: [0.55, 0.85, 1.0],
        kind: "frost",
        sourceCard: card.id,
      });
    }
    return out;
  }

  /**
   * Aerial slam — pins player into a downward dive and stores the card id; the
   * actual radial damage resolves on PLAYER_LANDED in main.ts so the impact
   * lines up visually with the ground hit. Damage isn't applied here.
   *
   * The signature mechanic (Fire Pillars) likewise has to wait for landing —
   * spawning hazard zones at the take-off position would land them in midair,
   * not where the meteor actually hits. Stash the charged flag so the landing
   * resolution can pick how many pillars to spawn.
   */
  private castAerial(card: CardDef, _dmg: number, isCharged: boolean): Enemy[] {
    this.player.aerialSlamming = true;
    this.player.pendingAerialCardId = card.id;
    this.player.pendingAerialCharged = isCharged;
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

  /**
   * Mine Field — drops `mineCount` proximity mines around the player at evenly-
   * spaced angles on the card's range circle. Each mine is a HazardZone of kind
   * "mine"; HazardZones handles the arming + detonation logic. Charged variant
   * drops 2 extra mines at a wider radius.
   */
  private castMineField(card: CardDef, dmg: number, isCharged: boolean): Enemy[] {
    if (!this.hazards) return [];
    const px = this.player.root.position.x;
    const pz = this.player.root.position.z;
    const baseCount = card.mineCount ?? 4;
    const count = isCharged ? baseCount + 2 : baseCount;
    const ringR = isCharged ? card.range * 1.4 : card.range;
    const baseAngle = Math.random() * Math.PI * 2;
    for (let i = 0; i < count; i++) {
      const a = baseAngle + (i * Math.PI * 2) / count;
      const x = px + Math.cos(a) * ringR;
      const z = pz + Math.sin(a) * ringR;
      this.hazards.spawn({
        x, z,
        radius: 1.0, // proximity arm radius
        duration: 8.0,
        dmgPerTick: dmg,
        tickInterval: 0.5,
        color: [1.0, 0.45, 0.10],
        kind: "mine",
        sourceCard: card.id,
        blastRadius: card.aoeRadius ?? 2.5,
      });
    }
    // Player cast pose + visual — reuse the dash pose since it reads as a
    // "drop and pivot" beat consistent with mine planting.
    this.player.triggerCast("dash");
    events.emit<CardArcFx>("CARD_FX", {
      kind: "aoe",
      range: ringR,
      x: px, z: pz, fx: 0, fz: 1,
    });
    return [];
  }

  /**
   * Charged Beam — three power tiers gated on hold time:
   *   tap (< chargeMin):       single fast bolt to first enemy in line
   *   piercing (< chargeMax):  line attack damaging every enemy in a 12m line
   *   wide (>= chargeMax):     wide beam, higher damage, knockback
   *
   * Charged-press (CTRL) on top of any tier upgrades dmg via the CardCaster's
   * existing chargeMult — already factored into `dmg` by `cast()`.
   */
  private castChargedBeam(
    card: CardDef,
    dmg: number,
    aimPoint: Vector3 | null,
    isCharged: boolean,
    holdSeconds: number,
  ): Enemy[] {
    void isCharged; // dmg already includes the CTRL multiplier
    const origin = this.player.root.position;
    if (aimPoint) {
      this.dirBuf.set(aimPoint.x - origin.x, 0, aimPoint.z - origin.z);
    } else {
      this.dirBuf.set(this.player.facing.x, 0, this.player.facing.z);
    }
    const dirLen = Math.hypot(this.dirBuf.x, this.dirBuf.z) || 1;
    const dirX = this.dirBuf.x / dirLen;
    const dirZ = this.dirBuf.z / dirLen;

    const minHold = card.chargeMin ?? 0.5;
    const maxHold = card.chargeMax ?? 1.0;
    let tier: 0 | 1 | 2 = 0;
    if (holdSeconds >= maxHold) tier = 2;
    else if (holdSeconds >= minHold) tier = 1;

    if (tier === 0) {
      // Tap — same as the legacy Bolt projectile path.
      const offsetDist = 0.7;
      this.spawnBuf.set(
        origin.x + dirX * offsetDist,
        origin.y,
        origin.z + dirZ * offsetDist,
      );
      this.dirBuf.set(dirX, 0, dirZ);
      this.projectiles.fire(this.spawnBuf, this.dirBuf, 28, dmg, card.range / 28 + 0.1);
      this.player.triggerCast("bolt");
      events.emit("CAST_FX", { kind: "bolt", x: this.spawnBuf.x, y: 1.2, z: this.spawnBuf.z });
      return [];
    }

    // Tier 1+: piercing line. `dmg` is already tap-tier (card.damage scaled
    // by tempo / item / CTRL); we apply the tier multiplier on top to climb
    // through 14 → ~24 → ~36 across the tap / piercing / wide tiers.
    const range = tier === 2 ? 14 : 12;
    const halfWidth = tier === 2 ? 1.6 : 0.9;
    const tierMul = tier === 2 ? 2.5 : 1.7;
    const finalDmg = Math.round(dmg * tierMul);
    const out: Enemy[] = [];
    let hits = 0;
    for (const e of this.enemies.enemies) {
      if (!e.alive) continue;
      const px = e.root.position.x - origin.x;
      const pz = e.root.position.z - origin.z;
      const along = px * dirX + pz * dirZ;
      const perp = Math.abs(px * -dirZ + pz * dirX);
      if (along < 0 || along > range) continue;
      if (perp > halfWidth + e.def.radius) continue;
      e.takeDamage(finalDmg);
      e.knockback(dirX, dirZ, tier === 2 ? 6 : 3);
      this.hooks.onEnemyHit(e, finalDmg, card);
      if (!e.alive) this.hooks.onKill(e, card);
      out.push(e); hits++;
    }
    if (hits > 0) events.emit("COMBO_HIT", { hitNum: hits, count: hits });
    this.player.triggerCast("bolt");
    events.emit("CAST_FX", { kind: "bolt", x: origin.x, y: 1.2, z: origin.z });
    // Visualise the line as a chain ribbon between origin and the line endpoint
    // — reuses the existing CARD_FX "chain" plumbing without a new fx kind.
    events.emit<CardArcFx>("CARD_FX", {
      kind: "chain",
      range,
      x: origin.x, z: origin.z,
      fx: dirX, fz: dirZ,
      chainPoints: [origin.x, origin.z, origin.x + dirX * range, origin.z + dirZ * range],
    });
    if (tier === 2) {
      events.emit("BEAM_CHARGED", { chargeFraction: 1.0 });
    }
    return out;
  }
}
