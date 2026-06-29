// Headless-browser smoke for the Display settings (resolution scale, fullscreen,
// frame-rate cap, sectioned Settings UI). Boots, opens Settings, asserts the new
// controls exist and that Resolution Scale actually changes the renderer pixel
// ratio + the FPS cap persists. Needs the dev server on :5174 (npm run dev).
// Usage: node scripts/smoke-display.mjs
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const EXE = join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1217/chrome-win64/chrome.exe");
const OUT = "shots";
mkdirSync(OUT, { recursive: true });

const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); else console.log(`  ✓ ${msg}`); };

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();

const errors = [];
page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
page.on("pageerror", (err) => errors.push(`PAGEERROR: ${err.message}`));

await page.goto("http://localhost:5174", { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

// Open Settings straight through the menus API (no dependence on menu layout).
await page.evaluate(() => window.__rh3menus.showSettings(() => window.__rh3menus.showMain()));
await page.waitForTimeout(400);

// --- structure: sectioned panel + the new Display controls ---
const sections = await page.$$eval(".settings-section", (els) => els.map((e) => e.textContent.trim()));
ok(["DISPLAY", "GRAPHICS", "AUDIO", "GAMEPLAY"].every((s) => sections.includes(s)),
  `settings grouped into sections (${sections.join(", ")})`);
ok((await page.locator(".qbtn[data-dm]").count()) === 2, "Display Mode has Windowed/Fullscreen toggle");
ok((await page.locator("select[data-set='renderScale']").count()) === 1, "Resolution Scale dropdown present");
ok((await page.locator("select[data-set='fpsCap']").count()) === 1, "Frame Rate Limit dropdown present");
ok((await page.locator("select[data-set='windowSize']").count()) === 0, "Window Resolution hidden in browser (Electron-only)");

await page.screenshot({ path: join(OUT, "display-settings.png") });

// --- behavior: Resolution Scale drives the renderer pixel ratio ---
await page.selectOption("select[data-set='renderScale']", "1");
await page.waitForTimeout(150);
const pr100 = await page.evaluate(() => window.__rh3.stage.renderer.getPixelRatio());
await page.selectOption("select[data-set='renderScale']", "0.5");
await page.waitForTimeout(150);
const pr50 = await page.evaluate(() => window.__rh3.stage.renderer.getPixelRatio());
ok(pr100 > 0 && Math.abs(pr50 / pr100 - 0.5) < 0.06,
  `50% scale halves pixel ratio (${pr100.toFixed(2)} → ${pr50.toFixed(2)})`);

// --- behavior: FPS cap persists ---
await page.selectOption("select[data-set='fpsCap']", "60");
await page.waitForTimeout(120);
const savedFps = await page.evaluate(() => JSON.parse(localStorage.getItem("rh3v2-settings")).fpsCap);
ok(savedFps === 60, `FPS cap persisted (fpsCap=${savedFps})`);

// Restore native scale so we don't leave the saved profile at 50%.
await page.selectOption("select[data-set='renderScale']", "1");
await page.waitForTimeout(120);

if (errors.length) console.log(`CONSOLE ERRORS (${errors.length}):\n` + errors.slice(0, 12).join("\n"));
else console.log("NO CONSOLE ERRORS");

await browser.close();

if (fails.length) {
  console.log(`\nDISPLAY SMOKE FAILED (${fails.length}):`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log("\nDISPLAY SMOKE OK");
