// TUTORIAL / FTUE — "is it clear how to play / is there a proper tutorial?"
// Three deterministic detectors over the Training-Grounds FSM (a verb-gated state
// machine) + the typed event bus:
//
//   D2 COMPLETABILITY (hard gate): drive each step's verb through the REAL input
//      path; every step must advance within a budget and the tutorial must reach
//      TRAINING COMPLETE. A step that can't advance = a soft-lock in onboarding.
//   D1 REQUIRED-BUT-NEVER-TAUGHT (report, WARN): the run demands verbs the 5-step
//      tutorial never teaches (perfect-dodge, drafting, honing, relics, shops,
//      shields, tempo). Reported for the owner to decide on — not auto-fixed.
//   D3 OBJECTIVE CLARITY: each step's on-screen objective is present + non-vague
//      (the "clear how to play" signal; reuses the articulability idea).
//
//   node scripts/qa/tutorial.mjs             audit the tutorial
//   node scripts/qa/tutorial.mjs --selftest  fault-proof: draining tempo when the
//                                            CRASH step is entered makes it
//                                            uncompletable → D2 must FIRE; a clean
//                                            run must complete
//
// Exit = D2/D3 failure count (D1 is WARN-only per the owner's detect+report call).
import { join } from "node:path";
import {
  launchBrowser, bootGame, sleep, writeJSON, ensureServer, guard, GAME_DIR,
} from "../loop/lib.mjs";
import cfg from "./qa.config.mjs";

guard({ name: "qa-tutorial", maxMinutes: 8 });
const SELFTEST = process.argv.includes("--selftest");
const S = cfg.seam;
const TC = cfg.tutorial ?? {
  // Verbs a real run demands to reach victory — the D1 baseline. The tutorial
  // teaches only move/attack/dodge/card/crash; the rest is the gap D1 reports.
  requiredVerbs: ["move", "attack", "dodge", "card", "crash", "perfectdodge", "draft", "hone", "relic", "shop", "shield", "tempo"],
  stepBudgetFrames: 240,
};
const log = (...a) => console.log("[tutorial]", ...a);

const server = await ensureServer({ log });
const { browser, page } = await launchBrowser();
await bootGame(page);

const st = () => page.evaluate(`window.${S}debug.tutorial()`);

/** Perform a step's verb through the real input path (or the reliable proxy),
 *  stepping a few frames. Called in a loop until the step advances. */
async function doVerb(step, fault) {
  const S2 = S;
  switch (step) {
    case 0: // move
      await page.keyboard.down("KeyW");
      await page.evaluate(`window.${S2}debug.frames(8, 1/60)`);
      await page.keyboard.up("KeyW");
      break;
    case 1: { // attack — teleport next to a living husk, aim at it, swing
      await page.evaluate(`(()=>{ const c=window.${S2}; const e=c.enemies.living().find(x=>x.kind!=="boss"); if(e){ c.player.pos.x=e.pos.x-1.0; c.player.pos.z=e.pos.z; } })()`);
      await page.mouse.move(820, 430);
      await page.mouse.down(); await sleep(30); await page.mouse.up();
      await page.evaluate(`window.${S2}debug.frames(10, 1/60)`);
      break;
    }
    case 2: // dodge
      await page.keyboard.press("Space");
      await page.evaluate(`window.${S2}debug.frames(10, 1/60)`);
      break;
    case 3: // card
      await page.keyboard.press("Digit1");
      await page.evaluate(`window.${S2}debug.frames(10, 1/60)`);
      break;
    case 4: // crash
      if (fault) await page.evaluate(`window.${S2}.tempo.crash(0)`); // drain heat → CRASH can't fire (uncompletable fault)
      await page.keyboard.press("KeyF");
      await page.evaluate(`window.${S2}debug.frames(10, 1/60)`);
      break;
    default:
      await page.evaluate(`window.${S2}debug.frames(6, 1/60)`);
  }
}

const results = { steps: [], findings: [], warnings: [] };
let failures = 0;

