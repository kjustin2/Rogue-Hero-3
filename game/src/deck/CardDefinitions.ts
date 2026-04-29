/**
 * Card pool. The set is intentionally small (10) so each card has a strong
 * identity and a refined animation; players draft 3 of these into their
 * battle hand each room from a per-hero collection.
 *
 * Per-card fields:
 *   id, name, cost (AP), tempoShift (added on cast), damage, range,
 *   type, rarity, desc, glyph.
 *
 * Type-specific extensions live in the optional fields:
 *   aoeRadius      — radial cards ("aoe", "aerial") use this for hit + FX
 *   chainCount     — chain-style projectiles ("chain_lightning")
 *   effect         — utility branch dispatch ("freeze", "shield")
 *   requiresAirborne — aerial cards: castable only while player.y > 0
 */

export type CardType = "melee" | "projectile" | "dash" | "aoe" | "aerial" | "utility";

export interface CardDef {
  id: string;
  name: string;
  cost: number;
  tempoShift: number;
  damage: number;
  range: number;
  type: CardType;
  rarity: "common" | "uncommon" | "rare";
  desc: string;
  glyph: string;
  /** Radial cards — radius of the hit + FX disc. */
  aoeRadius?: number;
  /** Chain projectiles — total targets including the primary. */
  chainCount?: number;
  /** Utility-branch dispatch. */
  effect?: "freeze" | "shield";
  /** Aerial cards: cast fails (CARD_FAIL "not_airborne") if player is grounded. */
  requiresAirborne?: boolean;
  /** Melee cards: explicit arc width override (defaults to 140°). */
  arcDegrees?: number;
  /** Dash cards: when true, the dash applies no damage but full i-frames. */
  iframeOnly?: boolean;
}

export const CardDefinitions: Record<string, CardDef> = {
  // --- Melee ---
  cleave: {
    id: "cleave",
    name: "Cleave",
    cost: 1,
    tempoShift: 6,
    damage: 18,
    range: 3.2,
    type: "melee",
    rarity: "common",
    desc: "Swing a 140° arc in front of you. Reach 3.2m. +6 Tempo.",
    glyph: "⚔",
    arcDegrees: 140,
  },
  crashing_blow: {
    id: "crashing_blow",
    name: "Crashing Blow",
    cost: 2,
    tempoShift: 10,
    damage: 32,
    range: 2.6,
    type: "melee",
    rarity: "uncommon",
    desc: "Narrow 60° overhead slam. Big damage + heavy knockback. +10 Tempo.",
    glyph: "🔨",
    arcDegrees: 60,
  },
  whirlwind: {
    id: "whirlwind",
    name: "Whirlwind",
    cost: 2,
    tempoShift: 8,
    damage: 14,
    range: 3.5,
    type: "melee",
    rarity: "uncommon",
    desc: "Spin in place — hits every enemy within 3.5m, all directions. +8 Tempo.",
    glyph: "🌀",
    arcDegrees: 360,
  },
  // --- Projectile ---
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
  chain_lightning: {
    id: "chain_lightning",
    name: "Chain Lightning",
    cost: 2,
    tempoShift: 7,
    damage: 12,
    range: 14,
    type: "projectile",
    rarity: "rare",
    desc: "Bolt arcs to up to 3 enemies, jumping 6m between each. +7 Tempo.",
    glyph: "⚡",
    chainCount: 3,
  },
  // --- AoE (radial-from-player) ---
  frost_nova: {
    id: "frost_nova",
    name: "Frost Nova",
    cost: 2,
    tempoShift: 5,
    damage: 10,
    range: 5.5,
    type: "aoe",
    rarity: "uncommon",
    desc: "Burst of ice freezes nearby enemies for 1.2s. +5 Tempo.",
    glyph: "❄",
    aoeRadius: 5.5,
    effect: "freeze",
  },
  // --- Mobility / Dash ---
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
  phase_step: {
    id: "phase_step",
    name: "Phase Step",
    cost: 1,
    tempoShift: 5,
    damage: 0,
    range: 6,
    type: "dash",
    rarity: "uncommon",
    desc: "Blink 6m in your move direction with full i-frames. No damage. +5 Tempo.",
    glyph: "💨",
    iframeOnly: true,
  },
  // --- Aerial ---
  meteor_slam: {
    id: "meteor_slam",
    name: "Meteor Slam",
    cost: 2,
    tempoShift: 12,
    damage: 36,
    range: 4,
    type: "aerial",
    rarity: "rare",
    desc: "Mid-air only. Slam down with a 4m shockwave. +12 Tempo.",
    glyph: "☄",
    aoeRadius: 4,
    requiresAirborne: true,
  },
  // --- Utility ---
  aegis: {
    id: "aegis",
    name: "Aegis",
    cost: 2,
    tempoShift: 0,
    damage: 0,
    range: 1,
    type: "utility",
    rarity: "uncommon",
    desc: "Surround yourself with a 25-HP shield for 4s. A blue ring shows it's active.",
    glyph: "🛡",
    effect: "shield",
  },
};

export const ALL_CARD_IDS: string[] = Object.keys(CardDefinitions);

/**
 * Default starting deck — used when no hero is set (legacy callers + tests).
 * Per-hero starting decks live on each HeroDef and override this when a run
 * begins from the hero-select screen. Keep at 3 unique cards to match the
 * "start small, earn more" deck philosophy.
 */
export const STARTING_DECK: string[] = ["cleave", "dashstrike", "aegis"];
