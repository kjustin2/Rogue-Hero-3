import type { Rng } from "../core/rng";

/**
 * Elite affixes — random modifiers rolled onto elite anchors (and champions) that
 * change how a fight reads, not just how spongy it is. The static part (speed,
 * tint) is applied by `Enemy.applyAffix`; the dynamic part (regen, frenzy, siphon,
 * volatile death) is handled per-frame / on-death inside the Enemy base, keyed by id.
 */
export interface AffixDef {
  id: string;
  label: string;
  color: number;
}

export const AFFIXES: AffixDef[] = [
  { id: "hasted", label: "HASTED", color: 0x66ddff },
  { id: "volatile", label: "VOLATILE", color: 0xff7a3a },
  { id: "regenerator", label: "REGENERATOR", color: 0x7dffb0 },
  { id: "frenzied", label: "FRENZIED", color: 0xff4252 },
  { id: "siphon", label: "SIPHON", color: 0xff6ba0 },
];

export function affixById(id: string): AffixDef | undefined {
  return AFFIXES.find((a) => a.id === id);
}

/** Roll 1 affix (a 2nd from Rift Depth 6+) — distinct ids. */
export function rollAffixes(rng: Rng, depth: number): string[] {
  const pool = rng.shuffle(AFFIXES.map((a) => a.id));
  const count = depth >= 6 ? 2 : 1;
  return pool.slice(0, count);
}
