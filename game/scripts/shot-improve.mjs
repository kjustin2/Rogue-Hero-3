// Capture each act's sky + the reworked bosses (1 Warden, 3 Colossus, 5 Unmaker).
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

async function gotoReady() {
  for (let i = 0; i < 40; i++) {
    try { await page.goto("http://localhost:5174", { waitUntil: "networkidle", timeout: 4000 }); return; }
    catch { await page.waitForTimeout(500); }
  }
  throw new Error("dev server never came up on :5174");
}

await gotoReady();
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
await page.waitForTimeout(2000);

const godmode = () => page.evaluate(() => {
  const c = window.__rh3;
  if (c?.player) c.player.hp = c.player.maxHp;
});

// --- Act skies: jump to a combat node per act, let the theme settle, shoot the sky.
for (let act = 1; act <= 5; act++) {
  await page.evaluate((a) => window.__rh3.run.debugLoadNode("combat", a), act);
  await page.waitForTimeout(2600); // theme crossfade + a few frames
  await godmode();
  await page.screenshot({ path: `shots/sky-act${act}-a.png` });
  await page.waitForTimeout(1100); // catch a different moment (lightning/embers)
  await godmode();
  await page.screenshot({ path: `shots/sky-act${act}-b.png` });
}

// --- Bosses: 1 Warden, 3 Colossus, 5 Unmaker. Capture each phase across many frames
//     so the new attacks (fan/fissure, nova, sweep) land in shot.
const boss = async (act, tag, phaseDmg) => {
  await page.evaluate((a) => window.__rh3.run.debugLoadNode("boss", a), act);
  await page.waitForTimeout(3600); // intro + spawn
  for (let i = 0; i < 3; i++) {
    await godmode();
    await page.waitForTimeout(1400);
    await page.screenshot({ path: `shots/${tag}-p1-${i}.png` });
  }
  await page.evaluate((dmg) => {
    const b = window.__rh3.enemies.living().find((e) => e.kind === "boss");
    if (b) b.takeDamage(dmg);
  }, phaseDmg);
  for (let i = 0; i < 4; i++) {
    await godmode();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `shots/${tag}-p2-${i}.png` });
  }
  await page.evaluate((dmg) => {
    const b = window.__rh3.enemies.living().find((e) => e.kind === "boss");
    if (b) b.takeDamage(dmg);
  }, phaseDmg);
  for (let i = 0; i < 5; i++) {
    await godmode();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `shots/${tag}-p3-${i}.png` });
  }
  await godmode();
};

await boss(1, "warden", 520);
await boss(3, "colossus", 1150);
await boss(5, "unmaker", 1900);

console.log(errors.length ? `CONSOLE ERRORS (${errors.length}):\n` + errors.slice(0, 12).join("\n") : "NO CONSOLE ERRORS");
await browser.close();
