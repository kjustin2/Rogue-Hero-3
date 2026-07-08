// CLIP LOOK-BIBLE DRIFT — the ONLY aesthetic scorer that survives stylized/PS1
// art, because it is REFERENCE-BASED: it measures distance from YOUR curated
// target frames, not a photo-quality prior (NIQE/BRISQUE/LAION-aesthetic all
// decorrelate or INVERT on low-poly renders — do not use them). Embed the look
// bible with CLIP (transformers.js/ONNX, JS-native, no Python), embed each
// candidate scenario frame, drift = 1 − max cosine to the bible. Trendable
// delta across builds; absolute value is meaningless (research: use deltas only).
//
//   node scripts/qa/style-drift.mjs --bake      (re)build the look bible from a
//                                               fresh contact sheet = the CURRENT
//                                               approved look
//   node scripts/qa/style-drift.mjs             drift each scenario vs the bible;
//                                               --baseline saves per-scene drift,
//                                               later runs WARN on drift increase
//   node scripts/qa/style-drift.mjs --selftest  proves the metric DISCRIMINATES:
//                                               a desaturated+darkened frame must
//                                               drift MORE than its clean original
//
// WARN-tier by design (a look change may be intentional). Exit = selftest failures.
import { mkdirSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  launchBrowser, bootGame, enterRun, gotoScenario, sleep, writeJSON, readJSON, ensureServer, guard, GAME_DIR,
} from "../loop/lib.mjs";
import cfg from "./qa.config.mjs";

guard({ name: "qa-style-drift", maxMinutes: 12 });
const ARGS = process.argv.slice(2);
const BAKE = ARGS.includes("--bake");
const SELFTEST = ARGS.includes("--selftest");
const SAVE_BASELINE = ARGS.includes("--baseline");
const S = cfg.seam;
const SD = cfg.styleDrift ?? {
  scenes: ["menu", "room:combat", "room:elite", "boss:warden", "boss:colossus", "victory"],
  deadband: 0.04, settleMs: 2000,
};
const log = (...a) => console.log("[style-drift]", ...a);

const ANCHORS = join(GAME_DIR, "shots", "anchors");
const CAND = join(GAME_DIR, "shots", "style-drift");
const BASELINE = join(GAME_DIR, "artifacts", "qa", "style-baseline.json");
mkdirSync(ANCHORS, { recursive: true });
mkdirSync(CAND, { recursive: true });

// ── CLIP embedder (lazy — only load the model when we actually embed) ────────
let extractor = null;
async function embed(pngPath) {
  if (!extractor) {
    const { pipeline, env } = await import("@xenova/transformers");
    env.allowLocalModels = true;
    log("loading CLIP (Xenova/clip-vit-base-patch32) …");
    extractor = await pipeline("image-feature-extraction", "Xenova/clip-vit-base-patch32");
  }
  const out = await extractor(pngPath, { pooling: "mean", normalize: true });
  // Normalize explicitly — the ONNX head's `normalize` flag doesn't reliably
  // yield a unit vector here (raw cosines came back in the hundreds), so pin it.
  const v = Array.from(out.data);
  let mag = 0; for (const x of v) mag += x * x;
  mag = Math.sqrt(mag) || 1;
  return v.map((x) => x / mag);
}
const cosine = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d += a[i] * b[i]; return d; };

const server = await ensureServer({ log });
const { browser, page } = await launchBrowser();
await bootGame(page);

const capture = async (scene, path) => {
  if (scene === "menu") await page.evaluate(`window.${S}debug.scenario("menu"); 0`);
  else if (scene === "victory") await page.evaluate(`window.${S}debug.scenario("victory"); 0`);
  else { await enterRun(page); await gotoScenario(page, scene, { settle: SD.settleMs }); }
  await sleep(600);
  await page.evaluate(`window.${S}debug.frames(20); 0`);
  await page.screenshot({ path });
};

const slug = (s) => s.replace(/[^a-z0-9]+/gi, "-");

if (BAKE) {
  for (const scene of SD.scenes) await capture(scene, join(ANCHORS, `${slug(scene)}.png`));
  log(`baked ${SD.scenes.length} anchor frames → shots/anchors/ (the current approved look)`);
  await browser.close(); server.stop();
  process.exit(0);
}

// Need a bible; bootstrap it on first run.
if (!readdirSync(ANCHORS).some((f) => f.endsWith(".png"))) {
  log("no look bible yet — baking one from the current build (treated as approved)");
  for (const scene of SD.scenes) await capture(scene, join(ANCHORS, `${slug(scene)}.png`));
}

// Embed the bible.
const anchorFiles = readdirSync(ANCHORS).filter((f) => f.endsWith(".png"));
const anchors = [];
for (const f of anchorFiles) anchors.push({ file: f, vec: await embed(join(ANCHORS, f)) });
log(`bible: ${anchors.length} anchor(s) embedded`);

const driftOf = (vec) => {
  let best = -1, who = "";
  for (const a of anchors) { const c = cosine(vec, a.vec); if (c > best) { best = c; who = a.file; } }
  return { drift: +(1 - best).toFixed(4), nearest: who };
};

let failures = 0;
const results = [];

if (SELFTEST) {
  // Discrimination proof: a desaturated + darkened copy of an anchor must drift
  // MORE than the anchor itself (which is ~0 vs the bible). Uses sharp.
  const sharp = (await import("sharp")).default;
  const anchor = join(ANCHORS, anchorFiles[0]);
  const clean = await embed(anchor);
  const cleanDrift = driftOf(clean).drift;
  const washedPath = join(CAND, "_selftest-washed.png");
  await sharp(anchor).modulate({ saturation: 0.2, brightness: 0.6 }).linear(0.7, 20).toFile(washedPath);
  const washed = await embed(washedPath);
  const washedDrift = driftOf(washed).drift;
  log(`selftest DISCRIMINATION: clean anchor drift=${cleanDrift}, washed(0.2 sat, 0.6 bright) drift=${washedDrift}`);
  if (!(washedDrift > cleanDrift + 0.02)) { log("SELFTEST FAIL: a washed frame did not drift measurably more than its clean original"); failures++; }
  results.push({ selftest: true, cleanDrift, washedDrift });
} else {
  const baseline = SAVE_BASELINE ? {} : readJSON(BASELINE, {});
  for (const scene of SD.scenes) {
    const path = join(CAND, `${slug(scene)}.png`);
    await capture(scene, path);
    const { drift, nearest } = driftOf(await embed(path));
    const base = baseline[scene];
    let status = "ok";
    if (SAVE_BASELINE) baseline[scene] = drift;
    else if (typeof base === "number" && drift > base + SD.deadband) status = "DRIFTED";
    results.push({ scene, drift, nearest, baseline: base ?? null, status });
    log(`${scene}: drift=${drift} (nearest ${nearest})${base != null ? ` vs baseline ${base}` : ""}${status === "DRIFTED" ? "  ← WARN: look drifted beyond dead-band" : ""}`);
  }
  if (SAVE_BASELINE) { writeJSON(BASELINE, baseline); log("saved per-scene drift baseline"); }
}

writeJSON(join(GAME_DIR, "artifacts", "qa", "style-drift.json"), {
  at: new Date().toISOString(), selftest: SELFTEST, baked: BAKE, results, failures,
});

await browser.close();
server.stop();
if (failures) { log(`FAIL — ${failures}`); process.exit(Math.min(failures, 99)); }
log(SELFTEST ? "OK — the drift metric discriminates on-style from off-style" : "OK — style-drift measured (WARN-only; deltas are the signal, not absolutes)");
