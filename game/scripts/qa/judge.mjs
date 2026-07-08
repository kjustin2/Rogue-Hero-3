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

// Ground truth for the judge to CROSS-CHECK pixels against (research: injecting
// engine state is the single biggest lever against VLM counting/spatial errors —
// "state says N enemies; I see an empty arena" catches render/state mismatches a
// blind read never would). Global facts + the filmstrip's spawned-enemy count.
const groundTruth = `GROUND TRUTH (cross-check the PIXELS against these engine facts — a mismatch is itself a bug):
- Art direction: dark rift/void arena, neon-emissive accents under bloom, procedural low-poly. Deliberately dark backgrounds are NORMAL, not a black-frame bug — only a >98%-black frame or a black SMEAR across an actor is a defect.
- Palette roles: threat = red, player = gold/cyan blade. A red wash on the player or a gold hue on a hazard is a role violation.
- The combat filmstrip has enemies actively spawned. An EMPTY arena in a "combat" tile is a state/render mismatch, not a clean frame.
- Boss beats show a boss HP bar at the TOP of the screen (never above the head).`;

const prompt = `You are a SENIOR ART DIRECTOR grading the Three.js action-roguelike "${cfg.name}" to a
SHIPPING COMMERCIAL bar. Use the Read tool to open EVERY screenshot listed. For each shot,
FIRST describe in one sentence exactly what you literally see (this description is required
and comes before any verdict — it is what keeps you honest), THEN give BINARY per-criterion
verdicts, each with ONE quoted visual observation.

ANTI-INFLATION RULES (verbatim, non-negotiable):
- EVIDENCE OR IT DIDN'T HAPPEN — cite the visible element behind each verdict; no evidence → FAIL.
- Judge what is ACTUALLY on screen, not what the code intends; "can't tell" is NOT a pass.
- Absence of flaws is NOT a positive. Between two readings, pick the more critical one.
- Never round up out of politeness. A real defect you can point to is a FAIL, full stop.

${groundTruth}

Criteria for every still (filmstrips instead use the motion criteria in their note):
  render-integrity: no black/blank regions, no white blowout, no corrupted pixels or black smears over actors
  player-readable: player actor visible + distinct from arena (skip on menu/portrait beats)
  threat-readable: enemies/hazards read as distinct silhouettes vs ground/FX
  hud-integrity: all text legible, uncut, non-overlapping, contrast passes on its background
  composition: subject framed, no floating/unsupported props, no obvious visual bug

SCREENSHOTS
${shotBlocks}

Respond with ONLY JSON, exactly:
{
  "shots": { "<filename>": { "describe": "<one sentence of what you literally see>", "verdicts": { "<criterion>": { "pass": true|false, "evidence": "<quoted observation>" } } } },
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

// Confidence-gated skeptic reconcile: for any HIGH-severity issue, pay a SECOND
// pass that argues the opposite ("assume the frame is fine, justify it") — a
// finding that survives an adversarial re-read is real; one that flips was VLM
// noise (~0.50 single-pass precision). Only high-severity, only when present, so
// the cost is bounded. Order-swap discipline (research: pairwise order bias >10%)
// is moot here since each shot is judged absolutely, not A/B.
const highIssues = (parsed.rankedIssues || []).filter((i) => i.severity === "high");
if (highIssues.length) {
  const skepticPrompt = `You are a SKEPTIC re-reviewing ${highIssues.length} claimed HIGH-severity visual defect(s)
in "${cfg.name}". For each, OPEN the shot with Read and argue as hard as you can that it is
ACTUALLY FINE (by-design dark art, intended bloom, a one-frame FX, a correct palette role).
Only concede "real" if the pixels leave no innocent explanation.

${groundTruth}

CLAIMS:
${highIssues.map((i, n) => `${n}. shot=${resolve(SHOTS_DIR, i.shot)} — "${i.issue}" (evidence: ${i.evidence})`).join("\n")}

Respond with ONLY JSON: {"verdicts":[{"n":<index>,"real":true|false,"why":"<one clause>"}]}`;
  const sk = runClaude(skepticPrompt, { allowedTools: ["Read"], timeoutMs: 300000 });
  const skj = extractJSON(sk.result);
  if (skj?.verdicts) {
    const overturned = new Set(skj.verdicts.filter((v) => v.real === false).map((v) => v.n));
    parsed.rankedIssues = (parsed.rankedIssues || []).map((iss) => {
      const idx = highIssues.indexOf(iss);
      if (idx >= 0 && overturned.has(idx)) {
        const v = skj.verdicts.find((x) => x.n === idx);
        log(`  skeptic OVERTURNED high issue "${iss.issue}" — ${v?.why ?? "argued fine"}`);
        return { ...iss, severity: "low", skepticOverturned: true, skepticWhy: v?.why };
      }
      return iss;
    });
    res.cost = (res.cost ?? 0) + (sk.cost ?? 0);
  }
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
