// CROSS-FAMILY COMPREHENSION — review-methodology leap. The blind-comprehension
// probe (comprehend.mjs) reads each beat with the `claude` CLI and scores against
// flow() ground truth. This adds a SECOND, disjoint model family (Ollama qwen2.5vl)
// asking the same goal-identification quiz. Its independence is what legitimately
// attacks self-preference bias — but ONLY for the comprehension probe (per the
// research, a naive VLM jury does NOT transfer to game-frame localization, so this
// never feeds a localization score). A beat BOTH families misread while flow() is
// confident = a real legibility problem; a cross-family DISAGREEMENT on an
// otherwise-clear beat = a review-reliability signal worth a human glance.
//
// DORMANT BY DEFAULT: if Ollama isn't running / the model isn't pulled, the whole
// detector SKIPS (never a hard failure) — zero dependency until the owner opts in
// with `ollama pull qwen2.5vl:7b`.
//
//   node scripts/qa/cross-family.mjs             cross-family read of each beat
//   node scripts/qa/cross-family.mjs --selftest  fault-proof (no Ollama needed):
//                                                the answer-parse + agreement logic
//                                                must score a right/wrong pick, and
//                                                the skip path must report dormant
//
// Exit = disagreement/misread count (0 when dormant).
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import {
  launchBrowser, bootGame, enterRun, gotoScenario, sleep, writeJSON, ensureServer, guard, GAME_DIR,
} from "../loop/lib.mjs";
import { ollamaAvailable, runOllamaVLM } from "./lib/ollamaVlm.mjs";
import { makeFinding } from "./lib/finding.mjs";
import cfg from "./qa.config.mjs";

guard({ name: "qa-cross-family", maxMinutes: 12 });
const SELFTEST = process.argv.includes("--selftest");
const S = cfg.seam;
const CF = cfg.crossFamily ?? {
  model: "qwen2.5vl:7b",
  beats: [
    { name: "menu", stage: `window.${S}debug.scenario("menu")`, goal: "start or continue a run from the title menu" },
    { name: "combat", stage: `window.${S}.run.debugLoadNode("combat", 1)`, goal: "fight the enemies in the arena" },
    { name: "pause", stage: null, key: "Escape", goal: "resume, adjust settings, or quit from the pause menu" },
  ],
  decoys: ["buy an item from a shop", "read a story cutscene", "pick a card reward", "view the world map"],
};
const log = (...a) => console.log("[cross-family]", ...a);

// Flush piped stdout before exiting — process.exit() truncates async (piped) output.
const flushExit = async (code) => { await new Promise((res) => process.stdout.write("", res)); process.exit(code); };

const LETTERS = ["A", "B", "C", "D"];
/** PURE: extract the chosen letter from a VLM's free-text answer (first standalone
 *  A-D). Reused by the selftest. */
function pickLetter(text) {
  const m = String(text).toUpperCase().match(/\b([A-D])\b/);
  return m ? m[1] : null;
}
/** Deterministic quiz: correct goal + 3 decoys, ordered by a seeded shuffle so the
 *  answer isn't always "A". */
function buildQuiz(goal, decoys, seed) {
  const opts = [goal, ...decoys.slice(0, 3)];
  // simple seeded Fisher-Yates
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (let i = opts.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [opts[i], opts[j]] = [opts[j], opts[i]]; }
  const correct = LETTERS[opts.indexOf(goal)];
  return { opts, correct };
}

const SHOTS = join(GAME_DIR, "artifacts", "qa", "cross-family");

let failures = 0;
const report = { dormant: false, beats: [] };
const findings = [];

if (SELFTEST) {
  // Prove the parse + agreement logic (no Ollama) and the skip path.
  const q = buildQuiz("fight the enemies", ["buy an item", "read a cutscene", "view the map"], 42);
  const rightPick = pickLetter(`The answer is ${q.correct}. This is combat.`) === q.correct;
  const wrongLetter = LETTERS.find((l) => l !== q.correct);
  const wrongPick = pickLetter(`I think ${wrongLetter}`) === q.correct;
  const nullPick = pickLetter("I cannot tell") === null;
  const avail = await ollamaAvailable(CF.model, 1500);
  log(`selftest: right-pick-scored=${rightPick} wrong-pick-scored=${!wrongPick} no-answer=${nullPick}; ollama available=${avail.available} (${avail.reason || "up"})`);
  report.beats.push({ selftest: true, rightPick, wrongScored: !wrongPick, nullPick, ollama: avail.available });
  failures = (rightPick && !wrongPick && nullPick) ? 0 : 1;
  writeJSON(join(GAME_DIR, "artifacts", "qa", "cross-family.json"), { at: new Date().toISOString(), selftest: true, report, failures });
  log(failures ? "FAIL" : "OK — the answer-parse + agreement logic is sound; skip path reports availability");
  await flushExit(failures ? 1 : 0);
}

// Live: dormant unless Ollama + model present.
const avail = await ollamaAvailable(CF.model);
if (!avail.available) {
  report.dormant = true; report.reason = avail.reason;
  log(`DORMANT — cross-family VLM not active: ${avail.reason}. Pull it with \`ollama pull ${CF.model}\` to enable this second-family check.`);
  writeJSON(join(GAME_DIR, "artifacts", "qa", "cross-family.json"), { at: new Date().toISOString(), selftest: false, report, failures: 0 });
  await flushExit(0);
}

mkdirSync(SHOTS, { recursive: true });
const server = await ensureServer({ log });
const { browser, page } = await launchBrowser();
await bootGame(page);
await enterRun(page);

for (let i = 0; i < CF.beats.length; i++) {
  const b = CF.beats[i];
  if (b.stage) await page.evaluate(b.stage);
  if (b.key) await page.keyboard.press(b.key);
  await sleep(600);
  const flow = await page.evaluate(`window.${S}debug.flow()`);
  const shot = join(SHOTS, `${String(i).padStart(2, "0")}-${b.name}.png`);
  await page.screenshot({ path: shot });
  const quiz = buildQuiz(b.goal, CF.decoys, 1000 + i);
  const prompt = `You are shown ONE screenshot of a video game you have never seen. Which single option best describes what the player is meant to do on THIS screen? Answer with ONLY the letter.\n${quiz.opts.map((o, k) => `${LETTERS[k]}. ${o}`).join("\n")}`;
  // eslint-disable-next-line no-await-in-loop
  const res = await runOllamaVLM(prompt, shot, { model: CF.model });
  const pick = pickLetter(res.result);
  const correct = pick === quiz.correct;
  const flowClear = flow && flow.goal && flow.goal.length > 4;
  report.beats.push({ beat: b.name, pick, correct, flowGoal: flow?.goal, flowClear });
  log(`${b.name}: ollama picked ${pick ?? "?"} (correct ${quiz.correct}) ${correct ? "AGREE" : "DISAGREE"} — flow goal "${flow?.goal ?? ""}"`);
  // A beat the second family misreads while flow() is confident = a legibility flag.
  if (!correct && flowClear) {
    findings.push(makeFinding({ oracle: "cross-family", kind: "misread", locus: b.name, situation: flow, raw: { pick, expected: quiz.correct, model: CF.model } }));
    failures++;
  }
}

writeJSON(join(GAME_DIR, "artifacts", "qa", "cross-family.json"), { at: new Date().toISOString(), selftest: false, report, findings, failures });

await browser.close();
server.stop();
if (failures) { log(`FAIL — ${failures} beat(s) the cross-family VLM misread while flow() was confident`); process.exit(Math.min(failures, 99)); }
log("OK — the cross-family VLM agrees with the deterministic flow() ground truth on every beat");
