// DODGE-WINDOW FAIRNESS — "an undodgeable attack is a bug" (a hard project rule)
// made a deterministic gate, with NO bot-skill confound. Every enemy attack
// telegraphs via ctx.tele, and a telegraph's `duration` IS the dodge window (the
// warning lead time before the strike). Telegraphs.recent records every one; this
// stages each enemy kind + each boss IN ISOLATION (so telegraphs attribute to that
// kind), drives it to attack, and asserts the minimum dodge window ≥ a floor.
// Measured RH3 floor is 0.30s across all enemies + warden; the gate sits at 0.25s
// so current design passes and a regression to an undodgeable telegraph FAILS.
//
//   node scripts/qa/fairness.mjs             audit every attack's dodge window
//   node scripts/qa/fairness.mjs --selftest  fault-proof: a 0.1s telegraph in the
//                                            list must flag UNDODGEABLE; all ≥floor clean
//
// Exit = undodgeable-attack count. "No telegraph observed" for a kind = WARN (the
// drive didn't provoke an attack — not necessarily a bug).
import { join } from "node:path";
import {
  launchBrowser, bootGame, enterRun, gotoScenario, writeJSON, ensureServer, guard, GAME_DIR,
} from "../loop/lib.mjs";
import cfg from "./qa.config.mjs";

guard({ name: "qa-fairness", maxMinutes: 14 });
const SELFTEST = process.argv.includes("--selftest");
const S = cfg.seam;
const FR = cfg.fairness ?? {
  minDodgeSec: 0.25,
  enemyKinds: ["husk", "spitter", "swarmer", "bomber", "sentinel", "wisp", "leaper",
    "tether", "mirror", "caster", "shade", "bastion", "brute", "harrier", "splitter", "voidling", "warper"],
  bosses: ["warden", "spire", "colossus", "tyrant", "unmaker"],
  enemyFrames: 700, bossFrames: 1600,
};
const log = (...a) => console.log("[fairness]", ...a);

/** PURE: durations below the floor = undodgeable (reused by the selftest). */
const undodgeable = (durs, floor) => durs.filter((d) => d < floor);

const server = await ensureServer({ log });
const { browser, page } = await launchBrowser();
await bootGame(page);

let failures = 0;
const report = { units: [], warnings: [] };

if (!SELFTEST) {
  await enterRun(page);
  const drive = async (stage, frames, isBoss) => {
    await gotoScenario(page, stage, { settle: isBoss ? 1200 : 600 });
    return page.evaluate(`(() => {
      const c = window.${S}, d = window.${S}debug; d.godmode();
      c.tele.recent.length = 0;
      if (${!isBoss}) for (const e of c.enemies.living()) if (e.kind !== "boss") { e.pos.x = c.player.pos.x + 2.2; e.pos.z = c.player.pos.z; }
      // nudge a boss through its phases so later-phase attacks also telegraph
      const b = c.enemies.living().find((e) => e.kind === "boss");
      for (let i = 0; i < ${frames}; i += 200) {
        d.frames(200, 1/60);
        if (${isBoss} && b && b.alive) try { b.takeDamage(Math.max(1, b.maxHp * 0.08)); } catch {}
      }
      return c.tele.recent.map((r) => +r.dur.toFixed(3));
    })()`);
  };

  for (const kind of FR.enemyKinds) {
    const durs = await drive(`enemy:${kind}`, FR.enemyFrames, false);
    const bad = undodgeable(durs, FR.minDodgeSec);
    const min = durs.length ? Math.min(...durs) : null;
    report.units.push({ unit: kind, telegraphs: durs.length, minDodge: min, undodgeable: bad.length });
    if (!durs.length) { report.warnings.push(kind); log(`  ${kind}: no telegraph observed in ${FR.enemyFrames}f (drive didn't provoke an attack)`); }
    else { log(`  ${kind}: ${durs.length} telegraphs, min dodge ${min}s ${bad.length ? `— ${bad.length} UNDODGEABLE (<${FR.minDodgeSec}s)` : "ok"}`); failures += bad.length; }
  }
  for (const boss of FR.bosses) {
    const durs = await drive(`boss:${boss}`, FR.bossFrames, true);
    const bad = undodgeable(durs, FR.minDodgeSec);
    const min = durs.length ? Math.min(...durs) : null;
    report.units.push({ unit: `boss:${boss}`, telegraphs: durs.length, minDodge: min, undodgeable: bad.length });
    if (!durs.length) { report.warnings.push(`boss:${boss}`); log(`  boss:${boss}: no telegraph observed`); }
    else { log(`  boss:${boss}: ${durs.length} telegraphs, min dodge ${min}s ${bad.length ? `— ${bad.length} UNDODGEABLE` : "ok"}`); failures += bad.length; }
  }
  log(`${report.units.length} units — ${failures} undodgeable attack(s), ${report.warnings.length} produced no telegraph`);
} else {
  const clean = undodgeable([0.3, 0.38, 0.55, 0.74], FR.minDodgeSec);
  const withBad = undodgeable([0.3, 0.1, 0.55], FR.minDodgeSec);
  log(`selftest: clean-list flagged=${clean.length} (0); list-with-0.1s flagged=${withBad.length} (1), value=${withBad[0]}`);
  report.selftest = { clean: clean.length, bad: withBad.length };
  failures = (clean.length === 0 && withBad.length === 1 && withBad[0] === 0.1) ? 0 : 1;
}

writeJSON(join(GAME_DIR, "artifacts", "qa", "fairness.json"), {
  at: new Date().toISOString(), selftest: SELFTEST, report, failures,
});

await browser.close();
server.stop();
if (failures) { log(`FAIL — ${failures}`); process.exit(Math.min(failures, 99)); }
log(SELFTEST ? "OK — the dodge-window check flags a sub-floor telegraph and passes dodgeable ones"
  : `OK — every observed attack has a dodge window ≥ ${FR.minDodgeSec}s`);
