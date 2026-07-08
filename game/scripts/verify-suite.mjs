// Comprehensive VERIFY suite — a wide contact sheet + per-theme fast-pan motion strips +
// the new card VFX, so the glitch fix (MSAA edge stability, no grain/flicker, soft shadows,
// no banding) can be judged at NATIVE zoom across every scenario. ~40+ shots → shots/verify/.
import { launchBrowser, bootGame, enterRun, sleep, guard } from "./loop/lib.mjs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

guard({ maxMinutes: 15 }); // ~40 shots + per-theme pans run past the lib default

const OUT = "shots/verify";
mkdirSync(OUT, { recursive: true });
const { browser, page, errors } = await launchBrowser();
const shot = (n) => page.screenshot({ path: join(OUT, `${n}.png`) });
const state = () => page.evaluate(() => (window.__rh3state ? window.__rh3state() : "?"));
const settlePlaying = async () => {
  for (let i = 0; i < 10; i++) {
    if ((await state()) === "playing") break;
    await page.evaluate(() => window.__rh3debug?.skipCutscene?.());
    try { await page.keyboard.press("Space"); } catch { /* ignore */ }
    await sleep(220);
  }
  await page.evaluate(() => window.__rh3debug?.godmode?.());
};
// Fast camera whip over a FROZEN scene — the edge-crawl (glitch) stress test.
const pan = async (tag, frames = 4) => {
  await page.evaluate(() => window.__rh3debug.freezeForTest(true));
  await sleep(120);
  for (let i = 0; i < frames; i++) {
    const t = i * 0.42;
    await page.evaluate((tx) => window.__rh3.cam.snapTo?.(tx - 1.5, tx * 0.35 - 1), t);
    await sleep(45);
    await shot(`${tag}-pan-${i}`);
  }
  await page.evaluate(() => window.__rh3debug.freezeForTest(false));
};

await bootGame(page);
await sleep(600);
await shot("01-menu");

// Hero-select with heroes + wins unlocked (shows the signature levels).
await page.evaluate(() => {
  const p = window.__rh3.profile;
  for (const h of ["blade", "bulwark", "sparkmage", "reaver", "tempest", "revenant"])
    if (!p.data.unlocks.includes(`hero:${h}`)) p.data.unlocks.push(`hero:${h}`);
  for (const c of ["tempo-surge", "hammer-drop", "arc-overload", "feral-leap", "gale-burst", "soul-drain"])
    if (!p.data.unlocks.includes(`card:${c}`)) p.data.unlocks.push(`card:${c}`);
  p.data.heroWins = { blade: 3, reaver: 1 };
  p.data.heroBestWinDepth = { blade: 6 };
  window.__rh3menus.warmHeroSelect();
  window.__rh3menus.showHeroSelect();
});
await sleep(700);
await shot("02-heroselect");
const row = await page.$(".hero-row");
if (row) await row.screenshot({ path: join(OUT, "02-heroselect-row.png") });

await enterRun(page);
await page.evaluate(() => window.__rh3.stage.applyQuality?.("high"));
await sleep(600);
await page.evaluate(() => window.__rh3debug?.godmode?.());

// Combat in every act (each a distinct theme/palette) — static shot; fast-pan on 1/3/4.
for (const act of [1, 2, 3, 4, 5]) {
  const ok = await page.evaluate((a) => window.__rh3debug.room("combat", a), act);
  if (!ok) { console.log(`skip combat act ${act}`); continue; }
  await settlePlaying();
  await sleep(1200);
  await shot(`10-combat-act${act}`);
  if (act === 1 || act === 3 || act === 4) await pan(`10-act${act}`, 4);
}

// Bosses.
for (const b of ["spire", "colossus", "tyrant"]) {
  const ok = await page.evaluate((n) => window.__rh3debug.scenario(`boss:${n}`), b);
  if (!ok) { console.log(`skip boss ${b}`); continue; }
  await settlePlaying();
  await sleep(1500);
  await shot(`20-boss-${b}`);
}

// Cutscene (boss entrance, captured DURING it) + act interlude.
await page.evaluate(() => window.__rh3debug.scenario("boss:colossus", { skipIntro: false }));
await sleep(1400); await shot("30-cutscene-a");
await sleep(1600); await shot("30-cutscene-b");
await page.evaluate(() => { window.__rh3menus?.clear?.(); window.__rh3debug?.interlude?.(3); });
await sleep(1100); await shot("31-interlude-a");
await sleep(1500); await shot("31-interlude-b");

// New card VFX — combat scene, cast each new hero card and catch its peak. Enemies made
// INVINCIBLE so casting never clears the room (which leaked a boss-death story card over
// the VFX), and the story/event DOM is cleared before shooting.
await page.evaluate(() => window.__rh3debug.room("combat", 1));
await settlePlaying();
await page.evaluate(() => window.__rh3menus?.clear?.());
await sleep(700);
for (const id of ["tempo-surge", "hammer-drop", "arc-overload", "feral-leap", "gale-burst", "soul-drain"]) {
  await page.evaluate(() => {
    const c = window.__rh3;
    if (c.enemies.living().length < 3) for (const r of [-3, 0, 3]) c.enemies.spawn?.("husk", r, 0, 3);
    for (const e of c.enemies.living()) { e.hp = 999999; e.maxHp = 999999; }
    c.player.pos.set(0, 0, 0); c.cam.snapTo?.(0, 0); c.fx.clear?.();
  });
  await sleep(200);
  await page.evaluate((cid) => {
    const def = window.__rh3cards.find((c) => c.id === cid);
    const caster = window.__rh3.caster || window.__rh3.deck;
    if (def && caster && typeof caster.cast === "function") caster.cast(def, false);
  }, id);
  await sleep(160);
  await shot(`40-card-${id}`);
  await sleep(500);
}

// Pause / death / victory. Each from a clean state (clear leaked overlays; godmode OFF for
// death so the lethal hit lands; resume the pause before forcing a terminal state).
await page.evaluate(() => window.__rh3debug.room("combat", 1));
await settlePlaying();
await sleep(700);
try { await page.keyboard.press("Escape"); } catch { /* ignore */ }
await sleep(500); await shot("50-pause");
try { await page.keyboard.press("Escape"); } catch { /* ignore */ } // resume out of pause
await sleep(300);
await page.evaluate(() => { window.__rh3debug?.godmode?.(false); window.__rh3menus?.clear?.(); window.__rh3debug.scenario("death"); });
await sleep(2000); await shot("51-death");
await page.evaluate(() => { window.__rh3menus?.clear?.(); window.__rh3debug.scenario("victory"); });
for (let i = 0; i < 12; i++) { // victory plays an ending storyIntro before showVictory
  if ((await state()) === "victory") break;
  await page.evaluate(() => window.__rh3debug?.skipCutscene?.());
  await sleep(300);
}
await sleep(1200); await shot("52-victory");

console.log(errors.length ? `ERRORS: ${errors.slice(0, 8).join("\n")}` : "NO CONSOLE ERRORS");
await browser.close();
process.exit(0);
