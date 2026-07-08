// CONTEXT-LOSS RESILIENCE — simulate GPU device-lost mid-combat and prove the
// game survives it: no game-code throws while the context is gone, the frame
// loop keeps ticking, and after restore the canvas paints non-black again
// (three re-inits GL + lazily re-uploads; main.ts re-warms the program cache
// and falls back to a lossless reload if restore never comes).
//
//   node scripts/smoke-context-loss.mjs     (dev server on :5174)
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import {
  launchBrowser, bootGame, enterRun, sleep, shotStats, shotFlags, GAME_DIR,
} from "./loop/lib.mjs";

const { browser, page, errors } = await launchBrowser();
const fails = [];
const expect = (cond, msg) => { if (cond) console.log(`  ✓ ${msg}`); else { fails.push(msg); console.log(`  ✗ ${msg}`); } };
const poll = async (fn, ms, every = 200) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(every); }
  return false;
};

await bootGame(page);
await enterRun(page);
await sleep(800);

// Sanity: playing, context healthy.
expect(await page.evaluate(() => window.__rh3state?.() === "playing"), "in combat before the loss");

// 1) Simulate device-lost via the standard extension.
await page.evaluate(() => {
  const gl = window.__rh3.stage.renderer.getContext();
  window.__lc = gl.getExtension("WEBGL_lose_context");
  window.__lc.loseContext();
});
expect(
  await poll(() => page.evaluate(() => window.__rh3debug.contextLost()), 3000),
  "watchdog saw webglcontextlost",
);

// 2) While lost: the rAF loop must keep scheduling and game code must not throw.
await sleep(1200);
const ferrLost = await page.evaluate(() => window.__rh3debug.frameErrors().length);
expect(ferrLost === 0, `no frame-loop throws while context lost (got ${ferrLost})`);

// 3) Restore → watchdog clears, shaders re-warm, canvas paints again.
await page.evaluate(() => window.__lc.restoreContext());
expect(
  await poll(() => page.evaluate(() => !window.__rh3debug.contextLost()), 8000),
  "context restored within 8s",
);
await sleep(2500); // re-warm + a few live frames

const SHOTS = join(GAME_DIR, "shots");
mkdirSync(SHOTS, { recursive: true });
const shotPath = join(SHOTS, "context-restore.png");
await page.screenshot({ path: shotPath });
const s = await shotStats(page, shotPath);
const flags = shotFlags(s);
expect(!flags.includes("BLACK") && !flags.includes("FLAT"), `post-restore frame renders (flags: ${flags.join(",") || "none"}, lum ${s.meanLum})`);

const ferrEnd = await page.evaluate(() => window.__rh3debug.frameErrors().length);
expect(ferrEnd === 0, `no frame-loop throws across the whole loss/restore (got ${ferrEnd})`);

// Console noise: the loss itself legitimately logs "Context Lost" lines — only
// UNEXPECTED errors fail the smoke.
const unexpected = errors.filter((e) => !/context (lost|restored)|WebGL context/i.test(e));
expect(unexpected.length === 0, `no unexpected console errors (got ${unexpected.length})`);
if (unexpected.length) console.log(unexpected.slice(0, 6).join("\n"));

console.log(fails.length ? `\nFAILURES (${fails.length}):\n- ${fails.join("\n- ")}` : "\nNO CONSOLE ERRORS");
await browser.close();
process.exit(fails.length ? 1 : 0);
