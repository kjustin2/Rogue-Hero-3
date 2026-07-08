// SHOT AUDIT — cheap objective gates over a directory of screenshots, so broken
// frames are caught BEFORE a human (or a paid AI judge) looks at them.
//
// Decodes each PNG in a headless-Chromium canvas (no new dependency — the
// visual-diff.mjs pattern) and flags:
//
//   BLACK    — an effectively all-black frame (renderer died / camera in void)
//   BLOWOUT  — bright-desaturated screen-fill (the additive-white FX class:
//              min>190, max−min<45 on >2.5% of pixels — same heuristic as the
//              flicker gate)
//   FLAT     — near-uniform frame that isn't black (solid gray/white = a dead
//              composer or a stuck loading fill)
//   TINY     — implausibly small capture (a broken viewport)
//   DUP      — pixel-identical to another differently-named shot in the set
//              (two "different scenes" showing the same frame = a broken jump)
//   STALE    — file predates --since (a stale artifact masquerading as fresh
//              evidence; pass the run's start timestamp)
//
//   node scripts/shot-audit.mjs shots                      # audit a dir
//   node scripts/shot-audit.mjs shots/verify a.png         # dirs and/or files
//   node scripts/shot-audit.mjs shots --since 1751700000000 --json out.json
//
// Exit code = number of flagged FRESH shots (STALE-only shots don't fail the
// run — they're just excluded evidence).
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { launchBrowser, writeJSON, shotStats, shotFlags } from "./loop/lib.mjs";

const ARGS = process.argv.slice(2);
const val = (f) => (ARGS.includes(f) ? ARGS[ARGS.indexOf(f) + 1] : null);
const SINCE = val("--since") ? Number(val("--since")) : null;
const JSON_OUT = val("--json");
const positional = ARGS.filter((a, i) => !a.startsWith("--") && ARGS[i - 1] !== "--since" && ARGS[i - 1] !== "--json");

// Collect PNGs (dirs recurse one level — shots/ has family subdirs).
const files = [];
for (const p of positional.length ? positional : ["shots"]) {
  const abs = resolve(p);
  if (!existsSync(abs)) { console.error(`[shot-audit] no such path: ${p}`); continue; }
  if (statSync(abs).isDirectory()) {
    for (const f of readdirSync(abs)) {
      const fp = join(abs, f);
      if (f.toLowerCase().endsWith(".png")) files.push(fp);
      else if (statSync(fp).isDirectory()) {
        for (const g of readdirSync(fp)) if (g.toLowerCase().endsWith(".png")) files.push(join(fp, g));
      }
    }
  } else files.push(abs);
}
if (!files.length) { console.log("[shot-audit] no PNGs found"); process.exit(0); }

// Staleness is a file-system fact — no decode needed.
const entries = files.map((f) => ({ file: f, mtime: statSync(f).mtimeMs, stale: SINCE != null && statSync(f).mtimeMs < SINCE }));
const fresh = entries.filter((e) => !e.stale);

// Quarantine ledger (three.js-style): a dir may ship _quarantine.json mapping
// filename → REASON. Quarantined flags are reported but never fail the gate —
// content that legitimately trips a gate gets excluded BY NAME with a WHY,
// the global threshold is never loosened.
const quarantine = new Map();
for (const dir of new Set(files.map((f) => join(f, "..")))) {
  try {
    const q = JSON.parse(readFileSync(join(dir, "_quarantine.json"), "utf8"));
    for (const [name, reason] of Object.entries(q)) quarantine.set(join(dir, name), reason);
  } catch { /* no ledger */ }
}

const { browser, page } = await launchBrowser();
const stats = [];
try {
  for (const e of fresh) {
    let s;
    try { s = await shotStats(page, e.file); }
    catch { stats.push({ ...e, flags: ["UNDECODABLE"] }); continue; }
    let flags = shotFlags(s);
    let quarantined;
    if (flags.length && quarantine.has(e.file)) {
      quarantined = { flags, reason: quarantine.get(e.file) };
      console.log(`info ${e.file.replace(/\\/g, "/").split("/game/").pop()} — ${flags.join(",")} QUARANTINED: ${quarantined.reason}`);
      flags = [];
    }
    stats.push({ ...e, ...s, flags, quarantined });
  }
} finally {
  await browser.close();
}

// DUP: identical signature across differently-named FRESH shots in the same dir.
const bySig = new Map();
for (const s of stats) {
  if (!s.sig || s.flags.includes("BLACK")) continue; // black dups are already flagged
  const key = `${join(s.file, "..")}::${s.sig}`;
  if (bySig.has(key)) { s.flags.push(`DUP(${basename(bySig.get(key))})`); }
  else bySig.set(key, s.file);
}

for (const e of entries.filter((x) => x.stale)) stats.push({ ...e, flags: ["STALE"] });

const flagged = stats.filter((s) => s.flags.length && !(s.flags.length === 1 && s.flags[0] === "STALE"));
const rel = (f) => f.replace(/\\/g, "/").split("/game/").pop();
for (const s of flagged.sort((a, b) => (b.flags.length - a.flags.length))) {
  console.log(`FLAG ${rel(s.file).padEnd(44)} ${s.flags.join(", ")}${s.meanLum != null ? `  (lum ${s.meanLum}±${s.stdLum}, black ${s.pctBlack}%, blowout ${s.pctBlowout}%)` : ""}`);
}
console.log(`[shot-audit] ${fresh.length} fresh audited, ${entries.length - fresh.length} stale skipped — ${flagged.length} flagged`);
if (JSON_OUT) writeJSON(resolve(JSON_OUT), { at: new Date().toISOString(), since: SINCE, shots: stats.map(({ file, flags, quarantined, w, h, pctBlack, pctBlowout, meanLum, stdLum }) => ({ file: rel(file), flags, quarantined, w, h, pctBlack, pctBlowout, meanLum, stdLum })) });
process.exit(flagged.length);
