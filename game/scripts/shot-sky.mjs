// Sky showcase: load each act's theme, swing the camera to the menu-orbit (low,
// horizon-filling) angle so the per-act sky signature is actually in frame.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const EXE = join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1217/chrome-win64/chrome.exe");
mkdirSync("shots", { recursive: true });

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && !/ws:\/\/localhost|WebSocket|ERR_CONNECTION_REFUSED/.test(m.text()) && errors.push(m.text()));
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
await page.waitForTimeout(1800);

for (let act = 1; act <= 5; act++) {
  await page.evaluate((a) => window.__rh3.run.debugLoadNode("combat", a), act);
  await page.waitForTimeout(400);
  // Swing to the orbit camera and hide combat HUD chrome so the sky leads.
  await page.evaluate(() => {
    const c = window.__rh3;
    c.cam.mode = "menu";
    if (c.player) c.player.hp = c.player.maxHp;
  });
  await page.waitForTimeout(2600); // theme crossfade + orbit
  await page.screenshot({ path: `shots/skyshow-act${act}-a.png` });
  await page.waitForTimeout(1300);
  await page.screenshot({ path: `shots/skyshow-act${act}-b.png` });
  await page.waitForTimeout(1300);
  await page.screenshot({ path: `shots/skyshow-act${act}-c.png` });
}

console.log(errors.length ? `CONSOLE ERRORS (${errors.length}):\n` + errors.slice(0, 12).join("\n") : "NO CONSOLE ERRORS");
await browser.close();
