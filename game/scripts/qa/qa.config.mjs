// Per-game adapter for the general QA doctor (scripts/qa/).
//
// The qa/ core is game-agnostic: it reads EVERYTHING game-specific from this
// file. To port the tester to another game repo, copy scripts/qa/ +
// scripts/lib/guard.cjs + scripts/loop/lib.mjs + scripts/run-suite.mjs +
// scripts/shot-audit.mjs and edit ONLY this config (seam name, scenario names,
// key bindings, budgets).
export default {
  name: "rogue-hero-3",

  // The debug-seam prefix: window.<seam> (wiring hub), window.<seam>debug,
  // window.<seam>perf, window.<seam>state().
  seam: "__rh3",

  // Which existing harness pieces each doctor phase runs.
  phases: {
    suiteQuick: "core",                 // run-suite group for `qa`
    suiteFull: "release",               // run-suite group for `qa --full`
    contactSheet: "shot-contact.mjs",   // writes a fixed-beat PNG set to argv[2]
    flicker: "shot-flicker.mjs",        // the temporal shimmer/blowout gate
    perfQuick: ["smoke-menu-perf.mjs", "smoke-perf.mjs"],
    perfFull: ["perf-bench.mjs"],       // full battery, diffs baseline.json
  },

  // Seeded chaos bot (qa/chaos.mjs): random real inputs under spawn pressure,
  // with invariant oracles polled the whole time.
  chaos: {
    seconds: 45,
    seed: 20260707,
    bounds: 46,          // |x|,|z| must stay inside this (arena disc + margin)
    maxEnemies: 18,      // spawn pressure ceiling (sanity oracle trips at 200)
    spawnEveryMs: 2500,
    spawnKinds: ["husk", "caster", "leaper", "brute"],
    moveKeys: ["KeyW", "KeyA", "KeyS", "KeyD"],
    actionKeys: ["Space", "Digit1", "Digit2", "Digit3", "ShiftLeft"],
    healEveryMs: 3000,   // hp top-up keeps the run alive WITHOUT god-mode, so
                         // the real damage pipeline stays under test
  },

  // Collision-truth oracle (qa/collision-truth.mjs): the render scene and the
  // collider set must agree about where solid matter is. Audits these staged
  // scenes; ≥1 must roll obstacles or the walk-through direction goes untested.
  collision: {
    scenes: ["room:combat", "room:elite", "boss:warden"],
    settleMs: 2500,
  },

  // Temporal gate (qa/temporal.mjs): frozen-pair shimmer/z-speckle + a fixed-tick
  // motion clip swept by ffmpeg no-reference filters (freeze/pop/black/blowout) + CAMBI.
  temporal: {
    scenes: ["room:combat", "boss:warden"],
    frames: 32, dt: 1 / 30, stepPerFrame: 2, settleMs: 2200,
    shimmerGate: 1.0, scdGate: 12, cambiWarn: 1.0,
  },

  // Blind comprehension probe (qa/comprehend.mjs): articulability gate over flow()
  // + context-free constrained-choice reads of raw frames, scored vs flow(). Judged
  // via the claude CLI on a cheap model; frames go out under neutral paths.
  comprehension: {
    beats: ["menu", "room:combat", "boss:warden"],
    model: "haiku",
    warnBelow: 0.5,
  },

  // CLIP look-bible drift (qa/style-drift.mjs): reference-based aesthetic drift vs
  // shots/anchors/ (re-bake with qa:style-bake). WARN-only, delta vs the saved
  // per-scene baseline; absolute values are meaningless (research), deltas trend.
  styleDrift: {
    scenes: ["menu", "room:combat", "room:elite", "boss:warden", "boss:colossus", "victory"],
    deadband: 0.04, settleMs: 2000,
  },

  // Pixel-UI lint (qa/pixel-ui.mjs): the compositing residual DOM auditUI cant see
  // — HUD text contrast vs the REAL framebuffer + duplicate/ghost-widget pHash.
  pixelUi: {
    scenes: ["room:combat", "boss:warden", "room:elite"],
    minContrast: 3.0, dupHamming: 6, settleMs: 1800,
  },

  // Tutorial / FTUE oracle (qa/tutorial.mjs): completability + the required-but-
  // never-taught gap. requiredVerbs = the verbs a real run demands; the tutorial
  // teaches only move/attack/dodge/card/crash, so the rest is the reported gap.
  tutorial: {
    requiredVerbs: ["move", "attack", "dodge", "card", "crash", "perfectdodge", "draft", "hone", "relic", "shop", "shield", "tempo"],
    stepBudgetFrames: 240,
  },

  // Event-coverage matrix: emits counted by the typed bus (debug.coverage()).
  // Anything required that never fired during chaos+suite = untested content.
  coverage: {
    required: ["ENEMY_HIT", "KILL", "CARD_CAST", "PLAYER_HIT", "TEMPO_ZONE", "ROOM_START", "DODGE"],
  },

  // Per-id content coverage (content-coverage.mjs): every enemy kind must
  // spawn+die (KILL.kind); every card is cast via caster.cast (CARD_CAST.id).
  contentCoverage: {
    enemyKinds: ["husk", "spitter", "swarmer", "bomber", "sentinel", "wisp", "leaper",
      "tether", "mirror", "caster", "shade", "bastion", "brute", "harrier", "splitter", "voidling", "warper"],
  },

  // Difficulty-ladder invariants (balance.mjs): monotonic non-decreasing, bounded
  // per depth step, heals never zeroed.
  balance: { maxStepMult: 0.6, minHeal: 0.05 },

  // Save/replay determinism (save-determinism.mjs): plan-purity seeds + the
  // resume-reseed source guard.
  saveDeterminism: { seeds: [1234567, 987654321, 42] },

  // Flow-graph completability (state-graph.mjs): grid size + catalogs.
  stateGraph: {
    seeds: 40,
    nodeKinds: ["combat", "elite", "shop", "treasure", "rest", "event", "shrine", "gamble", "boss"],
    bossOrder: ["warden", "spire", "colossus", "tyrant", "unmaker"], // echo/wound are gated add-ons
  },

  // Photosensitivity / WCAG 2.3.1 flash-rate (photosensitivity.mjs).
  photosensitivity: {
    gridN: 20, frames: 78, dt: 1 / 60, fps: 60,
    swing: 0.1, darkMax: 0.8, redSwing: 0.12, flashesPerSec: 3, areaFrac: 0.25,
  },

  // Colorblind / CVD distinguishability (colorblind.mjs): min redmean distance
  // below which two simulated zone colors read as one.
  colorblind: { minDistinct: 45 },

  // Input-latency feel budget (latency.mjs).
  latency: { gateMs: 100, maxFrames: 30, fps: 60 },

  // AI judge (qa/judge.mjs): binary per-criterion verdicts over the contact
  // sheet + a stepper-driven combat filmstrip.
  judge: {
    shotsDir: "shots/contact",
    filmstrip: { setup: "room:combat", frames: 9, stepPerTile: 4, dt: 1 / 30 },
    // The five global criteria mirror ai-look.mjs; per-beat extras keyed by
    // filename prefix.
    beatNotes: {
      "01-menu": "Title screen: title + buttons only, readable, no gameplay leakage.",
      "06-enemy": "Enemy portrait: distinct silhouette, materials read at gameplay distance.",
      "08-boss": "Boss: reads as imposing; boss HP bar at top of screen, never above the head.",
    },
  },

  perfBudget: {
    // Read from <seam>perf.report() after chaos as a coarse regression tripwire
    // (the real gates live in smoke-perf / perf-bench).
    maxDrawCalls: 1200,
    maxPrograms: 220,
  },
};
