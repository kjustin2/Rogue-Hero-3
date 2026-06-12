# Rogue Hero III — Vertical Slice

Ground-up rebuild of the game on **Three.js** (replacing Babylon.js), focused on
visual quality, game feel, and professional presentation. One act, five chambers,
one boss — the full run loop in miniature.

## Run it

```bash
npm install
npm run standalone   # build + native Electron window (no browser)
npm run dev          # or: browser dev server at http://localhost:5174
```

Or double-click `start.bat` at the repo root for the one-click Electron launch.
`RH3_DEVTOOLS=1 npm run electron` opens devtools in the game window.

`npm run verify` = typecheck + production build.
`node scripts/smoke-browser.mjs` / `smoke-flow.mjs` = headless-browser smoke
tests (boot, combat, draft, boss, end screens) with screenshots into `shots/`.
They use the Playwright Chromium already cached in `%LOCALAPPDATA%\ms-playwright`.

## What's in the slice

- **Run loop**: main menu → 4 combat chambers (with card drafts between) → boss → victory/death screens with run stats.
- **Combat**: 3-hit sword chain (360° finisher), dodge roll with i-frames + perfect-dodge tempo payout, twin-stick mouse aim.
- **Tempo** (signature mechanic): 0–100 flow meter drifting toward 50. Hot = more damage + speed; ≥85 enables the F-key CRASH nova; hitting 0 triggers a cold crash that freezes the room.
- **Cards**: 8 castables (dash, pierce, AoE freeze, blink-decoy, mines, shield, chain lightning, cleave) on cooldowns, drafted roguelike-style after each clear.
- **Enemies**: Husk (telegraphed lunge), Spitter (kiting caster), Swarmer (pack), Bomber (fuse — detonates even if killed), Sentinel (hitscan lance), and the Pit Warden boss (3 phases: dash combos → leaping slams + adds → burning dash chains).
- **Presentation**: ACES + bloom/vignette/chromatic-aberration post chain, emissive low-poly art with per-act color themes, trauma-based camera shake, GPU particle pool, DOM damage numbers, fully procedural Web Audio SFX (zero asset files).

## Architecture

`src/main.ts` wires a shared `Ctx` (see `game/ctx.ts`) and owns the
menu/playing/draft/dead state machine. Systems live in:

| Dir | Contents |
|---|---|
| `core/` | typed EventBus, input, seeded RNG, math/easing |
| `render/` | stage (renderer + postfx), camera rig, arena, particles, telegraphs, damage numbers |
| `game/` | player, controller, combat, tempo, cards, deck, enemies, boss, projectiles, run flow |
| `ui/` | DOM HUD + all menu screens (`style.css` carries the look) |
| `audio/` | procedural SFX synth |

Events are **typed** (`core/events.ts`) — a misspelled event name is a compile
error, not a silent no-op.
