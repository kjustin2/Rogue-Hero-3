// AI VISUAL JUDGE — binary per-criterion verdicts over the contact sheet plus a
// stepper-driven combat FILMSTRIP (motion is judged from strips, never stills).
//
//   node scripts/qa/judge.mjs [--fresh]     # --fresh recaptures the contact sheet
//
// Discipline (research-backed): binary PASS/FAIL per criterion with ONE quoted
// visual observation each — numeric scores from VLM judges inflate; 9 frames
// per strip (more actively degrades judgment); deterministic gates stay primary
// (shot-audit runs first and broken frames are excluded, not judged).
// Output: artifacts/qa/judge.json + ranked issues on stdout. Exit 0 (advisory)
// unless --gate, then exit = number of FAIL shots.
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  launchBrowser, bootGame, enterRun, gotoScenario, sleep, guard,
  runClaude, extractJSON, writeJSON, ensureServer, GAME_DIR,
} from "../loop/lib.mjs";
import cfg from "./qa.config.mjs";

const ARGS = process.argv.slice(2);
guard({ name: "qa-judge", maxMinutes: 18 });
const S = cfg.seam;
const SHOTS_DIR = resolve(GAME_DIR, cfg.judge.shotsDir);
const OUT_DIR = join(GAME_DIR, "artifacts", "qa");
mkdirSync(OUT_DIR, { recursive: true });
const log = (...a) => console.log("[judge]", ...a);

const server = await ensureServer({ log });
const startedAt = Date.now();

// 1) Contact sheet (fresh capture, or reuse if present and --fresh not given).
if (ARGS.includes("--fresh") || !existsSync(SHOTS_DIR) || !readdirSync(SHOTS_DIR).some((f) => f.endsWith(".png"))) {
  log("capturing contact sheet …");
  const r = spawnSync(process.execPath, [`scripts/${cfg.phases.contactSheet}`, cfg.judge.shotsDir], {
    cwd: GAME_DIR, stdio: "inherit", timeout: 8 * 60_000,
  });
  if ((r.status ?? 1) !== 0) log("warning: contact-sheet capture exited nonzero — judging whatever exists");
}

// 2) Filmstrip: step the sim by exact frames (debug.frames) and tile 3×3 with
//    burned-in indices — one PNG that carries motion to the judge.
const stripPath = join(SHOTS_DIR, "filmstrip-combat.png");
{
  const { browser, page } = await launchBrowser();
  try {
    await bootGame(page);
    await enterRun(page);
    await gotoScenario(page, cfg.judge.filmstrip.setup, { settle: 1600 });
    // Clear act-title/story overlays so every tile samples MOTION, not a card.
    await page.evaluate(`(()=>{window.${S}menus && window.${S}menus.clear && window.${S}menus.clear(); document.querySelectorAll(".screen").forEach((s)=>s.remove());})()`);
    await sleep(500);
    // hold attack-ish input via direct action: swing at a spawned pack mid-strip
    await page.evaluate(`(()=>{const c=window.${S};try{for(const a of [0,2,4]) c.enemies.spawn("husk", Math.cos(a)*4, Math.sin(a)*4, 0);}catch(e){}})()`);
    await sleep(400);
    const { frames, stepPerTile, dt } = cfg.judge.filmstrip;
    const tiles = [];
    for (let i = 0; i < frames; i++) {
      // drive a swing on tile 0 so the strip shows attack anticipation→follow-through
      if (i === 0) { await page.mouse.move(900, 400); await page.mouse.down(); await page.mouse.up(); }
      await page.evaluate(`window.${S}debug.frames(${stepPerTile}, ${dt})`);
      await sleep(90); // let the compositor present the stepped frame
      tiles.push(await page.screenshot());
    }
    // compose the 3×3 montage in-page (canvas), burn indices
    const dataUrls = tiles.map((b) => `data:image/png;base64,${b.toString("base64")}`);
    const montage = await page.evaluate(async (urls) => {
      const imgs = await Promise.all(urls.map((u) => new Promise((res, rej) => {
        const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = u;
      })));
      const tw = 533, th = 300, cols = 3;
      const c = document.createElement("canvas");
      c.width = tw * cols; c.height = th * Math.ceil(imgs.length / cols);
      const g = c.getContext("2d");
      imgs.forEach((im, i) => {
        const x = (i % cols) * tw, y = Math.floor(i / cols) * th;
        g.drawImage(im, x, y, tw, th);
        g.fillStyle = "rgba(0,0,0,0.7)"; g.fillRect(x + 4, y + 4, 46, 22);
        g.fillStyle = "#fff"; g.font = "bold 14px monospace"; g.fillText(`#${i}`, x + 10, y + 20);
      });
      return c.toDataURL("image/png");
    }, dataUrls);
    writeFileSync(stripPath, Buffer.from(montage.split(",")[1], "base64"));
    log(`filmstrip → ${stripPath}`);
  } catch (e) {
    log(`filmstrip capture failed (${e.message}) — judging stills only`);
  } finally {
    await browser.close();
  }
}

