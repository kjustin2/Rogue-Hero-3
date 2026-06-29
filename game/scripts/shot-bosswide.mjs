// Wide orbit-cam capture of the reworked melee/rooted bosses so their radial
// attacks (Warden ember-fan/fissure, Colossus magma-nova) and arm animation are
// fully in frame. Dense frames catch the projectile rings mid-flight.
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

// Pin the player to the arena edge so a rooted/central boss frames its full attack
// fans, and the follow distance is large.
const setup = (px, pz) => page.evaluate(({ px, pz }) => {
  const c = window.__rh3;
  c.cam.mode = "menu";
  if (c.player) { c.player.hp = c.player.maxHp; c.player.pos.x = px; c.player.pos.z = pz; }
}, { px, pz });

const wide = async (act, tag, dmg) => {
  await page.evaluate((a) => window.__rh3.run.debugLoadNode("boss", a), act);
  await page.waitForTimeout(3600);
  // Drive straight to phase 3 so the full kit is online.
  await page.evaluate((d) => {
    const b = window.__rh3.enemies.living().find((e) => e.kind === "boss");
    if (b) b.takeDamage(d);
  }, dmg);
  await page.waitForTimeout(200);
  await page.evaluate((d) => {
    const b = window.__rh3.enemies.living().find((e) => e.kind === "boss");
    if (b) b.takeDamage(d);
  }, dmg);
  for (let i = 0; i < 16; i++) {
    await setup(9, 9);
    await page.waitForTimeout(650);
    await page.screenshot({ path: `shots/wide-${tag}-${String(i).padStart(2, "0")}.png` });
  }
};

await wide(1, "warden", 480);
await wide(3, "colossus", 1050);

console.log(errors.length ? `CONSOLE ERRORS (${errors.length}):\n` + errors.slice(0, 12).join("\n") : "NO CONSOLE ERRORS");
await browser.close();
