// Captures line-telegraph alignment: sentinel beam aim + boss dash charge.
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
await page.locator("button", { hasText: "Begin Run" }).click();
await page.waitForTimeout(2500);

// Sentinel room — kill everything else so only the sentinel acts
await page.evaluate(() => {
  const c = window.__rh3;
  c.run.loadRoom(3);
});
await page.waitForTimeout(2200);
await page.evaluate(() => {
  const c = window.__rh3;
  for (const e of c.enemies.living()) if (e.kind !== "sentinel") e.takeDamage(9999);
});
// Sentinel locks aim ~1.25s into its cycle; sample a few frames
for (let i = 0; i < 4; i++) {
  await page.waitForTimeout(1100);
  await page.screenshot({ path: `shots/20-sentinel-${i}.png` });
}

// Boss room — wait through spawn + first dash tell
await page.evaluate(() => window.__rh3.run.loadRoom(4));
await page.waitForTimeout(3000);
for (let i = 0; i < 5; i++) {
  await page.waitForTimeout(650);
  await page.screenshot({ path: `shots/21-boss-${i}.png` });
}

console.log(errors.length ? `CONSOLE ERRORS:\n` + errors.join("\n") : "NO CONSOLE ERRORS");
await browser.close();
