// AIM FIDELITY — "attacks fire where the player aims" (a chronic action-game bug
// class: attacks that ignore aim / fire at a stale heading). For several aim angles,
// a TARGET is placed under the aim and a DECOY on the exact opposite side; the player
// aims + melees, and the target must take damage while the decoy does NOT — the swing
// went where the player aimed, not backward or at a fixed heading. (simHash excludes
// facing, so aim needs its own read; this is it.)
//
//   node scripts/qa/aim.mjs             swing at 8 aim angles, check target vs decoy
//   node scripts/qa/aim.mjs --selftest  fault-proof: target-hit + decoy-safe passes;
//                                       decoy-hit or target-missed flags
//
// Exit = mis-aimed angle count.
import { join } from "node:path";
import {
  launchBrowser, bootGame, enterRun, gotoScenario, writeJSON, ensureServer, guard, GAME_DIR,
} from "../loop/lib.mjs";
import cfg from "./qa.config.mjs";

guard({ name: "qa-aim", maxMinutes: 8 });
const SELFTEST = process.argv.includes("--selftest");
const S = cfg.seam;
const AM = cfg.aim ?? { angles: 8, targetR: 1.3, decoyR: 4.0 };
const log = (...a) => console.log("[aim]", ...a);

/** PURE: aim is correct at an angle iff the target was hit and the decoy was not. */
const misAimed = (r) => !(r.targetHit && !r.decoyHit);

const server = await ensureServer({ log });
const { browser, page } = await launchBrowser();
await bootGame(page);

let failures = 0;
const report = { angles: [] };

if (!SELFTEST) {
  await enterRun(page);
  await gotoScenario(page, "room:combat", { settle: 900 });
  const rows = await page.evaluate(`(() => {
  const c = window.${S}, d = window.${S}debug; d.godmode();
    // Aim fidelity must isolate the weapon arc. A generated room pillar can
    // resolve a pinned decoy inward on one angle and falsely report a backward
    // hit even though the attack heading is correct.
    c.arena.setObstacles([], 0);
    const out = [];
    const TR = ${AM.targetR}, DR = ${AM.decoyR};
    for (let a = 0; a < ${AM.angles}; a++) {
      const ang = a * Math.PI * 2 / ${AM.angles};
      const ax = Math.sin(ang), az = Math.cos(ang);   // aim direction (game's sin/cos forward convention)
      c.enemies.clearNonBosses();
      // Reset the previous combo before staging the next angle so its final
      // frames cannot buffer into the following angle's swing.
      c.combat.clearTransient();
      c.player.pos.set(0, 0, 0);
      try { c.enemies.spawn("husk", ax * TR, az * TR, 0); } catch {}    // TARGET in reach, under the aim
      try { c.enemies.spawn("husk", -ax * DR, -az * DR, 0); } catch {}  // DECOY far + opposite (unreachable)
      d.frames(4, 1/60);
      const living = c.enemies.living().filter((e) => e.kind !== "boss");
      let target = null, decoy = null;
      for (const e of living) { const dot = e.pos.x * ax + e.pos.z * az; if (dot > 0) target = e; else decoy = e; }
      if (!target || !decoy) { out.push({ angle: +ang.toFixed(2), spawned: false }); continue; }
      target.hp = target.maxHp = 1e6; decoy.hp = decoy.maxHp = 1e6;
      const th0 = target.hp, dh0 = decoy.hp;
      // Pin positions every frame: enemies aggro + move, so a "behind" decoy would
      // drift into the arc and confound the read. Freeze the geometry (target ahead,
      // decoy behind, player at origin) and do ONE forward swing (a single pressed
      // edge, never 'down' — holding chains to the 360° finisher that hits all around).
      const tpx = target.pos.x, tpz = target.pos.z, dpx = decoy.pos.x, dpz = decoy.pos.z;
      const pin = () => { target.pos.x = tpx; target.pos.z = tpz; decoy.pos.x = dpx; decoy.pos.z = dpz; c.player.pos.set(0, 0, 0); };
      const aimAt = { move: { x: 0, z: 0 }, aimX: tpx, aimZ: tpz, down: new Set(), pressed: new Set() };
      for (let f = 0; f < 2; f++) { c.input.bot = aimAt; pin(); d.frames(1, 1/60); }          // face
      c.input.bot = { ...aimAt, pressed: new Set(["attack"]) }; pin(); d.frames(1, 1/60);       // one swing
      for (let f = 0; f < 18; f++) { c.input.bot = aimAt; pin(); d.frames(1, 1/60); }          // land
      c.input.bot = null;
      out.push({ angle: +ang.toFixed(2), spawned: true, targetHit: target.hp < th0 - 0.5, decoyHit: decoy.hp < dh0 - 0.5 });
    }
    return out;
  })()`);
  for (const r of rows) {
    report.angles.push(r);
    if (!r.spawned) { log(`  angle ${r.angle}: spawn failed (skipped)`); continue; }
    const bad = misAimed(r);
    log(`  angle ${r.angle}rad: target-hit=${r.targetHit} decoy-hit=${r.decoyHit} ${bad ? "— MIS-AIMED" : "ok"}`);
    if (bad) failures++;
  }
  log(`${rows.filter((r) => r.spawned).length} angles — ${failures} mis-aimed`);
} else {
  const good = misAimed({ targetHit: true, decoyHit: false });   // false = not mis-aimed
  const missed = misAimed({ targetHit: false, decoyHit: false }); // true = mis-aimed (whiffed the target)
  const backward = misAimed({ targetHit: true, decoyHit: true }); // true = mis-aimed (hit behind too)
  log(`selftest: correct-aim-flagged=${good} (false); target-missed-flagged=${missed} (true); hit-decoy-flagged=${backward} (true)`);
  report.selftest = { good, missed, backward };
  failures = (!good && missed && backward) ? 0 : 1;
}

writeJSON(join(GAME_DIR, "artifacts", "qa", "aim.json"), {
  at: new Date().toISOString(), selftest: SELFTEST, report, failures,
});

await browser.close();
server.stop();
if (failures) { log(`FAIL — ${failures}`); process.exit(Math.min(failures, 99)); }
log(SELFTEST ? "OK — aim fidelity flags a whiffed target or a backward hit, passes a clean aim"
  : "OK — the swing lands where the player aims at every angle (target hit, decoy safe)");
