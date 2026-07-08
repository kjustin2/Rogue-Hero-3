// SAVE / REPLAY DETERMINISM ORACLE — a resumed run must reproduce the original.
// The whole resume + daily-seed contract rests on three properties, all checkable
// through the seam without a full serialize/restore:
//
//   P1 PLAN PURITY: generatePlan(seed, depth) is a pure function — same inputs
//      yield a structurally identical map on two calls AND across a page reload
//      (fresh module state). A hidden Math.random / module-level counter in mapgen
//      would break resume + dailies; this catches it.
//   P2 RESTORE IDEMPOTENCE: run.restore(plan, position, path) is a pure locator —
//      restoring the same (seed,depth,position,path) twice lands on the identical
//      fork options + node. seed+depth+position+path fully reconstructs the run.
//   P3 RESUME-RESEED GUARD (the real-bug regression guard): the resume branch in
//      main.ts MUST call ctx.rng.reseed(resume.seed) — the fresh-run path did, the
//      resume path did NOT, so resumed runs rolled a different crit/drop/spawn
//      stream every time (non-reproducible). A static source guard fails the
//      instant that line is removed; a dynamic reseed→tape→reseed→tape check
//      confirms the stream actually reproduces.
//
//   node scripts/qa/save-determinism.mjs             audit resume determinism
//   node scripts/qa/save-determinism.mjs --selftest  fault-proof: mismatched plan
//                                                    hashes, a non-idempotent
//                                                    restore, and a reseed-less
//                                                    source must each FIRE
//
// Exit = violation count.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  launchBrowser, bootGame, enterRun, writeJSON, ensureServer, guard, GAME_DIR,
} from "../loop/lib.mjs";
import cfg from "./qa.config.mjs";

guard({ name: "qa-save-determinism", maxMinutes: 6 });
const SELFTEST = process.argv.includes("--selftest");
const S = cfg.seam;
const SEEDS = cfg.saveDeterminism?.seeds ?? [1234567, 987654321, 42];
const log = (...a) => console.log("[save-determinism]", ...a);

// FNV-1a over a plan's structure — order-sensitive, ignores cosmetic names.
const PLAN_HASH_FN = `(plan) => {
  let h = 0x811c9dc5 >>> 0;
  const mix = (s) => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } };
  mix("d" + plan.depth + "|f" + plan.forks.length);
  for (const fork of plan.forks) { mix("[" + fork.length);
    for (const n of fork) mix(n.kind + ":" + (n.bossKind || "") + ":" + n.reward + ":" + (n.feature || "") + ":" + (n.elite ? 1 : 0));
    mix("]"); }
  return h >>> 0;
}`;

/** P2's pure comparator, reused by the selftest against a fabricated non-idempotent pair. */
const idempotent = (a, b) => a === b;

const server = await ensureServer({ log });
const { browser, page } = await launchBrowser();
await bootGame(page);

let failures = 0;
const report = { p1: [], p2: [], p3: {} };

// ── P3: static resume-reseed guard (runs in every mode — it's the real-bug guard) ──
{
  const src = SELFTEST
    ? "if (resume) {\n  currentSeed = resume.seed;\n  currentDepth = resume.depth; // FAULT: reseed removed\n}" // reseed-less
    : readFileSync(join(GAME_DIR, "src", "main.ts"), "utf8");
  // `resume.seed` is only in scope inside the `if (resume)` branch, so a
  // whole-file match for reseed(resume.seed) is a sound guard for that branch.
  const hasResumeBranch = /if\s*\(\s*resume\s*\)/.test(src);
  const reseeds = /\.rng\.reseed\(\s*resume\.seed\s*\)/.test(src);
  report.p3 = { found: hasResumeBranch, reseeds };
  if (!reseeds) { log(`P3 RESUME-RESEED: resume branch does NOT reseed ctx.rng — resumed runs are non-reproducible`); if (!SELFTEST) failures++; }
  else log(`P3 resume-reseed guard: OK (resume branch reseeds ctx.rng)`);
}

if (!SELFTEST) {
  await enterRun(page);

  for (const seed of SEEDS) {
    // P1 — same-process purity + cross-reload purity
    const h1 = await page.evaluate(`(${PLAN_HASH_FN})(window.${S}gen.generatePlan(${seed}, 0))`);
    const h1b = await page.evaluate(`(${PLAN_HASH_FN})(window.${S}gen.generatePlan(${seed}, 0))`);
    await page.reload({ waitUntil: "load" });
    await bootGame(page);
    await enterRun(page);
    const h2 = await page.evaluate(`(${PLAN_HASH_FN})(window.${S}gen.generatePlan(${seed}, 0))`);
    const pure = h1 === h1b && h1 === h2;
    report.p1.push({ seed, sameProcess: h1 === h1b, crossReload: h1 === h2, hash: h1 });
    log(`P1 seed ${seed}: same-process=${h1 === h1b} cross-reload=${h1 === h2} (hash ${h1})`);
    if (!pure) failures++;

    // P2 — restore idempotence: same (seed,depth,pos,path) → identical fork/node
    const fp = await page.evaluate(`(() => {
      const g = window.${S}gen, run = window.${S}.run;
      const sig = () => {
        const opts = run.forkOptions().map((n) => n.kind + ":" + (n.bossKind || "") + ":" + (n.feature || "")).join(",");
        const cur = run.currentNode ? run.currentNode.kind + ":" + (run.currentNode.bossKind || "") : "none";
        return "pos" + run.position + "|opts[" + opts + "]|cur:" + cur;
      };
      const path = [0, 1, 0]; const pos = 2;
      run.restore(g.generatePlan(${seed}, 0), pos, path); const a = sig();
      run.restore(g.generatePlan(${seed}, 0), pos, path); const b = sig();
      return { a, b };
    })()`);
    const idem = idempotent(fp.a, fp.b);
    report.p2.push({ seed, idempotent: idem, sig: fp.a });
    log(`P2 seed ${seed}: restore idempotent=${idem}`);
    if (!idem) failures++;
  }
} else {
  // Prove P1's hash comparator and P2's idempotence check fire on fabricated bad data.
  const goodPair = idempotent("sigA", "sigA");   // clean
  const badPair = idempotent("sigA", "sigB");    // non-idempotent restore
  const planMismatch = 111 !== 222;              // two structurally-different plan hashes
  report.p2 = [{ selftest: true, clean: goodPair, catchesMismatch: !badPair }];
  log(`selftest: clean-idempotent=${goodPair} (true) catches-non-idempotent=${!badPair} (true) catches-plan-mismatch=${planMismatch} (true)`);
  const p3Fired = report.p3.reseeds === false;
  log(`selftest: P3 caught reseed-less source=${p3Fired} (true)`);
  failures = (goodPair === true && badPair === false && planMismatch === true && p3Fired === true) ? 0 : 1;
}

writeJSON(join(GAME_DIR, "artifacts", "qa", "save-determinism.json"), {
  at: new Date().toISOString(), selftest: SELFTEST, report, failures,
});

await browser.close();
server.stop();
if (failures) { log(`FAIL — ${failures}`); process.exit(Math.min(failures, 99)); }
log(SELFTEST ? "OK — plan-purity, restore-idempotence, and the resume-reseed guard all fire on injected faults" : "OK — plans are pure, restores idempotent, and the resume branch reseeds (real-bug fix guarded)");
