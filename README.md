# Rogue Hero III — The Ember Rift

A standalone action roguelike built with Three.js, TypeScript, Vite, and Electron.

## Play

```powershell
cd game
npm install
npm start
```

Or double-click `start.bat`. F11 toggles fullscreen. Saves, unlocks, settings,
and cosmetics persist locally. To launch an already built game: `npm run electron`.

## Development

```powershell
cd game
npm run dev       # Vite, port 5174
npm test          # one quick smoke; no build, suites, bots, or visual analysis
npm run build    # TypeScript check + production bundle
```

`qa`, `qa:fast`, `qa:loop`, and `smoke` run the same smoke.
Use one command, once. It boots an invisible, muted Electron window with an
isolated save directory, enters a combat room, checks movement and action inputs,
and pauses/resumes. It aborts after 30 seconds and cleans up its processes.
Detailed gameplay and visual testing is manual.

Optional captures: `node scripts/smoke.mjs --screenshots`.
Existing production build: `node scripts/smoke.mjs --production`.
Neither option starts a larger suite.

## Combat

- WASD: move relative to the camera. Mouse: aim. Bindings can be changed in Settings.
- Attack: three-hit chain. Early taps buffer the next swing; a landed finisher
  shortens active card cooldowns.
- Hold attack, then release: a charged heavy sweep that exposes enemies and
  breaks a boss's combat guard. Crashes break combat guards too.
- Dash: Space / Shift / right mouse. Two charges recharge automatically. Cancels
  a swing; attack during or just after the dash to lunge into the next strike.
  A perfect dodge arms a stronger counter.
- 1 / 2 / 3: cards. F: Crash at 85+ Tempo, with a stronger payoff at 95+.
- Escape: pause. Gamepad controls and auto-aim are supported.

Start as **The Blade**, descend through five acts on a branching map, and build
a hand from **28 abilities**. Equipping two abilities of one school activates
one of **seven specialties**, with a signature Crash, a passive benefit and
15% faster matching cooldowns. Honing improves an ability's effect and cuts its cooldown by 30%.
Your choices during the run define the build; there is no character selection.

The schools turn Crash into piercing sword waves, chained lightning, a freezing
verdict, a delayed meteor, a gathering vortex, a wound detonation, or a reflecting
barrier. The merchant lets you replace an equipped ability; the comparison shows
specialty changes and any honing you would lose before spending shards.

Five distinct chamber shapes arrange pursuit packs, protected artillery, flanking
archers, a processional advance, and a breach. Visible walls and cover block movement and shots;
heavy knockback can smash ordinary enemies into them. Baiting the Pit Warden's
charge into the boundary exposes it. Breaking the Wound's guard releases its
stolen ability and drains its tempo.

Melee attackers stagger their commitments. Killing a bomber disarms it; volatile
elites leave a visible warning before their remains explode. Spell damage and
control respect cover, and each school has its own contact effects and sounds.
Aegis absorbs damage into a four-second reprisal you can detonate yourself.

Boss entrances and phase changes animate the actual boss, then return camera
and controls together. Phase changes cancel interrupted attacks; cutscene bars,
combat labels and contact shadows follow the scene clock. Story crossings follow the hero through the causeway.
Click or Space advances story text; each scene also has a skip control.
Mid-run bosses have a short defeat scene, a collapse suited to their rig, and
a direct handoff to the reward on completion or skip.

Runs save between chambers, after rewards. Continue preserves the route, vitality
gains and sacrifices, run pacts, cast counters and spent revives. Leaving during
a fight returns to that checkpoint. Paid rerolls replace the displayed choices.

Bosses, optional encounters, run blessings, cosmetics,
Rift Depth, and the mercy ending are driven by the catalogs in `game/src/game/`.

## Manual development shortcuts

Open devtools (`RH3_DEVTOOLS=1` for Electron), then use:

```js
__rh3debug.scenario("room:elite")
__rh3debug.scenario("boss:warden")
__rh3debug.scenario("boss:unmaker:p3")
__rh3debug.godmode()
__rh3debug.skipCutscene()
```

F8 toggles a compact FPS/draw-count display. No background analysis runs.

## Package for Windows

From `game/`: `npm run dist` builds an installer, `npm run package` builds a
portable executable, and `npm run dist:dir` builds an unpacked app. Outputs are
in `game/release/`. Packaging does not run QA. Builds are unsigned.

## Layout

`game/src/main.ts` wires the game. `core/` owns input/events/RNG; `game/`
owns combat, enemies, progression, and saves; `render/` owns procedural art
and lighting; `ui/` owns menus/HUD; `audio/` owns music and synthesized SFX.
See [CLAUDE.md](CLAUDE.md) for project conventions.
