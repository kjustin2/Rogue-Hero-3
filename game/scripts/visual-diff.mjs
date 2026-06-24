// VISUAL REGRESSION DIFF — did a change alter the pixels it shouldn't have?
//
// Compares two PNGs (or two directories of matching PNGs) and reports, per image,
// the % of pixels that changed, the mean per-channel delta, and the max delta — and
// writes a red-on-dim heatmap PNG so you (or Claude) can SEE exactly what moved.
// Uses a headless-Chromium canvas to decode + diff, so it needs NO new dependency
// and no dev server.
//
//   node scripts/visual-diff.mjs before.png after.png
//   node scripts/visual-diff.mjs artifacts/perf/shots dir-before   # match by filename
//   node scripts/visual-diff.mjs A B --threshold 48 --fail 1.5     # gate >1.5% changed
//   node scripts/visual-diff.mjs A B --out artifacts/visual-diff
//
// Typical use: snapshot perf-bench/loop shots, make a change, re-capture, diff the
// two shot dirs. A scenario that "shouldn't" have changed but did = a visual
// regression; an intended change with a tiny diff elsewhere = an unintended ripple.

import { readFileSync, statSync, readdirSync, writeFileSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { launchBrowser, ensureDir, writeJSON, GAME_DIR } from "./loop/lib.mjs";

const ARGS = process.argv.slice(2);
const positional = ARGS.filter((a) => !a.startsWith("--"));
const val = (f, d) => (ARGS.includes(f) ? ARGS[ARGS.indexOf(f) + 1] : d);
const [A, B] = positional;
if (!A || !B) {
  console.error("usage: node scripts/visual-diff.mjs <A.png|dirA> <B.png|dirB> [--threshold 32] [--fail PCT] [--out dir]");
  process.exit(2);
}
const THRESH = Number(val("--threshold", 32)); // per-pixel channel-sum delta to count as "changed"
const FAIL_PCT = ARGS.includes("--fail") ? Number(val("--fail", 1)) : null;
const OUT = resolve(val("--out", join(GAME_DIR, "artifacts", "visual-diff")));
ensureDir(OUT);

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const dataUrl = (p) => `data:image/png;base64,${readFileSync(p).toString("base64")}`;

// Build the list of (name, pathA, pathB) pairs to compare.
let pairs;
if (isDir(A) && isDir(B)) {
  const pngs = (d) => new Set(readdirSync(d).filter((f) => f.toLowerCase().endsWith(".png")));
  const a = pngs(A), b = pngs(B);
  const common = [...a].filter((f) => b.has(f)).sort();
  const onlyA = [...a].filter((f) => !b.has(f));
  const onlyB = [...b].filter((f) => !a.has(f));
  if (onlyA.length) console.log(`[visual-diff] only in A: ${onlyA.join(", ")}`);
  if (onlyB.length) console.log(`[visual-diff] only in B: ${onlyB.join(", ")}`);
  pairs = common.map((f) => ({ name: f, a: join(A, f), b: join(B, f) }));
} else {
  pairs = [{ name: basename(B), a: A, b: B }];
}
if (!pairs.length) { console.error("[visual-diff] no matching PNGs to compare"); process.exit(2); }

const { browser, page } = await launchBrowser();

/** Decode both PNGs in-page, diff pixel-by-pixel, return stats + a heatmap data URL. */
async function diffPair(aUrl, bUrl) {
  return page.evaluate(async ({ a, b, thresh }) => {
    const load = (src) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("decode")); im.src = src; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const w = Math.max(ia.width, ib.width), h = Math.max(ia.height, ib.height);
    const mk = () => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
    const ca = mk(), cb = mk(), cd = mk();
    const ga = ca.getContext("2d"), gb = cb.getContext("2d"), gd = cd.getContext("2d");
    ga.drawImage(ia, 0, 0); gb.drawImage(ib, 0, 0);
    const da = ga.getImageData(0, 0, w, h).data;
    const db = gb.getImageData(0, 0, w, h).data;
    const out = gd.createImageData(w, h), od = out.data;
    let changed = 0, sum = 0, max = 0;
    for (let i = 0; i < da.length; i += 4) {
      const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
      sum += d; if (d > max) max = d;
      if (d > thresh) { od[i] = 255; od[i + 1] = 40; od[i + 2] = 40; od[i + 3] = 255; changed++; }
      else { const g = ((da[i] + da[i + 1] + da[i + 2]) / 3) * 0.32; od[i] = od[i + 1] = od[i + 2] = g; od[i + 3] = 255; }
    }
    gd.putImageData(out, 0, 0);
    const total = da.length / 4;
    return {
      w, h, total, changed,
      pctChanged: Math.round((10000 * changed) / total) / 100,
      meanDelta: Math.round((sum / total / 3) * 100) / 100,
      maxDelta: max,
      sizeMismatch: ia.width !== ib.width || ia.height !== ib.height,
      diff: cd.toDataURL("image/png"),
    };
  }, { a: aUrl, b: bUrl, thresh: THRESH });
}

const results = [];
let failures = 0;
try {
  for (const p of pairs) {
    let r;
    try { r = await diffPair(dataUrl(p.a), dataUrl(p.b)); }
    catch (e) { console.log(`FAIL ${p.name} — ${e.message}`); failures++; continue; }
    const heatPath = join(OUT, p.name.replace(/\.png$/i, "") + ".diff.png");
    writeFileSync(heatPath, Buffer.from(r.diff.split(",")[1], "base64"));
    const flag = FAIL_PCT != null && r.pctChanged > FAIL_PCT;
    if (flag) failures++;
    results.push({ name: p.name, pctChanged: r.pctChanged, meanDelta: r.meanDelta, maxDelta: r.maxDelta, sizeMismatch: r.sizeMismatch, heatmap: heatPath });
    const tag = r.sizeMismatch ? " SIZE-MISMATCH" : "";
    console.log(`${flag ? "FAIL" : "ok  "} ${p.name.padEnd(22)} ${String(r.pctChanged).padStart(7)}% changed  meanΔ ${String(r.meanDelta).padStart(6)}  maxΔ ${String(r.maxDelta).padStart(4)}${tag}`);
  }
} finally {
  await browser.close();
}

results.sort((a, b) => b.pctChanged - a.pctChanged);
writeJSON(join(OUT, "report.json"), { threshold: THRESH, failPct: FAIL_PCT, at: new Date().toISOString(), results });
console.log(`\n${results.length} compared — heatmaps + report.json → ${OUT}`);
if (results.length) console.log(`largest change: ${results[0].name} (${results[0].pctChanged}%)`);
if (FAIL_PCT != null) {
  console.log(failures ? `VISUAL-DIFF: ${failures} over ${FAIL_PCT}% threshold` : `VISUAL-DIFF: PASS (all ≤ ${FAIL_PCT}%)`);
  process.exit(failures ? 1 : 0);
}
process.exit(0);
