// Edge-crawl check: whip the camera FAST past the high-contrast crystal edges over a
// frozen scene and capture consecutive frames. Un-anti-aliased edges "sizzle"/crawl (the
// jagged staircase marches) as the camera moves sub-pixel; MSAA holds them stable. Frames
// saved for native-zoom inspection. Forces HIGH quality (MSAA 4x there).
import { launchBrowser, bootGame, enterRun, sleep } from "./loop/lib.mjs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = "shots/fastpan";
mkdirSync(OUT, { recursive: true });
const { browser, page, errors } = await launchBrowser();
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

// Fast whip: ~0.35 units of camera-target travel PER FRAME along a line — enough to march a
// 1px edge staircase hard if it isn't anti-aliased, but the scene stays framed on the crystals.
for (let i = 0; i < 10; i++) {
  const t = i * 0.35;
  await page.evaluate((tx) => window.__rh3.cam.snapTo?.(tx - 1.5, tx * 0.4 - 1), t);
  await sleep(50);
  await page.screenshot({ path: join(OUT, `pan-${String(i).padStart(2, "0")}.png`) });
}
console.log(errors.length ? `ERRORS: ${errors.slice(0, 4).join("\n")}` : "NO CONSOLE ERRORS");
await browser.close();
process.exit(0);
