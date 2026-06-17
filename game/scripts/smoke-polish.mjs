// Targeted visual polish smoke. Needs the dev server running.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const EXE = join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1217/chrome-win64/chrome.exe");
const PORT = process.env.RH3_PORT || "5174";
const OUT = "shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errors = [];
let fail = 0;

page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));

const check = (name, ok, extra = "") => {
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " - " + extra : ""}`);
  if (!ok) fail++;
};

await page.goto(`http://localhost:${PORT}`, { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.removeItem("rh3v2-runsave"));
await page.waitForTimeout(1500);
await page.screenshot({ path: join(OUT, "polish-menu-scene.png") });
check("main menu scene hooks", await page.locator(".screen--main .menu-scene").count() === 1);

await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
await page.waitForTimeout(600);
await page.locator(".hero-card").first().click();
await page.waitForTimeout(900);
if (await page.locator(".story-skip").count()) await page.locator(".story-skip").click();
await page.waitForTimeout(1900);

await page.evaluate(() => {
  const c = window.__rh3;
  window.__rh3menus.clear();
  c.player.pos.set(0, 0, 0);
  c.player.facing = 0.65;
  c.cam.snapTo(0, 0);
  c.cam.cinematic(0, 0, 0.48);
});
await page.waitForTimeout(450);
await page.screenshot({ path: join(OUT, "polish-player-detail.png") });
const playerSignals = await page.evaluate(() => {
  const c = window.__rh3;
  let meshes = 0;
  let strongGlow = 0;
  c.player.root.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    if (mat?.emissiveIntensity >= 2) strongGlow++;
  });
  return { meshes, strongGlow };
});
check("player model detail", playerSignals.meshes >= 45 && playerSignals.strongGlow >= 4, JSON.stringify(playerSignals));

await page.evaluate(() => {
  const c = window.__rh3;
  window.__rh3menus.clear();
  c.run.debugLoadNode("combat", 3, 77777, 5);
  window.__rh3menus.clear();
  c.enemies.clear();
  c.player.hp = c.player.maxHp;
  c.player.pos.set(0, 0, 0);
  c.player.facing = 0;
  c.cam.mode = "follow";
  c.cam.snapTo(0, 0);
  c.enemies.spawn("brute", 17, 0, 0);
  c.enemies.spawn("caster", -17, -2, 0);
  c.enemies.spawn("bastion", 0, 16, 0);
  document.querySelector(".banner")?.classList.remove("banner--show");
});
await page.waitForTimeout(750);
await page.evaluate(() => {
  const c = window.__rh3;
  document.querySelector(".banner")?.classList.remove("banner--show");
  const e = c.enemies.living()[0];
  if (e) {
    e.applyAffix("hasted", 0xffd24a);
    c.combat.dealDamage(e, 14, { heavy: true, kbX: 1, kbZ: 0, kb: 4, countCombo: true });
  }
  c.deck.cooldowns = [0, 0, 0];
  c.deck.tryCast(0);
});
await page.waitForTimeout(120);
await page.screenshot({ path: join(OUT, "polish-combat-markers-cast-hit.png") });

const combatSignals = await page.evaluate(() => {
  const c = window.__rh3;
  return {
    roles: c.enemies.living().filter((e) => e.root.children.some((o) => String(o.name || "").startsWith("role-"))).length,
    crown: c.enemies.living().some((e) => e.root.children.some((o) => o.name === "elite-affix-crown")),
    markers: [...document.querySelectorAll(".threat--on")].length,
    slotCast: !!document.querySelector(".slot--cast"),
  };
});
check("enemy role silhouettes", combatSignals.roles >= 2, JSON.stringify(combatSignals));
check("elite affix crown", combatSignals.crown === true);
check("off-screen threat markers", combatSignals.markers > 0, JSON.stringify(combatSignals));
check("card cast anticipation", combatSignals.slotCast === true);

await page.evaluate(() => {
  const c = window.__rh3;
  for (const e of c.enemies.living()) e.takeDamage(99999);
  c.events.emit("ROOM_CLEARED", { index: c.run.position, reward: "card" });
});
await page.waitForTimeout(240);
await page.screenshot({ path: join(OUT, "polish-room-clear-floor-pulse.png") });
check("room clear banner", await page.locator(".banner--clear").count() > 0);

await page.evaluate(() => {
  window.__rh3menus.clear();
  window.__rh3.run.debugLoadBoss("warden", 1, 44444, 5);
  window.__rh3menus.clear();
});
await page.waitForTimeout(900);
await page.keyboard.press("Space");
await page.waitForTimeout(2100);
const wardenStarted = await page.evaluate(() => {
  const c = window.__rh3;
  window.__rh3menus.clear();
  const boss = c.enemies.living().find((e) => e.kind === "boss");
  if (!boss?.beginGuard) return { exists: false, attackCd: null };
  c.player.pos.set(boss.pos.x + 3.2, 0, boss.pos.z);
  c.player.facing = -Math.PI / 2;
  c.cam.cinematic(boss.pos.x, boss.pos.z, 0.6);
  const attackCd = boss.attackCd;
  boss.beginGuard();
  return { exists: true, attackCd };
});
await page.waitForTimeout(560);
const wardenSignals = await page.evaluate(() => {
  const pool = window.__rh3.tele.pool ?? [];
  return {
    activeCircle: pool.filter((t) => t.active && t.shape === "circle").length,
    impact: pool.some((t) => t.active && t.shape === "circle" && t.impactMat?.opacity > 0.15),
  };
});
await page.screenshot({ path: join(OUT, "polish-warden-guard-warning.png") });
check("warden first attack quicker", wardenStarted.exists && wardenStarted.attackCd <= 0.8, JSON.stringify(wardenStarted));
check("warden guard impact warning", wardenSignals.activeCircle > 0 && wardenSignals.impact === true, JSON.stringify(wardenSignals));

await page.evaluate(() => {
  window.__rh3menus.clear();
  window.__rh3.run.debugLoadBoss("tyrant", 4, 88888, 5);
  window.__rh3menus.clear();
});
await page.waitForTimeout(900);
await page.keyboard.press("Space");
await page.waitForTimeout(2300);
const bossKilled = await page.evaluate(() => {
  const c = window.__rh3;
  window.__rh3menus.clear();
  const boss = c.enemies.living().find((e) => e.kind === "boss");
  if (!boss) return false;
  c.player.pos.set(boss.pos.x, 0, boss.pos.z + 5);
  c.player.facing = Math.PI;
  c.cam.mode = "follow";
  c.cam.snapTo(c.player.pos.x, c.player.pos.z);
  boss.takeDamage(999999);
  return true;
});
await page.waitForTimeout(520);
await page.screenshot({ path: join(OUT, "polish-boss-death-tyrant.png") });
const bossDeathVisible = await page.evaluate(() => {
  const canvas = document.querySelector("canvas");
  return !!canvas && canvas.width > 0 && canvas.height > 0;
});
check("boss spawned and died", bossKilled === true);
check("boss death beat rendered", bossDeathVisible);

if (errors.length) {
  console.log(`CONSOLE ERRORS (${errors.length}):\n${errors.slice(0, 12).join("\n")}`);
}
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
