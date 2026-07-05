// GLITCH BISECT. The remaining "glitching" is MOTION-triggered (shows as the camera moves,
// not on a dead-still frame), which is why the frozen-shimmer test reads clean. So: freeze
// the WORLD (__rh3debug.freezeForTest — no animation) and move ONLY the camera in tiny steps.
// Any frame-to-frame change is then camera-motion-induced. A smoothly-panning scene has a
// modest, even diff; a GLITCH (env-map specular flipping on flat faces, z-fighting, banding
// crawl) adds localized instability on top. We run the same nudge under several effect
// configs and compare the mean consecutive-frame diff — the config where it DROPS is the
// culprit. Frames saved for eyeballing.
import { launchBrowser, bootGame, enterRun, sleep } from "./loop/lib.mjs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = "shots/glitch";
mkdirSync(OUT, { recursive: true });
const { browser, page, errors } = await launchBrowser();

// Nudge the camera in a small circle over the FROZEN scene, capturing N frames, and return
// the mean absolute per-channel consecutive-frame diff (+ save the frames under `tag`).
const nudgeDiff = async (tag, frames = 10) => {
  const b64s = [];
  for (let i = 0; i < frames; i++) {
    const a = (i / frames) * Math.PI * 2;
    await page.evaluate(([x, z]) => window.__rh3.cam.snapTo?.(x, z), [Math.cos(a) * 1.2, Math.sin(a) * 1.2 - 1]);
    await sleep(60);
    const buf = await page.screenshot({ path: join(OUT, `${tag}-${String(i).padStart(2, "0")}.png`) });
    b64s.push(Buffer.from(buf).toString("base64"));
  }
  return page.evaluate(async (imgs) => {
    const decode = async (b) => {
      const img = new Image(); img.src = "data:image/png;base64," + b; await img.decode();
      const cv = document.createElement("canvas"); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      const g = cv.getContext("2d"); g.drawImage(img, 0, 0);
      return g.getImageData(0, 0, cv.width, cv.height).data;
    };
    let prev = await decode(imgs[0]); let total = 0, pairs = 0;
    for (let i = 1; i < imgs.length; i++) {
      const cur = await decode(imgs[i]); let sum = 0;
      for (let p = 0; p < cur.length; p += 4)
        sum += Math.abs(cur[p] - prev[p]) + Math.abs(cur[p + 1] - prev[p + 1]) + Math.abs(cur[p + 2] - prev[p + 2]);
      total += sum / ((cur.length / 4) * 3); pairs++; prev = cur;
    }
    return total / pairs;
  }, b64s);
};

await bootGame(page);
await enterRun(page);
await page.evaluate(() => window.__rh3.stage.applyQuality?.("high"));
await sleep(700);
await page.evaluate(() => {
  const c = window.__rh3;
  window.__rh3debug?.godmode?.();
  for (const e of c.enemies.living()) e.freeze?.(9999);
  c.fx.clear?.();
});
await sleep(300);
await page.evaluate(() => window.__rh3debug.freezeForTest(true));
await sleep(150);

const results = {};
// A) Full stack (env + bloom + CA + SMAA + grade) — the current build.
results.full = await nudgeDiff("A-full");
// B) Env map OFF (kills view-dependent IBL specular).
await page.evaluate(() => { window.__rh3.stage.scene.environment = null; });
results.noEnv = await nudgeDiff("B-noenv");
// C) Env OFF + Bloom OFF.
await page.evaluate(() => { if (window.__rh3.stage.bloom) window.__rh3.stage.bloom.intensity = 0; });
results.noEnvNoBloom = await nudgeDiff("C-noenv-nobloom");
// D) Env OFF + Bloom OFF + lean menu composer (basically bare render + vignette/grade).
await page.evaluate(() => window.__rh3.stage.setLowCost(true));
results.bare = await nudgeDiff("D-bare");

console.log("=== camera-nudge glitch bisect (mean consecutive-frame diff /255) ===");
for (const [k, v] of Object.entries(results)) console.log(`${k.padEnd(14)} ${v.toFixed(2)}`);
console.log(errors.length ? `ERRORS: ${errors.slice(0, 4).join("\n")}` : "NO CONSOLE ERRORS");
await browser.close();
process.exit(0);
