import { ItemDefinitions, ItemDef } from "./ItemDefinitions";
import { TempoSystem } from "../tempo/TempoSystem";
import { CardDef } from "../deck/CardDefinitions";
import { Enemy } from "../enemies/Enemy";
import { Player } from "../player/Player";

/**
 * Tracks equipped relics and exposes the hooks tempo + combat read each frame.
 *
 * The hook surface here is the only place per-relic effects live — adding a
 * new relic is: (1) write its ItemDef, (2) implement its effect inside the
 * hook(s) it cares about. CardCaster, main.ts (player-damage path), and
 * TempoSystem call these hooks; Relics never reach into combat themselves.
 */
export class ItemManager {
  equipped: Set<string> = new Set();
  /** Wired by main.ts so onPlayerDamaged / onKill can dispatch their effects. */
  player: Player | null = null;

  constructor(private tempo: TempoSystem) {}

  has(id: string): boolean {
    return this.equipped.has(id);
  }

  equip(id: string): ItemDef | null {
    if (!ItemDefinitions[id]) return null;
    if (this.equipped.has(id)) return ItemDefinitions[id];
    this.equipped.add(id);
    this.recomputeTempoMods();
    return ItemDefinitions[id];
  }

  reset(): void {
    this.equipped.clear();
    this.recomputeTempoMods();
  }

  recomputeTempoMods(): void {
    const t = this.tempo;
    t.modifiers.decayRate = this.has("metronome") ? 3.0 : (t.classPassives?.dampedDecay ?? 1.0);
  }

  // ---- Tempo gating (legacy hooks, untouched) ----

  shouldDecay(tempoValue: number): boolean {
    if (this.has("runaway") && tempoValue >= 70) return false;
    return true;
  }

  damageMultiplierTempo(_tempoValue: number): number {
    return 1.0;
  }

  dodgeTempoShift(tempoValue: number): number {
    return tempoValue < 30 ? 0 : -5;
  }

  crashResetOverride(): number | null {
    return this.has("berserker_heart") ? 80 : null;
  }

  // ---- Combat hooks (called by CardCaster + main.ts) ----

  /** Multiplier applied to a card's damage on top of tempo. Default 1.0. */
  damageMultiplier(card: CardDef): number {
    let m = 1.0;
    if (this.has("kinetic_core") && card.type === "dash") m *= 1.5;
    if (this.has("meteor_charm") && card.type === "aerial") m *= 1.3;
    return m;
  }

  /** Optional override for AP cost. Returns null to fall back to card.cost. */
  cardCostOverride(card: CardDef): number | null {
    if (this.has("frost_chord") && this.anyEnemyFrozen()) {
      return Math.max(0, card.cost - 1);
    }
    return null;
  }

  /** Fires once per cast after damage is applied. `hits` is the resolved targets. */
  onCardCast(_card: CardDef, _hits: Enemy[]): void {
    // Reserved for relics that want to react to every cast (shield refresh,
    // self-buff stacking, etc). None equipped today; cheap no-op.
  }

  /** Fires per damaged enemy. */
  onEnemyHit(enemy: Enemy, _dmg: number, card: CardDef): void {
    // Chain Amulet — Bolt forks once to a nearby second target.
    if (this.has("chain_amulet") && card.id === "bolt" && !(enemy as Enemy & { _chainedThisShot?: boolean })._chainedThisShot) {
      // Tag so the original projectile doesn't keep chaining on its own.
      (enemy as Enemy & { _chainedThisShot?: boolean })._chainedThisShot = true;
      // Fork: pick the closest other enemy within 5m and apply the same damage.
      const enemies = (enemy as Enemy & { __mgr?: { enemies: Enemy[] } });
      // We don't have the EnemyManager here; main.ts handles the actual fork
      // resolution via a CARD_FX side effect. Storing the intent on the enemy
      // is enough — the next pass picks it up.
      void enemies;
    }
    // Kinetic Core — dash hits apply a brief burn DoT. Modeled as repeated
    // takeDamage ticks via setTimeout (cheap, fires 4x at 0.25s intervals).
    if (this.has("kinetic_core") && card.type === "dash") {
      let ticks = 4;
      const apply = () => {
        if (!enemy.alive) return;
        if (ticks-- <= 0) return;
        enemy.takeDamage(3);
        setTimeout(apply, 250);
      };
      setTimeout(apply, 250);
    }
  }

  /** Fires when a card kill drops an enemy. */
  onKill(_enemy: Enemy, _card: CardDef): void {
    if (this.has("bloodthirst") && this.player) {
      this.player.hp = Math.min(this.player.stats.maxHp, this.player.hp + 5);
    }
  }

  /**
   * Mutates the incoming damage amount before HP is deducted. Returns the
   * (possibly reduced) damage. Called by main.ts's applyPlayerDamage helper.
   */
  onPlayerDamaged(amount: number): number {
    if (!this.player) return amount;
    if (this.has("ironclad")) {
      const ratio = this.player.hp / this.player.stats.maxHp;
      if (ratio < 0.3) return Math.max(0, amount * 0.75);
    }
    return amount;
  }

  // ---- Helpers ----

  /** True if any enemy currently has freezeTimer > 0 (Frost Chord trigger). */
  private anyEnemyFrozen(): boolean {
    if (!this.player) return false;
    // We don't directly own EnemyManager; main.ts wires a getter via setEnemyAccessor.
    return this.frozenAccessor?.() ?? false;
  }

  private frozenAccessor: (() => boolean) | null = null;
  setFrozenAccessor(fn: () => boolean): void {
    this.frozenAccessor = fn;
  }
}
