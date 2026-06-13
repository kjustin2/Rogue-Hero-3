// Relic flow: clear the elite chamber → "CHOOSE A RELIC" → pick → HUD icon row.
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
await page.waitForTimeout(1800);
await page.evaluate(() => localStorage.removeItem("rh3v2-runsave"));
await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
await page.waitForTimeout(700);
await page.locator(".hero-card").first().click();
await page.waitForTimeout(800);
if (await page.locator(".story-skip").count()) {
  await page.locator(".story-skip").click();
  await page.waitForTimeout(600);
}
await page.waitForTimeout(2500);

// Jump to the elite chamber (room 2) and clear it
await page.evaluate(() => window.__rh3.run.loadRoom(2));
for (let tries = 0; tries < 16; tries++) {
  const state = await page.evaluate(() => {
    const c = window.__rh3;
    for (const e of c.enemies.living()) e.takeDamage(99999);
    return c.run.state;
  });
  if (state !== "fighting") break;
  await page.waitForTimeout(450);
}
await page.waitForTimeout(1900);

const title = await page.locator(".draft-title").textContent().catch(() => "");
console.log("DRAFT TITLE:", JSON.stringify(title), title?.includes("RELIC") ? "OK" : "FAIL");
await page.screenshot({ path: "shots/relic-draft.png" });

// Pick the first relic
await page.locator(".card").first().click();
await page.waitForTimeout(2600);
const relicCount = await page.locator(".relic").count();
console.log("HUD RELIC CHIPS:", relicCount, relicCount === 1 ? "OK" : "FAIL");
await page.screenshot({ path: "shots/relic-hud.png" });

console.log(errors.length ? `CONSOLE ERRORS:\n` + errors.join("\n") : "NO CONSOLE ERRORS");
await browser.close();
