export type BossRecoveryClass = "standard" | "long";
export type PitWardenMove = "dash" | "guard" | "leap" | "fissure" | "fan";

export interface BossMoveDefinition<M extends string> {
  id: M;
  weight: number;
  recovery: BossRecoveryClass;
  minDistance?: number;
  maxDistance?: number;
}

export interface BossPhaseMoveProfile<M extends string> {
  phase: number;
  repeatProtection: boolean;
  moves: readonly BossMoveDefinition<M>[];
}

export const PIT_WARDEN_MOVE_PROFILE: readonly BossPhaseMoveProfile<PitWardenMove>[] = [
  { phase: 1, repeatProtection: true, moves: [
    { id: "dash", weight: 3, recovery: "standard" },
    { id: "guard", weight: 1, recovery: "long", maxDistance: 7.5 },
    { id: "leap", weight: 1.15, recovery: "long", minDistance: 4 },
    { id: "fan", weight: 0.8, recovery: "standard", minDistance: 7 },
  ] },
  { phase: 2, repeatProtection: true, moves: [
    { id: "dash", weight: 2.4, recovery: "standard" },
    { id: "guard", weight: 1, recovery: "long", maxDistance: 7.5 },
    { id: "leap", weight: 1.3, recovery: "long", minDistance: 3.5 },
    { id: "fissure", weight: 1.4, recovery: "long", maxDistance: 10.5 },
    { id: "fan", weight: 1.25, recovery: "standard", minDistance: 6 },
  ] },
  { phase: 3, repeatProtection: true, moves: [
    { id: "dash", weight: 2.2, recovery: "long" },
    { id: "guard", weight: 0.8, recovery: "long", maxDistance: 7.5 },
    { id: "leap", weight: 1, recovery: "long", minDistance: 3 },
    { id: "fissure", weight: 1.5, recovery: "long", maxDistance: 11.5 },
    { id: "fan", weight: 1.35, recovery: "long", minDistance: 5 },
  ] },
] as const;

export function bossRecoverySeconds(recovery: BossRecoveryClass): number {
  if (recovery === "long") return 1.04;
  return 0.64;
}

/** Pure seeded selection: range filters first, then repeat protection, then weights. */
export function chooseBossMove<M extends string>(
  profiles: readonly BossPhaseMoveProfile<M>[], phase: number, lastMove: M | null, distance: number, roll: number,
): BossMoveDefinition<M> {
  const profile = profiles.find((entry) => entry.phase === phase) ?? profiles[profiles.length - 1];
  if (!profile) throw new Error("Boss move profile is empty");
  const inRange = profile.moves.filter((move) =>
    (move.minDistance === undefined || distance >= move.minDistance) &&
    (move.maxDistance === undefined || distance <= move.maxDistance));
  const ranged = inRange.length ? inRange : [...profile.moves];
  const protectedPool = profile.repeatProtection && ranged.length > 1 ? ranged.filter((move) => move.id !== lastMove) : ranged;
  const pool = protectedPool.length ? protectedPool : ranged;
  const total = pool.reduce((sum, move) => sum + move.weight, 0);
  let cursor = Math.max(0, Math.min(0.999999, roll)) * total;
  for (const move of pool) {
    cursor -= move.weight;
    if (cursor < 0) return move;
  }
  const fallback = pool[pool.length - 1];
  if (!fallback) throw new Error("Boss phase has no moves");
  return fallback;
}
