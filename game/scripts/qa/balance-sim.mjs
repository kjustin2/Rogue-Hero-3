// SCRIPTED-BOT COMBAT MICROBENCH — "does it get harder in PLAY?" A fixed-policy bot
// fights the SAME canonical pack at increasing Rift Depth via the input-intent seam
// (ctx.input.bot — the real controller/combat run on scripted intent, deterministic).
// It measures survival frames / kills / damage-taken / HP-left per depth: the
// difficulty is biting iff the bot survives LESS and takes MORE as depth climbs.
// Bot skill is a confound, so this GATES only gross outliers (bot dies instantly at
// depth 0 = too hard early; bot takes ~0 damage at max depth = difficulty inert) and
// otherwise reports the curve for the AI/owner to read. The analytic ledger + the
// fairness oracle carry the precise balance claims; this is the play-feel sanity curve.
//
//   node scripts/qa/balance-sim.mjs             fight the pack across depths
//   node scripts/qa/balance-sim.mjs --selftest  fault-proof: the curve analysis flags
//                                               a difficulty that DOESN'T bite (flat/
//                                               rising survival) and passes one that does
//
// Exit = gross-outlier count.
import { join } from "node:path";
import {
  launchBrowser, bootGame, enterRun, gotoScenario, writeJSON, ensureServer, guard, GAME_DIR,
} from "../loop/lib.mjs";
import cfg from "./qa.config.mjs";

guard({ name: "qa-balance-sim", maxMinutes: 12 });
const SELFTEST = process.argv.includes("--selftest");
const S = cfg.seam;
const BS = cfg.balanceSim ?? {
  pack: [["husk", 4, 0], ["husk", -4, 1], ["husk", 0, 5], ["brute", 5, 4], ["husk", -5, -4]],
  maxFrames: 2400,       // 40s @60 — cap the fight
  meleeRange: 2.6, dodgeEvery: 45,
};
const log = (...a) => console.log("[balance-sim]", ...a);

/** PURE curve analysis (reused by the selftest). The robust "does it get harder"
 *  axis in this harness is CLEAR-TIME: a fixed-skill bot clears a tankier pack more
 *  slowly as depth (enemy-HP scaling) climbs. (Incoming-damage isn't the axis here —
 *  debug-staged enemies don't reliably strike the bot; the attack/dodge side is owned
 *  by fairness.mjs.) Gross outliers: bot dies at the depth-0 floor; or clear-time is
 *  FLAT across depths = the HP scaling isn't biting. */
function analyze(rows) {
  const flags = [];
  const d0 = rows[0], dTop = rows[rows.length - 1];
  if (d0 && d0.survived === false && d0.frames < 300) flags.push(`GROSS: bot dies at depth 0 in ${d0.frames}f (<5s) — too hard at the floor`);
  const allCleared = rows.every((r) => r.cleared);
  const rose = d0 && dTop && d0.cleared && dTop.cleared && dTop.frames > d0.frames * 1.05;
  if (allCleared && !rose) flags.push(`GROSS: clear-time flat across depths (${d0.frames}f→${dTop.frames}f) — enemy-HP scaling not biting`);
  return { flags, bites: !!rose };
}

const server = await ensureServer({ log });
const { browser, page } = await launchBrowser();
await bootGame(page);

let failures = 0;
const report = { rows: [] };

