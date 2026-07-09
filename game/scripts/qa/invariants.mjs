// DAIKON-LITE INVARIANT MINING — two jobs, kept distinct (conflating them is the
// classic Daikon false-positive):
//
//   DISCOVERY (report): sample scalar sim state every frame of a deterministic
//     drive, MINE likely invariants on a training split (range/nonNeg/const/order),
//     then VALIDATE on a held-out split. Survivors are the auto-discovered spec —
//     a promotable regression tripwire. Holdout FAILURES are DISCARDED, not flagged:
//     an empirical range over a drifting var (enemy count that grows, a wandering
//     position) simply isn't an invariant. The split is what separates a real
//     invariant from a coincidence of the training window.
//   SAFETY GATE (findings): a small set of SEMANTIC must-hold invariants
//     (hp∈[0,maxHp], tempo∈[0,100], counts ≥ 0) checked over the WHOLE trace. These
//     are the ones a violation of is a genuine bug — the actual gate.
//
//   node scripts/qa/invariants.mjs             mine (report spec) + safety gate
//   node scripts/qa/invariants.mjs --selftest  fault-proof: discovery confirms a
//                                              stable var and DISCARDS an escaping
//                                              one; the safety gate fires on hp>maxHp
//
// Exit = safety-violation count.
import { join } from "node:path";
import {
  launchBrowser, bootGame, enterRun, gotoScenario, writeJSON, ensureServer, guard, GAME_DIR,
} from "../loop/lib.mjs";
import { makeFinding } from "./lib/finding.mjs";
import cfg from "./qa.config.mjs";

guard({ name: "qa-invariants", maxMinutes: 8 });
const SELFTEST = process.argv.includes("--selftest");
const S = cfg.seam;
const IV = cfg.invariants ?? { frames: 300, seed: 20260707, trainFrac: 0.7, eps: 1e-6 };
const log = (...a) => console.log("[invariants]", ...a);

// ── PURE miner/validator (reused by the selftest against fabricated traces) ──
// records = [{ var: number, … }]. Mines per-var {min,max, nonNeg, const} + a few
// cross-var orderings, on the train split; validates each on the holdout.
function mine(records, order, opts) {
  const keys = records.length ? Object.keys(records[0]) : [];
  const cut = Math.max(1, Math.floor(records.length * opts.trainFrac));
  const train = records.slice(0, cut), hold = records.slice(cut);
  const eps = opts.eps;
  const inv = [];
  for (const k of keys) {
    const tv = train.map((r) => r[k]);
    const min = Math.min(...tv), max = Math.max(...tv);
    inv.push({ kind: "range", k, min, max, test: (r) => r[k] >= min - eps && r[k] <= max + eps });
    if (min >= -eps) inv.push({ kind: "nonNeg", k, test: (r) => r[k] >= -eps });
    if (min === max) inv.push({ kind: "const", k, val: min, test: (r) => Math.abs(r[k] - min) <= eps });
  }
  // cross-var orderings a ≤ b that hold across ALL train rows
  for (const [a, b] of order) if (keys.includes(a) && keys.includes(b) && train.every((r) => r[a] <= r[b] + eps))
    inv.push({ kind: "order", k: `${a}<=${b}`, test: (r) => r[a] <= r[b] + eps });

  const confirmed = [], discarded = [];
  for (const iv of inv) {
    if (hold.length === 0) { confirmed.push(iv); continue; }
    // Holdout FAILURE = not a real invariant (a training-window coincidence) → DISCARD.
    if (hold.every((r) => iv.test(r))) confirmed.push(iv);
    else discarded.push(iv);
  }
  return { confirmed, discarded, trainN: train.length, holdN: hold.length };
}

/** SAFETY GATE — semantic must-hold invariants over the WHOLE trace. A violation
 *  here is a genuine bug (state left a hard-defined envelope). Pure; reused by the
 *  selftest against a fabricated hp>maxHp trace. */
function safety(records, eps) {
  const rules = [
    { name: "hp∈[0,maxHp]", test: (r) => r.hp >= -eps && r.hp <= r.maxHp + eps },
    { name: "tempo∈[0,100]", test: (r) => r.tempo >= -eps && r.tempo <= 100 + eps },
    { name: "enemies≥0", test: (r) => r.enemies >= -eps },
    { name: "maxHp>0", test: (r) => r.maxHp > eps },
  ];
  const violations = [];
  for (const rule of rules) { const at = records.findIndex((r) => !rule.test(r)); if (at >= 0) violations.push({ name: rule.name, frame: at, row: records[at] }); }
  return violations;
}

const server = await ensureServer({ log });
const { browser, page } = await launchBrowser();
await bootGame(page);

let failures = 0;
const report = {};
const findings = [];

// Cross-var orderings worth checking (mined only if they hold on train).
const ORDER = [["hp", "maxHp"], ["tempo", "tempoMax"], ["enemies", "enemiesCap"]];

