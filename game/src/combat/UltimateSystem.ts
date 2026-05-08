import { events } from "../engine/EventBus";

/**
 * Charge meter (0–100) for the player's ultimate. Gains charge from combat
 * events; when full, the player can press the bound ultimate key to cast.
 *
 * Ultimate cast resolution lives in `main.ts` so it can compose with the FX
 * + audio + camera layer. This system owns the meter state + ULTIMATE_READY
 * threshold edge + the API the gameplay loop calls.
 *
 * Charge sources:
 *   COMBO_HIT  +2 per hit (combo escalation rewards aggression)
 *   KILL       +5
 *   HEAVY_HIT  +6
 *   DAMAGE_TAKEN +4 (in distress → charge faster — the "comeback" beat)
 *
 * Tuning notes: a typical clearing room (~5 enemies, ~10 combo hits, 2 heavy
 * lands, 1-2 player damage events) yields ~60-80 charge — full meter every
 * 1.5 to 2 rooms in normal play. Boss rooms charge faster due to combo + heavy.
 */
export class UltimateSystem {
  private charge = 0;
  private wasReady = false;

  constructor() {
    events.on<{ count?: number }>("COMBO_HIT", (p) => {
      // Charge per individual hit, not per combo total — combos that hit many
      // enemies fire many COMBO_HIT events, so this naturally rewards splash.
      this.add(2);
      void p;
    });
    events.on("KILL", () => this.add(5));
    events.on("HEAVY_HIT", () => this.add(6));
    events.on<{ amount?: number }>("DAMAGE_TAKEN", (p) => {
      // Cap the per-event ramp so a single 50-dmg crit doesn't spike the meter.
      // Static +4 keeps the comeback factor predictable.
      void p;
      this.add(4);
    });
  }

  add(amount: number): void {
    if (amount <= 0) return;
    this.charge = Math.min(100, this.charge + amount);
    if (!this.wasReady && this.charge >= 100) {
      this.wasReady = true;
      events.emit("ULTIMATE_READY", {});
    }
  }

  /** Charge fraction in [0, 1] — read by the HUD slot. */
  fillFraction(): number {
    return this.charge / 100;
  }

  canCast(): boolean {
    return this.charge >= 100;
  }

  /**
   * Spend the meter. Caller is responsible for resolving FX + damage and
   * emitting `ULTIMATE_CAST`. Returns true if the cast was permitted.
   */
  consume(): boolean {
    if (this.charge < 100) return false;
    this.charge = 0;
    this.wasReady = false;
    return true;
  }

  /** Reset on run start / restart. */
  reset(): void {
    this.charge = 0;
    this.wasReady = false;
  }
}
