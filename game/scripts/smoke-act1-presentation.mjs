import { guard } from "./lib/guard.cjs";
guard();
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const EXE = join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1217/chrome-win64/chrome.exe");
mkdirSync("shots", { recursive: true });
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));
let fail = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? ` - ${extra}` : ""}`); if (!ok) fail++; };
const drawGate = async (name) => {
  const draws = await page.evaluate(() => window.__rh3.stage.renderer.info.render.calls);
  check(`${name} draw calls <= 450`, draws <= 450, `draws ${draws}`);
};

await page.goto("http://localhost:5174", { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.removeItem("rh3v2-runsave"));
await page.waitForFunction(() => window.__rh3boot?.ready === true, null, { timeout: 20000 });
await page.screenshot({ path: "shots/act1-menu.png" });
const menuLayers = await page.evaluate(() => window.__rh3debug.floorLayering());
check("menu gameplay rings clear all opaque floor relief", menuLayers.ok && (menuLayers.clearance ?? 1) >= 0.008, JSON.stringify(menuLayers));
await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
await page.locator(".hero-confirm").waitFor({ state: "visible", timeout: 12000 });
await page.screenshot({ path: "shots/act1-hero-select.png" });
await page.locator(".hero-confirm").click();
await page.locator(".story").waitFor({ state: "visible", timeout: 12000 });
await page.screenshot({ path: "shots/act1-story-rift.png" });
await page.locator(".story").click({ position: { x: 700, y: 650 } });
await page.waitForTimeout(500);
await page.screenshot({ path: "shots/act1-story-wardens.png" });
await page.locator(".story").click({ position: { x: 700, y: 650 } });
await page.waitForTimeout(500);
await page.screenshot({ path: "shots/act1-story-blade.png" });
await page.locator(".story-skip").click();
await page.waitForTimeout(1700);

const composition = async (kind, act = 1) => {
  await page.evaluate(() => window.__rh3debug.freezeForTest(false));
  await page.evaluate(({ kind, act }) => window.__rh3debug.scenario(`room:${kind}`, { act }), { kind, act });
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    // Isolate the environment plate from the separate title/combat captures.
    document.querySelector(".banner")?.classList.remove("banner--show");
    document.querySelectorAll(".actcard").forEach((el) => el.remove());
    // Settle the requested camera before freezing, then clear the last wave.
    // Clearing while the room kept ticking let its pending spawn queue paint
    // fresh white warning circles during the following wall-time wait.
    window.__rh3debug.frame(0, -7, 0.72);
    window.__rh3debug.frames(50);
    window.__rh3debug.freezeForTest(true);
    window.__rh3.run.state = "cleared";
    window.__rh3.enemies.clear();
    window.__rh3.features.clear();
    window.__rh3.projectiles.clear();
    window.__rh3.hostiles.clear();
    window.__rh3.caster.clear();
    window.__rh3.player.root.visible = false;
    const hud = document.getElementById("hud");
    if (hud) hud.style.display = "none";
    window.__rh3.decals.clear();
    window.__rh3.tele.clear();
    window.__rh3.fx.clear();
    window.__rh3.vfx.clear();
  });
  await page.waitForTimeout(700);
  return page.evaluate(() => {
    const basilica = window.__rh3.stage.scene.getObjectByName("Rift Basilica");
    return {
      visibility: Object.fromEntries(basilica.children.filter((c) => /Nave|Reliquary|Courtyard/.test(c.name)).map((c) => [c.name, c.visible])),
      transient: window.__rh3debug.transientFx(),
    };
  });
};
let comp = await composition("combat");
await page.screenshot({ path: "shots/act1-basilica-nave.png" });
check("combat uses nave", comp.visibility["Combat Nave"] === true, JSON.stringify(comp));
check("combat plate has no transient combat FX", comp.transient.particles.rings === 0 && comp.transient.particles.beams === 0 && comp.transient.telegraphs.visible === 0 && comp.transient.impacts.active === 0, JSON.stringify(comp.transient));
await drawGate("Act I combat nave");
comp = await composition("elite");
await page.screenshot({ path: "shots/act1-basilica-reliquary.png" });
check("elite uses reliquary", comp.visibility["Elite Reliquary"] === true, JSON.stringify(comp));
check("elite plate has no transient combat FX", comp.transient.particles.rings === 0 && comp.transient.particles.beams === 0 && comp.transient.telegraphs.visible === 0 && comp.transient.impacts.active === 0, JSON.stringify(comp.transient));
await drawGate("Act I elite reliquary");

await page.evaluate(() => window.__rh3menus.showMap(window.__rh3.run.forkOptions(), 1, 5, () => {}));
await page.waitForTimeout(300);
const mapRead = await page.evaluate(() => {
  const rects = [...document.querySelectorAll(".route-map .mapnode")].map((node) => node.getBoundingClientRect());
  const spread = (values) => values.length ? Math.max(...values) - Math.min(...values) : 999;
  return {
    nodes: rects.length,
    preview: !!document.querySelector(".route-preview"),
    focusable: [...document.querySelectorAll(".mapnode")].every((n) => n.tagName === "BUTTON"),
    topSpread: spread(rects.map((r) => r.top)),
    heightSpread: spread(rects.map((r) => r.height)),
    hudOpacity: Number(getComputedStyle(document.getElementById("hud")).opacity),
    backdrop: getComputedStyle(document.querySelector(".route-map"), "::before").backgroundImage,
  };
});
check("rift map has path hierarchy and preview", mapRead.nodes > 1 && mapRead.preview && mapRead.focusable, JSON.stringify(mapRead));
check("rift map choices share one level and height", mapRead.topSpread <= 1 && mapRead.heightSpread <= 1, JSON.stringify(mapRead));
check("rift map owns the frame without stale combat HUD", mapRead.hudOpacity === 0 && mapRead.backdrop !== "none", JSON.stringify(mapRead));
await page.screenshot({ path: "shots/act1-rift-map.png" });
await page.evaluate(() => window.__rh3menus.clear());

for (const kind of ["husk", "spitter", "sentinel"]) {
  await page.evaluate(() => window.__rh3debug.freezeForTest(false));
  await page.evaluate((k) => window.__rh3debug.scenario(`enemy:${k}`), kind);
  await page.waitForFunction((k) => window.__rh3debug.enemyVisuals().some((v) => v.actorKind === k), kind, { timeout: 12000 });
  await page.evaluate(() => {
    const e = window.__rh3.enemies.living().find((x) => x.kind !== "boss");
    if (e) { e.setSpawnGrace(1e9); e.pos.set(0, 0, 0); }
    window.__rh3.player.root.visible = false;
    window.__rh3debug.frameNow(0, 0, 0.56);
    window.__rh3debug.frames(2);
    if (e) { e.pos.set(0, 0, 0); e.root.position.set(0, 0, 0); }
    window.__rh3.fx.clear();
    window.__rh3debug.freezeForTest(true);
  });
  const visual = await page.evaluate((k) => window.__rh3debug.enemyVisuals().find((v) => v.actorKind === k), kind);
  check(`${kind} exposes actor identity`, visual?.actorKind === kind && visual?.actorId.startsWith("enemy:"), JSON.stringify(visual));
  await page.screenshot({ path: `shots/act1-enemy-${kind}.png` });
  const reaction = await page.evaluate(() => {
    const e = window.__rh3.enemies.living().find((x) => x.kind !== "boss");
    if (e) { e.pos.set(0, 0, 0); e.root.position.set(0, 0, 0); }
    e?.takeDamage(1, { kbX: 1, kbZ: 0, kb: 0 });
    // Sample the readable recoil after the tiny white contact core has receded;
    // peak-flash frames flatten Sentinel's shield/body into one bright cutout.
    e?.update(0.13);
    return window.__rh3debug.enemyVisuals().find((v) => v.actorKind === e?.kind);
  });
  check(`${kind} exposes directional recovery`, reaction?.reaction > 0 && reaction?.segment === "recovery", JSON.stringify(reaction));
  // Let the one-frame white contact core clear before recording the reaction pose;
  // the probe above already sampled the exact active recovery state.
  await page.screenshot({ path: `shots/act1-enemy-${kind}-hit.png` });
  const death = await page.evaluate(() => {
    const e = window.__rh3.enemies.living().find((x) => x.kind !== "boss");
    window.__rh3debug.freezeForTest(true);
    if (e) {
      e.pos.set(0, 0, 0);
      e.root.position.set(0, 0, 0);
    }
    e?.takeDamage(99999);
    e?.updateDeath(0.2);
    return window.__rh3debug.enemyVisuals().find((v) => v.actorKind === e?.kind);
  });
  check(`${kind} death remains authored and visible`, death?.action === "death" && death?.alive === false, JSON.stringify(death));
  await page.screenshot({ path: `shots/act1-enemy-${kind}-death.png` });
}

await page.evaluate(() => {
  window.__rh3.player.root.visible = true;
  const hud = document.getElementById("hud");
  if (hud) hud.style.removeProperty("display");
  window.__rh3debug.freezeForTest(false);
  window.__rh3debug.scenario("boss:warden", { skipIntro: false });
});
await page.waitForFunction(() => window.__rh3debug.presentation().cinematic.id === "boss-intro:warden", null, { timeout: 12000 });
await page.evaluate(() => {
  window.__rh3debug.freezeForTest(true);
  document.querySelector(".banner")?.classList.remove("banner--show");
  document.querySelectorAll(".actcard").forEach((el) => el.remove());
});
await page.evaluate(() => {
  window.__rh3debug.freezeForTest(false);
  window.__rh3debug.frames(145);
  window.__rh3debug.freezeForTest(true);
});
await page.screenshot({ path: "shots/act1-warden-land.png" });
const landing = await page.evaluate(() => window.__rh3debug.presentation().cinematic);
check("warden cinematic deterministic", landing.id === "boss-intro:warden" && landing.time > 1.8, JSON.stringify(landing));
await page.evaluate(() => window.__rh3debug.skipCutscene());
await page.evaluate(() => {
  window.__rh3debug.freezeForTest(false);
  window.__rh3debug.frames(6);
  window.__rh3debug.freezeForTest(true);
});
// CSS banner animation uses wall time even while the deterministic world is
// frozen; hold long enough to capture its fully readable identity beat.
await page.waitForTimeout(430);
await page.screenshot({ path: "shots/act1-warden-skip-reveal.png" });
const revealHeld = await page.evaluate(() => ({ cine: window.__rh3debug.presentation().cinematic, title: document.querySelector(".banner__title")?.textContent ?? "" }));
check("skip preserves Warden reveal", revealHeld.cine.active && /WARDEN/i.test(revealHeld.title), JSON.stringify(revealHeld));
await page.evaluate(() => {
  window.__rh3debug.freezeForTest(false);
  window.__rh3debug.frames(34);
});
const handed = await page.evaluate(() => ({ cine: window.__rh3debug.presentation().cinematic, input: window.__rh3.input.enabled, mode: window.__rh3.cam.mode }));
check("skip returns control after reveal", !handed.cine.active && handed.input && handed.mode === "follow", JSON.stringify(handed));

const checkBossFraming = async (label) => {
  const boss = await page.evaluate(() => window.__rh3debug.actorFraming().find((actor) => actor.id.includes(":boss")));
  check(`${label} keeps the complete boss framed`, !!boss?.inFrame, JSON.stringify(boss));
};

const prepareBossPlate = async (zoom) => page.evaluate((shotZoom) => {
  const c = window.__rh3, b = c.enemies.living().find((e) => e.kind === "boss");
  window.__rh3debug.freezeForTest(false);
  if (b) {
    b.setSpawnGrace(1e9);
    b.pos.set(0, 0, -4);
  }
  c.player.pos.set(0, 0, 3);
  // Remove carry-over adds, warnings and projectiles before the plate settles.
  c.enemies.clearNonBosses();
  c.projectiles.clear();
  c.hostiles.clear();
  c.caster.clear();
  c.tele.clear();
  window.__rh3debug.frame(0, -0.5, shotZoom);
  window.__rh3debug.frames(70);
  if (b) {
    b.pos.set(0, 0, -4);
    b.root.position.x = 0;
    b.root.position.z = -4;
  }
  c.player.pos.set(0, 0, 3);
  window.__rh3debug.freezeForTest(true);
}, zoom);

for (const move of ["guard", "dash"]) {
  await prepareBossPlate(1.02);
  const staged = await page.evaluate((name) => ({ ok: window.__rh3debug.setBossMove(name), move: window.__rh3debug.currentBossMove() }), move);
  check(`warden phase 1 ${move} staged`, staged.ok && staged.move.startsWith(`${move}:`), JSON.stringify(staged));
  await page.evaluate(() => window.__rh3debug.frames(6));
  await page.screenshot({ path: `shots/act1-warden-${move}.png` });
  await checkBossFraming(`warden ${move}`);
}

for (const [expected, frac, duration] of [[2, 0.66, 3.5], [3, 0.32, 3.5]]) {
  await page.waitForFunction(() => window.__rh3state() === "playing" && window.__rh3.enemies.living().some((e) => e.kind === "boss"), null, { timeout: 12000 });
  await page.evaluate((f) => {
    window.__rh3debug.freezeForTest(false);
    window.__rh3debug.setBossPhase(f);
  }, frac);
  await page.waitForFunction((p) => window.__rh3debug.presentation().cinematic.id === `boss-phase:warden:${p}` , expected, { timeout: 12000 });
  const cut = await page.evaluate(() => window.__rh3debug.presentation().cinematic);
  check(`warden phase ${expected} duration`, cut.duration === duration, JSON.stringify(cut));
  await page.waitForTimeout(expected === 2 ? 500 : 700);
  await page.screenshot({ path: `shots/act1-warden-phase-${expected}.png` });
  const phaseFrame = await page.evaluate(() => window.__rh3debug.actorFraming().find((actor) => actor.id.includes(":boss")));
  check(`warden phase ${expected} clears cinematic bars`, !!phaseFrame?.inFrame && phaseFrame.minY >= -0.76 && phaseFrame.maxY <= 0.76, JSON.stringify(phaseFrame));
  await page.evaluate(() => window.__rh3debug.skipCutscene());
  await page.evaluate(() => window.__rh3debug.frames(40));
  await page.waitForFunction(() => !window.__rh3debug.presentation().cinematic.active, null, { timeout: 12000 });
  if (expected === 2) {
    for (const move of ["leap", "fissure", "fan"]) {
      await prepareBossPlate(move === "fissure" ? 1.2 : 1.12);
      const staged = await page.evaluate((name) => ({ ok: window.__rh3debug.setBossMove(name), move: window.__rh3debug.currentBossMove() }), move);
      check(`warden phase 2 ${move} staged`, staged.ok && staged.move.startsWith(`${move}:`), JSON.stringify(staged));
      await page.evaluate(() => window.__rh3debug.frames(8));
      await page.screenshot({ path: `shots/act1-warden-${move}.png` });
      await checkBossFraming(`warden ${move}`);
    }
  }
}

await page.evaluate(() => {
  window.__rh3debug.godmode(true);
  window.__rh3debug.playerPose("victory", 0.5);
  window.__rh3debug.freezeForTest(true);
  window.__rh3menus.showVictory(window.__rh3.stats, [], false);
});
await page.waitForTimeout(180);
const victory = await page.evaluate(() => ({ pose: window.__rh3debug.actorVisual(), menu: !!document.querySelector(".end-title--victory") }));
check("victory pose authored", victory.pose.action === "victory" && victory.menu, JSON.stringify(victory));
await page.screenshot({ path: "shots/act1-victory.png" });
await page.evaluate(() => {
  window.__rh3debug.freezeForTest(false);
  window.__rh3debug.godmode(false);
  window.__rh3menus.clear();
  window.__rh3debug.playerPose("idle", 0);
});
await page.evaluate(() => window.__rh3debug.scenario("death"));
await page.waitForTimeout(1850);
await page.screenshot({ path: "shots/act1-failure.png" });
check("failure menu styled", await page.locator(".end-title--death").count() > 0);

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join("\n")}` : "NO CONSOLE ERRORS");
mkdirSync("artifacts/presentation", { recursive: true });
const manifest = await page.evaluate(() => window.__rh3debug.qaManifest());
writeFileSync("artifacts/presentation/act1-gallery.json", JSON.stringify({
  gallery: "act1-gold-slice",
  capturedAt: new Date().toISOString(),
  fresh: true,
  runtime: manifest,
  screenshots: [
    "act1-menu.png", "act1-hero-select.png", "act1-story-rift.png", "act1-story-wardens.png", "act1-story-blade.png",
    "act1-basilica-nave.png", "act1-basilica-reliquary.png", "act1-rift-map.png",
    "act1-enemy-husk.png", "act1-enemy-spitter.png", "act1-enemy-sentinel.png",
    "act1-warden-land.png", "act1-warden-skip-reveal.png", "act1-warden-phase-2.png", "act1-warden-phase-3.png",
    "act1-warden-dash.png", "act1-warden-guard.png", "act1-warden-leap.png", "act1-warden-fissure.png", "act1-warden-fan.png",
    "act1-victory.png", "act1-failure.png",
  ],
  processCleanup: "guarded runner owns and verifies its browser/server process trees",
}, null, 2));
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
