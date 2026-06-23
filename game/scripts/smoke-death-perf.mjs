// Death-transition stall guard. Targets the "~3-second freeze when a boss killed
// me" bug: in a material-dense boss room the death -> "dead" screen flip turns the
// directional shadow OFF, and (before the fix) that forced a synchronous relink of
// every lit material whose shadows-OFF program variant wasn't pre-compiled. The fix:
// Stage.warmUp() now pre-compiles BOTH shadow states, so the toggle never recompiles
// on a live frame. This forces HIGH quality (shadows on; the bug can't occur on the
// low/headless-default preset where combat has no shadows), enters a boss room, kills
// the player, and asserts the transition frame stays well under a stall budget.
//
// CAVEAT: headless Chromium uses SwiftShader (software GL), which links programs far
// cheaper than a real GPU driver, so the multi-second relink does NOT fully reproduce
// here. This is a regression/no-error guard for the death path and will catch a gross
// stall on a real-GPU runner; the real-GPU win is verified by mechanism (Three keys
// the program cache on shadow count) + manual play.
import { chromium } from "playwright-core";
import { join } from "node:path";

const EXE = join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1217/chrome-win64/chrome.exe");
const URL = process.env.RH3_URL ?? "http://localhost:5174";
const THRESHOLD = Number(process.env.DEATH_PERF_BUDGET ?? "450"); // ms; old bug spiked far past this

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await context.newPage();

await page.addInitScript(() => {
  const perf = { frames: [], longTasks: [], last: 0, recording: false };
  window.__dp = perf;
  const raf = (t) => {
    if (perf.recording && perf.last) perf.frames.push(t - perf.last);
    perf.last = t;
    requestAnimationFrame(raf);
  };
  requestAnimationFrame(raf);
  try {
    new PerformanceObserver((l) => {
      if (!perf.recording) return;
      for (const e of l.getEntries()) perf.longTasks.push(e.duration);
    }).observe({ type: "longtask", buffered: false });
  } catch { /* longtask unsupported */ }
  window.__dpStart = () => { perf.frames.length = 0; perf.longTasks.length = 0; perf.recording = true; };
  window.__dpStop = () => { perf.recording = false; };
  window.__dpStats = () => ({
    max: Math.round(Math.max(0, ...perf.frames)),
    longMax: Math.round(Math.max(0, ...perf.longTasks)),
    frames: perf.frames.length,
  });
});

const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

