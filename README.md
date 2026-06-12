# Rogue Hero III — The Ember Rift

Single-player 3D action roguelike. **Three.js** + Vite + strict TypeScript,
fully procedural art and audio (zero asset files), ships as an Electron
desktop app. Three acts, three bosses, sixteen cards, eleven relics, and
persistent milestone progression.

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

## Content

- **Run:** 3 acts × 3 chambers (combat → elite → boss), linear with reward variety —
  combat clears draft **cards**, elite clears draft **relics**, act bosses fully heal
- **Acts:** The Ember Rift → The Shattered Spire (jade glass pillars) → The Molten Core
  (slag fields) — each with its own palette, edge silhouettes, and enemy roster
- **Bosses:** The Pit Warden (dash brawler) · The Spire Caster (mirror-echo lances) ·
  The Colossus (rooted titan, tectonic ring slams with safe lanes)
- **Tempo system:** 0–100 flow meter; hot = faster + harder hits; crash it at 85+ for a nova
- **16 cards**, **11 relics**, **10 enemy types** — every attack telegraphed
- **Meta-progression:** milestone unlocks (new cards/relics earned by playing), lifetime
  stats, and run history on the main-menu PROGRESS screen (localStorage)
- **Presentation:** ACES + bloom post chain, trauma camera, procedural Web Audio SFX
