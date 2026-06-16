# Rogue Hero III — The Ember Rift

Single-player 3D action roguelike. **Three.js** + Vite + strict TypeScript,
fully procedural art and audio (zero asset files), ships as an Electron
desktop app. Three playable heroes, three acts of twelve chambers, three
bosses, twenty cards, sixteen relics, chamber save points, and a rift-shard
economy with an Armory of cosmetics.

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

## Build a Windows installer (.exe) to share

To make a single double-click installer that anyone can run to **install and
play** — no Node, no terminal, no dev setup on their machine:

```bash
cd game
npm install            # first time only — pulls in electron-builder
npm run dist           # builds the game + packages a Windows installer
```

The installer lands in **`game/release/`** as **`Rogue Hero 3 Setup 2.0.0.exe`**
(the version tracks `package.json`). Hand that one file to anyone on Windows —
running it installs the game (they can choose the folder), adds a **Rogue Hero 3**
desktop shortcut, and from then on it launches like any normal app. Everything
(the engine, the soundtrack, all art) is bundled inside; nothing else to download.

- **Quick test build (no installer):** `npm run dist:dir` produces a runnable
  unpacked app at `game/release/win-unpacked/Rogue Hero 3.exe` — faster, for
  checking the package before cutting a full installer.
- **SmartScreen note:** the build is **unsigned**, so the first time someone runs
  it Windows may show a blue "Windows protected your PC" prompt — they click
  **More info → Run anyway**. To remove that warning you'd need a paid code-signing
  certificate (configure it via electron-builder's `win.certificateFile`).
- **Custom icon (optional):** drop a 256×256 `build/icon.ico` in `game/` and
  electron-builder picks it up automatically; otherwise the default Electron icon
  is used.

> The installer config lives in the `"build"` block of `game/package.json`
> (electron-builder, NSIS target). Cross-building a macOS/Linux package must be
> done on that OS (or in CI); `--win` is the Windows target.

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

- **Heroes:** The Blade (balanced duelist), The Bulwark (slow juggernaut, 145 HP),
  The Sparkmage (fragile caster, fast cooldowns) — distinct stats, passives, starting
  hands, and palettes; two unlock by defeating act bosses
- **Run:** 3 acts × 4 chambers (combat → combat → elite → boss), some chambers with
  blocking pillar layouts (cover for you, walls for bullets) — combat clears draft
  **cards**, elite clears draft **relics**, act bosses fully heal
- **Save points:** every chamber boundary auto-checkpoints; Continue Run from the menu
- **Acts:** The Ember Rift → The Shattered Spire (jade glass pillars) → The Molten Core
  (slag fields) — each with its own palette, aurora, edge silhouettes, and roster
- **Bosses:** The Pit Warden (dash brawler) · The Spire Caster (mirror-echo lances) ·
  The Colossus (rooted titan, tectonic ring slams with safe lanes)
- **Tempo system:** 0–100 flow meter; hot = faster + harder hits; crash it at 85+ for a nova
- **20 cards**, **16 relics**, **12 enemy types** — every attack telegraphed
- **Shards & Armory:** kills/clears/bosses pay rift shards; spend them on cape colors
  and blade energy (tints sword, trail, slashes, dodge ghosts)
- **Meta-progression:** 21 milestone unlocks (heroes, cards, relics), lifetime stats,
  and run history on the main-menu PROGRESS screen (localStorage)
- **Presentation:** ACES + bloom + color-grade post chain, sword ribbon trails, spawn
  light beams, act-colored auroras, trauma camera, procedural Web Audio SFX
- **Quality presets:** Low / Medium / High in Settings (resolution, shadows, post effects)
