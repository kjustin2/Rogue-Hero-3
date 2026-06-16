// Boss ward smoke: the shared invulnerability mechanic (hits deflected while
// warded, then vulnerable again), the close-range punish shockwave, and the
// raised per-boss HP. Loaded at depth 0 so HP isn't difficulty-scaled. :5174.
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

// Enter a run.
await page.evaluate(() => localStorage.removeItem("rh3v2-runsave"));
await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
await page.waitForTimeout(600);
await page.locator(".hero-card").first().click();
await page.waitForTimeout(700);
if (await page.locator(".story-skip").count()) await page.locator(".story-skip").click();
await page.waitForTimeout(2200);

async function loadBoss(kind, act) {
  await page.evaluate(({ k, a }) => { window.__rh3menus.clear(); window.__rh3.run.debugLoadBoss(k, a, 909, 0); }, { k: kind, a: act });
  await page.waitForTimeout(1300);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }))); // skip entrance
  await page.waitForTimeout(1400);
  return page.evaluate(() => {
    const b = window.__rh3.enemies.living().find((e) => e.kind === "boss");
    return b ? b.maxHp : 0;
  });
}

// --- HP per boss (depth 0 = unscaled base).
const expect = { warden: 1300, spire: 1550, colossus: 2100, tyrant: 1900, unmaker: 2400, echo: 1750 };
for (const [kind, act] of [["warden", 1], ["spire", 2], ["colossus", 3], ["tyrant", 4], ["unmaker", 5], ["echo", 4]]) {
  const hp = await loadBoss(kind, act);
  check(`${kind} HP raised`, hp === expect[kind], `maxHp=${hp} (want ${expect[kind]})`);
}

// --- Ward mechanic on the Warden (shared base code → proves it for all).
await loadBoss("warden", 1);
const r = await page.evaluate(() => {
  const c = window.__rh3;
  const b = c.enemies.living().find((e) => e.kind === "boss");
  if (!b) return { ok: false };
  // 1. Warded → damage is deflected.
  b.setInvuln(5);
  const hp0 = b.hp;
  b.takeDamage(400);
  const deflected = b.hp === hp0 && b.warded === true;
  // 2. Ward ends → damageable again.
  b.invulnTime = 0;
  b.takeDamage(400);
  const vulnerableAgain = b.hp < hp0;
  // 3. The close punish shockwave hurts a player standing on the boss.
  c.player.alive = true; c.player.hp = c.player.maxHp;
  c.player.pos.x = b.pos.x; c.player.pos.z = b.pos.z;
  const pHp = c.player.hp;
  b.wardShock(5, 20, 0xffffff);
  const punished = c.player.hp < pHp;
  return { ok: true, deflected, vulnerableAgain, punished };
});
check("warded boss deflects all damage", r.ok && r.deflected);
check("boss is damageable again once the ward ends", r.ok && r.vulnerableAgain);
check("guard shockwave punishes a hugging player", r.ok && r.punished);

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join("\n")}` : "NO CONSOLE ERRORS");
console.log(fail === 0 && errors.length === 0 ? "WARD: ALL PASS" : `WARD: ${fail} FAILURES`);
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
