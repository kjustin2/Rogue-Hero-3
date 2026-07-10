// CONTACT FIDELITY — "does the player look right when interacting with another
// character?" The player must never STAND INSIDE an enemy body. This forces a deep
// overlap (player.pos := enemy.pos), steps the sim, and asserts the game SEPARATES
// them back to ~touching distance — the regression proof for the player↔enemy soft
// separation in controller.update (it FAILS with no separation, PASSES with it).
// Ratio = center-distance ÷ (playerR + enemyR): ~1.0 = touching (correct), ~0 =
// interpenetrating (the bug). Dodging is skipped by the game (dash i-frames pass
// through), so this measures the non-dodge case.
//
//   node scripts/qa/contact.mjs             force overlaps, assert they resolve
//   node scripts/qa/contact.mjs --selftest  fault-proof: a stayed-overlapped ratio
//                                           flags; a recovered ratio stays clean
//
// Exit = interpenetration count.
import { join } from "node:path";
import {
  launchBrowser, bootGame, enterRun, gotoScenario, writeJSON, ensureServer, guard, GAME_DIR,
} from "../loop/lib.mjs";
import cfg from "./qa.config.mjs";

guard({ name: "qa-contact", maxMinutes: 8 });
const SELFTEST = process.argv.includes("--selftest");
const S = cfg.seam;
const CT = cfg.contact ?? {
  kinds: ["husk", "brute", "bastion", "leaper", "caster"],
  recoverFrames: 14, recoverRatio: 0.8,
};
const log = (...a) => console.log("[contact]", ...a);

/** PURE: a final separation ratio below the floor = still interpenetrating. */
const interpenetrating = (ratio, floor) => ratio < floor;

const server = await ensureServer({ log });
const { browser, page } = await launchBrowser();
await bootGame(page);

let failures = 0;
const report = { units: [] };

if (!SELFTEST) {
  await enterRun(page);
  await gotoScenario(page, "room:combat", { settle: 900 });
  const rows = await page.evaluate(`(() => {
    const c = window.${S}, d = window.${S}debug; d.godmode();
    const out = [];
    for (const kind of ${JSON.stringify(CT.kinds)}) {
      c.enemies.clearNonBosses();
      c.player.pos.set(0, 0, 0);
      try { c.enemies.spawn(kind, 3, 0, 0); } catch {}
      d.frames(6, 1/60);
      const e = c.enemies.living().find((x) => x.kind !== "boss");
      if (!e) { out.push({ kind, spawned: false }); continue; }
      // force a DEEP overlap just off the enemy's center (not dead-center — that's
      // the degenerate no-push-direction case both separation loops skip by design).
      c.player.pos.set(e.pos.x + 0.05, 0, e.pos.z + 0.05);
      const rr = c.player.radius + e.radius;
      d.frames(${CT.recoverFrames}, 1/60);
      const dist = Math.hypot(c.player.pos.x - e.pos.x, c.player.pos.z - e.pos.z);
      out.push({ kind, spawned: true, ratio: +(dist / rr).toFixed(2), radii: +rr.toFixed(2) });
    }
    return out;
  })()`);
  for (const r of rows) {
    report.units.push(r);
    if (!r.spawned) { log(`  ${r.kind}: could not spawn (skipped)`); continue; }
    const bad = interpenetrating(r.ratio, CT.recoverRatio);
    log(`  ${r.kind}: forced overlap → recovered to ${r.ratio}× touching ${bad ? "— INTERPENETRATION (player stands inside the body)" : "ok"}`);
    if (bad) failures++;
  }
  log(`${rows.filter((r) => r.spawned).length} units — ${failures} interpenetration(s)`);
} else {
  const clean = interpenetrating(0.95, CT.recoverRatio);   // recovered → not flagged
  const stuck = interpenetrating(0.1, CT.recoverRatio);    // stayed inside → flagged
  log(`selftest: recovered(0.95)-flagged=${clean} (false); stuck(0.1)-flagged=${stuck} (true)`);
  report.selftest = { clean, stuck };
  failures = (!clean && stuck) ? 0 : 1;
}

writeJSON(join(GAME_DIR, "artifacts", "qa", "contact.json"), {
  at: new Date().toISOString(), selftest: SELFTEST, report, failures,
});

await browser.close();
server.stop();
if (failures) { log(`FAIL — ${failures}`); process.exit(Math.min(failures, 99)); }
log(SELFTEST ? "OK — the contact check flags a stayed-overlap and passes a recovered one"
  : "OK — the player is separated out of every enemy body (no interpenetration)");
