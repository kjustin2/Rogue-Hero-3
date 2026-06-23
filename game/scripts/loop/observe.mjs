// OBSERVE stage — the AI is the visual source of truth.
//
// Feeds the captured screenshots + each visual goal's rubric + the logical
// results to headless Claude (`claude -p`), which Reads the PNGs, judges every
// visual goal pass/fail with evidence, and proposes the single highest-value
// next change. Writes observe.json: { verdicts, proposal, _meta }.
import { join, resolve } from "node:path";
import { GOALS } from "./goals.mjs";
import {
  readJSON, writeJSON, runClaude, extractJSON, ARTIFACTS,
} from "./lib.mjs";

const argOut = process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1] : null;
const OUT = argOut || process.env.LOOP_CYCLE_DIR || join(ARTIFACTS, "cycles", "manual");

const manifest = readJSON(join(OUT, "manifest.json"), []);
const logicFile = readJSON(join(OUT, "logic.json"), { logic: {}, guards: {} });
const fileFor = (key) => {
  const m = manifest.find((x) => x.key === key);
  return m ? resolve(OUT, m.file) : null;
};

const visualGoals = GOALS.filter((g) => g.rubric);

// Build the per-goal blocks with absolute screenshot paths to Read.
const goalBlocks = visualGoals.map((g) => {
  const shots = (g.shots || []).map(fileFor).filter(Boolean);
  const guard = logicFile.guards?.[g.id];
  return [
    `### goal: ${g.id}`,
    `title: ${g.title}`,
    `pass_rubric: ${g.rubric}`,
    `screenshots_to_read:\n${shots.map((s) => `  - ${s}`).join("\n") || "  (none captured!)"}`,
    guard ? `capture_guard: ${guard.pass ? "ok" : "FAILED"} (${guard.detail})` : "",
  ].filter(Boolean).join("\n");
}).join("\n\n");

const logicLines = Object.entries(logicFile.logic || {})
  .map(([id, r]) => `  - ${id}: ${r.pass ? "PASS" : "FAIL"} (${r.detail})`).join("\n");

const prompt = `You are the visual & quality judge for an automated game-improvement loop on the
Three.js action-roguelike "Rogue Hero 3". You are the OBJECTIVE source of truth:
judge ONLY from the screenshots you Read, not from assumptions.

Use the Read tool to open every screenshot path listed under each goal. Then:

1) For EACH visual goal below, decide pass/fail strictly against its pass_rubric,
   based on what is actually visible. Give a one-sentence evidence note citing what
   you saw, and a confidence 0.0–1.0. If capture_guard FAILED, the screenshot was
   taken in the wrong state — mark that goal fail (evidence: "guard failed").

2) Look at the failing goals (your visual fails + the logical FAILs listed) and
   propose the SINGLE highest-value, concrete, minimal code change to make next.
   Ground the rationale in a specific screenshot observation. Name the most likely
   target file(s) under game/src. Only propose a change for a goal you are
   CONFIDENT (>= 0.6) is genuinely failing — prefer a logical FAIL or a clear,
   high-confidence visual fail over a borderline one. If everything passes, or your
   only fails are low-confidence/borderline, set "proposal": null (do NOT invent
   work on a goal that already looks fine).

VISUAL GOALS
${goalBlocks}

LOGICAL RESULTS (already computed; you are NOT judging these, just consider them)
${logicLines || "  (none)"}

Respond with ONLY a JSON object, no prose outside it, exactly this shape:
{
  "verdicts": {
    "<goalId>": { "pass": true|false, "confidence": 0.0, "evidence": "..." }
  },
  "proposal": {
    "goalId": "<failing goal this targets>",
    "title": "<short imperative summary>",
    "rationale": "<why, grounded in a screenshot observation>",
    "targetFiles": ["game/src/..."],
    "acceptanceCriteria": "<observable visual + logical signal that proves it fixed>",
    "risk": "low|medium|high"
  }
}`;

console.log(`[observe] judging ${visualGoals.length} visual goals via claude -p …`);
const res = runClaude(prompt, {
  allowedTools: ["Read", "Glob", "Grep"],
  permissionMode: "acceptEdits",
  timeoutMs: 300000,
});

const parsed = extractJSON(res.result);

// Safety filter: drop a proposal that targets a VISUAL goal the AI itself judged
// low-confidence — visual verdicts carry model variance, and we don't want to
// churn the codebase chasing a goal that already passes most of the time. A
// proposal against a logical goal (deterministic) is always allowed through.
let proposal = parsed?.proposal ?? null;
const VISUAL_IDS = new Set(GOALS.filter((g) => g.rubric && !g.assert).map((g) => g.id));
if (proposal && VISUAL_IDS.has(proposal.goalId)) {
  const v = parsed?.verdicts?.[proposal.goalId];
  if (!v || v.pass === true || (typeof v.confidence === "number" && v.confidence < 0.6)) {
    console.log(`[observe] dropping low-confidence visual proposal for ${proposal.goalId} (conf=${v?.confidence})`);
    proposal = null;
  }
}

const observe = {
  verdicts: parsed?.verdicts ?? {},
  proposal,
  _meta: {
    ok: res.ok && !!parsed,
    cost: res.cost, durationMs: res.durationMs, numTurns: res.numTurns,
    parsedOk: !!parsed,
    rawHead: parsed ? undefined : String(res.result || res.raw || "").slice(0, 600),
  },
};
writeJSON(join(OUT, "observe.json"), observe);

if (!parsed) {
  console.error("[observe] could not parse JSON from claude output");
  console.error(String(res.result || res.raw || "").slice(0, 600));
  process.exit(1);
}
console.log("[observe] verdicts:");
for (const [id, v] of Object.entries(observe.verdicts)) {
  console.log(`  ${v.pass ? "PASS" : "FAIL"}  ${id} — ${v.evidence ?? ""}`);
}
console.log(observe.proposal
  ? `[observe] proposal → [${observe.proposal.goalId}] ${observe.proposal.title}`
  : "[observe] proposal → none (all visual goals pass)");
process.exit(0);
