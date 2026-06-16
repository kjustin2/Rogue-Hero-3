// Adversarial edge-case hunt: room-boundary carry-over, per-hero Overdrive, damage
// stacking sanity, save round-trip, bosses-have-no-affix. Needs the dev server on 5174.
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

// Start a run.
await page.evaluate(() => localStorage.removeItem("rh3v2-runsave"));
await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
await page.waitForTimeout(600);
await page.locator(".hero-card").first().click();
await page.waitForTimeout(700);
if (await page.locator(".story-skip").count()) await page.locator(".story-skip").click();
await page.waitForTimeout(2400);
for (let i = 0; i < 24; i++) { if (await page.evaluate(() => window.__rh3.playing)) break; await page.waitForTimeout(300); }

// 1) Overdrive must NOT carry across a room boundary.
const carry = await page.evaluate(() => {
  const c = window.__rh3;
  c.tempo.gain(100); c.overdrive.tryActivate();
  const activeBefore = c.overdrive.active;
  c.events.emit("ROOM_START", { index: 1, name: "x", isBoss: false, act: 1, elite: false });
  return { activeBefore, activeAfter: c.overdrive.active };
});
check("Overdrive activates", carry.activeBefore);
check("Overdrive cleared on room start (no carry-over)", carry.activeBefore && !carry.activeAfter);

// 2) Every hero can ignite Overdrive without error.
const perHero = await page.evaluate(() => {
  const c = window.__rh3;
  const out = [];
  for (const h of window.__rh3heroes) {
    c.player.applyHero(h, c.profile.data.equipped.cape, c.profile.data.equipped.blade);
    c.overdrive.reset();
    c.tempo.reset(); c.tempo.gain(100);
    c.overdrive.tryActivate();
    out.push({ id: h.id, active: c.overdrive.active, mult: c.overdrive.damageMult });
  }
  c.overdrive.reset();
  return out;
});
check("All 6 heroes ignite Overdrive", perHero.length === 6 && perHero.every((h) => h.active && h.mult > 1), perHero.map((h) => h.id).join(","));

// 3) Damage stacking (vulnerable × overdrive × crescendo × rank) stays finite + positive.
const dmg = await page.evaluate(() => {
  const c = window.__rh3;
  c.enemies.clear();
  c.player.applyHero(window.__rh3heroes[0], c.profile.data.equipped.cape, c.profile.data.equipped.blade);
  c.tempo.reset(); c.tempo.gain(100); c.overdrive.tryActivate();
  c.combat.runRankMult = 1.3;
  c.enemies.spawn("husk", 2, 0, 0);
  return new Promise((res) => setTimeout(() => {
    const e = c.enemies.living().find((x) => x.kind === "husk");
    if (!e) return res({ ok: false });
    e.applyVulnerable(5, 2);
    const before = e.hp;
    c.combat.dealDamage(e, 10, {});
    const dealt = before - e.hp; // overkill makes hp negative — that's fine
    c.overdrive.reset();
    return res({ ok: true, dealt, finite: Number.isFinite(e.hp) });
  }, 400));
});
check("Stacked damage is finite + amplified", dmg.ok && dmg.finite && dmg.dealt > 10, `dealt~${dmg.dealt}`);

// 4) The run save (written by the game's own checkpoint at run start) carries maxHp.
const saved = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem("rh3v2-runsave") || "null"); } catch { return null; } });
check("Run save carries maxHp + relics fields", !!saved && typeof saved.maxHp === "number" && Array.isArray(saved.relics), saved ? `maxHp=${saved.maxHp}` : "no save");

// 5) Bosses never carry elite affixes (spawned via boss.make, not makeElite/makeChampion).
const bossAffix = await page.evaluate(() => {
  window.__rh3.run.debugLoadBoss("warden", 1, 424242, 3);
  return new Promise((res) => setTimeout(() => {
    const bz = window.__rh3.enemies.living().find((e) => e.kind === "boss");
    res(bz ? bz.affixes.length : -1);
  }, 3200)); // wait past the 2.4s boss materialize
});
check("Bosses have no elite affixes", bossAffix === 0, `affixes=${bossAffix}`);

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join("\n")}` : "NO CONSOLE ERRORS");
console.log(fail === 0 && errors.length === 0 ? "EDGE: ALL PASS" : `EDGE: ${fail} FAILURES`);
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
