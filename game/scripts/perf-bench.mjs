// PERFORMANCE BENCHMARK BATTERY + BASELINE REGRESSION
//
// Runs a fixed set of scenarios (menu → combat → every boss), samples standardized
// frame pacing + GPU load in each via the in-engine __rh3perf instrument, and
// screenshots each frame WITH the perf overlay baked in (so the gallery doubles as
// AI-readable evidence). Writes artifacts/perf/latest.json and diffs it against
// artifacts/perf/baseline.json — this is how you MEASURE an optimization:
//
//   node scripts/perf-bench.mjs                 # run + compare to baseline
//   node scripts/perf-bench.mjs --save-baseline # set the baseline from this run
//   node scripts/perf-bench.mjs --lowfx         # measure the lean (?lowfx) path
//   node scripts/perf-bench.mjs --ms 5000       # longer sample window per scenario
//   node scripts/perf-bench.mjs --gate-timing   # also fail on frame-time regressions
//
// Gating philosophy: draw calls / triangles / programs are GPU-independent and
// deterministic, so a regression there is real and gates the exit code. Frame
// TIMING under headless SwiftShader is noisy (~3× slow), so it is recorded for
// trend + relative comparison but only gates with --gate-timing. Big synchronous
// stalls (frames >250ms = shader-compile/GC freezes) always gate. Needs the dev
// server on :5174 (start `npm run dev` first).

import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  launchBrowser, bootGame, enterRun, gotoScenario, samplePerf, sleep,
  isServerUp, ensureDir, writeJSON, readJSON, GAME_DIR,
} from "./loop/lib.mjs";

const ARGS = process.argv.slice(2);
const has = (f) => ARGS.includes(f);
const val = (f, d) => (ARGS.includes(f) ? ARGS[ARGS.indexOf(f) + 1] : d);
const SAVE = has("--save-baseline") || has("--update");
const LOWFX = has("--lowfx");
const GATE_TIMING = has("--gate-timing");
const SAMPLE_MS = Number(val("--ms", 3500));

const OUT = join(GAME_DIR, "artifacts", "perf");
const SHOTS = join(OUT, "shots");
ensureDir(SHOTS);
const log = (...a) => console.log("[perf-bench]", ...a);

// Tolerances for the regression gate (deterministic load metrics).
const TOL = { callsRel: 0.15, callsAbs: 40, trisRel: 0.20, programsAbs: 0, timingRel: 0.40 };
const STALL_GATE = 2; // frames >250ms allowed before it's a hard fail

if (!(await isServerUp())) { console.error("[perf-bench] dev server not on :5174 — start `npm run dev`"); process.exit(2); }

function gitHead() {
  const r = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: GAME_DIR, encoding: "utf8" });
  return (r.stdout || "").trim() || "?";
}

/** Drive light-but-real combat input across the sample window (slashes + cards + a
 *  little movement) so the frame reflects active play, not an idle arena. */
async function combatAction(page) {
  const reps = Math.ceil(SAMPLE_MS / 520);
  for (let i = 0; i < reps; i++) {
    await page.evaluate(() => { window.__rh3perf?.mark?.("swing"); document.getElementById("game")?.dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true })); });
    await sleep(110);
    await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointerup", { button: 0, bubbles: true })));
    if (i % 3 === 0) await page.keyboard.press(["Digit1", "Digit2", "Digit3"][(i / 3) % 3 | 0]).catch(() => {});
    await page.evaluate(() => window.__rh3debug?.godmode?.());
    await sleep(Math.max(60, 520 - 110));
  }
}

// The battery. Each entry: { key, label, go(page), action?, budget? }.
// `go` lands the game on the frame to sample; `action` (optional) plays during it.
const BATTERY = [
  { key: "menu", label: "Main menu", budget: { over250: STALL_GATE },
    go: async (p) => { await sleep(600); } },
  { key: "hero-select", label: "Hero select", budget: { over250: STALL_GATE },
    go: async (p) => { await p.locator("button", { hasText: /Begin Run|New Run/ }).first().click(); await sleep(900); } },
  { key: "combat-act1", label: "Combat — Act I pack", action: combatAction, budget: { over250: STALL_GATE },
    go: async (p) => { await enterRun(p); } },
  { key: "combat-act3", label: "Combat — Act III roster", action: combatAction, budget: { over250: STALL_GATE },
    go: async (p) => { await p.evaluate(() => window.__rh3debug?.room("combat", 3)); await sleep(2600); await p.evaluate(() => window.__rh3debug?.godmode?.()); } },
  { key: "combat-act5", label: "Combat — Act V stress", action: combatAction, budget: { over250: STALL_GATE },
    go: async (p) => { await p.evaluate(() => window.__rh3debug?.room("combat", 5)); await sleep(2600); await p.evaluate(() => window.__rh3debug?.godmode?.()); } },
  ...["warden", "spire", "colossus", "tyrant", "unmaker", "echo"].map((k) => ({
    key: `boss-${k}`, label: `Boss — ${k}`, action: combatAction, budget: { over250: STALL_GATE + 1 },
    go: async (p) => { await gotoScenario(p, `boss:${k}`, { settle: 3000 }); },
  })),
];

const { browser, page, errors } = await launchBrowser();
const run = { meta: { head: gitHead(), lowfx: LOWFX, sampleMs: SAMPLE_MS, at: new Date().toISOString() }, scenarios: {} };

