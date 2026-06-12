// Captures the Spire Caster and Colossus across their phases.
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

// The smoke player never dodges — keep them alive through the captures
const godmode = () => page.evaluate(() => {
  const c = window.__rh3;
  c.player.hp = c.player.maxHp;
});

const boss = async (room, tag, phaseDmg) => {
  await page.evaluate((r) => window.__rh3.run.loadRoom(r), room);
  await page.waitForTimeout(3400); // intro + spawn
  for (let i = 0; i < 3; i++) {
    await godmode();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `shots/${tag}-p1-${i}.png` });
  }
  // Push to phase 2
  await page.evaluate((dmg) => {
    const c = window.__rh3;
    const b = c.enemies.living().find((e) => e.kind === "boss");
    if (b) b.takeDamage(dmg);
  }, phaseDmg);
  for (let i = 0; i < 4; i++) {
    await godmode();
    await page.waitForTimeout(1600);
    await page.screenshot({ path: `shots/${tag}-p2-${i}.png` });
  }
  // Push to phase 3
  await page.evaluate((dmg) => {
    const c = window.__rh3;
    const b = c.enemies.living().find((e) => e.kind === "boss");
    if (b) b.takeDamage(dmg);
  }, phaseDmg);
  for (let i = 0; i < 4; i++) {
    await godmode();
    await page.waitForTimeout(1700);
    await page.screenshot({ path: `shots/${tag}-p3-${i}.png` });
  }
  await godmode();
};

await boss(5, "spire", 160);
await boss(8, "colossus", 230);

console.log(errors.length ? `CONSOLE ERRORS (${errors.length}):\n` + errors.slice(0, 10).join("\n") : "NO CONSOLE ERRORS");
await browser.close();
