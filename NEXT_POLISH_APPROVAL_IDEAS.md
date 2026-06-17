# Next Polish Approval Ideas

Small candidate list for the next Rogue Hero 3 polish pass. Pick any subset and
we can implement them as focused, testable slices.

## 1. Enemy Role Silhouette Pass

Give each common enemy role a more readable body outline: chargers lean forward,
casters get taller antenna/crown shapes, bombers carry a glowing core, and
shielded enemies get obvious shoulder plates.

- Why: improves combat readability and screenshot variety.
- Likely hooks: `game/src/game/enemies.ts`, enemy-specific mesh builders.
- Verification: browser combat smoke plus screenshots of mixed enemy groups.

## 2. Boss Death And Victory Beats

Add unique visual exits for each boss: Warden burns out, Spire fractures into
glass, Colossus collapses into slag, Tyrant tears open a rift, Unmaker fades
quietly, and Echo shatters into duplicates.

- Why: makes boss wins feel earned instead of ending abruptly.
- Likely hooks: boss defeat events in `game/src/main.ts`, boss classes, VFX.
- Verification: boss defeat smoke screenshots and no stuck cutscene state.

## 3. Hit Reaction VFX Families

Create different hit effects for metal, void, shield, heavy, crit, and warded
hits instead of using one general spark style.

- Why: adds polish while also telling the player what type of hit landed.
- Likely hooks: `game/src/game/combat.ts`, `game/src/render/particles.ts`.
- Verification: targeted combat smoke with screenshots for shield and crit hits.

## 4. Room Clear Floor Transformation

When a room is cleared, danger color drains from the floor and calm motes rise
from the arena. Elite and boss rooms could get stronger burn-away effects.

- Why: turns room state changes into visual feedback, not only HUD/menu changes.
- Likely hooks: `ROOM_CLEARED` handling in `game/src/main.ts`, arena VFX helpers.
- Verification: flow smoke plus before/after room-clear screenshots.

## 5. Main Menu Scene Upgrade

Make the main menu show the hero on the current arena floor with slow camera
orbit, drifting act props, and a cleaner title composition.

- Why: improves first impression without touching gameplay balance.
- Likely hooks: `game/src/ui/menus.ts`, `game/src/main.ts`, camera rig.
- Verification: menu screenshot smoke at desktop and mobile-ish viewport.

## 6. Off-Screen Threat Markers

Add subtle edge glows or small floor arrows when dangerous enemies or projectiles
attack from outside the current camera focus.

- Why: reduces unfair-feeling damage in busy rooms while adding visual polish.
- Likely hooks: controller/camera visibility checks, HUD or arena overlay layer.
- Verification: targeted smoke with enemies/projectiles spawned near screen edge.

## 7. Card Cast Anticipation And Ready Glow

Add a brief weapon/hand glow before card casts and a restrained ready shimmer on
fully cooled card slots.

- Why: makes cards feel more physical and easier to parse during fights.
- Likely hooks: `game/src/game/cards.ts`, `game/src/ui/hud.ts`, player VFX.
- Verification: card smoke screenshots with normal and reduce-motion settings.

## Recommended First Picks

Best next small bundle:

1. Enemy Role Silhouette Pass
2. Hit Reaction VFX Families
3. Room Clear Floor Transformation

These improve moment-to-moment readability, screenshots, and game feel without
requiring new systems or large balance changes.
