// Gamepad combat smoke: the new default pad mapping (attack + 3 cards on the
// shoulder buttons; dodge=A, crash=B, target=Y, overdrive=X, pause=Start),
// auto-aim facing the nearest enemy, and the [Y] switch-target lock-on. Runs in
// active combat so menuNav doesn't intercept the buttons. Needs dev server :5174.
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

// Surface a controllable fake pad with press/release helpers.
await page.evaluate(() => {
  window.__pad = { connected: true, mapping: "standard", index: 0, id: "Pad (STANDARD GAMEPAD)", timestamp: 1,
    axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
  navigator.getGamepads = () => [window.__pad];
  window.__press = (i, on) => { window.__pad.buttons[i] = { pressed: on, touched: on, value: on ? 1 : 0 }; };
});

// --- Enter a combat node so there are enemies and menuNav is inactive.
await page.evaluate(() => localStorage.removeItem("rh3v2-runsave"));
await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
await page.waitForTimeout(600);
await page.locator(".hero-card").first().click();
await page.waitForTimeout(700);
if (await page.locator(".story-skip").count()) await page.locator(".story-skip").click();
await page.waitForTimeout(2400);
for (let i = 0; i < 24; i++) { if (await page.evaluate(() => window.__rh3.playing)) break; await page.waitForTimeout(300); }
const enemyCount = await page.evaluate(() => window.__rh3.enemies.living().length);
check("in combat with enemies present", enemyCount >= 1, `${enemyCount} living`);

// --- New default mapping (in gameplay, so actionDown reads the pad directly).
const MAP = [
  ["attack", 7], ["card1", 6], ["card2", 4], ["card3", 5],
  ["dodge", 0], ["crash", 1], ["target", 3], ["overdrive", 2],
];
for (const [action, btn] of MAP) {
  await page.evaluate((b) => window.__press(b, true), btn);
  await page.waitForTimeout(60);
  const down = await page.evaluate((a) => window.__rh3.input.actionDown(a), action);
  check(`${action} ← button ${btn}`, down, down ? "" : "not detected");
  await page.evaluate((b) => window.__press(b, false), btn);
  await page.waitForTimeout(40);
}

// --- Auto-aim: stick idle → hero faces the locked enemy (recent pad input keeps usingGamepad true).
await page.evaluate(() => { window.__pad.axes = [0, 0, 0, 0]; });
await page.waitForTimeout(160);
const aim = await page.evaluate(() => {
  const c = window.__rh3;
  const t = c.controller.focusTarget;
  if (!t) return { hasTarget: false, usingPad: c.input.usingGamepad };
  const want = Math.atan2(t.pos.x - c.player.pos.x, t.pos.z - c.player.pos.z);
  const d = Math.abs(((c.player.facing - want + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  return { hasTarget: true, facingErr: d, usingPad: c.input.usingGamepad };
});
check("auto-aim acquires a target", aim.hasTarget, `usingGamepad=${aim.usingPad}`);
check("hero faces the locked target", aim.hasTarget && aim.facingErr < 0.12, `err=${aim.facingErr?.toFixed(3)}`);

// --- [Y] switches the locked target (when >1 enemy).
const cnt = await page.evaluate(() => window.__rh3.enemies.living().length);
if (cnt >= 2) {
  const before = await page.evaluate(() => window.__rh3.enemies.living().indexOf(window.__rh3.controller.focusTarget));
  await page.evaluate(() => window.__press(3, true));   // Y down (edge → cycle)
  await page.waitForTimeout(60);
  await page.evaluate(() => window.__press(3, false));
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => window.__rh3.enemies.living().indexOf(window.__rh3.controller.focusTarget));
  check("[Y] switches the locked target", after >= 0 && after !== before, `idx ${before} → ${after}`);
} else {
  console.log("OK   [Y] switch-target skipped (only one enemy)");
}

// --- Auto-aim OFF clears the lock-on.
await page.evaluate(() => { window.__rh3.controller.autoAim = false; });
await page.waitForTimeout(120);
const offTarget = await page.evaluate(() => window.__rh3.controller.focusTarget);
check("auto-aim OFF clears the lock-on", offTarget === null);
await page.evaluate(() => { window.__rh3.controller.autoAim = true; });

// --- Pause mapping LAST: Start (button 9) pauses the game.
await page.evaluate(() => window.__press(9, true));
await page.waitForTimeout(80);
await page.evaluate(() => window.__press(9, false));
await page.waitForTimeout(120);
const paused = await page.evaluate(() => !window.__rh3.playing && !!document.querySelector(".screen"));
check("Start (button 9) pauses the game", paused);

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join("\n")}` : "NO CONSOLE ERRORS");
console.log(fail === 0 && errors.length === 0 ? "AIM: ALL PASS" : `AIM: ${fail} FAILURES`);
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
