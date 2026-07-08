# Rogue Hero 3 — Project Guide

Single-player 3D action roguelike on **Three.js** (the June 2026 ground-up rebuild; the old Babylon.js v1 was removed). Vite + strict TypeScript, ships as an Electron desktop app. The shape: pick a data-driven hero, fight through 5 acts on a seeded forked-path map (combat/elite/shop/treasure/rest/event nodes, each act capped by a boss, plus a superboss), drafting cards and relics as you go. The signature **Tempo** meter (`game/tempo.ts`) drives damage/speed by zone (Crescendo, Perfect Crash); an Ascension "Rift Depth" ladder (`game/difficulty.ts`) stacks difficulty; the finale offers a **mercy / true ending**. Meta-progression + cosmetics, per-act soundtrack, full gamepad support, Training Grounds tutorial. **Don't trust content counts written in prose — the data catalogs are the source of truth**: `game/heroes.ts`, `game/cards.ts`, `game/relics.ts`, `game/enemies*.ts`, `game/affixes.ts`, and the `BOSSES` registry in `game/run.ts`.

## Layout

| Path | Notes |
|---|---|
| `game/` | **All source.** Vite config, scripts, package.json |
| `game/src/` | Game code (see Architecture) |
| `game/electron-main.cjs` | Electron entry — serves `dist/` over a loopback HTTP server (file:// breaks Vite asset paths); loads `preload.cjs` + registers the native-display IPC |
| `game/preload.cjs` / `game/electron-ipc.cjs` | Native **Display** bridge: `preload.cjs` exposes `window.rh3native` (sandbox-safe contextBridge); `electron-ipc.cjs` holds the shared `ipcMain` handlers (true fullscreen, exact-resolution window resize, display info), reused by the prod entry **and** `smoke-display-electron.cjs` so the smoke tests the real handlers |
| `game/scripts/` | Headless-browser smoke tests |
| `start.bat` | One-click Windows launcher (install → build → Electron window) |

**Working-directory friction**: Claude is invoked at the repo root, but `package.json` lives in `game/`. Wrap npm commands as `(cd /e/Storage/SAAS/Rogue-Hero-3/game && npm run …)`.

## Verify

```bash
npm run verify     # tsc --noEmit && vite build (~10s)
```

**Stop dev servers before ending the turn** — the owner only tests via the standalone build
(`start.bat` / `npm run standalone` / the exe). Never hand back with `npm run dev` running; kill the
process tree (`taskkill /T`) so no orphan squats the port or serves stale code to the next smoke.

### Test-run governor (HARD RULE — a test run once froze the whole machine)

Every test script runs under `scripts/lib/guard.cjs`: a hard wall-clock **watchdog**, a
**machine-wide lock** (one guarded test at a time, `%TEMP%/game-test-guard.lock`), a **low-memory
sentinel** (aborts below ~1.5GB free), **below-normal priority**, and **child-tree cleanup** on
every exit path. Electron harnesses also wire `guardWindow(win)` so a hung/dead renderer ABORTS
instead of blocking `executeJavaScript` forever with a GPU-pegged window open (the 2026-07-05
freeze class). Rules:

- **NEVER run two test scripts in parallel** (no parallel agents each launching smokes, no `&`
  fan-out). The lock enforces it — a second run waits, then exits 4. One GPU, one CPU pool.
- New test scripts must init the guard: `import { guard } from "./lib/guard.cjs"; guard();`
  (importing `loop/lib.mjs` does it automatically). Long runners pass `{ maxMinutes }`.
- Prefer `npm run suite` / `smoke:core` over hand-chaining scripts — the runner adds per-script
  timeouts, kills hung children, audits fresh screenshots, and writes `artifacts/suite/SUITE.md`.
- Real-GPU stress (`perf:soak`, `glitch-hunt`) has mode-scaled budgets; never strip them.

### The QA doctor — one command, one health card

```bash
npm run qa          # quick sweep: build → core smokes → chaos bot → contact-sheet gates → perf smokes
npm run qa:full     # + full fleet, flicker gate, perf bench vs baseline, AI judge
npm run qa:chaos    # seeded chaos bot alone (--seconds N --seed N)
npm run qa:judge    # AI visual judge alone (contact sheet + stepper filmstrip; costs one claude call)
```

`scripts/qa/qa-run.mjs` sweeps every health dimension through the existing guarded harness and
writes ONE artifact — **`artifacts/qa/QA.md` + `qa.json`**: build / functional (suite) / stability
(chaos oracles: NaN, out-of-bounds, HP-range, stuck-while-moving, no-progress, frame errors,
scene-graph NaN) / coverage (required `EventMap` events that never fired = untested content) /
visual (fresh contact sheet + BLACK/BLOWOUT/FLAT/DUP gates) / glitch (flicker, full mode) / perf /
runtime (frame-error ring, programs-flat-after-warm-up, draw-call tripwires) / judge (binary
per-criterion AI verdicts + ranked issues with suggested fixes). Read that file first when asked
"what's broken" — it is the fix-next list. **The qa/ core is game-agnostic**: everything
RH3-specific lives in `scripts/qa/qa.config.mjs`; to port the tester to another game repo copy
`scripts/qa/ + scripts/lib/guard.cjs + scripts/loop/lib.mjs + scripts/run-suite.mjs +
scripts/shot-audit.mjs` and edit only the config.

### The perception dimensions (2026-07-07 — all fault-injection PROVEN via `qa:selftest`)

Four new deterministic senses run inside `npm run qa` (doctrine + portable recipes:
/game-perception). Every one ships `--selftest`: inject the exact defect → must FIRE; clean
build → must stay QUIET. `npm run qa:selftest` sweeps them; `qa:full` includes the sweep.

- **collision-truth** (`qa:collision`) — render geometry ↔ collider set correspondence.
  Meshes carry `userData.solidity` ("solid"|"ground"|"nonsolid"|"mover"|"fx") on themselves
  or an ancestor — tag GROUP ROOTS at creation; an UNCLASSIFIED in-reach mesh is a FINDING
  (a new prop with no tag and no collider is exactly the walk-through bug). UNCOVERED =
  solid footprint no circle covers (walk-through); PHANTOM = circle with no solid mesh
  (invisible wall). Audit uses `Box3.setFromObject(m, true)` — the loose AABB of a rotated
  pillar manufactures phantom findings.
- **reachability** (`qa:reach`) — player-radius flood-fill over `world()`: passable-but-
  unreached pockets FAIL; collider pairs with a gap in (0, 2R) WARN (looks passable, isn't).
- **temporal** (`qa:temporal`) — frozen-pair gates measured on the GL CANVAS ONLY
  (`tick()` + `gl.readPixels` same-task; page screenshots composite DOM CSS animations —
  card shine once read as 3918px of fake z-fighting). Age the freeze 3 ticks (one-frame
  settle logic) and the stage ~60 frames + 1s (entrance FX). SHIMMER = frozen-pair MAE > 1.0
  (clean 0.0–0.15); Z-SPECKLE = few+isolated diff pixels (depth-tie/sort instability). On a
  finding it AUTO-BISECTS through `__rh3fx.setOne` and names the owner; fired-then-quiet =
  TRANSIENT → WARN (timed content or wall-clock FX). Motion clips swept by ffmpeg
  (freezedetect duration-fraction, scdet pops, signalstats black/flat/blowout, entropy) +
  CAMBI banding (clean ~0.001–0.05, WARN > 1.0). FROZEN gates on in-page motionEnergy < 0.5
  (healthy clips 4.9–11.6; a frozen world with DOM CSS still animating reads ~0.09).
- **animation** (`qa:animation`) — from `recordMotion()`: FOOT-SKATE = contact-phase foot
  slide per meter (contact = foot at its own height minimum; the lift signal alone
  over-counts back-swing as planted — 1.34 vs the true 0.12). Gates: skate/m 0.35 (clean
  0.12, drag-fault 1.1), jitter 60 m/s² (clean ~5, jolt-fault ~350), SPARC advisory. Drive
  starts from the arena centre — blocked-walking poisons the ratio.

**HARD RULE (found by the temporal gate, 2 shipped instances fixed): no private
`requestAnimationFrame` / wall-clock animation loops in game code** — they defeat
`freezeForTest`/`frames(n,dt)` and make every capture nondeterministic (the dodge-ghost +
lightning-line fades did exactly this). All motion consumes the threaded dt.

QA seam (in `main.ts` `__rh3debug`): **`frames(n, dt)`** deterministic stepper (exact sim frames —
never wall-wait the headless clock), `tick(dt)`, **`frameErrors()`** (capped ring the frame-loop
catch feeds — must stay EMPTY; a loop that survives a throwing frame otherwise looks healthy),
**`coverage()`** (per-event emit counts from the typed bus), **`world()`** (arena radius / player radius / collider circles — oracles read constants off the seam), **`flow()`** ({screen, goal, nextAction} — the articulability + comprehension ground truth), **`collisionAudit()`**, **`recordMotion()/motion()`** (the animation-metrics ring), **`sceneCheck()`** (world-matrix NaN
scan + finite scene bounds + renderer.info gauges), **`contextLost()`**. The game also ships a
**WebGL context-loss watchdog**: on restore it re-warms both composer paths (the program cache is
dropped on restore — without re-warm the compile-hitch class returns); if no restore in 10s it
reloads (lossless: fixed origin + checkpoint saves). Probe: `node scripts/smoke-context-loss.mjs`.

**Rasterizer facts (measured 2026-07-07):** headless Playwright Chromium on this machine renders
on the REAL GPU (`ANGLE (NVIDIA RTX 5070 Ti) D3D11`), not SwiftShader — `bootGame` logs
`GL_RENDERER` at every boot, contact sheets stamp it into `_renderer.json`, and `visual:diff`
REFUSES to compare across different rasterizer stamps (keep separate baselines per renderer).
`visual:diff` also supports `--downscale 2` (three.js's supersample-then-box-filter trick — kills
sub-pixel edge-crawl noise so tight thresholds hold), `--mask "x,y,w,h;…"` for dynamic HUD
regions, `--blur N`, and `--fail-mad` (mean-abs-delta gate that catches slow washout drift).

### The suite runner + screenshot gate

```bash
npm run smoke:core      # the 6 high-signal smokes, serial + timeboxed (per-round loop)
npm run smoke:all       # every smoke-*.mjs
npm run smoke:release   # full fleet incl. visual + Electron families (release passes)
npm run suite -- <names…|core|visual|electron|all|release>
npm run shots:audit     # objective gates over shots/: BLACK / BLOWOUT / FLAT / TINY / DUP / STALE
```

`run-suite.mjs` starts/stops the dev server itself, runs everything **sequentially**, tree-kills
any script past its budget, then runs `shot-audit.mjs` over every screenshot the run produced
(stale files are excluded evidence, not failures) and writes `artifacts/suite/summary.json` +
`SUITE.md` — read that one artifact to see the whole round's health. The loop's capture stage
stamps the same gates into `manifest.json` (`audit: ["BLACK"]…`) so the AI judge never wastes a
verdict on a dead frame, and `artifacts/loop/LEARNINGS.md` is the loop's append-only regression
memory (observe reads it to avoid re-proposing failed changes).

For visual/behavioral checks, run the dev server (`npm run dev`, port 5174) and:

```bash
node scripts/smoke-browser.mjs   # boot, combat input, pause — screenshots into shots/
node scripts/smoke-mapgen.mjs    # map generation: determinism + structural constraints (no UI)
node scripts/smoke-difficulty.mjs# Ascension depth table (multipliers, labels)
node scripts/smoke-flow.mjs      # navigates the generated forked map to victory + a death
node scripts/smoke-map.mjs       # resolves every node kind (shop/treasure/rest/event) to victory
node scripts/smoke-upgrades.mjs  # casts every card base + honed — no dispatch path throws
node scripts/smoke-ascension.mjs # depth picker on hero-select + live enemy-HP/damage scaling
node scripts/smoke-bosses.mjs    # Spire Caster + Colossus across all phases (debugLoadNode)
node scripts/smoke-relic.mjs     # elite node → relic draft → HUD relic row
node scripts/smoke-meta.mjs      # fresh profile → gated drafts → win → unlocks/progress screen (CLEARS the profile)
node scripts/smoke-crash.mjs     # cooldown sweep + crash-radius ring
node scripts/smoke-release.mjs   # hero select, obstacles, v2 save/continue, armory purchase (CLEARS profile)
node scripts/smoke-cutscene.mjs  # story intro + boss entrance cutscene (letterbox, dolly, skip)
node scripts/smoke-interlude.mjs # mid-act causeway: hero FROZEN until the act's words come and go, then may cross (__rh3debug.interlude/interludeLocked)
node scripts/smoke-telegraph.mjs # sentinel beam + boss dash telegraph alignment
node scripts/smoke-shields.mjs   # Bastion/Mirror shields drain + break under damage; flank bypass; freeze tint
node scripts/smoke-counter.mjs   # perfect-dodge COUNTER window: armed strike consumes it + pays tempo
node scripts/smoke-gamepad.mjs   # controller detect (event + poll backstop), "connected" toast, menu nav, stick→move, disconnect
node scripts/smoke-display.mjs   # Display settings: sectioned panel, resolution-scale → pixel ratio, fps-cap persist, fullscreen fallback (browser path)
npm run smoke:display-electron   # NATIVE display bridge in a HIDDEN Electron window: rh3native exposed, getDisplay, exact window resize, fullscreen channel
npm run smoke:save-persist       # SAVE PERSISTENCE: localStorage survives a full Electron restart on the fixed-port origin + static guard on PREFERRED_PORT/packaging
node scripts/smoke-aim.mjs       # gamepad combat: shoulder-button mapping, auto-aim facing, [Y] switch-target lock-on, Start=pause
node scripts/smoke-features.mjs  # map features: spike traps, drifting orbs, sweeping beam — spawn, damage, dispose
node scripts/smoke-ward.mjs      # boss ward/invuln: hits deflected while warded, vulnerable again after, close punish shockwave, raised HP
node scripts/smoke-mercy.mjs     # Unmaker fading phase → hold [Q] to spare → "THE LIGHT ENDURES" true ending
node scripts/smoke-superboss.mjs # Rift Echo encounter across phases (debugLoadNode)
node scripts/smoke-wound.mjs     # THE WOUND BENEATH: reveal after Unmaker (depth 3+), boss tempo strip, card swallow/return, victory
node scripts/smoke-menu-perf.mjs # 3×-throttled CPU: menu/hero-select/settings frame max·p95·longMax. BOOT gates wall-time-to-menu + POST-loader pacing only — frames behind the opaque loader are warm-up by design and vary with the driver shader cache (2026-07-07). Runs keepPriority (timing-gated)
node scripts/smoke-death-perf.mjs# forces HIGH quality, boss room → kills player; asserts the playing→dead flip relinks 0 programs (no freeze)
node scripts/smoke-loop-resilience.mjs # warden entrance plays with boss ALIVE (no crash); the setAnimationLoop guard recovers from an injected frame fault (no permanent freeze)
node scripts/smoke-perf.mjs / smoke-perf-stress.mjs  # combat frame budget under load
node scripts/shot-loader.mjs     # eyeball the boot loading screen (shots/loader-*.png)
```

### Performance + AI-visual harness

A unified instrument + tools for **measuring optimizations** and **letting Claude see frames**:

- **`window.__rh3perf`** (`src/debug/perfMonitor.ts`) — always-on, near-free frame instrument. Reports accurate per-frame **draw calls / triangles / shader programs / geometries / textures / JS heap / live enemies** plus frame-pacing stats (mean/p50/p95/p99/max, long-frame + `over250` stall counts). API: `report()` (rolling window), `start(label)`/`stop()` (explicit window, returns stats + correlated `mark()` events), `snapshot()`, `hud(on?)`. Draw-call counting is accurate (it owns `renderer.info.autoReset` and resets once per frame so the composer's multiple passes sum correctly).
- **On-screen overlay** — `?perf` URL param opens it; **F8** toggles live. Sized to stay legible in a full-frame screenshot, so a single shot carries FPS / draws / programs / state + a frame-time sparkline for Claude to read.
- **`npm run perf:bench`** (`scripts/perf-bench.mjs`) — benchmark battery (menu → combat acts → every boss). Samples standardized perf, screenshots each frame *with the overlay baked in* → `artifacts/perf/shots/`, writes `latest.json`, and **diffs against `baseline.json`**. `npm run perf:baseline` sets the baseline; this is how you prove an optimization helped. Deterministic GPU-load + sync-stall regressions gate the exit code; noisy headless frame-timing is reported but only gates with `--gate-timing`.
- **`npm run perf:lag-hunt`** — drives every event and flags first-time synchronous shader compiles (the hitch class). Headless, so it catches the compile class but not real-GPU GC.
- **`npm run perf:soak`** (`scripts/perf-soak-electron.cjs`) — **the real-GPU lag hunt.** Runs the BUILT game in a *visible-but-unfocused* Electron window (`showInactive` — real frames at full rate, never steals focus; a hidden window throttles to ~1fps and is useless for perf), drives a long realistic battery (every act's combat under heavy load, every boss entrance/phase/fight, all card VFX, interstitials, a 22s sustained soak), and reports every frame spike **classified** as a `compile` (first-use shader → fixable by extending warm-up) or `gc/stall`, attributed to the exact activity. `SOAK=quick|full|deep`. Writes `artifacts/perf/soak.json`. This is what reproduces the player's "random lag spots" that headless SwiftShader hides — and it found Act-2/warden-fight first-use compiles the warm-up was missing. Backed by `__rh3perf.spikes()`/`setSpikeLabel()`/`setSpikeThreshold()` + the always-on console spike classifier (any frame >120ms self-labels compile-vs-GC for live F8 play).
- **`npm run visual:diff -- <A> <B>`** (`scripts/visual-diff.mjs`) — pixel-diffs two PNGs or two shot dirs via a headless canvas (no deps); per-image %changed + heatmap PNGs to `artifacts/visual-diff/`. `--fail <pct>` gates. Catches unintended visual ripples.
- **`npm run ai:look -- <scenario|shot.png> "<question>"`** (`scripts/ai-look.mjs`) — captures a scenario (frames bosses/enemies for the shot) and asks the `claude` CLI to judge it, with the engine's ground-truth perf numbers injected into the prompt. On-demand visual+perf critique.
- **`npm run smoke:perf-instrument`** — regression probe guarding the `__rh3perf` contract.

Shared harness helpers live in `scripts/loop/lib.mjs`: `samplePerf` (uses `__rh3perf`, rAF fallback), `perfReport`, `assertBudget`, `enterRun`, `gotoScenario`. Reuse them — don't re-bolt a rAF probe onto each new perf script.

That list is the high-traffic subset — `scripts/` holds ~40 smokes total (visual-theme, player-animation, enemy-visual, card-visuals, tempo, balance, edge, boss-cutscene/pause families). `package.json` also defines `npm run smoke:*` aliases (`smoke:menu-perf`, `smoke:perf`, `smoke:perf:stress`, `smoke:polish`, `smoke:cards`, `smoke:boss-pause`, `smoke:flicker`) and `npm run smoke` runs the Electron smoke (`smoke-electron.cjs`). **`npm run smoke:flicker`** (`shot-flicker.mjs`) is the MOTION-glitch gate, with TWO classes console-only smokes can't see:
- **SHIMMER (per-frame temporal flicker)** — forces HIGH quality, then `__rh3debug.freezeForTest(true)` freezes the whole world (dt=0) while the full composer keeps rendering, and measures the mean per-channel diff between CONSECUTIVE frames. A frozen deterministic render is pixel-identical (~0.1/255); a per-frame-RANDOM post effect (animated film grain) re-randomizes the framebuffer and spikes it (~2.2 measured). Gate 1.0. This is the class that a 130ms-apart filmstrip is BLIND to — it's what the owner saw as constant shimmer in combat + cutscenes (the pmndrs `NoiseEffect`, since removed). Runs in a combat hold AND a dimmed cutscene hold.
- **BLOWOUT (additive-white screen-fill)** — a camera pan with a forced sweeper hazard + the act-load theme crossfade; FAILS if BRIGHT-DESATURATED pixels (min>190, max−min<45 — catches pale ~200-227 bloom+ACES washouts a strict >235 test misses; saturated FX keep a low min and pass) spike past 2.5%.

Pair with the `visual-qa` agent reading `shots/flicker/` for anything the gates can't catch. **`__rh3debug.freezeForTest(on)`** (world-freeze but keep rendering the full composer) is the general seam for isolating any per-frame-random render effect. **`npm run smoke:core`** chains the 6 highest-signal smokes (browser/flow/upgrades/bosses/shields/counter) for the fast per-round loop; the full fleet stays for release passes.

Targeted smokes jump straight to a node via `window.__rh3.run.debugLoadNode(kind, act)`; flow/map/meta navigate the real fork screens (`.mapnode`).

Both print `NO CONSOLE ERRORS` on success and use the Playwright Chromium cached at `%LOCALAPPDATA%\ms-playwright\chromium-1217` (via `playwright-core`, no browser download). **Read the screenshots** — a clean console with a black canvas is still a failure. Dev builds expose the wiring hub as `window.__rh3` for these scripts.

## Run modes

```bash
cd game
npm run dev          # Vite hot reload at http://localhost:5174
npm run standalone   # build + native Electron window (no browser)
npm run electron     # Electron window from existing dist/
npm run preview      # production bundle in browser at :4173
```

`RH3_DEVTOOLS=1 npm run electron` opens devtools inside the Electron window.

## Architecture

`src/main.ts` wires everything into a shared `Ctx` (`src/game/ctx.ts`) and owns the state machine (`menu | cutscene | playing | paused | draft | dead | victory`) plus the map screen and `boot()` orchestration. Systems hold `ctx` and reach peers through it; `ctx.ts` uses type-only imports so there are no runtime cycles.

| Module | Owns |
|---|---|
| `core/events.ts` | **Typed** EventBus — event names + payloads are compile-checked. New events go in `EventMap`; never raw strings |
| `core/input.ts` | Keys/mouse/**gamepad** with per-frame edge detection; rebindable **action layer** (`actionDown`/`actionPressed`/`moveVector`/`aimDir`); cursor→ground-plane aim. Consumers query actions, never raw codes |
| `render/stage.ts` | Renderer, ACES, **dual composers**: full post chain (bloom/CA/vignette/noise/SMAA + shadows) for combat/cutscene/dead/victory vs. a lean menu composer (vignette+grade, shadows off) via `setLowCost`; `warmUp`/`warmMenu` pre-compile shaders; screen `punch()` |
| `render/cameraRig.ts` | Trauma-based shake (`addTrauma`), directional `kick()`, FOV pulses, menu orbit vs follow |
| `render/arena.ts` | The floating disc arena, sky shader, per-act `THEMES` + `applyTheme` crossfade. The crossfade holds the bright emissives (rim/floor/crystal) DOWN via `xf` (deepest at the start, eases to full) so the rim rotates hue cleanly instead of blowing out to white — gated on `themeChanging` so same-theme room loads don't dip. **No decorative additive light-shafts** (removed — they swept the view as glitchy flicker) |
| `render/particles.ts` | One pooled GPU point cloud for all bursts + shockwave-ring pool + ambient embers |
| `render/telegraphs.ts` | Pooled circle/line attack warnings — every enemy attack must use one |
| `render/floaters.ts` | DOM damage numbers (project once, CSS animates) |
| `render/trail.ts` | `SwordTrail` ribbon behind the blade — CPU-rebuilt quad strip of recent (tip,base) pairs, additive, tinted by blade cosmetic |
| `game/player.ts` | Hero stats + fully procedural mesh + pose layering (dodge > swing > locomotion) |
| `game/controller.ts` | Movement, dodge i-frames, perfect-dodge window, external `push()` impulses |
| `game/combat.ts` | Melee chain, `dealDamage` pipeline (ALL player damage flows through it), `damagePlayer` (returns how it resolved), crash nova |
| `game/projectiles.ts` | Pooled glow-sprite **shots** (player + enemy ranged); travel/pierce/range, hit-id dedupe, shared radial-falloff `CanvasTexture` |
| `game/tempo.ts` | The signature 0–100 flow meter; zones in `ZONES` drive damage/speed/colors; sustaining Critical builds **Crescendo** stacks; **Perfect Crash** at ≥95 (refund handled in `combat.ts`) |
| `game/cards.ts` / `deck.ts` | Card defs + cast handlers + lingering entities (mines/phantoms/meteors/wells/bleeds); 3 slots, cooldowns, unlock-gated drafting. **Honed upgrades**: `deck.upgraded[slot]` → `−30% cd / +50% tempo` plus a per-card bespoke effect (`cast(def, upgraded)` → `dispatch(def, upgraded)`; `CardDef.upDesc`). Honed at Rest nodes |
| `game/enemies.ts` / `enemies2.ts` | Enemy base (HP bars, knockback, freeze, hit-flash, disposal) + registry; base 5 types + Act II/III roster (wisp/leaper/tether/mirror/caster/shade/bastion) + Act IV (brute/harrier/splitter) + Act V (voidling/warper) |
| `game/boss.ts` / `bossSpire.ts` / `bossColossus.ts` / `bossTyrant.ts` / `bossUnmaker.ts` / `bossEcho.ts` | Pit Warden, Spire Caster (echo lances), Colossus (tectonic ring slams), Rift Tyrant (rift-engine, Act IV), the **Unmaker** (Hollow Star finale + mercy ending), the **Rift Echo** superboss (your sharpened reflection), and **The Wound Beneath** (`bossWound.ts`, Ascension true-final) — multi-phase; registry in `run.ts` `BOSSES` |
| `game/relics.ts` | Passive relics; hook surface consulted by combat/tempo/deck/run pipelines |
| `game/blessings.ts` / `cosmetics.ts` | Run-start **blessing** gifts (milestone-unlocked, shared by hero-select UI + profile resolver) and shard-bought **cosmetics** (cape cloth + blade-energy colors; blade tint also drives sword trail/slash arcs) |
| `game/profile.ts` | localStorage meta-progression: lifetime stats, `MILESTONES` unlock table, run history |
| `game/run.ts` | `RunManager` drives the generated forked-path plan: `forkOptions`/`select`/`loadCurrentNode`/`proceed`; combat/elite/boss nodes fight in the arena, `main.ts` owns the map screen + interstitial nodes. Emits the same ROOM_START/ROOM_CLEARED/ACT_START/BOSS_INTRO/RUN_VICTORY events. `debugLoadNode(kind, act)` jumps for tests |
| `game/mapgen.ts` | Seeded forked-map generation: `generatePlan(seed, depth)` → forks of `MapNode`s; per-act enemy pools + `generateWaves`. Deterministic (own `Rng(seed)`) so resume + dailies reproduce |
| `game/difficulty.ts` | Ascension ladder: `difficultyFor(depth)` → cumulative modifiers (enemy HP/damage, fewer heals, extra elites, boss HP). Hooked at the enemy-spawn choke, `Combat.damagePlayer`, and run heals |
| `game/features.ts` | `MapFeatures` — per-node arena mechanics (damaging rift **hazard** patches, **teleporter** pad pairs) assigned by `mapgen` (`MapNode.feature`); `setup`/`update`/`clear` wired in `run.ts` + the loop |
| `game/tutorial.ts` | Event-driven Training Grounds — staged objectives that advance as the player performs each verb |
| `ui/hud.ts` / `menus.ts` / `style.css` | DOM HUD + every overlay screen — the professional look lives in the CSS |
| `audio/sfx.ts` | Procedural Web Audio SFX — every sound synthesized, no asset files |
| `audio/music.ts` | Streaming/crossfading soundtrack (`Music`) — bespoke per-act tracks in `public/music/` (`menu`, `tutorial`, `set{act}` battle beds, `boss{act}` boss themes), ducking, low-HP tension swell, and a `musicLament` quiet held through the final fade |

## Conventions & invariants

- **Strict TS** (`noUnusedLocals`, `noUnusedParameters`). No escape hatches.
- **Events are typed** — extend `EventMap` in `core/events.ts`; a typo'd name is a compile error by design.
- **All player-sourced damage goes through `Combat.dealDamage`** (tempo multiplier, floaters, sparks, stats). All incoming damage through `Combat.damagePlayer` (perfect-dodge interception, shields).
- **Every enemy attack telegraphs** via `ctx.tele` — readable threat windows are the fairness contract.
- **No hitstop** — combat never time-scales on impact. Use `cam.addTrauma`/`kick` + `stage.punch` instead.
- **No asset files, except music** — meshes are procedural primitives, *SFX* are synthesized, textures are canvas-painted. Keep it that way. The one exception: the **soundtrack** lives as streamed MP3s in `game/public/music/` and is played via `audio/music.ts`. SFX stays procedural.
- **Dispose what you create** — enemies own their geometries/materials and release them in `dispose()`; anything added straight to the scene needs explicit cleanup (see `RunManager.loadRoom` clears).
- **Tempo changes go through `tempo.gain/drain/crash`** — never assign `tempo.value` directly (zone-change events would be skipped). The cold-crash latch in `combat.ts` is the one exception.
- **Dash Strike is a commitment, not a coin flip** — it grants i-frames through the dash (`controller.grantIframes`) and a generous contact window along the path (`cards.ts` `dispatch`). Keep both when touching it.
- **Story/boss/act text dwell** = base reading time + ~2s + ~1.5s per paragraph shown (`Menus.storyIntro` — reading-speed clamp + 2000ms + `perParagraphMs`). Never auto-advance boss-phase/act text in under ~3s. This rule took 5+ corrections to stick — don't shorten dwell times.

## Pitfalls

- `electron-main.cjs` serves `dist/` over loopback HTTP because `file://` breaks Vite's absolute asset paths — don't "simplify" it to `loadFile`.
- **Saves depend on a FIXED loopback port.** `localStorage` (run checkpoints, profile, unlocks, cosmetics) is partitioned by origin, and the origin includes the port. `electron-main.cjs` binds a constant `PREFERRED_PORT` (with single-instance lock + EADDRINUSE fallback) so the origin is stable across launches — reverting it to `listen(0)` silently boots every launch on an empty store and loses all saved progress. Guarded by `npm run smoke:save-persist`. Relatedly, only `/assets/` (content-hashed) is cached immutably; index.html/music/icons are `no-cache` so an app update isn't masked by a stale cached `index.html`.
- The hero root is scaled 1.12× — world-space child overlays (like the crash ring) must counter-scale.
- `RingGeometry` sectors start at +X in the XY plane; the flatten + yaw math in `combat.ts` (`slashVisual`) is already worked out — reuse it.
- HUD cooldown sweep: `--cd` marks where the **bright** wedge ends (ready = 100%). Inverting it makes ready cards look disabled (this was a real shipped bug).
- **Don't flip the render path (`setLowCost`) while a dense scene is on the field.** A Three program-cache key includes shadow-light count + composer/tone-mapping state, so the full↔lean flip forces a synchronous whole-scene shader relink — that was the "~3-second boss-death freeze". The frame loop deliberately holds the *full* path through `dead`/`victory` (boss + pack still present) and only flips cheap in `toMenu()` after the scene is cleared. `boot()` warms both composers + both shadow states under the loading screen.
- The smoke scripts need the dev server on **5174** — they don't start it themselves.
- **No allocation in per-frame paths.** The real-GPU soak caught GC pauses up to ~999ms in heavy combat; the suspect class is per-frame allocation in the hot loop — vector temps, HUD string building, floater churn. When the owner reports a hitch, extend the frame-spike classifier (compile vs GC, `perf:soak` / `__rh3perf.spikes()`) FIRST to attribute it; fix second.
- **Display settings**: render-resolution is a render-*scale* on the pixel ratio (`Stage.setRenderScale`, capped by the quality preset), not a canvas resize. Fullscreen + exact window size go through `window.rh3native` in Electron and fall back to the Fullscreen API in the browser. `Menus.applySettings()` deliberately does **not** apply the display *mode* — re-asserting fullscreen on a non-toggle gesture (e.g. moving a volume slider) would try to enter fullscreen in the browser; mode applies only on explicit toggle + once at boot via `applyInitialDisplay()`.
- The plain Electron smoke (`smoke-electron.cjs`) builds its **own** bare `BrowserWindow` with no preload, so `window.rh3native` is undefined there — use `npm run smoke:display-electron` (loads the real `preload.cjs` + `electron-ipc.cjs`) to exercise the native bridge.
