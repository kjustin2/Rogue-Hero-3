// Ascension smoke: depth picker on hero select + live enemy-HP/damage scaling.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const EXE = join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1217/chrome-win64/chrome.exe");
mkdirSync("shots", { recursive: true });
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
await page.goto("http://localhost:5174", { waitUntil: "networkidle" });
await page.waitForTimeout(2000);

let fail = 0;
const check = (n, ok, x = "") => { console.log(`${ok ? "OK  " : "FAIL"} ${n}${x ? "  — " + x : ""}`); if (!ok) fail++; };

// Pretend the player has unlocked depth 5.
await page.evaluate(() => { window.__rh3.profile.data.maxDepth = 5; localStorage.removeItem("rh3v2-runsave"); });
await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
await page.waitForTimeout(700);
await page.screenshot({ path: "shots/x-depth.png" });
const label = await page.locator(".depth-pick__label").textContent();
check("depth picker defaults to ceiling (5)", /RIFT DEPTH 5/.test(label ?? ""), JSON.stringify(label));

// Step down once and back up to exercise the stepper
await page.locator('[data-d="dn"]').click();
await page.waitForTimeout(150);
const lowered = await page.locator(".depth-pick__label").textContent();
check("◂ lowers depth", /RIFT DEPTH 4/.test(lowered ?? ""), JSON.stringify(lowered));
await page.locator('[data-d="up"]').click();
await page.waitForTimeout(150);

// Start the run at depth 5
await page.locator(".hero-card").first().click();
await page.waitForTimeout(800);
if (await page.locator(".story-skip").count()) { await page.locator(".story-skip").click(); await page.waitForTimeout(600); }
await page.waitForTimeout(2600);

// Spawn a husk in the live run and verify the materialization HP hook scaled it.
const r = await page.evaluate(async () => {
  const c = window.__rh3;
  c.enemies.spawn("husk", 9, 0, 0.1);
  await new Promise((res) => setTimeout(res, 700));
  const husk = c.enemies.living().find((e) => e.kind === "husk");
  return {
    depth: c.difficulty.depth,
    hpMult: c.difficulty.enemyHpMult,
    dmgMult: c.difficulty.enemyDmgMult,
    huskHp: husk ? husk.maxHp : -1,
    expected: Math.round(30 * c.difficulty.enemyHpMult), // husk base 30
    hudDepth: document.querySelector(".roominfo__depth")?.textContent ?? "",
  };
});
check("run difficulty is depth 5", r.depth === 5, `depth=${r.depth}`);
check("enemy HP multiplier > 1", r.hpMult > 1, `×${r.hpMult.toFixed(2)}`);
check("enemy damage multiplier > 1", r.dmgMult > 1, `×${r.dmgMult.toFixed(2)}`);
check("spawned husk HP scaled at materialization", r.huskHp === r.expected && r.huskHp > 30, `${r.huskHp} (expected ${r.expected})`);
check("HUD shows RIFT DEPTH 5", /DEPTH 5/.test(r.hudDepth), JSON.stringify(r.hudDepth));

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join("\n")}` : "NO CONSOLE ERRORS");
console.log(fail === 0 && errors.length === 0 ? "ASCENSION: ALL PASS" : `ASCENSION: ${fail} FAILURES`);
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
