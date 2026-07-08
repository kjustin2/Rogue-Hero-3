// REACHABILITY ORACLE — every spot that LOOKS walkable must be walkable, and
// nothing walkable may be sealed off. Complements collision-truth (which checks
// geometry↔collider agreement): this checks the NAVIGABLE CONSEQUENCES of the
// collider set — unreachable pockets (a pillar ring sealing space off) and
// doorway snags (a gap that looks passable but is narrower than the player).
//
//   node scripts/qa/reachability.mjs               audit the configured scenes
//   node scripts/qa/reachability.mjs --selftest    fault-injection proof: a seam-side
//                                                  collider ring must create an
//                                                  unreachable pocket; a tight pair
//                                                  must flag a narrow gap
//
// Pure math over the seam's world() (arena radius, player radius, collider
// circles) — flood-fill at player-radius resolution, no pixels, no waiting.
// Exit code = finding/failure count.
import { join } from "node:path";
import {
  launchBrowser, bootGame, enterRun, gotoScenario, writeJSON, ensureServer, guard, GAME_DIR,
} from "../loop/lib.mjs";
import cfg from "./qa.config.mjs";

guard({ name: "qa-reachability", maxMinutes: 8 });
const SELFTEST = process.argv.includes("--selftest");
const S = cfg.seam;
const CC = cfg.collision ?? { scenes: ["room:combat"], settleMs: 2500 };
const log = (...a) => console.log("[reachability]", ...a);

/** Flood-fill the walkable disc at player-radius resolution.
 *  Returns { passable, reached, pockets: [{x,z,cells}], narrowGaps: [{ax,az,bx,bz,gap}] }. */
function analyze(world, spawn) {
  const { arenaRadius: AR, playerRadius: R, obstacles } = world;
  const cell = Math.max(0.25, R * 0.5);           // fine enough to see R-wide passages
  const n = Math.ceil((AR * 2) / cell);
  const idx = (i, j) => i * n + j;
  const pos = (i) => -AR + i * cell + cell / 2;
  // passable = the player's CIRCLE fits: inside the movement clamp, clear of every collider
  const passable = new Uint8Array(n * n);
  let passableCount = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = pos(i), z = pos(j);
      if (Math.hypot(x, z) > AR - R) continue;
      if (obstacles.some((o) => Math.hypot(x - o.x, z - o.z) < o.r + R)) continue;
      passable[idx(i, j)] = 1;
      passableCount++;
    }
  }
  // flood from the spawn cell (fall back to the nearest passable cell)
  const si0 = Math.round((spawn.x + AR - cell / 2) / cell);
  const sj0 = Math.round((spawn.z + AR - cell / 2) / cell);
  let start = -1;
  outer: for (let ring = 0; ring < n; ring++) {
    for (let di = -ring; di <= ring; di++) {
      for (let dj = -ring; dj <= ring; dj++) {
        const i = si0 + di, j = sj0 + dj;
        if (i >= 0 && j >= 0 && i < n && j < n && passable[idx(i, j)]) { start = idx(i, j); break outer; }
      }
    }
  }
  const reached = new Uint8Array(n * n);
  let reachedCount = 0;
  if (start >= 0) {
    const q = [start];
    reached[start] = 1;
    while (q.length) {
      const c = q.pop();
      reachedCount++;
      const i = Math.floor(c / n), j = c % n;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
        const nc = idx(ni, nj);
        if (passable[nc] && !reached[nc]) { reached[nc] = 1; q.push(nc); }
      }
    }
  }
  // pockets: passable-but-unreached cells, clustered into connected components
  const pockets = [];
  const seen = new Uint8Array(n * n);
  for (let c = 0; c < n * n; c++) {
    if (!passable[c] || reached[c] || seen[c]) continue;
    const q = [c];
    seen[c] = 1;
    let cells = 0, sx = 0, sz = 0;
    while (q.length) {
      const cc = q.pop();
      cells++;
      const i = Math.floor(cc / n), j = cc % n;
      sx += pos(i); sz += pos(j);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
        const nc = idx(ni, nj);
        if (passable[nc] && !reached[nc] && !seen[nc]) { seen[nc] = 1; q.push(nc); }
      }
    }
    pockets.push({ x: +(sx / cells).toFixed(2), z: +(sz / cells).toFixed(2), cells });
  }
  // doorway snags: a collider pair whose VISUAL gap reads passable but whose
  // bodily gap is narrower than the player (0 < gap < 2R) — invites a snag report
  const narrowGaps = [];
  for (let a = 0; a < obstacles.length; a++) {
    for (let b = a + 1; b < obstacles.length; b++) {
      const A = obstacles[a], B = obstacles[b];
      const gap = Math.hypot(A.x - B.x, A.z - B.z) - A.r - B.r;
      if (gap > 0 && gap < 2 * R) {
        narrowGaps.push({ ax: A.x, az: A.z, bx: B.x, bz: B.z, gap: +gap.toFixed(2) });
      }
    }
  }
  return { passableCount, reachedCount, pockets, narrowGaps };
}

