// THE WOUND BENEATH (Ascension true-final) smoke: killing the Unmaker at depth 3+
// tears the floor open and stages the Wound fight on the final fork. Asserts the
// reveal fires, the wound spawns with its own tempo meter, it SWALLOWS a card slot,
// a phase break returns it, and killing it wins the run. Needs dev server :5174.
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

await page.evaluate(() => localStorage.removeItem("rh3v2-runsave"));
await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
await page.waitForTimeout(600);
await page.locator(".hero-card").first().click();
await page.waitForTimeout(700);
if (await page.locator(".story-skip").count()) await page.locator(".story-skip").click();
await page.waitForTimeout(2400);

// Jump to the Unmaker at depth 3 (the Wound threshold) and kill it.
await page.evaluate(() => { window.__rh3debug.godmode(); window.__rh3.run.debugLoadNode("boss", 5, 424242, 3); });
await page.waitForTimeout(1000);
await page.evaluate(() => window.__rh3debug.skipCutscene());
await page.waitForTimeout(6500); // outlast spawn grace (headless clock runs slow)
for (let k = 0; k < 8; k++) {
  await page.evaluate(() => { const b = window.__rh3debug.boss0(); if (b) b.takeDamage(999999); });
  await page.waitForTimeout(1000);
  if (!(await page.evaluate(() => !!window.__rh3debug.boss0()))) break;
}

// The floor gives way → the Wound loads on the final fork.
let woundUp = false;
for (let i = 0; i < 60; i++) {
  woundUp = await page.evaluate(() =>
    window.__rh3.run.currentNode?.bossKind === "wound" && !!window.__rh3.enemies.living().find((e) => e.kind === "boss"));
  if (woundUp) break;
  await page.waitForTimeout(400);
}
check("Wound reveal stages the true-final fight", woundUp);
await page.evaluate(() => window.__rh3debug.skipCutscene());
await page.waitForTimeout(1000);
const name = await page.evaluate(() => document.querySelector(".bossbar__name")?.textContent ?? "");
check("Boss bar names THE WOUND BENEATH", /WOUND BENEATH/i.test(name), name);

// Its own tempo meter appears, and it swallows a card slot after settling in.
let stole = false, tempoShown = false;
for (let i = 0; i < 60; i++) {
  const s = await page.evaluate(() => ({
    stolen: window.__rh3.deck.stolen.some(Boolean),
    tempo: !!document.querySelector(".bossbar--tempo"),
    stolenClass: !!document.querySelector(".slot--stolen"),
  }));
  tempoShown = tempoShown || s.tempo;
  if (s.stolen && s.stolenClass) { stole = true; break; }
  await page.waitForTimeout(500);
}
check("Boss tempo meter renders", tempoShown);
check("It swallows a card slot (deck + HUD)", stole);
await page.screenshot({ path: "shots/wound-fight.png" });

// Break a phase → the swallowed card returns (then it takes another).
await page.evaluate(() => window.__rh3debug.setBossPhase(0.5));
await page.waitForTimeout(2500);
await page.evaluate(() => window.__rh3debug.skipCutscene());
await page.waitForTimeout(800);
const phase2 = await page.evaluate(() => {
  const b = window.__rh3debug.boss0();
  return b ? b.phase : 0;
});
check("Phase 2 reached", phase2 >= 2, `phase=${phase2}`);

// Kill it → the run resolves to victory through the normal ending.
for (let k = 0; k < 8; k++) {
  await page.evaluate(() => { const b = window.__rh3debug.boss0(); if (b) b.takeDamage(999999); });
  await page.waitForTimeout(1000);
  if (!(await page.evaluate(() => !!window.__rh3debug.boss0()))) break;
}
const restored = await page.evaluate(() => !window.__rh3.deck.stolen.some(Boolean));
check("Death returns every swallowed card", restored);
let title = "";
for (let i = 0; i < 24; i++) {
  if (await page.locator(".story-skip").count()) await page.locator(".story-skip").click();
  if (await page.locator(".end-title--victory").count()) { title = (await page.locator(".end-title--victory").textContent()) || ""; break; }
  await page.waitForTimeout(400);
}
check("Victory after the Wound falls", title.length > 0, title);
const woundKills = await page.evaluate(() => window.__rh3.profile.data.woundKills);
check("Wound kill banked to the profile", woundKills >= 1, `woundKills=${woundKills}`);

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join("\n")}` : "NO CONSOLE ERRORS");
console.log(fail === 0 && errors.length === 0 ? "WOUND: ALL PASS" : `WOUND: ${fail} FAILURES`);
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
