// FLOW-GRAPH REACHABILITY / CTL COMPLETABILITY ORACLE — the run's map is a linear
// chain of forks (`generatePlan(seed,depth).forks`: pick 1 of 1–3 nodes, advance).
// Over a seed×depth grid it model-checks the properties a soft-lock/progression bug
// would break — the deterministic answer to "can every generated run be finished,
// and does it end where it should":
//
//   AG EF(victory)  — from EVERY reachable position there is a path to the terminal
//                     boss. On a linear chain that reduces to: no fork is empty
//                     (an empty fork = a position with nothing selectable = a hard
//                     onboarding-independent SOFT-LOCK) AND the final fork holds a
//                     boss node. A real BFS over the chain computes the reachable
//                     set so an injected empty fork actually severs it.
//   BOSS-ORDER      — the boss sequence is the canonical act order
//                     (warden→spire→colossus→tyrant→unmaker); a scrambled ladder is
//                     a progression bug.
//   KIND FRONTIER   — which declared NodeKinds mapgen ever emits across the grid;
//                     a never-generated kind = dead map content (WARN, may be gated).
//
// The DOM menu statechart crawl (overlap / trapped-screen / dead-control) is owned
// by ui-audit.mjs — this is the complementary MAP-flow half, deliberately not a dup.
//
//   node scripts/qa/state-graph.mjs             model-check the flow graph
//   node scripts/qa/state-graph.mjs --selftest  fault-proof: an empty fork
//                                               (severed reachability), a bossless
//                                               terminal, and a scrambled boss
//                                               order must each FIRE
//
// Exit = FINDING count (frontier gaps are WARN-only).
import { join } from "node:path";
import {
  launchBrowser, bootGame, writeJSON, ensureServer, guard, GAME_DIR,
} from "../loop/lib.mjs";
import cfg from "./qa.config.mjs";

guard({ name: "qa-state-graph", maxMinutes: 6 });
const SELFTEST = process.argv.includes("--selftest");
const S = cfg.seam;
const SG = cfg.stateGraph ?? {
  seeds: 40,
  nodeKinds: ["combat", "elite", "shop", "treasure", "rest", "event", "shrine", "gamble", "boss"],
  bossOrder: ["warden", "spire", "colossus", "tyrant", "unmaker"], // echo/wound are gated add-ons
};
const log = (...a) => console.log("[state-graph]", ...a);

/** PURE model-check of one plan. Reused verbatim by the selftest against fabricated
 *  faulty plans, so the checker itself is proven. A plan = { depth, forks:[[node]] }. */
function analyze(plan, bossOrder) {
  const findings = [];
  const forks = plan.forks;
  // AG EF(victory): BFS the reachable position set. Position p+1 is reachable iff p
  // is reachable AND fork p is non-empty (there is a node to pick and proceed on).
  let reachable = forks.length > 0;
  let severedAt = -1;
  for (let p = 0; p < forks.length; p++) {
    if (!reachable) break;
    if (!forks[p] || forks[p].length === 0) { severedAt = p; reachable = false; break; }
  }
  const terminalReached = reachable;
  if (severedAt >= 0) findings.push(`SOFT-LOCK: fork ${severedAt} is empty — no selectable node, run cannot proceed (AG EF victory severed)`);
  // terminal must contain a boss (victory node)
  const last = forks[forks.length - 1] || [];
  if (terminalReached && !last.some((n) => n.kind === "boss")) findings.push(`NO-VICTORY-NODE: terminal fork holds no boss node (${last.map((n) => n.kind).join(",")}) — victory unreachable`);
  // BOSS-ORDER: the CANONICAL act bosses must appear in ladder order. echo (superboss)
  // and wound (ascension true-final) are gated add-ons that legitimately intersperse
  // (e.g. …tyrant, echo, unmaker…), so filter to the canonical set before checking.
  const bosses = forks.flat().filter((n) => n.kind === "boss").map((n) => n.bossKind);
  const canon = bosses.filter((b) => bossOrder.includes(b));
  for (let i = 0; i < canon.length; i++) {
    if (canon[i] !== bossOrder[i]) { findings.push(`BOSS-ORDER: canonical boss #${i} is "${canon[i]}", expected "${bossOrder[i] ?? "(none — too many act bosses)"}" — progression ladder scrambled`); break; }
  }
  const kinds = new Set(forks.flat().map((n) => n.kind));
  return { findings, kinds: [...kinds], bosses };
}

