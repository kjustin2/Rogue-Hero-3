import { guard } from "./lib/guard.cjs";
guard({ name: "smoke-gameplay-camera", maxMinutes: 4 });

import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const EXE = join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1217/chrome-win64/chrome.exe");
const OUT = "shots";
mkdirSync(OUT, { recursive: true });

const viewports = [
  { name: "wide", width: 1600, height: 900 },
  { name: "narrow", width: 820, height: 900 },
];

let fail = 0;
const errors = [];
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? ` - ${extra}` : ""}`);
  if (!ok) fail++;
};

const browser = await chromium.launch({ executablePath: EXE, headless: true });
for (const viewport of viewports) {
  const page = await (await browser.newContext({ viewport })).newPage();
  page.on("console", (message) => message.type() === "error" && errors.push(`[${viewport.name}] ${message.text()}`));
  page.on("pageerror", (error) => errors.push(`[${viewport.name}] PAGEERROR: ${error.message}`));
  await page.goto("http://localhost:5174", { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__rh3boot?.ready === true, null, { timeout: 20000 });

  // Enter through the real front-end once so camera/HUD/run state matches play.
  await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
  await page.locator(".hero-confirm").waitFor({ state: "visible", timeout: 12000 });
  await page.locator(".hero-confirm").click();
  await page.locator(".story-skip").waitFor({ state: "visible", timeout: 12000 });
  await page.locator(".story-skip").click();
  await page.waitForTimeout(700);

  await page.evaluate(() => {
    window.__rh3menus.clear();
    window.__rh3debug.freezeForTest(false);
    window.__rh3debug.scenario("room:combat", { act: 1 });
  });
  await page.waitForTimeout(1100);
  const combat = await page.evaluate(() => {
    const c = window.__rh3;
    document.querySelector(".banner")?.classList.remove("banner--show");
    document.querySelectorAll(".actcard").forEach((element) => element.remove());
    c.enemies.clearNonBosses();
    c.enemies.spawn("husk", -2.2, -3.4, 0);
    c.enemies.spawn("spitter", 2.2, -4.5, 0);
    c.enemies.spawn("sentinel", 0, -7, 0);
    // One deliberate foreground blocker proves the new isometric view cannot
    // hide the hero. It remains visible and collidable, but must cut away.
    c.arena.setObstacles([{ x: 0, z: 7.2, r: 1.25 }], 0xff6a35);
    c.player.pos.set(0, 0, 3);
    c.cam.aimPoint.set(0, 0, -4.5);
    const positions = [[-2.2, -3.4], [2.2, -4.5], [0, -7]];
    c.enemies.living().slice(0, positions.length).forEach((enemy, index) => {
      enemy.setSpawnGrace(1e9);
      enemy.pos.set(positions[index][0], 0, positions[index][1]);
      enemy.root.position.set(positions[index][0], 0, positions[index][1]);
    });
    c.cam.mode = "follow";
    c.cam.snapTo(c.player.pos.x, c.player.pos.z);
    window.__rh3debug.frames(45);
    window.__rh3debug.freezeForTest(true);
    return {
      camera: window.__rh3debug.cameraFraming(),
      actors: window.__rh3debug.actorFraming(),
      occlusion: window.__rh3debug.foregroundOcclusion(),
    };
  });
  await page.screenshot({ path: join(OUT, `gameplay-camera-combat-${viewport.name}.png`) });
  check(`${viewport.name} combat uses three-quarter follow camera`, combat.camera.mode === "follow" && combat.camera.pitchDeg >= 34 && combat.camera.pitchDeg <= 42, JSON.stringify(combat.camera));
  check(`${viewport.name} combat subjects remain framed`, combat.actors.length >= 2 && combat.actors.every((actor) => actor.inFrame), JSON.stringify(combat.actors));
  check(`${viewport.name} foreground blocker cuts away from hero`, combat.occlusion.active === 1 && combat.occlusion.maxFade >= 0.95, JSON.stringify(combat.occlusion));

  await page.evaluate(() => {
    window.__rh3debug.freezeForTest(false);
    window.__rh3debug.scenario("boss:warden", { skipIntro: true });
  });
  await page.waitForFunction(() => window.__rh3state() === "playing" && window.__rh3.enemies.living().some((enemy) => enemy.kind === "boss"), null, { timeout: 14000 });
  const boss = await page.evaluate(() => {
    const c = window.__rh3;
    const warden = c.enemies.living().find((enemy) => enemy.kind === "boss");
    c.enemies.clearNonBosses();
    c.player.pos.set(0, 0, 3.2);
    if (warden) {
      warden.setSpawnGrace(1e9);
      warden.pos.set(0, 0, -4.2);
      warden.root.position.set(0, 0, -4.2);
    }
    c.cam.mode = "follow";
    c.cam.snapTo(c.player.pos.x, c.player.pos.z);
    window.__rh3debug.frames(45);
    if (warden) {
      warden.pos.set(0, 0, -4.2);
      warden.root.position.set(0, 0, -4.2);
    }
    window.__rh3debug.freezeForTest(true);
    return {
      camera: window.__rh3debug.cameraFraming(),
      actors: window.__rh3debug.actorFraming(),
      hud: window.__rh3debug.hudState(),
    };
  });
  await page.screenshot({ path: join(OUT, `gameplay-camera-warden-${viewport.name}.png`) });
  const wardenFrame = boss.actors.find((actor) => actor.id.includes(":boss"));
  check(`${viewport.name} Warden fight uses gameplay follow camera`, boss.camera.mode === "follow" && boss.hud.combatChromeVisible, JSON.stringify({ camera: boss.camera, hud: boss.hud }));
  check(`${viewport.name} Warden and hero remain fully framed`, !!wardenFrame?.inFrame && boss.actors.every((actor) => actor.inFrame), JSON.stringify(boss.actors));
  await page.close();
}

check("no console errors", errors.length === 0, errors.slice(0, 8).join(" | "));
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
