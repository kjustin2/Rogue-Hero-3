// Regression smoke: pausing right after a boss entrance must not keep the boss
// inert after resume. The boss should wake naturally without needing a player hit.
import { chromium } from "playwright-core";
import { join } from "node:path";

const EXE = join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1217/chrome-win64/chrome.exe");
const URL = process.env.RH3_URL ?? "http://localhost:5174";
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

let fail = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " - " + extra : ""}`);
  if (!ok) fail++;
};

await page.goto(URL, { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.removeItem("rh3v2-runsave"));
await page.waitForTimeout(1200);
await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
await page.waitForTimeout(600);
await page.locator(".hero-card").first().click();
await page.waitForTimeout(700);
if (await page.locator(".story-skip").count()) await page.locator(".story-skip").click();
await page.waitForTimeout(2200);

await page.evaluate(() => {
  window.__rh3menus.clear();
  window.__rh3.run.debugLoadBoss("warden", 1, 2024, 0);
});

await page.waitForFunction(() => {
  const c = window.__rh3;
  return c.playing && !!c.enemies.living().find((e) => e.kind === "boss");
}, null, { timeout: 10000 });

const beforePause = await page.evaluate(() => {
  const boss = window.__rh3.enemies.living().find((e) => e.kind === "boss");
  return boss ? { x: boss.pos.x, z: boss.pos.z, playing: window.__rh3.playing } : null;
});
check("boss exists when entrance hands back control", !!beforePause?.playing, JSON.stringify(beforePause));

await page.keyboard.press("Escape");
await page.waitForTimeout(150);
const paused = await page.locator(".panel", { hasText: "PAUSED" }).count();
check("pause screen appears at boss start", paused === 1, `count=${paused}`);

await page.waitForTimeout(2200);
const beforeResume = await page.evaluate(() => {
  const boss = window.__rh3.enemies.living().find((e) => e.kind === "boss");
  return boss ? { x: boss.pos.x, z: boss.pos.z } : null;
});

await page.locator("button", { hasText: "Resume" }).click();
await page.waitForTimeout(650);

const afterResume = await page.evaluate(() => {
  const boss = window.__rh3.enemies.living().find((e) => e.kind === "boss");
  return boss ? { x: boss.pos.x, z: boss.pos.z, playing: window.__rh3.playing } : null;
});
const moved = beforeResume && afterResume
  ? Math.hypot(afterResume.x - beforeResume.x, afterResume.z - beforeResume.z)
  : 0;
check(
  "boss moves after paused entrance grace expires",
  moved > 0.2,
  `moved=${moved.toFixed(3)} before=${JSON.stringify(beforeResume)} after=${JSON.stringify(afterResume)}`,
);

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join("\n")}` : "NO CONSOLE ERRORS");
console.log(fail === 0 && errors.length === 0 ? "BOSS-PAUSE: ALL PASS" : `BOSS-PAUSE: ${fail} FAILURES`);
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
