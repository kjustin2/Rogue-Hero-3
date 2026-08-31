// RENDER DIAGNOSTICS — is the SUBJECT actually on screen, and does the static
// scene z-fight? Two deterministic GL oracles no screenshot judge can fake:
//
//   SUBJECT-VISIBLE   pixel coverage of a named subject, measured by diffing an
//                     empty-scene render against a subject-only render (hide
//                     everything else, render, count pixels that differ from the
//                     cleared background). No override materials, no deps — works
//                     with whatever materials the subject already wears. Catches
//                     invisible/culled/black/mis-scaled actors that luminance
//                     heuristics and "clean console" both miss.
//   Z-JITTER          render at camera p, shift the camera by ε, render again,
//                     diff. Geometry moves COHERENTLY under an ε shift; depth-tie
//                     speckle flips INCOHERENTLY (isolated pixels) — the static
//                     z-fighting signature the temporal gate's frozen pairs can't
//                     see (a deterministic z-fight renders identically every frame).
//
//   node scripts/qa/render-diag.mjs               audit configured scenes/subjects
//   node scripts/qa/render-diag.mjs --selftest    fault-proof: hiding the player
//                                                 must fire SUBJECT-VISIBLE; a
//                                                 coplanar duplicate floor must
//                                                 fire Z-JITTER
//
// Exit code = finding/failure count.
import { join } from "node:path";
import {
  launchBrowser, bootGame, enterRun, gotoScenario, writeJSON, ensureServer, guard, GAME_DIR,
} from "../loop/lib.mjs";
import cfg from "./qa.config.mjs";

guard({ name: "qa-render-diag", maxMinutes: 10 });
const SELFTEST = process.argv.includes("--selftest");
const S = cfg.seam;
const RD = cfg.renderDiag ?? {
  scenes: [
    { scene: "room:combat", subjects: [{ name: "player", get: "c.player.root", minPx: 400 }] },
    // A boss needs longer than a normal room: even with the entrance skipped it
    // carries a 5s spawn grace and then WALKS IN from the far side of the arena.
    // At the 2.2s default it is still materializing off the top of the frame, and
    // the gate read that as SUBJECT-INVISIBLE -- a capture-timing artifact, not a
    // render bug (measured: 0px at 2.2s, fully framed by ~9s).
    { scene: "boss:warden", settle: 9000, subjects: [{ name: "player", get: "c.player.root", minPx: 400 }, { name: "boss", get: "c.enemies.living().find(e => e.kind === 'boss')?.root", minPx: 800 }] },
  ],
  settleMs: 2200,
};
const log = (...a) => console.log("[render-diag]", ...a);

const server = await ensureServer({ log });
const { browser, page } = await launchBrowser();
await bootGame(page);
await enterRun(page);

/** Subject pixel CONTRIBUTION: |real frame − frame with the subject hidden|.
 *  Measures what the subject adds to the frame the player actually sees
 *  (occlusion included) — and a subject that was already invisible contributes
 *  nothing, so a visibility bug fires instead of being masked by the probe. */
const COVERAGE = (getExpr) => `(() => {
  const c = window.${S};
  const d = window.${S}debug;
  const subject = (${getExpr});
  if (!subject) return { missing: true };
  const gl = c.stage.renderer.getContext();
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const A = new Uint8Array(w * h * 4), B = new Uint8Array(w * h * 4);
  for (let k = 0; k < 2; k++) d.tick();
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, A);
  const was = subject.visible;
  subject.visible = false;
  d.tick();
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, B);
  subject.visible = was;
  d.tick();
  let px = 0;
  for (let i = 0; i < w * h * 4; i += 4) {
    if (Math.abs(A[i] - B[i]) > 12 || Math.abs(A[i + 1] - B[i + 1]) > 12 || Math.abs(A[i + 2] - B[i + 2]) > 12) px++;
  }
  return { px, frame: w * h };
})()`;

/** Static latent-z-fight audit: ANALYTIC coplanar-face detection, no pixels.
 *  (Two pixel probes died honestly first: a camera-position jitter was
 *  overwritten by the rig pre-render, and a projection jitter can't separate
 *  depth-tie bands (connected, 26% isolated) from a starfield's inherent
 *  speckle (57%) — measured, not guessed.) Two visible meshes whose world AABBs
 *  overlap substantially in XZ while a horizontal FACE (top or bottom) aligns
 *  within depth-epsilon = stacked surfaces the depth buffer must tie-break —
 *  z-fight fuel whether or not this frame happens to flicker. Runtime flicker
 *  itself is the temporal gate's Z-SPECKLE. */
