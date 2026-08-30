// SEEDED CHAOS BOT — random real inputs under spawn pressure, with invariant
// ORACLES polled the whole time. Finds the bug classes scripted smokes can't:
// NaN positions, out-of-bounds walks, HP-range violations, soft-locks (moving
// but not moving; playing but nothing progresses), swallowed frame errors.
//
//   node scripts/qa/chaos.mjs [--seconds 45] [--seed 123]
//
// Everything game-specific comes from qa.config.mjs. Inputs are REAL key/mouse
// dispatch (input-path coverage), not direct sim calls. Heal top-ups keep the
// run alive WITHOUT god-mode so the damage pipeline stays live. Violations
// screenshot to shots/chaos/ and land in artifacts/qa/chaos.json.
// Exit code = number of violations.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  launchBrowser, bootGame, enterRun, sleep, writeJSON, ensureServer, guard, GAME_DIR,
} from "../loop/lib.mjs";
import cfg from "./qa.config.mjs";

const ARGS = process.argv.slice(2);
const val = (f, d) => (ARGS.includes(f) ? ARGS[ARGS.indexOf(f) + 1] : d);
const SECONDS = Number(val("--seconds", cfg.chaos.seconds));
const SEED = Number(val("--seed", cfg.chaos.seed));
guard({ name: "qa-chaos", maxMinutes: Math.ceil(SECONDS / 60) + 6 });

const S = cfg.seam;
const SHOTS = join(GAME_DIR, "shots", "chaos");
mkdirSync(SHOTS, { recursive: true });
const log = (...a) => console.log("[chaos]", ...a);

// Deterministic PRNG — same seed, same drive.
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];

const server = await ensureServer({ log });
const { browser, page, errors } = await launchBrowser();
const violations = [];
let shotN = 0;

async function violate(type, detail) {
  violations.push({ t: Date.now() - t0, type, detail });
  log(`VIOLATION ${type}: ${detail}`);
  try { await page.screenshot({ path: join(SHOTS, `${String(++shotN).padStart(2, "0")}-${type}.png`) }); } catch { /* best effort */ }
}

// Compact oracle snapshot — one evaluate per poll, primitives only.
const snap = () => page.evaluate(`(()=>{
  const c = window.${S}; if (!c || !c.player) return null;
  const p = c.player;
  return {
    ui: window.${S}state ? window.${S}state() : "?",
    x: p.pos.x, z: p.pos.z, hp: p.hp, maxHp: p.maxHp, alive: p.alive, pr: p.radius,
    obs: c.arena ? c.arena.obstacles.map(o => [o.x, o.z, o.r]) : [],
    tempo: c.tempo ? c.tempo.value : 0,
    kills: c.stats ? c.stats.kills : 0,
    dmgDealt: c.stats ? c.stats.damageDealt : 0,
    rooms: c.stats ? c.stats.roomsCleared : 0,
    enemies: c.enemies ? c.enemies.living().length : 0,
    ferr: (window.${S}debug && window.${S}debug.frameErrors) ? window.${S}debug.frameErrors().length : 0,
  };
})()`);

// UI unstick: skip stories, take drafts, pick map forks — the minimum flow-bot
// to get back into `playing`.
async function unstick() {
  for (const sel of [".story-skip", ".card", ".mapnode"]) {
    try {
      const loc = page.locator(sel);
      if (await loc.count()) { await loc.first().click(); await sleep(350); return; }
    } catch { /* overlay may vanish mid-click */ }
  }
  try { await page.keyboard.press("Space"); } catch { /* ignore */ }
  await sleep(300);
}

await bootGame(page);
await enterRun(page);
log(`drive: ${SECONDS}s, seed ${SEED}`);

const t0 = Date.now();
const deadline = t0 + SECONDS * 1000;
let heldMove = null;                       // move key currently down
let lastSpawn = 0, lastHeal = 0, lastScene = 0, lastPush = 0;
let ferrReported = false, sceneReported = false;
// programs must stay FLAT after warm-up — growth = a first-use shader compile
// the warm-up missed (the hitch class), a deterministic counter immune to timing.
const progBase = await page.evaluate(`window.${S}perf ? window.${S}perf.report().snap.programs : -1`);
// stuck-while-moving oracle: displacement over a window of held movement
let stuckWin = null;                       // { x0, z0, heldMs, lastAt }
// no-progress oracle: state hash unchanged for too long while playing + driving
let progHash = "", progAt = Date.now();
let notPlayingSince = null;

