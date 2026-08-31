// Arena background audit: loads each act's combat room (theme + dressing), clears
// enemies, and pulls the camera back to show the arena disc + sky + edge dressing
// + floating rocks. Output → --out.
import { join } from "node:path";
import { launchBrowser, bootGame, sleep, ensureDir, isServerUp, ARTIFACTS } from "./lib.mjs";

const argOut = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : null;
const OUT = argOut || join(ARTIFACTS, "arena", "manual");
const SHOTS = join(OUT, "shots");
ensureDir(SHOTS);
const log = (...a) => console.log("[arena-shots]", ...a);
if (!(await isServerUp())) { console.error("[arena-shots] dev server not on :5174"); process.exit(2); }

const { browser, page, errors } = await launchBrowser();
const shot = async (n) => { await page.screenshot({ path: join(SHOTS, n + ".png") }); log("▸ " + n); };

try {
  await bootGame(page);
  await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
  await sleep(700);
  await page.locator(".hero-card").first().click();
  await sleep(800);
  if (await page.locator(".story-skip").count()) await page.locator(".story-skip").click();
  await sleep(1800);

  for (let act = 1; act <= 5; act++) {
    await page.evaluate((a) => window.__rh3debug.room("combat", a), act);
    await sleep(2200);
    const theme = await page.evaluate(() => {
      const c = window.__rh3;
      for (const e of c.enemies.living()) e.root.visible = false;
      c.arena.setObstacles([], 0);
      c.player.pos.x = 0; c.player.pos.z = 8; c.player.hp = c.player.maxHp;
      return c.run.currentNode?.theme;
    });
    await sleep(400);
    // Wide authored shot shows the irregular floor silhouette and distant set layers.
    await page.evaluate(() => window.__rh3.cam.cinematicShot(0, -2, 1, "wide", 0.2, "linear"));
    await sleep(1400);
    await shot(`act${act}-${theme || "?"}`);
  }

  for (const special of [{ id: "echo", act: 4 }, { id: "wound", act: 5 }]) {
    await page.evaluate(({ id, act }) => {
      const c = window.__rh3;
      c.arena.setActComposition(act, "boss", id);
      for (const e of c.enemies.living()) e.root.visible = false;
      c.arena.setObstacles([], 0);
      c.player.pos.x = 0; c.player.pos.z = 8; c.player.hp = c.player.maxHp;
      c.cam.cinematicShot(0, -2, 1, "wide", 0.2, "linear");
    }, special);
    await sleep(1400);
    await shot(`${special.id}-set`);
  }
} catch (err) {
  errors.push(`THREW: ${err.message}`);
  log("ERROR:", err.message);
} finally {
  log(errors.length ? `CONSOLE ERRORS (${errors.length}): ${errors.slice(0, 6).join(" | ")}` : "NO CONSOLE ERRORS");
  await browser.close();
  process.exit(errors.length === 0 ? 0 : 1);
}
