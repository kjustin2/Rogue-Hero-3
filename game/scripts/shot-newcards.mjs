// Clean capture of the 6 new hero-card VFX. Enemies are made INVINCIBLE so casting doesn't
// clear the room (which overlapped a boss-death story card on the first pass). Player centered.
import { launchBrowser, bootGame, enterRun, sleep } from "./loop/lib.mjs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = "shots/verify";
mkdirSync(OUT, { recursive: true });
const { browser, page, errors } = await launchBrowser();
const shot = (n) => page.screenshot({ path: join(OUT, `${n}.png`) });

await bootGame(page);
await enterRun(page);
await page.evaluate(() => window.__rh3.stage.applyQuality?.("high"));
await sleep(600);
await page.evaluate(() => window.__rh3debug?.godmode?.());
await page.evaluate(() => window.__rh3debug.room("combat", 1));
for (let i = 0; i < 8; i++) {
  if ((await page.evaluate(() => (window.__rh3state ? window.__rh3state() : "?"))) === "playing") break;
  await page.evaluate(() => window.__rh3debug?.skipCutscene?.());
  await sleep(220);
}
await page.evaluate(() => window.__rh3debug?.godmode?.());
await sleep(1000);

for (const id of ["tempo-surge", "hammer-drop", "arc-overload", "feral-leap", "gale-burst", "soul-drain"]) {
  await page.evaluate(() => {
    const c = window.__rh3;
    if (c.enemies.living().length < 3) for (const r of [-3, 0, 3]) c.enemies.spawn?.("husk", r, 0, 3);
    for (const e of c.enemies.living()) { e.hp = 999999; e.maxHp = 999999; } // invincible → room never clears
    c.player.pos.set(0, 0, 0); c.cam.snapTo?.(0, 0); c.fx.clear?.();
  });
  await sleep(220);
  await page.evaluate((cid) => {
    const def = window.__rh3cards.find((c) => c.id === cid);
    const caster = window.__rh3.caster || window.__rh3.deck;
    if (def && caster && typeof caster.cast === "function") caster.cast(def, false);
  }, id);
  await sleep(160); // catch the VFX peak
  await shot(`40-card-${id}`);
  await sleep(600);
}

console.log(errors.length ? `ERRORS: ${errors.slice(0, 4).join("\n")}` : "NO CONSOLE ERRORS");
await browser.close();
process.exit(0);