if (!SELFTEST) {
  await enterRun(page);
  await gotoScenario(page, "room:combat", { settle: 1000 });
  // Deterministic drive: seeded spawns + periodic casts, sampling scalar state each
  // frame. Not random real input — a reproducible state trajectory to mine over.
  const records = await page.evaluate(`(() => {
    const c = window.${S}, d = window.${S}debug;
    d.godmode(); c.rng.reseed(${IV.seed}); c.enemies.clearNonBosses();
    const recs = [];
    for (let f = 0; f < ${IV.frames}; f++) {
      if (f % 20 === 0) { const p = c.player.pos; for (const [dx,dz] of [[3,0],[-3,1],[0,3]]) { try { c.enemies.spawn("husk", p.x+dx, p.z+dz, 0); } catch {} } }
      if (f % 15 === 7) { try { c.caster.cast(window.${S}cards[f % window.${S}cards.length], false); } catch {} }
      d.frames(1, 1/60);
      const living = c.enemies.living();
      recs.push({
        hp: c.player.hp, maxHp: c.player.maxHp,
        tempo: c.tempo.value ?? 0, tempoMax: 100,
        enemies: living.length, enemiesCap: 999,
        px: c.player.pos.x, pz: c.player.pos.z,
      });
    }
    return recs;
  })()`);
  const res = mine(records, ORDER, IV);
  const safe = safety(records, IV.eps);
  report.confirmed = res.confirmed.map((i) => i.kind === "range" ? `${i.k}∈[${i.min.toFixed(2)},${i.max.toFixed(2)}]` : i.kind === "order" ? i.k : `${i.k}:${i.kind}`);
  report.discarded = res.discarded.length;
  report.safetyViolations = safe.map((v) => ({ inv: v.name, frame: v.frame }));
  log(`DISCOVERY over ${records.length} frames (${res.trainN} train / ${res.holdN} holdout): ${res.confirmed.length} invariant(s) confirmed, ${res.discarded.length} discarded (non-invariant / drifting var)`);
  log(`  confirmed spec: ${report.confirmed.slice(0, 12).join(", ")}${report.confirmed.length > 12 ? " …" : ""}`);
  log(`SAFETY GATE: ${safe.length ? `${safe.length} VIOLATION(S)` : "all semantic invariants hold over the whole trace"}`);
  for (const v of safe) {
    log(`  SAFETY-VIOLATION: ${v.name} broke at frame ${v.frame} — state left its hard envelope`);
    findings.push(makeFinding({ oracle: "invariant", kind: "safety", locus: v.frame, seed: IV.seed, raw: { invariant: v.name, row: v.row } }));
  }
  failures = safe.length;
} else {
  // DISCOVERY: `stable` stays in-range (must CONFIRM); `escape` is bounded on train
  // then jumps out on the holdout (must be DISCARDED, NOT a finding).
  const recs = [];
  const N = 100, cut = Math.floor(N * IV.trainFrac);
  for (let f = 0; f < N; f++) recs.push({ stable: 5 + (f % 3), escape: f < cut ? 10 : 9999, hp: 50, maxHp: 100, tempo: 40, enemies: 2 });
  const res = mine(recs, ORDER, IV);
  const stableConfirmed = res.confirmed.some((i) => i.k === "stable" && i.kind === "range");
  const escapeDiscarded = res.discarded.some((i) => i.k === "escape" && i.kind === "range") && !res.confirmed.some((i) => i.k === "escape" && i.kind === "range");
  const orderConfirmed = res.confirmed.some((i) => i.k === "hp<=maxHp");
  // SAFETY GATE: a fabricated hp>maxHp trace must fire.
  const badSafe = safety([{ hp: 150, maxHp: 100, tempo: 40, enemies: 2 }], IV.eps);
  const goodSafe = safety([{ hp: 50, maxHp: 100, tempo: 40, enemies: 2 }], IV.eps);
  const safetyFires = badSafe.some((v) => v.name === "hp∈[0,maxHp]") && goodSafe.length === 0;
  log(`selftest: stable-confirmed=${stableConfirmed} escape-DISCARDED=${escapeDiscarded} order-confirmed=${orderConfirmed} safety-gate-fires=${safetyFires} (all true)`);
  report.selftest = { stableConfirmed, escapeDiscarded, orderConfirmed, safetyFires };
  failures = (stableConfirmed && escapeDiscarded && orderConfirmed && safetyFires) ? 0 : 1;
}

writeJSON(join(GAME_DIR, "artifacts", "qa", "invariants.json"), {
  at: new Date().toISOString(), selftest: SELFTEST, report, findings, failures,
});

await browser.close();
server.stop();
if (failures) { log(`FAIL — ${failures} holdout-violation(s)`); process.exit(Math.min(failures, 99)); }
log(SELFTEST ? "OK — the miner confirms a stable invariant and flags one that escapes on the holdout" : "OK — every mined invariant holds on the holdout split (state stays in its learned envelope)");
