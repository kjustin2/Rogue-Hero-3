import { guard } from "./lib/guard.cjs";
guard(); // test-run governor: watchdog + machine lock + memory sentinel (lib/guard.cjs)
// Regression smoke: pausing after the room-clear event but before the delayed
// reward screen should not drop the transition or leave the run stuck.
import { chromium } from "playwright-core";
import { join } from "node:path";

const EXE = join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1217/chrome-win64/chrome.exe");
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

let fail = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? "  - " + extra : ""}`);
  if (!ok) fail++;
};

await page.goto("http://localhost:5174", { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.removeItem("rh3v2-runsave"));
await page.locator("#rift-loader").waitFor({ state: "hidden", timeout: 12000 });
await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
await page.waitForTimeout(600);
await page.locator(".hero-card--active").click();
await page.waitForTimeout(700);
if (await page.locator(".story-skip").count()) await page.locator(".story-skip").click();
await page.waitForTimeout(2200);

const cleared = await page.evaluate(() => {
  const c = window.__rh3;
  c.run.debugLoadNode("combat", 1, 1777, 0);
  let guard = 12;
  while (c.run.state === "fighting" && guard-- > 0) {
    c.enemies.clear();
    c.hostiles.clear();
    c.run.update();
  }
  return { runState: c.run.state, rooms: c.stats.roomsCleared };
});
check("combat room reaches cleared state", cleared.runState === "cleared", JSON.stringify(cleared));

await page.keyboard.press("Escape");
await page.waitForTimeout(1800);
const paused = await page.locator(".panel", { hasText: "PAUSED" }).count();
check("pause screen remains during delayed clear reward", paused === 1);

await page.locator("button", { hasText: "Resume" }).click();
await page.waitForTimeout(500);
const resumedTarget = await page.evaluate(() => {
  const title = document.querySelector(".draft-title")?.textContent ?? "";
  const panel = document.querySelector(".panel")?.textContent ?? "";
  const playing = window.__rh3.playing;
  return { title, panel, playing };
});
check(
  "resume opens the pending reward or next map",
  /CHOOSE A CARD|CHOOSE A RELIC|CHOOSE YOUR PATH/i.test(resumedTarget.title + " " + resumedTarget.panel),
  JSON.stringify(resumedTarget),
);
check("run is not silently stuck in playing state", resumedTarget.playing === false, `playing=${resumedTarget.playing}`);

// Boss clear path: killing the first boss should advance to its delayed reward.
// Reuse the initialized run context from the first half. Reloading here can restore
// the just-written checkpoint before the test removes it, making UI navigation the
// subject of what is meant to be a clear-transition regression probe.
await page.evaluate(() => {
  window.__rh3menus.clear();
  window.__rh3.run.debugLoadBoss("warden", 1, 2024, 0);
});
await page.waitForTimeout(800);
await page.keyboard.press("Space");
await page.waitForFunction(() => window.__rh3.playing && !!window.__rh3.enemies.living().find((e) => e.kind === "boss"), null, { timeout: 10000 });
const killedBoss = await page.evaluate(() => {
  const boss = window.__rh3.enemies.living().find((e) => e.kind === "boss");
  if (!boss) return false;
  boss.takeDamage(99999);
  return true;
});
check("first boss can be killed through debug path", killedBoss === true);
await page.waitForFunction(() => {
  const text = (document.querySelector(".draft-title")?.textContent ?? "") + " " + (document.querySelector(".panel")?.textContent ?? "");
  return /CHOOSE A CARD|CHOOSE A RELIC|CHOOSE YOUR PATH/i.test(text);
}, null, { timeout: 12000 });
const bossReward = await page.evaluate(() => {
  const title = document.querySelector(".draft-title")?.textContent ?? "";
  const panel = document.querySelector(".panel")?.textContent ?? "";
  return { title, panel, playing: window.__rh3.playing };
});
check(
  "first boss kill reaches its reward/map transition",
  /CHOOSE A CARD|CHOOSE A RELIC|CHOOSE YOUR PATH/i.test(bossReward.title + " " + bossReward.panel),
  JSON.stringify(bossReward),
);

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join("\n")}` : "NO CONSOLE ERRORS");
console.log(fail === 0 && errors.length === 0 ? "CLEAR-PAUSE: ALL PASS" : `CLEAR-PAUSE: ${fail} FAILURES`);
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
