// SUITE RUNNER — the one safe way to run a fleet of smokes.
//
// Runs test scripts SEQUENTIALLY (never in parallel — one GPU, one CPU pool;
// parallel test fan-out is how the machine froze), each under a hard per-script
// timeout that tree-kills a hung child and moves on. The whole run sits under
// the machine-wide guard lock, at below-normal priority, with a memory sentinel.
//
//   node scripts/run-suite.mjs develop              # one fast journey + screenshots
//   node scripts/run-suite.mjs core                 # the 6 broader smokes
//   node scripts/run-suite.mjs all                  # every smoke-*.mjs
//   node scripts/run-suite.mjs visual               # flicker + visual families
//   node scripts/run-suite.mjs electron             # builds, then the Electron fleet
//   node scripts/run-suite.mjs release              # all + visual + electron
//   node scripts/run-suite.mjs smoke-flow smoke-map # explicit scripts
//
// Output: a console table, artifacts/suite/summary.json and SUITE.md, plus a
// screenshot audit (shot-audit.mjs) over every shots/ file the run produced.
// Exit code = number of failed/timed-out scripts.
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { guard, track, untrack, killTree } from "./lib/guard.cjs";
import { GAME_DIR, ensureServer, writeJSON, writeText, sleep } from "./loop/lib.mjs";

const ARGS = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const SCRIPTS_DIR = join(GAME_DIR, "scripts");
const OUT_DIR = join(GAME_DIR, "artifacts", "suite");

// Known-slow scripts get a bigger budget (headless SwiftShader runs ~3× slow).
// Everything else: 6 minutes, which is generous — a healthy smoke ends in 1–2.
const BUDGET_MIN = {
  default: 6,
  "smoke-flow": 9, "smoke-map": 9, "smoke-meta": 9, "smoke-release": 9,
  "shot-flicker": 9, "smoke-perf-stress": 8,
  "smoke-electron.cjs": 10, "perf-soak-electron.cjs": 16,
};
const budgetFor = (f) => (BUDGET_MIN[f.replace(/\.mjs$/, "")] ?? BUDGET_MIN[f] ?? BUDGET_MIN.default) * 60_000;

const allSmokes = () => readdirSync(SCRIPTS_DIR).filter((f) => /^smoke-.*\.mjs$/.test(f)).sort();

const CORE = ["smoke-browser.mjs", "smoke-flow.mjs", "smoke-upgrades.mjs", "smoke-bosses.mjs", "smoke-shields.mjs", "smoke-counter.mjs"];
const DEVELOP = ["smoke-browser.mjs"];
const VISUAL = ["shot-flicker.mjs", "smoke-visual-themes.mjs", "smoke-card-visuals.mjs", "smoke-enemy-visual.mjs", "smoke-player-animation.mjs", "smoke-act1-presentation.mjs", "smoke-polish.mjs"];
const PRESENTATION = ["smoke-visual-regressions.mjs", "smoke-gameplay-camera.mjs", "smoke-act1-presentation.mjs", "smoke-player-animation.mjs", "smoke-boss-cutscenes.mjs", "smoke-canvas-viewports.mjs"];
// Electron fleet runs the BUILT game (needs dist/); `electron` binary, not node.
const ELECTRON = ["smoke-electron.cjs", "smoke-display-electron.cjs"];
const ELECTRON_WRAPPED = ["smoke-save-persist.mjs"]; // node scripts that spawn electron themselves

const GROUPS = {
  develop: () => DEVELOP,
  core: () => CORE,
  visual: () => VISUAL,
  presentation: () => PRESENTATION,
  all: () => allSmokes(),
  electron: () => [...ELECTRON, ...ELECTRON_WRAPPED],
  release: () => [...new Set([...allSmokes(), ...VISUAL, ...ELECTRON, ...ELECTRON_WRAPPED])],
};

// ── resolve the run list ─────────────────────────────────────────────────────
let files = [];
for (const a of ARGS.length ? ARGS : ["core"]) {
  if (GROUPS[a]) files.push(...GROUPS[a]());
  else files.push(/\.(mjs|cjs)$/.test(a) ? a : `${a}.mjs`);
}
files = [...new Set(files)].filter((f) => {
  if (existsSync(join(SCRIPTS_DIR, f))) return true;
  console.error(`[suite] no such script: ${f}`); return false;
});
if (!files.length) { console.error("[suite] nothing to run"); process.exit(2); }

// ×1.6: headroom for the one-retry flake policy below.
const totalBudgetMin = Math.ceil((files.reduce((s, f) => s + budgetFor(f), 0) * 1.6) / 60_000) + 10;
guard({ name: `suite-${ARGS.join("+") || "core"}`, maxMinutes: totalBudgetMin });

const needsElectron = files.some((f) => f.endsWith(".cjs") || ELECTRON_WRAPPED.includes(f));
const needsServer = files.some((f) => f.endsWith(".mjs") && !ELECTRON_WRAPPED.includes(f));

// ── prerequisites ────────────────────────────────────────────────────────────
if (needsElectron && !existsSync(join(GAME_DIR, "dist", "index.html"))) {
  console.log("[suite] no dist/ — building once for the Electron fleet …");
  const b = spawnSync("npm", ["run", "build"], { cwd: GAME_DIR, stdio: "inherit", shell: true });
  if ((b.status ?? 1) !== 0) { console.error("[suite] build failed — aborting"); process.exit(2); }
}
const server = needsServer ? await ensureServer({ log: (...a) => console.log("[suite]", ...a) }) : { owned: false, stop() {} };

// ── run each, sequential, timeboxed ─────────────────────────────────────────
const startedAt = Date.now();
const results = [];

