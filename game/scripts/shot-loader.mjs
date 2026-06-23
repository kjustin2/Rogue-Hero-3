// Capture the boot loading screen for a visual eyeball. Grabs a few frames while
// the loader is up (it self-removes after ~900ms + warm-up + a 0.6s fade).
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const EXE = join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1217/chrome-win64/chrome.exe");
const URL = process.env.RH3_URL ?? "http://localhost:5174";
mkdirSync("shots", { recursive: true });

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();

await page.goto(URL, { waitUntil: "domcontentloaded" });
for (const t of [350, 700, 1100]) {
  await page.waitForTimeout(t === 350 ? 350 : 350);
  const present = await page.locator("#rift-loader").count();
  await page.screenshot({ path: `shots/loader-${t}.png` });
  console.log(`shot at ~${t}ms — loader present: ${present > 0}`);
}
await browser.close();
console.log("LOADER SHOTS: done");
