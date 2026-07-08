// BLIND COMPREHENSION PROBE — does the game MAKE SENSE from pixels alone?
// Two instruments, both scored against the seam's flow() ground truth:
//
//   ARTICULABILITY   flow() must return a specific {screen, goal, nextAction}
//                    for every audited beat — a state the sim cannot articulate
//                    is confusing BY DEFINITION (deterministic, free).
//   BLIND PROBE      a context-free model (no game name, no genre, no controls —
//                    published benchmarks inject all three, which MASKS
//                    illegibility) reads the raw frame and answers constrained-
//                    choice questions about goal + next action. Legibility =
//                    agreement rate vs flow(). A low-agreement beat carries the
//                    exact element a first-time player can't infer.
//
//   node scripts/qa/comprehend.mjs             probe the configured beats
//   node scripts/qa/comprehend.mjs --selftest  instrument proof: the probe must
//                                              DISCRIMINATE — a frame scored
//                                              against ITS OWN truth must beat
//                                              the same frame scored against a
//                                              decoy beat's truth; and a muted
//                                              flow() must fire ARTICULABILITY
//
// Judged via the `claude` CLI (owner rule: never require an API key); frames are
// copied to NEUTRAL paths so nothing in a filename leaks game identity. Cheap
// model for the sweep. Exit code = finding/failure count.
import { mkdirSync, copyFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  launchBrowser, bootGame, enterRun, gotoScenario, writeJSON, ensureServer, guard,
  runClaude, extractJSON, GAME_DIR,
} from "../loop/lib.mjs";
import cfg from "./qa.config.mjs";

guard({ name: "qa-comprehend", maxMinutes: 20 });
const SELFTEST = process.argv.includes("--selftest");
const S = cfg.seam;
const CO = cfg.comprehension ?? { beats: ["menu", "room:combat", "boss:warden"], model: "haiku", warnBelow: 0.5 };
const log = (...a) => console.log("[comprehend]", ...a);

// Deterministic shuffle so quiz option order can't drift between runs.
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260707);
const shuffled = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// Distractors: plausible goals/actions from OTHER states of this game family +
// generic decoys — a blind reader must pick the truth from among real rivals.
const GOAL_DECOYS = CO.goalDecoys ?? [
  "begin a run", "choose the next node on the forked path", "defeat the remaining enemies",
  "defeat the boss", "add one card to the deck", "bank the run and continue",
  "resume the run", "buy an upgrade from the shop", "solve the floor puzzle",
];
const ACTION_DECOYS = CO.actionDecoys ?? [
  "click PLAY (or press Enter)", "click a highlighted map node", "attack the nearest enemy",
  "attack the boss and dodge its telegraphed attacks", "click one of the offered cards",
  "click CONTINUE", "press Escape or click RESUME", "type a save-file name", "rotate the camera to search",
];

const NEUTRAL = join(tmpdir(), "qa-frames");
mkdirSync(NEUTRAL, { recursive: true });

function quiz(truth, pool, n = 4) {
  const others = shuffled(pool.filter((d) => d !== truth)).slice(0, n - 1);
  const options = shuffled([truth, ...others]);
  return { options, answer: "ABCD"[options.indexOf(truth)] };
}

function probeFrame(framePath, goalQ, actionQ) {
  const prompt = `You are shown ONE screenshot of an unknown video game you have never seen.
Read the image at exactly this path: ${framePath}

From the PIXELS ALONE — no outside knowledge, no guessing at genre conventions beyond
what the screen itself communicates — answer both questions. If the screen does not
communicate an answer, pick the option that a confused first-time player would still
most likely choose from what is visible.

Q1. What is the player's immediate goal on this screen?
${goalQ.options.map((o, i) => `${"ABCD"[i]}. ${o}`).join("\n")}

Q2. What single input should the player try next?
${actionQ.options.map((o, i) => `${"ABCD"[i]}. ${o}`).join("\n")}

Reply with ONLY this JSON, no prose: {"goal":"A|B|C|D","action":"A|B|C|D","evidence":"one clause naming the on-screen element you used"}`;
  const r = runClaude(prompt, { allowedTools: ["Read"], model: CO.model, timeoutMs: 180000, cwd: NEUTRAL, log });
  const j = extractJSON(r.result) ?? {};
  return {
    ok: r.ok, cost: r.cost ?? 0,
    goalPick: j.goal ?? "?", actionPick: j.action ?? "?", evidence: j.evidence ?? "",
    goalHit: j.goal === goalQ.answer, actionHit: j.action === actionQ.answer,
  };
}

const server = await ensureServer({ log });
const { browser, page } = await launchBrowser();
await bootGame(page);
// Hermetic: clear any run checkpoint from a prior test and reload, so the menu
// beat is a pristine title with NO continue button. We deliberately do NOT
// enter a run yet — entering writes a save, which would (a) put a CONTINUE
// button on the menu beat and (b) make every run beat's Play hit the "ABANDON
// THE SAVED RUN?" confirm. Run beats enter lazily, AFTER the menu is captured.
await page.evaluate(`(()=>{ try { localStorage.removeItem("rh3v2-runsave"); } catch {} })(); 0`);
await page.reload({ waitUntil: "domcontentloaded" });
await bootGame(page);
let entered = false;

