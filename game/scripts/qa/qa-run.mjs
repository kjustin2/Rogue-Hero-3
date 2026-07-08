// THE GAME DOCTOR — one command, one health report.
//
//   node scripts/qa/qa-run.mjs                # quick: build + core smokes + chaos + contact/gates + perf smokes
//   node scripts/qa/qa-run.mjs --full         # + full suite, flicker gate, perf bench vs baseline
//   node scripts/qa/qa-run.mjs --judge        # + AI visual judge (contact sheet + filmstrip)
//   node scripts/qa/qa-run.mjs --only chaos   # a single phase
//   node scripts/qa/qa-run.mjs --skip-build
//
// Runs every dimension of game health through the existing (guarded) harness
// pieces and aggregates ONE artifact: artifacts/qa/QA.md + qa.json — the file a
// human or an AI session reads to know what to fix next. Serial, timeboxed,
// tree-killed on hang, all under the machine lock. Exit = failed dimensions.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { guard, track, untrack, killTree } from "../lib/guard.cjs";
import { GAME_DIR, ensureServer, writeJSON, writeText, readJSON, sleep } from "../loop/lib.mjs";
import cfg from "./qa.config.mjs";

const ARGS = process.argv.slice(2);
const FULL = ARGS.includes("--full");
const JUDGE = ARGS.includes("--judge");
const ONLY = ARGS.includes("--only") ? ARGS[ARGS.indexOf("--only") + 1] : null;
const OUT = join(GAME_DIR, "artifacts", "qa");
guard({ name: `qa-${FULL ? "full" : "quick"}`, maxMinutes: FULL ? 110 : 55 });
const log = (...a) => console.log("\x1b[35m[qa]\x1b[0m", ...a);
const startedAt = Date.now();

/** Run a child with a timebox; returns {status, code, seconds, tail}. */
function run(cmd, args, { minutes = 8, label = args[0] } = {}) {
  return new Promise((resolveP) => {
    const t0 = Date.now();
    const child = spawn(cmd, args, { cwd: GAME_DIR, stdio: ["ignore", "pipe", "pipe"], shell: cmd === "npm" });
    track(child);
    let out = "";
    const keep = (d) => { out += d; if (out.length > 60_000) out = out.slice(-40_000); };
    child.stdout.on("data", keep); child.stderr.on("data", keep);
    const timer = setTimeout(() => { killTree(child.pid); fin("TIMEOUT", null); }, minutes * 60_000);
    let done = false;
    const fin = (status, code) => {
      if (done) return; done = true;
      clearTimeout(timer); untrack(child);
      resolveP({ status, code, seconds: Math.round((Date.now() - t0) / 1000), tail: out.trim().split(/\r?\n/).slice(-15).join("\n") });
    };
    child.on("exit", (code) => fin(code === 0 ? "PASS" : "FAIL", code));
    child.on("error", (e) => { keep(String(e)); fin("FAIL", -1); });
  });
}
const node = (args, o) => run(process.execPath, args, o);

const dims = {}; // name -> { status: "PASS"|"WARN"|"FAIL"|"SKIP", detail, evidence }
const phase = async (name, enabled, fn) => {
  if (ONLY && ONLY !== name) return;
  if (!enabled) { dims[name] = { status: "SKIP", detail: "not in this mode" }; return; }
  log(`── ${name} ──`);
  try { dims[name] = await fn(); }
  catch (e) { dims[name] = { status: "FAIL", detail: `phase threw: ${e.message}` }; }
  log(`${name}: ${dims[name].status} — ${dims[name].detail}`);
};

const server = await ensureServer({ log });

// 1) BUILD — tsc + vite
await phase("build", !ARGS.includes("--skip-build"), async () => {
  const r = await run("npm", ["run", "verify"], { minutes: 10, label: "verify" });
  return r.status === "PASS"
    ? { status: "PASS", detail: "tsc --noEmit && vite build clean" }
    : { status: "FAIL", detail: `verify ${r.status}`, evidence: r.tail };
});
if (dims.build?.status === "FAIL" && !ONLY) bail("build is broken — fix that first");

