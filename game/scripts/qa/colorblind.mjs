// COLORBLIND / CVD GATE — RH3 encodes a load-bearing gameplay signal in COLOR:
// the four Tempo zones (cold/flowing/hot/critical) drive damage + speed and are
// read off a color ramp. Under color-vision deficiency two zones can collapse to
// the same apparent color, making the signature mechanic unreadable. This applies
// the Machado (2009) protan/deutan/tritan simulation matrices to the live zone
// palettes and asserts NO zone pair becomes indistinguishable — for BOTH the
// default ramp and the colorblind-safe ramp the game ships. Plus a static check
// that Reduce Motion is actually honored (shake→0 + the no-anim body class).
//
// Distinguishability = minimum pairwise "redmean" distance (a cheap perceptual
// RGB metric) among the simulated zone colors; below ~45 two colors read as one.
//
//   node scripts/qa/colorblind.mjs             audit tempo palettes under CVD
//   node scripts/qa/colorblind.mjs --selftest  fault-proof: a palette with two
//                                              near-identical zones must FIRE under
//                                              CVD; a separated palette stays quiet
//
// Exit = finding count.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  launchBrowser, bootGame, writeJSON, ensureServer, guard, GAME_DIR,
} from "../loop/lib.mjs";
import cfg from "./qa.config.mjs";

guard({ name: "qa-colorblind", maxMinutes: 5 });
const SELFTEST = process.argv.includes("--selftest");
const S = cfg.seam;
const CB = cfg.colorblind ?? { minDistinct: 45 };
const log = (...a) => console.log("[colorblind]", ...a);

// Machado 2009 severity-1.0 CVD simulation matrices (operate on LINEAR RGB).
const MAT = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
const s2l = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const l2s = (c) => { c = Math.max(0, Math.min(1, c)); return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055); };
const hex2rgb = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const sim = (rgb, m) => { const [r, g, b] = rgb.map(s2l); return [m[0][0] * r + m[0][1] * g + m[0][2] * b, m[1][0] * r + m[1][1] * g + m[1][2] * b, m[2][0] * r + m[2][1] * g + m[2][2] * b].map(l2s); };
const redmean = (a, b) => { const rm = (a[0] + b[0]) / 2, dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2]; return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db); };
const minPair = (cols) => { let m = Infinity, pair = [0, 1]; for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) { const d = redmean(cols[i], cols[j]); if (d < m) { m = d; pair = [i, j]; } } return { d: m, pair }; };

/** PURE: worst-case (min) zone distinguishability across the three CVD types for a
 *  hex palette. Reused by the selftest against a fabricated collapsing palette. */
function cvdWorst(hexPalette) {
  const rgb = hexPalette.map(hex2rgb);
  const per = {};
  let worst = Infinity, worstType = "";
  for (const [type, m] of Object.entries(MAT)) {
    const { d, pair } = minPair(rgb.map((c) => sim(c, m)));
    per[type] = { min: +d.toFixed(1), pair };
    if (d < worst) { worst = d; worstType = type; }
  }
  return { per, worst: +worst.toFixed(1), worstType };
}

const server = await ensureServer({ log });
const { browser, page } = await launchBrowser();
await bootGame(page);

let failures = 0;
const report = { palettes: {}, reduceMotion: {} };

if (!SELFTEST) {
  const pal = await page.evaluate(`window.${S}palettes`);
  for (const [name, hexes] of Object.entries(pal)) {
    const r = cvdWorst(hexes);
    report.palettes[name] = r;
    const line = Object.entries(r.per).map(([t, v]) => `${t}=${v.min}`).join(" ");
    const bad = r.worst < CB.minDistinct;
    log(`tempo ${name}: ${line} — worst ${r.worst} (${r.worstType}) ${bad ? `FAIL < ${CB.minDistinct}` : "ok"}`);
    if (bad) { log(`  CVD-COLLAPSE: zones ${r.per[r.worstType].pair.join("+")} indistinguishable under ${r.worstType} (dist ${r.worst})`); failures++; }
  }

  // Reduce Motion honored: the setting must zero shake AND toggle the no-anim
  // body class (screen flashes key off shakeScale, so shake=0 also dims them).
  const menusSrc = readFileSync(join(GAME_DIR, "src", "ui", "menus.ts"), "utf8");
  const zeroesShake = /reduceMotion\s*\?\s*0\s*:/.test(menusSrc);
  const noAnimClass = /rh-no-anim[\s\S]{0,80}reduceMotion|reduceMotion[\s\S]{0,80}rh-no-anim/.test(menusSrc);
  report.reduceMotion = { zeroesShake, noAnimClass };
  log(`reduce-motion: shake→0=${zeroesShake} no-anim-class=${noAnimClass}`);
  if (!zeroesShake) { log(`  REDUCE-MOTION: setting does not zero camera shake`); failures++; }
  if (!noAnimClass) { log(`  REDUCE-MOTION: no-anim body class not wired to the setting`); failures++; }
} else {
  // Fabricate a palette with two near-identical greens (collapse under deutan) and
  // a well-separated one; the worst-distance checker must fire on the first only.
  const collapsing = cvdWorst([0x44ff88, 0x46fe8a, 0xff8822, 0xff3344]); // zones 0,1 nearly equal
  const separated = cvdWorst([0x2f7dff, 0x9fd8ff, 0xffd23a, 0xff5ce0]);  // the real safe ramp
  const caught = collapsing.worst < CB.minDistinct;
  const quiet = separated.worst >= CB.minDistinct;
  log(`selftest: collapsing-palette worst=${collapsing.worst} caught=${caught}; separated worst=${separated.worst} quiet=${quiet}`);
  report.palettes = { collapsing, separated };
  failures = (caught && quiet) ? 0 : 1;
}

writeJSON(join(GAME_DIR, "artifacts", "qa", "colorblind.json"), {
  at: new Date().toISOString(), selftest: SELFTEST, report, failures,
});

await browser.close();
server.stop();
if (failures) { log(`FAIL — ${failures}`); process.exit(Math.min(failures, 99)); }
log(SELFTEST ? "OK — the CVD checker catches a collapsing palette and passes a separated one" : "OK — every tempo zone stays distinguishable under protan/deutan/tritan; reduce-motion honored");
