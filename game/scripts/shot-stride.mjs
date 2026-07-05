// Enemy stride check: a husk walks a circle; assert its registered legs SWING with
// movement (leg rotation oscillates through + and -), proving feet step, not slide.
import { launchBrowser, bootGame, enterRun, sleep } from "./loop/lib.mjs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = "shots/stride";
mkdirSync(OUT, { recursive: true });
const { browser, page, errors } = await launchBrowser();
await bootGame(page);
await enterRun(page);
await page.evaluate(() => window.__rh3debug?.godmode?.());
await page.evaluate(() => {
  const c = window.__rh3;
  for (const e of c.enemies.living()) e.takeDamage(99999);
  c.enemies.spawn("husk", 3, 0, 0);
  window.__st = 0;
});
await sleep(120);
const hasLegs = await page.evaluate(() => {
  const h = window.__rh3.enemies.living().find((e) => e.kind === "husk");
  return !!(h && h.legL && h.legR);
});
console.log(`husk has registered legs: ${hasLegs}`);

const samples = [];
for (let i = 0; i < 12; i++) {
  // Find the husk fresh (avoid stale living() cache) and drive it around a circle.
  const r = await page.evaluate(() => {
    const c = window.__rh3;
    const h = c.enemies.living().find((e) => e.kind === "husk");
    if (!h) return null;
    window.__st += 0.5;
    h.pos.x = Math.cos(window.__st) * 3.2;
    h.pos.z = Math.sin(window.__st) * 3.2;
    h.hp = 9999;
    c.player.pos.set(h.pos.x, 0, h.pos.z + 0.4);
    return h.legL ? h.legL.rotation.x : null;
  });
  await sleep(90);
  if (r !== null) samples.push(+r.toFixed(3));
  if (i === 6) await page.screenshot({ path: join(OUT, "stride-walk.png") });
}

const max = Math.max(...samples), min = Math.min(...samples);
const swings = max > 0.08 && min < -0.08; // legs clearly rotate both ways = stepping
console.log(`legL.rotation.x samples: ${samples.join(" ")}`);
console.log(`${swings ? "PASS" : "FAIL"} husk legs swing (min ${min}, max ${max})`);
console.log(errors.length ? `ERRORS: ${errors.slice(0, 4).join("\n")}` : "NO CONSOLE ERRORS");
await browser.close();
process.exit(swings && errors.length === 0 ? 0 : 1);
