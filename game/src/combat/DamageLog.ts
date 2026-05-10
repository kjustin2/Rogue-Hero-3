import { CardDef } from "../deck/CardDefinitions";
import { Enemy } from "../enemies/Enemy";

/**
 * Ring buffer of damage events for boss-death attribution. Captures the last
 * `CAPACITY` per-card hits so the post-fight breakdown reads "Cleave 41% /
 * Charged Beam 30% / ...".
 *
 * Wired via `ItemManager.onEnemyHit` — that hook receives both the enemy and
 * the card, which is the only attribution point in the cast pipeline.
 */
interface LogEntry {
  cardId: string;
  cardName: string;
  dmg: number;
  ts: number;
}

export class DamageLog {
  private buf: LogEntry[] = [];
  private static readonly CAPACITY = 120;

  record(enemy: Enemy, dmg: number, card: CardDef): void {
    void enemy;
    if (this.buf.length >= DamageLog.CAPACITY) this.buf.shift();
    this.buf.push({ cardId: card.id, cardName: card.name, dmg, ts: performance.now() });
  }

  /** Aggregate the last `windowMs` ms by cardId. Returns sorted by total dmg desc. */
  recentByCard(windowMs: number): { cardName: string; total: number; pct: number }[] {
    const cutoff = performance.now() - windowMs;
    const totals = new Map<string, { name: string; sum: number }>();
    let grand = 0;
    for (const e of this.buf) {
      if (e.ts < cutoff) continue;
      const prev = totals.get(e.cardId);
      if (prev) prev.sum += e.dmg;
      else totals.set(e.cardId, { name: e.cardName, sum: e.dmg });
      grand += e.dmg;
    }
    const out: { cardName: string; total: number; pct: number }[] = [];
    for (const v of totals.values()) {
      out.push({ cardName: v.name, total: v.sum, pct: grand > 0 ? v.sum / grand : 0 });
    }
    out.sort((a, b) => b.total - a.total);
    return out;
  }

  reset(): void {
    this.buf.length = 0;
  }
}

/**
 * Format a breakdown into a single banner-friendly string.
 * "Cleave 41% · Charged Beam 30% · Phase Step 12%"
 */
export function formatBreakdown(rows: { cardName: string; total: number; pct: number }[]): string {
  if (rows.length === 0) return "No card damage recorded.";
  return rows
    .slice(0, 4)
    .map((r) => `${r.cardName} ${Math.round(r.pct * 100)}%`)
    .join(" · ");
}
