// Full-run smoke: navigates the generated forked map to victory, then a death.
// State-driven: each tick it kills any enemies, then resolves whatever screen is up
// (map fork, draft, shop, treasure, rest, event). Always picks a combat/elite path
// so it reaches each act boss.
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
await page.waitForTimeout(2000);
await page.evaluate(() => localStorage.removeItem("rh3v2-runsave"));
await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
await page.waitForTimeout(700);
await page.locator(".hero-card").first().click();
await page.waitForTimeout(800);
if (await page.locator(".story-skip").count()) { await page.locator(".story-skip").click(); await page.waitForTimeout(600); }
await page.waitForTimeout(2500);

const click = async (loc) => { if (await loc.count()) { await loc.first().click(); await page.waitForTimeout(400); return true; } return false; };

let victory = false;
let mapsSeen = 0, shopsSeen = 0, lastPos = -1, stuck = 0;
let actStories = 0;
for (let step = 0; step < 420 && !victory; step++) {
  const st = await page.evaluate(() => {
    const c = window.__rh3;
    if (c.run.state === "fighting") for (const e of c.enemies.living()) e.takeDamage(99999);
    return { state: c.run.state, pos: c.run.position, total: c.run.totalForks };
  });
  if (st.state === "victory") { victory = true; break; }
  if (st.pos === lastPos) stuck++; else { stuck = 0; lastPos = st.pos; }
  await page.waitForTimeout(330);

  // Resolve whatever screen is up (priority order)
  if (await page.locator(".story-skip").count()) {
    actStories++;
    await click(page.locator(".story-skip")); // act-transition cutscene
  } else if (await page.locator(".mapnode").count()) {
    mapsSeen++;
    const fight = page.locator(".mapnode--combat, .mapnode--elite");
    if (!(await click(fight))) await click(page.locator(".mapnode"));
  } else if (await page.locator("button", { hasText: "Leave the Shop" }).count()) {
    shopsSeen++;
    await click(page.locator("button", { hasText: "Leave the Shop" }));
  } else if (await page.locator("button", { hasText: "Move On" }).count()) {
    await click(page.locator("button", { hasText: "Move On" }));
  } else if (await page.locator(".card").count()) {
    await click(page.locator(".card"));
    if (await page.locator(".card").count()) await click(page.locator(".card")); // swap stage
  } else if (await page.locator(".draft-skip").count()) {
    await click(page.locator(".draft-skip"));
  } else if (await page.locator(".panel .menu-buttons .btn").count()) {
    await click(page.locator(".panel .menu-buttons .btn")); // event choice
  }
}

console.log(`maps seen: ${mapsSeen}, shops: ${shopsSeen}, act stories: ${actStories}, final pos: ${lastPos}`);
console.log("VICTORY:", victory ? "OK" : "FAIL (never reached)");
// The bittersweet ending cutscene plays before the end screen — skip through it.
let victoryShown = 0, endingSkips = 0;
for (let i = 0; i < 40; i++) {
  if (await page.locator(".story-skip").count()) { await page.locator(".story-skip").click(); endingSkips++; }
  victoryShown = await page.locator(".end-title--victory").count();
  if (victoryShown > 0) break;
  await page.waitForTimeout(400);
}
console.log(`ENDING CUTSCENE: ${endingSkips > 0 ? "played" : "none"}`);
console.log("VICTORY SCREEN:", victoryShown > 0 ? "OK" : "MISSING");

// Death path
const again = page.locator("button", { hasText: "Run It Back" });
if (await again.count()) {
  await again.click();
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__rh3.combat.damagePlayer(99999, 3, 3));
  await page.waitForTimeout(2400);
  console.log("DEATH SCREEN:", (await page.locator(".end-title--death").count()) > 0 ? "OK" : "MISSING");
}

console.log(errors.length ? `CONSOLE ERRORS (${errors.length}):\n` + errors.slice(0, 10).join("\n") : "NO CONSOLE ERRORS");
await browser.close();
process.exit(victory && errors.length === 0 ? 0 : 1);
