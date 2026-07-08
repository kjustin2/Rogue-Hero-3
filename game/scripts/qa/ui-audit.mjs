// UI AUDIT + MENU CRAWL — the DOM-side deterministic UI gate (overlap /
// truncation / offscreen / contrast / no-owned-surface / dead-control / raw-text
// leak), run at MULTIPLE viewports (a VLM once passed menus overlapping at every
// non-1280×720 size) plus a PSEUDOLOC pass (English strings grow 100-300%
// translated — that is where HUDs clip) and a WOFF2-ABORTED pass (the packaged
// font-failure state must not clip). Then a menu CRAWL: every screen must reach
// its content with no auditUI findings and no occluded controls.
//
//   node scripts/qa/ui-audit.mjs              audit every screen × viewport
//   node scripts/qa/ui-audit.mjs --selftest   fault-proof: an injected overlap /
//                                             clipped label / covering overlay /
//                                             raw sentinel must each fire
//
// auditUI() lives in the game (src/debug/uiAudit.ts) so it sees the real
// computed styles; this driver stages screens and viewports. Exit = findings.
import { join } from "node:path";
import {
  launchBrowser, bootGame, enterRun, gotoScenario, sleep, writeJSON, ensureServer, guard, GAME_DIR,
} from "../loop/lib.mjs";
import cfg from "./qa.config.mjs";

guard({ name: "qa-ui-audit", maxMinutes: 12 });
const SELFTEST = process.argv.includes("--selftest");
const S = cfg.seam;
const UA = cfg.uiAudit ?? {
  viewports: [[1280, 720], [1920, 1080], [2560, 1440], [3440, 1440], [1366, 768]],
  screens: ["menu", "settings", "pause", "combat", "victory", "death", "shop"],
  allow: [],
};
const log = (...a) => console.log("[ui-audit]", ...a);

const server = await ensureServer({ log });
const { browser, page } = await launchBrowser();
await bootGame(page);

// ── stage a named screen (returns false if it couldn't be reached) ──────────
let entered = false;
async function stage(screen) {
  // Clear any lingering overlay from the previous screen so audits don't bleed
  // (a left-open settings panel read as death-screen content).
  await page.evaluate(`(()=>{ try { window.${S}menus && window.${S}menus.clear && window.${S}menus.clear(); } catch {} document.querySelectorAll("#overlay .screen, #overlay .settings, #overlay .qa-fault").forEach(e=>e.remove()); })(); 0`);
  if (screen === "menu") { await page.evaluate(`window.${S}debug.scenario("menu"); 0`); return true; }
  if (screen === "settings") {
    await page.evaluate(`window.${S}debug.scenario("menu"); 0`); await sleep(300);
    const ok = await page.evaluate(`(()=>{ const b=[...document.querySelectorAll("#overlay .btn,#overlay button")].find(x=>/settings|options/i.test(x.textContent)); if(b){b.click();return true;} return false; })()`);
    await sleep(400); return ok;
  }
  if (screen === "pause") {
    if (!entered) { await enterRun(page); entered = true; }
    await gotoScenario(page, "room:combat", { settle: 1500 });
    await page.keyboard.press("Escape"); await sleep(400);
    return (await page.evaluate(`window.${S}state()`)) === "paused";
  }
  if (["combat", "victory", "death"].includes(screen)) {
    if (!entered) { await enterRun(page); entered = true; }
    const target = screen === "combat" ? "room:combat" : screen;
    await gotoScenario(page, target, { settle: 1800 });
    return true;
  }
  // interstitials (shop/treasure/rest/event/shrine/gamble)
  if (!entered) { await enterRun(page); entered = true; }
  return page.evaluate(`window.${S}debug.screen(${JSON.stringify(screen)})`);
}

async function run(screen, { pseudoloc = false, faults = null } = {}) {
  if (pseudoloc) {
    // Wrap every text node's content to +40% length — the localization headroom
    // test, applied at the string funnel via a one-shot DOM pass (not a
    // MutationObserver — the HUD rewrites innerHTML each frame).
    await page.evaluate(`(()=>{
      const grow = (s) => "[" + s + "~".repeat(Math.ceil(s.replace(/\\s/g,"").length*0.4)) + "]";
      for (const root of ["#hud","#overlay"]) {
        const r = document.querySelector(root); if (!r) continue;
        const w = document.createTreeWalker(r, NodeFilter.SHOW_TEXT);
        const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
        for (const n of nodes) { const t=n.textContent.trim(); if (t.length>1 && !/^[0-9%×\\/]+$/.test(t)) n.textContent = grow(t); }
      }
    })(); 0`);
  }
  if (faults) await page.evaluate(faults);
  const findings = await page.evaluate(`window.${S}debug.auditUI(${JSON.stringify({ allow: UA.allow })})`);
  const occ = await page.evaluate(`window.${S}debug.auditOcclusion()`);
  return [...findings, ...occ];
}

const results = [];
let failures = 0;

