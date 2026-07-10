// NARRATIVE COHESION — the qualitative half of "is the wording/story cohesive and
// makes sense for a game." Assembles the ORDERED player-facing corpus (opening →
// act transitions → boss epitaphs → endings) off the __rh3text seam and asks the
// `claude` CLI to judge cohesion, per-act tone escalation, and whether the ending is
// EARNED — the AI reasoning over the DETERMINISTIC corpus (terminology consistency +
// placeholder leaks are the static scan's job; text pacing is text-pacing.mjs's).
// Cost-gated: one claude call, --judge only. `claude` CLI, never an API key.
//
//   node scripts/qa/narrative.mjs             assemble corpus + AI cohesion read
//   node scripts/qa/narrative.mjs --selftest  fault-proof (no AI call): the corpus
//                                             assembles in story order + the verdict
//                                             parser handles a sample
//
// Exit 0 always (a report). Writes artifacts/qa/narrative.json.
import { join } from "node:path";
import {
  launchBrowser, bootGame, writeJSON, ensureServer, guard, GAME_DIR, runClaude, extractJSON,
} from "../loop/lib.mjs";
import cfg from "./qa.config.mjs";

guard({ name: "qa-narrative", maxMinutes: 6 });
const SELFTEST = process.argv.includes("--selftest");
const S = cfg.seam;
const log = (...a) => console.log("[narrative]", ...a);
const OUT = join(GAME_DIR, "artifacts", "qa");

/** PURE: assemble the corpus into an ordered, labelled beat list (reused by the selftest). */
function assemble(t) {
  const beats = [];
  (t.story || []).forEach((s, i) => beats.push({ beat: `opening.${i}`, text: String(s) }));
  for (const act of Object.keys(t.actStory || {}).sort()) (t.actStory[act] || []).forEach((s, i) => beats.push({ beat: `act${act}.${i}`, text: String(s) }));
  for (const boss of Object.keys(t.bossEpitaphs || {})) beats.push({ beat: `epitaph.${boss}`, text: (t.bossEpitaphs[boss] || []).join(" — ") });
  (t.endings || []).forEach((s, i) => beats.push({ beat: `ending.${i}`, text: String(s) }));
  (t.mercyEndings || []).forEach((s, i) => beats.push({ beat: `mercy.${i}`, text: String(s) }));
  return beats;
}

function buildPrompt(beats) {
  const corpus = beats.map((b) => `[${b.beat}] ${b.text}`).join("\n");
  return `You are a narrative editor reviewing the COMPLETE player-facing story text of an action roguelike (Rogue Hero 3), in play order (opening → act transitions → boss epitaphs → endings). Judge it as a whole. Do NOT invent lore — assess only what is written.

${corpus}

Assess: (1) COHESION — do the beats form one consistent world + arc, or contradict/disconnect? (2) TONE — does it escalate appropriately act to act? (3) EARNED ENDING — do the endings pay off what the opening + acts set up? Flag any beat that is confusing, off-tone, contradictory, or a non-sequitur.

Respond with ONLY JSON: {"cohesion":"strong|ok|weak","toneEscalates":true|false,"endingEarned":true|false,"issues":[{"beat":"<id>","issue":"<one sentence>"}],"summary":"<one sentence overall>"}`;
}

if (SELFTEST) {
  const t = { story: ["The kingdom fell.", "You descend."], actStory: { 2: ["Deeper now."] }, bossEpitaphs: { warden: ["THE WARDEN WEEPS", "you don't know what you end"] }, endings: ["The light endures."] };
  const beats = assemble(t);
  const ordered = beats[0].beat === "opening.0" && beats.some((b) => b.beat === "act2.0") && beats.some((b) => b.beat.startsWith("epitaph")) && beats[beats.length - 1].beat.startsWith("ending");
  const sample = extractJSON('{"cohesion":"strong","toneEscalates":true,"endingEarned":true,"issues":[],"summary":"cohesive"}');
  const parses = sample && sample.cohesion === "strong" && Array.isArray(sample.issues);
  log(`selftest: corpus-ordered=${ordered} verdict-parses=${!!parses} (both true)`);
  writeJSON(join(OUT, "narrative.json"), { at: new Date().toISOString(), selftest: true, ok: ordered && parses });
  if (!(ordered && parses)) { log("SELFTEST FAIL"); process.exit(1); }
  log("OK — the corpus assembles in story order and the verdict parser works (no AI call)");
  process.exit(0);
}

const server = await ensureServer({ log });
const { browser, page } = await launchBrowser();
await bootGame(page);
const t = await page.evaluate(`window.${S}text`);
await browser.close();

const beats = assemble(t || {});
if (!beats.length) { log("no narrative corpus on the seam"); writeJSON(join(OUT, "narrative.json"), { at: new Date().toISOString(), skipped: "no corpus" }); server.stop(); process.exit(0); }
log(`assembled ${beats.length} story beats — asking claude to judge cohesion…`);
const r = runClaude(buildPrompt(beats), { allowedTools: ["Read"], model: cfg.judge?.model, timeoutMs: 180000, log });
const review = extractJSON(r.result) ?? { raw: r.result?.slice(0, 400), parseError: true };
log(`cohesion: ${review.cohesion ?? "—"}, tone-escalates: ${review.toneEscalates}, ending-earned: ${review.endingEarned}`);
for (const i of (review.issues ?? []).slice(0, 8)) log(`  [${i.beat}] ${i.issue}`);
log(`summary: ${review.summary ?? "—"}`);

writeJSON(join(OUT, "narrative.json"), { at: new Date().toISOString(), model: cfg.judge?.model, beats: beats.length, review, cost: r.cost });
server.stop();
