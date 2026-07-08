// TEMPORAL GATE — deterministic clips, judged by MATH, not a VLM (research is
// blunt: VLM temporal-glitch detection is ~chance; TempGlitch 2026). Per scene:
//
//   FROZEN PAIRS  freezeForTest(true) + consecutive captures. A deterministic
//                 render is pixel-identical; per-frame-random FX (the shipped
//                 NoiseEffect class) spike the mean diff → SHIMMER. Diff pixels
//                 that are FEW and ISOLATED (speckle, not a coherent region)
//                 → Z-SPECKLE, the z-fighting signature. Generalizes the
//                 shot-flicker gate from its 2 held scenes to every scenario.
//   MOTION CLIP   freezeForTest(false), frames(step, dt) between captures —
//                 a fixed-tick, fixed-seed clip, byte-comparable across builds.
//                 ffmpeg's no-reference filters then gate it: freezedetect
//                 (frozen when motion expected), scdet (cut-like discontinuity
//                 inside a continuous clip = pop/strobe), signalstats (per-frame
//                 black/flat/blowout), entropy floor. CAMBI (libvmaf) scores
//                 banding on a representative still — WARN until calibrated.
//
//   node scripts/qa/temporal.mjs               audit the configured scenes
//   node scripts/qa/temporal.mjs --selftest    fault-injection proof (DOM-side
//                                              faults: random-opacity overlay →
//                                              SHIMMER; world freeze → FROZEN;
//                                              one-frame white flash → POP)
//
// Exit code = finding/failure count. ffmpeg missing → the ffmpeg tier SKIPs
// loudly (install: winget install Gyan.FFmpeg) but pair metrics still gate.
import { mkdirSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  launchBrowser, bootGame, enterRun, gotoScenario, writeJSON, ensureServer, guard, GAME_DIR,
} from "../loop/lib.mjs";
import cfg from "./qa.config.mjs";

guard({ name: "qa-temporal", maxMinutes: 14 });
const SELFTEST = process.argv.includes("--selftest");
const S = cfg.seam;
const TT = cfg.temporal ?? { scenes: ["room:combat"], frames: 32, dt: 1 / 30, stepPerFrame: 2, settleMs: 2200 };
const SHIMMER_GATE = TT.shimmerGate ?? 1.0;   // mean |diff|/255-channel on a frozen pair (clean ~0.15, grain ~2.2)
const SPECKLE_MIN_PX = 60;                     // fewer differing pixels than this = compression noise
const SPECKLE_MAX_FRAC = 0.02;                 // more than 2% differing = full-frame shimmer, not speckle
const SPECKLE_ISOLATION = 0.6;                 // isolated/diff ratio above this = z-fight-style speckle
const SCD_GATE = TT.scdGate ?? 12;             // scdet score inside a continuous clip = pop/strobe
const CAMBI_WARN = TT.cambiWarn ?? 1.0;
const log = (...a) => console.log("[temporal]", ...a);

const OUT = join(GAME_DIR, "shots", "temporal");
mkdirSync(OUT, { recursive: true });

const server = await ensureServer({ log });
const { browser, page } = await launchBrowser();
await bootGame(page);
await enterRun(page);

// ── in-page pair metrics (Image→canvas→getImageData; no node deps) ─────────
const PAIR_METRIC = `async (a, b) => {
  const load = async (s) => {
    const img = new Image();
    img.src = "data:image/png;base64," + s;
    await img.decode();
    const cv = document.createElement("canvas");
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const g = cv.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    return { d: g.getImageData(0, 0, cv.width, cv.height).data, w: cv.width, h: cv.height };
  };
  const A = await load(a), B = await load(b);
  const w = Math.min(A.w, B.w), h = Math.min(A.h, B.h);
  const diff = new Uint8Array(w * h);
  let sum = 0, nDiff = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * A.w + x) * 4, j = (y * B.w + x) * 4;
      const d = Math.max(Math.abs(A.d[i] - B.d[j]), Math.abs(A.d[i + 1] - B.d[j + 1]), Math.abs(A.d[i + 2] - B.d[j + 2]));
      sum += d;
      if (d > 24) { diff[y * w + x] = 1; nDiff++; }
    }
  }
  let isolated = 0;
  if (nDiff) {
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (!diff[y * w + x]) continue;
        const n = diff[y * w + x - 1] + diff[y * w + x + 1] + diff[(y - 1) * w + x] + diff[(y + 1) * w + x];
        if (n < 2) isolated++;
      }
    }
  }
  return { mae: sum / (w * h), nDiff, diffFrac: nDiff / (w * h), isolation: nDiff ? isolated / nDiff : 0 };
}`;