try {
  while (Date.now() < deadline) {
    const s = await snap();
    if (!s) { await violate("NO-SEAM", `window.${S} missing/incomplete`); break; }

    if (s.ui !== "playing") {
      if (heldMove) { try { await page.keyboard.up(heldMove); } catch { /* ignore */ } heldMove = null; }
      notPlayingSince ??= Date.now();
      if (Date.now() - notPlayingSince > 20000) {
        await violate("SOFT-LOCK-UI", `stuck in ui="${s.ui}" for 20s despite unstick clicks`);
        notPlayingSince = Date.now(); // report at most every 20s
      }
      await unstick();
      continue;
    }
    notPlayingSince = null;

    // ── oracles ──────────────────────────────────────────────────────────
    if (![s.x, s.z, s.hp, s.tempo].every(Number.isFinite)) {
      await violate("NAN", `x=${s.x} z=${s.z} hp=${s.hp} tempo=${s.tempo}`);
      break; // NaN propagates — later polls are noise
    }
    if (Math.abs(s.x) > cfg.chaos.bounds || Math.abs(s.z) > cfg.chaos.bounds) {
      await violate("OUT-OF-BOUNDS", `player at (${s.x.toFixed(1)}, ${s.z.toFixed(1)}), bound ${cfg.chaos.bounds}`);
    }
    if (s.hp < -1e-6 || s.hp > s.maxHp + 1e-6) {
      await violate("HP-RANGE", `hp=${s.hp} of ${s.maxHp}`);
    }
    if (s.tempo < -1e-6 || s.tempo > 100 + 1e-6) {
      await violate("TEMPO-RANGE", `tempo=${s.tempo}`);
    }
    // NO-CLIP: a grounded mover is never inside a collider it's blocked by — the
    // walk-through / wedged-in-prop class (Soul's chaos oracle, ported). The 0.6
    // epsilon tolerates transient grazing during a shove; a real wedge sits deeper.
    const clip = s.obs.find(([ox, oz, or]) => Math.hypot(s.x - ox, s.z - oz) < or + s.pr - 0.6);
    if (clip) {
      await violate("NO-CLIP", `player (${s.x.toFixed(2)}, ${s.z.toFixed(2)}) inside collider (${clip[0].toFixed(1)}, ${clip[1].toFixed(1)}, r=${clip[2]})`);
    }
    if (s.enemies > 200) await violate("ENEMY-FLOOD", `${s.enemies} living enemies`);
    if (s.ferr > 0 && !ferrReported) {
      ferrReported = true;
      const errs = await page.evaluate(`window.${S}debug.frameErrors()`);
      await violate("FRAME-ERRORS", `${s.ferr} caught in the frame loop: ${JSON.stringify(errs.slice(0, 3))}`);
    }

    // stuck-while-moving: ≥8s of held movement with <0.5 world-units displacement
    if (heldMove) {
      if (!stuckWin) stuckWin = { x0: s.x, z0: s.z, heldMs: 0, lastAt: Date.now() };
      stuckWin.heldMs += Date.now() - stuckWin.lastAt;
      stuckWin.lastAt = Date.now();
      if (stuckWin.heldMs >= 8000) {
        const disp = Math.hypot(s.x - stuckWin.x0, s.z - stuckWin.z0);
        if (disp < 0.5) await violate("STUCK", `8s of held ${heldMove}, displacement ${disp.toFixed(2)}`);
        stuckWin = null;
      }
    } else stuckWin = null;

    // PUSH-OUT (static — safe even mid-cutscene): the resolver must eject a point
    // parked at every collider's dead centre to at least the contact distance.
    // Found the "push direction (0,0) = wedged forever" class on run #1 elsewhere.
    if (Date.now() - lastPush > 10000 && s.obs.length) {
      lastPush = Date.now();
      const bad = await page.evaluate(`(()=>{
        const c = window.${S}; const R = c.player.radius; const out = [];
        for (const o of c.arena.obstacles) {
          const pos = { x: o.x, y: 0, z: o.z };
          c.arena.resolveObstacles(pos, R);
          const d = Math.hypot(pos.x - o.x, pos.z - o.z);
          if (d < o.r + R - 0.5) out.push([o.x, o.z, o.r, d]);
        }
        return out;
      })()`);
      for (const [ox, oz, or, d] of bad) {
        await violate("PUSH-OUT", `resolver left a dead-centre point at d=${d.toFixed(2)} from collider (${ox.toFixed(1)}, ${oz.toFixed(1)}, r=${or}) — the wedged class`);
      }
    }

    // scene-graph oracle every ~5s: NaN world matrices / non-finite bounds
    if (!sceneReported && Date.now() - lastScene > 5000) {
      lastScene = Date.now();
      const sc = await page.evaluate(`(window.${S}debug && window.${S}debug.sceneCheck) ? window.${S}debug.sceneCheck() : null`);
      if (sc && !sc.ok) {
        sceneReported = true;
        await violate("SCENE-NAN", `nan=${sc.nan} finiteBounds=${sc.finiteBounds} meshes=${sc.meshes}`);
      }
    }

    // no-progress: nothing observable changed for 30s of active driving
    const h = `${s.kills}|${Math.round(s.dmgDealt)}|${s.rooms}|${Math.round(s.tempo)}|${s.enemies}`;
    if (h !== progHash) { progHash = h; progAt = Date.now(); }
    else if (Date.now() - progAt > 30000) {
      await violate("NO-PROGRESS", `state hash unchanged 30s while driving (${h})`);
      progAt = Date.now();
    }

    // ── drive (seeded random real inputs) ────────────────────────────────
    const roll = rng();
    if (roll < 0.35) { // (re)hold a movement key
      if (heldMove) { try { await page.keyboard.up(heldMove); } catch { /* ignore */ } }
      heldMove = pick(cfg.chaos.moveKeys);
      try { await page.keyboard.down(heldMove); } catch { heldMove = null; }
    } else if (roll < 0.55) { // attack at a random aim point
      const x = 200 + Math.floor(rng() * 1200), y = 150 + Math.floor(rng() * 600);
      try { await page.mouse.move(x, y); await page.mouse.down(); await sleep(60); await page.mouse.up(); } catch { /* ignore */ }
    } else if (roll < 0.75) { // action key (dodge / cards)
      try { await page.keyboard.press(pick(cfg.chaos.actionKeys)); } catch { /* ignore */ }
    } // else: let it ride a beat

    // spawn pressure (values seeded node-side)
    if (Date.now() - lastSpawn > cfg.chaos.spawnEveryMs && s.enemies < cfg.chaos.maxEnemies) {
      lastSpawn = Date.now();
      const kind = pick(cfg.chaos.spawnKinds);
      const ang = rng() * Math.PI * 2;
      await page.evaluate(`(()=>{try{window.${S}.enemies.spawn(${JSON.stringify(kind)}, ${(Math.cos(ang) * 9).toFixed(2)}, ${(Math.sin(ang) * 9).toFixed(2)}, 0);}catch(e){}})()`);
    }
    // heal top-up (no god-mode — damage pipeline stays live)
    if (cfg.chaos.healEveryMs && Date.now() - lastHeal > cfg.chaos.healEveryMs) {
      lastHeal = Date.now();
      await page.evaluate(`(()=>{const p=window.${S}.player; if(p.alive) p.hp = p.maxHp;})()`);
    }

    await sleep(250);
  }
} finally {
  if (heldMove) { try { await page.keyboard.up(heldMove); } catch { /* ignore */ } }

  // ── coverage matrix + final health readbacks ───────────────────────────
  let readError = null;
  let coverage = {}, missing = [], perfSnap = null, coverageRead = false;
  try {
    coverage = await page.evaluate(`(window.${S}debug && window.${S}debug.coverage) ? window.${S}debug.coverage() : {}`);
    coverageRead = true;
    missing = cfg.coverage.required.filter((e) => !(coverage[e] > 0));
    perfSnap = await page.evaluate(`window.${S}perf ? window.${S}perf.report() : null`);
  } catch (e) { readError = String(e?.message ?? e); } // browser may be gone after a hard violation

  const progEnd = perfSnap?.snap?.programs ?? -1;
  const out = {
    at: new Date().toISOString(), seed: SEED, seconds: SECONDS,
    violations,
    consoleErrors: errors.slice(0, 20),
    // coverageRead distinguishes "every required event genuinely never fired"
    // from "the page was gone so we could not ask" — the second used to be
    // reported as the first, i.e. a full sheet of phantom untested-content gaps.
    coverage, missingCoverage: missing, coverageRead, readError,
    // >0 after warm-up = a first-use compile the warm-up missed (hitch fuel)
    programsDelta: progBase >= 0 && progEnd >= 0 ? progEnd - progBase : null,
    perf: perfSnap ? { fps: perfSnap.fps, p95: perfSnap.p95, calls: perfSnap.snap?.calls, programs: perfSnap.snap?.programs, heapMB: perfSnap.snap?.heapMB } : null,
  };
  writeJSON(join(GAME_DIR, "artifacts", "qa", "chaos.json"), out);

  log(`done — ${violations.length} violation(s), ${errors.length} console error(s)`);
  if (!coverageRead) log(`coverage NOT MEASURED — the page was unreachable at readback (${readError})`);
  else if (missing.length) log(`coverage gaps (never fired): ${missing.join(", ")}`);
  else log("coverage: all required events fired");
  await browser.close();
  if (server.owned) server.stop();
  process.exit(violations.length + (errors.length ? 1 : 0));
}
