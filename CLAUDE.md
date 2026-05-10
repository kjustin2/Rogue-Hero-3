# Rogue Hero 3 — Project Guide

Single-player 3D roguelike on Babylon.js 9. Vite + TypeScript, ships as Electron desktop app.

## Layout

| Path | Status | Notes |
|---|---|---|
| `game/` | **Active — edit here** | All TypeScript source, Vite config, scripts, package.json |
| `rogue-hero-2/` | Reference only | The 2D Canvas predecessor — port mechanics from here, don't edit |
| `Babylon.js/` | Reference only | Engine source clone for grepping API behavior. We depend on published `@babylonjs/*` packages, not this checkout |
| `start.bat` | Windows launcher | Builds + opens Electron window |

**Working-directory friction**: Claude is invoked at the repo root (`E:\Storage\SAAS\Rogue-Hero-3`), but `package.json` lives in `game/`. Wrap npm commands in `(cd /e/Storage/SAAS/Rogue-Hero-3/game && npm run …)` — the allowlist already covers this form. PowerShell users use `cd game; npm run …`.

## The verify command

`npm run verify` is the single source of truth for "did I break anything?". Pipeline (~30s):

1. `tsc --noEmit` — type check
2. `tsx scripts/test-side-effects-sync.ts` — checks `babylonSideEffects.ts` and `BabylonRuntimeCheck.ts` agree on what's registered
3. `tsx scripts/verify-babylon-runtime.ts` — NullEngine probe; runs the same `validateBabylonRuntime` as boot, in Node, against an `ArcRotateCamera` with `checkCollisions = true` (mirrors FollowCamera)
4. `tsx scripts/test-smoke.ts` — boots managers, checks basic wiring
5. `tsx scripts/test-startup.ts` — player/camera spawn sequence
6. `tsx scripts/test-integration-run.ts` — full run + combat loop simulation
7. `vite build` — production bundle

Run after non-trivial edits. The probe + integration tests catch most cross-system regressions before they reach `npm run dev`.

For ad-hoc work, individual subscripts are also exposed: `npm run typecheck`, `npm run verify:runtime`, `npm run test:smoke`, `npm run test:startup`, `npm run test:integration`, `npm run test:sideeffects`, `npm run test` (all tests, no build).

## Babylon side-effect rule

Babylon 9 is heavily tree-shaken. Methods like `Camera.getForwardRay`, `Scene.pick`, `ParticleSystem.start`, the collision coordinator, post-process pipelines, and shadow generators are added to prototypes by **side-effect imports** (e.g. `import "@babylonjs/core/Culling/ray"`). Skip the import and calls compile fine, then throw at first runtime use:

> `X needs to be imported before as it contains a side-effect required by your code.`

**Rule**: Every Babylon side-effect import lives in `game/src/engine/babylonSideEffects.ts` — the canonical registry. Never sprinkle them in feature files; the probe won't catch drift if registrations are spread out.

When you start using a new Babylon API:
1. Add the side-effect import to `babylonSideEffects.ts` with a comment explaining what it enables.
2. Add a probe in `game/src/engine/BabylonRuntimeCheck.ts` that exercises the API.
3. If the failure surfaces with a class name not yet in the `CLASS_TO_IMPORT` map (top of `BabylonRuntimeCheck.ts`), add the mapping so the `Fix:` hint is accurate.
4. `npm run verify` — the negative case is also worth confirming (comment out the new import → probe should exit 1 with the right hint → restore).

## Architecture

Event-driven. `game/src/engine/EventBus.ts` is a synchronous pub-sub primitive — `events.on(name, fn)` / `events.emit(name, payload)`. `main.ts` (~490 lines) wires everything; managers own their own state and react to events:

| Manager | Owns |
|---|---|
| `Player` | HP/AP, body mesh, position, facing |
| `PlayerController` | Input → movement physics, dodge i-frames, arena bounds |
| `EnemyManager` | Spawn registry + active enemies; routes `EnemyKind` → constructor |
| `CombatManager` | Hit resolution for melee swings + projectile collisions |
| `ProjectileSystem` / `HostileProjectileSystem` | Player + enemy bullets |
| `CardCaster` | Routes `CardDef.type` → cast handler; reads `ItemManager` hooks |
| `DeckManager` | Hand drafting, slots, RNG |
| `ItemManager` | Equipped relics + the hook surface every other system reads |
| `TempoSystem` | Cooldown/power state machine; reads `ItemManager.shouldDecay` etc. |
| `RunManager` | Loads rooms from `ACT_ROOMS`, manages arena lifecycle |
| `BiomeHazardManager` | Per-act ambient hazards (debris/lightning/geyser); paused during boss rooms |
| `HazardZones` | Pooled lingering player AoE patches (mines / fire / frost / phantom); ticks damage to enemies + queries for player movespeed buff |
| `Telegraph` | Pooled line/ring/disc/cone telegraph shapes used by bosses + biome hazards |
| `Hud` / `RewardPicker` / `HandPicker` | UI |
| `SfxManager` | Procedural Web Audio SFX. No asset files — every sound synthesised from oscillators + filtered noise. Subscribes to events on construction; headless-safe (no-op when `AudioContext` is unavailable) |

Render loop in `main.ts` (`engine.runRenderLoop` near the end) calls `scene.render()` and ticks managers per frame. Cross-cutting effects (kill rewards, hit FX, tempo shifts) flow through events, not direct calls.

## Event names — canonical list

35 events. Strings are untyped — typos compile silently and become no-ops. **Reuse existing names; add to this list when you introduce a new one.**

