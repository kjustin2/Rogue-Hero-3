// Superboss + new-node-kind smoke: the optional Rift Echo (two telegraphed phases,
// counts as a mid-map clear not a victory) and the Shrine / Gamble screens.
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

// Start a run so the frame loop is "playing".
await page.evaluate(() => localStorage.removeItem("rh3v2-runsave"));
await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
await page.waitForTimeout(600);
await page.locator(".hero-card").first().click();
await page.waitForTimeout(700);
if (await page.locator(".story-skip").count()) await page.locator(".story-skip").click();
await page.waitForTimeout(2400);

// --- Rift Echo: load it, skip the entrance, confirm it spawns + telegraphs
await page.evaluate(() => window.__rh3.run.debugLoadBoss("echo", 4, 424242, 3));
await page.waitForTimeout(900);
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }))); // skip entrance
await page.waitForTimeout(2900);
const spawned = await page.evaluate(() => {
  const c = window.__rh3;
  const b = c.enemies.living().find((e) => e.kind === "boss");
  return { exists: !!b, kind: c.run.currentNode?.bossKind, maxHp: b ? b.maxHp : 0 };
});
check("Rift Echo spawns", spawned.exists && spawned.kind === "echo", `maxHp=${spawned.maxHp}`);

// Drop it past 50% → phase 2
let phase2 = false;
const phaseSeen = await page.evaluate(() => new Promise((res) => {
  const c = window.__rh3;
  let saw = false;
  const off = c.events.on("BOSS_PHASE", ({ phase }) => { if (phase === 2) saw = true; });
  const b = c.enemies.living().find((e) => e.kind === "boss");
  if (b) b.takeDamage(Math.round(b.maxHp * 0.55));
  setTimeout(() => { off(); res(saw); }, 400);
}));
phase2 = phaseSeen;
check("Rift Echo escalates to phase 2", phase2);

// Kill it — must resolve as a mid-map clear, NOT a run victory
const after = await page.evaluate(() => new Promise((res) => {
  const c = window.__rh3;
  const b = c.enemies.living().find((e) => e.kind === "boss");
  if (b) b.takeDamage(99999);
  setTimeout(() => res(c.run.state), 600);
}));
check("Beating the Echo is a mid-map clear (not victory)", after !== "victory", `run.state=${after}`);

// --- Shrine + Gamble screens render without error
await page.evaluate(() => window.__rh3menus.showShrine(() => {}));
await page.waitForTimeout(300);
check("Shrine screen renders", await page.locator("h2:has-text('BLOODSTONE ALTAR')").count() > 0);
await page.evaluate(() => { window.__rh3menus.clear(); window.__rh3menus.showGamble(() => {}); });
await page.waitForTimeout(300);
check("Gamble screen renders", await page.locator("h2:has-text(\"THE RIFT'S WAGER\")").count() > 0);
await page.evaluate(() => window.__rh3menus.clear());

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join("\n")}` : "NO CONSOLE ERRORS");
console.log(fail === 0 && errors.length === 0 ? "SUPERBOSS: ALL PASS" : `SUPERBOSS: ${fail} FAILURES`);
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
