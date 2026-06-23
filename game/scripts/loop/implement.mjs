// IMPLEMENT stage — apply the proposal from observe.json via headless Claude
// with edit tools, then record exactly what changed (a git snapshot base + the
// cycle's own diff) so the orchestrator can build-gate and, if needed, revert
// just this cycle's edits without touching any pre-existing working-tree changes.
import { join } from "node:path";
import {
  readJSON, writeJSON, writeText, runClaude,
  gitSnapshot, gitChangedFiles, gitCycleDiff, ARTIFACTS,
} from "./lib.mjs";

const argOut = process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1] : null;
const OUT = argOut || process.env.LOOP_CYCLE_DIR || join(ARTIFACTS, "cycles", "manual");

const observe = readJSON(join(OUT, "observe.json"));
const proposal = observe?.proposal;
if (!proposal) {
  console.log("[implement] no proposal — nothing to implement (all goals pass?)");
  writeJSON(join(OUT, "implement.json"), { skipped: true, reason: "no proposal" });
  process.exit(0);
}

const prompt = `You are the implementer in an automated improvement loop for the Three.js
action-roguelike "Rogue Hero 3" (source under game/src, strict TypeScript).

Make ONLY the following change. Keep it minimal, focused, and idiomatic — match
the surrounding code's style, naming, and comment density. Do NOT refactor
unrelated code, do NOT reformat files, and do NOT run builds or long shell
commands (the harness verifies the build afterward). Respect the project's
invariants (procedural meshes/SFX, all player damage via Combat.dealDamage,
every enemy attack telegraphs, tempo only via gain/drain/crash, dispose what you
create).

CHANGE TO MAKE
  goal: ${proposal.goalId}
  title: ${proposal.title}
  rationale: ${proposal.rationale}
  likely target files: ${(proposal.targetFiles || []).join(", ") || "(discover)"}
  acceptance criteria: ${proposal.acceptanceCriteria}

Use Read/Grep/Glob to locate the right spot, then Edit/Write to make the change.
When done, reply with a one-line summary of what you changed.`;

console.log(`[implement] applying: [${proposal.goalId}] ${proposal.title}`);
const base = gitSnapshot();
const res = runClaude(prompt, {
  allowedTools: ["Read", "Edit", "Write", "Grep", "Glob"],
  permissionMode: "acceptEdits",
  timeoutMs: 600000,
});

const changedFiles = gitChangedFiles(base);
const diff = gitCycleDiff(base);
if (diff) writeText(join(OUT, "cycle.patch"), diff);

const out = {
  skipped: false,
  proposal,
  base,
  changedFiles,
  summary: String(res.result || "").trim().slice(0, 400),
  _meta: { ok: res.ok, cost: res.cost, durationMs: res.durationMs, numTurns: res.numTurns },
};
writeJSON(join(OUT, "implement.json"), out);

console.log(`[implement] changed ${changedFiles.length} file(s):`);
for (const f of changedFiles) console.log(`  ${f}`);
console.log(`[implement] summary: ${out.summary || "(none)"}`);
process.exit(changedFiles.length > 0 ? 0 : 3);  // 3 = proposal produced no edits
