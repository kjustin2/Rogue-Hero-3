// Player visual smoke: walking should keep a grounded stride without side sway,
// and the hero body should not contain the old glowing back torus.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const EXE = join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1217/chrome-win64/chrome.exe");
const OUT = "shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

let fail = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " - " + extra : ""}`);
  if (!ok) fail++;
};

await page.goto("http://localhost:5174", { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.removeItem("rh3v2-runsave"));
await page.waitForTimeout(1200);
await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
await page.waitForTimeout(600);
await page.locator(".hero-card").first().click();
await page.waitForTimeout(700);
if (await page.locator(".story-skip").count()) await page.locator(".story-skip").click();
await page.waitForTimeout(2200);

await page.evaluate(() => {
  const c = window.__rh3;
  c.enemies.clear();
  c.hostiles.clear();
  c.run.state = "idle";
  c.player.hp = c.player.maxHp;
});
await page.mouse.move(1180, 260);
await page.keyboard.down("w");
await page.keyboard.down("d");
await page.waitForTimeout(900);
await page.screenshot({ path: join(OUT, "player-walk-layered.png") });
const moving = await page.evaluate(() => {
  const p = window.__rh3.player;
  let torusCount = 0;
  let meshCount = 0;
  p.body.traverse((o) => {
    if (o?.isMesh) meshCount++;
    if (o?.geometry?.type === "TorusGeometry") torusCount++;
  });
  return {
    move: p.animMoveAmount,
    bodyZ: p.body.rotation.z,
    bodyX: p.body.rotation.x,
    torsoY: p.torso.rotation.y,
    torsoZ: p.torso.rotation.z,
    capeY: p.cape.rotation.y,
    capeZ: p.cape.rotation.z,
    legDelta: Math.abs(p.legR.rotation.x - p.legL.rotation.x),
    side: p.moveSide,
    forward: p.moveForward,
    torusCount,
    meshCount,
  };
});
await page.keyboard.up("w");
await page.keyboard.up("d");

check("walk input drives movement animation", moving.move > 0.35, JSON.stringify(moving));
check("walk pose has visible leg stride", moving.legDelta > 0.22, JSON.stringify(moving));
check("walk pose keeps body side sway restrained", Math.abs(moving.bodyZ) + Math.abs(moving.torsoZ) + Math.abs(moving.torsoY) < 0.035, JSON.stringify(moving));
check("walk pose still has controlled forward lean", Math.abs(moving.bodyX) > 0.015 && Math.abs(moving.bodyX) < 0.08, JSON.stringify(moving));
check("cape stays visually stable while moving", Math.abs(moving.capeY) + Math.abs(moving.capeZ) < 0.025, JSON.stringify(moving));
check("hero model has layered armor detail", moving.meshCount >= 90, `meshCount=${moving.meshCount}`);
check("hero body has no back torus arc", moving.torusCount === 0, `torusCount=${moving.torusCount}`);

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join("\n")}` : "NO CONSOLE ERRORS");
console.log(fail === 0 && errors.length === 0 ? "PLAYER ANIMATION: ALL PASS" : `PLAYER ANIMATION: ${fail} FAILURES`);
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
