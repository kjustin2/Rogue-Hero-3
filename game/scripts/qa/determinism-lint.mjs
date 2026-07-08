// DETERMINISM LINT — a fast static backstop for the golden-trace MR: a bare
// Math.random() in a sim file that isn't annotated `// cosmetic:` is a
// re-introduced nondeterministic sim leak. The doctrine: SIM randomness → ctx.rng;
// cosmetic jitter (dt-gated particle emission, camera kick, mesh noise) → Math.random
// (never ctx.rng — feeding a dt-gated draw into the seeded stream desyncs it).
//
//   node scripts/qa/determinism-lint.mjs   (exit 1 on any un-annotated Math.random)
//
// The golden-trace (qa/determinism.mjs) is the real gate; this is the cheap
// grep-level guard that fails a PR the instant an un-classified draw lands.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GAME_DIR } from "../loop/lib.mjs";

const FILES = [
  "src/game/enemies.ts", "src/game/enemies2.ts", "src/game/boss.ts",
  "src/game/bossSpire.ts", "src/game/bossColossus.ts", "src/game/bossTyrant.ts",
  "src/game/bossUnmaker.ts",
];
const log = (...a) => console.log("[det-lint]", ...a);

let offenders = 0;
for (const rel of FILES) {
  const lines = readFileSync(join(GAME_DIR, rel), "utf8").split(/\r?\n/);
  lines.forEach((ln, i) => {
    if (ln.includes("Math.random(") && !/\/\/\s*cosmetic:/.test(ln)) {
      log(`${rel}:${i + 1}  un-annotated Math.random() — route SIM randomness through ctx.rng, or mark "// cosmetic:"`);
      log(`    ${ln.trim().slice(0, 100)}`);
      offenders++;
    }
  });
}

if (offenders) { log(`FAIL — ${offenders} un-classified Math.random() in sim files`); process.exit(1); }
log("OK — every Math.random() in the sim files is annotated cosmetic; sim randomness is on ctx.rng");
