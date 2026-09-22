# Lost Fiend — current slice

The September 2026 reset replaces the earlier multi-path Rogue Hero overhaul.
The current objective is a compact, repeatable isometric dungeon fight: read the
enemy, punish the commitment, escape the reply. This document records what is
implemented; [STYLE-AND-DESIGN.md](STYLE-AND-DESIGN.md) records why it looks and
plays this way.

## Playable flow

The title offers New run, Tutorial, Options, Achievements and Continue when a
checkpoint exists. The tutorial teaches movement, slash, heavy and dodge in an
enemy-free room; it suspends and restores an active run. A new run starts with a
skippable 2.6-second fall, landing and rise. Continue skips the intro and shows
the saved room. Escape opens Resume, Options and Exit run. Exit retains Continue;
defeat and victory clear it. Reloading Continue starts at the current room's entry
checkpoint. A new run asks before replacing a saved one.

Three encounters lead to the Bellwether. Cleared rooms advance through a
2.2-second walk/fade transition, restoring 18 health up to 100. There are no
between-room rewards or upgrade screens. Defeat and victory offer retry or title.
Achievements track 10 kills, 50 kills and boss defeat; they grant no power.

## Combat

- WASD moves relative to the screen; mouse aims. Left click chains three slash
  poses, right click commits to a heavier strike, Space dodges. Inputs buffer
  briefly; dodge cancels slash but not heavy. Pillars block movement and strikes.
- Knife Penitent lunges and flanks. Bell-bearer commits to a lane strike. Grave
  Cantor pulses an outer area with a safe inner pocket. Each has a recovery to
  exploit; ordinary enemies can be interrupted by heavy.
- Bellwether blocks movement. Phase I uses a lane strike and frontal sweep.
  At half health it braces and enters Phase II: outward toll with warned inward
  follow-up, split-lane strike and inner pulse. Its death finishes before victory.
- Hit timing is simulation-owned. The heavy contacts at 0.34 seconds in a
  0.86-second action. No hitstop. Movement and effects use one pause-aware clock.

## Presentation and menus

The title uses the same procedural crypt kit, materials and fixed orthographic
angle as combat, with restrained fire and dust. The palette is charcoal stone,
worn ivory, oxblood cloth and small candle amber. Player slash has a visible
waist-height sweep; heavy lifts and drops with an impact hold. Dash stays low and
grounded with short graphite scuffs and stone chips at boot level. Hits produce
brief target-local scars/chips and recoil. Small enemies sink on death; the boss
kneels, slumps and sinks. The bell has an occluded dark mouth and no visible
clapper or hand crossing its shell.

Menus and HUD share locally bundled IM Fell English 5.3.0, CSS color/type tokens,
dark chipped frames and plain wording. Options save master volume, brightness,
quality and control-hint preference. Screen mode can be toggled in Options but
is not persisted. Hints default off. Low
health adds an edge tint during play only. Labels stay separate from input keycaps.

## Code and saves

`src/sim.ts` owns seeded combat and checkpoints; `src/view.ts` owns Three.js
actors, environment and effects; `src/title-scene.ts` uses the same visual kit;
`src/main.ts` owns input, menus, audio, storage and the frame clock.
`electron-main.cjs` retains fixed origin and the legacy user-data location.
Current versioned keys are `rogue-hero.buried-bell.run.v1`,
`rogue-hero.buried-bell.volume.v1`, `rogue-hero.buried-bell.display.v1` and
`lost-fiend.achievements.v1`. Invalid current records are ignored. Incompatible
legacy runs remain untouched and cannot be continued in this smaller game.

Visible branding, executable, installer and shortcut say Lost Fiend. The repo,
package name, app ID, origin, user-data path and legacy keys retain historical
names for compatibility. The old overhaul source/archive is outside this repo at
`D:/SAAS2/Rogue-Hero-3-reference-20260920`; it is not the active backlog.

## Evidence and limits

On September 22, 2026, the production build passed and the single standalone
Electron smoke passed in 3.8 seconds before cleanup. It covered movement,
slash, heavy, dodge, pause/resume, volume and Continue.

The single Electron smoke has a 30-second deadline and also skips the intro.
A build and smoke establish basic function, not finished visual quality. Earlier brief
Chrome and Electron inspections covered title, Options, tutorial, combat HUD,
intro and selected attack poses. Full boss-cycle balance, death playback, room
transition timing, low-health appearance and the brief dash/hit effects still
need the owner's manual play review. The inherited executable icon is still a
clean gold sword badge and has not been judged against the darker current style.
Do not claim AAA quality from static checks.

Update this evidence with the date and observed result when doing a new review;
replace stale observations rather than appending a chronological log.
