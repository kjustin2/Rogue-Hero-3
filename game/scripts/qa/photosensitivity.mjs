// PHOTOSENSITIVITY / FLASH-RATE GATE — WCAG 2.3.1 (Three Flashes) over the GL
// canvas, deterministic. A seizure-risk flash is an opposing pair of relative-
// luminance transitions where the swing ≥ 10% of max AND the darker level < 0.8;
// content fails if any 1-second window has MORE THAN 3 such flashes over MORE
// THAN 25% of the screen area. A saturated-red variant runs alongside (red flash
// is a distinct clinical trigger). Measured on the same GL-only readback the
// temporal gate uses (page screenshots composite DOM CSS and lie).
//
// The analyzer is a PURE function over a sequence of coarse luminance/red grids;
// the live path fills those grids from FX-heavy deterministic clips (crash nova,
// boss entrance), the selftest feeds a fabricated full-screen strobe.
//
//   node scripts/qa/photosensitivity.mjs             audit FX clips for flash risk
//   node scripts/qa/photosensitivity.mjs --selftest  fault-proof: a 30Hz full-area
//                                                    strobe must FIRE; a gentle
//                                                    clip must stay quiet
//
// Exit = failing clip count.
import { join } from "node:path";
import {
  launchBrowser, bootGame, enterRun, gotoScenario, writeJSON, ensureServer, guard, GAME_DIR,
} from "../loop/lib.mjs";
import cfg from "./qa.config.mjs";

guard({ name: "qa-photosensitivity", maxMinutes: 8 });
const SELFTEST = process.argv.includes("--selftest");
const S = cfg.seam;
const PS = cfg.photosensitivity ?? {
  gridN: 20, frames: 78, dt: 1 / 60, fps: 60,
  swing: 0.1, darkMax: 0.8, redSwing: 0.12,
  flashesPerSec: 3, areaFrac: 0.25,
};
const log = (...a) => console.log("[photosensitivity]", ...a);

/** PURE WCAG flash analysis over grid[frame][cell] series (luminance + red, both
 *  0..1). Reused verbatim by the selftest against a fabricated strobe. A cell
 *  "flashes" when it makes an opposing significant transition (rise then fall or
 *  vice-versa) with the darker side < darkMax. FAIL if any 1s window exceeds
 *  flashesPerSec flashes over > areaFrac of cells. */
function analyze(lum, red, o) {
  const F = lum.length, C = F ? lum[0].length : 0;
  const win = Math.round(o.fps); // 1-second sliding window (frames)
  const scan = (grids, swing) => {
    // per-cell array of frame indices where a completed flash occurs
    const flashFrames = Array.from({ length: C }, () => []);
    for (let c = 0; c < C; c++) {
      let dir = 0, anchor = grids[0][c], halfPairs = 0;
      for (let f = 1; f < F; f++) {
        const v = grids[f][c], d = v - anchor;
        if (Math.abs(d) >= swing && Math.min(v, anchor) < o.darkMax) {
          const nd = d > 0 ? 1 : -1;
          if (nd !== dir) {         // a direction reversal = one half-flash boundary
            if (dir !== 0) { halfPairs++; if (halfPairs % 2 === 0) flashFrames[c].push(f); }
            dir = nd;
          }
          anchor = v;
        }
      }
    }
    // worst 1-second window: max fraction of cells with > flashesPerSec flashes
    let worst = 0, worstAt = 0;
    for (let start = 0; start < Math.max(1, F - win + 1); start++) {
      let flashing = 0;
      for (let c = 0; c < C; c++) {
        const n = flashFrames[c].filter((ff) => ff >= start && ff < start + win).length;
        if (n > o.flashesPerSec) flashing++;
      }
      const frac = C ? flashing / C : 0;
      if (frac > worst) { worst = frac; worstAt = start; }
    }
    return { worstArea: worst, worstAt };
  };
  const gen = scan(lum, o.swing);
  const rd = scan(red, o.redSwing);
  const fail = gen.worstArea > o.areaFrac || rd.worstArea > o.areaFrac;
  return { general: gen, red: rd, fail };
}

// In-page: run a deterministic clip, per frame downsample the GL framebuffer to
// gridN×gridN relative-luminance + saturated-red cells. Returns { lum, red }.
const CAPTURE = (n, step, dt, gridN) => `(() => {
  const c = window.${S}, d = window.${S}debug;
  const gl = c.stage.renderer.getContext();
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const buf = new Uint8Array(w * h * 4);
  const lum = [], red = [];
  const gx = Math.floor(w / ${gridN}), gy = Math.floor(h / ${gridN});
  for (let f = 0; f < ${n}; f++) {
    d.frames(${step}, ${dt});
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const L = new Array(${gridN} * ${gridN}).fill(0);
    const R = new Array(${gridN} * ${gridN}).fill(0);
    for (let cy = 0; cy < ${gridN}; cy++) for (let cx = 0; cx < ${gridN}; cx++) {
      let sl = 0, sr = 0, cnt = 0;
      const x0 = cx * gx, y0 = cy * gy;
      for (let y = y0; y < y0 + gy; y += 3) for (let x = x0; x < x0 + gx; x += 3) {
        const i = (y * w + x) * 4, r = buf[i], g = buf[i + 1], b = buf[i + 2];
        sl += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        sr += Math.max(0, (r - Math.max(g, b)) / 255);
        cnt++;
      }
      L[cy * ${gridN} + cx] = cnt ? sl / cnt : 0;
      R[cy * ${gridN} + cx] = cnt ? sr / cnt : 0;
    }
    lum.push(L); red.push(R);
  }
  return { lum, red };
})()`;

