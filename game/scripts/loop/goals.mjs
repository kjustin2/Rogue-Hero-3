// Objective goals for the improvement loop.
//
// Each goal carries up to two INDEPENDENT signals:
//   • visual  — `shots` + `rubric`, judged by the AI from screenshots (observe.mjs)
//   • logical — `assert`/`guard`, evaluated from the captured trace (logic-tests.mjs)
//
// A goal is "met" only when EVERY signal it declares passes (see isMet). Visual
// goals also carry a logical `guard` so a green-looking screenshot taken in the
// wrong state (e.g. an empty arena) can never pass on looks alone — that pairing
// is the "two independent signals" contract.
//
// To extend the loop, add a goal here. Nothing else needs to change.

const step = (trace, key) => (trace.steps || []).find((s) => s.key === key);
const stateAt = (trace, key) => step(trace, key)?.state ?? null;

// value→zone bands must match src/game/tempo.ts ZONES
const zoneFor = (v) => (v >= 90 ? "critical" : v >= 70 ? "hot" : v >= 30 ? "flowing" : "cold");

export const GOALS = [
  // ───────────────────────────── visual (+ logical guard) ─────────────────
  {
    id: "menu-polish",
    title: "Main menu is polished and legible",
    shots: ["main-menu"],
    rubric:
      "The main menu looks like a finished commercial game: the game title is "
      + "clearly visible and crisp, primary buttons (Begin/New Run, Continue, "
      + "etc.) are readable with good contrast, and the 3D backdrop is rendered "
      + "(NOT a black, blank, or crushed-to-near-black canvas). FAIL if text is "
      + "unreadable, the canvas is black/empty, or it looks like a debug screen.",
    guard: (t) => {
      const s = stateAt(t, "main-menu");
      return { pass: s?.ui === "menu", detail: `ui=${s?.ui}` };
    },
  },
  {
    id: "hero-select-clarity",
    title: "Hero select reads as a roster of distinct characters",
    shots: ["hero-select"],
    rubric:
      "The hero-select screen presents multiple distinct hero options that are "
      + "visually distinguishable from one another (silhouette/art/name/stats), "
      + "and the currently focused hero is clearly highlighted. FAIL if heroes "
      + "are indistinguishable, info is unreadable, or the layout looks broken.",
    guard: (t) => {
      const s = stateAt(t, "hero-select");
      const n = s?.heroCardCount ?? 0;
      return { pass: n >= 2, detail: `heroCards=${n}` };
    },
  },
  {
    id: "combat-focus",
    title: "Combat keeps the hero and threats readable",
    shots: ["combat", "combat-action"],
    rubric:
      "In active combat the player hero is a clear focal element and enemies are "
      + "individually distinguishable as threats. Floor rings, telegraphs and "
      + "particle FX add readability without washing out the characters into an "
      + "indistinct glow. FAIL if you cannot tell where the hero is, enemies "
      + "blend into the floor, or effects dominate the frame.",
    guard: (t) => {
      const s = stateAt(t, "combat");
      const ok = !!s && s.enemyCount >= 2 && s.player?.alive === true;
      return { pass: ok, detail: `enemies=${s?.enemyCount} alive=${s?.player?.alive}` };
    },
  },
  {
    id: "hud-tempo-critical",
    title: "The HUD makes the Critical Tempo state unmistakable",
    shots: ["tempo-critical"],
    rubric:
      "The Tempo/flow meter on the HUD clearly communicates that the player is in "
      + "the CRITICAL zone (distinct color, label, or charged styling) — a player "
      + "would instantly know they are in the highest-power state. FAIL if the "
      + "Critical state looks the same as the calm/cold state.",
    guard: (t) => {
      const s = stateAt(t, "tempo-critical");
      const v = s?.tempo?.value ?? 0;
      return { pass: v >= 90 && s?.tempo?.zone === "critical", detail: `tempo=${Math.round(v)} zone=${s?.tempo?.zone}` };
    },
  },
  {
    id: "boss-presence",
    title: "Bosses read as imposing, named threats",
    shots: ["boss"],
    rubric:
      "The boss is visually distinct and imposing relative to normal enemies and "
      + "has a clearly readable boss health bar / name banner. FAIL if the boss is "
      + "indistinguishable from a normal enemy or has no readable health UI.",
    guard: (t) => {
      const s = stateAt(t, "boss");
      return { pass: !!s && s.bossPresent === true, detail: `bossPresent=${s?.bossPresent} enemies=${s?.enemyCount}` };
    },
  },
  {
    id: "endscreen-victory",
    title: "Victory screen clearly communicates the outcome + recap",
    shots: ["victory"],
    rubric:
      "The end screen unambiguously reads as a VICTORY and surfaces a run recap "
      + "(stats such as kills, time, depth, or shards). FAIL if the outcome is "
      + "ambiguous or there is no recap of how the run went.",
    guard: (t) => {
      const s = stateAt(t, "victory");
      return { pass: s?.ui === "victory", detail: `ui=${s?.ui}` };
    },
  },

  // ─────────────────────────────────── logical only ───────────────────────
  {
    id: "no-console-errors",
    title: "A full play-through produces no console errors",
    assert: (t) => {
      const n = (t.consoleErrors || []).length;
      return { pass: n === 0, detail: n ? `${n} error(s): ${t.consoleErrors.slice(0, 3).join(" | ")}` : "clean" };
    },
  },
  {
    id: "damage-reduces-enemy-hp",
    title: "Player damage reduces enemy HP through the real pipeline",
    assert: (t) => {
      const p = t.probes?.damage;
      if (!p) return { pass: false, detail: "no damage probe" };
      return { pass: p.ok === true, detail: `before=${p.before} after=${p.after} dealt~${p.dealt}` };
    },
  },
  {
    id: "kill-increments-stats",
    title: "Killing enemies increments the run kill counter",
    assert: (t) => {
      const p = t.probes?.kills;
      if (!p) return { pass: false, detail: "no kill probe" };
      return { pass: p.ok === true, detail: `killsBefore=${p.before} killsAfter=${p.after} killed=${p.killed}` };
    },
  },
  {
    id: "tempo-zones-progress",
    title: "Tempo value and zone label stay consistent across the meter",
    assert: (t) => {
      const samples = t.probes?.tempo?.samples || [];
      if (samples.length < 3) return { pass: false, detail: `only ${samples.length} samples` };
      const bad = samples.filter((s) => s.zone !== zoneFor(s.value));
      const zonesSeen = new Set(samples.map((s) => s.zone));
      const ok = bad.length === 0 && zonesSeen.has("critical") && zonesSeen.has("cold");
      return {
        pass: ok,
        detail: bad.length ? `${bad.length} mismatched (e.g. v=${bad[0].value} zone=${bad[0].zone})`
          : `zones=${[...zonesSeen].join(",")}`,
      };
    },
  },
  {
    id: "lethal-damage-kills-player",
    title: "Lethal damage ends the run (player dies, state leaves play)",
    assert: (t) => {
      const p = t.probes?.death;
      if (!p) return { pass: false, detail: "no death probe" };
      const ok = p.aliveBefore === true && p.aliveAfter === false && (p.uiAfter === "dead" || p.uiAfter === "cutscene");
      return { pass: ok, detail: `alive ${p.aliveBefore}→${p.aliveAfter} ui=${p.uiAfter}` };
    },
  },
  {
    id: "victory-reachable",
    title: "The scripted flow can reach a victory state",
    assert: (t) => {
      const p = t.probes?.victory;
      return { pass: p?.reached === true, detail: `reached=${p?.reached}` };
    },
  },
];

/** A goal is met when every signal it declares passed. */
export function isMet(goal, { visual, guard, logic }) {
  const checks = [];
  if (goal.rubric) checks.push(visual?.pass === true);
  if (goal.guard) checks.push(guard?.pass === true);
  if (goal.assert) checks.push(logic?.pass === true);
  return checks.length > 0 && checks.every(Boolean);
}

export function goalById(id) { return GOALS.find((g) => g.id === id); }
