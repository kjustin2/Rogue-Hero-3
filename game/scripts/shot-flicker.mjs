// FLICKER smoke. Console-only smokes can't see motion glitches. Two gate classes:
//
//   SHIMMER (per-frame temporal flicker) — capture consecutive frames of a HELD static
//   scene and diff them. A deterministic render of a still scene is near-identical
//   frame-to-frame; animated film-grain / per-frame-random post FX re-randomize the whole
//   framebuffer every frame and push the diff way up. This is the class that a 130ms-apart
//   filmstrip is BLIND to — it caught nothing while the owner saw constant shimmer in
//   combat + cutscenes (the animated pmndrs NoiseEffect). Forced to HIGH quality (grain is
//   high-only) and measured in combat AND a dimmed cutscene state.
//
//   BLOWOUT (additive-white screen-fill) — pan the camera over the arena + run the
//   act-load theme crossfade; fail if bright-desaturated (washed-to-white) pixels spike.
//
// All decoding is in-page (Image→canvas→getImageData), so no node PNG dependency.
import { launchBrowser, bootGame, enterRun, sleep } from "./loop/lib.mjs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = "shots/flicker";
// Mean absolute per-channel diff (0..255) between consecutive frames of a FROZEN scene
// (__rh3debug.freezeForTest). With the world frozen the only thing that can change is a
// per-frame-random post effect: the animated film grain measured ~2.2 (A/B), a clean render
// is pixel-identical at ~0.15 (compression noise). 1.0 sits between with wide margin both ways.
const SHIMMER_GATE = 1.0;
// Fraction of bright-desaturated (washed-to-white) pixels that counts as an additive-white
// blow-out. Clean sits under ~0.4%; 2.5% catches a washout with headroom.
const WHITE_GATE = 0.025;
mkdirSync(OUT, { recursive: true });
const { browser, page, errors } = await launchBrowser();

// Capture a frame AND measure its washed-to-white fraction (decoded in-page — no deps).
const grab = async (name) => {
  const buf = await page.screenshot({ path: join(OUT, `${name}.png`) });
  const b64 = Buffer.from(buf).toString("base64");
  const white = await page.evaluate(async (b) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b;
    await img.decode();
    const cv = document.createElement("canvas");
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const g = cv.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, cv.width, cv.height).data;
    let w = 0;
    for (let i = 0; i < d.length; i += 4) {
      const mn = Math.min(d[i], d[i + 1], d[i + 2]);
      const mx = Math.max(d[i], d[i + 1], d[i + 2]);
      if (mn > 190 && mx - mn < 45) w++;
    }
    return w / (d.length / 4);
  }, b64);
  return { name, white };
};

// Mean absolute per-channel diff between CONSECUTIVE frames of a held scene — the
// per-frame-flicker detector. Captures `frames` screenshots ~gapMs apart and averages the
// consecutive diffs. Saves the first frame for eyeballing.
const shimmer = async (name, frames = 6, gapMs = 35) => {
  const b64s = [];
  const framebuffer = page.locator("#game");
  for (let i = 0; i < frames; i++) {
    // Canvas-only: this gate owns renderer temporal stability. DOM HUD keyframes
    // have their own UI/motion audits and must not masquerade as a WebGL flicker.
    const buf = await framebuffer.screenshot({ path: join(OUT, `shimmer-${name}-${String(i).padStart(2, "0")}.png`) });
    b64s.push(Buffer.from(buf).toString("base64"));
    await sleep(gapMs);
  }
  return page.evaluate(async (imgs) => {
    const decode = async (b) => {
      const img = new Image();
      img.src = "data:image/png;base64," + b;
      await img.decode();
      const cv = document.createElement("canvas");
      cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      const g = cv.getContext("2d");
      g.drawImage(img, 0, 0);
      return g.getImageData(0, 0, cv.width, cv.height).data;
    };
    let prev = await decode(imgs[0]);
    let total = 0, pairs = 0;
    for (let i = 1; i < imgs.length; i++) {
      const cur = await decode(imgs[i]);
      let sum = 0;
      for (let p = 0; p < cur.length; p += 4)
        sum += Math.abs(cur[p] - prev[p]) + Math.abs(cur[p + 1] - prev[p + 1]) + Math.abs(cur[p + 2] - prev[p + 2]);
      total += sum / ((cur.length / 4) * 3);
      pairs++;
      prev = cur;
    }
    return total / pairs;
  }, b64s);
};

