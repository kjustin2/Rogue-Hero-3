// Map generation smoke: determinism + structural constraints (no UI).
import { chromium } from "playwright-core";
import { join } from "node:path";

const EXE = join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1217/chrome-win64/chrome.exe");
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext()).newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
await page.goto("http://localhost:5174", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

let fail = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? "  — " + extra : ""}`); if (!ok) fail++; };

const r = await page.evaluate(() => {
  const { generatePlan } = window.__rh3gen;
  const a = generatePlan(12345, 0);
  const b = generatePlan(12345, 0);
  const deterministic = JSON.stringify(a) === JSON.stringify(b);
  const different = JSON.stringify(generatePlan(999, 0)) !== JSON.stringify(a);

  const forks = a.forks;
  // N acts × (entry + combat-only fork + pre-boss choice fork + boss) = N*4 forks
  const forkCount = forks.length;
  const numActs = forkCount / 4;
  // Per act: fork indices act*4 + [0..3]
  let entryCombat = true, bossLast = true, forksValid = true, actsEndBoss = 0, bossCount = 0;
  // Every act must guarantee at least 2 real fights before the boss (entry + a
  // combat-only first fork) — non-combat nodes can't replace combat on the way down.
  let combatToBoss = true;
  // Rest must ALWAYS be a multi-option fork choice, NEVER a single-node fork that
  // auto-enters (the railroad bug): picking shop/event must never dump you into a rest.
  let restAlwaysChoice = true;
  for (let act = 0; act < numActs; act++) {
    const base = act * 4;
    if (forks[base].length !== 1 || forks[base][0].kind !== "combat") entryCombat = false;
    const bn = forks[base + 3];
    if (bn.length !== 1 || bn[0].kind !== "boss") bossLast = false; else actsEndBoss++;
    // two middle CHOICE forks: 2-3 options, >=1 combat/elite each
    for (const fi of [base + 1, base + 2]) {
      const f = forks[fi];
      if (f.length < 2 || f.length > 3) forksValid = false;
      if (!f.some((n) => n.kind === "combat" || n.kind === "elite")) forksValid = false;
    }
    // The first choice fork must be ALL combat/elite (a forced second fight).
    if (!forks[base + 1].every((n) => n.kind === "combat" || n.kind === "elite")) combatToBoss = false;
  }
  // Count only the forced act bosses (the optional Rift Echo "echo" superboss doesn't count).
  for (const f of forks) for (const n of f) if (n.kind === "boss" && n.bossKind !== "echo") bossCount++;

  // The pre-boss fork (base+2) always OFFERS a rest as one of several options (a choice).
  let actsWithRest = 0;
  for (let act = 0; act < numActs; act++) {
    const f = forks[act * 4 + 2];
    if (f.length >= 2 && f.some((n) => n.kind === "rest")) actsWithRest++;
  }
  // No single-node rest fork anywhere (would auto-enter), and never two rest-bearing
  // forks back-to-back.
  let noBackToBackHeal = true;
  let prevHadRest = false;
  for (const f of forks) {
    if (f.length === 1 && f[0].kind === "rest") restAlwaysChoice = false; // a lone rest = auto-rail
    const hasRest = f.some((n) => n.kind === "rest");
    if (hasRest && prevHadRest) noBackToBackHeal = false;
    prevHadRest = hasRest;
  }

  // Depth 4 (D4) must force an elite option in each act (stepIdx 1 = choice fork base+2)
  const d4 = generatePlan(777, 4);
  const d4Acts = d4.forks.length / 4;
  let forcedElite = 0;
  for (let act = 0; act < d4Acts; act++) {
    if (d4.forks[act * 4 + 2].some((n) => n.kind === "elite")) forcedElite++;
  }

  // All node ids unique
  const ids = forks.flat().map((n) => n.id);
  const uniqueIds = new Set(ids).size === ids.length;

  return { deterministic, different, forkCount, numActs, entryCombat, bossLast, forksValid, actsEndBoss, bossCount, actsWithRest, forcedElite, d4Acts, uniqueIds, combatToBoss, restAlwaysChoice, noBackToBackHeal };
});

check("deterministic (same seed+depth ⇒ same plan)", r.deterministic);
check("different seed ⇒ different plan", r.different);
check("20 forks (5 acts × 4)", r.forkCount === 20, `got ${r.forkCount}`);
check("each act starts with a forced combat", r.entryCombat);
check("each act ends with a forced boss", r.bossLast && r.actsEndBoss === r.numActs, `${r.actsEndBoss}/${r.numActs}`);
check("one boss node per act", r.bossCount === r.numActs, `got ${r.bossCount}`);
check("choice forks have 2-3 options, ≥1 combat/elite", r.forksValid);
check("pre-boss fork always OFFERS a rest choice (heal + hone)", r.actsWithRest === r.numActs, `${r.actsWithRest}/${r.numActs}`);
check("rest is always a choice, never an auto-entered single-node fork", r.restAlwaysChoice);
check("never two rest-bearing forks in a row", r.noBackToBackHeal);
check("first choice fork is combat-only (≥2 fights to boss)", r.combatToBoss);
check("depth 4 forces an elite each act", r.forcedElite === r.d4Acts, `${r.forcedElite}/${r.d4Acts}`);
check("all node ids unique", r.uniqueIds);

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join("\n")}` : "NO CONSOLE ERRORS");
console.log(fail === 0 && errors.length === 0 ? "MAPGEN: ALL PASS" : `MAPGEN: ${fail} FAILURES`);
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