// 2) FUNCTIONAL — the smoke fleet through the suite runner
await phase("functional", true, async () => {
  const group = FULL ? cfg.phases.suiteFull : cfg.phases.suiteQuick;
  const r = await run(process.execPath, ["scripts/run-suite.mjs", group], { minutes: FULL ? 60 : 25 });
  const sum = readJSON(join(GAME_DIR, "artifacts", "suite", "summary.json"), null);
  if (!sum) return { status: "FAIL", detail: `suite ${r.status}, no summary`, evidence: r.tail };
  const flaky = sum.results.filter((x) => x.status === "FLAKY").length;
  const failed = sum.results.filter((x) => x.status !== "PASS" && x.status !== "FLAKY");
  return failed.length
    ? { status: "FAIL", detail: `${failed.length}/${sum.results.length} smokes failed: ${failed.map((f) => f.file).join(", ")}`, evidence: "artifacts/suite/SUITE.md" }
    : { status: flaky ? "WARN" : "PASS", detail: `${sum.pass}/${sum.results.length} smokes green${flaky ? ` (${flaky} flaky)` : ""} in ${sum.totalSeconds}s`, evidence: "artifacts/suite/SUITE.md" };
});

// 3) STABILITY — seeded chaos bot (oracles: NaN / bounds / hp / stuck / progress / frame errors)
await phase("stability", true, async () => {
  const r = await node(["scripts/qa/chaos.mjs"], { minutes: 10 });
  const c = readJSON(join(OUT, "chaos.json"), null);
  if (!c) return { status: "FAIL", detail: `chaos ${r.status}, no report`, evidence: r.tail };
  const v = c.violations.length, ce = c.consoleErrors.length;
  return v || ce
    ? { status: "FAIL", detail: `${v} oracle violation(s) [${[...new Set(c.violations.map((x) => x.type))].join(", ")}], ${ce} console error(s)`, evidence: "artifacts/qa/chaos.json + shots/chaos/" }
    : { status: "PASS", detail: `chaos drive clean (seed ${c.seed}, ${c.seconds}s)` };
});

// 4) COVERAGE — required events fired during the chaos drive
await phase("coverage", true, async () => {
  const c = readJSON(join(OUT, "chaos.json"), null);
  if (!c) return { status: "SKIP", detail: "no chaos report" };
  return c.missingCoverage.length
    ? { status: "WARN", detail: `never fired: ${c.missingCoverage.join(", ")}`, evidence: "artifacts/qa/chaos.json" }
    : { status: "PASS", detail: `all ${cfg.coverage.required.length} required events fired` };
});

// 4b) COLLISION-TRUTH — render geometry and the collider set must agree about
// where solid matter is (walk-through props + invisible walls, both directions).
await phase("collision-truth", true, async () => {
  const r = await node(["scripts/qa/collision-truth.mjs"], { minutes: 8 });
  const c = readJSON(join(OUT, "collision-truth.json"), null);
  if (!c) return { status: "FAIL", detail: `collision-truth ${r.status}, no report`, evidence: r.tail };
  const n = c.results.reduce((a, x) => a + x.unclassified.length + x.uncovered.length + x.phantom.length, 0);
  return n
    ? { status: "FAIL", detail: `${n} geometry↔collider disagreement(s) — see collision-truth.json`, evidence: "artifacts/qa/collision-truth.json" }
    : { status: "PASS", detail: `scene and colliders agree in ${c.results.length} staged scenes` };
});

