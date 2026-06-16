/**
 * Ascension ladder — "Rift Depth". Each depth stacks ONE more modifier,
 * cumulatively. Win at your current depth to unlock the next. A pure function
 * of `depth`, so it's trivially testable and reproducible for daily runs.
 */
export interface Difficulty {
  depth: number;
  /** Multiplier on every enemy's max HP at spawn. */
  enemyHpMult: number;
  /** Extra multiplier on bosses, on top of enemyHpMult. */
  bossHpMult: number;
  /** Multiplier on all damage dealt TO the player. */
  enemyDmgMult: number;
  /** Multiplier on "free" heals (room clear, mid-boss) — not player-earned card/relic heals. */
  healMult: number;
  /** Extra enemies added to each combat wave. */
  extraEnemies: number;
  /** Force an elite to appear as a choice in each act. */
  forceElite: boolean;
  /** Multiplier on enemy move speed (the seek choke). */
  enemySpeedMult: number;
  /** Flat damage each non-boss foe shrugs off per hit (you always deal ≥1). */
  enemyArmor: number;
  /** Fraction of knockback non-boss foes resist (0–0.85). */
  enemyKbResist: number;
  /** Multiplier on how fast tempo drifts back to rest — higher = harder to hold heat. */
  tempoDrainMult: number;
  /** Multiplier on every card cooldown. */
  cardCooldownMult: number;
  /** Multiplier on the perfect-dodge window length — lower = tighter timing. */
  dodgeWindowMult: number;
  /** Human-readable active modifiers, for the depth picker. */
  labels: string[];
}

interface Level {
  label: string;
  apply: (d: Difficulty) => void;
}

// Cumulative — depth N applies LEVELS[0..N-1]. The ladder mixes raw stat bumps
// with mechanics that change HOW you play: faster foes, knockback that no longer
// saves you, tempo that bleeds away, armor that punishes chip damage, longer
// cooldowns, and a perfect-dodge window that demands real timing.
const LEVELS: Level[] = [
  { label: "+20% enemy health", apply: (d) => { d.enemyHpMult *= 1.2; } },
  { label: "Enemies hit 20% harder", apply: (d) => { d.enemyDmgMult *= 1.2; } },
  { label: "Enemies move 12% faster", apply: (d) => { d.enemySpeedMult *= 1.12; } },
  { label: "Every act forces an elite", apply: (d) => { d.forceElite = true; } },
  { label: "+15% enemy health", apply: (d) => { d.enemyHpMult *= 1.15; } },
  { label: "Foes resist 35% of knockback", apply: (d) => { d.enemyKbResist = Math.min(0.85, d.enemyKbResist + 0.35); } },
  { label: "Your tempo cools 45% faster", apply: (d) => { d.tempoDrainMult *= 1.45; } },
  { label: "Free healing halved", apply: (d) => { d.healMult *= 0.5; } },
  { label: "Enemies hit 20% harder", apply: (d) => { d.enemyDmgMult *= 1.2; } },
  { label: "Foes shrug off the first 2 damage of each hit", apply: (d) => { d.enemyArmor += 2; } },
  { label: "+25% boss health, +1 enemy per wave", apply: (d) => { d.bossHpMult *= 1.25; d.extraEnemies += 1; } },
  { label: "Card cooldowns +25%", apply: (d) => { d.cardCooldownMult *= 1.25; } },
  { label: "Perfect-dodge window 35% tighter", apply: (d) => { d.dodgeWindowMult *= 0.65; } },
  { label: "+20% enemy health, foes 10% faster", apply: (d) => { d.enemyHpMult *= 1.2; d.enemySpeedMult *= 1.1; } },
  { label: "THE HOLLOWING — +20% damage, +1 enemy/wave, +3 armor", apply: (d) => { d.enemyDmgMult *= 1.2; d.extraEnemies += 1; d.enemyArmor += 3; } },
];

/** Highest selectable depth. */
export const MAX_DEPTH = LEVELS.length;

export function difficultyFor(depth: number): Difficulty {
  const clamped = Math.max(0, Math.min(depth, LEVELS.length));
  const d: Difficulty = {
    depth: clamped,
    enemyHpMult: 1,
    bossHpMult: 1,
    enemyDmgMult: 1,
    healMult: 1,
    extraEnemies: 0,
    forceElite: false,
    enemySpeedMult: 1,
    enemyArmor: 0,
    enemyKbResist: 0,
    tempoDrainMult: 1,
    cardCooldownMult: 1,
    dodgeWindowMult: 1,
    labels: [],
  };
  for (let i = 0; i < clamped; i++) {
    LEVELS[i].apply(d);
    d.labels.push(`D${i + 1}  ${LEVELS[i].label}`);
  }
  return d;
}

/** All level labels (for the depth picker preview), in order. */
export function depthLevelLabels(): string[] {
  return LEVELS.map((l, i) => `D${i + 1}  ${l.label}`);
}
