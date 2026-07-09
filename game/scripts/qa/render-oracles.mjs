// RENDER ORACLES — next-tier deterministic glitch detection that walks the LIVE
// scene graph + GL programs, catching the classes render-diag (subject-visible,
// z-fight) and temporal (shimmer, banding) can't see:
//
//   MATERIAL-NAN   a non-finite color / emissive / opacity / shader uniform — the
//                  source of a garbage or black material that still "renders".
//   DEGENERATE-GEO a NaN/Infinity vertex position or a non-finite / zero-radius
//                  bounding sphere — a mesh that explodes, vanishes, or flickers.
//   PROGRAM-LINK   a compiled WebGL program that failed LINK/VALIDATE on the real
//                  GPU (three.js swallows these unless debug.checkShaderErrors is
//                  on) — a whole draw pass silently missing.
//
// All three read the live scene after renderer.compile(scene, camera) — no pixels,
// no deps, fully deterministic. (Draw-call state-diff over builds via Spector.js is
// the remaining tier; deferred — it needs `npm i spectorjs` + a per-scene baseline.)
//
//   node scripts/qa/render-oracles.mjs             audit staged scenes
//   node scripts/qa/render-oracles.mjs --selftest  fault-proof: a NaN'd material
//                                                  opacity and a NaN'd vertex must
//                                                  each FIRE; a clean scene stays quiet
//
// Exit = finding count.
import { join } from "node:path";
import {
  launchBrowser, bootGame, enterRun, gotoScenario, writeJSON, ensureServer, guard, GAME_DIR,
} from "../loop/lib.mjs";
import cfg from "./qa.config.mjs";

guard({ name: "qa-render-oracles", maxMinutes: 10 });
const SELFTEST = process.argv.includes("--selftest");
const S = cfg.seam;
const RO = cfg.renderOracles ?? { scenes: ["room:combat", "boss:warden"] };
const log = (...a) => console.log("[render-oracles]", ...a);

// In-page scan of the live scene. Returns { materialNaN[], degenerate[], programBad[], counts }.
// vtxSample caps per-geometry vertex scanning so a huge mesh doesn't stall the walk.
const SCAN = `(() => {
  const c = window.${S};
  const stage = c.stage, scene = stage.scene, cam = stage.camera, renderer = stage.renderer;
  const gl = renderer.getContext();
  try { renderer.compile(scene, cam); } catch (e) {}
  const fin = (n) => typeof n === "number" && Number.isFinite(n);
  const out = { materialNaN: [], degenerate: [], programBad: [], meshes: 0, materials: 0 };
  const seenMat = new Set(), seenGeo = new Set();
  scene.traverse((o) => {
    if (!o.isMesh && !o.isPoints && !o.isLine) return;
    out.meshes++;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m || seenMat.has(m.uuid)) continue; seenMat.add(m.uuid); out.materials++;
      const label = (o.name || o.type) + "/" + (m.type || "mat");
      if (m.color && !(fin(m.color.r) && fin(m.color.g) && fin(m.color.b))) out.materialNaN.push(label + ".color");
      if (m.emissive && !(fin(m.emissive.r) && fin(m.emissive.g) && fin(m.emissive.b))) out.materialNaN.push(label + ".emissive");
      if (m.opacity !== undefined && !fin(m.opacity)) out.materialNaN.push(label + ".opacity");
      if (m.uniforms) for (const k in m.uniforms) { const v = m.uniforms[k] && m.uniforms[k].value;
        if (typeof v === "number" && !fin(v)) out.materialNaN.push(label + ".uniform:" + k);
        else if (v && v.isVector3 && !(fin(v.x) && fin(v.y) && fin(v.z))) out.materialNaN.push(label + ".uniform:" + k);
      }
    }
    const g = o.geometry;
    if (g && !seenGeo.has(g.uuid)) {
      seenGeo.add(g.uuid);
      const pos = g.attributes && g.attributes.position;
      if (pos) {
        const n = pos.count, step = Math.max(1, Math.floor(n / 2000));
        let bad = false;
        for (let i = 0; i < n && !bad; i += step) if (!(fin(pos.getX(i)) && fin(pos.getY(i)) && fin(pos.getZ(i)))) bad = true;
        if (bad) out.degenerate.push((o.name || o.type) + ":NaN-vertex");
        if (!g.boundingSphere) { try { g.computeBoundingSphere(); } catch (e) {} }
        const r = g.boundingSphere && g.boundingSphere.radius;
        if (g.boundingSphere && !fin(r)) out.degenerate.push((o.name || o.type) + ":NaN-bounds");
      }
    }
  });
  // PROGRAM-LINK: real-GPU link/validate on every compiled program.
  const progs = renderer.info.programs || [];
  for (const p of progs) {
    const raw = p.program;
    if (!raw) continue;
    if (!gl.getProgramParameter(raw, gl.LINK_STATUS)) out.programBad.push((p.name || "prog") + ":LINK");
    else { gl.validateProgram(raw); if (!gl.getProgramParameter(raw, gl.VALIDATE_STATUS)) out.programBad.push((p.name || "prog") + ":VALIDATE"); }
  }
  out.programCount = progs.length;
  return out;
})()`;