// 4c) REACHABILITY — nothing walkable may be sealed off; no sub-player gaps.
await phase("reachability", true, async () => {
  const r = await node(["scripts/qa/reachability.mjs"], { minutes: 8 });
  const c = readJSON(join(OUT, "reachability.json"), null);
  if (!c) return { status: "FAIL", detail: `reachability ${r.status}, no report`, evidence: r.tail };
  const pockets = c.results.reduce((a, x) => a + x.pockets.length, 0);
  const gaps = c.results.reduce((a, x) => a + x.narrowGaps.length, 0);
  return pockets
    ? { status: "FAIL", detail: `${pockets} unreachable pocket(s)${gaps ? `, ${gaps} narrow gap(s)` : ""}`, evidence: "artifacts/qa/reachability.json" }
    : { status: gaps ? "WARN" : "PASS", detail: gaps ? `${gaps} sub-player gap(s) look passable but aren't` : "every passable cell reachable" };
});

// 4d) TEMPORAL — frozen-pair shimmer/z-speckle (GL-only) + fixed-tick clips swept
// by ffmpeg no-reference filters + CAMBI banding; transients auto-classified.
await phase("temporal", true, async () => {
  const r = await node(["scripts/qa/temporal.mjs"], { minutes: 14 });
  const c = readJSON(join(OUT, "temporal.json"), null);
  if (!c) return { status: "FAIL", detail: `temporal ${r.status}, no report`, evidence: r.tail };
  const n = c.results.reduce((a, x) => a + x.findings.length, 0);
  const warns = c.results.filter((x) => x.warn).length;
  return n
    ? { status: "FAIL", detail: `${n} temporal artifact(s): ${c.results.flatMap((x) => x.findings.map((f) => f.type)).join(", ")}`, evidence: "artifacts/qa/temporal.json + shots/temporal/" }
    : { status: warns ? "WARN" : "PASS", detail: warns ? `${warns} transient instability warning(s) — see temporal.json` : `frozen scenes bit-stable, clips clean${c.ffmpeg ? " (ffmpeg tier on)" : " (ffmpeg MISSING — no-reference tier skipped)"}` };
});

// 4e) ANIMATION — foot-skate / jitter / smoothness as measured numbers.
await phase("animation", true, async () => {
  const r = await node(["scripts/qa/animation-metrics.mjs"], { minutes: 8 });
  const c = readJSON(join(OUT, "animation.json"), null);
  if (!c) return { status: "FAIL", detail: `animation ${r.status}, no report`, evidence: r.tail };
  const m = c.results[0] ?? {};
  return c.failures
    ? { status: "FAIL", detail: `${c.failures} motion finding(s) — skate/m=${m.skatePerMeter}, jitter=${m.jitterMs2}`, evidence: "artifacts/qa/animation.json" }
    : { status: "PASS", detail: `grounded + smooth: skate/m=${m.skatePerMeter}, jitter=${m.jitterMs2}m/s², sparc=${m.sparc}` };
});

// 4f) RENDER-DIAG — subject pixel-coverage (is the player/boss actually on
// screen?) + the ε-camera-shift static z-fight probe.
await phase("render-diag", true, async () => {
  const r = await node(["scripts/qa/render-diag.mjs"], { minutes: 10 });
  const c = readJSON(join(OUT, "render-diag.json"), null);
  if (!c) return { status: "FAIL", detail: `render-diag ${r.status}, no report`, evidence: r.tail };
  const n = c.results.reduce((a, x) => a + x.findings.length, 0);
  return n
    ? { status: "FAIL", detail: `${n} finding(s): ${c.results.flatMap((x) => x.findings.map((f) => f.type)).join(", ")}`, evidence: "artifacts/qa/render-diag.json" }
    : { status: "PASS", detail: "subjects visible; static scene depth-stable under ε camera shift" };
});

