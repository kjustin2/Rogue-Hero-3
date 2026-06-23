// ORCHESTRATE — the closed improvement loop.
//
//   capture → logic → observe → DECIDE → implement → build-gate → re-verify
//
// One cycle per iteration; repeats until every goal is met or a budget cap is
// hit. Crash-safe (state persisted after every phase; an interrupted implement
// is reverted on resume) and surgically safe (a failed build reverts only that
// cycle's own edits, never your pre-existing working-tree changes).
//
// Usage:
//   node scripts/loop/orchestrate.mjs [--max-cycles N] [--max-minutes M]
//                                     [--model NAME] [--no-implement] [--reset]
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GOALS, isMet } from "./goals.mjs";
import {
  ARTIFACTS, STATE_FILE, cycleDir, ensureDir, readJSON, writeJSON, writeText,
  ensureServer, runVerify, gitRevertCycle, existsSync, rmSync,
} from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : def;
};
const has = (flag) => process.argv.includes(flag);

const MAX_CYCLES = parseInt(arg("--max-cycles", "6"), 10);
const MAX_MINUTES = parseInt(arg("--max-minutes", "120"), 10);
const MODEL = arg("--model", "");
const DO_IMPLEMENT = !has("--no-implement");
const startTs = Date.now();
const deadline = startTs + MAX_MINUTES * 60_000;
const log = (...a) => console.log("\x1b[36m[loop]\x1b[0m", ...a);

if (has("--reset") && existsSync(ARTIFACTS)) {
  rmSync(ARTIFACTS, { recursive: true, force: true });
  log("reset: cleared artifacts/loop");
}
ensureDir(ARTIFACTS);

/** Run a stage script as an isolated child; returns its exit code. */
function stage(script, dir, env = {}) {
  const r = spawnSync(process.execPath, [join(HERE, script), "--out", dir], {
    cwd: join(HERE, "..", ".."), stdio: "inherit",
    env: { ...process.env, LOOP_CYCLE_DIR: dir, ...(MODEL ? { LOOP_MODEL: MODEL } : {}), ...env },
  });
  return r.status ?? 1;
}

// ── state (resume-safe) ──────────────────────────────────────────────────
let state = readJSON(STATE_FILE) || {
  startedAt: new Date().toISOString(), status: "running", cycles: [],
  goal: "All defined goals met (visual + logical).",
};
const persist = () => writeJSON(STATE_FILE, state);

// Recover from an interrupted implement: revert its uncertain edits, redo cycle.
const last = state.cycles[state.cycles.length - 1];
if (last && last.phase && last.phase !== "done") {
  log(`resuming: cycle ${last.n} was mid-"${last.phase}" — rolling it back`);
  if (last.implement?.base) gitRevertCycle(last.implement.base);
  state.cycles.pop();
  persist();
}

// ── goal evaluation ──────────────────────────────────────────────────────
function evaluateGoals(observe, logicFile) {
  const results = GOALS.map((g) => {
    const visual = g.rubric ? (observe.verdicts?.[g.id] ?? { pass: false, evidence: "no verdict" }) : null;
    const guard = g.guard ? (logicFile.guards?.[g.id] ?? { pass: false, detail: "no guard" }) : null;
    const logic = g.assert ? (logicFile.logic?.[g.id] ?? { pass: false, detail: "no result" }) : null;
    return { id: g.id, title: g.title, met: isMet(g, { visual, guard, logic }), visual, guard, logic };
  });
  return {
    results,
    passed: results.filter((r) => r.met).map((r) => r.id),
    failed: results.filter((r) => !r.met).map((r) => r.id),
  };
}

// ── per-cycle report ─────────────────────────────────────────────────────
function writeReport(dir, c) {
  const sig = (s) => (s == null ? "—" : s.pass ? "✅" : "❌");
  const rows = c.evaluation.results.map((r) =>
    `| ${r.met ? "✅" : "❌"} ${r.id} | ${sig(r.visual)} ${r.visual?.evidence ? "— " + r.visual.evidence : ""} | ${sig(r.guard)} ${r.guard?.detail ?? ""} | ${sig(r.logic)} ${r.logic?.detail ?? ""} |`,
  ).join("\n");
  const shots = (readJSON(join(dir, "manifest.json"), []) || [])
    .map((m) => `### ${m.key} — ${m.caption}\n\n![${m.key}](shots/${m.key}.png)`).join("\n\n");
  const impl = c.implement;
  const md = `# Cycle ${c.n}

**Started:** ${c.startedAt}  •  **Status:** ${c.phase}
**Goals met:** ${c.evaluation.passed.length}/${c.evaluation.results.length}  •  **Remaining:** ${c.evaluation.failed.join(", ") || "none 🎉"}

## Goal scoreboard (visual ⨯ guard ⨯ logic — all must pass)

| Goal | Visual (AI) | Guard (state) | Logic (assert) |
|---|---|---|---|
${rows}

## Change attempted this cycle
${impl?.skipped ? "_None — all goals already passed, or no proposal._"
  : impl ? `**[${impl.proposal?.goalId}] ${impl.proposal?.title}**

${impl.proposal?.rationale ?? ""}

- Files changed: ${impl.changedFiles?.length ? impl.changedFiles.map((f) => "`" + f + "`").join(", ") : "(none)"}
- Build gate: ${impl.verifyOk == null ? "n/a" : impl.verifyOk ? "✅ pass" : "❌ fail → reverted"}
- Re-verify (logical, post-change): ${impl.after ? `errors=${impl.after.consoleErrors}, targeted guard=${sig(impl.after.guard)}, targeted logic=${sig(impl.after.logic)}` : "n/a"}
- Implement summary: ${impl.summary ?? "—"}` : "_n/a_"}

## Screenshots (visual source of truth)

${shots}
`;
  writeText(join(dir, "report.md"), md);
}

