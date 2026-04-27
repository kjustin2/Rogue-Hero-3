/**
 * Curated card subset for the vertical slice MVP.
 * Ported in spirit from rogue-hero-2/src/DeckManager.js — fields:
 *   id, name, cost (AP), tempoShift, damage, range, type, rarity, desc.
 */

export type CardType = "melee" | "projectile" | "dash";

export interface CardDef {
  id: string;
  name: string;
  cost: number;        // AP
  tempoShift: number;  // applied via TempoSystem.add() on cast
  damage: number;
  range: number;       // meters; per-type meaning (radius/length/dash distance)
  type: CardType;
  rarity: "common" | "uncommon" | "rare";
  desc: string;
  /** Single glyph drawn prominently on the card slot — gives each card a
   *  distinct silhouette read at a glance, independent of name length. */
  glyph: string;
}

export const CardDefinitions: Record<string, CardDef> = {
  cleave: {
    id: "cleave",
    name: "Cleave",
    cost: 1,
    tempoShift: 6,
    damage: 18,
    range: 3.2,
    type: "melee",
    rarity: "common",
    desc: "Wide arc swing in front of you. +6 Tempo.",
    glyph: "⚔",
  },
  bolt: {
    id: "bolt",
    name: "Bolt",
    cost: 1,
    tempoShift: 4,
    damage: 14,
    range: 22,
    type: "projectile",
    rarity: "common",
    desc: "Fire a fast bolt at the cursor. First enemy hit takes damage. +4 Tempo.",
    glyph: "➶",
  },
  dashstrike: {
    id: "dashstrike",
    name: "Dash Strike",
    cost: 1,
    tempoShift: 8,
    damage: 16,
    range: 5,
    type: "dash",
    rarity: "common",
    desc: "Dash forward 5m, damaging enemies you pass through. +8 Tempo.",
    glyph: "↯",
  },
};

export const STARTING_DECK: string[] = [
  "cleave", "cleave", "cleave",
  "bolt", "bolt", "bolt",
  "dashstrike", "dashstrike",
];
