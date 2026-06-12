// Deep-flow smoke: uses the dev __rh3 hook to force room clears and reach
// the draft screen, later rooms, and the boss. Usage: node scripts/smoke-flow.mjs
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const EXE = join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1217/chrome-win64/chrome.exe");
const OUT = "shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));

await page.goto("http://localhost:5174", { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
await page.locator("button", { hasText: "Begin Run" }).click();
await page.waitForTimeout(3200);

// Kill everything in room 1 → ROOM_CLEARED → draft appears after 1.5s
await page.evaluate(() => {
  const c = window.__rh3;
  for (const e of c.enemies.living()) e.takeDamage(9999);
});
await page.waitForTimeout(800);
await page.screenshot({ path: join(OUT, "6-roomclear.png") });
await page.waitForTimeout(1400);
await page.screenshot({ path: join(OUT, "7-draft.png") });

// Pick the first card
const card = page.locator(".card").first();
if (await card.count()) await card.click();
await page.waitForTimeout(2500);
await page.screenshot({ path: join(OUT, "8-room2.png") });

// Jump to the boss room
await page.evaluate(() => window.__rh3.run.loadRoom(4));
await page.waitForTimeout(3800);
await page.screenshot({ path: join(OUT, "9-boss.png") });

// Let the boss act
await page.waitForTimeout(3500);
await page.screenshot({ path: join(OUT, "10-bossfight.png") });

// Force a phase transition
await page.evaluate(() => {
  const c = window.__rh3;
  const boss = c.enemies.living().find((e) => e.kind === "boss");
  if (boss) boss.takeDamage(140);
});
await page.waitForTimeout(900);
await page.screenshot({ path: join(OUT, "11-bossphase.png") });

// Kill the boss → victory screen
await page.evaluate(() => {
  const c = window.__rh3;
  const boss = c.enemies.living().find((e) => e.kind === "boss");
  if (boss) boss.takeDamage(99999);
});
await page.waitForTimeout(3500);
await page.screenshot({ path: join(OUT, "12-victory.png") });

// Death screen: restart, then self-destruct
await page.locator("button", { hasText: "Run It Back" }).click().catch(() => {});
await page.waitForTimeout(2500);
await page.evaluate(() => {
  const c = window.__rh3;
  c.combat.damagePlayer(9999, 5, 5);
});
await page.waitForTimeout(2300);
await page.screenshot({ path: join(OUT, "13-death.png") });

console.log(errors.length ? `CONSOLE ERRORS (${errors.length}):\n` + errors.slice(0, 12).join("\n") : "NO CONSOLE ERRORS");
await browser.close();
