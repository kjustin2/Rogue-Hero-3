// One-off visual capture for the menu-perf work: main menu, hero select, and a
// hovered hero preview, at a forced quality so we can eyeball that the low-cost
// menu render path keeps the look (bloom/glow, hero, frozen-but-present shadow).
import { chromium } from "playwright-core";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

const EXE = join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1217/chrome-win64/chrome.exe");
const URL = process.env.RH3_URL ?? "http://localhost:5174";
const QUALITY = process.env.SHOT_QUALITY ?? "high";
const OUT = join(process.cwd(), "shots");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newContext({ viewport: { width: 1600, height: 900 } }).then((c) => c.newPage());
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

await page.goto(URL, { waitUntil: "networkidle" });
// Fresh profile, but pin quality so the screenshot reflects the heavy preset.
await page.evaluate((q) => {
  localStorage.removeItem("rh3v2-runsave");
  localStorage.removeItem("rh3v2-profile");
  localStorage.setItem("rh3v2-settings", JSON.stringify({ quality: q }));
}, QUALITY);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const shot = async (name) => {
  await page.waitForTimeout(700); // let the capped menu render settle a frame
  await page.screenshot({ path: join(OUT, `menu-${name}-${QUALITY}.png`) });
  console.log(`shot: menu-${name}-${QUALITY}.png`);
};

await page.locator(".screen--main").waitFor();
await shot("01-main");

await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
await page.locator(".hero-card").first().waitFor();
await shot("02-heroselect");

// Hover the second hero to trigger the (debounced, high-only) live 3D preview.
await page.locator(".hero-card").nth(1).hover();
await page.waitForTimeout(500);
await shot("03-hero-hover");

await page.locator("button", { hasText: "Settings" }).first().click().catch(() => {});
await page.locator(".panel", { hasText: "SETTINGS" }).waitFor().catch(() => {});
await shot("04-settings");

console.log(errors.length ? `ERRORS:\n${errors.slice(0, 5).join("\n")}` : "NO CONSOLE ERRORS");
await browser.close();