```
ANOMALY_CHANGED      ARCHETYPE_TIER_CHANGED  BEAM_CHARGED         BLEED_TICK
BOSS_DEFEATED        BOSS_INTRO_START        BOSS_PHASE           CARD_COMBO
CARD_FAIL            CARD_FX                 CARD_PLAYED          CARD_PLAYED_SLOT
CAST_FX              COLD_CRASH              COMBO_HIT            COMBO_TIER_CHANGED
CRASH_ATTACK         DAMAGE_TAKEN            DODGE                ENEMY_HIT
HAZARD_SPAWNED       HEAVY_HIT               HEAVY_MISS           HEROIC_STAND
HOSTILE_AOE          KILL                    KILL_STREAK          PERFECT_DODGE
PHANTOM_DETONATE     PLAY_SOUND              PLAYER_LANDED        PLAYER_STEP
RELIC_EQUIPPED       ROOM_CLEARED            ZONE_TRANSITION
```

`BOSS_PHASE` payload: `{ bossId, phase, spawnPos, enrageLine, spawnComposition: EnemyKind[] }`. `BOSS_DEFEATED`: `{ bossId, name, pos }`. `KILL_STREAK`: `{ count, label }`. `HEROIC_STAND`: `{ hp }`. `HOSTILE_AOE`: `{ x, z, radius, damage, source }`. `HAZARD_SPAWNED`: `{ x, z, kind, duration }`. `BEAM_CHARGED`: `{ chargeFraction }`. `BLEED_TICK`: `{ enemyId, dmg }`. `PHANTOM_DETONATE`: `{ x, z }`. `ANOMALY_CHANGED`: `{ id: AnomalyId | null }`. `ARCHETYPE_TIER_CHANGED`: `{ archetype, active }`. `CARD_COMBO`: `{ id, name }`. `COMBO_TIER_CHANGED`: `{ tier, dir }`.

## Where to add content

The four common content additions have dedicated slash commands that walk through every file you need to touch:

| Adding | Command | Primary files |
|---|---|---|
| A new **card** | `/add-card` | `game/src/deck/CardDefinitions.ts`, `game/src/combat/CardCaster.ts`, `game/src/ui/HandPicker.ts` |
| A new **relic** | `/add-relic` | `game/src/items/ItemDefinitions.ts`, `game/src/items/ItemManager.ts` |
| A new **enemy** | `/add-enemy` | `game/src/enemies/types/<Name>.ts`, `game/src/enemies/EnemyManager.ts` |
| A new **room** | `/add-room` | `game/src/run/RunManager.ts` (`ACT_ROOMS`) |

For **post-FX**, **heroes**, or new systems, follow patterns in `game/src/fx/`, `game/src/characters/HeroRegistry.ts`, and the manager wiring near the top of `main.ts`.

## Conventions

- **Strict TS**: `strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true`. No escape hatches.
- **Naming**: PascalCase classes; SCREAMING_SNAKE constants and event names; kebab-case or PascalCase filenames matching their export.
- **Comments**: Light inside methods; heavy at system boundaries / non-obvious invariants. Don't narrate `WHAT` the code does — explain `WHY` if it's surprising or has a hidden constraint. Rule of thumb: if removing the comment wouldn't confuse a future reader, don't write it.
- **Imports**: Babylon side-effects only in `babylonSideEffects.ts`. Feature files import named exports normally.
- **State**: Lives in manager classes. No global store. Cross-cutting effects via `EventBus`.

## Pitfalls

- **Side-effect import order** — `babylonSideEffects.ts` must be the first import in `main.ts` (it is, line 4). Move it later and the side-effects don't register before the boot path tries to use them.
- **Untyped events** — `events.emit("EMEMY_HIT", …)` (typo) silently does nothing. The 24-event list above is the source of truth; check it before introducing a name.
- **Tempo authority** — `TempoSystem` is read every frame by `PlayerController` (movement scaling) and many UI elements. New tempo-affecting features go through `ItemManager` hooks (`shouldDecay`, `crashResetOverride`, etc.), not direct `tempo.value =` mutations.
- **`RunManager.loadRoom()` disposes everything** — old arena, enemies, hazards, projectiles. Persistent entities (player, deck, items) survive because they're owned outside the room. New persistent entities need explicit room-transition wiring.
- **Babylon inspector** keeps rendering — backtick toggles it, but the game does not pause. Inputs still register.
- **`@types/node` is installed** — Node globals (`process`, `Buffer`) are available in `scripts/`. Don't use them in `src/` (browser bundle).
- **Audio is procedural** — `SfxManager` synthesises every sound via Web Audio API at runtime. No `.wav`/`.mp3`/`.ogg` assets, no Babylon audio side-effect imports. The browser autoplay policy keeps the AudioContext suspended until first user gesture; `main.ts` resumes it on the first pointer/key event. Adding a new SFX = a new private method on `SfxManager` plus a subscription in `subscribeAll()`.

## Run modes

```bash
cd game
npm run dev          # Vite hot reload at http://localhost:5173
npm run electron     # Open existing dist/ in an Electron window
npm run standalone   # Build + open Electron window
npm run preview      # Production bundle in browser at :4173
```

Or from the repo root, double-click `start.bat` for the one-click Windows launcher.

`RH3_DEVTOOLS=1 npm run electron` opens Chrome devtools inside the Electron window.

## When unsure

- "Does this Babylon API need a side-effect import?" → grep `node_modules/@babylonjs/core/**/*.js` for `_WarnImport("ClassName")` to see what's gated. Add to `babylonSideEffects.ts` + a probe.
- "Where does this event get handled?" → grep for `events.on("NAME"`.
- "Is this a real card type?" → check `CardType` union in `CardDefinitions.ts:17`.
- "Did my change break the run?" → `npm run verify`. The integration test simulates a full 9-room run.
