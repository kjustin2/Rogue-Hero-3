// Mid-act interlude words-lock smoke: the causeway pauses the hero until the
// act's story banners have come and gone, THEN lets them walk across to a light.
// Drives the real interlude via __rh3debug.interlude(act) and asserts:
//   • while the words play  → input disabled, locked=true, movement keys do nothing
//   • after the last banner → input enabled, locked=false, movement keys move you
// Screenshots both states into shots/ for eyeball review.
import { launchBrowser, bootGame, enterRun, sleep } from "./loop/lib.mjs";
import { mkdirSync } from "node:fs";

mkdirSync("shots", { recursive: true });

const { browser, page, errors } = await launchBrowser();
await bootGame(page);
await enterRun(page);

// Focus the page so window keydown listeners receive the movement keys.
await page.mouse.click(800, 450);
await page.waitForTimeout(150);

// Trigger a mid-act interlude (act 2 → two story lines).
const started = await page.evaluate(() => !!window.__rh3debug?.interlude?.(2));
if (!started) { console.log("SETUP FAIL: __rh3debug.interlude missing"); await browser.close(); process.exit(1); }
await page.waitForTimeout(1200);

/** Hold `key` for `ms` and return how far the hero moved (world units). */
async function moveDelta(key, ms) {
  const before = await page.evaluate(() => ({ x: window.__rh3.player.pos.x, z: window.__rh3.player.pos.z }));
  await page.keyboard.down(key);
  await sleep(ms);
  await page.keyboard.up(key);
  const after = await page.evaluate(() => ({ x: window.__rh3.player.pos.x, z: window.__rh3.player.pos.z }));
  return Math.hypot(after.x - before.x, after.z - before.z);
}

const snap = () => page.evaluate(() => ({
  enabled: window.__rh3.input.enabled,
  locked: window.__rh3debug.interludeLocked(),
  state: window.__rh3state(),
}));

// ── While the words play: frozen ──────────────────────────────────────────
const lockedState = await snap();
const lockedDelta = await moveDelta("KeyD", 700); // side-step: no pad/arena interaction
await page.screenshot({ path: "shots/interlude-locked.png" });

// ── Wait for the last banner to come and go (release timer flips locked) ───
let released = false;
for (let i = 0; i < 46; i++) { // up to ~23s (act-2 words end ~18.6s in)
  if ((await page.evaluate(() => window.__rh3debug.interludeLocked())) === false) { released = true; break; }
  await sleep(500);
}
await page.waitForTimeout(300);

// ── After release: free to move ───────────────────────────────────────────
const freeState = await snap();
const freeDelta = await moveDelta("KeyD", 700);
await page.screenshot({ path: "shots/interlude-released.png" });

const checks = [
  ["locked: input disabled", lockedState.enabled === false],
  ["locked: flag=true", lockedState.locked === true],
  ["locked: hero frozen (Δ<0.15)", lockedDelta < 0.15],
  ["locked: still in playing", lockedState.state === "playing"],
  ["release fired", released],
  ["released: input enabled", freeState.enabled === true],
  ["released: flag=false", freeState.locked === false],
  ["released: hero moves (Δ>0.4)", freeDelta > 0.4],
];
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
console.log(`  lockedΔ=${lockedDelta.toFixed(2)}  freeΔ=${freeDelta.toFixed(2)}`);
console.log(errors.length ? `CONSOLE ERRORS (${errors.length}):\n${errors.slice(0, 8).join("\n")}` : "NO CONSOLE ERRORS");

const passed = checks.every(([, ok]) => ok) && errors.length === 0;
await browser.close();
process.exit(passed ? 0 : 1);
