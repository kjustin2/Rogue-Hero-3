// TEXT PACING — "proper context but not overwhelmed." Every DWELLED story beat
// (opening, act transitions, boss epitaphs, endings) auto-advances on a computed
// timer (menus.ts storyIntro: reading clamp [3400,6000]ms = 1400+42/char, +2000ms
// buffer, +per-paragraph). This replicates that dwell and compares it to a CAREFUL
// reading estimate (~50ms/char + recognition), flagging:
//   TOO-MUCH  — a wall of text whose dwell (capped at the 6s reading clamp) is LESS
//               than a careful reader needs → it advances before you finish.
//   TOO-LITTLE— an empty / near-empty beat that shows no context.
// Card descriptions are leisure-read (no auto-advance) so they're checked only for
// an OVERLONG wall in a small UI card. Deterministic; the narrative-cohesion AI read
// (narrative.mjs) is the separate qualitative pass.
//
//   node scripts/qa/text-pacing.mjs             audit every beat's read-vs-dwell
//   node scripts/qa/text-pacing.mjs --selftest  fault-proof: a wall-of-text flags
//                                               TOO-MUCH, an empty beat TOO-LITTLE,
//                                               a normal beat stays clean
//
// Exit = flagged-beat count (report — pacing tuning is the owner's call).
import { join } from "node:path";
import {
  launchBrowser, bootGame, writeJSON, ensureServer, guard, GAME_DIR,
} from "../loop/lib.mjs";
import cfg from "./qa.config.mjs";

guard({ name: "qa-text-pacing", maxMinutes: 5 });
const SELFTEST = process.argv.includes("--selftest");
const S = cfg.seam;
const TP = cfg.textPacing ?? {
  readMsPerChar: 50, readBaseMs: 300,  // careful dramatic reading
  minChars: 4,                          // below = a too-little/empty beat
  cardDescMaxChars: 140,                // a leisure-read card desc wall
};
const log = (...a) => console.log("[text-pacing]", ...a);

/** The game's dwell for one beat (menus.ts storyIntro, single-line: per-paragraph
 *  + extraHold only ADD, so this is the conservative floor). */
const dwellMs = (len) => Math.min(6000, Math.max(3400, 1400 + 42 * len)) + 2000;
/** Careful reading estimate. */
const readMs = (len, o) => len * o.readMsPerChar + o.readBaseMs;

/** PURE per-beat classification (reused by the selftest). */
function classify(text, o) {
  const len = text.trim().length;
  if (len < o.minChars) return { flag: "TOO-LITTLE", len, detail: `beat has ${len} chars — no context shown` };
  const dwell = dwellMs(len), read = readMs(len, o);
  if (read > dwell) return { flag: "TOO-MUCH", len, detail: `~${(read / 1000).toFixed(1)}s to read but auto-advances at ${(dwell / 1000).toFixed(1)}s — a wall of text` };
  return null;
}

const server = await ensureServer({ log });
const { browser, page } = await launchBrowser();
await bootGame(page);

let failures = 0;
const report = { beats: 0, flags: [] };

if (!SELFTEST) {
  const data = await page.evaluate(`(() => {
    const t = window.${S}text, cards = window.${S}cards;
    const beats = [];
    const push = (label, arr) => (arr || []).forEach((s, i) => beats.push({ label: label + "#" + i, text: String(s) }));
    push("story", t.story);
    for (const k in (t.actStory || {})) push("act" + k, t.actStory[k]);
    push("ending", t.endings); push("mercy", t.mercyEndings);
    push("actFlavor", t.actFlavor);
    for (const k in (t.bossEpitaphs || {})) { push("epitaph:" + k, t.bossEpitaphs[k]); }
    for (const k in (t.heroEndings || {})) beats.push({ label: "heroEnding:" + k, text: String(t.heroEndings[k]) });
    return { beats, cardDescs: cards.map((c) => ({ id: c.id, desc: c.desc, up: c.upDesc })) };
  })()`);
  report.beats = data.beats.length;
  for (const b of data.beats) {
    const f = classify(b.text, TP);
    if (f) { report.flags.push({ beat: b.label, ...f }); log(`  ${f.flag} ${b.label}: ${f.detail}`); failures++; }
  }
  // card descs: leisure-read, so only an OVERLONG wall in a small card is flagged.
  for (const c of data.cardDescs) {
    for (const [which, s] of [["desc", c.desc], ["upDesc", c.up]]) {
      const len = String(s || "").trim().length;
      if (len > TP.cardDescMaxChars) { report.flags.push({ beat: `card:${c.id}.${which}`, flag: "CARD-WALL", len, detail: `${len} chars > ${TP.cardDescMaxChars} in a UI card` }); log(`  CARD-WALL card:${c.id}.${which}: ${len} chars`); failures++; }
    }
  }
  log(`${report.beats} story beats + ${data.cardDescs.length} cards — ${failures} pacing flag(s)`);
} else {
  const wall = classify("A".repeat(220), TP);   // long → TOO-MUCH
  const empty = classify("", TP);                // empty → TOO-LITTLE
  const normal = classify("The rift opens. Steel yourself.", TP); // fine → null
  const gotWall = wall?.flag === "TOO-MUCH", gotEmpty = empty?.flag === "TOO-LITTLE", normalClean = normal === null;
  log(`selftest: wall→TOO-MUCH=${gotWall} empty→TOO-LITTLE=${gotEmpty} normal-clean=${normalClean} (all true)`);
  report.selftest = { gotWall, gotEmpty, normalClean };
  failures = (gotWall && gotEmpty && normalClean) ? 0 : 1;
}

writeJSON(join(GAME_DIR, "artifacts", "qa", "text-pacing.json"), {
  at: new Date().toISOString(), selftest: SELFTEST, report, failures,
});

await browser.close();
server.stop();
if (failures && SELFTEST) { log("SELFTEST FAIL"); process.exit(1); }
log(SELFTEST ? "OK — pacing flags a wall of text + an empty beat, passes a normal one"
  : `OK — ${report.beats} story beats + card descs paced (${report.flags.length} flagged for review) → artifacts/qa/text-pacing.json`);
