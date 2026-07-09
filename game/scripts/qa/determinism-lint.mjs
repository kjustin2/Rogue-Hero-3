// DETERMINISM LINT — a fast static backstop for the golden-trace MR: a bare
// Math.random() in a sim file that isn't annotated `// cosmetic:` is a
// re-introduced nondeterministic sim leak. Doctrine: SIM randomness → ctx.rng;
// cosmetic jitter (dt-gated particle emission, camera kick, mesh noise) → Math.random
// (never ctx.rng — feeding a dt-gated draw into the seeded stream desyncs it).
//
//   node scripts/qa/determinism-lint.mjs             exit 1 on any un-annotated Math.random
//   node scripts/qa/determinism-lint.mjs --selftest  fault-proof: an un-annotated line
//                                                    flags; an annotated one stays clean
//
// The golden-trace (qa/determinism.mjs) is the real gate; this is the cheap grep guard.
// CPU-LANE: imports NOTHING from loop/lib.mjs → never arms the GPU guard lock, so it
// runs in the parallel static-scan lane. Every scanner in scanners/ mirrors this shape.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const GAME_DIR = fileURLToPath(new URL("../../", import.meta.url)); // scripts/qa → game/
const SELFTEST = process.argv.includes("--selftest");
const log = (...a) => console.log("[det-lint]", ...a);

const FILES = [
  "src/game/enemies.ts", "src/game/enemies2.ts", "src/game/boss.ts",
  "src/game/bossSpire.ts", "src/game/bossColossus.ts", "src/game/bossTyrant.ts",
  "src/game/bossUnmaker.ts",
];

/** PURE per-file check (reused by the selftest): un-annotated `Math.random(` → offense. */
function scanText(rel, text) {
  const out = [];
  text.split(/\r?\n/).forEach((ln, i) => {
    if (ln.includes("Math.random(") && !/\/\/\s*cosmetic:/.test(ln)) out.push({ at: `${rel}:${i + 1}`, line: ln.trim().slice(0, 100) });
  });
  return out;
}

let offenders = 0;
if (!SELFTEST) {
  for (const rel of FILES) {
    for (const o of scanText(rel, readFileSync(join(GAME_DIR, rel), "utf8"))) {
      log(`${o.at}  un-annotated Math.random() — route SIM randomness through ctx.rng, or mark "// cosmetic:"`);
      log(`    ${o.line}`);
      offenders++;
    }
  }
  if (offenders) { log(`FAIL — ${offenders} un-classified Math.random() in sim files`); process.exit(1); }
  log("OK — every Math.random() in the sim files is annotated cosmetic; sim randomness is on ctx.rng");
} else {
  const dirty = scanText("x.ts", "const c = Math.random() * 10;\nconst e = Math.random(); // cosmetic: ember jitter\n");
  const flagged = dirty.length === 1 && dirty[0].at === "x.ts:1";
  const cleanKept = !dirty.some((o) => o.at === "x.ts:2");
  log(`selftest: un-annotated flagged=${flagged} annotated-clean=${cleanKept} (both true)`);
  if (!(flagged && cleanKept)) { log("SELFTEST FAIL"); process.exit(1); }
  log("OK — the lint flags an un-annotated Math.random and passes an annotated one");
}
