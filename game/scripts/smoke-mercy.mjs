// Mercy/true-ending smoke: reach the Unmaker's fading phase, hold [Q] to spare it,
// and confirm the hopeful ending ("THE LIGHT ENDURES") instead of the bittersweet one.
// Also checks warden boons are granted on a mid-boss kill. Needs dev server :5174.
import { chromium } from "playwright-core";
import { join } from "node:path";

const EXE = join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1217/chrome-win64/chrome.exe");
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
await page.goto("http://localhost:5174", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

let fail = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? "  — " + extra : ""}`); if (!ok) fail++; };

// Start a run so the frame loop is in "playing".
await page.evaluate(() => localStorage.removeItem("rh3v2-runsave"));
await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
await page.waitForTimeout(600);
await page.locator(".hero-card").first().click();
await page.waitForTimeout(700);
if (await page.locator(".story-skip").count()) await page.locator(".story-skip").click();
await page.waitForTimeout(2400);

// --- Warden boon: clear a mid-boss (act 1 Warden) and confirm a boon relic is carried.
await page.evaluate(() => window.__rh3.run.debugLoadNode("boss", 1, 424242, 3));
await page.waitForTimeout(4800); // entrance cutscene + boss materialize
await page.evaluate(() => { const z = window.__rh3.enemies.living().find((e) => e.kind === "boss"); if (z) z.takeDamage(999999); });
await page.waitForTimeout(900);
const boon = await page.evaluate(() => window.__rh3.relics.owned.some((r) => r.id === "warden-heart"));
check("Warden boon granted on boss kill", boon);

// --- Jump to the Unmaker, drop to fading, hold [Q] (the "mercy" action) to spare.
// Poll for "playing" rather than fixed waits — the dt-capped clock runs ~3x slower
// headless, so the unmaker entrance can take >5.5s and a fixed wait flakes.
const waitPlaying = async () => { for (let i = 0; i < 80; i++) { if (await page.evaluate(() => window.__rh3state && window.__rh3state() === "playing")) return true; await page.waitForTimeout(250); } return false; };
await page.evaluate(() => window.__rh3.run.debugLoadNode("boss", 5, 424242, 3));
await waitPlaying(); // entrance cutscene resolves → playing
await page.evaluate(() => { const z = window.__rh3.enemies.living().find((e) => e.kind === "boss"); if (z) z.takeDamage(Math.round(z.maxHp * 0.92)); });
await page.waitForTimeout(500);
await waitPlaying(); // fading-phase cutscene resolves → unmakerFading + playing
// Hold Q until keyup; generous so the slow headless clock still clears SPARE_TIME.
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyQ" })));
await page.waitForTimeout(5000); // > SPARE_TIME (game-time) → doMercy fires → ending scheduled
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyQ" })));
await page.waitForTimeout(3400); // collapse/rekindle settle + ending begins

// Skip the ending story to the victory screen.
let title = "";
for (let i = 0; i < 16; i++) {
  if (await page.locator(".story-skip").count()) await page.locator(".story-skip").click();
  if (await page.locator(".end-title--victory").count()) { title = (await page.locator(".end-title--victory").textContent()) || ""; break; }
  await page.waitForTimeout(300);
}
check("Reached a victory ending", title.length > 0, title);
check("Mercy ending: THE LIGHT ENDURES", /LIGHT ENDURES/i.test(title), title);
await page.screenshot({ path: "shots/rev-mercy-ending.png" });

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join("\n")}` : "NO CONSOLE ERRORS");
console.log(fail === 0 && errors.length === 0 ? "MERCY: ALL PASS" : `MERCY: ${fail} FAILURES`);
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
