# Rogue-Hero-3
Rogue Hero the Third! Single-player 3D rebuild of Rogue Hero 2 on Babylon.js.

## Layout

- `game/` — the new 3D game (Vite + TypeScript + Babylon.js 9.x)
- `rogue-hero-2/` — original 2D Canvas game; reference for porting data + mechanics
- `Babylon.js/` — engine source clone; reference only (we depend on published `@babylonjs/*` packages)

## Run the game (development)

```bash
cd game
npm install
npm run dev
```

Open `http://localhost:5173/`. Backtick (`` ` ``) toggles the Babylon.js inspector.

## Run the game standalone (no browser)

The game ships as a desktop window via [Electron](https://www.electronjs.org/).
There is no browser tab, no URL bar, and no separate preview-server console —
just a single native window with the game inside.

### Option A: one-click on Windows (recommended)

From the repo root, double-click `start.bat`. It will:

1. `npm install` (only on first run — pulls in Electron, ~200 MB).
2. `npm run build` to compile the production bundle.
3. Launch the game in a standalone Electron window.

Closing the window exits the game cleanly. Press F11 for true fullscreen.
The first run takes a couple minutes (Electron download + build); subsequent
launches skip the install step and just rebuild + open in ~30 seconds.

### Option B: from the command line (any OS)

```bash
cd game
npm install            # first time only
npm run standalone     # builds + opens the Electron window
```

Or split the steps:

```bash
npm run build
npm run electron       # opens the window using the existing dist/ build
```

You can also enable devtools in the Electron window by setting an env var
before launch — useful for inspecting the Babylon scene graph:

```bash
RH3_DEVTOOLS=1 npm run electron
```

### Option C: run in a browser instead

If you specifically want to play in a regular browser tab (e.g. to use the
browser's profiler), use the Vite dev server or preview server:

```bash
npm run dev        # http://localhost:5173/  (hot reload, slower)
# - or -
npm run build && npm run preview   # http://localhost:4173/  (production bundle)
```

### Option D: package as a distributable .exe

`start.bat` and `npm run standalone` already give you a desktop window, but
they require Node.js installed. To produce a true double-click `.exe` with
no Node dependency on the target machine, add `electron-builder`:

```bash
cd game
npm install --save-dev electron-builder
```

Add a build config to `game/package.json` (under the existing keys):

```json
"build": {
  "appId": "com.roguehero3.app",
  "productName": "Rogue Hero 3",
  "files": ["dist/**/*", "electron-main.cjs", "package.json"],
  "win": { "target": "nsis" }
},
"scripts": {
  "...existing scripts...": "...",
  "dist": "npm run build && electron-builder --win --x64"
}
```

Then `npm run dist` produces `game/dist-electron/Rogue Hero 3 Setup x.y.z.exe`
— a self-contained ~200 MB Windows installer. The resulting `.exe` does not
require Node.js, npm, or a browser to run.

### Option E: lighter exe via Tauri

Tauri produces much smaller binaries (~10 MB) but needs the Rust toolchain
installed. See https://tauri.app/start/ — point Tauri's `frontendDist` at
`game/dist/` after `npm run build` and reuse the same loopback-server pattern
from `electron-main.cjs` (or use Tauri's built-in static asset protocol).

## Controls

| Input | Action |
|---|---|
| WASD / arrows | Move (camera-relative) |
| Mouse move | Aim — your character faces the gold reticle on the floor |
| Left click | Auto-melee swing toward reticle |
| Right click drag | Orbit camera |
| Mouse wheel | Camera zoom |
| Space / Shift | Dodge (i-frames) |
| 1 / 2 / 3 / 4 | Play card from hand (Cleave / Bolt / Dash Strike + draws) |
| F | Manual tempo crash (Tempo ≥ 85) |
| Q / Tab | Cycle locked target |
| G | Cycle quality tier (low / medium / high) |
| F3 | Toggle FPS / frame-time / draw-call dev overlay |
| R | Restart in-place (only on Defeat / Victory screens) |
| `` ` `` | Toggle Babylon.js inspector |

## Vertical slice content

- **1 character:** Blade
- **1 biome:** Verdant (3 procedural arenas)
- **3 cards:** Cleave (melee), Bolt (projectile), Dash Strike (sweeping dash)
- **3 relics:** Metronome, Runaway, Berserker Heart (Blade-only — proves class-passive interaction)
- **4 enemies:** Chaser, Shooter, Caster (telegraphed AoE), Elite (armored charger)
- **1 boss:** Brawler — phase 2 spawns adds at 50% HP
- **3-room run:** Verdant Approach → Verdant Crossing → Brawler's Pit, with relic reward between rooms

3D rendering via Babylon.js — https://github.com/BabylonJS/Babylon.js
