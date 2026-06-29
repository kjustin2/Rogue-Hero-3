// Map node-kind smoke: navigates the forked map PREFERRING interstitial nodes
// (shop/treasure/rest/event) so each resolves cleanly, then finishes the run.
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
await page.waitForTimeout(2000);
await page.evaluate(() => localStorage.removeItem("rh3v2-runsave"));
await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
await page.waitForTimeout(700);
await page.locator(".hero-card").first().click();
await page.waitForTimeout(800);
if (await page.locator(".story-skip").count()) { await page.locator(".story-skip").click(); await page.waitForTimeout(600); }
await page.waitForTimeout(2500);

const has = async (loc) => (await loc.count()) > 0;
const click = async (loc) => { if (await loc.count()) { await loc.first().click(); await page.waitForTimeout(300); return true; } return false; };
const kinds = new Set();
let mapShot = false, victory = false;

for (let step = 0; step < 520 && !victory; step++) {
  const st = await page.evaluate(() => {
    const c = window.__rh3;
    if (c.run.state === "fighting") for (const e of c.enemies.living()) e.takeDamage(99999);
    return c.run.state;
  });
  if (st === "victory") { victory = true; break; }
  await page.waitForTimeout(190);

  // Skip story / act-transition cutscenes the instant they're skippable (a player can too).
  if (await has(page.locator(".story-skip"))) { await click(page.locator(".story-skip")); continue; }

  if (await has(page.locator(".mapnode"))) {
    if (!mapShot) { await page.screenshot({ path: "shots/x-map.png" }); mapShot = true; }
    // The pre-boss fork always offers rest, so a blind .first() pick would only ever
    // resolve rest. Prefer a NON-rest interstitial (shop/treasure/event) to exercise
    // those kinds; fall back to rest, then to a fight to keep progressing.
    const interNonRest = page.locator(".mapnode--shop, .mapnode--treasure, .mapnode--event");
    if (!(await click(interNonRest)) && !(await click(page.locator(".mapnode--rest"))))
      await click(page.locator(".mapnode--combat, .mapnode--elite, .mapnode"));
  } else if (await has(page.locator("button", { hasText: "Leave the Shop" }))) {
    kinds.add("shop"); await click(page.locator("button", { hasText: "Leave the Shop" }));
  } else if (await has(page.locator(".draft-title", { hasText: "HIDDEN CACHE" }))) {
    kinds.add("treasure"); await click(page.locator(".draft-skip"));
  } else if (await has(page.locator("button", { hasText: "Move On" }))) {
    kinds.add("rest"); await click(page.locator("button", { hasText: "Move On" }));
  } else if (await has(page.locator(".panel h2", { hasText: /BLEEDING ALTAR|GLITTERING CACHE|FORGOTTEN ARMORY|GAMBLER/ }))) {
    kinds.add("event"); await click(page.locator(".panel .menu-buttons .btn"));
  } else if (await has(page.locator(".card"))) {
    await click(page.locator(".card"));
    if (await has(page.locator(".card"))) await click(page.locator(".card"));
  } else if (await has(page.locator(".draft-skip"))) {
    await click(page.locator(".draft-skip"));
  } else if (await has(page.locator(".panel .menu-buttons .btn"))) {
    await click(page.locator(".panel .menu-buttons .btn"));
  }
}

const list = [...kinds].sort().join(", ") || "(none)";
console.log(`interstitial kinds resolved: ${list}`);
console.log("VICTORY:", victory ? "OK" : "FAIL");
console.log("INTERSTITIALS:", kinds.size >= 2 ? `OK (${kinds.size} kinds)` : `WEAK (${kinds.size})`);
console.log(errors.length ? `CONSOLE ERRORS (${errors.length}):\n` + errors.slice(0, 8).join("\n") : "NO CONSOLE ERRORS");
await browser.close();
process.exit(victory && kinds.size >= 2 && errors.length === 0 ? 0 : 1);
