// Default development gate: keep feedback under a minute and put visual truth
// in front of the reviewing agent. Deep forensic batteries remain opt-in.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { GAME_DIR } from "../loop/lib.mjs";

const started = Date.now();
const run = (cmd, args) => {
  const result = spawnSync(cmd, args, {
    cwd: GAME_DIR,
    stdio: "inherit",
    shell: cmd === "npm",
    timeout: 4 * 60_000,
  });
  return result.status ?? 1;
};

console.log("[qa:smoke] static/build gate ...");
const verifyCode = run("npm", ["run", "verify"]);
if (verifyCode !== 0) process.exit(verifyCode);

console.log("[qa:smoke] one browser journey + fresh screenshot audit ...");
const smokeCode = run(process.execPath, ["scripts/run-suite.mjs", "develop"]);

const suitePath = join(GAME_DIR, "artifacts", "suite", "summary.json");
const summary = existsSync(suitePath) ? JSON.parse(readFileSync(suitePath, "utf8")) : null;
const shotNames = ["1-menu.png", "2-gameplay.png", "3-combat.png", "4-cards.png", "5-pause.png"];
const outDir = join(GAME_DIR, "artifacts", "qa-smoke");
mkdirSync(outDir, { recursive: true });
const report = {
  at: new Date().toISOString(),
  seconds: Math.round((Date.now() - started) / 1000),
  status: smokeCode === 0 ? "PASS" : "FAIL",
  verify: "PASS",
  suite: summary,
  screenshots: shotNames.map((name) => `shots/${name}`),
  review: "Inspect all five fresh frames at full size; automated success is not a visual-quality verdict.",
};
writeFileSync(join(outDir, "summary.json"), JSON.stringify(report, null, 2) + "\n");
writeFileSync(join(outDir, "QA-SMOKE.md"), [
  "# Development smoke",
  "",
  `**${report.status}** in ${report.seconds}s`,
  "",
  "Static checks, unit tests, production build, one real browser journey, console errors, and fresh screenshot audit.",
  "",
  "## Review these frames",
  "",
  ...shotNames.map((name) => `- \`shots/${name}\``),
  "",
  "> An AI or human must inspect these frames at full size. The long forensic QA suite is release-only.",
  "",
].join("\n"));

console.log(`[qa:smoke] ${report.status} in ${report.seconds}s - review shots/1-menu.png through shots/5-pause.png`);
process.exit(smokeCode);
