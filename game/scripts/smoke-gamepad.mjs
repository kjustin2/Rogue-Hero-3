// Gamepad smoke: detection (event + poll backstop), the "Controller connected"
// toast, menu navigation (focus ring + A activates), left-stick → moveVector, and
// disconnect handling. A real pad can't be conjured, so we surface a fake one via
// navigator.getGamepads — the same array the game's per-frame poll reads. Needs the
// dev server on 5174.
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

// A controllable fake pad whose buttons/axes the test flips between frames.
await page.evaluate(() => {
  window.__pad = { connected: true, mapping: "standard", index: 0,
    id: "Xbox Wireless Controller (STANDARD GAMEPAD)", timestamp: 1,
    axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
  navigator.getGamepads = () => [window.__pad];
});
await page.waitForTimeout(300); // a few poll frames → poll backstop detects it

const t1 = await page.evaluate(() => {
  const el = document.querySelector(".pad-toast");
  return { connected: window.__rh3.input.gamepadConnected, id: window.__rh3.input.padId,
    toast: el?.textContent || "", shown: !!el?.classList.contains("pad-toast--show") };
});
check("controller detected (poll backstop)", t1.connected, t1.id);
check("'Controller connected' toast shown", t1.shown && /connected/i.test(t1.toast), t1.toast);

// Left stick → moveVector
await page.evaluate(() => { window.__pad.axes = [0.9, 0, 0, 0]; });
await page.waitForTimeout(120);
const moveX = await page.evaluate(() => window.__rh3.input.moveVector().x);
check("left stick drives moveVector", Math.abs(moveX - 0.9) < 0.05, `moveX=${moveX}`);

// Menu nav: stick down acquires/moves the focus ring
await page.evaluate(() => { window.__pad.axes = [0, 0.95, 0, 0]; });
await page.waitForTimeout(120);
await page.evaluate(() => { window.__pad.axes = [0, 0, 0, 0]; });
await page.waitForTimeout(120);
const ring = await page.evaluate(() => !!document.querySelector(".screen .nav-focus"));
check("menu focus ring appears under gamepad control", ring);

// A button activates the focused menu item (leaves the main menu)
const before = await page.evaluate(() => document.querySelector(".screen")?.outerHTML.length || 0);
await page.evaluate(() => { window.__pad.buttons[0] = { pressed: true, touched: true, value: 1 }; });
await page.waitForTimeout(120);
await page.evaluate(() => { window.__pad.buttons[0] = { pressed: false, touched: false, value: 0 }; });
await page.waitForTimeout(400);
const after = await page.evaluate(() => document.querySelector(".screen")?.outerHTML.length || 0);
check("A activates a focused menu item", after !== before, `screen ${before}→${after}`);

// Disconnect (poll backstop) clears the flag + toasts
await page.evaluate(() => { navigator.getGamepads = () => [null]; });
await page.waitForTimeout(250);
const d = await page.evaluate(() => ({ connected: window.__rh3.input.gamepadConnected,
  toast: document.querySelector(".pad-toast")?.textContent || "" }));
check("disconnect clears the flag + toasts", !d.connected && /disconnect/i.test(d.toast), d.toast);

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join("\n")}` : "NO CONSOLE ERRORS");
console.log(fail === 0 && errors.length === 0 ? "GAMEPAD: ALL PASS" : `GAMEPAD: ${fail} FAILURES`);
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
