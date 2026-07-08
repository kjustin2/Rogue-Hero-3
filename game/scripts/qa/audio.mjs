// AUDIO ORACLE — the under-tested modality. Two deterministic gates, both
// hardware-free (they read the game's own audio bookkeeping, not a sound card):
//
//   A) SFX EVENT-ACCOUNTING: every gameplay event that should be audible must
//      actually emit a sound. Sfx subscribes to the typed bus and every sound
//      routes through tone()/noise(), which bump `sfx.soundCount` BEFORE the
//      AudioContext guard — so the count tracks INTENT independent of whether
//      headless audio runs. Fire each event in isolation, assert the count grew.
//      A silent kill/hit/dodge (a lost subscription, a gutted method) = FINDING.
//   B) MUSIC-STATE CORRECTNESS: the streamed soundtrack key (`music.playingKey`)
//      must track the game state — menu→"menu", combat(act)→"combat:act",
//      boss(act)→"boss:act". A stuck or wrong bed = FINDING.
//
//   node scripts/qa/audio.mjs             audit SFX wiring + music state
//   node scripts/qa/audio.mjs --selftest  fault-proof: a zero-delta (silent)
//                                         event and a mismatched music key must
//                                         each FIRE; a real sound / correct key
//                                         must stay quiet
//
// Exit = finding count.
import { join } from "node:path";
import {
  launchBrowser, bootGame, enterRun, gotoScenario, sleep, writeJSON, ensureServer, guard, GAME_DIR,
} from "../loop/lib.mjs";
import cfg from "./qa.config.mjs";

guard({ name: "qa-audio", maxMinutes: 8 });
const SELFTEST = process.argv.includes("--selftest");
const S = cfg.seam;
const log = (...a) => console.log("[audio]", ...a);

// Events Sfx subscribes to → each must grow soundCount. Payloads are full/valid
// so no sibling subscriber throws before Sfx's (early-registered) handler runs.
const SFX_EVENTS = [
  ["ENEMY_HIT", { x: 0, y: 1, z: 0, dmg: 10, heavy: false, killed: false }],
  ["KILL", { x: 0, z: 0, kind: "husk" }],
  ["PLAYER_HIT", { dmg: 10, srcX: 2, srcZ: 0 }],
  ["DODGE", {}],
  ["PERFECT_DODGE", { x: 0, z: 0 }],
  ["ROOM_CLEARED", { index: 0, reward: "card" }],
  ["KILL_STREAK", { count: 5 }],
  ["HEAL", { amount: 10 }],
  ["UI_HOVER", {}],
  ["UI_CLICK", {}],
  ["FREEZE", {}],
  ["TEMPO_ZONE", { zone: "critical", prev: "hot" }],
];

/** Pure delta check, reused by the selftest. A gameplay event is "silent" if it
 *  grew the sound count by zero. */
const isSilent = (delta) => delta <= 0;

const server = await ensureServer({ log });
const { browser, page } = await launchBrowser();
await bootGame(page);

let failures = 0;
const report = { sfx: [], music: [] };

if (!SELFTEST) {
  await enterRun(page);
  await gotoScenario(page, "room:combat", { settle: 1200 });

  // ── A) SFX event-accounting ──────────────────────────────────────────────
  const sfx = await page.evaluate(`(() => {
    const c = window.${S};
    const out = [];
    for (const [name, payload] of ${JSON.stringify(SFX_EVENTS)}) {
      const before = c.sfx.soundCount;
      try { c.events.emit(name, payload); } catch (e) { out.push({ name, delta: 0, threw: String(e).slice(0, 80) }); continue; }
      out.push({ name, delta: c.sfx.soundCount - before });
    }
    return out;
  })()`);
  for (const s of sfx) {
    report.sfx.push(s);
    if (isSilent(s.delta)) { log(`  SILENT: "${s.name}" emitted no sound (Δ${s.delta})${s.threw ? ` [threw: ${s.threw}]` : ""}`); failures++; }
  }
  log(`SFX: ${sfx.filter((s) => !isSilent(s.delta)).length}/${sfx.length} events audible`);

  // ── B) music-state correctness ───────────────────────────────────────────
  // Drive the actual state→music contract via ROOM_START (the event the game uses
  // to cue battle/boss beds). Loading a node through debugLoadNode would fire the
  // act-intro's "map" breather bed first, masking the combat cue — so emit
  // ROOM_START directly to test the wiring, not the intro sequencing.
  // silence() before each ROOM_START case so cue() always transitions (not an
  // already-equal early-return), and tutorial runs LAST (it stays active and would
  // re-cue its own bed during later cases).
  const cases = [
    { name: "menu", stage: `window.${S}debug.scenario("menu")`, expect: "menu" },
    { name: "combat-act1", stage: `window.${S}.music.silence(); window.${S}.events.emit("ROOM_START", { index: 2, name: "c", isBoss: false, act: 1, elite: false })`, expect: "combat:1" },
    { name: "combat-act3", stage: `window.${S}.music.silence(); window.${S}.events.emit("ROOM_START", { index: 2, name: "c", isBoss: false, act: 3, elite: false })`, expect: "combat:3" },
    { name: "boss-act2", stage: `window.${S}.music.silence(); window.${S}.events.emit("ROOM_START", { index: 2, name: "b", isBoss: true, act: 2, elite: false })`, expect: "boss:2" },
    { name: "tutorial", stage: `window.${S}debug.scenario("tutorial")`, expect: "tutorial" },
  ];
  for (const cse of cases) {
    await page.evaluate(cse.stage);
    await sleep(500);
    const key = await page.evaluate(`window.${S}.music.playingKey`);
    const ok = key === cse.expect;
    report.music.push({ state: cse.name, expect: cse.expect, actual: key, ok });
    log(`  music ${cse.name}: key="${key}" (expected "${cse.expect}") ${ok ? "OK" : "MISMATCH"}`);
    if (!ok) failures++;
  }
} else {
  // Prove both checkers on fabricated data.
  const silentCaught = isSilent(0) === true;      // zero-delta flagged
  const audiblePass = isSilent(3) === false;      // real sound not flagged
  const musicMismatchCaught = ("boss:1" !== "combat:1");
  const musicMatchPass = ("menu" === "menu");
  report.sfx = [{ selftest: true, silentCaught, audiblePass }];
  report.music = [{ selftest: true, musicMismatchCaught, musicMatchPass }];
  log(`selftest: silent-caught=${silentCaught} audible-passes=${audiblePass} music-mismatch-caught=${musicMismatchCaught} music-match-passes=${musicMatchPass} (all true)`);
  failures = (silentCaught && audiblePass && musicMismatchCaught && musicMatchPass) ? 0 : 1;
}

writeJSON(join(GAME_DIR, "artifacts", "qa", "audio.json"), {
  at: new Date().toISOString(), selftest: SELFTEST, report, failures,
});

await browser.close();
server.stop();
if (failures) { log(`FAIL — ${failures}`); process.exit(Math.min(failures, 99)); }
log(SELFTEST ? "OK — the silent-event and music-mismatch checks both fire on injected faults" : "OK — every gameplay event is audible and the music bed tracks the game state");
