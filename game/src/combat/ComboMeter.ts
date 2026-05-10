import { events } from "../engine/EventBus";

/**
 * No-hit combo meter. Counts consecutive `ENEMY_HIT` events without an
 * intervening `DAMAGE_TAKEN`. Decays after `DECAY_AFTER_S` of inactivity.
 *
 * Tier breakpoints drive post-fx amp + a drum-kicker SFX in main.ts. The
 * meter itself is purely numeric — visual + audio escalation is wired by
 * the consumer reading `currentTier()` per frame.
 */

export type ComboTier = 0 | 1 | 2 | 3;

const TIER_THRESHOLDS = [0, 6, 14, 28] as const;
const DECAY_AFTER_S = 1.5;

export class ComboMeter {
  count = 0;
  tier: ComboTier = 0;
  /** Time since last hit. Resets to 0 on each ENEMY_HIT. */
  private since = 0;

  constructor() {
    events.on("ENEMY_HIT", () => this.onHit());
    events.on("DAMAGE_TAKEN", () => this.reset());
  }

  private onHit(): void {
    this.count++;
    this.since = 0;
    const newTier = this.tierForCount(this.count);
    if (newTier !== this.tier) {
      const dir = newTier > this.tier ? 1 : -1;
      this.tier = newTier;
      events.emit("COMBO_TIER_CHANGED", { tier: newTier, dir });
    }
  }

  private tierForCount(c: number): ComboTier {
    if (c >= TIER_THRESHOLDS[3]) return 3;
    if (c >= TIER_THRESHOLDS[2]) return 2;
    if (c >= TIER_THRESHOLDS[1]) return 1;
    return 0;
  }

  /** Per-frame decay. Resets the count after DECAY_AFTER_S of no hits. */
  update(dt: number): void {
    if (this.count === 0) return;
    this.since += dt;
    if (this.since >= DECAY_AFTER_S) this.reset();
  }

  reset(): void {
    if (this.count === 0 && this.tier === 0) return;
    this.count = 0;
    this.since = 0;
    if (this.tier !== 0) {
      this.tier = 0;
      events.emit("COMBO_TIER_CHANGED", { tier: 0, dir: -1 });
    }
  }
}
