// CAPTURE stage — drive a scripted play-through, screenshot every meaningful
// step, and record a rich state trace (incl. deterministic logic probes).
//
// Outputs into the cycle dir (--out <dir>, or $LOOP_CYCLE_DIR, or a manual dir):
//   shots/<key>.png   one PNG per meaningful step
//   manifest.json     [{ key, file, caption }]  — what each shot shows
//   trace.json        { steps:[{key,state,...}], probes:{…}, consoleErrors, meta }
//
// Needs the dev server on :5174 (the orchestrator guarantees this; for a
// standalone run start `npm run dev` first).
import { join } from "node:path";
import {
  launchBrowser, bootGame, snapState, clickIf, sleep, ensureDir,
  writeJSON, isServerUp, ARTIFACTS,
} from "./lib.mjs";

const argOut = process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1] : null;
const OUT = argOut || process.env.LOOP_CYCLE_DIR || join(ARTIFACTS, "cycles", "manual");
const SHOTS = join(OUT, "shots");
ensureDir(SHOTS);

const log = (...a) => console.log("[capture]", ...a);

if (!(await isServerUp())) {
  console.error("[capture] dev server not on :5174 — start `npm run dev` first");
  process.exit(2);
}

const { browser, page, errors } = await launchBrowser();
const steps = [];
const manifest = [];
const probes = {};

/** Screenshot + state snapshot for one meaningful step. `extra` merges into the
 *  recorded state (e.g. heroCardCount, bossPresent) so logic guards can read it. */
async function recordStep(key, caption, extra = {}) {
  const file = `shots/${key}.png`;
  await page.screenshot({ path: join(OUT, file) });
  const state = { ...(await snapState(page)), ...extra };
  steps.push({ key, caption, state });
  manifest.push({ key, file, caption });
  log(`▸ ${key} — ui=${state.ui} enemies=${state.enemyCount ?? "?"}`);
}

const godmode = () => page.evaluate(() => {
  const c = window.__rh3;
  if (c?.player) c.player.hp = c.player.maxHp;
});

