// BALANCE / DIFFICULTY-CURVE ORACLE — pure-function invariants over the exposed
// difficultyFor(depth) ladder. No pixels, no drive: the Ascension curve must be
// monotonic (harder with depth), bounded per step (no absurd cliffs), and never
// zero out heals (an un-survivable floor). Catches a mis-ordered or unbounded
// tuning table — the class scripted "balance" smokes touch but never assert.
//
//   node scripts/qa/balance.mjs             audit the difficulty ladder
//   node scripts/qa/balance.mjs --selftest  fault-proof: the SAME invariant checks
//                                           run on a fabricated bad series (inverted
//                                           monotonicity, zero heal, a cliff) must
//                                           each fire
//
// Exit = violation count.
import { join } from "node:path";
import {
  launchBrowser, bootGame, writeJSON, ensureServer, guard, GAME_DIR,
} from "../loop/lib.mjs";
import cfg from "./qa.config.mjs";

guard({ name: "qa-balance", maxMinutes: 5 });
const SELFTEST = process.argv.includes("--selftest");
const S = cfg.seam;
const BAL = cfg.balance ?? { maxStepMult: 0.6, minHeal: 0.05 };
const log = (...a) => console.log("[balance]", ...a);

/** The invariant checks — pure over a series of difficulty rows. Reused by the
 *  selftest against a fabricated bad series so the checker itself is proven. */
function check(rows, opts) {
  const V = [];
  const mono = ["enemyHpMult", "bossHpMult", "enemyDmgMult"]; // must not DECREASE with depth
  for (let i = 1; i < rows.length; i++) {
    for (const k of mono) {
      if (rows[i][k] < rows[i - 1][k] - 1e-9) V.push(`${k} decreased at depth ${i} (${rows[i - 1][k]} → ${rows[i][k]})`);
      if (rows[i][k] - rows[i - 1][k] > opts.maxStepMult + 1e-9) V.push(`${k} jumped ${(rows[i][k] - rows[i - 1][k]).toFixed(2)} > ${opts.maxStepMult} at depth ${i} (a cliff)`);
    }
    if (rows[i].healMult < opts.minHeal) V.push(`healMult ${rows[i].healMult} < ${opts.minHeal} at depth ${i} — heals effectively removed`);
  }
  // depth 0 baseline sanity
  if (rows[0] && (rows[0].enemyHpMult < 1 - 1e-9 || rows[0].healMult < opts.minHeal)) V.push(`depth-0 baseline out of range (hp ${rows[0].enemyHpMult}, heal ${rows[0].healMult})`);
  return V;
}

const server = await ensureServer({ log });
const { browser, page } = await launchBrowser();
await bootGame(page);

let failures = 0;
const violations = [];

if (!SELFTEST) {
  const rows = await page.evaluate(`(() => {
    const g = window.${S}gen; const max = g.MAX_DEPTH;
    const out = [];
    for (let d = 0; d <= max; d++) {
      const x = g.difficultyFor(d);
      out.push({ depth: d, enemyHpMult: x.enemyHpMult, bossHpMult: x.bossHpMult, enemyDmgMult: x.enemyDmgMult, healMult: x.healMult, extraEnemies: x.extraEnemies });
    }
    return out;
  })()`);
  log(`ladder: depth 0..${rows.length - 1} — hp ${rows[0].enemyHpMult}→${rows[rows.length - 1].enemyHpMult}, dmg ${rows[0].enemyDmgMult}→${rows[rows.length - 1].enemyDmgMult}, heal ${rows[0].healMult}→${rows[rows.length - 1].healMult}`);
  violations.push(...check(rows, BAL));
  for (const v of violations) log(`  BALANCE: ${v}`);
  failures = violations.length;
} else {
  // Prove the checker on a fabricated bad series: monotonicity inverted, a heal
  // zeroed, a cliff introduced. All three must be flagged.
  const good = [
    { enemyHpMult: 1, bossHpMult: 1, enemyDmgMult: 1, healMult: 1 },
    { enemyHpMult: 1.1, bossHpMult: 1.1, enemyDmgMult: 1.1, healMult: 0.9 },
    { enemyHpMult: 1.2, bossHpMult: 1.2, enemyDmgMult: 1.2, healMult: 0.8 },
  ];
  const goodV = check(good, BAL);
  log(`selftest clean series: ${goodV.length} violation(s) (must be 0)`);
  if (goodV.length) failures++;
  const invert = check([good[0], { enemyHpMult: 0.5, bossHpMult: 1.1, enemyDmgMult: 1.1, healMult: 0.9 }], BAL);
  const zeroHeal = check([good[0], { enemyHpMult: 1.1, bossHpMult: 1.1, enemyDmgMult: 1.1, healMult: 0 }], BAL);
  const cliff = check([good[0], { enemyHpMult: 3.0, bossHpMult: 1.1, enemyDmgMult: 1.1, healMult: 0.9 }], BAL);
  const gotInvert = invert.some((v) => /decreased/.test(v));
  const gotZero = zeroHeal.some((v) => /heals effectively removed/.test(v));
  const gotCliff = cliff.some((v) => /cliff/.test(v));
  log(`selftest: inversion=${gotInvert} zero-heal=${gotZero} cliff=${gotCliff}`);
  if (!(gotInvert && gotZero && gotCliff)) failures++;
}

writeJSON(join(GAME_DIR, "artifacts", "qa", "balance.json"), {
  at: new Date().toISOString(), selftest: SELFTEST, violations, failures,
});

await browser.close();
server.stop();
if (failures) { log(`FAIL — ${failures}`); process.exit(Math.min(failures, 99)); }
log(SELFTEST ? "OK — the balance invariants fire on inverted/zeroed/cliffed curves" : "OK — the difficulty ladder is monotonic, bounded, and never zeroes heals");
