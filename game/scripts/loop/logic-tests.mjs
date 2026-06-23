// LOGIC stage — evaluate the logical signals against a captured trace.
//
//   • goal.assert(trace) → the goal's own logical pass/fail
//   • goal.guard(trace)  → the precondition behind a VISUAL goal's screenshot
//                          (the second independent signal for visual goals)
//
// Reads trace.json from the cycle dir (--out <dir> / $LOOP_CYCLE_DIR / manual),
// writes logic.json, and exits non-zero if any logical `assert` failed.
import { join } from "node:path";
import { GOALS } from "./goals.mjs";
import { readJSON, writeJSON, ARTIFACTS } from "./lib.mjs";

const argOut = process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1] : null;
const OUT = argOut || process.env.LOOP_CYCLE_DIR || join(ARTIFACTS, "cycles", "manual");

const trace = readJSON(join(OUT, "trace.json"));
if (!trace) { console.error(`[logic] no trace.json in ${OUT}`); process.exit(2); }

const logic = {};
const guards = {};
let assertFails = 0;

for (const g of GOALS) {
  if (g.assert) {
    let r; try { r = g.assert(trace); } catch (e) { r = { pass: false, detail: `threw: ${e.message}` }; }
    logic[g.id] = r;
    if (!r.pass) assertFails++;
  }
  if (g.guard) {
    let r; try { r = g.guard(trace); } catch (e) { r = { pass: false, detail: `threw: ${e.message}` }; }
    guards[g.id] = r;
  }
}

writeJSON(join(OUT, "logic.json"), { logic, guards });

console.log("[logic] assertions:");
for (const [id, r] of Object.entries(logic)) {
  console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${id} — ${r.detail}`);
}
console.log("[logic] visual-goal guards:");
for (const [id, r] of Object.entries(guards)) {
  console.log(`  ${r.pass ? "ok " : "BAD"}  ${id} — ${r.detail}`);
}
console.log(`[logic] ${assertFails === 0 ? "ALL LOGIC PASS" : assertFails + " LOGIC FAIL"}`);
process.exit(assertFails === 0 ? 0 : 1);
