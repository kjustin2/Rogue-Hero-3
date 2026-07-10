// STATIC ARCHITECTURAL SCANNER — the CODE-LEVEL testing lane. Grep-checkable
// invariants from CLAUDE.md "Conventions & invariants" + "Pitfalls" that the TS
// compiler does NOT enforce (typed-events IS compiler-enforced — a raw non-EventMap
// string is a build error — so it's intentionally NOT here). Each rule is
// calibrated to pass CLEAN on the current tree and fire on a real violation.
//
//   node scripts/qa/scan.mjs             scan src/ (exit = violation count)
//   node scripts/qa/scan.mjs --selftest  fault-proof: each rule fires on a synthetic
//                                        violating line and stays quiet on a clean /
//                                        allow-listed one
//
// CPU-LANE: imports NOTHING from loop/lib.mjs → never arms the GPU guard lock, runs
// in the parallel static lane (mirrors determinism-lint.mjs).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const GAME_DIR = fileURLToPath(new URL("../../", import.meta.url)); // scripts/qa → game/
const SRC = join(GAME_DIR, "src");
const SELFTEST = process.argv.includes("--selftest");
const log = (...a) => console.log("[scan]", ...a);

// Each rule: { name, severity, re, allow(rel) — files exempt, hint }. `allow`
// encodes the ONE sanctioned exception (e.g. the combat.ts cold-crash latch).
const RULES = [
  {
    name: "damage-funnel", severity: "FAIL",
    re: /\.hp\s*-=/,
    allow: (rel) => /combat\.ts$|enemies\.ts$|enemies2\.ts$/.test(rel),
    hint: "direct hp decrement — route damage through Combat.dealDamage / damagePlayer",
  },
  {
    name: "tempo-mutation", severity: "FAIL",
    re: /\btempo\.value\s*=(?!=)/,
    allow: (rel) => /combat\.ts$/.test(rel), // the one cold-crash latch
    hint: "assign tempo via tempo.gain/drain/crash (zone events skip on a raw write)",
  },
  {
    name: "no-hitstop", severity: "FAIL",
    re: /\bdt\s*\*=|\btimeScale\b/,
    allow: () => false,
    hint: "no combat time-scaling — use cam.addTrauma/kick + stage.punch instead",
  },
  {
    name: "no-asset-files", severity: "FAIL",
    re: /\b(TextureLoader|GLTFLoader|FBXLoader|OBJLoader)\b|\.(glb|gltf|fbx)["'`]/,
    allow: () => false, // meshes are procedural, textures canvas-painted; music isn't a loader
    hint: "no asset files except music — meshes procedural, textures canvas-painted",
  },
  {
    name: "strict-ts-escape", severity: "FAIL",
    re: /\bas any\b|@ts-ignore|@ts-nocheck|eslint-disable/,
    allow: () => false,
    hint: "no escape hatches — strict TS with noUnusedLocals/Parameters is the contract",
  },
  {
    name: "placeholder-text", severity: "FAIL",
    re: /"[^"]*\b(lorem|ipsum|placeholder|PLACEHOLDER|TBD|WIP)\b[^"]*"/,
    allow: () => false,
    hint: "placeholder copy left in a player-facing string",
  },
  {
    // player-facing term is "Rift Depth"; "Ascension" is internal-only (code/CSS/events).
    name: "term-rift-depth", severity: "FAIL",
    re: /"[^"]*Ascension[^"]*"/,
    only: (rel) => /ui\/menus\.ts$|ui\/hud\.ts$/.test(rel),
    allow: () => false,
    hint: 'player-facing term is "Rift Depth", not internal "Ascension"',
  },
];

/** PURE per-file scan (reused by the selftest). Returns [{ rule, at, line }]. */
function scanFile(rel, text, rules) {
  const out = [];
  const lines = text.split(/\r?\n/);
  for (const rule of rules) {
    if (rule.only && !rule.only(rel)) continue;  // file-scoped rules (e.g. player-facing text)
    if (rule.allow(rel)) continue;
    lines.forEach((ln, i) => {
      if (rule.re.test(ln) && !/\/\/\s*scan-ok/.test(ln)) out.push({ rule: rule.name, severity: rule.severity, at: `${rel}:${i + 1}`, line: ln.trim().slice(0, 100), hint: rule.hint });
    });
  }
  return out;
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

if (!SELFTEST) {
  const files = walk(SRC);
  const violations = [];
  for (const abs of files) violations.push(...scanFile(relative(GAME_DIR, abs).replace(/\\/g, "/"), readFileSync(abs, "utf8"), RULES));
  for (const v of violations) { log(`${v.severity} ${v.rule}  ${v.at}`); log(`    ${v.line}   — ${v.hint}`); }
  log(`${files.length} files, ${RULES.length} rules — ${violations.length ? `${violations.length} violation(s)` : "clean"}`);
  if (violations.length) process.exit(Math.min(violations.length, 99));
  log("OK — every architectural invariant holds across src/");
} else {
  // Each rule must fire on a synthetic violation and stay quiet on a clean/allowed line.
  const cases = [
    { rule: "damage-funnel", bad: "src/game/player.ts", good: "src/game/combat.ts", line: "this.player.hp -= dmg;" },
    { rule: "tempo-mutation", bad: "src/game/relics.ts", good: "src/game/combat.ts", line: "tempo.value = 25;" },
    { rule: "no-hitstop", bad: "src/game/combat.ts", good: null, line: "dt *= 0.2; // slowmo" },
    { rule: "no-asset-files", bad: "src/render/arena.ts", good: null, line: 'const m = loader.load("hero.glb");' },
    { rule: "strict-ts-escape", bad: "src/game/deck.ts", good: null, line: "const x = y as any;" },
    { rule: "placeholder-text", bad: "src/ui/menus.ts", good: null, line: 'const t = "lorem ipsum dolor";' },
    { rule: "term-rift-depth", bad: "src/ui/menus.ts", good: "src/game/difficulty.ts", line: 'label: "Ascension Depth",' },
  ];
  let fail = 0;
  for (const c of cases) {
    const firesOnBad = scanFile(c.bad, c.line + "\n", RULES).some((v) => v.rule === c.rule);
    const quietOnGood = c.good ? !scanFile(c.good, c.line + "\n", RULES).some((v) => v.rule === c.rule) : true;
    const quietOnMarked = !scanFile(c.bad, c.line + " // scan-ok\n", RULES).some((v) => v.rule === c.rule);
    log(`${c.rule}: fires=${firesOnBad} allow-quiet=${quietOnGood} scan-ok-quiet=${quietOnMarked}`);
    if (!(firesOnBad && quietOnGood && quietOnMarked)) fail++;
  }
  if (fail) { log(`SELFTEST FAIL — ${fail} rule(s) misbehaved`); process.exit(1); }
  log("OK — every scanner fires on its violation and respects allow-lists + // scan-ok");
}
