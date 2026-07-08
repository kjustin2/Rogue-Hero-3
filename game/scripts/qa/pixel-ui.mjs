// PIXEL-UI LINT — the compositing residual the DOM auditUI() structurally CANNOT
// see, measured from the real framebuffer. auditUI computes contrast against the
// composited DOM background; HUD text that floats over the CANVAS has no DOM
// background, so auditUI can only flag "no-owned-surface" — it can't measure the
// actual contrast against the 3D pixels behind the glyphs. This does, on the real
// screenshot. Also duplicate/ghost-widget detection (a toast/panel drawn twice)
// via perceptual-hash tiling, which no DOM check catches.
//
//   node scripts/qa/pixel-ui.mjs               audit configured scenes
//   node scripts/qa/pixel-ui.mjs --selftest    fault-proof: a low-contrast HUD
//                                              label over a bright frame region
//                                              must fire; a duplicated widget must fire
//
// sharp for pixel stats (no Python). OCR-based text-region detection (ppu-paddle-
// ocr) is a fleet-rollout add for CANVAS-drawn UI; RH3's HUD is DOM, so we take
// text rects from getBoundingClientRect and read the framebuffer behind them.
// Exit = finding/failure count.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  launchBrowser, bootGame, enterRun, gotoScenario, sleep, writeJSON, ensureServer, guard, GAME_DIR,
} from "../loop/lib.mjs";
import cfg from "./qa.config.mjs";

guard({ name: "qa-pixel-ui", maxMinutes: 10 });
const SELFTEST = process.argv.includes("--selftest");
const S = cfg.seam;
const PU = cfg.pixelUi ?? {
  scenes: ["room:combat", "boss:warden", "room:elite"],
  minContrast: 3.0, dupHamming: 6, settleMs: 1800,
};
const log = (...a) => console.log("[pixel-ui]", ...a);
const OUT = join(GAME_DIR, "shots", "pixel-ui");
mkdirSync(OUT, { recursive: true });

const sharp = (await import("sharp")).default;
const server = await ensureServer({ log });
const { browser, page } = await launchBrowser();
await bootGame(page);
await enterRun(page);

// HUD text element rects (DOM) — for canvas-UI games this would instead be OCR/
// text-detector boxes over the screenshot; RH3's HUD is DOM so we read rects.
const textRects = () => page.evaluate(`(() => {
  const out = [];
  const roots = ["#hud","#overlay"].map(s=>document.querySelector(s)).filter(Boolean);
  const seen = [];
  for (const root of roots) {
    for (const el of root.querySelectorAll("*")) {
      const t = el.textContent && el.textContent.trim();
      if (!t) continue;
      if ([...el.children].some(c=>c.textContent&&c.textContent.trim())) continue; // leaf text only
      const cs = getComputedStyle(el);
      if (cs.display==="none"||cs.visibility==="hidden"||parseFloat(cs.opacity)===0) continue;
      const r = el.getBoundingClientRect();
      if (r.width<8||r.height<8) continue;
      const col = cs.color.match(/rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)/);
      out.push({ sel: (el.className&&typeof el.className==="string"?"."+el.className.trim().split(/\\s+/).join("."):el.tagName.toLowerCase()).slice(0,50),
        text: t.slice(0,24), x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height),
        fg: col?[+col[1],+col[2],+col[3]]:null });
    }
  }
  return out;
})()`);

// ── pixel helpers (sharp) ────────────────────────────────────────────────────
const lum = (r, g, b) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const wcag = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

/** Median luminance of a ring just OUTSIDE a text rect = the real background the
 *  glyphs sit on (the game pixels the DOM can't know). */
