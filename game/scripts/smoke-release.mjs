// Release smoke: hero select, obstacles, save/continue, armory purchase,
// shard earnings — the new systems in one pass.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const EXE = join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1217/chrome-win64/chrome.exe");
mkdirSync("shots", { recursive: true });

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));

await page.goto("http://localhost:5174", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.removeItem("rh3v2-runsave");
  localStorage.removeItem("rh3v2-profile");
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1800);

// --- Hero select: 3 cards, 2 locked on a fresh profile
await page.locator("button", { hasText: "Begin Run" }).click();
await page.waitForTimeout(700);
const heroes = await page.locator(".hero-card").count();
const lockedHeroes = await page.locator(".hero-card--locked").count();
console.log(`HERO SELECT: ${heroes} heroes, ${lockedHeroes} locked`, heroes === 3 && lockedHeroes === 2 ? "OK" : "FAIL");
await page.screenshot({ path: "shots/r-heroselect.png" });
await page.locator(".hero-card").first().click();
await page.waitForTimeout(800);
if (await page.locator(".story-skip").count()) {
  await page.locator(".story-skip").click();
  await page.waitForTimeout(600);
}
await page.waitForTimeout(2500);

// --- Obstacles: jump to The Shattered Court and check pillars block movement
await page.evaluate(() => window.__rh3.run.loadRoom(1));
await page.waitForTimeout(1500);
const obstacleCheck = await page.evaluate(() => {
  const c = window.__rh3;
  const obs = c.arena.obstacles;
  // Teleport the player inside a pillar; resolution should push them out
  c.player.pos.set(obs[0].x, 0, obs[0].z);
  c.controller.update(0.016);
  const d = Math.hypot(c.player.pos.x - obs[0].x, c.player.pos.z - obs[0].z);
  return { count: obs.length, pushedOut: d >= obs[0].r };
});
console.log(`OBSTACLES: ${obstacleCheck.count} pillars, push-out ${obstacleCheck.pushedOut ? "OK" : "FAIL"}`);
await page.screenshot({ path: "shots/r-obstacles.png" });

// --- Clear the room, take the draft → checkpoint written
for (let tries = 0; tries < 16; tries++) {
  const st = await page.evaluate(() => {
    const c = window.__rh3;
    for (const e of c.enemies.living()) e.takeDamage(99999);
    return c.run.state;
  });
  if (st !== "fighting") break;
  await page.waitForTimeout(450);
}
await page.waitForTimeout(1900);
if (await page.locator(".card").count()) {
  await page.locator(".card").first().click();
  await page.waitForTimeout(450);
  if (await page.locator(".card").count()) await page.locator(".card").first().click();
}
await page.waitForTimeout(1200);
const save = await page.evaluate(() => JSON.parse(localStorage.getItem("rh3v2-runsave") || "null"));
const shards = await page.evaluate(() => window.__rh3.stats.shards);
console.log("CHECKPOINT:", save ? `room ${save.roomIndex} hero ${save.hero} OK` : "MISSING");
console.log("SHARDS EARNED:", shards, shards > 0 ? "OK" : "FAIL");

// --- Reload mid-run → Continue Run resumes at the checkpoint
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1800);
const contBtn = page.locator("button", { hasText: "Continue Run" });
console.log("CONTINUE BUTTON:", (await contBtn.count()) > 0 ? "OK" : "MISSING");
await page.screenshot({ path: "shots/r-continue.png" });
await contBtn.click();
await page.waitForTimeout(2500);
const resumed = await page.evaluate(() => ({
  idx: window.__rh3.run.roomIndex,
  shards: window.__rh3.stats.shards,
}));
console.log(`RESUMED: room ${resumed.idx}, shards ${resumed.shards}`, resumed.idx === save.roomIndex ? "OK" : "FAIL");

// --- Bank shards via abandon, then buy a cosmetic in the Armory
await page.keyboard.press("Escape");
await page.waitForTimeout(500);
await page.locator("button", { hasText: "Abandon Run" }).click();
await page.waitForTimeout(900);
await page.evaluate(() => { window.__rh3.profile.data.shards = 500; });
await page.locator("button", { hasText: "Armory" }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: "shots/r-armory.png" });
// Buy the second cape (Emerald Mantle, 150)
await page.locator('.shop-item[data-id="cape-emerald"]').click();
await page.waitForTimeout(500);
const bought = await page.evaluate(() => {
  const p = JSON.parse(localStorage.getItem("rh3v2-profile"));
  return { owned: p.cosmeticsOwned.includes("cape-emerald"), equipped: p.equipped.cape, shards: p.shards };
});
console.log(`ARMORY: owned=${bought.owned} equipped=${bought.equipped} shards=${bought.shards}`,
  bought.owned && bought.equipped === "cape-emerald" && bought.shards === 350 ? "OK" : "FAIL");
await page.screenshot({ path: "shots/r-armory-bought.png" });

console.log(errors.length ? `CONSOLE ERRORS (${errors.length}):\n` + errors.slice(0, 10).join("\n") : "NO CONSOLE ERRORS");
await browser.close();