// 4g) UI-AUDIT — deterministic DOM UI gate (overlap / truncation / offscreen /
// contrast / dead-control / raw-text-leak) at 5 viewports + a pseudoloc pass.
await phase("ui-audit", true, async () => {
  const r = await node(["scripts/qa/ui-audit.mjs"], { minutes: 12 });
  const c = readJSON(join(OUT, "ui-audit.json"), null);
  if (!c) return { status: "FAIL", detail: `ui-audit ${r.status}, no report`, evidence: r.tail };
  const n = (c.results || []).reduce((a, x) => a + (x.findings?.length ?? 0), 0);
  const warn = (c.results || []).reduce((a, x) => a + (x.warnings?.length ?? 0), 0);
  return n
    ? { status: "FAIL", detail: `${n} DOM UI finding(s): ${[...new Set(c.results.flatMap((x) => (x.findings || []).map((f) => f.rule)))].join(", ")}`, evidence: "artifacts/qa/ui-audit.json" }
    : { status: warn ? "WARN" : "PASS", detail: warn ? `clean; ${warn} pseudoloc (localization headroom) warning(s)` : "DOM UI clean across every screen × viewport (+ pseudoloc)" };
});

// 4h) PIXEL-UI — HUD text contrast vs the REAL framebuffer + ghost-widget hash
// (the compositing residual the DOM auditUI structurally cannot measure).
await phase("pixel-ui", true, async () => {
  const r = await node(["scripts/qa/pixel-ui.mjs"], { minutes: 10 });
  const c = readJSON(join(OUT, "pixel-ui.json"), null);
  if (!c) return { status: "FAIL", detail: `pixel-ui ${r.status}, no report`, evidence: r.tail };
  const n = (c.results || []).reduce((a, x) => a + (x.findings?.length ?? 0), 0);
  return n
    ? { status: "FAIL", detail: `${n} finding(s): ${[...new Set(c.results.flatMap((x) => (x.findings || []).map((f) => f.type)))].join(", ")}`, evidence: "artifacts/qa/pixel-ui.json" }
    : { status: "PASS", detail: `HUD text reads against the real framebuffer; no ghost widgets` };
});

// 5) VISUAL — fresh contact sheet + objective frame gates
await phase("visual", true, async () => {
  rmSync(join(GAME_DIR, cfg.judge.shotsDir), { recursive: true, force: true }); // no stale evidence
  const cap = await node([`scripts/${cfg.phases.contactSheet}`, cfg.judge.shotsDir], { minutes: 8 });
  const auditJson = join(OUT, "contact-audit.json");
  await node(["scripts/shot-audit.mjs", cfg.judge.shotsDir, "--json", auditJson], { minutes: 4 });
  const audit = readJSON(auditJson, { shots: [] });
  const flagged = audit.shots.filter((s) => s.flags.length);
  if (cap.status !== "PASS") return { status: "FAIL", detail: `contact-sheet capture ${cap.status}`, evidence: cap.tail };
  return flagged.length
    ? { status: "FAIL", detail: `${flagged.length} frame(s) failed gates: ${flagged.map((f) => `${f.file.split("/").pop()}[${f.flags}]`).join(", ")}`, evidence: cfg.judge.shotsDir }
    : { status: "PASS", detail: `${audit.shots.length} beats captured, all pass BLACK/BLOWOUT/FLAT/DUP gates`, evidence: cfg.judge.shotsDir };
});

// 6) GLITCH — the temporal shimmer + additive-blowout gate (full mode: slow)
await phase("glitch", FULL, async () => {
  const r = await node([`scripts/${cfg.phases.flicker}`], { minutes: 12 });
  return r.status === "PASS"
    ? { status: "PASS", detail: "shimmer + blowout gates clean" }
    : { status: "FAIL", detail: `flicker gate ${r.status}`, evidence: r.tail };
});

// 7) PERF — budget smokes (quick) or the full bench vs baseline (full)
await phase("perf", true, async () => {
  const scripts = FULL ? cfg.phases.perfFull : cfg.phases.perfQuick;
  const results = [];
  for (const s of scripts) results.push({ s, r: await node([`scripts/${s}`], { minutes: FULL ? 25 : 10 }) });
  const bad = results.filter((x) => x.r.status !== "PASS");
  return bad.length
    ? { status: "FAIL", detail: bad.map((x) => `${x.s}: ${x.r.status}`).join(", "), evidence: bad[0].r.tail }
    : { status: "PASS", detail: `${scripts.join(", ")} within budgets` };
});