const server = await ensureServer({ log });
const { browser, page } = await launchBrowser();
await bootGame(page);
await enterRun(page);

let failures = 0;
const report = { scenes: [] };

const runScene = async (scene) => {
  await gotoScenario(page, scene, { settle: 1200 });
  const r = await page.evaluate(SCAN);
  const n = r.materialNaN.length + r.degenerate.length + r.programBad.length;
  report.scenes.push({ scene, ...r, findings: n });
  const detail = [
    r.materialNaN.length ? `NaN-mat: ${r.materialNaN.slice(0, 4).join(", ")}` : "",
    r.degenerate.length ? `degenerate: ${r.degenerate.slice(0, 4).join(", ")}` : "",
    r.programBad.length ? `bad-program: ${r.programBad.slice(0, 4).join(", ")}` : "",
  ].filter(Boolean).join(" | ");
  log(`${scene}: ${r.meshes} meshes, ${r.materials} mats, ${r.programCount} programs — ${n ? `${n} FINDING(S): ${detail}` : "clean"}`);
  return n;
};

if (!SELFTEST) {
  for (const scene of RO.scenes) failures += await runScene(scene);
} else {
  // Clean baseline, then inject a NaN material opacity + a NaN vertex and re-scan.
  await gotoScenario(page, "room:combat", { settle: 1200 });
  const clean = await page.evaluate(SCAN);
  const cleanN = clean.materialNaN.length + clean.degenerate.length + clean.programBad.length;
  log(`selftest baseline: ${cleanN} finding(s) (must be 0)`);
  const faulted = await page.evaluate(`(() => {
    const c = window.${S}; let mHit = false, gHit = false;
    c.stage.scene.traverse((o) => {
      if (!mHit && o.isMesh && o.material && !Array.isArray(o.material) && o.material.opacity !== undefined) { o.material.__savedOp = o.material.opacity; o.material.opacity = NaN; mHit = true; }
      if (!gHit && o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position && o.geometry.attributes.position.count > 0) { const p = o.geometry.attributes.position; o.__savedV = p.getX(0); p.setX(0, NaN); p.needsUpdate = true; gHit = true; }
    });
    return { mHit, gHit };
  })()`);
  const dirty = await page.evaluate(SCAN);
  const gotMat = dirty.materialNaN.length > 0;
  const gotGeo = dirty.degenerate.length > 0;
  log(`selftest: injected(mat=${faulted.mHit}, geo=${faulted.gHit}) → material-NaN caught=${gotMat}, degenerate caught=${gotGeo}`);
  report.scenes.push({ selftest: true, cleanFindings: cleanN, gotMat, gotGeo });
  failures = (cleanN === 0 && gotMat && gotGeo) ? 0 : 1;
}

writeJSON(join(GAME_DIR, "artifacts", "qa", "render-oracles.json"), {
  at: new Date().toISOString(), selftest: SELFTEST, report, failures,
});

await browser.close();
server.stop();
if (failures) { log(`FAIL — ${failures}`); process.exit(Math.min(failures, 99)); }
log(SELFTEST ? "OK — the material-NaN and degenerate-geometry oracles fire on injected faults" : "OK — no NaN materials, degenerate geometry, or failed shader programs in the staged scenes");
