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

export type CardType =
  | "melee"
  | "projectile"
  | "dash"
  | "aoe"
  | "aerial"
  | "utility"
  | "mine_field"
  | "charged_beam";

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
  /** "Heavy" cards (high commitment, big impact). On cast they emit HEAVY_HIT
   *  on landed hits or HEAVY_MISS on whiffs — TempoSystem rewards both with
   *  bigger gains than a normal swing. */
  heavy?: boolean;
  /** One-line signature mechanic the HandPicker shows below the description. */
  signatureMechanic?: string;
  /** Synergy archetype — drives ArchetypeSynergy passives at 3+ stacks. */
  archetype?: "fire" | "frost" | "storm";
  /** Mine Field — number of mines dropped (charged variant in CardCaster doubles). */
  mineCount?: number;
  /** Charged Beam — minimum hold (s) to upgrade tap → piercing line; second tier at 1.0s. */
  chargeMin?: number;
  chargeMax?: number;
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
    signatureMechanic: "Bleed: hits stack DoT (3 dps, 4s; max 6 stacks).",
    archetype: "storm",
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
    heavy: true,
    signatureMechanic: "Hyperarmor wind-up. Charged: launches enemies airborne.",
    archetype: "fire",
  },
  // Mine Field (replaces Whirlwind) — drops a ring of mines around the player.
  mine_field: {
    id: "mine_field",
    name: "Mine Field",
    cost: 2,
    tempoShift: 8,
    damage: 14,
    range: 3.0,
    type: "mine_field",
    rarity: "uncommon",
    desc: "Drop 4 spinning mines around you. Each detonates on enemy contact. +8 Tempo.",
    glyph: "💣",
    aoeRadius: 2.5,
    mineCount: 4,
    signatureMechanic: "Mines persist 8s. Charged: 6 mines, wider spread.",
    archetype: "fire",
  },
  // --- Projectile ---
  // Charged Beam (replaces Bolt) — hold-to-charge, three power tiers.
  charged_beam: {
    id: "charged_beam",
    name: "Charged Beam",
    cost: 1,
    tempoShift: 4,
    damage: 14,
    range: 22,
    type: "charged_beam",
    rarity: "common",
    desc: "Tap: fast bolt. Hold 0.5s: piercing line. Hold 1s: wide beam, knockback.",
    glyph: "⟶",
    chargeMin: 0.5,
    chargeMax: 1.0,
    signatureMechanic: "Charge tiers escalate damage + AoE. Hold past max to overcharge.",
    archetype: "storm",
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
    signatureMechanic: "Marks first hit Conduit (4s). Next bolt re-arcs from it free.",
    archetype: "storm",
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
    signatureMechanic: "Leaves a 3m Frost Field for 4s. You move 20% faster inside.",
    archetype: "frost",
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
    signatureMechanic: "Dash path becomes a 2s Sundered Line (8 dmg/tick).",
    archetype: "fire",
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
    signatureMechanic: "Leaves a Phantom Decoy that detonates after 0.8s for 12 AoE.",
    archetype: "frost",
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
    heavy: true,
    signatureMechanic: "Spawns 3 Fire Pillars in triangle (8 dmg/tick, 3s).",
    archetype: "fire",
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
    signatureMechanic: "Re-press 1/2/3 mid-shield to detonate (15 dmg + knockback).",
    archetype: "frost",
  },
};

// Module-load validation — chain projectiles loop `for (h = 1; h < total; h++)`
// in CardCaster.resolveChain, so a chainCount < 2 silently degrades the card to
// "primary target only" with no further hops. Asserting at startup catches the
// authoring footgun the moment a new chain card lands in the file.
for (const c of Object.values(CardDefinitions)) {
  if (c.chainCount !== undefined && c.chainCount < 2) {
    throw new Error(`Card "${c.id}" has chainCount=${c.chainCount}; chain cards require chainCount >= 2`);
  }
}

export const ALL_CARD_IDS: string[] = Object.keys(CardDefinitions);

/**
 * Default starting deck — used when no hero is set (legacy callers + tests).
 * Per-hero starting decks live on each HeroDef and override this when a run
 * begins from the hero-select screen. Keep at 3 unique cards to match the
 * "start small, earn more" deck philosophy.
 */
export const STARTING_DECK: string[] = ["cleave", "dashstrike", "aegis"];
