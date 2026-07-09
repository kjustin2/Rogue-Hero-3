// BALANCE LEDGER — "do the upgrades matter and are they balanced?" as measured
// numbers, not opinion. Card damage lives inside each dispatch body (not a data
// field), so MEASURE it: cast every card at high-HP dummies with tempo reset to
// neutral (all damage multipliers = 1.0) and read the `stats.damageDealt` delta;
// step 3s after each cast so DoT/meteor/bleed cards resolve fully. Then a pure
// analysis: per-card DPS (damage ÷ cooldown), honed-vs-base EFFECTIVE-dps (honed is
// −30% cooldown, so equal damage is already 1.43× — a honed upgrade below ~1.15×
// actually got WORSE), and outlier flags among the damage cards (overtuned /
// undertuned vs the peer median). Utility cards (heal/shield/mobility, ~0 measured
// damage) are listed but excluded from the DPS outlier math. The AI reads this
// table for a ranked balance report (Phase 4d).
//
//   node scripts/qa/balance-ledger.mjs             measure + analyze the card ledger
//   node scripts/qa/balance-ledger.mjs --selftest  fault-proof: the pure analysis
//                                                  flags a fabricated overtuned card +
//                                                  a fabricated weak upgrade; a
//                                                  balanced table stays quiet
//
// Exit = flagged-card count (report, not a hard gate — tuning is the owner's call).
import { join } from "node:path";
import {
  launchBrowser, bootGame, enterRun, gotoScenario, writeJSON, ensureServer, guard, GAME_DIR,
} from "../loop/lib.mjs";
import cfg from "./qa.config.mjs";

guard({ name: "qa-balance-ledger", maxMinutes: 12 });
const SELFTEST = process.argv.includes("--selftest");
const S = cfg.seam;
const BL = cfg.balanceLedger ?? {
  dmgFloor: 5,        // below this measured damage = utility card (excluded from DPS math)
  settleFrames: 180,  // 3s @60 — let DoT / meteors / bleeds resolve
  honedCdFactor: 0.7, // honed = −30% cooldown (CLAUDE.md); equal dmg ⇒ 1/0.7 = 1.43× dps
  overFactor: 2.5,    // dps > median × this = OVERTUNED
  underFactor: 3.0,   // dps < median ÷ this = UNDERTUNED
  weakUpgrade: 1.15,  // honed effective-dps ratio below this = WEAK/negative upgrade
  // Cards whose VALUE isn't direct dps — excluded from the dps peer group + outlier
  // math (a tempo-steal / summon / lifesteal / mobility card SHOULD read low-dps).
  utilityTags: ["heal", "guard", "mobility", "summon"],
};
const log = (...a) => console.log("[balance-ledger]", ...a);

/** PURE analysis over measured rows [{id, base, honed, cooldown, tempo}] (reused by
 *  the selftest). Returns { rows: enriched, flags: [...] }. */
function analyze(rows, o) {
  const utility = new Set(o.utilityTags ?? []);
  const isDamageCard = (r) => r.base >= o.dmgFloor && !(r.tags ?? []).some((t) => utility.has(t));
  const dmg = rows.filter(isDamageCard);
  const dpsList = dmg.map((r) => r.base / r.cooldown).sort((a, b) => a - b);
  const median = dpsList.length ? dpsList[Math.floor(dpsList.length / 2)] : 0;
  const flags = [];
  const enriched = rows.map((r) => {
    const isDmg = isDamageCard(r);
    const dps = r.base / r.cooldown;
    // honed effective dps folds in the −30% cooldown; ratio<1 means honed is weaker.
    const honedEffDps = r.honed / (r.cooldown * o.honedCdFactor);
    const honedRatio = dps > 0 ? honedEffDps / dps : 1;
    const row = { ...r, dps: +dps.toFixed(2), honedRatio: +honedRatio.toFixed(2), kind: isDmg ? "damage" : "utility" };
    if (isDmg) {
      if (dps > median * o.overFactor) flags.push({ id: r.id, flag: "OVERTUNED", detail: `dps ${dps.toFixed(1)} > ${(median * o.overFactor).toFixed(1)} (${(dps / median).toFixed(1)}× median)` });
      else if (dps < median / o.underFactor) flags.push({ id: r.id, flag: "UNDERTUNED", detail: `dps ${dps.toFixed(1)} < ${(median / o.underFactor).toFixed(1)} (median ${median.toFixed(1)})` });
      if (honedRatio < o.weakUpgrade) flags.push({ id: r.id, flag: "WEAK-UPGRADE", detail: `honed effective-dps only ${honedRatio.toFixed(2)}× base (−30% cd alone gives 1.43×)` });
    }
    return row;
  });
  return { median: +median.toFixed(2), rows: enriched, flags };
}

