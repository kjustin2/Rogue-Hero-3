// Headless-browser smoke: boots the game, captures console errors, screenshots
// the menu and (via simulated input) early gameplay. Usage: node scripts/smoke-browser.mjs
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const EXE = join(
  process.env.LOCALAPPDATA,
  "ms-playwright/chromium-1217/chrome-win64/chrome.exe"
);
const OUT = "shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();

const errors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});
page.on("pageerror", (err) => errors.push(`PAGEERROR: ${err.message}`));

await page.goto("http://localhost:5174", { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
await page.screenshot({ path: join(OUT, "1-menu.png") });

// Start a run
const begin = page.locator("button", { hasText: "Begin Run" });
if (await begin.count()) {
  await begin.click();
  await page.waitForTimeout(3500); // act card + spawn-in
  await page.screenshot({ path: join(OUT, "2-gameplay.png") });

  // Move + aim + attack a bit
  await page.mouse.move(900, 300);
  await page.keyboard.down("w");
  await page.waitForTimeout(900);
  await page.keyboard.up("w");
  await page.mouse.down();
  await page.waitForTimeout(200);
  await page.mouse.up();
  await page.mouse.down();
  await page.waitForTimeout(400);
  await page.mouse.up();
  await page.screenshot({ path: join(OUT, "3-combat.png") });

  // Dodge + card cast
  await page.keyboard.press("Space");
  await page.waitForTimeout(300);
  await page.keyboard.press("Digit1");
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, "4-cards.png") });

  // Pause menu
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, "5-pause.png") });
} else {
  console.log("WARN: Begin Run button not found");
}

console.log(errors.length ? `CONSOLE ERRORS (${errors.length}):\n` + errors.slice(0, 12).join("\n") : "NO CONSOLE ERRORS");
await browser.close();
