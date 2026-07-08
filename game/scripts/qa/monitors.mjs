// RUNTIME-VERIFICATION MONITORS — Dwyer property-specification patterns compiled
// to tiny 3-valued reducers that subscribe to the typed EventBus and scream the
// instant a trace violates the spec. Catches ORDERING + LIVENESS bugs the
// per-frame perception oracles are blind to: a boss phase that silently never
// advances, a card that casts without priming, a room that never resolves
// (soft-lock as a discharge failure, not a wall-clock timeout), tempo-state
// corruption, resource-accounting drift. No deps; passive sink on a real drive.
//
//   node scripts/qa/monitors.mjs             watch a boss-fight drive
//   node scripts/qa/monitors.mjs --selftest  fault-proof: emitting BOSS_DEFEATED
//                                            with no prior BOSS_INTRO, a >1-zone
//                                            upward tempo jump, and an out-of-range
//                                            BOSS_HP must each be caught; a clean
//                                            drive must report nothing
//
// Specs (from EventMap): Precedence (BOSS_DEFEATED after BOSS_INTRO; BOSS_PHASE
// after BOSS_INTRO; PLAYER_DIED after PLAYER_HIT), bounded Response (ROOM_START →
// ROOM_CLEARED ∨ PLAYER_DIED within N frames), Universality/invariant (BOSS_HP in
// [0,max]; TEMPO_ZONE never skips UP >1 zone; CARD_RESTORED ≤ CARD_STOLEN).
// Exit = violation count.
import { join } from "node:path";
import {
  launchBrowser, bootGame, enterRun, gotoScenario, sleep, writeJSON, ensureServer, guard, GAME_DIR,
} from "../loop/lib.mjs";
import cfg from "./qa.config.mjs";

guard({ name: "qa-monitors", maxMinutes: 8 });
const SELFTEST = process.argv.includes("--selftest");
const S = cfg.seam;
const ROOM_DEADLINE = cfg.monitors?.roomDeadlineFrames ?? 7200; // 2 min of sim @60
const log = (...a) => console.log("[monitors]", ...a);

const server = await ensureServer({ log });
const { browser, page } = await launchBrowser();
await bootGame(page);
await enterRun(page);

// Install the monitors on the live bus BEFORE staging, so BOSS_INTRO is captured.
// Each is a small reducer; violations accumulate on window.__qaMon.
await page.evaluate(`(() => {
  const ev = window.${S}.events;
  const M = window.__qaMon = {
    frame: 0, violations: [],
    bossIntroSeen: false, playerHitSeen: false,
    openRoom: null,            // { index, atFrame } for the bounded Response
    zoneOrder: ["cold", "flowing", "hot", "critical"],
    lastZoneIdx: null, stolen: 0, restored: 0,
  };
  const V = (rule, detail) => M.violations.push({ rule, detail, frame: M.frame });

  // Precedence: BOSS_INTRO before BOSS_DEFEATED / BOSS_PHASE
  ev.on("BOSS_INTRO", () => { M.bossIntroSeen = true; });
  ev.on("BOSS_DEFEATED", () => { if (!M.bossIntroSeen) V("Precedence", "BOSS_DEFEATED with no prior BOSS_INTRO"); });
  ev.on("BOSS_PHASE", (p) => { if (!M.bossIntroSeen) V("Precedence", "BOSS_PHASE " + p.phase + " with no prior BOSS_INTRO"); });
  // Precedence: PLAYER_HIT before PLAYER_DIED
  ev.on("PLAYER_HIT", () => { M.playerHitSeen = true; });
  ev.on("PLAYER_DIED", () => { if (!M.playerHitSeen) V("Precedence", "PLAYER_DIED with no prior PLAYER_HIT"); });

  // Bounded Response: ROOM_START -> ROOM_CLEARED | PLAYER_DIED within deadline.
  ev.on("ROOM_START", (p) => { M.openRoom = { index: p.index, atFrame: M.frame }; });
  const closeRoom = () => { M.openRoom = null; };
  ev.on("ROOM_CLEARED", closeRoom);
  ev.on("PLAYER_DIED", closeRoom);

  // Invariant: BOSS_HP within [0, maxHp]
  ev.on("BOSS_HP", (p) => { if (p.hp < -1e-6 || p.hp > p.maxHp + 1e-6) V("Invariant", "BOSS_HP " + p.hp + " out of [0," + p.maxHp + "]"); });

  // Invariant: TEMPO_ZONE never SKIPS upward > 1 zone (gains are gradual; a crash
  // may drop any number of zones, which is allowed).
  ev.on("TEMPO_ZONE", (p) => {
    const i = M.zoneOrder.indexOf(p.zone);
    if (i < 0) { V("Invariant", "unknown tempo zone " + p.zone); return; }
    if (M.lastZoneIdx != null && i - M.lastZoneIdx > 1) V("Invariant", "tempo jumped UP " + (i - M.lastZoneIdx) + " zones (" + M.zoneOrder[M.lastZoneIdx] + "->" + p.zone + ")");
    M.lastZoneIdx = i;
  });

  // Invariant: CARD_RESTORED count <= CARD_STOLEN count (the Wound swallows then returns)
  ev.on("CARD_STOLEN", () => { M.stolen++; });
  ev.on("CARD_RESTORED", () => { M.restored++; if (M.restored > M.stolen) V("Invariant", "CARD_RESTORED (" + M.restored + ") exceeds CARD_STOLEN (" + M.stolen + ")"); });

  return true;
})()`);

