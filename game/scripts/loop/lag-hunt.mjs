// Lag hunt: finds mid-game hitches caused by first-time synchronous shader-program
// compiles. The GPU-independent signal is renderer.info.programs growing — each
// new program is a sync compile that, on a real GPU driver, can stall 100ms-2s.
// We drive through gameplay events and report which ones add programs (and when).
//
//   node scripts/loop/lag-hunt.mjs
import { launchBrowser, bootGame, sleep, isServerUp } from "./lib.mjs";

if (!(await isServerUp())) { console.error("[lag-hunt] dev server not on :5174"); process.exit(2); }
const { browser, page, errors } = await launchBrowser();
const log = (...a) => console.log("[lag-hunt]", ...a);

const setLabel = (l) => page.evaluate((x) => { window.__lagLabel = x; }, l);
const programs = () => page.evaluate(() => window.__rh3.stage.renderer.info.programs?.length ?? 0);
const dump = () => page.evaluate(() => window.__lag);

try {
  await bootGame(page);
  await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
  await sleep(700);
  await page.locator(".hero-card").first().click();
  await sleep(800);
  if (await page.locator(".story-skip").count()) await page.locator(".story-skip").click();
  await sleep(2500);

  // In-page monitor: log every program-cache jump (a sync compile) with the
  // current label, plus any long frames.
  await page.evaluate(() => {
    const r = window.__rh3.stage.renderer;
    window.__lagLabel = "boot";
    window.__lag = { jumps: [], longFrames: [], prev: r.info.programs?.length ?? 0, last: performance.now() };
    const tick = () => {
      const now = performance.now();
      const dt = now - window.__lag.last; window.__lag.last = now;
      const p = r.info.programs?.length ?? 0;
      if (p > window.__lag.prev) {
        window.__lag.jumps.push({ at: window.__lagLabel, added: p - window.__lag.prev, total: p });
        window.__lag.prev = p;
      }
      if (dt > 120) window.__lag.longFrames.push({ at: window.__lagLabel, dt: Math.round(dt) });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const base = await programs();
  log(`warmed program count after boot+combat: ${base}`);

  // Wait a moment so post-warm settles, then exercise gameplay events.
  await setLabel("act1-idle"); await sleep(800);

  // Cast the equipped cards (first-time card VFX).
  await setLabel("cards");
  for (const key of ["Digit1", "Digit2", "Digit3"]) { await page.keyboard.press(key); await sleep(500); }

  // Each act's combat room (roster + theme).
  for (let act = 1; act <= 5; act++) {
    await setLabel(`act${act}-combat`);
    await page.evaluate((a) => window.__rh3debug.room("combat", a), act);
    await sleep(1800);
    await page.evaluate(() => window.__rh3debug.godmode());
    await sleep(1200);
  }

  // Each boss (NOT in the precompiled registry — prime suspects).
  for (const kind of ["warden", "spire", "colossus", "tyrant", "unmaker", "echo"]) {
    await setLabel(`boss-${kind}`);
    await page.evaluate((k) => window.__rh3debug.scenario(`boss:${k}`), kind);
    await sleep(4200); // intro + a few attacks
    await page.evaluate(() => window.__rh3debug.godmode());
    await page.evaluate(() => window.__rh3debug.setBossPhase(0.6)); // phase VFX
    await sleep(2500);
  }

  // Map features (hazard / teleporter) if reachable.
  await setLabel("features");
  await page.evaluate(() => window.__rh3debug.room("elite", 4));
  await sleep(2500);

  const data = await dump();
  log(`final program count: ${await programs()}`);
  console.log("\n=== PROGRAM-CACHE JUMPS (sync compiles) AFTER WARM ===");
  const post = data.jumps.filter((j) => j.at !== "boot");
  if (!post.length) console.log("  (none — everything was pre-warmed)");
  for (const j of post) console.log(`  +${j.added} program(s) during "${j.at}" (total ${j.total})`);
  console.log("\n=== LONG FRAMES (>120ms) ===");
  for (const f of data.longFrames.slice(0, 30)) console.log(`  ${f.dt}ms during "${f.at}"`);
  console.log(`\nTOTAL post-warm compiles: ${post.reduce((s, j) => s + j.added, 0)} across ${post.length} event(s)`);
} catch (err) {
  errors.push(`THREW: ${err.message}`);
  log("ERROR:", err.message);
} finally {
  console.log(errors.length ? `CONSOLE ERRORS: ${errors.slice(0, 5).join(" | ")}` : "NO CONSOLE ERRORS");
  await browser.close();
}
