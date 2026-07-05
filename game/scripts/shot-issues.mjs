// Capture the problem areas the owner reported: hero-select figures, map features
// (spikes/fire/hazard/drifter/sweeper — glitch + spread), a line telegraph, and the
// act interlude (two lights). → shots/issues/
import { launchBrowser, bootGame, enterRun, gotoScenario, sleep } from "./loop/lib.mjs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = "shots/issues";
mkdirSync(OUT, { recursive: true });
const { browser, page, errors } = await launchBrowser();
const shot = (n) => page.screenshot({ path: join(OUT, `${n}.png`) });

await bootGame(page);

// 1) Hero-select screen (the "silly" characters).
await page.locator("button", { hasText: /Begin Run|New Run/ }).click().catch(() => {});
await sleep(1200);
await shot("01-hero-select");

// 2) Enter a combat room, then force each map feature and screenshot it.
await enterRun(page);
await page.evaluate(() => window.__rh3debug?.godmode?.());
for (const feat of ["spikes", "flamevent", "hazard", "drifters", "sweeper"]) {
  await page.evaluate((f) => {
    const c = window.__rh3;
    for (const e of c.enemies.living()) e.takeDamage?.(99999); // clear pack to see the feature
    c.features.setup({ feature: f, bossKind: null });
    c.player.pos.set(0, 0, 8);
  }, feat);
  await sleep(900);
  await shot(`02-feat-${feat}`);
}

// 3) A line telegraph (projectile trajectory) + a spitter's own.
await page.evaluate(() => {
  const c = window.__rh3;
  c.features.setup({ feature: "none", bossKind: null });
  c.enemies.spawn("spitter", 0, 0, -6);
  c.player.pos.set(0, 0, 6);
  c.tele.line(0, 0, 0.3, 14, 0.6, 3, 0xff5544); // a standalone line to eyeball the look
});
await sleep(500);
await shot("03-line-telegraph");

// 4) The act interlude (two lights + words).
await page.evaluate(() => window.__rh3debug?.interlude?.(2));
await sleep(1400);
await shot("04-interlude");

console.log(errors.length ? `ERRORS: ${errors.slice(0, 5).join("\n")}` : "NO CONSOLE ERRORS");
await browser.close();
process.exit(0);
