# Rogue Hero 3

Single-player action roguelike. Source and package.json live in `game/`.
Plain Three.js, Vite, strict TypeScript, Electron. `src/main.ts` is the composition root.

## Development and verification

The owner manually tests detail, balance, visuals, and complete runs.
**Automated testing is basic, quick smoke testing ONLY.** Do not reintroduce
unit suites, visual analyzers, video QA, bots, soak tests, AI judges, golden
traces, performance batteries, or automatic review loops.

- `cd game; npm test` — one smoke: launch, start, move, attack, dodge, card, pause/resume.
- `npm run qa`, `qa:fast`, `qa:loop`, and `smoke` are aliases of that same smoke.
  Run ONE alias once when needed, never chain the aliases.
- Smoke has a 30-second hard deadline; no rebuild and no screenshots by default.
  `node scripts/smoke.mjs --screenshots` optionally captures the menu and combat for inspection.
- `npm run build` — TypeScript check + production bundle, separate from testing.
  Run once before delivery; `npm run verify` is the same build.
- `npm start` — build and launch the standalone game. No QA runs on startup.
- `node scripts/smoke.mjs --production` checks the existing built app if needed.
- Keep only `scripts/smoke.mjs` as the automated test entry point.

One browser/Electron smoke at a time. Use the smoke's isolated save directory,
muted invisible window, fail-fast lock, deadline, and owned-process cleanup.
Never kill unrelated game/browser processes. Stop owned dev servers before handoff.
Do not represent a smoke pass as proof of visual quality or absence of all bugs.

## Code conventions

Art and combat reference: **Hades**, as chosen by the owner. Aim for original
stylized characters with bold silhouettes, crisp value separation, restrained
glow, and fast ground movement. Prioritize readable poses and attack tells over
surface clutter. Encounters need distinct frontline/backline roles and recovery
openings. Keep the palette controlled and the HUD quiet during combat.

Additional researched direction and source links: `game/docs/REFERENCE-DIRECTION.md`.
Dungeon Lurker informs dark handcrafted spaces and discovery; preserve fast combat.
The owner authorizes local Blender and needed packages. Blade motion is authored
in `game/art/blade/` and exported to `src/game/bladeMotionData.ts`; contact phases
must stay shared with Combat. See the art README before regenerating the bank.
Do not add another animation clock or root-motion collision authority.

There is one playable protagonist: **The Blade**. Build differentiation comes
from the 28 retained abilities, seven equipment-based specialties, and honing
during a run. Do not restore character selection or retired signature variants.
Boss scenes must animate the actual rig; the cinematic finalizer owns camera,
input, HUD and grace on both completion and skip. New-run and menu transitions
must reset presentation state, including the HUD hidden by an ending.
Boss death commits KILL and its bounty before BOSS_DEFEATED can record victory.
Resolution advances body animation, not attacks, hazards or the run timer.
Checkpoints are complete snapshots at fork boundaries, after rewards. Do not
overwrite one with partial combat state when returning to the menu.

- Keep gameplay deterministic: use `ctx.rng`, and keep cosmetic RNG out of gameplay.
- Use typed EventBus events and action-based input, including rebindable HUD labels.
- All outgoing damage goes through `Combat.dealDamage`; incoming damage through
  `Combat.damagePlayer`. All tempo mutations use gain/drain/crash.
- Every damaging enemy attack has a readable telegraph. No impact hitstop.
- Procedural meshes, canvas textures, synthesized SFX. The soundtrack in `public/music/`
  is the asset exception. Do not add AI-generated game art or unused asset loaders.
- Dispose owned geometry/materials and clear transient attacks at room boundaries.
- Use the main dt loop for gameplay and visual animation. Pause must freeze attacks,
  telegraphs, and interlude progression together.
- Keep the combat render path through pause/death/victory. Switch to the menu path
  after clearing the room to avoid relinking a dense scene during a fight.
- World-space movement, collisions, and attack reach are authoritative. Ornament
  does not silently become an invisible wall. Keep warnings above floor detail.
  Chamber outlines drive both the visible walls and collision queries.
- Keep HDR render targets and the explicit display tone map. Sustained spell
  ticks use local contact effects without repeatedly kicking the camera.
- Menus route Escape through `Menus.back()`; never forfeit a draft on Escape.
- `storyDwellMs()` owns story reading time. Preserve skip controls.
- Electron saves use the fixed loopback origin (port 41730); smoke saves are isolated.
  Keep preload sandboxed, context isolation on, and Node integration off.

## Manual shortcuts

Devtools: `window.__rh3debug.scenario("room:combat")`, `scenario("boss:warden")`,
`scenario("boss:unmaker:p3")`, `godmode()`, `killEnemies()`, `skipCutscene()`.
`window.__rh3` exposes the context for manual development. F8 toggles a small
performance display; it does no analysis or recording while hidden.
Scenario room jumps must clear menus, show the HUD, enter playing, and enable input.

## Source map

- `core/`: input, events, RNG, math.
- `game/`: hero, controller, combat, cards, relics, enemies, bosses, run/map, saves.
- `render/`: arena, world sets, lighting, camera, particles, trails, telegraphs.
- `presentation/`: action profiles, target-local impact effects, cinematic timeline.
- `ui/`: menus and HUD; `style.css` owns layout and typography.
- `audio/`: music and procedural SFX.

Read catalogs for current content counts. README claims are not the source of truth.
