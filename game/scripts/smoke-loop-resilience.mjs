// Frame-loop resilience + boss-cutscene crash guard.
//   1) The WARDEN entrance plays to completion with the boss left ALIVE (a real run —
//      not the insta-kill the other smokes do) with no console errors and the rAF loop
//      still advancing afterward.
//   2) The setAnimationLoop guard (main.ts) recovers from an injected per-frame throw:
//      Three never re-requests after its callback throws, so without the guard one bad
//      frame freezes the game for good. We fault one frame and assert frames keep flowing.
// Needs the dev server; honors PORT (default 5174) so it can run off :5174 contention.
import { chromium } from "playwright-core";
import { join } from "node:path";

const PORT = process.env.PORT || "5174";
const EXE = join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1217/chrome-win64/chrome.exe");

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));

let fail = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? "  - " + extra : ""}`); if (!ok) fail++; };

await page.goto(`http://localhost:${PORT}/?lowfx`, { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.removeItem("rh3v2-runsave"));
await page.waitForTimeout(1800);
await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
await page.waitForTimeout(700);
await page.locator(".hero-card").first().click();
await page.waitForTimeout(800);
if (await page.locator(".story-skip").count()) { await page.locator(".story-skip").click(); await page.waitForTimeout(600); }
await page.waitForTimeout(1500);

// A frame counter driven by the same rAF the game uses — our liveness signal.
await page.evaluate(() => { window.__frames = 0; const t = () => { window.__frames++; requestAnimationFrame(t); }; requestAnimationFrame(t); });
const framesNow = () => page.evaluate(() => window.__frames);

// ---- 1) WARDEN entrance, boss left ALIVE, full choreography ----
await page.evaluate(() => {
  window.__rh3menus.clear();
  window.__rh3.player.hp = window.__rh3.player.maxHp;
  window.__rh3.run.debugLoadBoss("warden", 1, 424242, 0);
});
await page.waitForTimeout(700);
const f0 = await framesNow();
const lbUp = await page.evaluate(() => document.querySelector(".letterbox--top")?.classList.contains("letterbox--on"));
check("warden entrance: letterbox up", lbUp === true);
await page.waitForTimeout(7000); // full ~6s of beats + storm interval
const f1 = await framesNow();
check("loop alive through entrance", f1 - f0 > 30, `frames +${f1 - f0}`);
const after = await page.evaluate(() => ({
  lbOff: !document.querySelector(".letterbox--top")?.classList.contains("letterbox--on"),
  bossAlive: window.__rh3.enemies.living().some((e) => e.kind === "boss"),
  input: window.__rh3.input.enabled,
}));
check("warden entrance: control returned, boss alive", after.lbOff && after.input && after.bossAlive,
  `lbOff=${after.lbOff} input=${after.input} bossAlive=${after.bossAlive}`);

// ---- 2) Guard recovers from a one-shot per-frame throw during the cutscene ----
await page.evaluate(() => {
  window.__rh3menus.clear();
  window.__rh3.player.hp = window.__rh3.player.maxHp;
  window.__rh3.run.debugLoadBoss("warden", 1, 7, 0);
});
await page.waitForTimeout(600); // mid-entrance (state === cutscene)
const faultFrame = await framesNow();
await page.evaluate(() => {
  const cam = window.__rh3.cam;
  const orig = cam.update.bind(cam);
  cam.update = (dt) => { cam.update = orig; throw new Error("probe: injected frame fault"); };
});
await page.waitForTimeout(1500);
const afterFault = await framesNow();
check("loop survives an injected frame fault", afterFault - faultFrame > 15, `frames +${afterFault - faultFrame}`);
const recovered = errors.some((e) => /recovered, loop kept alive/.test(e));
check("guard logged the recovered fault", recovered);

// The injected fault is expected and must not count as a real failure.
const realErrors = errors.filter((e) => !/recovered, loop kept alive|probe: injected frame fault/.test(e));
console.log(realErrors.length ? `CONSOLE ERRORS (${realErrors.length}):\n` + realErrors.slice(0, 12).join("\n") : "NO CONSOLE ERRORS");
await browser.close();
process.exit(fail === 0 && realErrors.length === 0 ? 0 : 1);