const server = await ensureServer({ log });
const { browser, page } = await launchBrowser();
await bootGame(page);

let failures = 0;
const report = { clips: [] };

if (!SELFTEST) {
  await enterRun(page);
  // FX-heavy deterministic clips most likely to flash: a crash nova in combat,
  // and a boss entrance (screen flash + punch).
  const clips = [
    { name: "combat-crash", setup: async () => {
      await gotoScenario(page, "room:combat", { settle: 1000 });
      await page.evaluate(`(()=>{ const c=window.${S}, d=window.${S}debug; d.godmode(); if(c.tempo.gain) c.tempo.gain(100); for(const[dx,dz]of[[2,0],[-2,1],[0,2],[1,-2]]){try{c.enemies.spawn("husk",c.player.pos.x+dx,c.player.pos.z+dz,0);}catch{}} })()`);
    } },
    { name: "boss-entrance", setup: async () => {
      await gotoScenario(page, "boss:warden", { settle: 1200 });
    } },
  ];
  for (const clip of clips) {
    await clip.setup();
    await page.evaluate(`window.${S}debug.freezeForTest(false); 0`);
    const grids = await page.evaluate(CAPTURE(PS.frames, 1, PS.dt, PS.gridN));
    const r = analyze(grids.lum, grids.red, PS);
    // Frozen-capture guard: a broken/frozen capture reads 0% flash and would pass a
    // SAFETY gate as "clean". Require real inter-frame luminance motion; if ~0, the
    // result is unreliable — surface it rather than bank a false all-clear.
    let motion = 0;
    for (let f = 1; f < grids.lum.length; f++) for (let c = 0; c < grids.lum[f].length; c++) motion += Math.abs(grids.lum[f][c] - grids.lum[f - 1][c]);
    motion = grids.lum.length ? motion / grids.lum.length : 0;
    const frozen = motion < 0.01;
    report.clips.push({ clip: clip.name, generalArea: +r.general.worstArea.toFixed(3), redArea: +r.red.worstArea.toFixed(3), motion: +motion.toFixed(3), fail: r.fail, frozen });
    log(`${clip.name}: general flash-area ${(r.general.worstArea * 100).toFixed(1)}% red ${(r.red.worstArea * 100).toFixed(1)}% motion=${motion.toFixed(3)} (fail > ${PS.areaFrac * 100}%) ${r.fail ? "FAIL" : frozen ? "WARN(frozen?)" : "ok"}`);
    if (r.fail) failures++;
    else if (frozen) { log(`  WARN: ${clip.name} shows ~no luminance motion — capture may be frozen; flash result unreliable`); report.warnings = (report.warnings ?? 0) + 1; }
  }
} else {
  // Fabricate a full-area 30Hz strobe (every frame flips black↔white) — must FIRE
  // — and a gentle ramp (slow, sub-threshold) — must stay quiet.
  const C = PS.gridN * PS.gridN;
  const strobeL = [], strobeR = [], gentleL = [], gentleR = [];
  for (let f = 0; f < PS.frames; f++) {
    strobeL.push(new Array(C).fill(f % 2 ? 0.95 : 0.05));
    strobeR.push(new Array(C).fill(0));
    gentleL.push(new Array(C).fill(0.4 + 0.05 * Math.sin(f / 12))); // <0.1 swing, slow
    gentleR.push(new Array(C).fill(0));
  }
  const strobe = analyze(strobeL, strobeR, PS);
  const gentle = analyze(gentleL, gentleR, PS);
  log(`selftest: strobe fail=${strobe.fail} (area ${(strobe.general.worstArea * 100).toFixed(0)}%) gentle fail=${gentle.fail}`);
  report.clips.push({ selftest: true, strobeFail: strobe.fail, gentleQuiet: !gentle.fail });
  failures = (strobe.fail && !gentle.fail) ? 0 : 1;
}

writeJSON(join(GAME_DIR, "artifacts", "qa", "photosensitivity.json"), {
  at: new Date().toISOString(), selftest: SELFTEST, report, failures,
});

await browser.close();
server.stop();
if (failures) { log(`FAIL — ${failures} clip(s) exceed the WCAG 2.3.1 flash threshold`); process.exit(Math.min(failures, 99)); }
log(SELFTEST ? "OK — the flash analyzer fires on a 30Hz strobe and stays quiet on gentle motion" : "OK — no clip exceeds 3 flashes/s over 25% area (WCAG 2.3.1)");
