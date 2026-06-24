// Portrait capture of every enemy + boss for visual-polish review.
// Enemies: load a plain combat room, clear it, spawn ONE unit at origin, dolly
// the cinematic camera in. Bosses: scenario() with repeated cutscene-skip.
// Writes <out>/unit-<kind>.png. Needs the dev server on 5174.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const EXE = join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1217/chrome-win64/chrome.exe");
const OUT = process.argv[2] || "shots/baseline";
const ONLY = process.argv[3]; // optional: only this kind
mkdirSync(OUT, { recursive: true });

const ENEMIES = [
  "husk", "spitter", "swarmer", "bomber", "sentinel",
  "wisp", "leaper", "tether", "mirror", "caster",
  "shade", "bastion", "brute", "harrier", "splitter",
  "voidling", "warper",
];
const BOSSES = ["warden", "spire", "colossus", "tyrant", "unmaker", "echo"];

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1100, height: 1100 } })).newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));

await page.goto("http://localhost:5174", { waitUntil: "networkidle" });
await page.waitForTimeout(1800);
await page.evaluate(() => localStorage.removeItem("rh3v2-runsave"));
await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
await page.waitForTimeout(700);
await page.locator(".hero-card").first().click();
await page.waitForTimeout(800);
if (await page.locator(".story-skip").count()) {
  await page.locator(".story-skip").click();
  await page.waitForTimeout(600);
}
await page.waitForTimeout(2200);

async function captureEnemy(kind, zoom) {
  await page.evaluate(() => window.__rh3.run.debugLoadNode("combat", 1));
  await page.waitForTimeout(900);
  await page.evaluate((k) => {
    const c = window.__rh3;
    for (const e of c.enemies.living()) e.dispose();
    c.enemies.clear();
    c.run.state = "idle"; // freeze room logic so nothing else spawns
    c.player.pos.x = 30; c.player.pos.z = 30; c.player.hp = c.player.maxHp;
    c.enemies.spawn(k, 0, 0, 0.05);
  }, kind);
  await page.waitForTimeout(500); // let it materialize
  // Freeze the brain and re-pin at origin facing the camera (+z) so it can't walk off.
  await page.evaluate(() => {
    const e = window.__rh3.enemies.living().find((x) => x.kind !== "boss");
    if (e) { e.setSpawnGrace(1e9); e.pos.x = 0; e.pos.z = 0; e.heading = 0; }
  });
  // Dolly the cinematic cam onto the unit; re-assert each beat.
  for (let i = 0; i < 3; i++) {
    await page.evaluate(([z]) => {
      const c = window.__rh3;
      c.player.hp = c.player.maxHp;
      const e = c.enemies.living().find((x) => x.kind !== "boss");
      if (e) { e.pos.x = 0; e.pos.z = 0; }
      c.cam.cinematic(0, 0, z);
    }, [zoom]);
    await page.waitForTimeout(600);
  }
  await page.screenshot({ path: `${OUT}/unit-enemy-${kind}.png` });
}

async function captureBoss(kind, zoom) {
  await page.evaluate((k) => window.__rh3debug.scenario(`boss:${k}`), kind);
  await page.waitForTimeout(4200); // entrance + spawn (scenario keeps skipping)
  // Skip aggressively until the banner clears, then frame the tall body. The
  // default cinematic rig is a steep top-down chase (offset 0,15.5,9.6) that
  // crushes tall bosses; drop it to a lower, more frontal heroic 3/4 angle so
  // the whole silhouette reads. offset is a plain runtime field (TS-private only).
  for (let i = 0; i < 6; i++) {
    await page.evaluate(([z]) => {
      window.__rh3debug.godmode();
      window.__rh3debug.skipCutscene();
      const c = window.__rh3;
      const b = c.enemies.living().find((e) => e.kind === "boss");
      if (b) { b.pos.x = 0; b.pos.z = 0; }
      if (c.cam.offset?.set) c.cam.offset.set(0, 8.5, 15);
      c.cam.cinematic(0, 0.4, z); // (x, z, zoom); look-at y is fixed at 1.6
    }, [zoom]);
    await page.waitForTimeout(700);
  }
  await page.screenshot({ path: `${OUT}/unit-boss-${kind}.png` });
}

const enemies = ONLY === "bosses" ? [] : (!ONLY || ONLY === "enemies") ? ENEMIES : ENEMIES.filter((k) => k === ONLY);
const bosses = ONLY === "enemies" ? [] : (!ONLY || ONLY === "bosses") ? BOSSES : BOSSES.filter((k) => k === ONLY);
for (const k of enemies) await captureEnemy(k, 0.34);
for (const k of bosses) await captureBoss(k, 0.95);

console.log(errors.length ? `CONSOLE ERRORS:\n` + errors.join("\n") : "NO CONSOLE ERRORS");
await browser.close();
