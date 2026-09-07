# Reference direction — September 7, 2026

## Sources and decisions

- [Owner's shared conversation](https://chatgpt.com/share/6a9eb2e8-d29c-83e9-abfa-6b6cbf106e0f): retain the code-first Three.js/TypeScript/Vite stack; use reproducible Blender Python authoring; align anticipation, contact and recovery with gameplay timing. The public share's embedded conversation was read. Do not import its heavy testing recommendations: the owner explicitly requires quick smoke only.
- [Dungeon Lurker](https://store.steampowered.com/app/4669960/Dungeon_Lurker/): the Steam description emphasizes handcrafted dungeons, dark horror, real-time combat, hidden discoveries and equipment/spell/charm progression. Borrow the design emphasis, not its assets or identity. Its listing does not substantiate a specific parry or stamina model; do not invent one from the reference.
- [Three.js game skills](https://github.com/majidmanzarpour/threejs-game-skills), particularly its graphics-builder guidance: establish forms, materials and lighting before effects; judge at gameplay camera scale. This is reference material, not an installed dependency or permission to add AI-generated art.
- [Three.js tactics example](https://github.com/chongdashu/threejs-tactics-game) and its [cutscene/input learning](https://github.com/chongdashu/threejs-tactics-game/blob/main/learnings/cutscene-dialogue-phase-input-gating-and-speaker-focus.md): explicit scene phases, gated input, one completion/skip handoff, and speaker-aware framing. The public repository provides learning material, not the complete runtime implementation.

Hades remains the owner's primary fast-combat reference. Preserve responsive
movement and clear threats while strengthening the game's own funerary fantasy.

## Implemented in this pass

**Unravel:** sword + direct ability damage on one target, in either order within
4 seconds, exposes a seam for 3 seconds. Charged heavy cashes it out for +50%
damage and 10 tempo. Sustained ticks and secondary detonations cannot build it;
refused body hits cannot arm it. The target has a 3-second rearming delay after
cashout. It does not stun-lock bosses or bypass cover. Death removes the marker;
the simulation clock owns expiration. Room-local state is not checkpointed.

**Run choices:** Keeper's Thread extends seams to 5 seconds and refunds 0.75s on
all ability cooldowns per Unravel. Widow's Needle instead gives +100% charged
damage with only a 1.5-second seam. Needle's shorter duration takes precedence
when both are owned. Both use the existing relic draft, persistence, and unlock
paths, including existing profiles. No extra character or selection screen.

**Motion:** four Blender-evaluated clips drive the actual procedural Blade.
Charged heavy now has a distinct overhead strike instead of sharing the combo
finisher. Damage phases come from the same generated motion data. See
`art/blade/README.md` for editable source and reproducible export.

**Identity/story:** a swept ivory burial crown creates a stronger asymmetric
shoulder silhouette; the blade is wider for readability. Opening, act
transitions, Warden/Regent epitaphs and endings now connect the Blade's repeated
returns, lost memories, Mara and the kingdom's dependence on the star. Existing
scene motion, skipping and finalizers remain authoritative; prose must not
promise an on-screen action that the actor never performs.

## Verification boundaries

Production TypeScript/Vite build and the short Electron smoke are the automated
checks. A temporary development capture also checked seam exposure/cashout and
the charged contact pose. No new permanent tests or test dependencies were added.
Blender 5.2.1 successfully generated the bank and re-exported saved curves.
The smoke passed in 11.6 seconds including cleanup. A final targeted presentation
check passed in 8.4 seconds after correcting marker render ordering; the marked
target was inspected at the gameplay camera. Charge and attack body offsets are
absolute, fixing accumulation during paused/frozen redraws. Repeated phase-zero
redraws were checked for vertical drift. These temporary checks were not retained
as additional test entry points.

These checks establish operation, not universal bug freedom, final animation
quality or a AAA verdict. Full-run balance, longer-term build variety and player
enjoyment remain manual judgments. Review at the gameplay follow camera; a low
cinematic camera is not representative combat evidence.
