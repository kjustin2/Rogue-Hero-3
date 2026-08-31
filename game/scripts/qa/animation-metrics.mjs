// ANIMATION ORACLES — foot-skate, jitter, and smoothness as MEASURED numbers
// from the seam's motion recorder, not filmstrip eyeballs. Sliding feet are the
// corpus's "#1 amateur tell", yet until now their only detector was a ~0.50-
// precision VLM reading a 3×3 grid. The motion-synthesis literature's standard
// metrics, computed from logged transforms in milliseconds:
//
//   FOOT-SKATE   horizontal displacement of a PLANTED foot (lift < threshold)
//                per meter of travel — a planted foot that translates is skating.
//   JITTER       mean |2nd difference| of player/camera position (m/s²) —
//                perception-aligned smoothness; spikes read as jank.
//   SPARC        spectral arc length of the camera speed profile — scale-free
//                smoothness; more negative = rougher (motion-rehab standard).
//
//   node scripts/qa/animation-metrics.mjs             audit locomotion
//   node scripts/qa/animation-metrics.mjs --selftest  fault-proof: dragging the
//                world-position without stepping the walk cycle MUST explode the
//                skate ratio; per-frame position jolts MUST explode jitter
//
// Drive is REAL key input + the deterministic stepper (frames()). Thresholds live
// in qa.config.mjs `animation` and were calibrated on the shipped locomotion —
// document any rebase. Exit code = finding/failure count.
import { join } from "node:path";
import {
  launchBrowser, bootGame, enterRun, gotoScenario, writeJSON, ensureServer, guard, GAME_DIR,
} from "../loop/lib.mjs";
import cfg from "./qa.config.mjs";

guard({ name: "qa-animation", maxMinutes: 8 });
const SELFTEST = process.argv.includes("--selftest");
const S = cfg.seam;
const AA = cfg.animation ?? {};
const PLANT_LIFT = AA.plantLift ?? 0.12;        // lift signal below this = foot planted
const SKATE_GATE = AA.skatePerMeter ?? 0.35;    // planted-foot slide per meter traveled
const JITTER_GATE = AA.jitterMs2 ?? 60;         // mean |2nd diff| of player pos, m/s^2
const SPARC_GATE = AA.sparcMax ?? -6.5;         // camera SPARC below this = rough
const log = (...a) => console.log("[animation]", ...a);

