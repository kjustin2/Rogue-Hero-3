// Map-feature smoke: the new arena mechanics (spikes that erupt, drifting hazard
// orbs, a sweeping beam) set up, damage the player when in their danger zone, and
// dispose cleanly. Drives features directly (synchronous tick loop, no main-loop
// interleave) for determinism. Needs the dev server on 5174.
import { chromium } from "playwright-core";
import { join } from "node:path";

const EXE = join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1217/chrome-win64/chrome.exe");
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
await page.goto("http://localhost:5174", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

let fail = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? "  — " + extra : ""}`); if (!ok) fail++; };

// Enter a combat node so the player + systems are live.
await page.evaluate(() => localStorage.removeItem("rh3v2-runsave"));
await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
await page.waitForTimeout(600);
await page.locator(".hero-card").first().click();
await page.waitForTimeout(700);
if (await page.locator(".story-skip").count()) await page.locator(".story-skip").click();
await page.waitForTimeout(2400);
for (let i = 0; i < 24; i++) { if (await page.evaluate(() => window.__rh3.playing)) break; await page.waitForTimeout(300); }

// Spikes — erupt on a cycle; standing on a plate bites.
const spikes = await page.evaluate(() => {
  const c = window.__rh3, f = c.features;
  f.setup({ feature: "spikes" });
  const count = f.spikes.length;
  const s0 = f.spikes[0];
  c.player.alive = true; c.player.hp = c.player.maxHp;
  c.player.pos.x = s0.x; c.player.pos.z = s0.z;
  const before = c.player.hp;
  for (let i = 0; i < 130; i++) f.update(0.05); // > 2 cycles
  return { count, dropped: c.player.hp < before };
});
check("spike traps spawn", spikes.count >= 3, `${spikes.count}`);
check("standing on an erupting spike trap hurts", spikes.dropped);

// Drifters — touch on contact.
const drift = await page.evaluate(() => {
  const c = window.__rh3, f = c.features;
  f.setup({ feature: "drifters" });
  const count = f.drifters.length;
  const d0 = f.drifters[0];
  c.player.alive = true; c.player.hp = c.player.maxHp;
  c.player.pos.x = d0.x; c.player.pos.z = d0.z;
  const before = c.player.hp;
  for (let i = 0; i < 20; i++) f.update(0.05);
  return { count, dropped: c.player.hp < before };
});
check("drifting orbs spawn", drift.count >= 2, `${drift.count}`);
check("touching a drifter hurts", drift.dropped);

// Sweeper — a rotating diameter; a fixed point gets crossed.
const sweep = await page.evaluate(() => {
  const c = window.__rh3, f = c.features;
  f.setup({ feature: "sweeper" });
  const count = f.sweepers.length;
  c.player.alive = true; c.player.hp = c.player.maxHp;
  c.player.pos.x = 7; c.player.pos.z = 0;
  const before = c.player.hp;
  for (let i = 0; i < 260; i++) f.update(0.05); // a couple full rotations
  return { count, dropped: c.player.hp < before };
});
check("sweeper beam spawns", sweep.count === 1);
check("the sweep clips a standing target", sweep.dropped);

// Dispose: clear() empties everything (no leaks).
const cleared = await page.evaluate(() => {
  const f = window.__rh3.features;
  f.clear();
  return f.spikes.length + f.drifters.length + f.sweepers.length + f.hazards.length + f.pads.length;
});
check("clear() disposes every feature", cleared === 0, `${cleared} left`);

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join("\n")}` : "NO CONSOLE ERRORS");
console.log(fail === 0 && errors.length === 0 ? "FEATURES: ALL PASS" : `FEATURES: ${fail} FAILURES`);
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