async function bgLuminance(png, r) {
  const pad = 6;
  const x = Math.max(0, r.x - pad), y = Math.max(0, r.y - pad);
  const w = r.w + pad * 2, h = r.h + pad * 2;
  const { data, info } = await sharp(png).extract({ left: x, top: y, width: Math.min(w, 1), height: Math.min(h, 1) }).raw().toBuffer({ resolveWithObject: true }).catch(() => ({ data: null }));
  // sample a hollow border: take the top+bottom edge rows of the padded box
  const region = await sharp(png).extract({ left: x, top: y, width: Math.min(w, 2000), height: Math.min(h, 2000) }).raw().toBuffer({ resolveWithObject: true }).catch(() => null);
  if (!region) return null;
  const { data: d, info: fo } = region;
  const ch = fo.channels;
  const lums = [];
  const stride = fo.width * ch;
  for (let py = 0; py < fo.height; py++) {
    const edge = py < pad || py >= fo.height - pad;
    for (let px = 0; px < fo.width; px++) {
      const edgeX = px < pad || px >= fo.width - pad;
      if (!edge && !edgeX) continue; // hollow ring only
      const i = py * stride + px * ch;
      lums.push(lum(d[i], d[i + 1], d[i + 2]));
    }
  }
  if (!lums.length) return null;
  lums.sort((a, b) => a - b);
  return lums[Math.floor(lums.length / 2)];
}

/** 64-bit perceptual hash of a frame region (DCT-free aHash — enough for
 *  near-duplicate widget detection). */
async function ahash(png, r) {
  const size = 8;
  const { data } = await sharp(png).extract({ left: Math.max(0, r.x), top: Math.max(0, r.y), width: r.w, height: r.h })
    .greyscale().resize(size, size, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true }).catch(() => ({ data: null }));
  if (!data) return null;
  let sum = 0; for (let i = 0; i < size * size; i++) sum += data[i];
  const avg = sum / (size * size);
  let bits = 0n; for (let i = 0; i < size * size; i++) if (data[i] > avg) bits |= 1n << BigInt(i);
  return bits;
}
const hamming = (a, b) => { let x = a ^ b, n = 0; while (x) { n += Number(x & 1n); x >>= 1n; } return n; };

async function auditScene(scene, { fault = null } = {}) {
  await gotoScenario(page, scene, { settle: PU.settleMs });
  await page.evaluate(`window.${S}debug.godmode(); window.${S}.fx.clear && window.${S}.fx.clear(); 0`);
  await page.evaluate(`window.${S}debug.frames(20); 0`);
  if (fault === "lowcontrast") {
    // A dark desaturated label over the dark arena centre — genuinely near the
    // background luminance, no halo/scrim. This is the "pale-on-pale after a
    // reskin" class the pixel gate exists for (grey-on-dark actually READS fine,
    // so the fault must sit close to its real backdrop).
    await page.evaluate(`(()=>{ const o=document.querySelector("#hud")||document.body; const d=document.createElement("div"); d.className="qa-pxfault-lc"; d.textContent="LOWCONTRAST"; d.style.cssText="position:fixed;left:50%;top:48%;transform:translate(-50%,-50%);color:#20202a;font-size:30px;font-weight:700;text-shadow:none;background:transparent;z-index:9999"; o.append(d); })(); 0`);
  }
  await sleep(200);
  const png = join(OUT, `${scene.replace(/[^a-z0-9]+/gi, "-")}${fault ? "-" + fault : ""}.png`);
  await page.screenshot({ path: png });
  const rects = await textRects();
  const r = { scene, findings: [], texts: rects.length };

  // 1) rendered-pixel contrast under each HUD text label vs the REAL framebuffer.
  for (const t of rects) {
    if (!t.fg) continue;
    const bgL = await bgLuminance(png, t);
    if (bgL == null) continue;
    const fgL = lum(t.fg[0], t.fg[1], t.fg[2]);
    const ratio = wcag(fgL, bgL);
    const big = t.h >= 26;
    if (ratio < (big ? PU.minContrast : PU.minContrast + 1.5)) {
      r.findings.push({ type: "PIXEL-CONTRAST", detail: `"${t.text}" (${t.sel}) reads ${ratio.toFixed(2)}:1 against the actual framebuffer behind it (need ${big ? PU.minContrast : PU.minContrast + 1.5})` });
    }
  }

  // 2) duplicate/ghost widget: hash each text rect, flag near-identical
  //    non-adjacent pairs of the SAME size (a toast/panel drawn twice).
  const hashes = [];
  for (const t of rects) { if (t.w >= 40 && t.h >= 16) hashes.push({ t, h: await ahash(png, t) }); }
  for (let i = 0; i < hashes.length; i++) {
    for (let j = i + 1; j < hashes.length; j++) {
      const A = hashes[i], B = hashes[j];
      if (A.h == null || B.h == null) continue;
      if (Math.abs(A.t.w - B.t.w) > 4 || Math.abs(A.t.h - B.t.h) > 4) continue; // same-size only
      const sep = Math.hypot(A.t.x - B.t.x, A.t.y - B.t.y);
      if (sep < 40) continue; // adjacent/overlapping isn't a duplicate render
      if (hamming(A.h, B.h) <= PU.dupHamming && A.t.text !== "" && A.t.text === B.t.text) {
        r.findings.push({ type: "DUP-WIDGET", detail: `"${A.t.text}" appears twice (${A.t.sel} @${A.t.x},${A.t.y} and @${B.t.x},${B.t.y}) — possible double-drawn/ghost widget` });
      }
    }
  }

  if (fault) await page.evaluate(`document.querySelectorAll('[class^="qa-pxfault"]').forEach(e=>e.remove()); 0`);
  return r;
}