/** Metrics over the recorder's sample rows (see debug.motion().fields). */
function analyze(fields, samples, dt) {
  const F = Object.fromEntries(fields.map((f, i) => [f, i]));
  let travel = 0, skateR = 0, skateL = 0, plantedR = 0, plantedL = 0;
  let jitterSum = 0, jitterN = 0, jitterMax = 0, jitterFrame = -1;
  const camSpeed = [];
  // Contact = the foot at its own height MINIMUM (the lift signal alone is zero
  // through the whole back-swing half-cycle and over-counts fast swing motion
  // as "planted" — measured 1.34/m on a healthy walk before this fix).
  let minRY = Infinity, minLY = Infinity;
  for (const s of samples) { minRY = Math.min(minRY, s[F.footRY]); minLY = Math.min(minLY, s[F.footLY]); }
  const CONTACT = 0.02; // world units above the foot's own minimum
  for (let i = 1; i < samples.length; i++) {
    const s = samples[i], p = samples[i - 1];
    const dPlayer = Math.hypot(s[F.px] - p[F.px], s[F.pz] - p[F.pz]);
    travel += dPlayer;
    // Real locomotion runs ~4–6 u/s; below 1.5 the hero is blocked or stopping,
    // where cycling feet with no travel would inflate the ratio meaninglessly.
    const moving = dPlayer / dt > 1.5;
    if (moving && s[F.footRY] < minRY + CONTACT && p[F.footRY] < minRY + CONTACT && s[F.liftR] < PLANT_LIFT) {
      skateR += Math.hypot(s[F.footRX] - p[F.footRX], s[F.footRZ] - p[F.footRZ]);
      plantedR++;
    }
    if (moving && s[F.footLY] < minLY + CONTACT && p[F.footLY] < minLY + CONTACT && s[F.liftL] < PLANT_LIFT) {
      skateL += Math.hypot(s[F.footLX] - p[F.footLX], s[F.footLZ] - p[F.footLZ]);
      plantedL++;
    }
    camSpeed.push(Math.hypot(s[F.camX] - p[F.camX], s[F.camY] - p[F.camY], s[F.camZ] - p[F.camZ]) / dt);
    if (i >= 2) {
      const q = samples[i - 2];
      const ax = (s[F.px] - 2 * p[F.px] + q[F.px]) / (dt * dt);
      const az = (s[F.pz] - 2 * p[F.pz] + q[F.pz]) / (dt * dt);
      const jitter = Math.hypot(ax, az);
      jitterSum += jitter;
      if (jitter > jitterMax) { jitterMax = jitter; jitterFrame = i; }
      jitterN++;
    }
  }
  // SPARC (Balasubramanian et al.): arc length of the normalized magnitude
  // spectrum of the speed profile, up to a 10 Hz cutoff. Small DFT — N is tiny.
  let sparc = null;
  if (camSpeed.length >= 32) {
    const N = camSpeed.length;
    const nyq = 1 / (2 * dt);
    const kMax = Math.min(N / 2, Math.ceil((10 / nyq) * (N / 2)));
    const mag = [];
    for (let k = 0; k <= kMax; k++) {
      let re = 0, im = 0;
      for (let n = 0; n < N; n++) {
        const w = (2 * Math.PI * k * n) / N;
        re += camSpeed[n] * Math.cos(w);
        im -= camSpeed[n] * Math.sin(w);
      }
      mag.push(Math.hypot(re, im));
    }
    const m0 = mag[0] || 1;
    let arc = 0;
    for (let k = 1; k < mag.length; k++) {
      const dx = 1 / (mag.length - 1);
      const dy = (mag[k] - mag[k - 1]) / m0;
      arc += Math.hypot(dx, dy);
    }
    sparc = -arc;
  }
  return {
    frames: samples.length,
    travel: +travel.toFixed(2),
    skatePerMeter: travel > 0.5 ? +((skateR + skateL) / travel).toFixed(3) : 0,
    plantedFrames: plantedR + plantedL,
    jitterMs2: jitterN ? +(jitterSum / jitterN).toFixed(2) : 0,
    jitterMaxMs2: +jitterMax.toFixed(2),
    jitterFrame,
    sparc: sparc == null ? null : +sparc.toFixed(2),
  };
}

const server = await ensureServer({ log });
const { browser, page } = await launchBrowser();
await bootGame(page);
await enterRun(page);
await gotoScenario(page, "room:combat", { settle: 2200 });
await page.evaluate(`window.${S}debug.killEnemies(); window.${S}debug.godmode(); 0`);

const DT = 1 / 60;

