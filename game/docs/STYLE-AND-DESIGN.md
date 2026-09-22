# Lost Fiend — style and design decisions

## What the game should feel like

A short, hard, readable fight in a worn crypt. Two attacks and a dash are enough
if each has a clear purpose and satisfying physical weight. Slash is the quick
answer to a small opening; heavy is a risky commitment with a stronger payoff;
dash is a grounded escape or reposition, not a superhero burst. Enemies should
make the player notice their tell, move deliberately and use their recovery.
The Bellwether's second phase changes the spatial problem, not just its speed.

## Visual language

- The accepted look is minimal, gritty isometric dungeon: weathered stone,
  crushed blacks, worn ivory, muted blood-red cloth and scarce warm fire.
  Hard shadows and empty space give silhouettes room to read.
- Keep models graphic at gameplay scale. Feet contact the floor; attacks have
  anticipation, contact and recovery. Strong poses matter more than geometry
  count. The boss should feel heavy and distinct without filling the view with
  effects. Every warning must match its actual danger area.
- Motion stays restrained between attacks. The title scene looks into the same
  crypt as the run, with just enough fire/dust movement to feel alive.
- Hit feedback belongs at the struck enemy and ends quickly. Dodge scuffs stay
  near the ground. Low-health red is an edge cue, not a full-screen wash.

The owner rejected a frontal toy-like cathedral, bright fantasy glow, floating
map edges, ornate military/metal UI, Halloween/storybook fonts and blocky
“Roblox” character detail. Earlier survival-horror and gothic game references
are mood and hierarchy lessons, not assets or a request to change camera/style.
Use the current game as the reference when extending art.

## Interface and words

The interface should feel like the same place as the arena: worn print on dark
stone, one serif family, clear size hierarchy, subtle focus treatment and enough
space between options. Menus have a single obvious next action. Title: start,
learn, adjust settings, review achievements, or continue at the named location.
Tutorial: four short instructions. Pause: resume, adjust options, or exit.

Words should tell players what happens. Prefer “Continue — Bellwether” to a
checkpoint explanation; “Dash” and a separate `Space` keycap to “Space Dash”.
Do not add slogans, ominous one-line poetry, chamber counts as sales copy,
character epithets in the HUD, or paragraph-long lore panels. Story can live in
the atmosphere and concise action, without interrupting this slice.

## Iteration rule

Improve the smallest observable problem first: timing, silhouette, target-local
feedback, tell clarity, menu hierarchy or room composition. Verify with a brief
play or full-size screenshot at the gameplay camera. If a new feature needs a
bar, tutorial paragraph, reward economy or major framework, keep this slice
simple and revisit the idea only after the core fights withstand manual play.