// 8) RUNTIME HEALTH — frame errors + coarse perf tripwire from the chaos readback
await phase("runtime", true, async () => {
  const c = readJSON(join(OUT, "chaos.json"), null);
  if (!c) return { status: "SKIP", detail: "no chaos report" };
  const ferr = c.violations.filter((v) => v.type === "FRAME-ERRORS").length;
  const notes = [];
  if (ferr) notes.push("frame loop caught errors (see chaos.json)");
  if (c.programsDelta > 0) notes.push(`+${c.programsDelta} shader programs compiled AFTER warm-up (first-use hitch fuel — extend warmUp)`);
  if (c.perf?.calls > cfg.perfBudget.maxDrawCalls) notes.push(`draw calls ${c.perf.calls} > ${cfg.perfBudget.maxDrawCalls}`);
  if (c.perf?.programs > cfg.perfBudget.maxPrograms) notes.push(`programs ${c.perf.programs} > ${cfg.perfBudget.maxPrograms}`);
  return notes.length
    ? { status: ferr ? "FAIL" : "WARN", detail: notes.join("; "), evidence: "artifacts/qa/chaos.json" }
    : { status: "PASS", detail: `frame loop clean; ${c.perf ? `${c.perf.calls} draws, ${c.perf.programs} programs, ${c.perf.heapMB}MB heap` : "no perf readback"}` };
});

// 8b) DETECTOR SELFTEST (full mode) — the fault-injection proof: every perception
// detector must fire on its injected fault and stay quiet clean.
await phase("selftest", FULL, async () => {
  const r = await node(["scripts/qa/selftest.mjs"], { minutes: 30 });
  const c = readJSON(join(OUT, "selftest.json"), null);
  if (!c) return { status: "FAIL", detail: `selftest ${r.status}, no report`, evidence: r.tail };
  return c.failed
    ? { status: "FAIL", detail: `${c.failed} detector suite(s) failed their fault-proof`, evidence: "artifacts/qa/selftest.json" }
    : { status: "PASS", detail: `${c.results.length}/${c.results.length} detector suites proven (fire on fault, quiet clean)` };
});

// 8c) COMPREHENSION (full mode — costs cheap claude calls) — articulability gate
// over flow() + the blind context-free legibility probe scored against flow().
await phase("comprehension", FULL, async () => {
  const r = await node(["scripts/qa/comprehend.mjs"], { minutes: 16 });
  const c = readJSON(join(OUT, "comprehend.json"), null);
  if (!c) return { status: "FAIL", detail: `comprehend ${r.status}, no report`, evidence: r.tail };
  if (c.failures) return { status: "FAIL", detail: `${c.failures} inarticulate/failed beat(s) — see comprehend.json`, evidence: "artifacts/qa/comprehend.json" };
  const low = (c.results || []).filter((x) => typeof x.rate === "number" && x.rate < 0.5);
  return low.length
    ? { status: "WARN", detail: `${low.length} beat(s) hard to read blind: ${low.map((x) => x.beat).join(", ")} ($${c.costUSD})`, evidence: "artifacts/qa/comprehend.json" }
    : { status: "PASS", detail: `all beats articulable + legible to a blind reader ($${c.costUSD})` };
});

