/**
 * Playable heroes. Everything that differs between them is DATA — stats,
 * multipliers consulted by combat/deck pipelines, starting hand, and the
 * palette the procedural mesh is built from. No per-hero branching in
 * gameplay code.
 */
export interface HeroDef {
  id: string;
  name: string;
  title: string;
  desc: string;
  icon: string;
  color: string;
  // Stats
  maxHp: number;
  speed: number;
  /** Multiplier on basic-chain melee damage. */
  meleeDmgMult: number;
  /** Multiplier on knockback the hero deals. */
  kbMult: number;
  /** Multiplier on damage the hero takes. */
  dmgTakenMult: number;
  /** Multiplier on card cooldowns. */
  cooldownMult: number;
  /** Multiplier on combo tempo payouts. */
  comboTempoMult: number;
  startingHand: string[];
  passiveName: string;
  passiveDesc: string;
  // Mesh palette + proportions
  plate: number;
  plateDark: number;
  trim: number;
  trimEmissive: number;
  bulk: number; // x/z scale of the body
  /** Display bars on the select screen, 1–5. */
  bars: { vitality: number; speed: number; power: number };
}

export const HEROES: HeroDef[] = [
  {
    id: "blade",
    name: "The Blade",
    title: "Rift-Sworn Duelist",
    desc: "The balanced edge. Reads the fight, punishes everything.",
    icon: "⚔",
    color: "#5fe0ff",
    maxHp: 100,
    speed: 6.4,
    meleeDmgMult: 1.0,
    kbMult: 1.0,
    dmgTakenMult: 1.0,
    cooldownMult: 1.0,
    comboTempoMult: 1.5,
    startingHand: ["dash-strike", "arc-bolt"],
    passiveName: "Momentum",
    passiveDesc: "Combo tempo payouts +50%",
    plate: 0x2a3045,
    plateDark: 0x1b2030,
    trim: 0x9a7833,
    trimEmissive: 0xffaa33,
    bulk: 1.0,
    bars: { vitality: 3, speed: 3, power: 3 },
  },
  {
    id: "bulwark",
    name: "The Bulwark",
    title: "Unmoved Warden",
    desc: "A wall that hits back. Slow, massive, and very hard to kill.",
    icon: "⛨",
    color: "#ffaa55",
    maxHp: 145,
    speed: 5.4,
    meleeDmgMult: 1.25,
    kbMult: 1.6,
    dmgTakenMult: 0.88,
    cooldownMult: 1.15,
    comboTempoMult: 1.0,
    startingHand: ["cleave", "aegis"],
    passiveName: "Juggernaut",
    passiveDesc: "−12% damage taken, +60% knockback dealt",
    plate: 0x4a3326,
    plateDark: 0x2a1d16,
    trim: 0x8a5a20,
    trimEmissive: 0xff8833,
    bulk: 1.22,
    bars: { vitality: 5, speed: 2, power: 4 },
  },
  {
    id: "sparkmage",
    name: "The Sparkmage",
    title: "Conduit of the Storm",
    desc: "Fragile, fast, and crackling with cards. The sword is a wand.",
    icon: "⚡",
    color: "#c98fff",
    maxHp: 80,
    speed: 6.9,
    meleeDmgMult: 0.8,
    kbMult: 0.9,
    dmgTakenMult: 1.0,
    cooldownMult: 0.8,
    comboTempoMult: 1.0,
    startingHand: ["arc-bolt", "chain-lightning"],
    passiveName: "Overflow",
    passiveDesc: "Card cooldowns −20%",
    plate: 0x2e2342,
    plateDark: 0x1c1430,
    trim: 0x6a4a9a,
    trimEmissive: 0xc98fff,
    bulk: 0.92,
    bars: { vitality: 2, speed: 4, power: 4 },
  },
];

export function heroById(id: string): HeroDef {
  return HEROES.find((h) => h.id === id) ?? HEROES[0];
}
