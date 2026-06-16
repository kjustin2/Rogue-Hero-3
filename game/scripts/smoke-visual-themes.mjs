// Captures act floor identities after the arena swaps theme textures.
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
await page.evaluate(() => localStorage.removeItem("rh3v2-runsave"));
await page.waitForTimeout(1600);
await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
await page.waitForTimeout(700);
await page.locator(".hero-card").first().click();
await page.waitForTimeout(800);
if (await page.locator(".story-skip").count()) {
  await page.locator(".story-skip").click();
  await page.waitForTimeout(600);
}

const acts = [
  [1, "ember-rift"],
  [2, "shattered-spire"],
  [3, "molten-core"],
  [4, "sundered-abyss"],
  [5, "hollow-star"],
];

for (const [act, tag] of acts) {
  await page.evaluate((a) => {
    const c = window.__rh3;
    window.__rh3menus.clear();
    c.run.debugLoadNode("combat", a, 9000 + a, 0);
    c.run.state = "cleared";
    c.enemies.clear();
    c.projectiles.clear();
    c.hostiles.clear();
    c.caster.clear();
    c.features.clear();
    c.player.pos.set(0, 0, 0);
    c.cam.mode = "follow";
    c.cam.snapTo(0, 0);
  }, act);
  await page.waitForTimeout(3600);
  await page.evaluate(() => {
    const c = window.__rh3;
    window.__rh3menus.clear();
    c.run.state = "cleared";
    c.player.hp = c.player.maxHp;
    c.enemies.clear();
    c.projectiles.clear();
    c.hostiles.clear();
    c.caster.clear();
    c.features.clear();
  });
  await page.screenshot({ path: join(OUT, `theme-act-${act}-${tag}.png`) });
  const visible = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    return !!canvas && canvas.width > 0 && canvas.height > 0;
  });
  console.log(`${visible ? "OK" : "FAIL"} act ${act} ${tag} rendered`);
}

if (errors.length) {
  console.log(`CONSOLE ERRORS (${errors.length}):\n${errors.slice(0, 12).join("\n")}`);
  await browser.close();
  process.exit(1);
}

console.log("NO CONSOLE ERRORS");
await browser.close();
