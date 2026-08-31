import { guard } from "./lib/guard.cjs";
guard(); // test-run governor: watchdog + machine lock + memory sentinel (lib/guard.cjs)
// Headless-browser smoke: boots the game, captures console errors, screenshots
// the menu and (via simulated input) early gameplay. Usage: node scripts/smoke-browser.mjs
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const EXE = join(
  process.env.LOCALAPPDATA,
  "ms-playwright/chromium-1217/chrome-win64/chrome.exe"
);
const OUT = "shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();

const errors = [];
let fail = 0;
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});
page.on("pageerror", (err) => errors.push(`PAGEERROR: ${err.message}`));

await page.goto("http://localhost:5174", { waitUntil: "networkidle" });
const begin = page.locator("button", { hasText: /Begin Run|New Run/ });
try {
  await page.waitForFunction(() => window.__rh3boot?.ready === true, null, { timeout: 20000 });
} catch {
  const boot = await page.evaluate(() => window.__rh3boot ?? null);
  fail++;
  errors.push(`Explicit boot-ready state missed its deadline: ${JSON.stringify(boot)}`);
}
try { await begin.waitFor({ state: "visible", timeout: 1500 }); }
catch { fail++; errors.push("Main menu was not visible after boot-ready"); }
if (await page.locator("#rift-loader").count()) {
  fail++;
  errors.push("Boot reported ready while the loader was still attached");
}
await page.waitForTimeout(150);
await page.screenshot({ path: join(OUT, "1-menu.png") });
const floorLayering = await page.evaluate(() => window.__rh3debug.floorLayering());
if (!floorLayering.ok) {
  fail++;
  errors.push(`Gameplay floor markers are occluded by decorative relief: ${JSON.stringify(floorLayering)}`);
}

// Start a run (Begin Run → hero select → pick The Blade)
await page.evaluate(() => localStorage.removeItem("rh3v2-runsave"));
if (await begin.count()) {
  await begin.click();
  await page.waitForTimeout(700);
  await page.locator(".hero-card").first().click();
await page.waitForTimeout(800);
if (await page.locator(".story-skip").count()) {
  await page.locator(".story-skip").click();
  await page.waitForTimeout(600);
}
  await page.waitForTimeout(2400); // act card + spawn-in
  await page.evaluate(() => {
    const c = window.__rh3;
    window.__rh3menus.clear();
    // The smoke already entered a real generated room. Stop its wave sequencer
    // now so the five review frames stay authored and repeatable.
    c.run.state = "cleared";
    c.enemies.clear();
    c.features.clear();
    c.projectiles.clear();
    c.hostiles.clear();
    c.caster.clear();
    c.decals.clear();
    c.arena.setObstacles([], 0);
    c.player.hp = c.player.maxHp;
    c.player.pos.set(0, 0, 0);
    c.player.facing = 0;
    c.cam.mode = "follow";
    c.cam.snapTo(0, 0);
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, "2-gameplay.png") });

  // One controlled target makes pose, silhouette, telegraph and contact readable.
  await page.evaluate(() => {
    const c = window.__rh3;
    c.enemies.spawn("husk", 0, 2.6, 0);
    c.enemies.update(0);
    const target = c.enemies.living()[0];
    if (target) target.setSpawnGrace(4);
    c.player.hp = c.player.maxHp;
    c.player.facing = 0;
  });
  await page.waitForTimeout(850); // let the spawn beam clear before judging attack readability
  await page.mouse.move(800, 300);
  await page.mouse.click(800, 300);
  await page.waitForTimeout(140);
  await page.screenshot({ path: join(OUT, "3-combat.png") });

  // Dodge + card cast
  await page.keyboard.press("Space");
  await page.waitForTimeout(220);
  await page.keyboard.press("Digit1");
  await page.waitForTimeout(180);
  await page.screenshot({ path: join(OUT, "4-cards.png") });

  // Pause menu
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, "5-pause.png") });
} else {
  fail++;
  errors.push("Begin Run button not found");
}

console.log(errors.length ? `CONSOLE ERRORS (${errors.length}):\n` + errors.slice(0, 12).join("\n") : "NO CONSOLE ERRORS");
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