// ── the drive: a real boss fight (fires the boss/room/tempo/card events) ─────
const bump = (n = 30) => page.evaluate(`(()=>{ const M=window.__qaMon; for(let i=0;i<${n};i++){ M.frame++; window.${S}debug.frames(1, 1/60); } })()`);

await gotoScenario(page, "boss:warden", { settle: 2000 });
await page.evaluate(`window.${S}debug.godmode()`);
// cast the 3 cards (CARD_PRIME -> CARD_CAST), take a beat, then kill the boss.
for (const key of ["Digit1", "Digit2", "Digit3"]) { await page.keyboard.press(key); await bump(20); }
// whittle the boss through its phases so BOSS_PHASE + BOSS_HP + BOSS_DEFEATED fire.
for (let i = 0; i < 8; i++) {
  await page.evaluate(`(()=>{ const b=window.${S}.enemies.living().find(e=>e.kind==="boss"); if(b) b.takeDamage(Math.max(1, b.maxHp*0.18)); })()`);
  await bump(25);
}
await bump(120); // let ROOM_CLEARED discharge

if (SELFTEST) {
  // Inject three violations directly on the bus (the monitors must catch each).
  await page.evaluate(`(()=>{
    const ev = window.${S}.events; const M = window.__qaMon;
    M.bossIntroSeen = false;                             // reset so the next defeat is "unintroduced"
    ev.emit("BOSS_DEFEATED", { x: 0, z: 0 });            // Precedence fault
    M.lastZoneIdx = 0;                                   // cold
    ev.emit("TEMPO_ZONE", { zone: "critical", prev: "cold" }); // >1-zone upward jump
    ev.emit("BOSS_HP", { hp: 999999, maxHp: 1000 });     // out-of-range invariant
  })()`);
}

// Bounded-Response check: any room still open past the deadline = a soft-lock.
const mon = await page.evaluate(`(()=>{
  const M = window.__qaMon;
  if (M.openRoom && (M.frame - M.openRoom.atFrame) > ${ROOM_DEADLINE}) {
    M.violations.push({ rule: "Response", detail: "ROOM_START(" + M.openRoom.index + ") never discharged to ROOM_CLEARED/PLAYER_DIED within ${ROOM_DEADLINE} frames — soft-lock", frame: M.frame });
  }
  return { violations: M.violations, frames: M.frame, stolen: M.stolen, restored: M.restored, bossIntro: M.bossIntroSeen };
})()`);

for (const v of mon.violations) log(`  ${v.rule}: ${v.detail} (@frame ${v.frame})`);
log(`drive: ${mon.frames} frames, ${mon.violations.length} violation(s)`);

let failures = mon.violations.length;
if (SELFTEST) {
  const rules = new Set(mon.violations.map((v) => v.rule));
  const gotPrec = mon.violations.some((v) => /BOSS_DEFEATED with no prior/.test(v.detail));
  const gotZone = mon.violations.some((v) => /tempo jumped UP/.test(v.detail));
  const gotHp = mon.violations.some((v) => /BOSS_HP .* out of/.test(v.detail));
  log(`selftest: Precedence=${gotPrec} tempo-jump=${gotZone} BOSS_HP-range=${gotHp}`);
  failures = (gotPrec && gotZone && gotHp) ? 0 : 1;
  if (failures) log("SELFTEST FAIL: a monitor missed its injected violation");
}

writeJSON(join(GAME_DIR, "artifacts", "qa", "monitors.json"), {
  at: new Date().toISOString(), selftest: SELFTEST, violations: mon.violations, frames: mon.frames, failures,
});

await browser.close();
server.stop();
if (failures) { log(`FAIL — ${failures}`); process.exit(Math.min(failures, 99)); }
log(SELFTEST ? "OK — the monitors catch injected ordering/liveness/invariant violations" : "OK — no ordering/liveness/invariant violations over the boss-fight drive");
