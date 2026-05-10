/**
 * Glossary entries — keyword definitions for the pause-menu glossary tab and
 * for any future tooltip / help surface. Single source of truth so HUD copy,
 * card descs, and tooltips can reference the same wording.
 */
export interface GlossaryEntry {
  keyword: string;
  description: string;
  category: "status" | "tempo" | "system" | "color";
}

export const GLOSSARY: GlossaryEntry[] = [
  // Statuses
  { keyword: "Bleed",        description: "DoT applied by Cleave hits. 3 dmg/sec/stack for 4s, max 6 stacks.", category: "status" },
  { keyword: "Conduit",      description: "Mark applied by Chain Lightning. Next bolt re-arcs from this enemy free.", category: "status" },
  { keyword: "Frost Field",  description: "Lingering AoE from Frost Nova. Slows enemies; speeds you up while inside.", category: "status" },
  { keyword: "Hyperarmor",   description: "Crashing Blow's wind-up — you can't be staggered while charging.", category: "status" },
  { keyword: "Heavy",        description: "Big-commit cards. Hits/whiffs both spike Tempo via HEAVY_HIT/MISS events.", category: "status" },
  { keyword: "Hazard Zone",  description: "Lingering AoE patches dropped by Mine Field, Phantom, Fire Pillars, etc.", category: "status" },
  // Tempo + crash
  { keyword: "Tempo",        description: "Combat-flow meter (0-100). Drives speed multipliers + Crash readiness.", category: "tempo" },
  { keyword: "FLOWING",      description: "Tempo zone 30-69. Baseline state — moderate speed boost.", category: "tempo" },
  { keyword: "HOT",          description: "Tempo zone 70-89. Faster, brighter — Crash becomes available.", category: "tempo" },
  { keyword: "CRITICAL",     description: "Tempo zone 90+. Full bloom + saturation. Risk: damage drops you fast.", category: "tempo" },
  { keyword: "Crash",        description: "F at HOT+ to trigger a radial AoE. Resets Tempo to 50 (or hero default).", category: "tempo" },
  // Combo
  { keyword: "Combo Meter",  description: "Tracks consecutive hits without taking damage. Tier 3 amps screen FX.", category: "system" },
  { keyword: "Card Combo",   description: "Cast pair within 1.5s for a named bonus (Hemorrhage Burst, Frostlance, etc.).", category: "system" },
  // Run-level
  { keyword: "Anomaly",      description: "Per-room modifier on combat rooms (Echo Chamber, Frost Mirror, etc.).", category: "system" },
  { keyword: "Shrine",       description: "HP-cost altar — sacrifice 30% max HP for a powerful one-time benefit.", category: "system" },
  { keyword: "Shop",         description: "Spend Shards on cards / mutators / heals / relics.", category: "system" },
  { keyword: "Shard",        description: "Run-scoped currency. Earned from perfect-clear flags + boss kills.", category: "system" },
  { keyword: "Mutator",      description: "Limited-charge attachment that overrides one card's stats temporarily.", category: "system" },
  { keyword: "Enrage",       description: "Boss attack-speed scaling past 90s of fight. Caps at +60%.", category: "system" },
  // Telegraph colors
  { keyword: "Red telegraph",     description: "Direct damage zone — get out before it resolves.", category: "color" },
  { keyword: "Blue telegraph",    description: "Spire / lance line. Player must dodge perpendicular.", category: "color" },
  { keyword: "Orange telegraph",  description: "Magma / fire — Colossus and player Fire Pillars use this tone.", category: "color" },
  { keyword: "Purple telegraph",  description: "Phantom / Phase Step decoy detonation.", category: "color" },
  { keyword: "Gold telegraph",    description: "Conduit / mark / charged-beam tier indicator.", category: "color" },
];