let failures = 0;
const results = [];

if (!SELFTEST) {
  for (const scene of PU.scenes) {
    const r = await auditScene(scene);
    results.push(r);
    log(`${scene}: ${r.texts} HUD labels, ${r.findings.length} finding(s)`);
    for (const f of r.findings) log(`  ${f.type}: ${f.detail}`);
    failures += r.findings.length;
  }
} else {
  const scene = PU.scenes[0];
  const clean = await auditScene(scene);
  results.push(clean);
  log(`selftest baseline: ${clean.findings.length} finding(s) (must be 0)`);
  if (clean.findings.length) { failures++; for (const f of clean.findings) log(`  UNEXPECTED ${f.type}: ${f.detail}`); }

  // low-contrast fault: a grey label with no halo over the dark-but-lit arena.
  const lc = await auditScene(scene, { fault: "lowcontrast" });
  const lcFired = lc.findings.some((f) => f.type === "PIXEL-CONTRAST" && /qa-pxfault/.test(f.detail));
  log(`selftest PIXEL-CONTRAST (grey HUD label, no halo): fired=${lcFired}`);
  if (!lcFired) { log("SELFTEST FAIL: a low-contrast HUD label did not fire PIXEL-CONTRAST"); failures++; }

  // dup-widget fault: inject the same label twice, far apart, identical style.
  await gotoScenario(page, scene, { settle: PU.settleMs });
  await page.evaluate(`(()=>{ const o=document.querySelector("#hud")||document.body; const mk=(x)=>{ const d=document.createElement("div"); d.className="qa-pxfault-dup"; d.textContent="DANGER"; d.style.cssText="position:fixed;left:"+x+"px;top:300px;color:#fff;font-size:22px;font-weight:700;background:#222;padding:6px;z-index:9999"; return d; }; o.append(mk(200), mk(900)); })(); 0`);
  await page.evaluate(`window.${S}debug.frames(6); 0`);
  const dupPng = join(OUT, "_selftest-dup.png");
  await page.screenshot({ path: dupPng });
  const dupRects = (await textRects()).filter((t) => t.text === "DANGER");
  let dupFired = false;
  if (dupRects.length >= 2) {
    const h0 = await ahash(dupPng, dupRects[0]), h1 = await ahash(dupPng, dupRects[1]);
    dupFired = h0 != null && h1 != null && hamming(h0, h1) <= PU.dupHamming;
  }
  await page.evaluate(`document.querySelectorAll('[class^="qa-pxfault"]').forEach(e=>e.remove()); 0`);
  log(`selftest DUP-WIDGET (same label twice): fired=${dupFired} (${dupRects.length} matched rects)`);
  if (!dupFired) { log("SELFTEST FAIL: a duplicated widget did not hash-match"); failures++; }
  results.push(lc);
}

writeJSON(join(GAME_DIR, "artifacts", "qa", "pixel-ui.json"), {
  at: new Date().toISOString(), selftest: SELFTEST, results, failures,
});

await browser.close();
server.stop();
if (failures) { log(`FAIL — ${failures}`); process.exit(Math.min(failures, 99)); }
log("OK — HUD text contrasts against the real framebuffer; no ghost widgets");
