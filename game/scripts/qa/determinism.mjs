// DETERMINISM GOLDEN-TRACE — the sim's own metamorphic relation: same (seed +
// fixed input tape + fixed dt) MUST yield the same simHash() sequence every
// frame. This is the backbone the whole autonomous/record-replay tier stands on
// (Phase 7 differential replay, Go-Explore "seed IS the repro"), and it's what
// caught RH3's 39 sim-Math.random() leaks. Deterministic; no pixels; no VLM.
//
//   node scripts/qa/determinism.mjs             two identical traces must match
//   node scripts/qa/determinism.mjs --selftest  fault-proof: a one-draw RNG skew
//                                               on run B MUST diverge at that frame,
//                                               and a cosmetic (Math.random) particle
//                                               path MUST NOT move the hash
//
// Drives PURE seam actions (spawn + frame-step), never wall-clock, so the trace
// is bit-stable. Exit = failure count.
import { join } from "node:path";
import {
  launchBrowser, bootGame, enterRun, gotoScenario, writeJSON, ensureServer, guard, GAME_DIR,
} from "../loop/lib.mjs";
import cfg from "./qa.config.mjs";

guard({ name: "qa-determinism", maxMinutes: 8 });
const SELFTEST = process.argv.includes("--selftest");
const S = cfg.seam;
const SEED = 20260707;
const FRAMES = 150;         // enough for enemy AI (strafe/wander/blink) + spawns to evolve
// Offset so NO enemy is axis-collinear with the player at origin — a perfectly
// collinear spawn (dx==0) makes atan2 flip the heading sign on sub-femto FP noise
// (a measure-zero config real gameplay never hits; the golden trace must avoid it).
const SPAWN = [["husk", -6, -3], ["caster", 6, -3], ["leaper", 3, 7], ["brute", -4, 5]];
const log = (...a) => console.log("[determinism]", ...a);

const server = await ensureServer({ log });
const { browser, page } = await launchBrowser();

// The inner tape, run in-page after a FRESH boot+stage. Isolation via a fresh page
// per trace is essential: room:combat's wave director + other ctx.rng consumers
// carry state across a re-stage and desync the stream — a fresh page gives both
// runs identical starting conditions (deterministic staging + a clean rng).
const TAPE = (opts = {}) => `(async () => {
  const c = window.${S};
  const d = window.${S}debug;
  const skewAt = ${opts.skewAt ?? -1};
  const cosmetic = ${opts.cosmetic ? "true" : "false"};
  d.godmode();
  // clearNonBosses() drops lesser enemies AND lesser PENDING spawns — the wave
  // director's leftover pending (queued during the wall-clock settle) is what
  // desynced two runs. The banished boss (grace 1e9, dt-based → never ticks/draws)
  // suppresses the wave director entirely, so the only rng consumers in the tape
  // are the enemies WE spawn.
  c.enemies.clearNonBosses();
  d.frames(2, 1/60);
  c.rng.reseed(${SEED});
  for (const [kind, x, z] of ${JSON.stringify(SPAWN)}) { try { c.enemies.spawn(kind, x, z, 0); } catch {} }
  c.player.pos.x = 0; c.player.pos.z = 0; c.player.hp = c.player.maxHp;
  const hashes = [];
  for (let f = 0; f < ${FRAMES}; f++) {
    if (f === skewAt) c.rng.next();                 // fault: one extra draw
    if (cosmetic) { try { c.fx.burst({ x: 2, y: 1, z: 0, count: 3, color: 0xffffff, speed: [1,2], up: 0.4, size: [0.2,0.4], life: [0.1,0.3], gravity: -2, drag: 3 }); } catch {} }
    d.frames(1, 1/60);
    hashes.push(d.simHash());
  }
  return hashes;
})()`;

/** Fresh boot → stage → reseed → spawn → tape. Two calls with identical opts must
 *  produce identical hash sequences (the golden-trace MR). */
async function trace(opts = {}) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await bootGame(page);
  await enterRun(page);
  // enemy:<kind> stages a banished-boss holding room (no wave director) — the
  // deterministic substrate for the golden trace.
  await gotoScenario(page, "enemy:husk", { settle: 2200 });
  return page.evaluate(TAPE(opts));
}

let failures = 0;
const results = {};

const A = await trace();
const B = await trace();
const evolves = new Set(A).size > 3;            // the sim must actually change (else the hash is meaningless)
const identical = A.length === B.length && A.every((h, i) => h === B[i]);
results.baseline = { frames: A.length, distinctHashes: new Set(A).size, identical };
log(`baseline: ${A.length} frames, ${new Set(A).size} distinct hashes, A===B: ${identical}`);
if (!evolves) { log("FAIL: sim state did not evolve — the golden trace is inert (hash not covering live state?)"); failures++; }
if (!identical) {
  const at = A.findIndex((h, i) => h !== B[i]);
  log(`FAIL: two identical (seed,tape) runs diverged at frame ${at} — a nondeterministic sim leak remains`);
  failures++;
}

if (SELFTEST) {
  // DIVERGENCE fault: one extra rng draw at frame 40 on run B must flip the hash
  // from frame 40 onward (and be IDENTICAL before it — proves the hash localizes).
  const skewAt = 40;
  const C = await trace({ skewAt });
  const firstDiff = A.findIndex((h, i) => h !== C[i]);
  const cleanBefore = A.slice(0, skewAt).every((h, i) => h === C[i]);
  results.skew = { skewAt, firstDiff, cleanBefore };
  log(`selftest DIVERGENCE (one extra rng draw @${skewAt}): firstDiff=${firstDiff}, identical-before=${cleanBefore}`);
  if (!(firstDiff >= skewAt && cleanBefore)) { log("SELFTEST FAIL: a single-draw RNG skew was not caught at its exact frame"); failures++; }

  // COSMETIC negative: firing Math.random-driven particles every frame must NOT
  // change the sim hash (proves cosmetic RNG is correctly outside the sim state).
  const D = await trace({ cosmetic: true });
  const cosmeticMatches = A.length === D.length && A.every((h, i) => h === D[i]);
  results.cosmetic = { matches: cosmeticMatches };
  log(`selftest COSMETIC (Math.random particle burst each frame): hash unchanged=${cosmeticMatches}`);
  if (!cosmeticMatches) { log("SELFTEST FAIL: a cosmetic Math.random path moved the sim hash — a cosmetic call leaked into sim state"); failures++; }
}

writeJSON(join(GAME_DIR, "artifacts", "qa", "determinism.json"), {
  at: new Date().toISOString(), selftest: SELFTEST, seed: SEED, results, failures,
});

await browser.close();
server.stop();
if (failures) { log(`FAIL — ${failures}`); process.exit(Math.min(failures, 99)); }
log("OK — the sim is bit-deterministic under (seed, fixed tape); cosmetic RNG stays out of the hash");
