// Boss animation capture — screenshots every boss across its dramatic moments:
// entrance (early + reveal), each phase's fight pose, and each phase transition.
// Drives bosses via run.debugLoadBoss + forced phase thresholds. Output → --out.
//
//   node scripts/loop/boss-shots.mjs --out artifacts/loop/boss/before
import { join } from "node:path";
import { launchBrowser, bootGame, sleep, ensureDir, isServerUp, ARTIFACTS } from "./lib.mjs";

const argOut = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : null;
const OUT = argOut || join(ARTIFACTS, "boss", "manual");
const SHOTS = join(OUT, "shots");
ensureDir(SHOTS);
const log = (...a) => console.log("[boss-shots]", ...a);

if (!(await isServerUp())) { console.error("[boss-shots] dev server not on :5174"); process.exit(2); }

// kind, act, depth, phases (number of phase escalations to force)
const BOSSES = [
  { kind: "warden", act: 1, depth: 5, phases: [0.68, 0.32] },
  { kind: "spire", act: 2, depth: 5, phases: [0.68, 0.32] },
  { kind: "colossus", act: 3, depth: 5, phases: [0.68, 0.32] },
  { kind: "tyrant", act: 4, depth: 5, phases: [0.63, 0.30] },
  { kind: "unmaker", act: 5, depth: 5, phases: [0.63, 0.30] },
  { kind: "echo", act: 4, depth: 3, phases: [0.45] },
];

const { browser, page, errors } = await launchBrowser();
const shot = async (name) => { await page.screenshot({ path: join(SHOTS, name + ".png") }); log("▸ " + name); };
const godmode = () => page.evaluate(() => { const c = window.__rh3; if (c?.player) c.player.hp = c.player.maxHp; });
// The follow-camera frames the player; park the player beside the boss so the
// boss mesh (and its erupting/attack poses) is actually in shot.
const frameBoss = async () => {
  await page.evaluate(() => {
    const c = window.__rh3;
    const b = c.enemies.living().find((e) => e.kind === "boss");
    if (b) { c.player.pos.x = b.pos.x + 3.2; c.player.pos.z = b.pos.z + 4.2; c.player.hp = c.player.maxHp; }
  });
  await sleep(500); // let the follow camera settle
};
const ui = () => page.evaluate(() => (window.__rh3state ? window.__rh3state() : "?"));
const bossInfo = () => page.evaluate(() => {
  const b = window.__rh3.enemies.living().find((e) => e.kind === "boss");
  return b ? { hp: b.hp, maxHp: b.maxHp, phase: b.phase ?? 1, scaleY: +b.root.scale.y.toFixed(3) } : null;
});

async function waitPlaying(maxMs = 8000) {
  for (let i = 0; i < maxMs / 200; i++) { if ((await ui()) === "playing") return true; await sleep(200); }
  return false;
}

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
    await page.evaluate((x) => window.__rh3.run.debugLoadBoss(x.kind, x.act, 424242, x.depth), b);
    // entrance: early charge-up, then the name-drop impact (pillar+ring+flash land ~2.5s)
    await sleep(1700); await shot(`${b.kind}-1-intro`);
    await sleep(850); await shot(`${b.kind}-2-reveal`);
    // skip the rest of the entrance, get to the fight
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" })));
    await waitPlaying();
    await frameBoss();
    await shot(`${b.kind}-3-p1`);
    // let it commit an attack, grab the pose (re-frame in case it moved)
    await sleep(1300); await frameBoss(); await shot(`${b.kind}-4-p1-attack`);

    let pi = 2;
    for (const frac of b.phases) {
      await godmode();
      await page.evaluate((f) => {
        const bb = window.__rh3.enemies.living().find((e) => e.kind === "boss");
        if (bb) bb.takeDamage(Math.max(1, Math.round(bb.hp - bb.maxHp * f)));
      }, frac);
      await sleep(650); await shot(`${b.kind}-5-p${pi}-shift`);   // mid phase-cutscene (cinematic frames boss)
      await waitPlaying(9000);
      await frameBoss();
      await sleep(150); await shot(`${b.kind}-6-p${pi}-erupt`);   // eruption just after
      await sleep(1100); await frameBoss(); await shot(`${b.kind}-7-p${pi}`); // settled fight pose
      pi++;
    }
    const info = await bossInfo();
    log(`  final: ${JSON.stringify(info)}`);
  }
} catch (err) {
  errors.push(`THREW: ${err.message}`);
  log("ERROR:", err.message);
} finally {
  log(errors.length ? `CONSOLE ERRORS (${errors.length}): ${errors.slice(0, 6).join(" | ")}` : "NO CONSOLE ERRORS");
  await browser.close();
  process.exit(errors.length === 0 ? 0 : 1);
}