const server = await ensureServer({ log });
const { browser, page } = await launchBrowser();
await bootGame(page);

let failures = 0;
const report = {};

if (!SELFTEST) {
  await enterRun(page);
  await gotoScenario(page, "room:combat", { settle: 1000 });
  // Measure each card's total output at neutral tempo (all mults = 1.0), no relics.
  const measured = await page.evaluate(`(() => {
    const c = window.${S}, d = window.${S}debug;
    d.godmode();
    const rows = [];
    const dummies = () => { c.enemies.clearNonBosses(); const p = c.player.pos;
      for (const [dx,dz] of [[2,0],[-2,1],[0,2],[2,2],[-2,-2],[0,-2]]) { try { c.enemies.spawn("husk", p.x+dx, p.z+dz, 0); } catch {} }
      for (const e of c.enemies.living()) if (e.kind !== "boss") { e.hp = 1e7; e.maxHp = 1e7; } d.frames(4, 1/60); };
    const castMeasure = (def, upgraded) => {
      c.tempo.crash(50);            // neutral zone (damageMult 1.0), crescendo cleared
      dummies();
      const before = c.stats.damageDealt;
      try { c.caster.cast(def, upgraded); } catch {}
      d.frames(${BL.settleFrames}, 1/60);  // resolve DoT / meteors / bleeds
      return c.stats.damageDealt - before;
    };
    for (const def of window.${S}cards) {
      const base = castMeasure(def, false);
      const honed = castMeasure(def, true);
      rows.push({ id: def.id, base: +base.toFixed(1), honed: +honed.toFixed(1), cooldown: def.cooldown, tempo: def.tempo, tags: def.tags || [] });
    }
    return rows;
  })()`);
  const res = analyze(measured, BL);
  report.median = res.median; report.rows = res.rows; report.flags = res.flags;
  const dmgN = res.rows.filter((r) => r.kind === "damage").length;
  log(`measured ${measured.length} cards (${dmgN} damage, ${measured.length - dmgN} utility) — median dps ${res.median}`);
  for (const f of res.flags) log(`  ${f.flag}: ${f.id} — ${f.detail}`);
  log(res.flags.length ? `${res.flags.length} card(s) flagged for review (report, not a gate)` : "no card-balance outliers");
  failures = res.flags.length;
} else {
  // Balanced base table (all ~equal dps, honed = +40% dmg so effective ratio ~2×),
  // then inject one overtuned card + one weak upgrade; the analysis must flag both.
  const good = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, base: 20, honed: 28, cooldown: 6, tempo: 6 }));
  const clean = analyze(good, BL).flags;
  // "regress" = honed damage DROPPED (12 < 20) so even the −30% cd can't save it
  // (12/4.2 = 2.86 effective vs 3.33 base = 0.86× → a real non-upgrade). An equal-
  // damage honed would be 1.43× and correctly NOT flagged.
  const bad = [...good.map((r) => ({ ...r })), { id: "nuke", base: 300, honed: 420, cooldown: 6, tempo: 6 }, { id: "regress", base: 20, honed: 12, cooldown: 6, tempo: 6 }];
  const badFlags = analyze(bad, BL).flags;
  const gotOver = badFlags.some((f) => f.id === "nuke" && f.flag === "OVERTUNED");
  const gotWeak = badFlags.some((f) => f.id === "regress" && f.flag === "WEAK-UPGRADE");
  log(`selftest: clean-table flags=${clean.length} (0) overtuned-caught=${gotOver} weak-upgrade-caught=${gotWeak}`);
  report.selftest = { clean: clean.length, gotOver, gotWeak };
  failures = (clean.length === 0 && gotOver && gotWeak) ? 0 : 1;
}

writeJSON(join(GAME_DIR, "artifacts", "qa", "balance-ledger.json"), {
  at: new Date().toISOString(), selftest: SELFTEST, report, failures,
});

await browser.close();
server.stop();
if (failures && SELFTEST) { log("SELFTEST FAIL"); process.exit(1); }
log(SELFTEST ? "OK — the ledger analysis flags an overtuned card and a weak upgrade, quiet when balanced"
  : `OK — card ledger written (${report.flags?.length ?? 0} flagged for review) → artifacts/qa/balance-ledger.json`);
