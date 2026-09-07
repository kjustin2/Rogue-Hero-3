/**
 * The Blade is the single playable protagonist. Its tuning is data — stats,
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
    plate: 0x718692,
    plateDark: 0x253740,
    trim: 0xb39b64,
    trimEmissive: 0xb58848,
    bulk: 1.0,
  },

];

export function heroById(id: string): HeroDef {
  return HEROES.find((h) => h.id === id) ?? HEROES[0];
}