const server = await ensureServer({ log });
const { browser, page } = await launchBrowser();
await bootGame(page);

let failures = 0;
const report = { checked: 0, findings: [], kindFrontier: [], warnings: [] };

if (!SELFTEST) {
  const maxDepth = await page.evaluate(`window.${S}gen.MAX_DEPTH`);
  const depths = [0, Math.floor(maxDepth / 2), maxDepth];
  const seenKinds = new Set();
  for (let seed = 1; seed <= SG.seeds; seed++) {
    for (const depth of depths) {
      const plan = await page.evaluate(`(() => { const p = window.${S}gen.generatePlan(${seed}, ${depth});
        return { depth: p.depth, forks: p.forks.map((f) => f.map((n) => ({ kind: n.kind, bossKind: n.bossKind || null }))) }; })()`);
      const r = analyze(plan, SG.bossOrder);
      r.kinds.forEach((k) => seenKinds.add(k));
      report.checked++;
      for (const f of r.findings) { report.findings.push({ seed, depth, finding: f }); failures++; log(`  seed ${seed} d${depth}: ${f}`); }
    }
  }
  // KIND FRONTIER (WARN): declared kinds never generated across the whole grid
  report.kindFrontier = [...seenKinds];
  const missing = SG.nodeKinds.filter((k) => !seenKinds.has(k));
  report.warnings = missing;
  log(`checked ${report.checked} plans across ${SG.seeds} seeds × ${depths.length} depths — ${failures} finding(s)`);
  log(`node-kind frontier: generated {${[...seenKinds].sort().join(", ")}}`);
  if (missing.length) log(`KIND-FRONTIER (WARN — declared but never generated across the grid; may be depth/rarity gated): ${missing.join(", ")}`);
} else {
  // Prove analyze() on fabricated faulty plans.
  const node = (kind, bossKind) => ({ kind, bossKind: bossKind || null });
  const good = { depth: 0, forks: [[node("combat")], [node("elite"), node("shop")], [node("boss", "warden")]] };
  const emptyFork = { depth: 0, forks: [[node("combat")], [], [node("boss", "warden")]] };
  const noBoss = { depth: 0, forks: [[node("combat")], [node("rest")]] };
  const scrambled = { depth: 0, forks: [[node("boss", "spire")], [node("boss", "warden")]] };
  const gc = analyze(good, SG.bossOrder).findings;
  const ef = analyze(emptyFork, SG.bossOrder).findings;
  const nb = analyze(noBoss, SG.bossOrder).findings;
  const sc = analyze(scrambled, SG.bossOrder).findings;
  const okClean = gc.length === 0;
  const okEmpty = ef.some((f) => /SOFT-LOCK/.test(f));
  const okNoBoss = nb.some((f) => /NO-VICTORY-NODE/.test(f));
  const okScramble = sc.some((f) => /BOSS-ORDER/.test(f));
  log(`selftest: clean=${okClean} empty-fork=${okEmpty} no-victory-node=${okNoBoss} scrambled-boss=${okScramble} (all must be true)`);
  failures = (okClean && okEmpty && okNoBoss && okScramble) ? 0 : 1;
}

writeJSON(join(GAME_DIR, "artifacts", "qa", "state-graph.json"), {
  at: new Date().toISOString(), selftest: SELFTEST, report, failures,
});

await browser.close();
server.stop();
if (failures) { log(`FAIL — ${failures}`); process.exit(Math.min(failures, 99)); }
log(SELFTEST ? "OK — the flow-graph checker catches severed reachability, a bossless terminal, and a scrambled ladder" : "OK — every generated run is completable (AG EF victory holds), boss ladder ordered, no dead-end forks");
