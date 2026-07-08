// Clean contact-sheet capture for before/after visual audits (NO perf overlay).
// Boots the game, visits a fixed set of scenarios spanning menu / combat / atmosphere
// / bosses, and screenshots each into the target dir (arg 1, default shots/contact).
//   node scripts/shot-contact.mjs shots/baseline
// Reused by the graphics glow-up audit — same scenes each run so visual:diff lines up.
import { launchBrowser, bootGame, enterRun, gotoScenario, sleep } from "./loop/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = process.argv[2] || "shots/contact";
mkdirSync(OUT, { recursive: true });

const { browser, page, errors } = await launchBrowser();
const shot = (name) => page.screenshot({ path: join(OUT, `${name}.png`) });

await bootGame(page);
// Stamp which rasterizer produced this sheet — shot baselines partition by
// renderer; visual-diff refuses to compare across partitions.
const glr = await page.evaluate(() => {
  try {
    const gl = window.__rh3.stage.renderer.getContext();
    const e = gl.getExtension("WEBGL_debug_renderer_info");
    return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  } catch { return "?"; }
});
writeFileSync(join(OUT, "_renderer.json"), JSON.stringify({ glRenderer: glr }));
// Quarantine ledger (reasons REQUIRED — the gate is never loosened globally):
writeFileSync(join(OUT, "_quarantine.json"), JSON.stringify({
  "09-boss-unmaker.png":
    "Hollow Star core is white-hot BY DESIGN (finale boss identity) — trips the BLOWOUT gate in any honest framing. OPEN DESIGN QUESTION for the owner: should the fading phase dim/texture the core?",
}, null, 2));
// 1) Main menu (fresh, pre-run)
await sleep(800);
await shot("01-menu");

// 2) Live combat, act 1 (rift)
await enterRun(page);
await page.evaluate(() => window.__rh3debug?.godmode?.());
await sleep(600);
await shot("02-combat-act1");

// Transient overlays (act-title cards, story screens) upstage a staged beat —
// clear them and settle before shooting (the "wait out transient cards" rule).
const clearOverlays = async (settle = 700) => {
  await page.evaluate(() => {
    window.__rh3menus?.clear?.();
    document.querySelectorAll(".screen").forEach((s) => s.remove());
  });
  await sleep(settle);
};
// A staged beat must ASSERT its subject is on stage and FRAME it — the gameplay
// camera follows the hero, so a boss/enemy can sit entirely out of frame.
const frameSubject = async (name, pick, zoom) => {
  const framed = await page.evaluate(({ p, z }) => {
    const c = window.__rh3;
    const s = p === "boss"
      ? (window.__rh3debug?.boss0?.() ?? null)
      : (c?.enemies?.living?.().find((e) => e.kind !== "boss") ?? null);
    if (!s?.pos || !window.__rh3debug?.frame) return false;
    window.__rh3debug.frame(s.pos.x, s.pos.z, z);
    return true;
  }, { p: pick, z: zoom });
  if (!framed) console.log(`WARN ${name}: subject not on stage — shot will show the arena only`);
  await sleep(1700); // the cinematic dolly damps in over ~1.5s — never shoot mid-dolly
  return framed;
};

// 3) Atmosphere variety — a mid-act combat room per act family
const acts = [
  ["03-act2-spire", 2],
  ["04-act3-forge", 3],
  ["05-act4-abyss", 4],
];
for (const [name, act] of acts) {
  await gotoScenario(page, `room:combat`, { settle: 1200 });
  await page.evaluate((a) => window.__rh3debug?.room?.("combat", a), act);
  await page.evaluate(() => window.__rh3debug?.godmode?.());
  await sleep(1600);
  await clearOverlays(); // never shoot through the act-title dim
  await shot(name);
}

// 4) Enemy portraits (silhouette / material read) — framed on the enemy
for (const [name, kind] of [["06-enemy-brute", "brute"], ["07-enemy-caster", "caster"]]) {
  await gotoScenario(page, `enemy:${kind}`, { settle: 2200 });
  await clearOverlays(400);
  await frameSubject(name, "enemy", 0.6);
  await shot(name);
}

// The HUD phase banner (.banner) is a timed card with a generous dwell BY DESIGN
// (never shorten dwell) — the capture must WAIT it out, not remove it.
const waitBannerGone = async (ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const op = await page.evaluate(() => {
      const b = document.querySelector(".banner");
      return b ? Number(getComputedStyle(b).opacity) : 0;
    });
    if (op < 0.05) return true;
    await sleep(300);
  }
  console.log("WARN: phase banner never faded — shooting anyway");
  return false;
};

// 5) Bosses (scale, phase drama) — banner waited out, camera framed on the boss.
// zoom=number → cinematic dolly; zoom="snap" → snapTo the boss at the STANDARD
// gameplay offset (15.5 up / 9.6 back — guaranteed outside any mesh). The dolly
// blends to a FIXED near-eye offset (0,3.4,5.6) that is not zoom-scaled, so a
// dolly onto an arena-scale boss (Colossus) ends up INSIDE it — snap instead.
for (const [name, scen, zoom] of [["08-boss-colossus", "boss:colossus:p2", "snap"], ["09-boss-unmaker", "boss:unmaker", 0.75], ["10-boss-tyrant", "boss:tyrant", 0.7]]) {
  await gotoScenario(page, scen, { settle: 2600 });
  await clearOverlays(); // story/act screens; the HUD banner fades on its own clock
  if (zoom === "snap") {
    // Arena-scale boss: bring the PLAYER to it — the follow cam (which re-targets
    // the player every frame, so snapTo can't hold) then frames hero + towering
    // boss together at the standard gameplay offset. The honest composition.
    await page.evaluate(() => {
      const b = window.__rh3debug?.boss0?.();
      const p = window.__rh3?.player;
      if (b?.pos && p?.pos) p.pos.set(b.pos.x + 5, 0, b.pos.z + 7);
    });
    await sleep(1200); // follow cam damps onto the new position
  } else if (zoom != null) {
    await frameSubject(name, "boss", zoom);
  }
  await waitBannerGone();
  await shot(name);
}

console.log(`contact sheet → ${OUT}`);
console.log(errors.length ? `CONSOLE ERRORS (${errors.length}):\n${errors.slice(0, 6).join("\n")}` : "NO CONSOLE ERRORS");
await browser.close();
process.exit(0);
