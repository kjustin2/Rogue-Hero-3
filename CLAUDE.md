# Rogue Hero 3 — Project Guide

Single-player 3D action roguelike on **Three.js** (the June 2026 ground-up rebuild; the old Babylon.js v1 was removed). Vite + strict TypeScript, ships as an Electron desktop app. Content: **6 playable heroes** (`game/heroes.ts`, data-driven multipliers — no per-hero branching; each has a distinct procedural silhouette in `Player.applyHero`; the Revenant's `killHeal` passive sustains through kills), 5 acts on a **generated forked-path map** (`game/mapgen.ts` — at each chamber you pick 1 of 2–3 node types: combat/elite/shop/treasure/rest/event; the pre-boss fork always offers a rest/hone; the map screen shows a peek at the next chamber; each act ends at its boss, the last being the Unmaker in `bossUnmaker.ts`), 5 act bosses + a **Rift Echo** superboss (`bossEcho.ts`), 17 enemy types + **elite affixes** (`game/affixes.ts` — hasted/volatile/regenerator/frenzied/siphon, stackable, 2 at high depth; `Enemy.affixes`), **coordinated packs** (front-line + back-line formation waves in `mapgen`), **champions** (2-affix mini-bosses on some elite hunts), **reactive AI** (foes sidestep lunges + recoil at Critical, in `EnemyManager`), and depth-5+ boss **honor guards**, 34 cards (with build **tags** + draft synergy highlighting; some **hero-locked** via `CardDef.hero`; honeable into upgraded forms at rest/shop), 31 relics (common/rare/**legendary**/**cursed** tiers + auto-granted **warden boons**; `relics.ts`), status combos (**Vulnerable** + Freeze/Bleed/Burn + the **Shatterglass** detonator), and an **Ascension depth ladder** (`game/difficulty.ts`, "Rift Depth" 0–15 stacking modifiers — enemy speed/armor/knockback-resist, faster tempo drain, longer cooldowns, tighter dodge window; win a depth to unlock the next, depth-scaled clear rewards). The signature **Tempo** meter now drives an active layer (`game/overdrive.ts`): at Critical, spend it for a per-hero **Overdrive** super ([Q]/LT); sustaining Critical builds **Crescendo**; crashing at ≥95 is a **Perfect Crash**. Combat has **executions** (heavy blows finish wounded foes). The story builds to a bittersweet finale with a **mercy / true ending** (hold [Q] to spare the Hollow Star → "THE LIGHT ENDURES") and hero-specific closing lines. Plus: per-act **story cutscenes** + cinematic boss entrances, run-start **blessing** + in-run **Ascendant** ranks, draft **reroll** (shard sink), end-screen **run recap**, node-boundary save points (`profile.ts` RunSave v2 = seed+depth+position), a rift-shard economy with Armory cosmetics, milestone meta-progression, a bespoke per-act **soundtrack** (`audio/music.ts`) with tempo/overdrive stingers, Low/Medium/High quality presets + Reduce Motion, full **gamepad** support — gameplay AND menu navigation (`core/input.ts` + `ui/menuNav.ts`) — rebindable controls, accessibility options, daily/seeded runs, and a Training Grounds tutorial.

## Layout

| Path | Notes |
|---|---|
| `game/` | **All source.** Vite config, scripts, package.json |
| `game/src/` | Game code (see Architecture) |
| `game/electron-main.cjs` | Electron entry — serves `dist/` over a loopback HTTP server (file:// breaks Vite asset paths) |
| `game/scripts/` | Headless-browser smoke tests |
| `start.bat` | One-click Windows launcher (install → build → Electron window) |

**Working-directory friction**: Claude is invoked at the repo root, but `package.json` lives in `game/`. Wrap npm commands as `(cd /e/Storage/SAAS/Rogue-Hero-3/game && npm run …)`.

## Verify

```bash
npm run verify     # tsc --noEmit && vite build (~10s)
```

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
node scripts/smoke-telegraph.mjs # sentinel beam + boss dash telegraph alignment
node scripts/smoke-shields.mjs   # Bastion/Mirror shields drain + break under damage; flank bypass; freeze tint
node scripts/smoke-gamepad.mjs   # controller detect (event + poll backstop), "connected" toast, menu nav, stick→move, disconnect
node scripts/smoke-aim.mjs       # gamepad combat: shoulder-button mapping, auto-aim facing, [Y] switch-target lock-on, Start=pause
node scripts/smoke-features.mjs  # map features: spike traps, drifting orbs, sweeping beam — spawn, damage, dispose
node scripts/smoke-ward.mjs      # boss ward/invuln: hits deflected while warded, vulnerable again after, close punish shockwave, raised HP
node scripts/smoke-mercy.mjs     # Unmaker fading phase → hold [Q] to spare → "THE LIGHT ENDURES" true ending
node scripts/smoke-superboss.mjs # Rift Echo encounter across phases (debugLoadNode)
node scripts/smoke-menu-perf.mjs # 3×-throttled CPU: menu/hero-select/settings frame max·p95·longMax (perf regression guard)
node scripts/smoke-death-perf.mjs# forces HIGH quality, boss room → kills player; asserts the playing→dead flip relinks 0 programs (no freeze)
node scripts/smoke-perf.mjs / smoke-perf-stress.mjs  # combat frame budget under load
node scripts/shot-loader.mjs     # eyeball the boot loading screen (shots/loader-*.png)
```

### Performance + AI-visual harness

A unified instrument + tools for **measuring optimizations** and **letting Claude see frames**:

- **`window.__rh3perf`** (`src/debug/perfMonitor.ts`) — always-on, near-free frame instrument. Reports accurate per-frame **draw calls / triangles / shader programs / geometries / textures / JS heap / live enemies** plus frame-pacing stats (mean/p50/p95/p99/max, long-frame + `over250` stall counts). API: `report()` (rolling window), `start(label)`/`stop()` (explicit window, returns stats + correlated `mark()` events), `snapshot()`, `hud(on?)`. Draw-call counting is accurate (it owns `renderer.info.autoReset` and resets once per frame so the composer's multiple passes sum correctly).
- **On-screen overlay** — `?perf` URL param opens it; **F8** toggles live. Sized to stay legible in a full-frame screenshot, so a single shot carries FPS / draws / programs / state + a frame-time sparkline for Claude to read.
- **`npm run perf:bench`** (`scripts/perf-bench.mjs`) — benchmark battery (menu → combat acts → every boss). Samples standardized perf, screenshots each frame *with the overlay baked in* → `artifacts/perf/shots/`, writes `latest.json`, and **diffs against `baseline.json`**. `npm run perf:baseline` sets the baseline; this is how you prove an optimization helped. Deterministic GPU-load + sync-stall regressions gate the exit code; noisy headless frame-timing is reported but only gates with `--gate-timing`.
- **`npm run perf:lag-hunt`** — drives every event and flags first-time synchronous shader compiles (the hitch class).
- **`npm run visual:diff -- <A> <B>`** (`scripts/visual-diff.mjs`) — pixel-diffs two PNGs or two shot dirs via a headless canvas (no deps); per-image %changed + heatmap PNGs to `artifacts/visual-diff/`. `--fail <pct>` gates. Catches unintended visual ripples.
- **`npm run ai:look -- <scenario|shot.png> "<question>"`** (`scripts/ai-look.mjs`) — captures a scenario (frames bosses/enemies for the shot) and asks the `claude` CLI to judge it, with the engine's ground-truth perf numbers injected into the prompt. On-demand visual+perf critique.
- **`npm run smoke:perf-instrument`** — regression probe guarding the `__rh3perf` contract.

Shared harness helpers live in `scripts/loop/lib.mjs`: `samplePerf` (uses `__rh3perf`, rAF fallback), `perfReport`, `assertBudget`, `enterRun`, `gotoScenario`. Reuse them — don't re-bolt a rAF probe onto each new perf script.

That list is the high-traffic subset — `scripts/` holds ~40 smokes total (visual-theme, player-animation, enemy-visual, card-visuals, tempo, balance, edge, boss-cutscene/pause families). `package.json` also defines `npm run smoke:*` aliases (`smoke:menu-perf`, `smoke:perf`, `smoke:perf:stress`, `smoke:polish`, `smoke:cards`, `smoke:boss-pause`) and `npm run smoke` runs the Electron smoke (`smoke-electron.cjs`).

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
| `render/arena.ts` | The floating disc arena, sky shader, per-act `THEMES` + `applyTheme` crossfade |
| `render/particles.ts` | One pooled GPU point cloud for all bursts + shockwave-ring pool + ambient embers |
| `render/telegraphs.ts` | Pooled circle/line attack warnings — every enemy attack must use one |
| `render/floaters.ts` | DOM damage numbers (project once, CSS animates) |
| `render/trail.ts` | `SwordTrail` ribbon behind the blade — CPU-rebuilt quad strip of recent (tip,base) pairs, additive, tinted by blade cosmetic |
| `game/player.ts` | Hero stats + fully procedural mesh + pose layering (dodge > swing > locomotion) |
| `game/controller.ts` | Movement, dodge i-frames, perfect-dodge window, external `push()` impulses |
| `game/combat.ts` | Melee chain, `dealDamage` pipeline (ALL player damage flows through it), `damagePlayer` (returns how it resolved), crash nova |
| `game/projectiles.ts` | Pooled glow-sprite **shots** (player + enemy ranged); travel/pierce/range, hit-id dedupe, shared radial-falloff `CanvasTexture` |
| `game/tempo.ts` | The signature 0–100 flow meter; zones in `ZONES` drive damage/speed/colors |
| `game/overdrive.ts` | The active Tempo layer — per-hero **Overdrive** super (spent at Critical), **Crescendo** build-up, **Perfect Crash** at ≥95 |
| `game/cards.ts` / `deck.ts` | 34 card defs + cast handlers + lingering entities (mines/phantoms/meteors/wells/bleeds); 3 slots, cooldowns, unlock-gated drafting. **Honed upgrades**: `deck.upgraded[slot]` → `−30% cd / +50% tempo` plus a per-card bespoke effect (`cast(def, upgraded)` → `dispatch(def, upgraded)`; `CardDef.upDesc`). Honed at Rest nodes |
| `game/enemies.ts` / `enemies2.ts` | Enemy base (HP bars, knockback, freeze, hit-flash, disposal) + registry; base 5 types + Act II/III roster (wisp/leaper/tether/mirror/caster/shade/bastion) + Act IV (brute/harrier/splitter) + Act V (voidling/warper) |
| `game/boss.ts` / `bossSpire.ts` / `bossColossus.ts` / `bossTyrant.ts` / `bossUnmaker.ts` / `bossEcho.ts` | Pit Warden, Spire Caster (echo lances), Colossus (tectonic ring slams), Rift Tyrant (rift-engine, Act IV), the **Unmaker** (Hollow Star finale + mercy ending), and the **Rift Echo** superboss (your sharpened reflection) — multi-phase; registry in `run.ts` `BOSSES` |
| `game/relics.ts` | 31 passive relics; hook surface consulted by combat/tempo/deck/run pipelines |
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

## Pitfalls

- `electron-main.cjs` serves `dist/` over loopback HTTP because `file://` breaks Vite's absolute asset paths — don't "simplify" it to `loadFile`.
- The hero root is scaled 1.12× — world-space child overlays (like the crash ring) must counter-scale.
- `RingGeometry` sectors start at +X in the XY plane; the flatten + yaw math in `combat.ts` (`slashVisual`) is already worked out — reuse it.
- HUD cooldown sweep: `--cd` marks where the **bright** wedge ends (ready = 100%). Inverting it makes ready cards look disabled (this was a real shipped bug).
- **Don't flip the render path (`setLowCost`) while a dense scene is on the field.** A Three program-cache key includes shadow-light count + composer/tone-mapping state, so the full↔lean flip forces a synchronous whole-scene shader relink — that was the "~3-second boss-death freeze". The frame loop deliberately holds the *full* path through `dead`/`victory` (boss + pack still present) and only flips cheap in `toMenu()` after the scene is cleared. `boot()` warms both composers + both shadow states under the loading screen. See `MENU_PERFORMANCE.md`.
- The smoke scripts need the dev server on **5174** — they don't start it themselves.