function writeRollup() {
  const lines = state.cycles.map((c) =>
    `| ${c.n} | ${c.evaluation?.passed.length ?? 0}/${GOALS.length} | ${c.implement?.proposal?.title ?? (c.implement?.skipped ? "(none)" : "—")} | ${c.implement?.verifyOk == null ? "—" : c.implement.verifyOk ? "pass" : "revert"} | [report](cycles/${c.n}/report.md) |`,
  ).join("\n");
  writeText(join(ARTIFACTS, "REPORT.md"), `# Improvement-loop rollup

**Status:** ${state.status}  •  **Cycles:** ${state.cycles.length}  •  **Goals:** ${GOALS.length}

| Cycle | Goals met | Change | Build | Report |
|---|---|---|---|---|
${lines}
`);
}

// ── main loop ────────────────────────────────────────────────────────────
const server = await ensureServer({ log });
let success = false;
try {
  while (true) {
    if (state.cycles.length >= MAX_CYCLES) { log(`budget: hit max ${MAX_CYCLES} cycles`); state.status = "stopped:max-cycles"; break; }
    if (Date.now() > deadline) { log(`budget: hit ${MAX_MINUTES} min`); state.status = "stopped:timeout"; break; }

    const n = state.cycles.length + 1;
    const dir = cycleDir(n);
    ensureDir(dir);
    const c = { n, startedAt: new Date().toISOString(), phase: "capture" };
    state.cycles.push(c); persist();
    log(`──────── cycle ${n} ────────`);

    // 1) CAPTURE (visual) — also the verification of the previous cycle
    stage("capture.mjs", dir);
    c.phase = "logic"; persist();

    // 2) LOGIC (logical signals + visual-goal guards)
    stage("logic-tests.mjs", dir);
    const logicFile = readJSON(join(dir, "logic.json"), { logic: {}, guards: {} });
    c.phase = "observe"; persist();

    // 3) OBSERVE (AI judges visuals + proposes next change)
    const obsCode = stage("observe.mjs", dir);
    const observe = readJSON(join(dir, "observe.json"), { verdicts: {}, proposal: null });
    if (obsCode !== 0) log("observe stage returned nonzero — using whatever it wrote");

    // 4) DECIDE
    c.evaluation = evaluateGoals(observe, logicFile);
    c.proposal = observe.proposal;
    persist();
    log(`goals met ${c.evaluation.passed.length}/${GOALS.length} — remaining: ${c.evaluation.failed.join(", ") || "NONE"}`);

    if (c.evaluation.failed.length === 0) {
      c.phase = "done"; c.implement = { skipped: true, reason: "all goals met" };
      writeReport(dir, c); persist(); writeRollup();
      success = true; state.status = "done:all-goals-met";
      log("🎉 all goals met — stopping"); break;
    }

    // 5) IMPLEMENT the proposed change (unless dry-run / no proposal)
    if (!DO_IMPLEMENT || !observe.proposal) {
      c.phase = "done"; c.implement = { skipped: true, reason: DO_IMPLEMENT ? "no proposal" : "--no-implement" };
      writeReport(dir, c); persist(); writeRollup();
      if (!DO_IMPLEMENT) { state.status = "stopped:no-implement"; log("dry run — stopping after assessment"); break; }
      log("no proposal produced — stopping to avoid spinning"); state.status = "stopped:no-proposal"; break;
    }

    c.phase = "implement"; persist();
    stage("implement.mjs", dir);
    const impl = readJSON(join(dir, "implement.json"), { skipped: true });
    c.implement = impl;
    c.phase = "verify"; persist();

    // 6) BUILD GATE — revert just this cycle's edits if tsc/build breaks
    if (!impl.skipped && impl.changedFiles?.length) {
      const v = runVerify({ log });
      impl.verifyOk = v.ok;
      if (!v.ok) {
        writeText(join(dir, "verify-fail.log"), v.out.slice(-8000));
        const reverted = impl.base ? gitRevertCycle(impl.base) : false;
        impl.reverted = reverted;
        log(`build failed → ${reverted ? "reverted cycle edits" : "REVERT FAILED (manual cleanup needed)"}`);
      } else {
        // 7) RE-VERIFY (re-run the play-through; logical confirmation now)
        c.phase = "reverify"; persist();
        const adir = join(dir, "after");
        ensureDir(adir);
        stage("capture.mjs", adir);
        stage("logic-tests.mjs", adir);
        const aLogic = readJSON(join(adir, "logic.json"), { logic: {}, guards: {} });
        const aTrace = readJSON(join(adir, "trace.json"), { consoleErrors: [] });
        const gid = impl.proposal?.goalId;
        impl.after = {
          consoleErrors: (aTrace.consoleErrors || []).length,
          guard: aLogic.guards?.[gid] ?? null,
          logic: aLogic.logic?.[gid] ?? null,
        };
      }
    } else {
      impl.verifyOk = null;
    }

    c.phase = "done";
    writeReport(dir, c); persist(); writeRollup();
    log(`cycle ${n} complete`);
  }
} catch (err) {
  log("ERROR:", err.message);
  state.status = `error:${err.message}`;
} finally {
  persist(); writeRollup();
  if (server.owned) { log("stopping dev server we started"); server.stop(); }
  log(`finished — status=${state.status} cycles=${state.cycles.length}`);
  log(`rollup: ${join(ARTIFACTS, "REPORT.md")}`);
  process.exit(success ? 0 : 1);
}
