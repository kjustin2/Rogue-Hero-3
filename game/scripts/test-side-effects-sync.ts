// Guards against the exact class of bug that caused the production boot crash:
// the set of Babylon side-effect imports in `babylonSideEffects.ts` MUST match
// the `optimizeDeps.include` list in `vite.config.ts`. If they drift, Vite's
// dep pre-bundler can silently omit a side-effect from the cached
// `@babylonjs/core` chunk, and the browser boots into
// "scene.enablePrePassRenderer is not a function".
//
// This script parses both files (as plain text — no runtime needed) and fails
// if the two lists don't match. Wired into `npm run verify`.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const gameDir = resolve(here, "..");

function readLines(path: string): string[] {
  return readFileSync(path, "utf8").split(/\r?\n/);
}

// ---- Parse babylonSideEffects.ts ----
const sideEffectsPath = resolve(gameDir, "src/engine/babylonSideEffects.ts");
const sideEffects = new Set<string>();
for (const line of readLines(sideEffectsPath)) {
  // Match: import "@babylonjs/core/...";
  const m = /^\s*import\s+"([^"]+)";?\s*$/.exec(line);
  if (m && m[1].startsWith("@babylonjs/")) sideEffects.add(m[1]);
}

// ---- Parse vite.config.ts ----
const viteConfigPath = resolve(gameDir, "vite.config.ts");
const viteIncludes = new Set<string>();
for (const line of readLines(viteConfigPath)) {
  // Match: "@babylonjs/...", — in the optimizeDeps include list.
  const m = /"(@babylonjs\/[^"]+)"/.exec(line);
  if (m) viteIncludes.add(m[1]);
}

// ---- Compare ----
let failures = 0;
function fail(msg: string): void {
  failures++;
  // eslint-disable-next-line no-console
  console.error(`  ✗ ${msg}`);
}

for (const mod of sideEffects) {
  if (!viteIncludes.has(mod)) {
    fail(`"${mod}" is imported in babylonSideEffects.ts but missing from vite.config.ts optimizeDeps.include`);
  }
}
for (const mod of viteIncludes) {
  if (!sideEffects.has(mod)) {
    fail(`"${mod}" is in vite.config.ts optimizeDeps.include but missing from babylonSideEffects.ts`);
  }
}

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(
    `\n✗ side-effect lists are out of sync.\n  Keep babylonSideEffects.ts and vite.config.ts's BABYLON_SIDE_EFFECTS array in lock-step,\n  or the browser will boot into "X is not a function" from a stale Vite dep cache.`,
  );
  process.exit(1);
}
// eslint-disable-next-line no-console
console.log(`✓ side-effect lists are in sync (${sideEffects.size} entries)`);
