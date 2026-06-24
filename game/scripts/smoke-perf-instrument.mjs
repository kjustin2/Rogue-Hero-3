// Regression probe for the perf instrument itself (src/debug/perfMonitor.ts +
// window.__rh3perf). If this hook breaks, every perf script silently degrades to
// the rAF fallback (no draw-call / program data), so guard its contract directly:
//   • the hook exists and the overlay toggles
//   • report()/start()/stop() return well-formed stats
//   • in live combat draw calls / triangles / programs are NON-ZERO (the bug where
//     the menu's capped render left snap.calls reading 0 on un-rendered frames)
//   • marks are captured during a recording window
// Needs the dev server on :5174.
import {
  launchBrowser, bootGame, enterRun, samplePerf, perfReport, sleep, isServerUp,
} from "./loop/lib.mjs";

if (!(await isServerUp())) { console.error("[perf-instrument] dev server not on :5174"); process.exit(2); }
const { browser, page, errors } = await launchBrowser();
let fail = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? "  — " + extra : ""}`); if (!ok) fail++; };

try {
  await bootGame(page, { query: "?perf" });
  await sleep(700);

  check("window.__rh3perf is exposed", await page.evaluate(() => !!window.__rh3perf));
  // ?perf auto-opened the overlay.
  check("overlay visible with ?perf", await page.evaluate(() => {
    const e = document.getElementById("rh3-perf-hud"); return !!e && getComputedStyle(e).display !== "none";
  }));
  // hud() toggles off then back on.
  const toggled = await page.evaluate(() => { const off = window.__rh3perf.hud(false); const on = window.__rh3perf.hud(true); return { off, on }; });
  check("hud(false)/hud(true) toggles", toggled.off === false && toggled.on === true, JSON.stringify(toggled));

  const menu = await perfReport(page);
  check("menu report has shader programs warmed", (menu?.snap?.programs ?? 0) > 0, `programs=${menu?.snap?.programs}`);
  check("menu report knows the state", menu?.snap?.state === "menu", `state=${menu?.snap?.state}`);

  // Into live combat, then sample with attack input.
  await enterRun(page);
  const stats = await samplePerf(page, {
    label: "instrument-combat",
    action: async (p) => {
      for (let i = 0; i < 6; i++) {
        await p.evaluate(() => { window.__rh3perf.mark("swing"); document.getElementById("game")?.dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true })); });
        await sleep(120);
        await p.evaluate(() => window.dispatchEvent(new PointerEvent("pointerup", { button: 0, bubbles: true })));
        await p.evaluate(() => window.__rh3debug?.godmode?.());
        await sleep(380);
      }
    },
  });

  check("not on the rAF fallback (real instrument)", stats._fallback !== true);
  check("sampled real frames", stats.frames > 5, `frames=${stats.frames}`);
  check("combat draw calls are non-zero", (stats.snap?.calls ?? 0) > 0, `calls=${stats.snap?.calls}`);
  check("combat triangles are non-zero", (stats.snap?.triangles ?? 0) > 0, `tris=${stats.snap?.triangles}`);
  check("combat shader programs are non-zero", (stats.snap?.programs ?? 0) > 0, `prog=${stats.snap?.programs}`);
  check("combat state is playing", stats.snap?.state === "playing", `state=${stats.snap?.state}`);
  check("live enemies counted", (stats.snap?.enemies ?? 0) >= 1, `enemies=${stats.snap?.enemies}`);
  check("percentiles ordered (p50<=p95<=p99<=max)", stats.p50 <= stats.p95 && stats.p95 <= stats.p99 && stats.p99 <= stats.max + 0.01,
    `p50=${stats.p50} p95=${stats.p95} p99=${stats.p99} max=${stats.max}`);
  check("event marks captured during the window", Array.isArray(stats.marks) && stats.marks.some((m) => m.label === "swing"),
    `marks=${stats.marks?.length}`);
  // No giant synchronous stalls in steady combat (the freeze class).
  check("no multi-hundred-ms freeze in combat", (stats.over250 ?? 0) === 0, `over250=${stats.over250}`);
} catch (err) {
  errors.push(`THREW: ${err.message}`);
  console.log("ERROR:", err.message);
} finally {
  await browser.close();
}

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.slice(0, 5).join("\n")}` : "NO CONSOLE ERRORS");
const ok = fail === 0 && errors.length === 0;
console.log(ok ? "PERF-INSTRUMENT: ALL PASS" : `PERF-INSTRUMENT: ${fail} failure(s)`);
process.exit(ok ? 0 : 1);
