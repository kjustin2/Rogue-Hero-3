// Boss portrait capture for a clipping/appearance audit: cuts to each boss via
// __rh3debug, freezes + pins it at a fixed 3/4 heading, dollies a tight cinematic
// camera onto it, and screenshots each phase. Clean, close views to spot geometry
// poking through / intersecting. Output → --out.
import { join } from "node:path";
import { launchBrowser, bootGame, sleep, ensureDir, isServerUp, ARTIFACTS } from "./lib.mjs";

const argOut = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : null;
const OUT = argOut || join(ARTIFACTS, "boss-portraits", "manual");
const SHOTS = join(OUT, "shots");
ensureDir(SHOTS);
const log = (...a) => console.log("[boss-portraits]", ...a);
if (!(await isServerUp())) { console.error("[boss-portraits] dev server not on :5174"); process.exit(2); }

const BOSSES = [
  { kind: "warden", phases: [0.68, 0.32] },
  { kind: "spire", phases: [0.68, 0.32] },
  { kind: "colossus", phases: [0.68, 0.32] },
  { kind: "tyrant", phases: [0.63, 0.30] },
  { kind: "unmaker", phases: [0.63, 0.30, 0.10] },
  { kind: "echo", phases: [0.45] },
];

const { browser, page, errors } = await launchBrowser();
const shot = async (n) => { await page.screenshot({ path: join(SHOTS, n + ".png") }); log("▸ " + n); };
const ui = () => page.evaluate(() => (window.__rh3state ? window.__rh3state() : "?"));
const waitPlaying = async () => { for (let i = 0; i < 45; i++) { if ((await ui()) === "playing") return; await sleep(200); } };
// Pin the boss still for a clean portrait, park player away, dolly the camera in.
const pinAndFrame = (zoom = 0.5) => page.evaluate((z) => {
  const c = window.__rh3;
  const b = c.enemies.living().find((e) => e.kind === "boss");
  if (b) { b.setSpawnGrace(1e9); b.pos.x = 0; b.pos.z = 0; b.heading = Math.PI * 0.85; }
  c.player.pos.x = 30; c.player.pos.z = 30; c.player.hp = c.player.maxHp;
  c.cam.cinematic(0, 1.2, z);
}, zoom);

try {
  await bootGame(page);
  await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
  await sleep(700);
  await page.locator(".hero-card").first().click();
  await sleep(800);
  if (await page.locator(".story-skip").count()) await page.locator(".story-skip").click();
  await sleep(1800);

  for (const b of BOSSES) {
    log(`==== ${b.kind} ====`);
    await page.evaluate((k) => window.__rh3debug.scenario(`boss:${k}`), b.kind);
    await waitPlaying();
    await sleep(1400);
    await pinAndFrame(0.5);
    await sleep(1400);
    await shot(`${b.kind}-p1`);
    let pi = 2;
    for (const frac of b.phases) {
      await page.evaluate((f) => window.__rh3debug.setBossPhase(f), frac);
      await waitPlaying();
      await sleep(1500); // eruption settles
      await pinAndFrame(0.52);
      await sleep(1200);
      await shot(`${b.kind}-p${pi}`);
      pi++;
    }
  }
} catch (err) {
  errors.push(`THREW: ${err.message}`);
  log("ERROR:", err.message);
} finally {
  log(errors.length ? `CONSOLE ERRORS (${errors.length}): ${errors.slice(0, 6).join(" | ")}` : "NO CONSOLE ERRORS");
  await browser.close();
  process.exit(errors.length === 0 ? 0 : 1);
}
