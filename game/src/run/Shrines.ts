/**
 * Shrine effects — HP-cost altars in shrine rooms. Each shrine charges 30%
 * max HP and grants a single benefit. Wired in main.ts via ShrinePicker.
 */

export type ShrineId =
  | "forge"
  | "anvil"
  | "echo_stone"
  | "pyre"
  | "crucible";

export interface ShrineDef {
  id: ShrineId;
  name: string;
  description: string;
  /** Fraction of max HP sacrificed (0..1). */
  hpCost: number;
  glyph: string;
}

export const SHRINE_DEFS: Record<ShrineId, ShrineDef> = {
  forge: {
    id: "forge",
    name: "Forge",
    description: "Sacrifice 30% max HP — gain a guaranteed RARE relic.",
    hpCost: 0.30,
    glyph: "⚒",
  },
  anvil: {
    id: "anvil",
    name: "Anvil",
    description: "Sacrifice 30% max HP — extend your battle hand by 1 slot.",
    hpCost: 0.30,
    glyph: "▤",
  },
  echo_stone: {
    id: "echo_stone",
    name: "Echo Stone",
    description: "Sacrifice 30% max HP — re-roll your starting deck (3 random cards).",
    hpCost: 0.30,
    glyph: "◎",
  },
  pyre: {
    id: "pyre",
    name: "Pyre",
    description: "Sacrifice 30% max HP — next room's enemies start at 50% HP.",
    hpCost: 0.30,
    glyph: "🔥",
  },
  crucible: {
    id: "crucible",
    name: "Crucible",
    description: "Sacrifice 30% max HP — gain a random Mutator.",
    hpCost: 0.30,
    glyph: "⚗",
  },
};

export const ALL_SHRINE_IDS: ShrineId[] = Object.keys(SHRINE_DEFS) as ShrineId[];

/** Pick 3 random shrine offerings for the picker. */
export function rollShrineOptions(rng: () => number, count = 3): ShrineDef[] {
  const pool = [...ALL_SHRINE_IDS];
  const out: ShrineDef[] = [];
  while (out.length < count && pool.length > 0) {
    const idx = Math.floor(rng() * pool.length);
    out.push(SHRINE_DEFS[pool.splice(idx, 1)[0]]);
  }
  return out;
}