// 8d) STYLE-DRIFT (full mode — loads a CLIP model) — reference-based aesthetic
// drift vs the look bible; WARN-only (a look change may be intentional).
await phase("style-drift", FULL, async () => {
  const r = await node(["scripts/qa/style-drift.mjs"], { minutes: 12 });
  const c = readJSON(join(OUT, "style-drift.json"), null);
  if (!c) return { status: "WARN", detail: `style-drift ${r.status}, no report (bible baked? qa:style-bake)`, evidence: r.tail };
  const drifted = (c.results || []).filter((x) => x.status === "DRIFTED");
  return drifted.length
    ? { status: "WARN", detail: `${drifted.length} scene(s) drifted from the look bible beyond dead-band: ${drifted.map((x) => `${x.scene}(${x.drift})`).join(", ")}`, evidence: "artifacts/qa/style-drift.json" }
    : { status: "PASS", detail: `no scene drifted beyond dead-band vs the look bible` };
});

// 9) JUDGE — AI visual verdicts (opt-in; costs a claude call)
await phase("judge", JUDGE, async () => {
  const r = await node(["scripts/qa/judge.mjs"], { minutes: 18 });
  const j = readJSON(join(OUT, "judge.json"), null);
  if (!j) return { status: "FAIL", detail: `judge ${r.status}, no report`, evidence: r.tail };
  const high = (j.rankedIssues || []).filter((i) => i.severity === "high");
  return high.length ? { status: "FAIL", detail: `${high.length} high-severity visual issue(s): ${high.map((i) => i.issue).join(" | ")}`, evidence: "artifacts/qa/judge.json" }
    : (j.rankedIssues || []).length ? { status: "WARN", detail: `${j.rankedIssues.length} minor issue(s) — see judge.json`, evidence: "artifacts/qa/judge.json" }
    : { status: "PASS", detail: `${j.judged} shots judged clean` };
});

if (server.owned) { log("stopping dev server we started"); server.stop(); }

// ── the health card ─────────────────────────────────────────────────────────
const ICON = { PASS: "✅", WARN: "⚠️", FAIL: "❌", SKIP: "➖" };
const order = ["build", "functional", "stability", "coverage", "collision-truth", "reachability", "temporal", "animation", "render-diag", "ui-audit", "pixel-ui", "visual", "glitch", "perf", "runtime", "comprehension", "style-drift", "selftest", "judge"];
const rows = order.filter((k) => dims[k]).map((k) => ({ dim: k, ...dims[k] }));
const failed = rows.filter((r) => r.status === "FAIL");
const totalMin = Math.round((Date.now() - startedAt) / 60_000);

const card = {
  at: new Date(startedAt).toISOString(), game: cfg.name, mode: FULL ? "full" : "quick", judged: JUDGE,
  minutes: totalMin, failed: failed.map((r) => r.dim), dims,
};
writeJSON(join(OUT, "qa.json"), card);
writeText(join(OUT, "QA.md"), `# ${cfg.name} — QA health card (${card.mode}${JUDGE ? "+judge" : ""})

**${rows.length - failed.length}/${rows.filter((r) => r.status !== "SKIP").length} dimensions healthy** — ${totalMin} min — ${card.at}

| Dimension | Status | Detail | Evidence |
|---|---|---|---|
${rows.map((r) => `| ${r.dim} | ${ICON[r.status]} ${r.status} | ${r.detail} | ${r.evidence ?? ""} |`).join("\n")}

${failed.length ? `## Fix next (in order)\n\n${failed.map((r, i) => `${i + 1}. **${r.dim}** — ${r.detail}${r.evidence ? `\n   evidence: \`${r.evidence}\`` : ""}`).join("\n")}` : "All green. Ship it."}
`);

console.log(`\n${"═".repeat(60)}`);
for (const r of rows) console.log(`  ${ICON[r.status]} ${r.dim.padEnd(11)} ${r.detail}`);
console.log(`${"═".repeat(60)}\n[qa] ${failed.length ? `${failed.length} dimension(s) FAILING` : "ALL HEALTHY"} — full card: artifacts/qa/QA.md`);
process.exit(failed.length);

function bail(msg) {
  log(`BAIL: ${msg}`);
  if (server.owned) server.stop();
  writeJSON(join(OUT, "qa.json"), { at: new Date().toISOString(), bailed: msg, dims });
  process.exit(2);
}
