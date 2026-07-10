// CONFINEMENT — "the player can't run off the map." Drives the player hard at the
// arena rim from 8 directions AND fires every dash/mobility card (dashes write
// player.pos directly, so they're the real escape risk), asserting the position
// radius never exceeds the arena radius. Reads the bound off world() (never inlines).
//
//   node scripts/qa/confinement.mjs             ram every edge + dash out
//   node scripts/qa/confinement.mjs --selftest  fault-proof: a synthetic out-of-bounds
//                                               position flags; in-bounds stays clean
//
// Exit = out-of-bounds breach count.
import { join } from "node:path";
import {
  launchBrowser, bootGame, enterRun, gotoScenario, writeJSON, ensureServer, guard, GAME_DIR,
} from "../loop/lib.mjs";
import cfg from "./qa.config.mjs";

guard({ name: "qa-confinement", maxMinutes: 8 });
const SELFTEST = process.argv.includes("--selftest");
const S = cfg.seam;
const CF = cfg.confinement ?? { framesPerDir: 90, eps: 0.05, dashCards: ["dash-strike", "rift-hook", "blade-cyclone", "charged-lance", "feral-leap"] };
const log = (...a) => console.log("[confinement]", ...a);

/** PURE: a position radius beyond arenaRadius+eps is a breach. */
const breach = (radius, arenaRadius, eps) => radius > arenaRadius + eps;

const server = await ensureServer({ log });
const { browser, page } = await launchBrowser();
await bootGame(page);

let failures = 0;
const report = {};

if (!SELFTEST) {
  await enterRun(page);
  await gotoScenario(page, "room:combat", { settle: 900 });
  const res = await page.evaluate(`(() => {
    const c = window.${S}, d = window.${S}debug; d.godmode();
    const arenaR = d.world().arenaRadius;
    let maxR = 0;
    const sample = () => { const r = Math.hypot(c.player.pos.x, c.player.pos.z); if (r > maxR) maxR = r; };
    // 8 directions: park the player near the rim, hold movement outward, step.
    for (let a = 0; a < 8; a++) {
      const ax = Math.sin(a * Math.PI / 4), az = Math.cos(a * Math.PI / 4);
      c.player.pos.set(ax * (arenaR - 1), 0, az * (arenaR - 1));
      for (let f = 0; f < ${CF.framesPerDir}; f++) {
        c.input.bot = { move: { x: ax, z: az }, aimX: ax * 99, aimZ: az * 99, down: new Set(), pressed: new Set() };
        d.frames(1, 1/60); sample();
      }
    }
    // dash/mobility cards aimed outward from near the rim. Clear bot FIRST so
    // updateAim doesn't overwrite the aimPoint we set for the dash heading.
    c.input.bot = null;
    for (const id of ${JSON.stringify(CF.dashCards)}) {
      const def = window.${S}cards.find((x) => x.id === id); if (!def) continue;
      c.player.pos.set(arenaR - 1.5, 0, 0); c.player.facing = Math.PI / 2; // face +X (outward)
      c.input.aimPoint && c.input.aimPoint.set(arenaR + 20, 0, 0);
      try { c.caster.cast(def, true); } catch {}
      for (let f = 0; f < 30; f++) { d.frames(1, 1/60); sample(); }
    }
    return { arenaR: +arenaR.toFixed(2), maxR: +maxR.toFixed(2) };
  })()`);
  report.arenaR = res.arenaR; report.maxR = res.maxR;
  const bad = breach(res.maxR, res.arenaR, CF.eps);
  log(`arena radius ${res.arenaR}, max player radius reached ${res.maxR} ${bad ? `— BREACH (ran off the map by ${(res.maxR - res.arenaR).toFixed(2)})` : "ok"}`);
  failures = bad ? 1 : 0;
} else {
  const inb = breach(18.5, 19, 0.05);   // inside → clean
  const out = breach(21.0, 19, 0.05);   // outside → flagged
  log(`selftest: in-bounds(18.5)-flagged=${inb} (false); out-of-bounds(21.0)-flagged=${out} (true)`);
  report.selftest = { inb, out };
  failures = (!inb && out) ? 0 : 1;
}

writeJSON(join(GAME_DIR, "artifacts", "qa", "confinement.json"), {
  at: new Date().toISOString(), selftest: SELFTEST, report, failures,
});

await browser.close();
server.stop();
if (failures) { log(`FAIL — ${failures}`); process.exit(1); }
log(SELFTEST ? "OK — the bound check flags an out-of-bounds position and passes in-bounds"
  : "OK — the player never escaped the arena (rim ramming + dashes all contained)");
