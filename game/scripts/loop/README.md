# Self-iterating improvement loop

A closed feedback loop that drives the game toward a set of measurable goals,
using **screenshots as the visual source of truth** and **state assertions as the
logical source of truth**. Each cycle:

```
capture ─▶ logic ─▶ observe ─▶ DECIDE ─▶ implement ─▶ build-gate ─▶ re-verify ─▶ (next cycle)
 shots     asserts   AI judge   met?      AI edit      tsc+build     re-run
```

The loop keeps iterating until **every goal is met** (or a budget cap is hit). A
goal counts as met only when *all the signals it declares* pass — and visual
goals always pair their AI screenshot verdict with a logical capture-guard, so a
good-looking screenshot taken in the wrong state can never pass on looks alone.

## Run it

```bash
cd game
npm run loop                 # full loop, default budget (6 cycles / 120 min)
npm run loop -- --max-cycles 3 --max-minutes 45
npm run loop -- --no-implement   # assess + report only, make no code changes
npm run loop -- --reset      # wipe prior artifacts and start clean
```

The orchestrator manages the dev server itself (reuses one already on :5174, or
starts and later stops its own). The only prerequisite is the Playwright Chromium
the other smokes use (`%LOCALAPPDATA%\ms-playwright\chromium-1217`).

### Run a single stage by hand

```bash
npm run dev                                  # in another terminal
node scripts/loop/capture.mjs  --out artifacts/loop/cycles/manual
node scripts/loop/logic-tests.mjs --out artifacts/loop/cycles/manual
node scripts/loop/observe.mjs  --out artifacts/loop/cycles/manual   # calls `claude -p`
```

## The stages

| File | Stage | What it does |
|---|---|---|
| `goals.mjs` | — | The objective goals + their pass/fail criteria (visual rubric, logical assert, capture guard). **Add goals here; nothing else changes.** |
| `capture.mjs` | Capture | Scripted play-through; screenshots each meaningful step (`shots/*.png` + `manifest.json`) and records a rich state `trace.json` incl. deterministic probes (damage, kills, tempo, death, victory). |
| `logic-tests.mjs` | Verify (logical) | Evaluates each goal's `assert` + `guard` against `trace.json` → `logic.json`. |
| `observe.mjs` | Observe | Feeds screenshots + rubrics + logic to `claude -p`; the AI judges every visual goal from the images and proposes the single best next change → `observe.json`. |
| `implement.mjs` | Implement | Applies that proposal via headless Claude with edit tools; records the exact cycle diff + git base → `implement.json` / `cycle.patch`. |
| `orchestrate.mjs` | Loop | Ties it together: decide, build-gate (`npm run verify`), re-verify, per-cycle reports, budget, resume. |
| `lib.mjs` | — | Shared harness: paths, atomic JSON IO, browser, dev-server lifecycle, git snapshot/revert, `runClaude`, scenario nav (`enterRun`/`gotoScenario`), and perf helpers (`samplePerf`/`perfReport`/`assertBudget`). |
| `lag-hunt.mjs` | — | Drives every gameplay event and flags first-time synchronous shader compiles (`npm run perf:lag-hunt`). |

## Standalone perf + AI-visual tools (share `lib.mjs`)

Outside the loop, the same harness backs three tools — see the project `CLAUDE.md`
"Performance + AI-visual harness" section for the full rundown:

- `npm run perf:bench` / `perf:baseline` — `scripts/perf-bench.mjs`: scenario battery + baseline regression diff (measure an optimization).
- `npm run visual:diff -- <A> <B>` — `scripts/visual-diff.mjs`: PNG/dir pixel-diff + heatmaps.
- `npm run ai:look -- <scenario> "<q>"` — `scripts/ai-look.mjs`: on-demand `claude -p` visual+perf critique of one frame.

These read the in-engine `window.__rh3perf` instrument (`src/debug/perfMonitor.ts`);
`npm run smoke:perf-instrument` guards that hook's contract.

## Outputs (all under `game/artifacts/loop/`, git-ignored)

```
state.json                 loop state — resume reads this; written after every phase
REPORT.md                  rollup across all cycles
cycles/<n>/
  shots/*.png              the screenshots (visual evidence)
  manifest.json            what each shot shows
  trace.json               full state trace + probe results
  logic.json               logical assert + guard results
  observe.json             AI visual verdicts + the proposal
  implement.json           what changed + git base (for revert)
  cycle.patch              this cycle's diff
  after/                   post-change re-verify capture + logic
  report.md                the per-cycle report (scoreboard + change + screenshots)
```

## Safety & resume

- **No corruption:** every artifact is written atomically (temp + rename); state
  is persisted after each phase.
- **Surgical revert:** if a cycle's edit breaks `tsc`/`vite build`, only *that
  cycle's own diff* is reverted (`git apply -R` against a per-cycle snapshot
  base) — your pre-existing working-tree changes are untouched.
- **Crash recovery:** on restart, an interrupted `implement` is rolled back via
  its recorded base and the cycle is redone.
- **Budgeted:** stops at `--max-cycles` or `--max-minutes`, whichever first.

## Verification model (two independent signals)

Within a cycle, a code change is confirmed two ways, exactly as the goal demands:

- **Visual:** the change's effect is re-captured into `after/shots/*.png`, and the
  AI re-judges those images at the **start of the next cycle** (that cycle's
  `observe` is the visual verification of the prior change).
- **Logical:** `after/logic.json` re-asserts the targeted goal's guard + logic
  immediately, and console-error count is re-checked.

Both must pass for the goal to flip to "met" in the scoreboard.