const pairMetric = (a, b) => page.evaluate(`(${PAIR_METRIC})(${JSON.stringify(a)}, ${JSON.stringify(b)})`);
const grabB64 = async () => Buffer.from(await page.screenshot()).toString("base64");

// ── ffmpeg no-reference tier ────────────────────────────────────────────────
const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { timeout: 15000 }).status === 0;
if (!hasFfmpeg) log("WARN: ffmpeg not found — no-reference tier SKIPPED (winget install Gyan.FFmpeg)");

/** Run the detection chain over a clip dir; parse lavfi metadata off stdout/stderr. */
function ffmpegSweep(dir, fps) {
  const r = spawnSync("ffmpeg", [
    "-hide_banner", "-f", "image2", "-framerate", String(fps),
    "-i", join(dir, "f%04d.png"),
    "-vf", `freezedetect=n=0.003:d=${(3 / fps).toFixed(3)},scdet=threshold=${SCD_GATE},signalstats,entropy,metadata=mode=print:file=-`,
    "-f", "null", "-",
  ], { timeout: 120000, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const text = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  const frames = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const fm = line.match(/frame:(\d+)\s+pts:/);
    if (fm) { cur = { i: Number(fm[1]) }; frames.push(cur); continue; }
    if (!cur) continue;
    const kv = line.match(/lavfi\.([a-z._]+)=([-\d.a-zA-Z]+)/);
    if (kv) cur[kv[1]] = Number.isNaN(Number(kv[2])) ? kv[2] : Number(kv[2]);
  }
  // A binary freeze_start fires on any legitimate 3-frame idle hold — sum the
  // frozen DURATION instead and let the caller gate on its clip fraction.
  let freezeSec = 0;
  for (const m of text.matchAll(/freezedetect\.freeze_duration=([\d.]+)/g)) freezeSec += Number(m[1]);
  const pops = frames.filter((f) => (f["scd.score"] ?? 0) >= SCD_GATE).map((f) => f.i);
  const black = frames.filter((f) => (f["signalstats.YMAX"] ?? 255) < 8).map((f) => f.i);
  const flat = frames.filter((f) => (f["signalstats.YMAX"] ?? 255) - (f["signalstats.YMIN"] ?? 0) < 8 && (f["signalstats.YMAX"] ?? 255) >= 8).map((f) => f.i);
  const blowout = frames.filter((f) => (f["signalstats.YMAX"] ?? 0) >= 255 && (f["signalstats.YAVG"] ?? 0) > 235).map((f) => f.i);
  const entropies = frames.map((f) => f["entropy.entropy.normal.Y"]).filter((v) => typeof v === "number");
  const minEntropy = entropies.length ? Math.min(...entropies) : null;
  return { ok: r.status === 0, freezeSec: +freezeSec.toFixed(2), pops, black, flat, blowout, minEntropy, frameCount: frames.length };
}

/** CAMBI banding score for one still (libvmaf; the frame is its own reference —
 *  CAMBI is computed on the distorted input alone). Runs with cwd=GAME_DIR and a
 *  RELATIVE log path — an absolute Windows path needs colon-escaping through the
 *  filter parser and silently fails. */
function cambi(png) {
  const rel = "shots/temporal/_cambi.json";
  const logPath = join(GAME_DIR, rel);
  spawnSync("ffmpeg", ["-hide_banner", "-i", png, "-i", png, "-lavfi",
    `libvmaf=feature=name=cambi:log_fmt=json:log_path=${rel}`, "-f", "null", "-"],
  { timeout: 60000, encoding: "utf8", cwd: GAME_DIR });
  try {
    const j = JSON.parse(readFileSync(logPath, "utf8"));
    rmSync(logPath, { force: true });
    return j.pooled_metrics?.cambi?.mean ?? j.frames?.[0]?.metrics?.cambi ?? null;
  } catch { return null; }
}

// ── the sweep ───────────────────────────────────────────────────────────────
const results = [];
let failures = 0;
const fps = Math.round(1 / TT.dt);

async function auditScene(scene, { faults = null } = {}) {
  const slug = scene.replace(/[^a-z0-9]+/gi, "-");
  const dir = join(OUT, slug + (faults ? "-fault" : ""));
  mkdirSync(dir, { recursive: true });
  await gotoScenario(page, scene, { settle: TT.settleMs ?? 2200 });
  const r = { scene, findings: [] };

  // Capture hygiene (the shot-flicker recipe — a dirty capture is not a bug
  // report): HIGH quality so grain-class effects are even present, godmode so a
  // stray hit can't restage the frame, clear live particles/floaters, settle.
  await page.evaluate(`window.${S}.stage.applyQuality ? window.${S}.stage.applyQuality("high") : 0; 0`);
  await page.evaluate(`window.${S}debug.godmode(); window.${S}.fx.clear ? window.${S}.fx.clear() : 0; 0`);
  // Age the stage: entrance beams / spawn columns / timed room content resolve
  // over several seconds and read as transients if measured too early.
  await page.evaluate(`window.${S}debug.frames(60); 0`);
  await new Promise((res) => setTimeout(res, 1200));
  await page.evaluate(`window.${S}.fx.clear ? window.${S}.fx.clear() : 0; 0`);

  // 1) FROZEN pairs — shimmer + z-speckle, measured on the GL CANVAS ONLY.
  // page.screenshot() composites the DOM HUD, whose CSS animations (card shine,
  // boss-bar pips) keep running through a world freeze and read as speckle —
  // measured 3918px of "z-fighting" that the heatmap localized to two card
  // slots. gl.readPixels in the same task as tick() reads the live framebuffer
  // (the documented workaround for the preserveDrawingBuffer black-read trap).
  await page.evaluate(`window.${S}debug.freezeForTest(true); 0`);
  await new Promise((res) => setTimeout(res, 150));
  if (faults === "shimmer") {
    // GL-level fault: blink the hero's visibility per tick — per-frame-random
    // RENDER output, exactly the class the gate exists for. (An emissive jitter
    // fault was silently overwritten by the theme crossfade's per-frame writes;
    // nothing re-sets `visible`, so the blink survives to the render. A DOM
    // overlay would be invisible to the canvas-only readout by design.)
    await page.evaluate(`(()=>{
      const c = window.${S};
      // Blink the FLOOR disc — it fills most of the frame, so the fault reads
      // huge regardless of camera framing (a hero blink measured only 0.55 MAE
      // on a pulled-back roll and slipped under the gate).
      let target = null;
      c.stage.scene.traverse((o) => { if (!target && o.isMesh && o.userData.solidity === "ground") target = o; });
      target = target ?? c.player.root;
      window.__qaShimFault = { target, base: target.visible };
      const d = window.${S}debug;
      window.__qaShimTick = d.tick.bind(d);
      d.tick = (dt) => { target.visible = Math.random() < 0.5; window.__qaShimTick(dt); };
    })()`);
  }
  const frozenPairs = await page.evaluate(`(async () => {
    const c = window.${S};
    const d = window.${S}debug;
    const gl = c.stage.renderer.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    let prev = new Uint8Array(w * h * 4), cur = new Uint8Array(w * h * 4);
    const diff = new Uint8Array(w * h);
    const pairs = [];
    // Age the freeze 3 ticks before measuring: one-final-frame settle logic
    // (hit-flash resets, damp latches) legitimately changes the first frame
    // after a freeze — measured [7.6, 0, 0, 0]; real shimmer changes EVERY pair.
    for (let k = 0; k < 3; k++) d.tick();
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, prev);
    for (let f = 0; f < 4; f++) {
      d.tick();
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, cur);
      let sum = 0, nDiff = 0;
      diff.fill(0);
      for (let i = 0, p = 0; i < w * h; i++, p += 4) {
        const dv = Math.max(Math.abs(cur[p] - prev[p]), Math.abs(cur[p + 1] - prev[p + 1]), Math.abs(cur[p + 2] - prev[p + 2]));
        sum += dv;
        if (dv > 24) { diff[i] = 1; nDiff++; }
      }
      let isolated = 0;
      if (nDiff) {
        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            if (!diff[y * w + x]) continue;
            const nb = diff[y * w + x - 1] + diff[y * w + x + 1] + diff[(y - 1) * w + x] + diff[(y + 1) * w + x];
            if (nb < 2) isolated++;
          }
        }
      }
      pairs.push({ mae: sum / (w * h), nDiff, diffFrac: nDiff / (w * h), isolation: nDiff ? isolated / nDiff : 0 });
      const t = prev; prev = cur; cur = t;
    }
    return pairs;
  })()`);
  let maeSum = 0, speckle = null;
  for (const m of frozenPairs) {
    maeSum += m.mae;
    if (m.nDiff >= SPECKLE_MIN_PX && m.diffFrac <= SPECKLE_MAX_FRAC && m.isolation >= SPECKLE_ISOLATION) speckle = m;
  }
  const shimmerMae = maeSum / frozenPairs.length;
  r.shimmerMae = +shimmerMae.toFixed(3);
  if (shimmerMae > SHIMMER_GATE) r.findings.push({ type: "SHIMMER", detail: `frozen-scene consecutive-frame MAE ${shimmerMae.toFixed(2)} > ${SHIMMER_GATE} — per-frame-random render output` });
  if (speckle && shimmerMae <= SHIMMER_GATE) r.findings.push({ type: "Z-SPECKLE", detail: `${speckle.nDiff}px differ on a frozen scene, ${(speckle.isolation * 100) | 0}% isolated — z-fighting-style depth instability` });
  if (r.findings.length) {
    // Save a frozen pair (full composite) so the finding is eyeball-able.
    const fs2 = await import("node:fs");
    fs2.writeFileSync(join(dir, "frozen-a.png"), Buffer.from(await grabB64(), "base64"));
    await page.evaluate(`window.${S}debug.tick(); 0`);
    fs2.writeFileSync(join(dir, "frozen-b.png"), Buffer.from(await grabB64(), "base64"));
  }
  // Auto-triage a frozen-scene instability: measured bisection through the live
  // effect panel (never guess-removal). Strip each effect alone, re-measure, and
  // NAME the owner in the finding. Skips silently when the game has no panel.
  if (r.findings.some((f) => f.type === "SHIMMER" || f.type === "Z-SPECKLE") && !faults) {
    const owner = await page.evaluate(`(async () => {
      const fxPanel = window.__rh3fx ?? window.${S}fx;
      if (!fxPanel) return null;
      const setFx = (id, on) => (typeof fxPanel.setOne === "function" ? fxPanel.setOne(id, on) : fxPanel.set(id, on));
      const fx = { set: setFx };
      const d = window.${S}debug;
      const c = window.${S};
      const gl = c.stage.renderer.getContext();
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const prev = new Uint8Array(w * h * 4), cur = new Uint8Array(w * h * 4);
      const measure = () => {
        for (let k = 0; k < 3; k++) d.tick();
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, prev);
        let worst = 0;
        for (let f = 0; f < 2; f++) {
          d.tick();
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, cur);
          let nDiff = 0;
          for (let i = 0, p = 0; i < w * h; i++, p += 4) {
            if (Math.max(Math.abs(cur[p] - prev[p]), Math.abs(cur[p + 1] - prev[p + 1]), Math.abs(cur[p + 2] - prev[p + 2])) > 24) nDiff++;
          }
          worst = Math.max(worst, nDiff);
          prev.set(cur);
        }
        return worst;
      };
      const base = measure();
      if (base < 30) return { note: "did not reproduce during bisection", base };
      const ids = ${JSON.stringify(TT.bisectFx ?? ["smaa", "bloom", "shadows", "env", "rim", "fog", "grade", "vignette", "contact"])};
      for (const id of ids) {
        fx.set(id, false);
        const n = measure();
        fx.set(id, true);
        if (n < Math.max(30, base * 0.1)) return { owner: id, base, without: n };
      }
      return { owner: null, base, note: "no single effect owns it (baked/compound)" };
    })()`);
    if (owner) {
      r.bisect = owner;
      log(`  bisect: ${owner.owner ? `instability owned by "${owner.owner}" (${owner.base}px → ${owner.without}px without it)` : owner.note}`);
      if (owner.note === "did not reproduce during bisection") {
        // Fired at measurement, quiet seconds later: a TRANSIENT — timed content
        // still resolving at capture (entrance/ward FX) or a wall-clock-driven
        // effect. Not persistent depth instability; report as a WARN so staging
        // gets aged or the offender gets moved onto the threaded clock.
        const idx = r.findings.findIndex((f) => f.type === "SHIMMER" || f.type === "Z-SPECKLE");
        if (idx >= 0) {
          r.warn = `TRANSIENT-INSTABILITY (was ${r.findings[idx].type}): frozen-scene diffs at capture but not seconds later — timed/wall-clock content still resolving; age the stage or thread the effect onto dt`;
          r.findings.splice(idx, 1);
        }
      }
    }
  }
  if (faults === "shimmer") {
    await page.evaluate(`(()=>{
      const f = window.__qaShimFault;
      if (f) f.target.visible = f.base;
      if (window.__qaShimTick) window.${S}debug.tick = window.__qaShimTick;
      window.__qaShimFault = null; window.__qaShimTick = null;
    })()`);
  }
  await page.evaluate(`window.${S}debug.freezeForTest(false); 0`);

  // 2) MOTION clip — fixed-tick captures, ffmpeg no-reference sweep
  if (faults === "frozen") await page.evaluate(`window.${S}debug.freezeForTest(true); 0`);
  let motionEnergy = 0;
  let prev = null;
  for (let i = 0; i < TT.frames; i++) {
    if (faults === "pop" && i === Math.floor(TT.frames / 2)) {
      await page.evaluate(`(()=>{ const d = document.createElement("div"); d.id = "__qaPopFault"; d.style.cssText = "position:fixed;inset:0;background:#fff;z-index:99999"; document.body.appendChild(d); })()`);
    } else if (faults === "pop") {
      await page.evaluate(`document.getElementById("__qaPopFault")?.remove(); 0`);
    }
    const b64 = await grabB64();
    const fs2 = await import("node:fs");
    fs2.writeFileSync(join(dir, `f${String(i + 1).padStart(4, "0")}.png`), Buffer.from(b64, "base64"));
    if (prev) { const m = await pairMetric(prev, b64); motionEnergy += m.mae; }
    prev = b64;
    await page.evaluate(`window.${S}debug.frames(${TT.stepPerFrame}, ${TT.dt}); 0`);
  }
  if (faults === "pop") await page.evaluate(`document.getElementById("__qaPopFault")?.remove(); 0`);
  if (faults === "frozen") await page.evaluate(`window.${S}debug.freezeForTest(false); 0`);
  r.motionEnergy = +(motionEnergy / (TT.frames - 1)).toFixed(3);

  if (hasFfmpeg) {
    const ff = ffmpegSweep(dir, fps);
    r.ffmpeg = ff;
    const clipSec = TT.frames / fps;
    // 0.5 separates cleanly: healthy combat clips measure 4.9–11.6 MAE; a frozen
    // world with only DOM CSS still animating measures ~0.09 (CSS motion defeats
    // ffmpeg's freezedetect noise floor too, so motionEnergy is primary).
    if (r.motionEnergy < 0.5 || ff.freezeSec > clipSec * 0.6) {
      r.findings.push({ type: "FROZEN", detail: `motion expected but clip is static (frozen ${ff.freezeSec}s of ${clipSec.toFixed(1)}s, motionEnergy=${r.motionEnergy})` });
    }
    if (ff.pops.length) r.findings.push({ type: "POP", detail: `scdet fired inside a continuous clip at frame(s) ${ff.pops.join(",")} — pop/strobe discontinuity` });
    if (ff.black.length) r.findings.push({ type: "BLACK-FRAME", detail: `frame(s) ${ff.black.join(",")} fully black mid-clip` });
    if (ff.blowout.length) r.findings.push({ type: "BLOWOUT-FRAME", detail: `frame(s) ${ff.blowout.join(",")} clipped white` });
    const cb = cambi(join(dir, `f${String(TT.frames).padStart(4, "0")}.png`));
    r.cambi = cb;
    if (cb != null && cb > CAMBI_WARN) r.warn = `CAMBI banding ${cb.toFixed(2)} > ${CAMBI_WARN} (WARN — calibrate per art direction)`;
  } else if (r.motionEnergy < 0.5) {
    r.findings.push({ type: "FROZEN", detail: `motion expected but clip is static (motionEnergy=${r.motionEnergy})` });
  }
  return r;
}

if (!SELFTEST) {
  for (const scene of TT.scenes) {
    const r = await auditScene(scene);
    results.push(r);
    log(`${scene}: shimmerMAE=${r.shimmerMae} motion=${r.motionEnergy} cambi=${r.cambi ?? "n/a"} findings=${r.findings.length}`);
    for (const f of r.findings) log(`  ${f.type}: ${f.detail}`);
    if (r.warn) log(`  WARN: ${r.warn}`);
    failures += r.findings.length;
  }
} else {
  const scene = TT.scenes[0];
  const clean = await auditScene(scene);
  log(`selftest baseline: findings=${clean.findings.length} (must be 0)`);
  if (clean.findings.length) { failures++; for (const f of clean.findings) log(`  UNEXPECTED ${f.type}: ${f.detail}`); }
  const sh = await auditScene(scene, { faults: "shimmer" });
  const shFired = sh.findings.some((f) => f.type === "SHIMMER");
  log(`selftest SHIMMER (random-opacity overlay): fired=${shFired} (mae=${sh.shimmerMae})`);
  if (!shFired) { log("SELFTEST FAIL: shimmer fault did not fire"); failures++; }
  const fz = await auditScene(scene, { faults: "frozen" });
  const fzFired = fz.findings.some((f) => f.type === "FROZEN");
  log(`selftest FROZEN (world freeze during motion clip): fired=${fzFired} (motion=${fz.motionEnergy})`);
  if (!fzFired) { log("SELFTEST FAIL: freeze fault did not fire"); failures++; }
  const pp = await auditScene(scene, { faults: "pop" });
  const ppFired = pp.findings.some((f) => f.type === "POP" || f.type === "BLOWOUT-FRAME");
  log(`selftest POP (one-frame white flash): fired=${ppFired}`);
  if (!ppFired) { log("SELFTEST FAIL: pop fault did not fire"); failures++; }
  results.push(clean, sh, fz, pp);
}

writeJSON(join(GAME_DIR, "artifacts", "qa", "temporal.json"), {
  at: new Date().toISOString(), selftest: SELFTEST, ffmpeg: hasFfmpeg, results, failures,
});

await browser.close();
server.stop();
if (failures) { log(`FAIL — ${failures} finding(s)`); process.exit(Math.min(failures, 99)); }
log("OK — no temporal artifacts in any audited scene");
