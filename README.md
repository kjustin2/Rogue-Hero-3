# Rogue Hero III — The Ember Rift

Single-player 3D action roguelike. **Three.js** + Vite + strict TypeScript,
fully procedural art and audio (zero asset files), ships as an Electron
desktop app. Currently a polished vertical slice: one act, five chambers,
one boss.

## Layout

- `game/` — all source (Vite + TypeScript + Three.js + pmndrs postprocessing)
- `start.bat` — one-click Windows launcher (installs, builds, opens the Electron window)

## Run standalone (no browser) — recommended

```bash
cd game
npm install            # first time only
npm run standalone     # builds + opens the native Electron window
```

Or just double-click **`start.bat`** at the repo root. Closing the window
exits the game; F11 toggles fullscreen. Devtools: `RH3_DEVTOOLS=1 npm run electron`.

Split steps if you already built:

```bash
npm run build
npm run electron       # opens the window using the existing dist/
```

## Run in a browser (development)

```bash
cd game
npm run dev            # http://localhost:5174 — hot reload
```

## Verify a change

```bash
cd game
npm run verify                      # typecheck + production build
node scripts/smoke-browser.mjs      # headless-browser boot/combat smoke (needs `npm run dev` running)
node scripts/smoke-flow.mjs         # full loop: draft → boss → victory/death screens
```

## Controls

| Input | Action |
|---|---|
| WASD | Move |
| Mouse | Aim — you always face the cursor |
| LMB | Sword combo (third hit is a 360° finisher) |
| Space / Shift / RMB | Dodge roll (i-frames; perfect dodge = tempo surge) |
| 1 / 2 / 3 | Cast cards |
| F | CRASH nova at 85+ tempo (the red ring shows its blast radius) |
| Esc | Pause |

## Vertical slice content

- **Run loop:** menu → 4 combat chambers with card drafts between → 3-phase boss → victory/death stats
- **Tempo system:** 0–100 flow meter; hot = faster + harder hits; crash it for a nova
- **8 cards**, **5 enemy types** (all attacks telegraphed), **1 boss** (The Pit Warden)
- **Presentation:** ACES + bloom post chain, per-act color themes, trauma camera, procedural Web Audio SFX