// 3) Frame-gate first: exclude broken frames from judgment (deterministic
//    gates primary), and only judge FRESH files.
const auditJson = join(OUT_DIR, "judge-shot-audit.json");
spawnSync(process.execPath, ["scripts/shot-audit.mjs", cfg.judge.shotsDir, "--json", auditJson], {
  cwd: GAME_DIR, stdio: "inherit", timeout: 4 * 60_000,
});
let gated = [];
try { gated = JSON.parse(readFileSync(auditJson, "utf8")).shots.filter((s) => s.flags.length).map((s) => s.file.split("/").pop()); } catch { /* none */ }

const pngs = readdirSync(SHOTS_DIR).filter((f) => f.endsWith(".png") && !gated.includes(f)).sort();
if (!pngs.length) { console.error("[judge] nothing to judge"); process.exit(2); }

// 4) One claude -p call over the whole sheet.
// Quarantined beats carry their BY-DESIGN reason into the prompt so the judge
// doesn't re-discover a tracked design decision as a fresh high-severity issue.
let quarantineNotes = {};
try { quarantineNotes = JSON.parse(readFileSync(join(SHOTS_DIR, "_quarantine.json"), "utf8")); } catch { /* none */ }
const beatNote = (f) => {
  const hit = Object.keys(cfg.judge.beatNotes || {}).find((k) => f.startsWith(k));
  const q = quarantineNotes[f]
    ? ` QUARANTINED-BY-DESIGN (already tracked — do NOT rank as an issue): ${quarantineNotes[f]}` : "";
  return (hit ? ` beat_intent: ${cfg.judge.beatNotes[hit]}` : "") + q;
};
const shotBlocks = pngs.map((f) => `- ${resolve(SHOTS_DIR, f)}${f.startsWith("filmstrip") ? " (FILMSTRIP: 9 tiles #0–#8, fixed sim-time steps — judge MOTION: attack anticipation/follow-through, no foot-sliding, living idle, readable arcs)" : beatNote(f)}`).join("\n");

const prompt = `You are the visual-QA judge for the Three.js action-roguelike "${cfg.name}".
Use the Read tool to open EVERY screenshot listed, then judge each one with BINARY
per-criterion verdicts. Quote what you literally see as evidence — never soften a FAIL,
never invent problems you cannot point to in the pixels.

Criteria for every still (filmstrips instead use the motion criteria in their note):
  render-integrity: no black/blank regions, no white blowout, no corrupted pixels
  player-readable: player actor visible + distinct from arena (skip on menu/portrait beats)
  threat-readable: enemies/hazards read as distinct silhouettes vs ground/FX
  hud-integrity: all text legible, uncut, non-overlapping, contrast passes on its background
  composition: subject framed, no floating/unsupported props, no obvious visual bug

SCREENSHOTS
${shotBlocks}

Respond with ONLY JSON, exactly:
{
  "shots": { "<filename>": { "verdicts": { "<criterion>": { "pass": true|false, "evidence": "<quoted observation>" } } } },
  "rankedIssues": [
    { "severity": "high|medium|low", "issue": "<one sentence>", "shot": "<filename>", "evidence": "<what you saw>",
      "suggestedFix": "<one concrete code-level direction>" }
  ]
}
rankedIssues: most severe first, only REAL problems (an empty array is a valid answer).`;

log(`judging ${pngs.length} shots via claude -p …`);
const res = runClaude(prompt, { allowedTools: ["Read"], timeoutMs: 420000 });
const parsed = extractJSON(res.result);
if (!parsed) {
  console.error("[judge] could not parse JSON from claude:", String(res.result || "").slice(0, 400));
  process.exit(2);
}

const failShots = Object.entries(parsed.shots || {}).filter(([, v]) =>
  Object.values(v.verdicts || {}).some((c) => c && c.pass === false));
const out = {
  at: new Date().toISOString(), judged: pngs.length, excludedByGate: gated,
  failShots: failShots.map(([f]) => f),
  ...parsed,
  _meta: { cost: res.cost, durationMs: res.durationMs, ms: Date.now() - startedAt },
};
writeJSON(join(OUT_DIR, "judge.json"), out);

log(`${pngs.length - failShots.length}/${pngs.length} shots clean${gated.length ? ` (${gated.length} excluded by frame gate)` : ""}`);
for (const i of parsed.rankedIssues || []) log(`  [${i.severity}] ${i.issue} (${i.shot}) — fix: ${i.suggestedFix}`);
if (res.cost) log(`(judge cost $${res.cost.toFixed(3)})`);
if (server.owned) server.stop();
process.exit(ARGS.includes("--gate") ? failShots.length : 0);
