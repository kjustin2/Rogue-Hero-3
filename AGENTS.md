# Lost Fiend — active project instructions

This file describes the current game. The September 2026 reset replaces the
seven-path, five-act Rogue Hero overhaul. Keep the playable slice small and make
its combat, readability, and atmosphere excellent before considering expansion.
The player-facing title is **Lost Fiend**; the repository name remains unchanged.

## Game contract

- Four chambers: three short encounters, then the two-phase Bellwether. Fast retry.
- WASD movement, mouse aim, left-click slash, right-click committed heavy, Space
  dodge. Escape pauses. These are the only combat verbs; no Tempo, overcharge,
  abilities, cards, loot choices, or between-room upgrades.
- Three enemy families have distinct threats and recovery windows. Damage follows
  visible action phases. Keep tells readable, openings punishable, and boss body
  collision solid. No hitstop.
- A short skippable entrance and automatic room transitions give the run shape
  without a large cinematic system. The tutorial teaches four actions quickly.

## Visual and interface direction

- Minimal, gritty isometric crypt. Fixed orthographic gameplay framing; charcoal
  stone, worn ivory, muted oxblood, small candle-amber accents, hard shadow and
  negative space. The title uses the same environment kit and camera language.
- Favor readable silhouettes and grounded weight over asset complexity or bright
  effects. Slash, heavy, dodge, enemy tells, hit reactions, and deaths must read at
  the normal camera distance. Dash effects stay near the boots; impact appears at
  the target and never obscures the next tell.
- One bundled IM Fell English family and shared CSS tokens across title, Options,
  tutorial, pause, achievements, and HUD. Chipped dark-stone frames, large legible
  labels, simple hierarchy. Inspect risky menu and combat states at full size.
- Copy is direct and functional. No taglines, vague lore slogans, chamber-count
  promotions, “Room checkpoint” suffix, Escape footer, or decorative arena ring
  that resembles an attack warning. Continue shows the saved location. Controls
  show action and key separately. Control hints default off.
- Use [style and design](game/docs/STYLE-AND-DESIGN.md) and
  [UI references](game/docs/UI-REFERENCES.md) for accepted and rejected examples.

## Code and compatibility

- Plain Three.js, strict TypeScript, Vite, Electron. `game/src/sim.ts` owns seeded,
  Three-free combat and room state. `game/src/view.ts` presents that state.
  `game/src/main.ts` owns input, menus, saves, sound and the single frame clock.
  Keep clear ownership; avoid frameworks for speculative content.
- Preserve app ID, fixed Electron origin, legacy user-data location, and old save
  keys. The slice uses separate versioned keys and must not overwrite incompatible
  legacy runs. Visible title, executable, installer, and shortcut say Lost Fiend.
- Procedural art is the active approach. The old Blender-heavy plan is archived;
  add an asset or animation pipeline only to solve a demonstrated visual problem.

## Verification and delivery

- One quick smoke entry point: `cd game; npm test`, hard deadline 30 seconds.
  It covers launch, core controls, pause, and basic save flow. Do not add suites,
  bots, soaks, automated quality scores, or long test modes.
- Run `npm run build` and one smoke after meaningful changes. For visual changes,
  inspect relevant screenshots or brief live gameplay and launch standalone
  Electron. A passing smoke does not certify animation feel or AAA quality.
- Clean up only processes started for testing. Keep observations and unresolved
  visual/balance limits in [current state](game/docs/RESET.md), not dated appendices.
