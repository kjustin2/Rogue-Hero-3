// Captures the story intro and a boss entrance cutscene.
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
await page.evaluate(() => localStorage.removeItem("rh3v2-runsave"));
await page.waitForTimeout(1800);
await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
await page.waitForTimeout(700);
await page.locator(".hero-card").first().click();

// Story intro: capture line 1, then advance through
await page.waitForTimeout(1000);
await page.screenshot({ path: "shots/c-story.png" });
const storyShown = await page.locator(".story__line").count();
console.log("STORY INTRO:", storyShown ? "OK" : "MISSING");
await page.locator(".story-skip").click();
await page.waitForTimeout(2200);

// Jump to the Act I boss — entrance cutscene
await page.evaluate(() => window.__rh3.run.loadRoom(3));
await page.waitForTimeout(1300);
await page.screenshot({ path: "shots/c-boss-dolly.png" });
const letterboxOn = await page.evaluate(
  () => document.querySelector(".letterbox--top").classList.contains("letterbox--on")
);
console.log("LETTERBOX:", letterboxOn ? "OK" : "MISSING");
await page.waitForTimeout(1500); // ~2.8s in: boss materialized + roar
await page.screenshot({ path: "shots/c-boss-reveal.png" });
await page.waitForTimeout(1800); // cutscene over, control returned
const backToPlay = await page.evaluate(() => !document.querySelector(".letterbox--top").classList.contains("letterbox--on"));
console.log("CUTSCENE ENDED:", backToPlay ? "OK" : "STUCK");
await page.screenshot({ path: "shots/c-boss-fight.png" });

// Skip path: reload the boss room, skip instantly with a click
await page.evaluate(() => {
  const c = window.__rh3;
  c.player.hp = c.player.maxHp;
  c.run.loadRoom(7);
});
await page.waitForTimeout(600);
await page.mouse.click(800, 450);
await page.waitForTimeout(400);
const skipped = await page.evaluate(() => !document.querySelector(".letterbox--top").classList.contains("letterbox--on"));
console.log("SKIP:", skipped ? "OK" : "FAIL");

console.log(errors.length ? `CONSOLE ERRORS (${errors.length}):\n` + errors.slice(0, 10).join("\n") : "NO CONSOLE ERRORS");
await browser.close();