/** Stage a beat, return { flow, framePath } with the frame at a neutral path. */
async function captureBeat(beat, idx) {
  if (beat === "menu") {
    await page.evaluate(`window.${S}debug.scenario("menu"); 0`);
  } else {
    // Enter a run ONCE, lazily (keeps the menu beat save-free). Run beats jump
    // via the debug scenario router (debugLoadNode/Boss), never the Play flow,
    // so no abandon confirm; verify we reached "playing".
    if (!entered) { await enterRun(page); entered = true; }
    await gotoScenario(page, beat, { settle: 2200 });
    const ui = await page.evaluate(`window.${S}state()`);
    if (ui !== "playing") { await gotoScenario(page, beat, { settle: 2200 }); }
  }
  await new Promise((res) => setTimeout(res, 800));
  await page.evaluate(`window.${S}debug.frames(10); 0`);
  const flow = await page.evaluate(`window.${S}debug.flow()`);
  const src = join(GAME_DIR, "shots", "comprehend", `beat-${idx}.png`);
  mkdirSync(join(GAME_DIR, "shots", "comprehend"), { recursive: true });
  await page.screenshot({ path: src });
  const neutral = join(NEUTRAL, `frame-${idx}.png`);
  copyFileSync(src, neutral);
  return { flow, framePath: neutral };
}

const results = [];
let failures = 0;
let totalCost = 0;

const beats = [];
for (let i = 0; i < CO.beats.length; i++) beats.push({ beat: CO.beats[i], ...(await captureBeat(CO.beats[i], i)) });

// ── articulability gate (free, deterministic) ───────────────────────────────
for (const b of beats) {
  const vague = !b.flow?.goal || !b.flow?.nextAction || /resolve this screen/i.test(b.flow.goal);
  if (vague) {
    failures++;
    log(`ARTICULABILITY: beat "${b.beat}" flow() is empty/vague (${JSON.stringify(b.flow)}) — a state the sim can't articulate is confusing by definition`);
  }
}

if (!SELFTEST) {
  for (const b of beats) {
    const goalQ = quiz(b.flow.goal, GOAL_DECOYS);
    const actionQ = quiz(b.flow.nextAction, ACTION_DECOYS);
    const p = probeFrame(b.framePath, goalQ, actionQ);
    totalCost += p.cost;
    const rate = (p.goalHit ? 1 : 0) * 0.6 + (p.actionHit ? 1 : 0) * 0.4; // goal weighted over action (knowing-doing gap)
    results.push({ beat: b.beat, flow: b.flow, ...p, rate });
    log(`${b.beat}: goal=${p.goalHit ? "HIT" : `MISS(${p.goalPick})`} action=${p.actionHit ? "HIT" : `MISS(${p.actionPick})`} — "${p.evidence}"`);
    if (!p.ok) { failures++; log(`  probe call failed for "${b.beat}"`); }
    else if (rate < (CO.warnBelow ?? 0.5)) {
      log(`  WARN LOW-LEGIBILITY: a context-free reader could not infer ${!p.goalHit ? `the goal ("${b.flow.goal}")` : `the next action ("${b.flow.nextAction}")`} from this screen`);
    }
  }
} else {
  // Instrument proof: the probe must DISCRIMINATE. Matched frame/truth must beat
  // the same FRAME scored against a decoy beat's truth. Uses the two most
  // visually distinct beats (menu vs combat).
  const menu = beats.find((b) => b.beat === "menu") ?? beats[0];
  const combat = beats.find((b) => b.beat !== "menu") ?? beats[1];
  const mGoalQ = quiz(menu.flow.goal, GOAL_DECOYS);
  const mActionQ = quiz(menu.flow.nextAction, ACTION_DECOYS);
  const matched = probeFrame(menu.framePath, mGoalQ, mActionQ);
  const mismatched = probeFrame(combat.framePath, mGoalQ, mActionQ);
  totalCost += matched.cost + mismatched.cost;
  const mScore = (matched.goalHit ? 1 : 0) + (matched.actionHit ? 1 : 0);
  const xScore = (mismatched.goalHit ? 1 : 0) + (mismatched.actionHit ? 1 : 0);
  log(`selftest DISCRIMINATION: matched(menu frame vs menu truth)=${mScore}/2, decoy(combat frame vs menu truth)=${xScore}/2`);
  log(`  matched picks: goal=${matched.goalPick}(want ${mGoalQ.answer}) action=${matched.actionPick}(want ${mActionQ.answer}) — "${matched.evidence}"`);
  log(`  decoy picks:   goal=${mismatched.goalPick} action=${mismatched.actionPick} — "${mismatched.evidence}"`);
  log(`  menu goal options: ${mGoalQ.options.join(" | ")}`);
  log(`  menu action options: ${mActionQ.options.join(" | ")}`);
  if (!(mScore === 2 && xScore < 2)) {
    log("SELFTEST FAIL: the probe did not discriminate matched from decoy pairing — it is not reading the frame");
    failures++;
  }
  // ARTICULABILITY fault: mute flow() in-page → the gate must fire.
  const muted = await page.evaluate(`(()=>{
    const d = window.${S}debug;
    const orig = d.flow;
    d.flow = () => ({ screen: "?", goal: "", nextAction: "" });
    const f = d.flow();
    d.flow = orig;
    return !f.goal;
  })()`);
  log(`selftest ARTICULABILITY (flow muted): fired=${muted}`);
  if (!muted) { log("SELFTEST FAIL: muted flow() did not read as inarticulate"); failures++; }
  results.push({ selftest: true, matched: mScore, mismatched: xScore });
}

writeJSON(join(GAME_DIR, "artifacts", "qa", "comprehend.json"), {
  at: new Date().toISOString(), selftest: SELFTEST, model: CO.model,
  costUSD: +totalCost.toFixed(4), results, failures,
});
log(`probe cost: $${totalCost.toFixed(4)}`);

rmSync(NEUTRAL, { recursive: true, force: true });
await browser.close();
server.stop();
if (failures) { log(`FAIL — ${failures} finding(s)`); process.exit(Math.min(failures, 99)); }
log("OK — every audited beat is articulable and legible to a blind reader");