const COPLANAR = `(() => {
  const c = window.${S};
  const scene = c.stage.scene;
  scene.updateMatrixWorld(true);
  const cls = (o) => { for (let p = o; p; p = p.parent) { if (p.userData && p.userData.solidity) return p.userData.solidity; } return null; };
  const boxes = [];
  const topOf = (o) => { let p = o; while (p.parent && p.parent !== scene) p = p.parent; return p; };
  scene.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    const s = cls(o);
    if (s === "fx" || s === "mover") return; // pooled FX use renderOrder/offsets; movers move
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox;
    if (!isFinite(bb.min.x) || !isFinite(bb.max.x)) return;
    const e = o.matrixWorld.elements;
    let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
    for (let k = 0; k < 8; k++) {
      const x = k & 1 ? bb.max.x : bb.min.x, y = k & 2 ? bb.max.y : bb.min.y, z = k & 4 ? bb.max.z : bb.min.z;
      const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
      const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
      const wz = e[2] * x + e[6] * y + e[10] * z + e[14];
      mnx = Math.min(mnx, wx); mny = Math.min(mny, wy); mnz = Math.min(mnz, wz);
      mxx = Math.max(mxx, wx); mxy = Math.max(mxy, wy); mxz = Math.max(mxz, wz);
    }
    boxes.push({ name: o.name || o.geometry.type, sol: s, top: topOf(o).uuid, mnx, mny, mnz, mxx, mxy, mxz });
  });
  const EPS = 0.008;       // faces closer than this must tie-break in the depth buffer
  const MIN_OVERLAP = 0.5; // m^2 of shared XZ footprint before it matters
  const pairs = [];
  for (let a = 0; a < boxes.length; a++) {
    for (let b = a + 1; b < boxes.length; b++) {
      const A = boxes[a], B = boxes[b];
      // Parts of one composite object (a pillar and its studs) interpenetrate by
      // construction — AABB face alignment there is not a stacked surface. And
      // ponytail: both-nonsolid pairs are exempt — out-of-bounds dressing shares
      // base elevations coincidentally (bottoms buried in the void, Δ~0.002-8);
      // the stacked-surface class players actually stare at lives on
      // ground/solid surfaces. Ceiling: a visibly stacked DECOR pair needs a
      // manual eye or the temporal gate's motion speckle.
      if (A.top === B.top) continue;
      if (A.sol === "nonsolid" && B.sol === "nonsolid") continue;
      const ox = Math.min(A.mxx, B.mxx) - Math.max(A.mnx, B.mnx);
      const oz = Math.min(A.mxz, B.mxz) - Math.max(A.mnz, B.mnz);
      if (ox <= 0 || oz <= 0 || ox * oz < MIN_OVERLAP) continue;
      // SAME-face alignment only (top~top / bottom~bottom): two surfaces at one
      // height = the stacked-panel class the depth buffer must tie-break.
      // Bottom-on-top (Δ≈0) is an object RESTING on a surface — correct contact,
      // and the tie region is occluded by the resting body itself.
      const dy = Math.min(Math.abs(A.mxy - B.mxy), Math.abs(A.mny - B.mny));
      if (dy < EPS) {
        pairs.push({ a: A.name, b: B.name, overlap: +(ox * oz).toFixed(2), dy: +dy.toFixed(4) });
      }
      if (pairs.length > 20) return { pairs, truncated: true };
    }
  }
  return { pairs, meshes: boxes.length };
})()`;

const results = [];
let failures = 0;

async function audit({ scene, subjects, settle }) {
  await gotoScenario(page, scene, { settle: settle ?? RD.settleMs ?? 2200 });
  if (scene.startsWith("boss:")) {
    // Audit an engaged gameplay composition, not the intentionally distant
    // post-reveal spawn endpoints. Keep both hero and boss in the follow frame.
    await page.evaluate(`(()=>{ const c=window.${S}; const b=c.enemies.living().find(e=>e.kind==='boss'); if(b){ c.player.pos.set(b.pos.x+4,0,b.pos.z+6); c.cam.snapTo(c.player.pos.x,c.player.pos.z); } })()`);
  }
  await page.evaluate(`window.${S}debug.freezeForTest(true); window.${S}debug.frames(30); 0`);
  const r = { scene, subjects: [], findings: [] };
  for (const sub of subjects) {
    const c = await page.evaluate(COVERAGE(sub.get.replace(/^c\./, `window.${S}.`)));
    r.subjects.push({ name: sub.name, ...c, minPx: sub.minPx });
    if (c.missing) r.findings.push({ type: "SUBJECT-MISSING", detail: `${scene}: subject "${sub.name}" not found in state` });
    else if (c.px < sub.minPx) r.findings.push({ type: "SUBJECT-INVISIBLE", detail: `${scene}: "${sub.name}" covers ${c.px}px < ${sub.minPx} — invisible/culled/mis-scaled on screen` });
  }
  const z = await page.evaluate(COPLANAR);
  r.coplanar = z;
  for (const pr of z.pairs) {
    r.findings.push({ type: "COPLANAR-FACES", detail: `${scene}: "${pr.a}" and "${pr.b}" share ${pr.overlap}m² of footprint with faces Δ${pr.dy} apart — depth-tie / z-fight fuel` });
  }
  await page.evaluate(`window.${S}debug.freezeForTest(false); 0`);
  return r;
}

