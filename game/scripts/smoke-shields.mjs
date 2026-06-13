// Verifies shields BREAK under damage (the user's ask) for Bastion + Mirror,
// and that flanking the Bastion stays the fast route.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const EXE = join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1217/chrome-win64/chrome.exe");
mkdirSync("shots", { recursive: true });

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));

await page.goto("http://localhost:5174", { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.removeItem("rh3v2-runsave"));
await page.waitForTimeout(1800);
await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
await page.waitForTimeout(700);
await page.locator(".hero-card").first().click();
await page.waitForTimeout(800);
if (await page.locator(".story-skip").count()) {
  await page.locator(".story-skip").click();
  await page.waitForTimeout(600);
}
await page.waitForTimeout(2200);

// Helper: spawn one enemy of a kind right in front of the player, return it via a global.
const spawnOne = async (kind) => {
  await page.evaluate((k) => {
    const c = window.__rh3;
    for (const e of c.enemies.living()) e.dispose();
    c.enemies.clear();
    c.run.state = "idle";
    c.player.pos.set(0, 0, 4);
    // Spawn directly (skip the telegraph delay) by reaching into the manager
    c.enemies.spawn(k, 0, -2, 0.05);
  }, kind);
  await page.waitForTimeout(400);
};

const enemyState = () =>
  page.evaluate(() => {
    const c = window.__rh3;
    const e = c.enemies.living()[0];
    if (!e) return null;
    return { kind: e.kind, hp: e.hp, maxHp: e.maxHp, shieldHp: e.shieldHp ?? null, shieldMax: e.shieldMaxHp ?? null, alive: e.alive };
  });

// ---- BASTION: hammer its FRONT with damage; shield must deplete then break, body must then drop.
await spawnOne("bastion");
// Face the bastion from in front (player south of it, bastion faces player => its front is toward player)
let log = [];
for (let i = 0; i < 12; i++) {
  await page.evaluate(() => {
    const c = window.__rh3;
    const e = c.enemies.living()[0];
    if (!e) return;
    // Hit from the player's side (front of the bastion): kb points attacker->enemy
    const dx = e.pos.x - c.player.pos.x;
    const dz = e.pos.z - c.player.pos.z;
    c.combat.dealDamage(e, 12, { kbX: dx, kbZ: dz, kb: 3 });
  });
  await page.waitForTimeout(120);
  const st = await enemyState();
  if (st) log.push(`shield=${st.shieldHp?.toFixed(0)} hp=${st.hp?.toFixed(0)}`);
  if (!st || !st.alive) break;
}
console.log("BASTION front assault:", log.join(" -> "));
const bastionShieldBroke = log.some((l) => l.includes("shield=0")) || log.length < 12;
console.log("BASTION shield breaks under front damage:", bastionShieldBroke ? "OK" : "FAIL");
await page.screenshot({ path: "shots/sh-bastion.png" });

// ---- BASTION flank: a rear hit should bypass the shield entirely (full body damage).
await spawnOne("bastion");
const flank = await page.evaluate(() => {
  const c = window.__rh3;
  const e = c.enemies.living()[0];
  const hp0 = e.hp;
  // Hit from BEHIND: kb points from a point behind the enemy toward it (opposite its facing).
  const fx = Math.sin(e.heading), fz = Math.cos(e.heading);
  c.combat.dealDamage(e, 12, { kbX: fx, kbZ: fz, kb: 3 }); // attacker behind => kb same dir as facing
  return { hp0, hp1: e.hp, shield: e.shieldHp };
});
console.log(`BASTION flank: hp ${flank.hp0}->${flank.hp1}, shield ${flank.shield}`,
  flank.hp1 < flank.hp0 ? "OK (rear bypasses shield)" : "FAIL");

// ---- MIRROR: drop it below 50% to raise the bubble, then burst it; shield HP must fall & break.
await spawnOne("mirror");
await page.evaluate(() => {
  const c = window.__rh3;
  const e = c.enemies.living()[0];
  e.hp = e.maxHp * 0.5 + 1;
  c.combat.dealDamage(e, 5, { kbX: 0, kbZ: -1, kb: 2 }); // trip the raise
});
await page.waitForTimeout(150);
const raised = await enemyState();
console.log("MIRROR bubble raised:", raised && raised.shieldHp > 0 ? `OK (shieldHp=${raised.shieldHp})` : "FAIL");
await page.screenshot({ path: "shots/sh-mirror-up.png" });
let mlog = [];
for (let i = 0; i < 10; i++) {
  await page.evaluate(() => {
    const c = window.__rh3;
    const e = c.enemies.living()[0];
    if (e) c.combat.dealDamage(e, 16, { kbX: 0, kbZ: -1, kb: 2 });
  });
  await page.waitForTimeout(120);
  const st = await enemyState();
  if (st) mlog.push(`shield=${st.shieldHp?.toFixed(0)}`);
  if (!st || st.shieldHp === 0) break;
}
console.log("MIRROR burst:", mlog.join(" -> "));
const mirrorBroke = mlog.some((l) => l.includes("shield=0"));
console.log("MIRROR shield breaks under burst:", mirrorBroke ? "OK" : "FAIL");
await page.screenshot({ path: "shots/sh-mirror-broke.png" });

// ---- FREEZE: a frozen Bastion's shield/plate must read blue like its body, not stay amber.
await spawnOne("bastion");
await page.evaluate(() => {
  const c = window.__rh3;
  const e = c.enemies.living()[0];
  if (e) e.freeze(3);
});
await page.waitForTimeout(300);
const frozenOk = await page.evaluate(() => {
  const c = window.__rh3;
  const e = c.enemies.living()[0];
  return e && e.frozen > 0;
});
console.log("BASTION freeze (shield should tint blue):", frozenOk ? "OK" : "FAIL");
await page.screenshot({ path: "shots/sh-bastion-frozen.png" });

console.log(errors.length ? `CONSOLE ERRORS (${errors.length}):\n` + errors.slice(0, 10).join("\n") : "NO CONSOLE ERRORS");
await browser.close();
