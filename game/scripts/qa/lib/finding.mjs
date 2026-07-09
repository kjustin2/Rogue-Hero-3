// THE FINDING CONTRACT — the shared shape every autonomous searcher emits, frozen
// BEFORE the searchers so bucketing/dedup/replay never has to be retrofitted onto
// an un-keyed stream (the documented pain). A finding is reproducible (replay),
// situated (situation = flow() at the moment), located (locus), and attributed
// (gameCommit) — so triage can dedup by bucketKey, minimize the tape, and bisect
// the owning commit deterministically.
//
//   makeFinding({...})  normalize one finding
//   bucket(findings)    dedup by bucketKey → [{ ...first, count, seeds[] }]
//   gameCommit()        current short git HEAD (attribution anchor)
import { execSync } from "node:child_process";

let _commit = null;
/** Short git HEAD — the attribution anchor stamped into every finding. Cached. */
export function gameCommit() {
  if (_commit !== null) return _commit;
  try { _commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim(); }
  catch { _commit = "unknown"; }
  return _commit;
}

/**
 * Normalize a raw detector hit into the contract.
 * @param oracle    detector name ("differential" | "persona" | "invariant" | …)
 * @param kind      finding subtype (drives the bucket)
 * @param replay    { seed, scenario, tape, settleFrames } — how to reproduce
 * @param situation flow() snapshot { screen, goal, nextAction } at the moment
 * @param locus     where: frame index / file / entity id — the fault locus
 * @param raw       detector-specific payload
 * @param seed      the run seed (collected into the bucket)
 */
export function makeFinding({ oracle, kind, replay = null, situation = null, locus = null, raw = null, seed = null }) {
  return {
    oracle,
    kind,
    // Fault-locus-first bucket: same oracle+kind+locus = the same underlying bug
    // surfaced by many seeds. locus omitted → bucket by oracle+kind only.
    bucketKey: `${oracle}:${kind}${locus != null ? `@${locus}` : ""}`,
    replay,
    situation,
    locus,
    raw,
    seed,
    gameCommit: gameCommit(),
  };
}

/** Dedup ladder rung 1: collapse findings that share a bucketKey into one row,
 *  keeping the seed set (so the same bug from 40 seeds is ONE line, not 40). */
export function bucket(findings) {
  const by = new Map();
  for (const f of findings) {
    const cur = by.get(f.bucketKey);
    if (cur) { cur.count++; if (f.seed != null && !cur.seeds.includes(f.seed)) cur.seeds.push(f.seed); }
    else by.set(f.bucketKey, { ...f, count: 1, seeds: f.seed != null ? [f.seed] : [] });
  }
  return [...by.values()].sort((a, b) => b.count - a.count);
}

/** Delta-minimization: shrink a failing input tape to the shortest prefix that
 *  still fails, via `stillFails(prefixTape) => Promise<bool>`. Binary-search the
 *  length. Pure over the predicate — searchers pass their own replay closure. */
export async function minimizeTape(tape, stillFails) {
  if (!Array.isArray(tape) || tape.length <= 1) return tape;
  let lo = 1, hi = tape.length, best = tape;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    // eslint-disable-next-line no-await-in-loop
    if (await stillFails(tape.slice(0, mid))) { best = tape.slice(0, mid); hi = mid; }
    else lo = mid + 1;
  }
  return best;
}
