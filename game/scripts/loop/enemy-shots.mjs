// Enemy appearance audit — spawns each enemy type framed and screenshots it
// (a clean idle pose; held still via spawn-grace so there's no freeze tint), so
// every enemy can be eyeballed for visual polish. Output → --out.
//
//   node scripts/loop/enemy-shots.mjs --out artifacts/loop/enemy/before
import { join } from "node:path";
import { launchBrowser, bootGame, sleep, ensureDir, isServerUp, ARTIFACTS } from "./lib.mjs";

const argOut = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : null;
const OUT = argOut || join(ARTIFACTS, "enemy", "manual");
const SHOTS = join(OUT, "shots");
ensureDir(SHOTS);
const log = (...a) => console.log("[enemy-shots]", ...a);

if (!(await isServerUp())) { console.error("[enemy-shots] dev server not on :5174"); process.exit(2); }

const KINDS = [
  "husk", "spitter", "swarmer", "bomber", "sentinel",   // Act I base
  "wisp", "leaper", "tether", "mirror", "caster", "shade", "bastion", // Act II/III
  "brute", "harrier", "splitter",                       // Act IV
  "voidling", "warper",                                 // Act V
];

const { browser, page, errors } = await launchBrowser();
const shot = async (name) => { await page.screenshot({ path: join(SHOTS, name + ".png") }); log("▸ " + name); };

try {
  await bootGame(page);
  await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
  await sleep(700);
  await page.locator(".hero-card").first().click();
  await sleep(800);
  if (await page.locator(".story-skip").count()) await page.locator(".story-skip").click();
  await sleep(1800);
  // A boss room only clears on BOSS_DEFEATED (never on wave depletion), so a
  // boss kept alive holds the room open for unlimited spawns. Hide + freeze +
  // banish it so it isn't in shot.
  await page.evaluate(() => window.__rh3.run.debugLoadBoss("warden", 1, 424242, 1));
  await sleep(1500);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }))); // skip intro
  for (let i = 0; i < 30; i++) { if ((await page.evaluate(() => (window.__rh3state ? window.__rh3state() : "?"))) === "playing") break; await sleep(200); }
  await page.evaluate(() => {
    const b = window.__rh3.enemies.living().find((e) => e.kind === "boss");
    if (b) { b.root.visible = false; b.setSpawnGrace(1e9); b.pos.x = 0; b.pos.z = -40; }
  });

  const clearNear = () => page.evaluate(() => {
    for (const e of window.__rh3.enemies.living()) {
      if (e.kind !== "boss" && Math.hypot(e.pos.x, e.pos.z) < 15) e.takeDamage(99999);
    }
  });
  for (const kind of KINDS) {
    // Park the player far away (and keep it topped up) so nothing kills it mid-audit.
    await page.evaluate(() => { const c = window.__rh3; c.player.pos.x = 26; c.player.pos.z = 26; c.player.hp = c.player.maxHp; });
    // Double-clear: the first kill can spawn split-adds (splitter), so sweep twice.
    await clearNear();
    await sleep(350);
    await clearNear();
    await sleep(300);
    await page.evaluate((k) => window.__rh3.enemies.spawn(k, 0, 0, 0), kind);
    await sleep(1300); // materialize + spawn grace
    // Freeze the brain (no freeze tint), pin to origin at a fixed 3/4 heading, keep
    // the player out of frame, and dolly a tight cinematic camera onto the enemy.
    await page.evaluate(() => {
      const c = window.__rh3;
      const e = c.enemies.living().find((x) => x.kind !== "boss" && Math.hypot(x.pos.x, x.pos.z) < 15);
      if (e) { e.setSpawnGrace(1e9); e.pos.x = 0; e.pos.z = 0; e.heading = Math.PI * 0.78; }
      const b = c.enemies.living().find((x) => x.kind === "boss");
      if (b) { b.root.visible = false; if (b.groundGlow) b.groundGlow.visible = false; b.pos.x = 0; b.pos.z = -60; }
      c.player.pos.x = 26; c.player.pos.z = 26; c.player.hp = c.player.maxHp;
      c.cam.cinematic(0, 0, 0.36);
    });
    await sleep(1300); // let the cinematic zoom damp in
    const info = await page.evaluate(() => {
      const e = window.__rh3.enemies.living().find((x) => x.kind !== "boss" && Math.hypot(x.pos.x, x.pos.z) < 15);
      return e ? { kind: e.kind, hp: e.maxHp, r: +e.radius.toFixed(2) } : null;
    });
    await shot(`enemy-${kind}`);
    log(`  ${JSON.stringify(info)}`);
  }
} catch (err) {
  errors.push(`THREW: ${err.message}`);
  log("ERROR:", err.message);
} finally {
  log(errors.length ? `CONSOLE ERRORS (${errors.length}): ${errors.slice(0, 6).join(" | ")}` : "NO CONSOLE ERRORS");
  await browser.close();
  process.exit(errors.length === 0 ? 0 : 1);
}