try {
  await bootGame(page, { query: LOWFX ? "?perf&lowfx" : "?perf" });
  for (const sc of BATTERY) {
    log(`▸ ${sc.key} — ${sc.label}`);
    try {
      await sc.go(page);
    } catch (e) { log(`  go() threw: ${e.message}`); }
    const stats = await samplePerf(page, { ms: SAMPLE_MS, label: sc.key, action: sc.action });
    await page.screenshot({ path: join(SHOTS, `${sc.key}.png`) });
    run.scenarios[sc.key] = { label: sc.label, budget: sc.budget ?? {}, stats };
    const s = stats;
    log(`  ${s.fps}fps mean ${s.mean}ms p95 ${s.p95}ms over250 ${s.over250}  draws ${s.snap?.calls} tris ${((s.snap?.triangles||0)/1000).toFixed(0)}k prog ${s.snap?.programs}`);
  }
} catch (err) {
  errors.push(`BENCH-THREW: ${err.message}`);
  log("ERROR:", err.message);
} finally {
  run.meta.consoleErrors = errors;
  await browser.close();
}

writeJSON(join(OUT, "latest.json"), run);

// ── Regression report vs baseline ────────────────────────────────────────────
const baseline = readJSON(join(OUT, "baseline.json"), null);
let gateFails = 0;
const rows = [];

const pctDelta = (now, was) => (was ? ((now - was) / was) * 100 : 0);
const fmtDelta = (now, was, lowerBetter = true) => {
  if (was == null) return "   (new)";
  const d = pctDelta(now, was);
  const sign = d >= 0 ? "+" : "";
  const good = lowerBetter ? d <= 0 : d >= 0;
  const tag = Math.abs(d) < 1 ? "" : good ? " ↓" : " ↑";
  return `${sign}${d.toFixed(0)}%${tag}`;
};

for (const [key, cur] of Object.entries(run.scenarios)) {
  const s = cur.stats, base = baseline?.scenarios?.[key]?.stats;
  const issues = [];

  // Absolute stall gate (always enforced).
  const stallMax = cur.budget?.over250 ?? STALL_GATE;
  if (s.over250 > stallMax) { issues.push(`STALL ${s.over250}>${stallMax}`); gateFails++; }

  if (base && base.snap && s.snap) {
    // Deterministic GPU-load regressions gate the build.
    const dCalls = s.snap.calls - base.snap.calls;
    if (dCalls > TOL.callsAbs && pctDelta(s.snap.calls, base.snap.calls) > TOL.callsRel * 100) {
      issues.push(`draws +${dCalls}`); gateFails++;
    }
    if (pctDelta(s.snap.triangles, base.snap.triangles) > TOL.trisRel * 100) {
      issues.push(`tris ${fmtDelta(s.snap.triangles, base.snap.triangles)}`); gateFails++;
    }
    const dProg = s.snap.programs - base.snap.programs;
    if (dProg > TOL.programsAbs) { issues.push(`+${dProg} shader program(s)`); gateFails++; }

    // Timing regressions: reported always, gated only with --gate-timing.
    if (pctDelta(s.p95, base.stats?.p95 ?? base.p95) > TOL.timingRel * 100) {
      const note = `p95 ${fmtDelta(s.p95, base.p95)}`;
      if (GATE_TIMING) { issues.push(note); gateFails++; } else issues.push(`(${note})`);
    }
  }
  rows.push({
    key, fps: s.fps, mean: s.mean, p95: s.p95, over250: s.over250,
    calls: s.snap?.calls ?? 0, tris: s.snap?.triangles ?? 0, prog: s.snap?.programs ?? 0,
    dMean: fmtDelta(s.mean, base?.mean), dCalls: fmtDelta(s.snap?.calls, base?.snap?.calls),
    status: issues.length ? issues.join(", ") : (base ? "ok" : "new"),
  });
}

console.log("\n=== PERF BENCH" + (LOWFX ? " (lowfx)" : "") + " — head " + run.meta.head + (baseline ? ` vs baseline ${baseline.meta?.head}` : " (no baseline)") + " ===");
console.log("scenario        fps   mean    p95  >250  draws  Δdraws   tris   prog  status");
for (const r of rows) {
  console.log(
    r.key.padEnd(15) +
    String(r.fps).padStart(5) + String(r.mean).padStart(7) + String(r.p95).padStart(7) +
    String(r.over250).padStart(5) + String(r.calls).padStart(7) + r.dCalls.padStart(8) +
    (`${(r.tris / 1000).toFixed(0)}k`).padStart(7) + String(r.prog).padStart(6) + "  " + r.status,
  );
}

if (SAVE) {
  writeJSON(join(OUT, "baseline.json"), run);
  console.log(`\n[perf-bench] baseline SAVED (head ${run.meta.head}). Future runs diff against this.`);
}

const errN = errors.length;
console.log(errN ? `\nCONSOLE ERRORS (${errN}): ${errors.slice(0, 5).join(" | ")}` : "\nNO CONSOLE ERRORS");
console.log(`shots → ${SHOTS}`);
const pass = gateFails === 0 && errN === 0;
console.log(pass ? "PERF-BENCH: PASS" : `PERF-BENCH: ${gateFails} regression(s)${errN ? ` + ${errN} console error(s)` : ""}`);
process.exit(pass ? 0 : 1);
