# Rogue Hero 3 — Project Guide

Single-player 3D action roguelike on **Three.js** (the June 2026 ground-up rebuild; the old Babylon.js v1 was removed). Vite + strict TypeScript, ships as an Electron desktop app. Content: **6 playable heroes** (`game/heroes.ts`, data-driven multipliers — no per-hero branching; each has a distinct procedural silhouette in `Player.applyHero`; the Revenant's `killHeal` passive sustains through kills), 5 acts on a **generated forked-path map** (`game/mapgen.ts` — at each chamber you pick 1 of 2–3 node types: combat/elite/shop/treasure/rest/event; the pre-boss fork always offers a rest/hone; the map screen shows a peek at the next chamber; each act ends at its boss, the last being the Unmaker in `bossUnmaker.ts`), 5 bosses, 17 enemy types + **elite affixes** (`game/affixes.ts` — hasted/volatile/regenerator/frenzied/siphon, stackable, 2 at high depth; `Enemy.affixes`), **coordinated packs** (front-line + back-line formation waves in `mapgen`), **champions** (2-affix mini-bosses on some elite hunts), **reactive AI** (foes sidestep lunges + recoil at Critical, in `EnemyManager`), and depth-5+ boss **honor guards**, 35 cards (with build **tags** + draft synergy highlighting; some **hero-locked** via `CardDef.hero`; honeable into upgraded forms at rest/shop), 27 relics (common/rare/**legendary**/**cursed** tiers + auto-granted **warden boons**; `relics.ts`), status combos (**Vulnerable** + Freeze/Bleed/Burn + the **Shatterglass** detonator), and an **Ascension depth ladder** (`game/difficulty.ts`, "Rift Depth" 0–15 stacking modifiers — enemy speed/armor/knockback-resist, faster tempo drain, longer cooldowns, tighter dodge window; win a depth to unlock the next, depth-scaled clear rewards). The signature **Tempo** meter now drives an active layer (`game/overdrive.ts`): at Critical, spend it for a per-hero **Overdrive** super ([Q]/LT); sustaining Critical builds **Crescendo**; crashing at ≥95 is a **Perfect Crash**. Combat has **executions** (heavy blows finish wounded foes). The story builds to a bittersweet finale with a **mercy / true ending** (hold [Q] to spare the Hollow Star → "THE LIGHT ENDURES") and hero-specific closing lines. Plus: per-act **story cutscenes** + cinematic boss entrances, run-start **blessing** + in-run **Ascendant** ranks, draft **reroll** (shard sink), end-screen **run recap**, node-boundary save points (`profile.ts` RunSave v2 = seed+depth+position), a rift-shard economy with Armory cosmetics, milestone meta-progression, a bespoke per-act **soundtrack** (`audio/music.ts`) with tempo/overdrive stingers, Low/Medium/High quality presets + Reduce Motion, full **gamepad** support — gameplay AND menu navigation (`core/input.ts` + `ui/menuNav.ts`) — rebindable controls, accessibility options, daily/seeded runs, and a Training Grounds tutorial.

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
```

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

`src/main.ts` wires everything into a shared `Ctx` (`src/game/ctx.ts`) and owns the state machine (`menu | playing | paused | draft | dead | victory`). Systems hold `ctx` and reach peers through it; `ctx.ts` uses type-only imports so there are no runtime cycles.

| Module | Owns |
|---|---|
| `core/events.ts` | **Typed** EventBus — event names + payloads are compile-checked. New events go in `EventMap`; never raw strings |
| `core/input.ts` | Keys/mouse/**gamepad** with per-frame edge detection; rebindable **action layer** (`actionDown`/`actionPressed`/`moveVector`/`aimDir`); cursor→ground-plane aim. Consumers query actions, never raw codes |
| `render/stage.ts` | Renderer, ACES, post chain (bloom/CA/vignette/noise/SMAA), screen `punch()` |
| `render/cameraRig.ts` | Trauma-based shake (`addTrauma`), directional `kick()`, FOV pulses, menu orbit vs follow |
| `render/arena.ts` | The floating disc arena, sky shader, per-act `THEMES` + `applyTheme` crossfade |
| `render/particles.ts` | One pooled GPU point cloud for all bursts + shockwave-ring pool + ambient embers |
| `render/telegraphs.ts` | Pooled circle/line attack warnings — every enemy attack must use one |
| `render/floaters.ts` | DOM damage numbers (project once, CSS animates) |
| `game/player.ts` | Hero stats + fully procedural mesh + pose layering (dodge > swing > locomotion) |
| `game/controller.ts` | Movement, dodge i-frames, perfect-dodge window, external `push()` impulses |
| `game/combat.ts` | Melee chain, `dealDamage` pipeline (ALL player damage flows through it), `damagePlayer` (returns how it resolved), crash nova |
| `game/tempo.ts` | The signature 0–100 flow meter; zones in `ZONES` drive damage/speed/colors |
| `game/cards.ts` / `deck.ts` | 25 card defs + cast handlers + lingering entities (mines/phantoms/meteors/wells/bleeds); 3 slots, cooldowns, unlock-gated drafting. **Honed upgrades**: `deck.upgraded[slot]` → `−30% cd / +50% tempo` plus a per-card bespoke effect (`cast(def, upgraded)` → `dispatch(def, upgraded)`; `CardDef.upDesc`). Honed at Rest nodes |
| `game/enemies.ts` / `enemies2.ts` | Enemy base (HP bars, knockback, freeze, hit-flash, disposal) + registry; base 5 types + Act II/III roster (wisp/leaper/tether/mirror/caster/shade/bastion) + Act IV (brute/harrier/splitter) |
| `game/boss.ts` / `bossSpire.ts` / `bossColossus.ts` / `bossTyrant.ts` | Pit Warden, Spire Caster (echo lances), Colossus (tectonic ring slams), Rift Tyrant (rift-engine, Act IV) — 3 phases each |
| `game/relics.ts` | 21 passive relics; hook surface consulted by combat/tempo/deck/run pipelines |
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
- The smoke scripts need the dev server on **5174** — they don't start it themselves.
