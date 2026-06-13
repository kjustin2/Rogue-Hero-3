# Rogue Hero 3 — Project Guide

Single-player 3D action roguelike on **Three.js** (the June 2026 ground-up rebuild; the old Babylon.js v1 was removed). Vite + strict TypeScript, ships as an Electron desktop app. Content: 3 playable heroes (`game/heroes.ts`, data-driven multipliers — no per-hero branching), 3 acts × 4 chambers (combat ×2 → elite → boss; some rooms have blocking pillar obstacles via `arena.obstacles`), 3 bosses, 12 enemy types, 20 cards, 16 relics, chamber-boundary save points (`profile.ts` RunSave + Continue Run), a rift-shard economy with Armory cosmetics (`cosmetics.ts`; cape + blade colors applied in `Player.applyHero`), milestone meta-progression, and Low/Medium/High quality presets (`Stage.applyQuality`).

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
node scripts/smoke-flow.mjs      # walks all 9 rooms: drafts, act intros, victory + death
node scripts/smoke-bosses.mjs    # Spire Caster + Colossus across all phases
node scripts/smoke-relic.mjs     # elite clear → relic draft → HUD relic row
node scripts/smoke-meta.mjs      # fresh profile → gated drafts → win → unlocks/progress screen (CLEARS the profile)
node scripts/smoke-crash.mjs     # cooldown sweep + crash-radius ring
node scripts/smoke-release.mjs   # hero select, obstacles, save/continue, armory purchase (CLEARS profile)
```

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
| `core/input.ts` | Keys/mouse with per-frame edge detection, cursor→ground-plane aim |
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
| `game/cards.ts` / `deck.ts` | 16 card defs + cast handlers + lingering entities (mines/phantoms/meteors/wells/bleeds); 3 slots, cooldowns, unlock-gated drafting |
| `game/enemies.ts` / `enemies2.ts` | Enemy base (HP bars, knockback, freeze, hit-flash, disposal) + registry; base 5 types + Act II/III roster (wisp/leaper/tether/mirror/caster) |
| `game/boss.ts` / `bossSpire.ts` / `bossColossus.ts` | Pit Warden, Spire Caster (echo lances), Colossus (tectonic ring slams) — 3 phases each |
| `game/relics.ts` | 11 passive relics; hook surface consulted by combat/tempo/deck/run pipelines |
| `game/profile.ts` | localStorage meta-progression: lifetime stats, `MILESTONES` unlock table, run history |
| `game/run.ts` | 9-room `ROOMS` table (3 acts), wave/elite/boss spawning, reward routing (combat→card, elite→relic) |
| `ui/hud.ts` / `menus.ts` / `style.css` | DOM HUD + every overlay screen — the professional look lives in the CSS |
| `audio/sfx.ts` | Procedural Web Audio SFX — every sound synthesized, no asset files |

## Conventions & invariants

- **Strict TS** (`noUnusedLocals`, `noUnusedParameters`). No escape hatches.
- **Events are typed** — extend `EventMap` in `core/events.ts`; a typo'd name is a compile error by design.
- **All player-sourced damage goes through `Combat.dealDamage`** (tempo multiplier, floaters, sparks, stats). All incoming damage through `Combat.damagePlayer` (perfect-dodge interception, shields).
- **Every enemy attack telegraphs** via `ctx.tele` — readable threat windows are the fairness contract.
- **No hitstop** — combat never time-scales on impact. Use `cam.addTrauma`/`kick` + `stage.punch` instead.
- **No asset files** — meshes are procedural primitives, audio is synthesized, textures are canvas-painted. Keep it that way.
- **Dispose what you create** — enemies own their geometries/materials and release them in `dispose()`; anything added straight to the scene needs explicit cleanup (see `RunManager.loadRoom` clears).
- **Tempo changes go through `tempo.gain/drain/crash`** — never assign `tempo.value` directly (zone-change events would be skipped). The cold-crash latch in `combat.ts` is the one exception.

## Pitfalls

- `electron-main.cjs` serves `dist/` over loopback HTTP because `file://` breaks Vite's absolute asset paths — don't "simplify" it to `loadFile`.
- The hero root is scaled 1.12× — world-space child overlays (like the crash ring) must counter-scale.
- `RingGeometry` sectors start at +X in the XY plane; the flatten + yaw math in `combat.ts` (`slashVisual`) is already worked out — reuse it.
- HUD cooldown sweep: `--cd` marks where the **bright** wedge ends (ready = 100%). Inverting it makes ready cards look disabled (this was a real shipped bug).
- The smoke scripts need the dev server on **5174** — they don't start it themselves.
