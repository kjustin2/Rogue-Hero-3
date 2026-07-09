// DIFFERENTIAL RECORD-REPLAY — the cross-build regression backbone. Phase 1 made
// the sim bit-deterministic within a build; this pins a COMMITTED golden simHash
// trace (fixed seed + fixed tape) and, on every later build, replays the same tape
// and diffs frame-by-frame. Any divergence = the sim behaves differently than when
// the golden was blessed — an unintended behavior change (a refactor that shifted
// an RNG draw, a tuning edit that altered combat resolution). Intended changes are
// re-blessed with --bless. The first diverging frame + the golden's commit are the
// git-bisect attribution anchor.
//
//   node scripts/qa/differential.mjs             replay vs the committed golden
//   node scripts/qa/differential.mjs --bless      (re)record the golden — after an
//                                                 INTENDED sim change; commit it
//   node scripts/qa/differential.mjs --selftest   fault-proof: a one-extra-draw
//                                                 replay must diverge at the exact
//                                                 frame; an identical replay matches
//
// Exit = 1 on divergence (or missing golden), 0 clean.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import {
  launchBrowser, bootGame, enterRun, gotoScenario, writeJSON, ensureServer, guard, GAME_DIR,
} from "../loop/lib.mjs";
import { makeFinding, gameCommit } from "./lib/finding.mjs";
import cfg from "./qa.config.mjs";

guard({ name: "qa-differential", maxMinutes: 8 });
const BLESS = process.argv.includes("--bless");
const SELFTEST = process.argv.includes("--selftest");
const S = cfg.seam;
const D = cfg.differential ?? {
  seed: 20260707, frames: 150,
  spawn: [["husk", -6, -3], ["caster", 6, -3], ["leaper", 3, 7], ["brute", -4, 5]],
  scenario: "enemy:husk",
};
const GOLDEN = join(GAME_DIR, "scripts", "qa", "golden", "differential.json");
const log = (...a) => console.log("[differential]", ...a);

// The replay tape — identical substrate to the determinism golden-trace: banish the
// wave director (enemy:husk), clear lesser + pending, reseed, spawn, step+hash.
// skewAt injects ONE extra rng draw at a frame (the selftest's divergence fault).
const TAPE = (opts = {}) => `(async () => {
  const c = window.${S}, d = window.${S}debug;
  const skewAt = ${opts.skewAt ?? -1};
  c.enemies.clearNonBosses();
  d.frames(2, 1/60);
  c.rng.reseed(${D.seed});
  for (const [kind, x, z] of ${JSON.stringify(D.spawn)}) { try { c.enemies.spawn(kind, x, z, 0); } catch {} }
  const hashes = [];
  for (let f = 0; f < ${D.frames}; f++) {
    if (f === skewAt) c.rng.next();   // one extra draw → stream diverges here on
    d.frames(1, 1/60);
    hashes.push(d.simHash());
  }
  return hashes;
})()`;

// A FRESH page per replay is essential — re-staging in one page carries the prior
// replay's wave-director / rng-cursor state and diverges at frame 0 (same fix as
// the determinism golden-trace). Reload → boot → enter → stage the banished-boss
// holding room, then run the tape.
async function replay(page, opts = {}) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await bootGame(page);
  await enterRun(page);
  await gotoScenario(page, D.scenario, { settle: 2200 });
  return page.evaluate(TAPE(opts));
}

/** PURE first-divergence finder (reused by the selftest). */
function firstDivergence(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n; // -1 = identical; n = one is a prefix
}

const server = await ensureServer({ log });
const { browser, page } = await launchBrowser();
await bootGame(page);
await enterRun(page);

let failures = 0;
const report = {};
const findings = [];

if (SELFTEST) {
  const base = await replay(page);
  const same = await replay(page);
  const skew = await replay(page, { skewAt: 40 });
  const dSame = firstDivergence(base, same);
  const dSkew = firstDivergence(base, skew);
  log(`selftest: identical-replay divergence=${dSame} (want -1); one-extra-draw@40 divergence=${dSkew} (want 40)`);
  report.selftest = { dSame, dSkew };
  failures = (dSame === -1 && dSkew === 40) ? 0 : 1;
} else if (BLESS) {
  const hashes = await replay(page);
  mkdirSync(dirname(GOLDEN), { recursive: true });
  writeFileSync(GOLDEN, JSON.stringify({ blessed: gameCommit(), seed: D.seed, frames: D.frames, scenario: D.scenario, hashes }, null, 0) + "\n");
  log(`BLESSED golden at commit ${gameCommit()} — ${hashes.length} frames. Commit scripts/qa/golden/differential.json.`);
} else {
  const hashes = await replay(page);
  if (!existsSync(GOLDEN)) {
    log(`no golden yet — run \`npm run qa:differential-bless\` and commit it. (recording skipped to keep the repo change explicit)`);
    report.status = "NO-GOLDEN";
    failures = 1;
  } else {
    const golden = JSON.parse(readFileSync(GOLDEN, "utf8"));
    const at = firstDivergence(golden.hashes, hashes);
    report.blessedAt = golden.blessed; report.now = gameCommit(); report.divergedAt = at;
    if (at === -1) log(`MATCH — ${hashes.length} frames identical to the golden blessed at ${golden.blessed}`);
    else {
      log(`DIVERGENCE at frame ${at} — the sim changed since the golden was blessed (${golden.blessed} → ${gameCommit()})`);
      log(`  golden[${at}]=${golden.hashes[at]} now=${hashes[at]} — if intended, re-bless; else bisect ${golden.blessed}..HEAD`);
      findings.push(makeFinding({
        oracle: "differential", kind: "sim-divergence", locus: at, seed: D.seed,
        replay: { seed: D.seed, scenario: D.scenario, tape: `${D.frames} frames`, settleFrames: 800 },
        raw: { blessedAt: golden.blessed, now: gameCommit(), goldenHash: golden.hashes[at], nowHash: hashes[at] },
      }));
      failures = 1;
    }
  }
}

writeJSON(join(GAME_DIR, "artifacts", "qa", "differential.json"), {
  at: new Date().toISOString(), selftest: SELFTEST, bless: BLESS, report, findings, failures,
});

await browser.close();
server.stop();
if (failures) { log(`FAIL — ${failures}`); process.exit(1); }
log(SELFTEST ? "OK — divergence is detected at the exact frame; identical replays match" : BLESS ? "OK — golden recorded" : "OK — sim replay matches the committed golden");
