/**
 * Curated relic subset for the vertical slice MVP.
 * Ported from rogue-hero-2/src/Items.js — ItemDefinitions.
 */

export type Rarity = "common" | "uncommon" | "rare" | "legendary";

export interface ItemDef {
  id: string;
  name: string;
  rarity: Rarity;
  color: string;       // hex string for UI tint
  desc: string;
  /** If set, only available when player is this character class. */
  charSpecific?: string;
}

export const ItemDefinitions: Record<string, ItemDef> = {
  metronome: {
    id: "metronome",
    name: "Metronome",
    rarity: "common",
    color: "#ffdd44",
    desc: "Tempo decays 3× faster — easier zone control.",
  },
  runaway: {
    id: "runaway",
    name: "Runaway",
    rarity: "uncommon",
    color: "#ff8844",
    desc: "Tempo no longer decays from Hot zone.",
  },
  berserker_heart: {
    id: "berserker_heart",
    name: "Berserker Heart",
    rarity: "rare",
    color: "#ff4422",
    desc: "[BLADE] Each crash resets Tempo to 80 instead of the default.",
    charSpecific: "blade",
  },
  // ---- New combat-affecting relics ----
  chain_amulet: {
    id: "chain_amulet",
    name: "Chain Amulet",
    rarity: "rare",
    color: "#88ddff",
    desc: "Bolt projectiles fork to a second nearby target on hit.",
  },
  bloodthirst: {
    id: "bloodthirst",
    name: "Bloodthirst",
    rarity: "uncommon",
    color: "#cc2222",
    desc: "Each kill heals you for 5 HP.",
  },
  ironclad: {
    id: "ironclad",
    name: "Ironclad",
    rarity: "rare",
    color: "#aabbcc",
    desc: "Take 25% less damage while below 30% HP.",
  },
  kinetic_core: {
    id: "kinetic_core",
    name: "Kinetic Core",
    rarity: "uncommon",
    color: "#ff9966",
    desc: "Dash cards deal +50% damage and apply a 1s burn (4×3 dmg).",
  },
  frost_chord: {
    id: "frost_chord",
    name: "Frost Chord",
    rarity: "uncommon",
    color: "#88ccff",
    desc: "While any enemy is frozen, your card costs are reduced by 1 AP.",
  },
  meteor_charm: {
    id: "meteor_charm",
    name: "Meteor Charm",
    rarity: "rare",
    color: "#ff7733",
    desc: "Meteor Slam deals +30% damage on impact.",
  },
};

export const ALL_ITEM_IDS: string[] = Object.keys(ItemDefinitions);