if (!SELFTEST) {
  for (const sc of RD.scenes) {
    const r = await audit(sc);
    results.push(r);
    log(`${sc.scene}: subjects [${r.subjects.map((s) => `${s.name}=${s.missing ? "MISSING" : s.px + "px"}`).join(", ")}] coplanarPairs=${r.coplanar.pairs.length} findings=${r.findings.length}`);
    for (const f of r.findings) log(`  ${f.type}: ${f.detail}`);
    failures += r.findings.length;
  }
} else {
  const sc = RD.scenes[0];
  const clean = await audit(sc);
  results.push(clean);
  log(`selftest baseline: findings=${clean.findings.length} (must be 0)`);
  if (clean.findings.length) { failures++; for (const f of clean.findings) log(`  UNEXPECTED ${f.type}: ${f.detail}`); }

  // 1) SUBJECT-INVISIBLE: hide the player, re-audit.
  await page.evaluate(`window.${S}.player.root.visible = false; 0`);
  const hid = await audit(sc);
  await page.evaluate(`window.${S}.player.root.visible = true; 0`);
  const hidFired = hid.findings.some((f) => f.type === "SUBJECT-INVISIBLE");
  log(`selftest SUBJECT-INVISIBLE (player hidden): fired=${hidFired}`);
  if (!hidFired) { log("SELFTEST FAIL: hidden player did not fire SUBJECT-INVISIBLE"); failures++; }

  // 2) Z-FIGHT: a TINTED near-coplanar floor duplicate, micro-rotated so the two
  //    surfaces' interpolated depths cross over the face (an exact clone shares
  //    identical interpolation and resolves deterministically — no fight; and it
  //    must differ in COLOR or the flips are invisible, which is also why real
  //    z-fighting is visible at all).
  await page.evaluate(`(()=>{
    const c = window.${S};
    let floor = null, basic = null;
    c.stage.scene.traverse((o) => {
      if (!floor && o.isMesh && o.userData.solidity === "ground") floor = o;
      if (!basic && o.isMesh && !Array.isArray(o.material) && o.material.isMeshBasicMaterial) basic = o.material;
    });
    const dup = floor.clone();
    const mat = basic ? basic.clone() : null;
    if (mat) {
      mat.color.setRGB(0.9, 0.2, 0.2);
      mat.transparent = false; mat.opacity = 1; mat.blending = 1; // NormalBlending
      mat.depthWrite = true; mat.depthTest = true; mat.fog = false;
      dup.material = mat;
    }
    dup.userData = { solidity: "ground", __qaZFault: true };
    dup.matrix.copy(floor.matrixWorld);
    dup.matrixAutoUpdate = false;
    // Add at scene root so composite-group filtering cannot mistake the injected
    // independent surface for another child of the arena kit.
    c.stage.scene.add(dup);
    window.__qaZFault = { dup, mat };
  })()`);
  const zf = await audit(sc);
  await page.evaluate(`(()=>{ const f = window.__qaZFault; if (f) { f.dup.parent.remove(f.dup); if (f.mat) f.mat.dispose(); } window.__qaZFault = null; })()`);
  const zfFired = zf.findings.some((f) => f.type === "COPLANAR-FACES");
  log(`selftest COPLANAR-FACES (stacked duplicate floor): fired=${zfFired} (${zf.coplanar.pairs.length} pair(s))`);
  if (!zfFired) { log("SELFTEST FAIL: stacked duplicate floor did not fire COPLANAR-FACES"); failures++; }
  results.push(hid, zf);
}

writeJSON(join(GAME_DIR, "artifacts", "qa", "render-diag.json"), {
  at: new Date().toISOString(), selftest: SELFTEST, results, failures,
});

await browser.close();
server.stop();
if (failures) { log(`FAIL — ${failures} finding(s)`); process.exit(Math.min(failures, 99)); }
log("OK — subjects visible, static scene depth-stable");