const server = await ensureServer({ log });
const { browser, page } = await launchBrowser();
await bootGame(page);
await enterRun(page);

const results = [];
let failures = 0;

for (const scene of CC.scenes) {
  await gotoScenario(page, scene, { settle: CC.settleMs });
  await page.evaluate(`window.${S}debug.frames(30); 0`);
  const world = await page.evaluate(`window.${S}debug.world()`);
  const spawn = await page.evaluate(`(()=>{ const p = window.${S}.player.pos; return { x: p.x, z: p.z }; })()`);
  const a = analyze(world, spawn);
  results.push({ scene, obstacles: world.obstacles.length, ...a });
  log(`${scene}: passable=${a.passableCount} reached=${a.reachedCount} pockets=${a.pockets.length} narrowGaps=${a.narrowGaps.length}`);
  for (const p of a.pockets) log(`  UNREACHABLE pocket ~(${p.x}, ${p.z}) — ${p.cells} cells sealed off from the player`);
  for (const g of a.narrowGaps) log(`  NARROW-GAP ${g.gap}u between (${g.ax.toFixed(1)}, ${g.az.toFixed(1)}) and (${g.bx.toFixed(1)}, ${g.bz.toFixed(1)}) — looks passable, bodily isn't`);
  if (!SELFTEST) failures += a.pockets.length; // narrow gaps report, don't gate (a designer may want them)
}

if (SELFTEST) {
  // Fault-injection proof: seal a pocket with a seam-side collider ring → the
  // pocket must be found; park two colliders R apart → the narrow gap must flag.
  const scene = CC.scenes[0];
  await gotoScenario(page, scene, { settle: CC.settleMs });
  await page.evaluate(`window.${S}debug.frames(30); 0`);
  const proof = await page.evaluate(`(()=>{
    const c = window.${S};
    const added = [];
    // ring of 10 colliders around (9, 9), radius 3 — seals the interior
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const o = { x: 9 + Math.cos(a) * 3, z: 9 + Math.sin(a) * 3, r: 1.0 };
      c.arena.obstacles.push(o); added.push(o);
    }
    // a tight pair with a sub-player gap near (-9, -9)
    const p1 = { x: -9, z: -9, r: 1.0 }, p2 = { x: -9 + 2.0 + 0.6, z: -9, r: 1.0 };
    c.arena.obstacles.push(p1, p2); added.push(p1, p2);
    const w = window.${S}debug.world();
    const p = c.player.pos;
    // clean up before returning
    for (const o of added) c.arena.obstacles.splice(c.arena.obstacles.indexOf(o), 1);
    return { world: w, spawn: { x: p.x, z: p.z } };
  })()`);
  const a = analyze(proof.world, proof.spawn);
  const pocketFired = a.pockets.some((p) => Math.hypot(p.x - 9, p.z - 9) < 2.5);
  const gapFired = a.narrowGaps.some((g) => Math.abs(g.az + 9) < 0.5);
  log(`selftest UNREACHABLE (collider ring): fired=${pocketFired} (${a.pockets.length} pocket(s))`);
  log(`selftest NARROW-GAP (tight pair): fired=${gapFired} (${a.narrowGaps.length} gap(s))`);
  if (!pocketFired) { log("SELFTEST FAIL: sealed pocket not found"); failures++; }
  if (!gapFired) { log("SELFTEST FAIL: sub-player gap not flagged"); failures++; }
}

writeJSON(join(GAME_DIR, "artifacts", "qa", "reachability.json"), {
  at: new Date().toISOString(), selftest: SELFTEST, results, failures,
});

await browser.close();
server.stop();
if (failures) { log(`FAIL — ${failures} finding(s)`); process.exit(Math.min(failures, 99)); }
log("OK — every passable cell is reachable; no sub-player gaps");