try {
  // ── 1. menu ────────────────────────────────────────────────────────────
  await bootGame(page);
  await recordStep("main-menu", "Main menu / title screen");

  // ── 2. hero select ───────────────────────────────────────────────────────
  await clickIf(page, page.locator("button", { hasText: /Begin Run|New Run/ }), 700);
  const heroCardCount = await page.locator(".hero-card").count();
  await recordStep("hero-select", "Hero select roster", { heroCardCount });

  // ── 3. enter the first real combat room ─────────────────────────────────
  await clickIf(page, page.locator(".hero-card").first(), 800);
  await clickIf(page, page.locator(".story-skip"), 600);      // intro cutscene
  await sleep(3200);                                           // act card + spawn-in
  await godmode();
  await recordStep("combat", "Active combat — hero vs a pack");

  // ── PROBE: player damage reduces enemy HP (real Combat.dealDamage path) ──
  // Run BEFORE we attack/cast — a card nova can wipe a small pack and leave no
  // enemy to probe (that flakiness once tripped a spurious "fix" cycle).
  probes.damage = await page.evaluate(() => {
    const c = window.__rh3;
    const pool = c.enemies.living().filter((x) => x.kind !== "boss");
    const e = pool.sort((a, b) => b.hp - a.hp)[0];   // highest-HP non-boss enemy
    if (!e) return { ok: false, reason: "no enemy present" };
    const before = e.hp;
    c.combat.dealDamage(e, Math.max(5, Math.floor(before / 3)), { countCombo: false });
    const after = e.hp;
    return { ok: after < before, before, after, dealt: before - after };
  });
  log("probe damage:", JSON.stringify(probes.damage));

  // ── PROBE: a kill increments stats.kills (kill ONE, leave the pack for FX) ─
  probes.kills = await page.evaluate(() => {
    const c = window.__rh3;
    const before = c.stats.kills;
    const e = c.enemies.living().find((x) => x.kind !== "boss");
    if (!e) return { before, killed: 0, ok: false, reason: "no enemy present" };
    e.takeDamage(99999);
    return { before, killed: 1 };
  });
  await sleep(600);
  if (probes.kills.killed) {
    probes.kills.after = await page.evaluate(() => window.__rh3.stats.kills);
    probes.kills.ok = probes.kills.after >= probes.kills.before + 1;
  }
  log("probe kills:", JSON.stringify(probes.kills));

  // a little action so the slash arc / particles are on-screen
  await page.mouse.move(900, 320);
  await page.keyboard.down("w"); await sleep(500); await page.keyboard.up("w");
  await page.mouse.down(); await sleep(150); await page.mouse.up();
  await page.keyboard.press("Digit1");                        // cast a card
  await sleep(450);
  await godmode();
  await recordStep("combat-action", "Mid-attack — slash + card FX");

  // ── PROBE: tempo value/zone stay consistent across the whole meter ──────
  probes.tempo = await page.evaluate(() => {
    const c = window.__rh3;
    const read = () => ({ value: Math.round(c.tempo.value), zone: c.tempo.zone.zone });
    const samples = [];
    c.tempo.drain(100); samples.push(read());          // → cold
    c.tempo.gain(45);   samples.push(read());          // → flowing
    c.tempo.gain(30);   samples.push(read());          // → hot
    c.tempo.gain(25);   samples.push(read());          // → critical
    return { samples };
  });
  log("probe tempo:", JSON.stringify(probes.tempo.samples));
  await godmode();
  await recordStep("tempo-critical", "HUD at Critical tempo");

  // bonus context shot: the post-room draft, if it came up
  if (await page.locator(".card, .draft-skip").count()) {
    await recordStep("draft", "Card draft after a cleared room");
  }

  // ── 4. boss presence (jump in, skip the cinematic, show the real fight) ──
  await page.evaluate(() => window.__rh3.run.debugLoadNode("boss", 3));
  await sleep(1500);
  // skip the entrance cutscene so the boss health bar is on-screen, not the cinematic
  for (let i = 0; i < 14; i++) {
    const ui = await page.evaluate(() => (window.__rh3state ? window.__rh3state() : "?"));
    if (ui === "playing") break;
    if (!(await clickIf(page, page.locator(".story-skip"), 300))) {
      await page.keyboard.press("Space"); await page.mouse.click(800, 450);
    }
    await sleep(500);
  }
  await sleep(900);
  await godmode();
  const bossPresent = await page.evaluate(() =>
    window.__rh3.enemies.living().some((e) => e.kind === "boss"));
  await recordStep("boss", "Boss encounter (health bar visible)", { bossPresent });

  // ── 5. victory (final boss → kill → skip ending → end screen) ───────────
  await page.evaluate(() => window.__rh3.run.debugLoadNode("boss", 5));
  await sleep(3600);
  let victoryReached = false;
  for (let i = 0; i < 18 && !victoryReached; i++) {
    await godmode();
    await page.evaluate(() => {
      const b = window.__rh3.enemies.living().find((e) => e.kind === "boss");
      if (b) b.takeDamage(99999);
    });
    await sleep(700);
    if (await page.locator(".story-skip").count()) await clickIf(page, page.locator(".story-skip"), 400);
    victoryReached = await page.evaluate(() => window.__rh3.run.state === "victory")
      || (await page.locator(".end-title--victory").count()) > 0;
  }
  // skip any remaining ending cutscene to land on the end screen
  for (let i = 0; i < 30; i++) {
    if ((await page.locator(".end-title--victory").count()) > 0) break;
    await clickIf(page, page.locator(".story-skip"), 350);
    await sleep(350);
  }
  probes.victory = { reached: victoryReached };
  await recordStep("victory", "Victory end screen + run recap");
  log("probe victory:", JSON.stringify(probes.victory));

  // ── PROBE: lethal damage ends the run (fresh fight → kill the player) ────
  await page.evaluate(() => window.__rh3.run.debugLoadNode("combat", 1));
  await sleep(2600);
  const aliveBefore = await page.evaluate(() => window.__rh3.player.alive);
  await page.evaluate(() => window.__rh3.combat.damagePlayer(99999, 3, 3));
  await sleep(2600);
  const dead = await page.evaluate(() => ({
    alive: window.__rh3.player.alive,
    ui: window.__rh3state ? window.__rh3state() : "?",
    deathTitle: document.querySelectorAll(".end-title--death").length,
  }));
  probes.death = { aliveBefore, aliveAfter: dead.alive, uiAfter: dead.ui, deathTitle: dead.deathTitle };
  log("probe death:", JSON.stringify(probes.death));
} catch (err) {
  errors.push(`CAPTURE-THREW: ${err.message}`);
  log("ERROR:", err.message);
} finally {
  const trace = {
    meta: { capturedAt: new Date().toISOString?.() ?? null, out: OUT },
    steps, probes, consoleErrors: errors,
  };
  writeJSON(join(OUT, "trace.json"), trace);
  writeJSON(join(OUT, "manifest.json"), manifest);
  await browser.close();
  log(`done — ${steps.length} shots, ${errors.length} console error(s) → ${OUT}`);
  process.exit(errors.length === 0 ? 0 : 1);
}
