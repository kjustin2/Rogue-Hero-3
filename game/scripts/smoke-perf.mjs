// Performance smoke: drives a live Spire Caster fight (the reported freeze) while
// sampling real animation-frame deltas. A synchronous shader-compile / GC stall
// shows up as a multi-hundred-ms gap between frames regardless of headless pacing
// noise, so this catches the "first boss shot froze for a second" class of bug.
// Needs the dev server on 5174.
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

// Start a run, jump to the Spire Caster.
await page.evaluate(() => localStorage.removeItem("rh3v2-runsave"));
await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
await page.waitForTimeout(600);
await page.locator(".hero-card").first().click();
await page.waitForTimeout(700);
if (await page.locator(".story-skip").count()) await page.locator(".story-skip").click();
await page.waitForTimeout(2200);
await page.evaluate(() => window.__rh3.run.debugLoadBoss("spire", 2, 424242, 3));
await page.waitForTimeout(900);
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }))); // skip entrance
await page.waitForTimeout(2600); // boss materialized + active

// Start sampling frame deltas, then let the boss fire several volleys (+ player swings).
await page.evaluate(() => {
  const w = window;
  w.__ft = [];
  w.__lastF = performance.now();
  const probe = () => {
    const n = performance.now();
    w.__ft.push(n - w.__lastF);
    w.__lastF = n;
    w.__ftRAF = requestAnimationFrame(probe);
  };
  w.__ftRAF = requestAnimationFrame(probe);
});
// Spam attacks to exercise slashes + force the boss through multiple lance/channel attacks.
for (let i = 0; i < 14; i++) {
  await page.evaluate(() => document.getElementById("game").dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true })));
  await page.waitForTimeout(120);
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointerup", { button: 0, bubbles: true })));
  await page.waitForTimeout(380);
}
const stats = await page.evaluate(() => {
  const w = window;
  cancelAnimationFrame(w.__ftRAF);
  const ft = w.__ft.slice(2); // drop the first couple warm-up samples
  const max = Math.max(...ft);
  const sorted = [...ft].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const over250 = ft.filter((d) => d > 250).length;
  return { count: ft.length, max: Math.round(max), p95: Math.round(p95), over250 };
});
console.log(`  frames: ${stats.count}, max ${stats.max}ms, p95 ${stats.p95}ms, frames>250ms: ${stats.over250}`);
check("No multi-hundred-ms freeze during the boss fight", stats.max < 350, `max ${stats.max}ms`);
check("No stutter cluster (frames >250ms)", stats.over250 === 0, `${stats.over250} slow frames`);
check("Frame pacing is reasonable (p95 < 120ms)", stats.p95 < 120, `p95 ${stats.p95}ms`);

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join("\n")}` : "NO CONSOLE ERRORS");
console.log(fail === 0 && errors.length === 0 ? "PERF: ALL PASS" : `PERF: ${fail} FAILURES`);
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
