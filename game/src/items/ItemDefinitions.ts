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
};

export const ALL_ITEM_IDS: string[] = Object.keys(ItemDefinitions);
