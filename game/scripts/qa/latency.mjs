// INPUT-LATENCY GATE — "does the game feel responsive?" made a number. For each
// core verb, inject the REAL input, then step the deterministic stepper ONE frame
// at a time until the game responds, and report input→response latency in ms.
// Gate at 100ms (6 frames @60): a verb that takes many frames to register is the
// mushy-controls regression (an input queue backup, an animation lock swallowing
// the edge, a debounce). Measured through the real action layer, not a shortcut.
//
//   move   → player position changes
//   attack → combat.swinging goes true
//   dodge  → controller.dodging goes true
//   card   → CARD_CAST fires
//
//   node scripts/qa/latency.mjs             measure per-verb input latency
//   node scripts/qa/latency.mjs --selftest  fault-proof: the frame→ms + gate math
//                                           must flag a fabricated slow (12-frame)
//                                           response and pass a snappy (2-frame) one
//
// Exit = over-gate verb count.
import { join } from "node:path";
import {
  launchBrowser, bootGame, enterRun, gotoScenario, writeJSON, ensureServer, guard, GAME_DIR,
} from "../loop/lib.mjs";
import cfg from "./qa.config.mjs";

guard({ name: "qa-latency", maxMinutes: 8 });
const SELFTEST = process.argv.includes("--selftest");
const S = cfg.seam;
const LT = cfg.latency ?? { gateMs: 100, maxFrames: 30, fps: 60 };
const log = (...a) => console.log("[latency]", ...a);

/** PURE frame→latency + gate (reused by the selftest). */
const toMs = (frame, fps) => (frame < 0 ? Infinity : (frame * 1000) / fps);
const overGate = (ms, gate) => ms > gate;

// Poll a verb's response predicate after each single stepped frame; return the
// first frame index (1-based) at which it fired, or -1 within maxFrames.
async function measure(page, { arm, respond, disarm }) {
  await arm();
  let first = -1;
  for (let f = 1; f <= LT.maxFrames; f++) {
    await page.evaluate(`window.${S}debug.frames(1, ${1 / LT.fps})`);
    const ok = await page.evaluate(respond);
    if (ok) { first = f; break; }
  }
  if (disarm) await disarm();
  return first;
}

const server = await ensureServer({ log });
const { browser, page } = await launchBrowser();
await bootGame(page);

let failures = 0;
const report = { verbs: [] };

if (!SELFTEST) {
  await enterRun(page);
  await gotoScenario(page, "room:combat", { settle: 1000 });
  // Center the player and clear threats so movement isn't wall-blocked and no
  // incoming hit masks the response.
  await page.evaluate(`(()=>{ const c=window.${S}; c.player.pos.set(0,0,0); if(c.enemies.clearNonBosses) c.enemies.clearNonBosses(); window.${S}debug.godmode(); })()`);

  const verbs = [
    {
      name: "move", key: "KeyW",
      arm: async () => { await page.evaluate(`window.${S}.__latBase = { x: window.${S}.player.pos.x, z: window.${S}.player.pos.z };`); await page.keyboard.down("KeyW"); },
      respond: `(() => { const p = window.${S}.player.pos, b = window.${S}.__latBase; return Math.hypot(p.x - b.x, p.z - b.z) > 0.02; })()`,
      disarm: async () => { await page.keyboard.up("KeyW"); },
    },
    {
      name: "dodge", key: "Space",
      arm: async () => { await page.keyboard.down("Space"); },
      respond: `!!window.${S}.controller.dodging`,
      disarm: async () => { await page.keyboard.up("Space"); await page.evaluate(`window.${S}debug.frames(40, ${1 / LT.fps})`); },
    },
    {
      name: "attack",
      arm: async () => { await page.mouse.move(800, 430); await page.mouse.down(); },
      respond: `!!window.${S}.combat.swinging`,
      disarm: async () => { await page.mouse.up(); await page.evaluate(`window.${S}debug.frames(30, ${1 / LT.fps})`); },
    },
    {
      name: "card",
      arm: async () => { await page.evaluate(`(()=>{ const c=window.${S}; c.__latCast=false; c.__latOff && c.__latOff(); c.__latOff = c.events.on("CARD_CAST", ()=>{ c.__latCast=true; }); })()`); await page.keyboard.down("Digit1"); },
      respond: `!!window.${S}.__latCast`,
      disarm: async () => { await page.keyboard.up("Digit1"); await page.evaluate(`window.${S}.__latOff && window.${S}.__latOff();`); },
    },
  ];

  for (const v of verbs) {
    const frame = await measure(page, v);
    const ms = toMs(frame, LT.fps);
    const over = frame < 0 || overGate(ms, LT.gateMs);
    report.verbs.push({ verb: v.name, frame, ms: frame < 0 ? null : +ms.toFixed(1), over });
    log(`${v.name}: ${frame < 0 ? `NO RESPONSE in ${LT.maxFrames} frames` : `${frame} frame(s) = ${ms.toFixed(1)}ms`} (gate ${LT.gateMs}ms) ${over ? "FAIL" : "ok"}`);
    if (over) failures++;
  }
} else {
  // Prove the frame→ms + gate math: a snappy 2-frame (~33ms) response passes, a
  // sluggish 12-frame (200ms) response and a no-response (-1) are both flagged.
  const snappy = overGate(toMs(2, LT.fps), LT.gateMs);
  const sluggish = overGate(toMs(12, LT.fps), LT.gateMs);
  const none = overGate(toMs(-1, LT.fps), LT.gateMs);
  log(`selftest: snappy(2f=${toMs(2, LT.fps).toFixed(0)}ms) over=${snappy}(false); sluggish(12f=${toMs(12, LT.fps).toFixed(0)}ms) over=${sluggish}(true); no-response over=${none}(true)`);
  report.verbs = [{ selftest: true, snappyPasses: !snappy, sluggishCaught: sluggish, noResponseCaught: none }];
  failures = (!snappy && sluggish && none) ? 0 : 1;
}

writeJSON(join(GAME_DIR, "artifacts", "qa", "latency.json"), {
  at: new Date().toISOString(), selftest: SELFTEST, report, failures,
});

await browser.close();
server.stop();
if (failures) { log(`FAIL — ${failures} verb(s) over the ${LT.gateMs}ms latency gate`); process.exit(Math.min(failures, 99)); }
log(SELFTEST ? "OK — the latency math flags sluggish/no-response and passes a snappy input" : `OK — every verb responds within ${LT.gateMs}ms`);
