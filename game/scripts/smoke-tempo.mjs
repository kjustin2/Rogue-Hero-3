// Tempo active-system smoke: Crescendo stacks at Critical, and the perfect-crash
// refund still works. Needs dev server :5174.
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

// Jump into a combat node at a known seed/depth.
await page.evaluate(() => { localStorage.removeItem("rh3v2-runsave"); });
await page.evaluate(() => {
  const c = window.__rh3;
  c.player.applyHero(window.__rh3.player.hero, c.profile.data.equipped.cape, c.profile.data.equipped.blade);
});
await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
await page.waitForTimeout(600);
await page.locator(".hero-card").first().click();
await page.waitForTimeout(700);
if (await page.locator(".story-skip").count()) { await page.locator(".story-skip").click(); }
await page.waitForTimeout(2400);

// --- Crescendo: holding Critical builds stacks (the live loop ticks it)
// Crescendo builds while held at Critical. Drive tempo.update directly with a big
// dt so the check is deterministic (no dependence on wall-clock frame pacing).
const cres = await page.evaluate(() => {
  const c = window.__rh3;
  c.tempo.reset();
  c.tempo.gain(100);          // into Critical
  c.tempo.update(1.5);        // 1.5s held...
  c.tempo.gain(100);
  c.tempo.update(1.5);        // ...total > 2.6s → +1 Crescendo stack
  return c.tempo.crescendo;
});
check("Crescendo stacks at sustained Critical", cres > 0, `${cres} stacks`);
const cresMult = await page.evaluate(() => window.__rh3.tempo.crescendoMult);
check("Crescendo raises damage mult", cresMult > 1, `${cresMult.toFixed(2)}x`);

// --- Perfect crash bonus at >=95
const pc = await page.evaluate(() => {
  const c = window.__rh3;
  c.tempo.reset(); c.tempo.gain(100); // value 100 -> perfect
  const before = c.stats.crashes;
  c.combat.crashNova();
  return { crashed: c.stats.crashes > before, after: c.tempo.value };
});
check("Perfect crash fires + refunds heat", pc.crashed && pc.after > 35, `tempo→${Math.round(pc.after)}`);

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join("\n")}` : "NO CONSOLE ERRORS");
console.log(fail === 0 && errors.length === 0 ? "TEMPO: ALL PASS" : `TEMPO: ${fail} FAILURES`);
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
