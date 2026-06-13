// Targeted check: crash-ready range ring + card slot ready/cooldown states.
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
await page.waitForTimeout(3200);

// Ready cards should look bright (no dark sweep)
await page.screenshot({ path: "shots/14-slots-ready.png" });

// Cast slot 1 → it should darken and sweep back to bright
await page.mouse.move(900, 300);
await page.keyboard.press("Digit1");
await page.waitForTimeout(700);
await page.screenshot({ path: "shots/15-slot-cooldown.png" });

// Force crash-ready tempo and show the blast-radius ring
await page.evaluate(() => { window.__rh3.tempo.gain(45); });
await page.waitForTimeout(900);
await page.screenshot({ path: "shots/16-crash-ready.png" });

// Crash it
await page.keyboard.press("KeyF");
await page.waitForTimeout(350);
await page.screenshot({ path: "shots/17-crash-nova.png" });

console.log(errors.length ? `CONSOLE ERRORS:\n` + errors.join("\n") : "NO CONSOLE ERRORS");
await browser.close();
