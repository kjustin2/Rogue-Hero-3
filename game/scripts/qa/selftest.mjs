// DETECTOR SELFTEST SWEEP — the fault-injection proof for the whole perception
// stack (GLIB-style): every detector must FIRE on its injected fault and stay
// QUIET on the clean build. A detector without a proven catch does not count as
// coverage — this is the regression suite for the detectors themselves.
//
//   node scripts/qa/selftest.mjs        run every *-selftest serially
//
// Runs each script as a child under its own guard (the machine-wide lock keeps
// everything serial); per-script timebox; one summary. Exit code = failed suites.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { writeJSON, guard, GAME_DIR } from "../loop/lib.mjs";

guard({ name: "qa-selftest", maxMinutes: 45 });
const log = (...a) => console.log("[selftest]", ...a);

const SUITES = [
  ["collision-truth", ["scripts/qa/collision-truth.mjs", "--selftest"]],
  ["reachability", ["scripts/qa/reachability.mjs", "--selftest"]],
  ["temporal", ["scripts/qa/temporal.mjs", "--selftest"]],
  ["animation", ["scripts/qa/animation-metrics.mjs", "--selftest"]],
];

const results = [];
for (const [name, args] of SUITES) {
  log(`── ${name} ──`);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, args, {
    cwd: GAME_DIR, encoding: "utf8", timeout: 12 * 60 * 1000,
    env: { ...process.env, GUARD_OWNER_PID: String(process.pid) },
  });
  const secs = Math.round((Date.now() - t0) / 1000);
  const ok = r.status === 0;
  const tail = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split(/\r?\n/).slice(-4);
  results.push({ name, ok, secs, tail });
  log(`${ok ? "PASS" : "FAIL"} (${secs}s)`);
  if (!ok) for (const line of tail) log(`   ${line}`);
}

const failed = results.filter((r) => !r.ok);
writeJSON(join(GAME_DIR, "artifacts", "qa", "selftest.json"), {
  at: new Date().toISOString(), results, failed: failed.length,
});
log(`done — ${results.length - failed.length}/${results.length} detector suites proven`);
process.exit(failed.length);
