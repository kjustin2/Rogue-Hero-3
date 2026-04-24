# Rogue-Hero-3
Rogue Hero the Third! Single-player 3D rebuild of Rogue Hero 2 on Babylon.js.

## Layout

- `game/` — the new 3D game (Vite + TypeScript + Babylon.js 9.x)
- `rogue-hero-2/` — original 2D Canvas game; reference for porting data + mechanics
- `Babylon.js/` — engine source clone; reference only (we depend on published `@babylonjs/*` packages)

## Run the new game

```bash
cd game
npm install
npm run dev
```

Open `http://localhost:5173/`. Backtick (`` ` ``) toggles the Babylon.js inspector.

## Controls (current)

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