await bootGame(page);
await enterRun(page);
// Force HIGH quality — the film grain (and CA) are high-only, so a medium/low boot would
// hide the exact flicker we're gating. Rebuild settles in a frame or two.
await page.evaluate(() => window.__rh3.stage.applyQuality?.("high"));
await sleep(700);
await page.evaluate(() => window.__rh3debug?.godmode?.());

// ---- SHIMMER: FREEZE the whole world (dt=0) but keep rendering the full composer, so the
// ONLY thing that can change frame-to-frame is a per-frame-RANDOM post effect (animated film
// grain). A clean build renders a frozen scene pixel-identical → ~0; the grain re-randomized
// every pixel → high. This is the class a 130ms filmstrip was blind to.
await page.evaluate(() => { window.__rh3.fx.clear?.(); });
await sleep(200);
await page.evaluate(() => window.__rh3debug.freezeForTest(true));
await sleep(150);
const shCombat = await shimmer("combat");
await page.evaluate(() => window.__rh3debug.freezeForTest(false));
// Cutscene lighting: dim first (needs live updates to ease in), THEN freeze + measure.
await page.evaluate(() => { window.__rh3.arena.cutsceneDim = 1; });
await sleep(1100);
await page.evaluate(() => window.__rh3debug.freezeForTest(true));
await sleep(150);
const shCut = await shimmer("cutscene");
await page.evaluate(() => { window.__rh3debug.freezeForTest(false); window.__rh3.arena.cutsceneDim = 0; });
await sleep(500);

// ---- BLOWOUT: force the sweeper hazard in, pan the camera, then the act crossfade.
await page.evaluate(() => { const c = window.__rh3; c.features.clear?.(); c.features.setup({ feature: "sweeper" }); });
await sleep(300);
const samples = { pan: [], act: [] };
for (let i = 0; i < 14; i++) {
  const a = (i / 14) * Math.PI * 0.85 - 0.4;
  const px = Math.sin(a) * 7, pz = Math.cos(a) * 5 - 1;
  await page.evaluate(([x, z]) => {
    const c = window.__rh3;
    c.player.pos.set(x, 0, z);
    c.cam.snapTo?.(x, z);
    c.fx.clear?.();
  }, [px, pz]);
  await sleep(130);
  await page.evaluate(() => window.__rh3.fx.clear?.());
  samples.pan.push(await grab(`pan-${String(i).padStart(2, "0")}`));
}
await page.evaluate(() => { window.__rh3menus?.clear?.(); window.__rh3debug?.interlude?.(3); });
for (let i = 0; i < 14; i++) {
  await sleep(120);
  samples.act.push(await grab(`act-${String(i).padStart(2, "0")}`));
}

// ---- Report + gate.
let failed = false;
const shBad = (v) => v > SHIMMER_GATE;
for (const [label, v] of [["combat", shCombat], ["cutscene", shCut]]) {
  const bad = shBad(v);
  failed = failed || bad;
  console.log(`shimmer ${label}: ${v.toFixed(2)} /255 per-frame  ${bad ? "✗ FLICKER" : "ok"}`);
}
for (const [seq, arr] of Object.entries(samples)) {
  const worst = arr.reduce((m, s) => (s.white > m.white ? s : m), arr[0]);
  const bad = worst.white > WHITE_GATE;
  failed = failed || bad;
  console.log(`${seq}: peak white ${(worst.white * 100).toFixed(1)}% @ ${worst.name}  ${bad ? "✗ BLOWOUT" : "ok"}`);
}
console.log(errors.length ? `ERRORS: ${errors.slice(0, 5).join("\n")}` : "NO CONSOLE ERRORS");
console.log(failed ? "FLICKER GATE: FAIL" : "FLICKER GATE: PASS");
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
