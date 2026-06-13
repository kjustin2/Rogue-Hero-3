// Visual audit: spawns the fixed enemies near the player and screenshots them
// from several camera-relative positions (z-fighting is angle-dependent).
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
await page.waitForTimeout(2600);

// Clear the starting room's enemies, then place the subjects around the player
await page.evaluate(() => {
  const c = window.__rh3;
  for (const e of c.enemies.living()) e.dispose();
  c.enemies.clear();
  c.run.state = "idle"; // freeze room logic so nothing else spawns
  c.enemies.spawn("mirror", c.player.pos.x - 3, c.player.pos.z - 4, 0.1);
  c.enemies.spawn("sentinel", c.player.pos.x + 3.5, c.player.pos.z - 4, 0.1);
});
for (let i = 0; i < 4; i++) {
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const c = window.__rh3;
    c.player.hp = c.player.maxHp;
  });
  await page.screenshot({ path: `shots/visual-mirror-${i}.png` });
}

console.log(errors.length ? `CONSOLE ERRORS:\n` + errors.join("\n") : "NO CONSOLE ERRORS");
await browser.close();