// ── stage the tutorial ──────────────────────────────────────────────────────
await page.evaluate(`window.${S}debug.scenario("tutorial")`);
await sleep(400);
let cur = await st();
if (!cur.inTutorial) { log("FAIL: scenario('tutorial') did not enter the Training Grounds"); failures++; }

// D3 — objective present + non-vague at step 0
const vague = (o) => !o || o.trim().length < 4 || /^\.*$/.test(o);
if (vague(cur.objective)) { log(`OBJECTIVE-VAGUE at step 0: "${cur.objective}"`); results.findings.push({ type: "OBJECTIVE-VAGUE", step: 0 }); failures++; }

// D2 — drive every step to completion within budget
const taughtSeen = new Set();
for (let s = 0; s <= 4; s++) {
  const atStep = await st();
  const before = atStep.step;
  if (before < 0) break;
  const verb = atStep.verb;
  taughtSeen.add(verb);
  let advanced = false, frames = 0;
  while (frames < TC.stepBudgetFrames) {
    await doVerb(before, SELFTEST && before === 4);
    frames += 12;
    const now = await st();
    if (now.step > before || now.done) { advanced = true; break; }
    if (vague(now.objective) && !now.done) { results.findings.push({ type: "OBJECTIVE-VAGUE", step: now.step }); }
  }
  results.steps.push({ step: before, verb, advanced, frames });
  log(`step ${before} (${verb || "?"}): ${advanced ? `advanced in ~${frames} frames` : "STUCK"}`);
  if (!advanced) { log(`UNCOMPLETABLE: tutorial step ${before} never advanced within ${TC.stepBudgetFrames} frames — an onboarding soft-lock`); results.findings.push({ type: "UNCOMPLETABLE", step: before }); failures++; break; }
  cur = await st();
  if (cur.done) break;
}

// confirm completion (onComplete → leaves the tutorial)
await page.evaluate(`window.${S}debug.frames(200, 1/60)`);
const end = await st();
const completed = !end.inTutorial || end.done;
results.completed = completed;
log(`tutorial completed: ${completed}`);
if (!SELFTEST && !completed && !results.findings.some((f) => f.type === "UNCOMPLETABLE")) {
  log("FAIL: tutorial drove all verbs but never reached completion (onComplete didn't fire)"); failures++;
}

// D1 — required-but-never-taught (WARN report, owner-decides)
if (!SELFTEST) {
  const taught = new Set(["move", "attack", "dodge", "card", "crash"]); // TUTORIAL_VERBS
  const gap = TC.requiredVerbs.filter((v) => !taught.has(v));
  results.warnings = gap;
  if (gap.length) log(`REQUIRED-BUT-NEVER-TAUGHT (WARN — the run expects these, the tutorial teaches none): ${gap.join(", ")}`);
}

writeJSON(join(GAME_DIR, "artifacts", "qa", "tutorial.json"), {
  at: new Date().toISOString(), selftest: SELFTEST, results, failures,
});

if (SELFTEST) {
  const stuckFired = results.findings.some((f) => f.type === "UNCOMPLETABLE" && f.step === 4);
  log(`selftest UNCOMPLETABLE (tempo drained at the CRASH step): fired=${stuckFired}`);
  if (!stuckFired) { log("SELFTEST FAIL: an uncompletable CRASH step was not caught"); }
  // In selftest, the ONLY expected failure is the injected one — the rest of the
  // drive must have worked (steps 0-3 advanced).
  const early = results.steps.slice(0, 4).every((x) => x.advanced);
  if (!early) log("SELFTEST NOTE: an earlier step also failed to advance (drive issue)");
  failures = (stuckFired && early) ? 0 : 1;
}

await browser.close();
server.stop();
if (failures) { log(`FAIL — ${failures}`); process.exit(Math.min(failures, 99)); }
log(SELFTEST ? "OK — the completability oracle catches an uncompletable step" : "OK — the tutorial is completable end-to-end; required-but-never-taught reported as WARN");
