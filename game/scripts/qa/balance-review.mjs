// AI BALANCE READ — the AI reasons OVER deterministic measurements, never guesses.
// Reads the ledger (per-card dps + honed value), the bot-sim (difficulty curve), and
// the fairness (dodge windows) JSONs and asks the `claude` CLI for a RANKED balance
// report that SYNTHESISES across them and CONTEXTUALISES (a tempo/utility card SHOULD
// read low-dps; a high-dps + low-cooldown card is a real outlier). Cost-gated: one
// claude call, qa:full / qa:judge only. `claude` CLI, never an API key (owner rule).
//
//   node scripts/qa/balance-review.mjs             synthesise a ranked balance report
//   node scripts/qa/balance-review.mjs --selftest  fault-proof (no AI call): the
//                                                  prompt-assembly carries the flagged
//                                                  cards + the JSON parser handles a
//                                                  sample verdict
//
// Exit 0 always (a report, never a gate). Writes artifacts/qa/balance-review.json.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeJSON, ensureServer, guard, GAME_DIR, runClaude, extractJSON } from "../loop/lib.mjs";
import cfg from "./qa.config.mjs";

guard({ name: "qa-balance-review", maxMinutes: 6 });
const SELFTEST = process.argv.includes("--selftest");
const log = (...a) => console.log("[balance-review]", ...a);
const OUT = join(GAME_DIR, "artifacts", "qa");
const readReport = (name) => { try { return JSON.parse(readFileSync(join(OUT, name), "utf8")).report; } catch { return null; } };

/** PURE prompt assembly (reused by the selftest) over the three deterministic JSONs. */
function buildPrompt(ledger, sim, fairness) {
  const cards = (ledger?.rows ?? []).map((r) => `${r.id} [${r.kind}${(r.tags ?? []).length ? " " + r.tags.join("/") : ""}] dps=${r.dps} honedRatio=${r.honedRatio}`).join("\n");
  const flags = (ledger?.flags ?? []).map((f) => `${f.id}: ${f.flag} — ${f.detail}`).join("\n") || "none";
  const curve = (sim?.rows ?? []).map((r) => `depth ${r.depth}: ${r.cleared ? "cleared" : "timeout"} in ${r.frames}f`).join("; ") || "n/a";
  const dodge = (fairness?.units ?? []).map((u) => `${u.unit}: min ${u.minDodge}s`).join("; ") || "n/a";
  return `You are a senior game-balance analyst. Below are MEASURED numbers from an action roguelike (Rogue Hero 3) — treat them as ground truth, do not invent values. Produce a RANKED list of the most important balance concerns. CONTEXTUALISE: a tempo/utility/summon/mobility card SHOULD read low direct-dps (that is not a problem); a high-dps card with a low cooldown, or a honedRatio below ~1.15 (the upgrade barely beats base), is a genuine concern. Note if the difficulty curve does or does not ramp.

CARD LEDGER (dps = damage/cooldown at neutral tempo; honedRatio = honed effective-dps ÷ base, where 1.43 = equal damage after the −30% honed cooldown):
${cards}

AUTO-FLAGGED (heuristic first pass): ${flags}

DIFFICULTY CURVE (fixed-skill bot clear-time by Rift Depth): ${curve}

DODGE WINDOWS (min telegraph lead per unit; a fairness floor of 0.25s): ${dodge}

Respond with ONLY JSON: {"concerns":[{"severity":"high|medium|low","subject":"<card/system>","evidence":"<the measured number>","note":"<why, 1 sentence>"}],"curveVerdict":"<one sentence on whether difficulty ramps>"}`;
}

let review = null;
if (SELFTEST) {
  const ledger = { rows: [{ id: "nuke", kind: "damage", tags: ["fire"], dps: 40, honedRatio: 1.4 }, { id: "tempo-theft", kind: "damage", tags: ["arcane"], dps: 3, honedRatio: 1.4 }], flags: [{ id: "nuke", flag: "OVERTUNED", detail: "dps 40 > 37.5" }] };
  const prompt = buildPrompt(ledger, { rows: [{ depth: 0, cleared: true, frames: 350 }, { depth: 15, cleared: true, frames: 572 }] }, { units: [{ unit: "husk", minDodge: 0.3 }] });
  const carriesFlag = prompt.includes("nuke: OVERTUNED") && prompt.includes("dps=40");
  const sample = extractJSON('{"concerns":[{"severity":"high","subject":"nuke","evidence":"dps 40","note":"outlier"}],"curveVerdict":"ramps"}');
  const parses = sample && Array.isArray(sample.concerns) && sample.concerns[0].subject === "nuke";
  log(`selftest: prompt-carries-flag=${carriesFlag} verdict-parses=${!!parses} (both true)`);
  writeJSON(join(OUT, "balance-review.json"), { at: new Date().toISOString(), selftest: true, ok: carriesFlag && parses });
  if (!(carriesFlag && parses)) { log("SELFTEST FAIL"); process.exit(1); }
  log("OK — the prompt carries the deterministic flags and the verdict parser works (no AI call)");
  process.exit(0);
}

const ledger = readReport("balance-ledger.json"), sim = readReport("balance-sim.json"), fairness = readReport("fairness.json");
if (!ledger) { log("no balance-ledger.json — run `npm run qa:ledger` (or qa:full) first"); writeJSON(join(OUT, "balance-review.json"), { at: new Date().toISOString(), skipped: "no ledger" }); process.exit(0); }

const server = await ensureServer({ log }); // not strictly needed, but keeps the guard/env consistent
const prompt = buildPrompt(ledger, sim, fairness);
log(`asking claude to synthesise ${ledger.rows?.length ?? 0} cards + curve + dodge windows…`);
const r = runClaude(prompt, { allowedTools: ["Read"], model: cfg.judge?.model, timeoutMs: 180000, log });
review = extractJSON(r.result) ?? { raw: r.result?.slice(0, 500), parseError: true };
const concerns = review.concerns ?? [];
for (const c of concerns.slice(0, 8)) log(`  [${c.severity}] ${c.subject}: ${c.note} (${c.evidence})`);
log(`curve verdict: ${review.curveVerdict ?? "—"}`);
log(`${concerns.length} concern(s) — a report, not a gate → artifacts/qa/balance-review.json`);

writeJSON(join(OUT, "balance-review.json"), { at: new Date().toISOString(), model: cfg.judge?.model, review, cost: r.cost });
server.stop();