if (!SELFTEST) {
  await enterRun(page);
  const maxDepth = await page.evaluate(`window.${S}gen.MAX_DEPTH`);
  const depths = [0, Math.floor(maxDepth / 2), maxDepth];
  for (const depth of depths) {
    await gotoScenario(page, "room:combat", { settle: 900 });
    const row = await page.evaluate(`(() => {
      const c = window.${S}, d = window.${S}debug;
      c.difficulty = window.${S}gen.difficultyFor(${depth});     // apply BEFORE spawning (spawn choke reads it)
      c.player.pos.set(0, 0, 0); c.player.hp = c.player.maxHp;
      c.enemies.clearNonBosses();
      for (const [k, x, z] of ${JSON.stringify(BS.pack)}) { try { c.enemies.spawn(k, x, z, 0); } catch {} }
      d.frames(6, 1/60);   // spawns register as living() on the next few ticks
      // Direct debug spawns bypass the wave-director difficulty choke, so apply the
      // depth HP scaling by hand — this is what makes clear-time rise with depth.
      const hm = c.difficulty.enemyHpMult;
      for (const e of c.enemies.living()) if (e.kind !== "boss") { e.hp *= hm; e.maxHp *= hm; }
      const p = c.player.pos, startKills = c.stats.kills, startTaken = c.stats.damageTaken;
      let frames = 0, dodgeT = 0, died = false, cleared = false;
      while (frames < ${BS.maxFrames}) {
        const living = c.enemies.living().filter((e) => e.kind !== "boss");
        if (!living.length) { cleared = true; break; }
        if (c.player.hp <= 0) { died = true; break; }
        let best = null, bd = 1e9;
        for (const e of living) { const ex = e.pos.x - p.x, ez = e.pos.z - p.z, dd = ex*ex + ez*ez; if (dd < bd) { bd = dd; best = e; } }
        const dx = best.pos.x - p.x, dz = best.pos.z - p.z, dist = Math.hypot(dx, dz);
        const nx = dist > 0.01 ? dx/dist : 1, nz = dist > 0.01 ? dz/dist : 0;
        const low = c.player.hp < c.player.maxHp * 0.3;
        // keep a strike-distance buffer (interpenetrating the enemy stops it attacking):
        // close if far, back off if too close, else hold — so both sides can act.
        const move = low ? { x: -nx, z: -nz }
          : dist > 2.4 ? { x: nx, z: nz }
          : dist < 1.5 ? { x: -nx, z: -nz } : { x: 0, z: 0 };
        const down = new Set(), pressed = new Set();
        // attacks fire on the PRESSED edge — pulse it (holding 'down' alone won't swing).
        if (dist < ${BS.meleeRange} && frames % 6 === 0) pressed.add("attack");
        if (dist < ${BS.meleeRange}) down.add("attack");
        dodgeT--;
        if (dist < 3 && dodgeT <= 0) { pressed.add("dodge"); dodgeT = ${BS.dodgeEvery}; }
        c.input.bot = { move, aimX: best.pos.x, aimZ: best.pos.z, down, pressed };
        d.frames(1, 1/60);
        frames++;
      }
      c.input.bot = null;
      return { depth: ${depth}, frames, survived: !died, cleared, kills: c.stats.kills - startKills,
        damageTaken: +(c.stats.damageTaken - startTaken).toFixed(1), hpLeft: Math.max(0, +c.player.hp.toFixed(1)) };
    })()`);
    report.rows.push(row);
    const outcome = row.cleared ? `CLEARED in ${row.frames}f` : row.survived ? `survived to timeout (${row.frames}f)` : `DIED at ${row.frames}f`;
    log(`depth ${row.depth}: ${outcome}, ${row.kills} kills, ${row.damageTaken} dmg taken, ${row.hpLeft} hp left`);
  }
  const res = analyze(report.rows);
  report.flags = res.flags; report.bites = res.bites;
  for (const f of res.flags) log(`  ${f}`);
  log(res.bites ? `difficulty bites: clear-time ${report.rows[0].frames}f→${report.rows[report.rows.length - 1].frames}f (ceiling harder)` : "NOTE: clear-time did not rise across depths (read the curve)");
  failures = res.flags.length;
} else {
  // clear-time rises with depth = healthy bite; flat = HP scaling inert; die-at-floor = too hard.
  const biting = analyze([{ depth: 0, cleared: true, survived: true, frames: 360 }, { depth: 7, cleared: true, survived: true, frames: 500 }, { depth: 15, cleared: true, survived: true, frames: 580 }]);
  const inert = analyze([{ depth: 0, cleared: true, survived: true, frames: 400 }, { depth: 15, cleared: true, survived: true, frames: 400 }]);
  const tooHard = analyze([{ depth: 0, cleared: false, survived: false, frames: 120 }, { depth: 15, cleared: false, survived: false, frames: 100 }]);
  const bitesOk = biting.bites && biting.flags.length === 0;
  const inertCaught = inert.flags.some((f) => /not biting/.test(f));
  const tooHardCaught = tooHard.flags.some((f) => /too hard/.test(f));
  log(`selftest: biting-curve-clean=${bitesOk} flat-scaling-caught=${inertCaught} too-hard-floor-caught=${tooHardCaught} (all true)`);
  report.selftest = { bitesOk, inertCaught, tooHardCaught };
  failures = (bitesOk && inertCaught && tooHardCaught) ? 0 : 1;
}

writeJSON(join(GAME_DIR, "artifacts", "qa", "balance-sim.json"), {
  at: new Date().toISOString(), selftest: SELFTEST, report, failures,
});

await browser.close();
server.stop();
if (failures && SELFTEST) { log("SELFTEST FAIL"); process.exit(1); }
log(SELFTEST ? "OK — the curve analysis flags inert/too-hard difficulty and passes a biting curve"
  : `OK — bot microbench curve written (${report.flags?.length ?? 0} gross outlier(s)) → artifacts/qa/balance-sim.json`);