const electronBin = createRequire(import.meta.url)("electron"); // path to electron.exe

function runOne(file) {
  const isCjs = file.endsWith(".cjs");
  const cmd = isCjs ? electronBin : process.execPath;
  const budget = budgetFor(file);
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(cmd, [`scripts/${file}`], { cwd: GAME_DIR, stdio: ["ignore", "pipe", "pipe"] });
    track(child);
    let out = "";
    const keep = (d) => { out += d; if (out.length > 60_000) out = out.slice(-40_000); };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => {
      killTree(child.pid);
      finish("TIMEOUT", null);
    }, budget);
    let done = false;
    const finish = (status, code) => {
      if (done) return; done = true;
      clearTimeout(timer);
      untrack(child);
      resolve({ file, status, code, seconds: Math.round((Date.now() - t0) / 1000), tail: out.trim().split(/\r?\n/).slice(-12).join("\n") });
    };
    child.on("exit", (code) => finish(code === 0 ? "PASS" : "FAIL", code));
    child.on("error", (e) => { keep(String(e)); finish("FAIL", -1); });
  });
}

for (const file of files) {
  process.stdout.write(`[suite] ${file} … `);
  let r = await runOne(file);
  // Flake policy: one auto-retry on FAIL (same seed/config). Pass-on-retry is
  // recorded as FLAKY for diagnosis and remains a red gate. A TIMEOUT is a hang,
  // not flake — no retry (it would just burn another full budget).
  if (r.status === "FAIL") {
    console.log(`FAIL in ${r.seconds}s — retrying once (flake check)`);
    process.stdout.write(`[suite] ${file} (retry) … `);
    const r2 = await runOne(file);
    r = r2.status === "PASS" ? { ...r2, status: "FLAKY", firstFailTail: r.tail } : r2;
  }
  results.push(r);
  console.log(`${r.status}${r.status === "PASS" || r.status === "FLAKY" ? "" : ` (exit ${r.code})`} in ${r.seconds}s`);
  if (r.status === "FAIL" || r.status === "TIMEOUT") console.log(r.tail.split("\n").map((l) => "    | " + l).join("\n"));
  await sleep(500); // let the previous Chromium fully exit before the next spawn
}

// ── screenshot audit over everything this run produced ─────────────────────
let shotAudit = null;
if (existsSync(join(GAME_DIR, "shots"))) {
  const a = spawnSync(process.execPath, ["scripts/shot-audit.mjs", "shots", "--since", String(startedAt), "--json", join(OUT_DIR, "shot-audit.json")], {
    cwd: GAME_DIR, encoding: "utf8", timeout: 4 * 60_000,
  });
  console.log((a.stdout || "").trim());
  try { shotAudit = JSON.parse(readFileSync(join(OUT_DIR, "shot-audit.json"), "utf8")); } catch { /* none */ }
}

if (server.owned) { console.log("[suite] stopping dev server we started"); server.stop(); }

// ── summary ─────────────────────────────────────────────────────────────────
// A retry is diagnostic only. Any first-attempt failure keeps the gate red.
const failed = results.filter((r) => r.status !== "PASS");
const flaky = results.filter((r) => r.status === "FLAKY");
// Quarantine ledger: flaky scripts accumulate here until someone fixes the
// underlying nondeterminism (usually a missing settle or a real race).
if (flaky.length) {
  const qPath = join(OUT_DIR, "flaky.json");
  let q = []; try { q = JSON.parse(readFileSync(qPath, "utf8")); } catch { /* fresh */ }
  for (const r of flaky) q.push({ file: r.file, at: new Date().toISOString(), firstFailTail: r.firstFailTail });
  writeJSON(qPath, q.slice(-100));
}
// STALE-only shots are just excluded evidence, not failures — don't count them.
const flaggedShots = (shotAudit?.shots || []).filter((s) => s.flags.length && !(s.flags.length === 1 && s.flags[0] === "STALE"));
const summary = {
  at: new Date(startedAt).toISOString(),
  group: ARGS.join("+") || "core",
  totalSeconds: Math.round((Date.now() - startedAt) / 1000),
  pass: results.length - failed.length,
  fail: failed.length,
  results,
  shotAudit: shotAudit ? { audited: shotAudit.shots?.length ?? 0, flagged: flaggedShots.map((s) => ({ file: s.file, flags: s.flags })) } : null,
};
writeJSON(join(OUT_DIR, "summary.json"), summary);
writeText(join(OUT_DIR, "SUITE.md"), `# Suite run — ${summary.group}

**${summary.pass}/${results.length} passed** in ${summary.totalSeconds}s (${summary.at})

| Script | Status | Time |
|---|---|---|
${results.map((r) => `| ${r.file} | ${r.status === "PASS" ? "✅" : r.status === "FLAKY" ? "⚠️ FLAKY (passed on retry)" : "❌ " + r.status} | ${r.seconds}s |`).join("\n")}

${failed.length ? "## Failures\n\n" + failed.map((r) => `### ${r.file} (${r.status})\n\n\`\`\`\n${r.tail}\n\`\`\``).join("\n\n") : ""}
${flaggedShots.length ? "\n## Flagged screenshots\n\n" + flaggedShots.map((s) => `- \`${s.file}\` — ${s.flags.join(", ")}`).join("\n") : ""}
`);

console.log(`\n[suite] ${summary.pass}/${results.length} passed in ${summary.totalSeconds}s${flaky.length ? ` (${flaky.length} flaky)` : ""}${flaggedShots.length ? ` — ${flaggedShots.length} screenshot(s) flagged` : ""}`);
console.log(`[suite] summary → artifacts/suite/SUITE.md`);
process.exit(failed.length);
