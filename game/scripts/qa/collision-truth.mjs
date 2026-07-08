// COLLISION-TRUTH ORACLE — the render scene and the collider set must AGREE
// about where solid matter is. Every other collision oracle (chaos NO-CLIP,
// PUSH-OUT) checks the resolver against its OWN collider list, so a visible
// prop with NO collider passes everything while the player walks through it.
// This audit closes both directions deterministically, no pixels:
//   UNCOVERED     a "solid" mesh footprint no collider circle covers → walk-through
//   PHANTOM       a collider circle with no solid mesh over it        → invisible wall
//   UNCLASSIFIED  an in-reach mesh nobody classified                  → fail-loud default
//
//   node scripts/qa/collision-truth.mjs                audit the configured scenes
//   node scripts/qa/collision-truth.mjs --selftest     fault-injection proof: seam-side
//                                                      faults (drop a collider / add a
//                                                      phantom circle / spawn an untagged
//                                                      prop) must each fire their class,
//                                                      and the clean scene must stay clean
//
// Everything game-specific comes from qa.config.mjs (`collision` section). The
// classification contract lives in the game: meshes carry userData.solidity
// ("solid"|"ground"|"nonsolid"|"mover"|"fx") on themselves or an ancestor, and
// __rh3debug.collisionAudit() walks the scene. Exit code = finding/failure count.
import { join } from "node:path";
import {
  launchBrowser, bootGame, enterRun, gotoScenario, sleep, writeJSON, ensureServer, guard, GAME_DIR,
} from "../loop/lib.mjs";
import cfg from "./qa.config.mjs";

guard({ name: "qa-collision-truth", maxMinutes: 8 });
const SELFTEST = process.argv.includes("--selftest");
const S = cfg.seam;
const CC = cfg.collision ?? { scenes: ["room:combat", "room:elite"], settleMs: 2500 };
const log = (...a) => console.log("[collision-truth]", ...a);

const server = await ensureServer({ log });
const { browser, page } = await launchBrowser();
await bootGame(page);
await enterRun(page);

const stage = async (scene) => {
  await gotoScenario(page, scene, { settle: CC.settleMs });
  // Step a few deterministic frames so staged content finishes materializing.
  await page.evaluate(`window.${S}debug.frames(30); 0`);
};

const audit = () => page.evaluate(`window.${S}debug.collisionAudit()`);
const world = () => page.evaluate(`window.${S}debug.world()`);

const results = [];
let failures = 0;
let obstaclesSeen = 0;

for (const scene of CC.scenes) {
  await stage(scene);
  const w = await world();
  obstaclesSeen += w.obstacles.length;
  const a = await audit();
  results.push({ scene, obstacles: w.obstacles.length, ...a });
  const n = a.unclassified.length + a.uncovered.length + a.phantom.length;
  log(`${scene}: obstacles=${w.obstacles.length} unclassified=${a.unclassified.length} uncovered=${a.uncovered.length} phantom=${a.phantom.length}`);
  for (const u of a.unclassified) log(`  UNCLASSIFIED "${u.name}" @ (${u.x}, ${u.z}) r=${u.r} — tag userData.solidity or give it a collider`);
  for (const u of a.uncovered) log(`  UNCOVERED "${u.name}" @ (${u.x}, ${u.z}) r=${u.r} overhang=${u.overhang} — the walk-through class`);
  for (const p of a.phantom) log(`  PHANTOM collider @ (${p.x}, ${p.z}) r=${p.r} — the invisible-wall class`);
  if (!SELFTEST) failures += n;
}

if (obstaclesSeen === 0) {
  // A run of rooms that never staged a collider audits nothing on the walk-through
  // side — say so loudly rather than reporting a hollow green.
  log("WARN: no scene staged any obstacle — the solid/phantom directions were not exercised");
}

