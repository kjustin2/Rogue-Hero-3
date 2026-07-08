import { guard } from "./lib/guard.cjs";
guard(); // test-run governor: watchdog + machine lock + memory sentinel (lib/guard.cjs)
// Counter-window smoke: a perfect dodge arms the next melee strike (+75% dmg,
// bonus tempo). Arms the window via the debug seam, swings at a parked enemy,
// and asserts the strike consumed it (decay alone can't zero it this fast).
import { chromium } from "playwright-core";
import { join } from "node:path";

const EXE = join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1217/chrome-win64/chrome.exe");
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
await page.goto("http://localhost:5174", { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.removeItem("rh3v2-runsave"));
await page.waitForTimeout(2000);
await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
await page.waitForTimeout(700);
await page.locator(".hero-card").first().click();
await page.waitForTimeout(800);
if (await page.locator(".story-skip").count()) { await page.locator(".story-skip").click(); await page.waitForTimeout(600); }
await page.waitForTimeout(2600);

// Aim first (facing follows the cursor), then park an enemy dead ahead and arm the counter.
await page.mouse.move(800, 320);
await page.waitForTimeout(200);
const setup = await page.evaluate(() => {
  const c = window.__rh3;
  const e = c.enemies.living()[0];
  if (!e) return { ok: false, msg: "no living enemy in the combat node" };
  e.pos.x = c.player.pos.x + Math.sin(c.player.facing) * 2.0;
  e.pos.z = c.player.pos.z + Math.cos(c.player.facing) * 2.0;
  e.hp = 99999; // must survive the strike so the hit registers plainly
  c.combat.counterWindow = 5;
  return { ok: true, tempo: c.tempo.value };
});
if (!setup.ok) {
  console.log("SETUP FAIL: " + setup.msg);
  await browser.close();
  process.exit(1);
}

await page.mouse.down();
await page.waitForTimeout(120);
await page.mouse.up();
await page.waitForTimeout(700);

const r = await page.evaluate(() => {
  const c = window.__rh3;
  return { window: c.combat.counterWindow, tempo: c.tempo.value };
});
const consumed = r.window === 0;
console.log(consumed
  ? `COUNTER consumed by the strike OK (tempo ${setup.tempo.toFixed(0)} -> ${r.tempo.toFixed(0)})`
  : `COUNTER NOT consumed (window=${r.window})`);
console.log(errors.length ? `CONSOLE ERRORS (${errors.length}):\n` + errors.slice(0, 8).join("\n") : "NO CONSOLE ERRORS");
await browser.close();
process.exit(consumed && errors.length === 0 ? 0 : 1);
