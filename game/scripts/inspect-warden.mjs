// Pit Warden geometry regression probe + eyeball shots. Guards the "feet clipping
// through the floor" fix: the lowest point of the boss mesh must sit at/above the
// arena floor (y≈0), not buried below it. Also dumps a couple of back views to
// shots/warden/ for a human read. Needs the dev server on :5174.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const EXE = join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1217/chrome-win64/chrome.exe");
const OUT = "shots/warden";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1200, height: 1200 } })).newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));
let fail = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? "  - " + extra : ""}`); if (!ok) fail++; };

await page.goto("http://localhost:5174", { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.removeItem("rh3v2-runsave"));
await page.waitForTimeout(1800);
await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
await page.waitForTimeout(600);
await page.locator(".hero-card").first().click();
await page.waitForTimeout(700);
if (await page.locator(".story-skip").count()) await page.locator(".story-skip").click();
await page.waitForTimeout(2000);

// Load the Pit Warden, skip the entrance, wait out the 2.4s spawn delay, then freeze.
await page.evaluate(() => {
  window.__rh3menus.clear();
  window.__rh3.player.hp = window.__rh3.player.maxHp;
  window.__rh3.run.debugLoadBoss("warden", 1, 424242, 0);
});
await page.waitForTimeout(3000);
await page.evaluate(() => window.__rh3debug?.skipCutscene?.());
for (let i = 0; i < 20; i++) {
  if (await page.evaluate(() => !!window.__rh3.enemies.living().find((e) => e.kind === "boss"))) break;
  await page.waitForTimeout(250);
}

// Lowest mesh vertex (world Y) of the boss across all three phase looks. The boss
// stands at pos.y=0, so anything well below 0 is geometry punching through the floor.
async function lowestY() {
  return page.evaluate(() => {
    const boss = window.__rh3.enemies.living().find((e) => e.kind === "boss");
    if (!boss) return 999;
    boss.root.updateWorldMatrix(true, true);
    let lo = 999;
    const v = boss.root.position.clone();            // a real Vector3 (has applyMatrix4)
    boss.root.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;          // skip sprites (HP bar) etc.
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox;
      if (!bb) return;
      for (const cx of [bb.min.x, bb.max.x]) for (const cy of [bb.min.y, bb.max.y]) for (const cz of [bb.min.z, bb.max.z]) {
        v.set(cx, cy, cz); o.localToWorld(v);
        if (v.y < lo) lo = v.y;
      }
    });
    return lo;
  });
}

// Freeze the render loop, reposition + face the boss away from us for the shots.
await page.evaluate(() => {
  const c = window.__rh3;
  const boss = c.enemies.living().find((e) => e.kind === "boss");
  c.stage.renderer.setAnimationLoop(null);
  boss.root.position.set(0, 0, 0);
  boss.root.rotation.y = 0;
  boss.root.visible = true;
});

const lo1 = await lowestY();
// A little tolerance: a few cm of plant into the floor reads as grounded; the old
// bug sank the boots ~0.13 below it leaving buried slivers.
check("phase 1 feet grounded (no floor clip)", lo1 >= -0.06, `lowestY=${lo1.toFixed(3)}`);

await page.evaluate(() => window.__rh3debug?.setBossPhase?.(0.2)); // escalate to phase 3
await page.waitForTimeout(150);
const lo3 = await lowestY();
check("phase 3 feet grounded (no floor clip)", lo3 >= -0.06, `lowestY=${lo3.toFixed(3)}`);

// Eyeball shots: hide DOM, drive a back camera, raw-render the bare canvas.
await page.evaluate(() => {
  for (const el of Array.from(document.body.children)) if (el.id !== "game") el.style.display = "none";
  window.__rh3.stage.setExposure(1.0);
});
for (const [name, pos, look] of [
  ["back-low", [0, 0.7, -6.2], [0, 1.3, 0]],
  ["back-bottom", [0, 0.35, -3.6], [0, 0.8, 0]],
]) {
  await page.evaluate(({ pos, look }) => {
    const c = window.__rh3, cam = c.stage.camera;
    cam.position.set(pos[0], pos[1], pos[2]); cam.lookAt(look[0], look[1], look[2]);
    cam.updateProjectionMatrix(); c.stage.renderer.render(c.stage.scene, cam);
  }, { pos, look });
  await page.screenshot({ path: join(OUT, `warden-${name}.png`) });
}

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.slice(0, 8).join("\n")}` : "NO CONSOLE ERRORS");
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
