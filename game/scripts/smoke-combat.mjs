// Combat-feel smoke: charged heavy (hold attack → guard-breaking sweep that leaves
// foes Vulnerable) and parry (meet a frontal blow in the swing's opening beat).
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
for (let i = 0; i < 24; i++) { if (await page.evaluate(() => window.__rh3.playing)) break; await page.waitForTimeout(300); }

// --- Charged heavy: hold attack ~0.7s with a foe ahead, release, expect it to land + Vulnerable
await page.evaluate(() => {
  const c = window.__rh3;
  c.enemies.clear();
  c.player.pos.set(0, 0, 0);
  const fx = Math.sin(c.player.facing), fz = Math.cos(c.player.facing);
  c.enemies.spawn("husk", fx * 3, fz * 3, 0);
});
await page.waitForTimeout(500);
const hpBefore = await page.evaluate(() => { const e = window.__rh3.enemies.living()[0]; return e ? e.hp : -1; });
await page.evaluate(() => document.getElementById("game").dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true })));
await page.waitForTimeout(750); // charge past 0.4s
const isCharged = await page.evaluate(() => window.__rh3.combat.charged);
await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointerup", { button: 0, bubbles: true })));
await page.waitForTimeout(300);
const heavy = await page.evaluate(() => {
  const e = window.__rh3.enemies.living()[0];
  return { dmgd: e ? e.hp : -99, vuln: e ? e.isVulnerable : false };
});
check("Attack charges when held", isCharged);
check("Charged heavy strikes a foe ahead", heavy.dmgd < hpBefore || heavy.dmgd === -99);
check("Charged heavy leaves the foe Vulnerable", heavy.vuln || heavy.dmgd === -99);

// --- Parry: start a swing, then take a frontal blow within the opening window
const parry = await page.evaluate(() => {
  const c = window.__rh3;
  return new Promise((res) => {
    document.getElementById("game").dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true }));
    setTimeout(() => {
      window.dispatchEvent(new PointerEvent("pointerup", { button: 0, bubbles: true }));
      // wait two frames so the swing is mid-window, then take a frontal hit
      setTimeout(() => {
        const active = c.combat.parryActive;
        const hp0 = c.player.hp, t0 = c.tempo.value;
        const sx = c.player.pos.x + Math.sin(c.player.facing) * 5;
        const sz = c.player.pos.z + Math.cos(c.player.facing) * 5;
        const result = c.combat.damagePlayer(20, sx, sz);
        res({ active, result, noHpLoss: c.player.hp >= hp0, tempoUp: c.tempo.value > t0 });
      }, 50);
    }, 30);
  });
});
check("Swing has a parry window", parry.active, `result=${parry.result}`);
check("Parry negates the blow", parry.result === "shielded" && parry.noHpLoss);
check("Parry surges tempo", parry.tempoUp);

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join("\n")}` : "NO CONSOLE ERRORS");
console.log(fail === 0 && errors.length === 0 ? "COMBAT: ALL PASS" : `COMBAT: ${fail} FAILURES`);
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
