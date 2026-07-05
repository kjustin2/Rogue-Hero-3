// Reproduce the "objects fill with black when moving" glitch: spread enemies from
// center to the rim, walk the player outward, capture frames — rim objects that fall
// outside the (tightened) shadow frustum render fully-shadowed (black).
import { launchBrowser, bootGame, enterRun, sleep } from "./loop/lib.mjs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = "shots/shadow";
mkdirSync(OUT, { recursive: true });
const { browser, page, errors } = await launchBrowser();
const shot = (n) => page.screenshot({ path: join(OUT, `${n}.png`) });

await bootGame(page);
await enterRun(page);
await page.evaluate(() => window.__rh3debug?.godmode?.());
await page.evaluate(() => {
  const c = window.__rh3;
  for (const e of c.enemies.living()) e.takeDamage?.(99999);
  // Enemies fanned out along +X from center to the rim (arena radius ~19).
  for (const r of [4, 8, 12, 16, 18]) c.enemies.spawn("husk", r, 0, 0);
  for (const r of [6, 11, 15]) c.enemies.spawn("brute", 0, 0, r);
});
// Walk the player toward the rim, capturing as the camera + objects move.
for (let i = 0; i < 5; i++) {
  const px = 2 + i * 3.6; // 2 → 16.4 along +X toward the rim
  await page.evaluate((x) => {
    const c = window.__rh3;
    c.player.pos.set(x, 0, 0);
    c.cam.snapTo(x, 0);
    for (const e of c.enemies.living()) e.hp = 9999;
  }, px);
  await sleep(260);
  await shot(`walk-${i}`);
}
console.log(errors.length ? `ERRORS: ${errors.slice(0, 4).join("\n")}` : "NO CONSOLE ERRORS");
await browser.close();
process.exit(0);
