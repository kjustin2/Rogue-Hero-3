// AI-LOOK — point Claude's eyes at one frame on demand.
//
// Captures a scenario (or uses an existing PNG), then asks the already-authenticated
// `claude` CLI to Read the screenshot and answer a question about it — a one-shot,
// scriptable version of the loop's observe stage for "just tell me what this looks
// like / is anything wrong here". The perf overlay is baked in (?perf) so the AI can
// also reason about FPS / draw calls, not just the picture.
//
//   node scripts/ai-look.mjs menu
//   node scripts/ai-look.mjs hero-select "Are the heroes visually distinct?"
//   node scripts/ai-look.mjs boss:colossus:p2 "Does the boss read as imposing?"
//   node scripts/ai-look.mjs room:elite "Any unreadable text or washed-out glow?"
//   node scripts/ai-look.mjs shots/3-combat.png "Critique the combat readability"
//
// A scenario name is anything __rh3debug.scenario understands (menu | hero-select |
// combat[:act] | boss:<kind>[:p2|p3|p4] | enemy:<kind> | room:<kind>), OR a path to a
// PNG that already exists (then no browser is launched). Needs the dev server on
// :5174 only when capturing a scenario. Output is the AI's verdict, printed.

import { existsSync, statSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import {
  launchBrowser, bootGame, enterRun, gotoScenario, sleep,
  isServerUp, ensureDir, runClaude, perfReport, GAME_DIR,
} from "./loop/lib.mjs";

const ARGS = process.argv.slice(2);
const target = ARGS[0];
const question = ARGS.slice(1).filter((a) => !a.startsWith("--")).join(" ")
  || "Describe what is on screen and flag any visual problems: black/blank areas, "
   + "unreadable or low-contrast text, washed-out glow/bloom, clipping, or broken layout.";
if (!target) {
  console.error('usage: node scripts/ai-look.mjs <scenario|shot.png> "<question>"');
  process.exit(2);
}

const looksLikeFile = /\.png$/i.test(target) || existsSync(target);
let shotPath;
let perf = null; // ground-truth perf numbers when we capture a live scenario

if (looksLikeFile) {
  shotPath = isAbsolute(target) ? target : resolve(target);
  if (!existsSync(shotPath) || !statSync(shotPath).isFile()) {
    console.error(`[ai-look] no such image: ${shotPath}`);
    process.exit(2);
  }
  console.log(`[ai-look] using existing shot ${shotPath}`);
} else {
  if (!(await isServerUp())) { console.error("[ai-look] dev server not on :5174 — start `npm run dev`"); process.exit(2); }
  const OUT = join(GAME_DIR, "artifacts", "ai-look");
  ensureDir(OUT);
  const safe = target.replace(/[^a-z0-9]+/gi, "-");
  shotPath = join(OUT, `${safe}.png`);
  const { browser, page, errors } = await launchBrowser();
  try {
    console.log(`[ai-look] capturing scenario "${target}" …`);
    await bootGame(page, { query: "?perf" });
    if (target === "menu") {
      /* already at menu */
    } else if (target === "hero-select") {
      await page.locator("button", { hasText: /Begin Run|New Run/ }).first().click();
      await sleep(900);
    } else if (target === "combat" || /^combat:\d+$/.test(target)) {
      const act = target.includes(":") ? Number(target.split(":")[1]) : 1;
      if (act > 1) { await enterRun(page); await page.evaluate((a) => window.__rh3debug?.room("combat", a), act); await sleep(2600); await page.evaluate(() => window.__rh3debug?.godmode?.()); }
      else await enterRun(page);
    } else {
      await enterRun(page);
      const r = await gotoScenario(page, target, { settle: 3000 });
      if (!r.ok) console.log(`[ai-look] warning: __rh3debug did not recognize "${target}" — capturing current frame`);
    }
    perf = await perfReport(page); // authoritative perf (read from live gameplay, before any reframing)
    // Frame the subject so the question can actually be judged (the gameplay camera
    // follows the hero, so a boss can sit off-frame). Cinematic-dolly onto the boss
    // / enemy; --no-frame keeps the raw gameplay framing.
    if (!ARGS.includes("--no-frame") && /^(boss|enemy)/.test(target)) {
      await page.evaluate(() => {
        const b = window.__rh3debug?.boss0?.() || window.__rh3?.enemies?.living?.().find((e) => e.kind !== "boss");
        if (b?.pos) window.__rh3debug?.frame?.(b.pos.x, b.pos.z, 0.5);
      });
      await sleep(700);
    }
    await sleep(400);
    await page.screenshot({ path: shotPath });
    if (errors.length) console.log(`[ai-look] (${errors.length} console error(s) during capture)`);
  } finally {
    await browser.close();
  }
  console.log(`[ai-look] shot → ${shotPath}`);
}

const prompt = `You are a senior visual-QA reviewer for the Three.js action-roguelike "Rogue Hero 3".
Use the Read tool to open this screenshot, then answer the question from ONLY what is
actually visible (do not assume). Be concrete and cite what you see.

screenshot: ${shotPath}
${perf ? `
MEASURED PERFORMANCE (ground truth from the engine — trust THESE over the tiny on-screen
overlay): ${perf.fps} fps, mean ${perf.mean}ms, p95 ${perf.p95}ms, frames>250ms ${perf.over250}; ` +
`draw calls ${perf.snap?.calls}, triangles ${perf.snap?.triangles}, shader programs ${perf.snap?.programs}, ` +
`geometries ${perf.snap?.geometries}, textures ${perf.snap?.textures}, heap ${perf.snap?.heapMB}mb; ` +
`state ${perf.snap?.state}, live enemies ${perf.snap?.enemies}.
Factor these into your assessment where relevant.` : `
If a performance overlay is present in the TOP-LEFT (fps / frame ms / draw calls / programs /
state), read what you can and note it.`}

Question: ${question}

Answer in at most ~8 sentences. End with a single line "VERDICT: <one-line takeaway>".`;

console.log("[ai-look] asking claude …\n");
const res = runClaude(prompt, { allowedTools: ["Read"], timeoutMs: 240000 });
console.log(res.result?.trim() || "(no response)");
if (res.cost) console.log(`\n[ai-look] (${res.numTurns ?? "?"} turns, $${(res.cost).toFixed(4)})`);
process.exit(res.ok ? 0 : 1);