if (SELFTEST) {
  // Fault-injection proof (GLIB-style): every class must FIRE on its fault and the
  // clean scene must stay clean. All faults are seam-side; the game ships none.
  // Find (or force) a scene with obstacles.
  let sceneWithObs = null;
  for (const r of results) if (r.obstacles > 0) { sceneWithObs = r.scene; break; }
  if (!sceneWithObs) {
    // Stage combat rooms until one rolls obstacles (the preset is seeded per node).
    for (let i = 0; i < 8 && !sceneWithObs; i++) {
      await stage("room:combat");
      if ((await world()).obstacles.length > 0) sceneWithObs = "room:combat";
    }
  }
  if (!sceneWithObs) {
    log("SELFTEST FAIL: could not stage a scene with obstacles");
    failures++;
  } else {
    await stage(sceneWithObs);
    const clean = await audit();
    const cleanOk = clean.ok;
    if (!cleanOk) { log("SELFTEST FAIL: baseline scene is not clean — fix real findings first"); failures++; }

    // 1) UNCOVERED: drop the last collider circle; its pillar meshes remain solid.
    const uncovered = await page.evaluate(`(()=>{
      const c = window.${S};
      const dropped = c.arena.obstacles.pop();
      const a = window.${S}debug.collisionAudit();
      c.arena.obstacles.push(dropped);
      return { fired: a.uncovered.length > 0, n: a.uncovered.length };
    })()`);
    log(`selftest UNCOVERED (collider removed): fired=${uncovered.fired} (${uncovered.n})`);
    if (!uncovered.fired) { log("SELFTEST FAIL: removing a collider did not fire UNCOVERED"); failures++; }

    // 2) PHANTOM: add a collider circle at a spot no solid mesh occupies.
    const phantom = await page.evaluate(`(()=>{
      const c = window.${S};
      const w = window.${S}debug.world();
      // scan for a clear reachable spot ≥ 2u from every obstacle, radius 11 ring
      let spot = null;
      for (let a = 0; a < 6.28 && !spot; a += 0.15) {
        const x = Math.cos(a) * 11, z = Math.sin(a) * 11;
        if (w.obstacles.every(o => Math.hypot(x - o.x, z - o.z) > o.r + 2.5)) spot = { x, z };
      }
      if (!spot) return { fired: false, n: -1 };
      c.arena.obstacles.push({ x: spot.x, z: spot.z, r: 1.1 });
      const a2 = window.${S}debug.collisionAudit();
      c.arena.obstacles.pop();
      return { fired: a2.phantom.length > 0, n: a2.phantom.length };
    })()`);
    log(`selftest PHANTOM (bodiless collider added): fired=${phantom.fired} (${phantom.n})`);
    if (!phantom.fired) { log("SELFTEST FAIL: a bodiless collider did not fire PHANTOM"); failures++; }

    // 3) UNCLASSIFIED: clone a solid mesh to a clear spot with its tag stripped —
    //    exactly what a new prop added without classification or collider looks like.
    const uncls = await page.evaluate(`(()=>{
      const c = window.${S};
      const scene = c.stage.scene;
      const tag = (o) => { for (let p = o; p; p = p.parent) { if (p.userData && p.userData.solidity) return p.userData.solidity; } return null; };
      let solid = null;
      scene.traverse((o) => { if (!solid && o.isMesh && tag(o) === "solid") solid = o; });
      if (!solid) return { fired: false, n: -1 };
      const w = window.${S}debug.world();
      let spot = null;
      for (let a = 0; a < 6.28 && !spot; a += 0.15) {
        const x = Math.cos(a) * 9, z = Math.sin(a) * 9;
        if (w.obstacles.every(o => Math.hypot(x - o.x, z - o.z) > o.r + 2.5)) spot = { x, z };
      }
      if (!spot) return { fired: false, n: -2 };
      const ghost = solid.clone();
      ghost.userData = {};
      ghost.position.set(spot.x, 1, spot.z);
      scene.add(ghost);
      const a3 = window.${S}debug.collisionAudit();
      scene.remove(ghost);
      return { fired: a3.unclassified.length > 0, n: a3.unclassified.length };
    })()`);
    log(`selftest UNCLASSIFIED (untagged prop spawned): fired=${uncls.fired} (${uncls.n})`);
    if (!uncls.fired) { log("SELFTEST FAIL: an untagged in-reach prop did not fire UNCLASSIFIED"); failures++; }

    // 4) The faults must not leak: re-audit must be clean again.
    const after = await audit();
    if (cleanOk && !after.ok) { log("SELFTEST FAIL: fault cleanup leaked findings into the clean scene"); failures++; }
  }
}

writeJSON(join(GAME_DIR, "artifacts", "qa", "collision-truth.json"), {
  at: new Date().toISOString(), selftest: SELFTEST, results, failures,
});

await browser.close();
server.stop();
if (failures) { log(`FAIL — ${failures} finding(s)`); process.exit(Math.min(failures, 99)); }
log("OK — render geometry and collider set agree in every audited scene");