await page.goto(URL, { waitUntil: "networkidle" });
// Force HIGH quality (shadows on) and a clean profile so the bug can manifest.
await page.evaluate(() => {
  localStorage.removeItem("rh3v2-runsave");
  localStorage.removeItem("rh3v2-profile");
  localStorage.setItem("rh3v2-settings", JSON.stringify({
    volume: 0, music: 0, shake: 1, quality: "high",
    reduceMotion: false, colorblind: false, brightness: 1, fov: 50, autoAim: true,
  }));
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(2200); // loader + warm-up

// Start a run, pick a hero, skip the opening story.
await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
await page.waitForTimeout(700);
await page.locator(".hero-card").first().click();
await page.waitForTimeout(800);
if (await page.locator(".story-skip").count()) {
  await page.locator(".story-skip").click();
  await page.waitForTimeout(700);
}
await page.waitForTimeout(1200);

// Jump straight into the act-1 boss room — the densest lit-material scene.
await page.evaluate(() => window.__rh3.run.debugLoadNode("boss", 1));
await page.waitForTimeout(1200);
// Skip the boss entrance cutscene (a keypress after the skip-grace window).
await page.keyboard.press("Space");
await page.waitForTimeout(2600); // boss materializes + several rendered frames (shadows-on programs in use)

// Let the boss fight for a few seconds while we keep the player pinned alive, so its
// phase-1 attack VFX compile their programs NOW — otherwise a first-use VFX compile
// during the death beat would pollute the program-delta measurement below.
for (let i = 0; i < 8; i++) {
  await page.evaluate(() => { window.__rh3.player.hp = window.__rh3.player.maxHp; });
  await page.waitForTimeout(500);
}

const pre = await page.evaluate(() => ({
  quality: window.__rh3.stage.quality,
  shadows: window.__rh3.stage.keyLight.castShadow,
  boss: !!window.__rh3.enemies.living().find((e) => e.kind === "boss"),
  alive: window.__rh3.player.alive,
  // GPU-independent proof: Three caches a shader program per material/define/light set.
  // The bug relinked every lit material when the death transition dropped shadows +
  // switched composer; the fix holds the full render path through the dead screen, so
  // the transition adds NO programs (a relink would bump this count).
  programs: window.__rh3.stage.renderer.info.programs?.length ?? -1,
}));

// Kill the player and poll tightly across the playing->dead flip (the death screen DOM
// marks it). `preFlip` = the program count on the last frame still in the death beat;
// `postFlip` = the count once the dead screen is up. The boss stops updating in "dead"
// and the dead reveal renders the SAME path as the last combat frame, so with the fix
// this flip adds no programs. (A whole-window count is useless here — the live boss
// keeps casting first-use attack VFX through the 1.7s beat, which would pollute it.)
await page.evaluate(() => window.__dpStart());
await page.evaluate(() => window.__rh3.combat.damagePlayer(999999, 0, 0));
let preFlip = pre.programs, postFlip = pre.programs, sawDeath = false;
for (let i = 0; i < 70; i++) {
  const s = await page.evaluate(() => ({
    death: !!document.querySelector(".end-title--death"),
    programs: window.__rh3.stage.renderer.info.programs?.length ?? -1,
  }));
  if (s.death) { postFlip = s.programs; sawDeath = true; break; }
  preFlip = s.programs; // last sample still in the (boss-active) death beat
  await page.waitForTimeout(60);
}
await page.waitForTimeout(400); // settle a few dead-screen frames
await page.evaluate(() => window.__dpStop());
const stats = await page.evaluate(() => window.__dpStats());
const post = await page.evaluate(() => ({
  shadows: window.__rh3.stage.keyLight.castShadow,
  programs: window.__rh3.stage.renderer.info.programs?.length ?? -1,
}));
const flipDelta = post.programs - preFlip; // programs added across the dead-screen flip

let fail = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " - " + extra : ""}`); if (!ok) fail++; };

console.log(`  pre: ${JSON.stringify(pre)}`);
console.log(`  flip: preFlip=${preFlip} postFlip=${postFlip} post=${post.programs} shadows=${post.shadows} (flipDelta=${flipDelta})`);
console.log(`  death transition: max=${stats.max}ms longMax=${stats.longMax}ms frames=${stats.frames}`);
check("ran in high quality with shadows on", pre.quality === "high" && pre.shadows === true, JSON.stringify(pre));
check("a boss was present", pre.boss === true);
check("the dead screen was reached", sawDeath === true);
// The fix: while the dense boss scene is still on the field, the dead screen stays on
// the full render path (shadows ON, full composer) — no shadow/composer flip, so no
// material relink. The cheap flip is deferred to toMenu()/retry once the scene clears.
check("death->dead keeps shadows on (no render-path flip while the boss scene is present)", post.shadows === true);
check("the playing->dead flip relinked NO lit materials (no whole-scene recompile)", flipDelta <= 1,
  `program cache grew by ${flipDelta} across the dead-screen flip`);
check("death->dead transition stays under stall budget", stats.max < THRESHOLD && stats.longMax < THRESHOLD,
  `max=${stats.max} longMax=${stats.longMax} budget=${THRESHOLD}`);
check("no console errors", errors.length === 0, errors.slice(0, 5).join("\n"));

console.log(fail === 0 ? "DEATH-PERF: ALL PASS" : `DEATH-PERF: ${fail} FAILURES`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