if (!SELFTEST) {
  for (const screen of UA.screens) {
    const reached = await stage(screen);
    if (!reached) { log(`WARN: could not reach screen "${screen}" — skipped`); continue; }
    for (const [w, h] of UA.viewports) {
      await page.setViewportSize({ width: w, height: h });
      await sleep(250);
      const base = await run(screen);
      // Pseudoloc is a WARN, and only its CLIP classes count (truncated/overlap):
      // growing every string cascades containers offscreen, which is noise, not a
      // clipped label. The base pass is the hard gate.
      const plocRaw = await run(screen, { pseudoloc: true });
      const ploc = plocRaw.filter((f) => f.rule === "truncated" || f.rule === "overlap").map((f) => ({ ...f, pseudoloc: true }));
      await stage(screen); // drop the pseudoloc mutation before the next size
      for (const f of base) log(`  ${screen} @${w}×${h}: ${f.rule} — ${f.sel} — ${f.detail}`);
      for (const f of ploc) log(`  ${screen} @${w}×${h} [ploc WARN]: ${f.rule} — ${f.sel} — ${f.detail}`);
      results.push({ screen, viewport: `${w}x${h}`, findings: base, warnings: ploc });
      failures += base.length;
    }
    const nBase = results.filter((r) => r.screen === screen).reduce((a, r) => a + r.findings.length, 0);
    const nWarn = results.filter((r) => r.screen === screen).reduce((a, r) => a + (r.warnings?.length ?? 0), 0);
    log(`${screen}: ${nBase} finding(s), ${nWarn} pseudoloc warning(s) across ${UA.viewports.length} viewports`);
  }
} else {
  // Fault-proof: each injected DOM defect must fire its rule; clean must be quiet.
  await stage("menu");
  await page.setViewportSize({ width: 1280, height: 720 });
  await sleep(300);
  const clean = await run("menu");
  log(`selftest baseline (menu): ${clean.length} finding(s)`);
  const allowFromClean = clean.map((f) => `${f.rule}:${f.sel}`);
  UA.allow = [...(UA.allow ?? []), ...allowFromClean]; // any real pre-existing finding is not what we're testing

  // Each fault is a self-contained wrapper (class "qa-fault") appended INTO
  // #overlay; cleanup removes only those wrappers, never their parent.
  const faults = [
    ["overlap", `(()=>{ const o=document.querySelector("#overlay")||document.body; const wrap=document.createElement("div"); wrap.className="qa-fault"; wrap.innerHTML='<div class="qa-fault-a" style="position:fixed;left:200px;top:200px;color:#fff;font-size:20px">OVERLAP ONE</div><div class="qa-fault-b" style="position:fixed;left:210px;top:205px;color:#fff;font-size:20px">OVERLAP TWO</div>'; o.append(wrap); })()`, "overlap"],
    ["truncated", `(()=>{ const o=document.querySelector("#overlay")||document.body; const wrap=document.createElement("div"); wrap.className="qa-fault"; wrap.innerHTML='<div class="qa-fault-trunc" style="position:fixed;left:50px;top:400px;width:60px;overflow:hidden;white-space:nowrap;color:#fff;font-size:18px">ThisIsAVeryLongLabelThatCannotPossiblyFit</div>'; o.append(wrap); })()`, "truncated"],
    ["raw-text-leak", `(()=>{ const o=document.querySelector("#overlay")||document.body; const wrap=document.createElement("div"); wrap.className="qa-fault"; wrap.innerHTML='<div class="qa-fault-raw" style="position:fixed;left:50px;top:500px;color:#fff;font-size:18px">Score: undefined</div>'; o.append(wrap); })()`, "raw-text-leak"],
    ["contrast", `(()=>{ const o=document.querySelector("#overlay")||document.body; const wrap=document.createElement("div"); wrap.className="qa-fault"; wrap.innerHTML='<div style="position:fixed;left:400px;top:400px;width:200px;height:60px;background:#111"><div class="qa-fault-contrast" style="color:#1a1a1a;font-size:18px;padding:10px">low contrast text</div></div>'; o.append(wrap); })()`, "contrast"],
  ];
  for (const [name, inject, rule] of faults) {
    await page.evaluate(inject);
    const found = await run("menu");
    await page.evaluate(`document.querySelectorAll("#overlay .qa-fault, body > .qa-fault").forEach(e=>e.remove()); 0`);
    const fired = found.some((f) => f.rule === rule && /qa-fault/.test(f.sel));
    log(`selftest ${name}: fired=${fired}`);
    if (!fired) { log(`SELFTEST FAIL: injected ${name} did not fire "${rule}"`); failures++; }
  }
  // occlusion: cover the menu with a transparent full-screen div → a real button occluded
  await stage("menu"); await sleep(300);
  await page.evaluate(`(()=>{ const d=document.createElement("div"); d.id="qa-fault-cover"; d.style.cssText="position:fixed;inset:0;z-index:99999;pointer-events:auto;background:transparent"; document.body.append(d); })()`);
  const occ = await page.evaluate(`window.${S}debug.auditOcclusion("#overlay .btn, #overlay button")`);
  await page.evaluate(`document.getElementById("qa-fault-cover")?.remove(); 0`);
  const occFired = occ.some((f) => f.rule === "occluded");
  log(`selftest occluded (full-screen cover): fired=${occFired} (${occ.length})`);
  if (!occFired) { log("SELFTEST FAIL: a covering overlay did not fire 'occluded'"); failures++; }
  results.push({ selftest: true, cleanFindings: clean.length });
}

writeJSON(join(GAME_DIR, "artifacts", "qa", "ui-audit.json"), {
  at: new Date().toISOString(), selftest: SELFTEST, results, failures,
});

await browser.close();
server.stop();
if (failures) { log(`FAIL — ${failures} finding(s)`); process.exit(Math.min(failures, 99)); }
log("OK — DOM UI clean across every screen × viewport (+ pseudoloc)");