/** Record a locomotion window: real key-hold + deterministic stepping. */
async function record({ fault = null, frames = 150 } = {}) {
  // Start from the arena centre so a 150-frame walk can't hit the rim or a
  // pillar — blocked-walking cycles the feet with no travel and poisons the ratio.
  await page.evaluate(`(()=>{ const p = window.${S}.player.pos; p.x = 0; p.z = 0; })()`);
  await page.evaluate(`window.${S}debug.frames(5, ${DT}); 0`);
  if (fault === "skate") {
    // Drag the world position WITHOUT the walk cycle: idle pose (feet planted)
    // while the body slides — the literal definition of foot-skate.
    await page.evaluate(`(()=>{
      const c = window.${S};
      const d = window.${S}debug;
      window.__qaSkateTick = d.frames.bind(d);
      d.frames = (n, dt) => { for (let i = 0; i < n; i++) { c.player.pos.x += 0.06; window.__qaSkateTick(1, dt); } return n; };
    })()`);
    await page.evaluate(`window.${S}debug.recordMotion(true); window.${S}debug.frames(${frames}, ${DT}); window.${S}debug.recordMotion(false); 0`);
    await page.evaluate(`(()=>{ if (window.__qaSkateTick) { window.${S}debug.frames = window.__qaSkateTick; window.__qaSkateTick = null; } })()`);
  } else if (fault === "jitter") {
    await page.evaluate(`(()=>{
      const c = window.${S};
      const d = window.${S}debug;
      window.__qaJitTick = d.frames.bind(d);
      d.frames = (n, dt) => { for (let i = 0; i < n; i++) { c.player.pos.x += (Math.random() - 0.5) * 0.3; window.__qaJitTick(1, dt); } return n; };
    })()`);
    await page.keyboard.down("KeyW");
    await page.evaluate(`window.${S}debug.recordMotion(true); window.${S}debug.frames(${frames}, ${DT}); window.${S}debug.recordMotion(false); 0`);
    await page.keyboard.up("KeyW");
    await page.evaluate(`(()=>{ if (window.__qaJitTick) { window.${S}debug.frames = window.__qaJitTick; window.__qaJitTick = null; } })()`);
  } else {
    await page.keyboard.down("KeyW");
    // Arm, step and disarm in one JS task. Otherwise normal rAF frames can slip
    // between Playwright commands and poison the fixed-dt acceleration metric.
    await page.evaluate(`window.${S}debug.recordMotion(true); window.${S}debug.frames(${frames}, ${DT}); window.${S}debug.recordMotion(false); 0`);
    await page.keyboard.up("KeyW");
  }
  const m = await page.evaluate(`window.${S}debug.motion()`);
  return analyze(m.fields, m.samples, DT);
}

const results = [];
let failures = 0;

const clean = await record();
results.push({ run: "locomotion", ...clean });
log(`locomotion: travel=${clean.travel}u skate/m=${clean.skatePerMeter} jitter=${clean.jitterMs2}m/s² sparc=${clean.sparc} (${clean.frames} frames)`);
if (!SELFTEST) {
  if (clean.travel < 2) { log("FINDING NO-TRAVEL: held forward but the hero barely moved"); failures++; }
  if (clean.skatePerMeter > SKATE_GATE) { log(`FINDING FOOT-SKATE: ${clean.skatePerMeter}/m > ${SKATE_GATE} — planted feet translate while moving`); failures++; }
  if (clean.jitterMs2 > JITTER_GATE) { log(`FINDING JITTER: ${clean.jitterMs2} m/s² > ${JITTER_GATE} — motion reads as jank`); failures++; }
  if (clean.sparc != null && clean.sparc < SPARC_GATE) { log(`FINDING ROUGH-CAMERA: SPARC ${clean.sparc} < ${SPARC_GATE}`); failures++; }
} else {
  if (clean.skatePerMeter > SKATE_GATE) { log("SELFTEST FAIL: baseline locomotion already skates — fix or recalibrate first"); failures++; }
  const sk = await record({ fault: "skate" });
  results.push({ run: "fault-skate", ...sk });
  const skFired = sk.skatePerMeter > SKATE_GATE;
  log(`selftest FOOT-SKATE (drag without stepping): fired=${skFired} (skate/m=${sk.skatePerMeter}, travel=${sk.travel})`);
  if (!skFired) { log("SELFTEST FAIL: dragged idle pose did not read as skating"); failures++; }
  const jt = await record({ fault: "jitter" });
  results.push({ run: "fault-jitter", ...jt });
  const jtFired = jt.jitterMs2 > JITTER_GATE;
  log(`selftest JITTER (random per-frame jolts): fired=${jtFired} (jitter=${jt.jitterMs2})`);
  if (!jtFired) { log("SELFTEST FAIL: positional jolts did not read as jitter"); failures++; }
}

writeJSON(join(GAME_DIR, "artifacts", "qa", "animation.json"), {
  at: new Date().toISOString(), selftest: SELFTEST,
  gates: { PLANT_LIFT, SKATE_GATE, JITTER_GATE, SPARC_GATE }, results, failures,
});

await browser.close();
server.stop();
if (failures) { log(`FAIL — ${failures} finding(s)`); process.exit(Math.min(failures, 99)); }
log("OK — locomotion is grounded and smooth by the numbers");
