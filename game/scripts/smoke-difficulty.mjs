// Difficulty ladder smoke: validates the depth table (Phase 1).
// Enemy-HP / damage scaling at spawn is exercised by the live hooks in later phases.
import { chromium } from "playwright-core";
import { join } from "node:path";

const EXE = join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1217/chrome-win64/chrome.exe");
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext()).newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
await page.goto("http://localhost:5174", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

let fail = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? "  — " + extra : ""}`); if (!ok) fail++; };

const r = await page.evaluate(() => {
  const { difficultyFor, MAX_DEPTH } = window.__rh3gen;
  return { d0: difficultyFor(0), d5: difficultyFor(5), d8: difficultyFor(8), dMax: difficultyFor(MAX_DEPTH), MAX_DEPTH };
});

check("D0 is baseline (all mults = 1)", r.d0.enemyHpMult === 1 && r.d0.enemyDmgMult === 1 && r.d0.healMult === 1 && r.d0.labels.length === 0);
check("D5 scales enemy HP up", r.d5.enemyHpMult > 1, `hp×${r.d5.enemyHpMult.toFixed(2)}`);
check("D5 scales enemy damage up", r.d5.enemyDmgMult > 1, `dmg×${r.d5.enemyDmgMult.toFixed(2)}`);
check("D5 lists 5 active modifiers", r.d5.labels.length === 5, `got ${r.d5.labels.length}`);
check("D8 halves free healing", r.d8.healMult === 0.5, `heal×${r.d8.healMult}`);
// New gameplay-changing levers all engage by max depth
check("max depth speeds up enemies", r.dMax.enemySpeedMult > 1, `spd×${r.dMax.enemySpeedMult.toFixed(2)}`);
check("max depth gives enemies armor", r.dMax.enemyArmor > 0, `armor ${r.dMax.enemyArmor}`);
check("max depth drains tempo faster", r.dMax.tempoDrainMult > 1, `drain×${r.dMax.tempoDrainMult.toFixed(2)}`);
check("max depth tightens dodge window", r.dMax.dodgeWindowMult < 1, `×${r.dMax.dodgeWindowMult.toFixed(2)}`);
check("max depth lengthens cooldowns", r.dMax.cardCooldownMult > 1, `×${r.dMax.cardCooldownMult.toFixed(2)}`);
check("max depth lists every modifier", r.dMax.labels.length === r.MAX_DEPTH, `${r.dMax.labels.length}/${r.MAX_DEPTH}`);
check("max depth forces elites", r.dMax.forceElite === true);

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join("\n")}` : "NO CONSOLE ERRORS");
console.log(fail === 0 && errors.length === 0 ? "DIFFICULTY: ALL PASS" : `DIFFICULTY: ${fail} FAILURES`);
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
