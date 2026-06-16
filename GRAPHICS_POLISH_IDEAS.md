# Rogue Hero 3 - Graphics Polish And Visual Upgrade Ideas

This is a graphics-first idea document only. It does not prescribe immediate
implementation, and it intentionally avoids making any gameplay or code changes.

The game already has a strong visual base: Three.js, procedural low-poly
characters, act themes, arena dressings, bloom/color grading, camera trauma,
attack telegraphs, pooled particles, sword trails, dodge ghosts, DOM HUD
effects, boss cutscenes, cosmetics, and quality presets. The opportunity now is
less "make it visible" and more "make it look authored, readable, and memorable
from any screenshot."

## Visual North Star

Aim for a readable dark-fantasy roguelike with procedural geometry that feels
intentional rather than placeholder. The best version should look like:

- High-contrast silhouettes over a clean combat floor.
- Bold hero, enemy, and boss identities readable at a glance.
- Act-specific spaces that feel like places, not only palette swaps.
- Effects that communicate mechanics first and spectacle second.
- Menus and HUD that feel fused to the rift-world instead of pasted over it.
- Screenshot-worthy boss reveals, act transitions, executions, and victory beats.

## Highest-Impact Passes

If only a handful of improvements get built, these are the strongest visual
return for effort.

1. **Act identity pass** - Give each act a distinctive arena floor pattern,
   horizon silhouette, ambient particle behavior, and obstacle style. Current
   hooks: `render/arena.ts`, `game/mapgen.ts`, `game/features.ts`.
2. **Enemy readability pass** - Add stronger shape language and color rules for
   enemy family, threat role, elite affix, shield, and status. Current hooks:
   `game/enemies.ts`, `game/enemies2.ts`, `game/affixes.ts`.
3. **Boss spectacle pass** - Give every boss a unique arena dressing overlay,
   phase transformation, telegraph language, and death visual. Current hooks:
   `game/boss*.ts`, `main.ts` boss cutscene section.
4. **Combat VFX taxonomy** - Standardize hit sparks, slash arcs, projectile
   trails, status bursts, shockwaves, and screen flashes by damage/status type.
   Current hooks: `render/particles.ts`, `render/trail.ts`, `game/combat.ts`,
   `game/projectiles.ts`.
5. **Hero presentation pass** - Upgrade hero select, idle poses, weapons, capes,
   overdrives, and cosmetic previews so each hero feels collectible. Current
   hooks: `game/player.ts`, `game/heroes.ts`, `game/cosmetics.ts`,
   `ui/menus.ts`.
6. **Photo/screenshot mode** - Add hide-HUD, pause, orbit/free camera, FOV,
   depth-of-field imitation, and PNG export. This directly helps marketing,
   playtest reports, and future visual QA.
7. **Visual regression screenshots** - The smoke scripts already support browser
   screenshots. Turn that into a repeatable before/after visual check for menus,
   combat, each act, each boss, and settings presets.

## Current Strengths To Preserve

- **Procedural identity.** The no-heavy-asset direction gives the project a clear
  technical identity. Prefer procedural meshes, generated textures, shader
  effects, and small optional bitmap assets over a full imported art pipeline.
- **Readable telegraphs.** The game already treats telegraphs as a fairness
  contract. Any visual upgrade should make tells clearer, never prettier but
  more ambiguous.
- **Bloom-friendly emissive style.** The current material language fits the game:
  dark bodies, emissive accents, additive VFX, and sharp silhouettes.
- **Performance discipline.** Pooled particles, shader warmup, shared geometry,
  and quality presets are worth keeping as constraints.
- **Live 3D behind menus.** The DOM screens already benefit from the arena
  rendering behind them. Better menu staging can build on that instead of
  replacing it.

## Art Direction Tightening

### 1. Define A Material Bible

Create a simple material vocabulary and stick to it:

- Rift crystal: translucent-looking emissive cyan/violet, faceted geometry.
- Warden armor: dark metal, low roughness, warm rim highlights.
- Ancient stone: matte, chipped, low emissive cracks.
- Void matter: nearly black, purple rim, particles drifting inward.
- Molten core: black slag with orange inner seams.
- Spire glass: jade/blue shards, high specular, thin silhouettes.
- Hollow Star: pale white-violet, inverted glow, quiet particles.

This would prevent every act from becoming "dark geometry with a different
neon accent."

### 2. Use Three Color Roles Per Scene

For each act/boss:

- **Base darkness** for the floor, props, and body masses.
- **Readable combat color** for player/enemy/telegraph contrast.
- **Signature accent** for the act fantasy.

Example: The Molten Core can use black slag base, white-hot player/enemy
readability, and orange lava accents. The Shattered Spire can use green-black
base, white/cyan readability, and jade glass accents.

### 3. Reduce "Everything Glows" Moments

Bloom is a strength, but it loses punch if all UI, floor lines, weapons,
telegraphs, particles, and enemies glow at once. Consider:

- A bloom budget per scene state.
- Lower idle floor emissive during high-combat VFX.
- Brighter telegraphs only during the danger window.
- Reserve white bloom for finishers, boss reveals, and victory.

## Arena And Environment Ideas

### Act-Specific Floor Identity

The current arena uses a generated grid/sigil texture. Expand it into a
theme-aware floor texture generator:

- Ember Rift: cracked obsidian disc, blue rift veins, broken rune rings.
- Shattered Spire: glass hex patterns, hairline fractures, mirrored wedges.
- Molten Core: black slag plates, glowing seams, occasional lava bubbles.
- Sundered Abyss: missing floor chunks, void stars below, unstable glyphs.
- Hollow Star: pale radial eclipse pattern, inward spiral, dim constellation
  marks.

Implementation idea: split `makeFloorTexture()` into per-theme painters and
swap/rebuild when `Arena.applyTheme()` changes themes.

### Per-Room Floor Variants

Instead of one floor per act, give rooms small procedural variants:

- Different center sigils.
- Different radial spoke counts.
- Scar patterns based on node kind.
- Elite rooms with sharper, more hostile floor geometry.
- Rest rooms with low-glow calm patterns.
- Shop/treasure/interstitial rooms with softer floor motifs.

This would make the generated map feel more traveled.

### Boss Arena Overlays

Boss rooms should look claimed by that boss:

- Pit Warden: impact craters, claw gouges, red-orange heat scars.
- Spire Caster: mirror shards, floating prism pylons, reflected false images.
- Colossus: heavy fissures, giant fist prints, molten pressure vents.
- Rift Tyrant: reactor rings, rotating machinery silhouettes, unstable arcs.
- Unmaker: eclipse shadow, dim star motes falling upward, final mercy glyph.
- Rift Echo: torn duplicate arena fragments offset around the edge.

These can be visual-only overlays that sit above the common floor.

### Horizon And Edge Silhouettes

The act dressings are already a good start. Push them further:

- Add large parallax silhouettes far beyond the arena edge.
- Use slow rotation or drift on distant shapes, not only nearby rocks.
- Give each act one unmistakable horizon shape:
  - Spire: tall glass towers.
  - Forge: furnace arches and slag chains.
  - Abyss: broken obelisks and missing chunks.
  - Hollow: star corona, eclipse ring, and collapsing fragments.
- Fade silhouettes into fog so combat readability stays clean.

### Environmental Storytelling Props

Add non-interactive details around the rim or just outside the playable floor:

- Broken banners or statues tied to fallen wardens.
- Old hero weapons embedded in the stone.
- Rift-corrupted shrines.
- Empty armor husks near elite rooms.
- Shop/rest nodes with a visible campfire, anvil, or relic pedestal.
- Lore fragments that glow only after room clear.

Keep them outside the combat center so they do not muddy movement.

### Room Entry And Clear Transformations

Use the arena itself to signal state:

- On room start, floor rings ignite outward from the spawn point.
- On enemy waves, side glyphs activate in the direction enemies will enter.
- On room clear, danger color drains from the floor and calm ambient motes rise.
- On elite clear, the floor cracks briefly and reveals a relic glow.
- On boss clear, boss-colored corruption burns away from the arena edge inward.

This would make state changes feel physical instead of purely HUD-driven.

### Visual-Only Destruction

Add lightweight, non-gameplay arena reactions:

- Crash nova ripples the floor texture or emits ring cracks.
- Boss slams briefly lift small floor shards.
- Heavy kills leave fading scorch marks.
- Projectiles that hit pillars throw sparks.
- Colossus attacks make rim crystals flicker.

These should fade quickly and be capped by a pool.

## Lighting, Postprocessing, And Camera

### Per-Act Color Grade Presets

The post chain already has bloom, hue/saturation, contrast, vignette, noise,
and SMAA. Add per-act grade values:

- Ember Rift: cooler shadows, cyan rim.
- Spire: cleaner contrast, sharper highlights, lower fog warmth.
- Forge: warmer exposure, stronger orange highlights, darker blacks.
- Abyss: lower saturation, stronger violet rim, softer vignette.
- Hollow Star: pale highlights, lower bloom threshold only during finale.

This can make each act feel authored without new models.

### Boss-Specific Exposure Beats

During boss entrances and phase changes:

- Slightly dim the environment before the reveal.
- Pulse exposure when the boss materializes.
- Add a short chromatic/aberration spike for corrupted bosses.
- For the Unmaker finale, do the opposite: reduce saturation and let the scene
  go quiet and pale.

### Fake Volumetric Light

Use transparent cones/cylinders and additive materials:

- Light shafts from boss spawn beams.
- Vertical spire rays.
- Forge heat columns.
- Hollow Star downward/inward beams.
- Shop/rest node sanctuary glow.

The project already uses beam meshes in particles/features, so this fits the
current style.

### Contact Shadow And Grounding Pass

Procedural low-poly characters can float visually if the floor does not anchor
them. Ideas:

- Add soft circular blob shadows under units on low/medium quality.
- Keep PCF shadows on high.
- Add a subtle contact ring under the player in hero color.
- Darken under bosses with larger soft discs.
- Make airborne/leaping enemies visibly separate from their ground shadow.

### Camera Composition Presets

The camera rig already supports menu/follow/cinematic modes. Add more authored
beats:

- Hero select orbit with each hero framed in a strong pose.
- Boss intro two-shot: player foreground, boss materializing in distance.
- Victory orbit with slower, lower camera and cleaner FOV.
- Death camera drifting toward the fallen hero.
- Map screen camera looking down at the floor sigil.

### Reduce-Motion Visual Alternatives

Reduce Motion currently affects shake and flash intensity. Add substitute
readability:

- Stronger static rings instead of shaking.
- Larger directional hit arrow instead of trauma.
- Lower chromatic aberration during hurt.
- Keep telegraph timings identical.
- Use quick scale/opacity cues instead of camera movement.

## Hero Graphics Ideas

### Hero Select 3D Showcase

Replace or augment static hero cards with the live player mesh:

- One hero displayed at center stage.
- Side buttons cycle heroes.
- Idle pose, weapon glow, cape color, blade color preview.
- Stats and starting cards stay in DOM panels.
- Locked heroes appear as dark silhouettes with their signature accent visible.

This would immediately make the game feel more premium.

### Stronger Hero Idle Poses

Each hero should read from silhouette before color:

- Blade: balanced stance, sword low and forward.
- Bulwark: shield braced, heavy shoulders, slower breathing.
- Sparkmage: staff/sword raised, floating orb orbiting.
- Reaver: hunched, weapon over shoulder, asymmetric weight.
- Tempest: narrow stance, blade trailing, fast foot taps.
- Revenant: floating or dragging posture, cowl shadow, unstable aura.

The existing procedural rig can support this with per-hero pose offsets.

### Cape And Cloth Motion

The cape is a major cosmetic surface. Improve it with:

- Sine-based flutter while moving.
- Stronger kickback during dodge.
- Cape snap on perfect dodge.
- Reaver cape torn into two or three strips.
- Tempest cape as ribbons.
- Revenant cape with subtle dissolve/flicker edge.
- High-quality optional vertex shader ripple.

### Weapon Identity

Weapons already vary per hero. Push them further:

- Blade gets a clean longsword with a brighter edge line.
- Bulwark gets a heavy sword plus clearer shield silhouette.
- Sparkmage staff gets orbiting runes while cards are ready.
- Reaver blade gets jagged teeth and blood-red execution glow.
- Tempest rapier leaves thinner, longer trails.
- Revenant blade flickers in and out with green/void motes.

### Overdrive Visual Language

Make Overdrive feel like a hero-specific super:

- Blade: concentric blade arcs and blue-white afterimages.
- Bulwark: golden guard plates lock around the body.
- Sparkmage: orbiting lightning runes and staff corona.
- Reaver: red slash scars hang in the air.
- Tempest: spiral wind trails and doubled footstep ghosts.
- Revenant: souls or green motes stream into the body.

### Cosmetics Beyond Color

Current cosmetics are cape and blade colors. Visual-only expansions:

- Trail styles: clean ribbon, sparks, smoke, glass shards, lightning braid.
- Aura styles: ring, sigil, flame, stars, broken runes.
- Cape patterns: stripes, sigils, torn hems, glowing trim.
- Victory poses.
- Hero skins that alter geometry but not stats.
- Boss-earned cosmetics tied to each warden.
- Depth-earned cosmetics for high-skill goals.

## Enemy And Elite Visual Ideas

### Enemy Role Shape Language

Make each role readable by outline:

- Charger/lunger: forward-leaning wedge.
- Ranged caster: tall, narrow, glowing hands/orb.
- Swarm: tiny, low, many repeated silhouettes.
- Shield/tank: wide front plane or wall.
- Bomber: round core, blinking fuse, unstable shell.
- Teleporter/warper: broken/discontinuous body pieces.
- Mirror/illusion enemy: duplicated offset shards.

Color should reinforce the read, but the silhouette should carry it.

### Elite Affix Ornamentation

Affix tint is useful, but affixes should also alter form:

- Hasted: winglets, ankle streaks, faster idle bob.
- Volatile: pulsing core, cracked shell, smoke leak.
- Regenerator: green ring, healing vines/runes, soft pulses.
- Frenzied: red jagged crown, erratic posture.
- Siphon: tether lines to nearby enemies.

This prevents color-only ambiguity and helps colorblind players.

### Champion Visual Treatment

Champions should look like mini-bosses:

- Larger model with extra crown/halo geometry.
- Two affix ornaments visibly stacked.
- Unique spawn beam color.
- Bigger HP bar with champion label.
- Death burst that feels rewarding but shorter than a boss death.

### Status Effects On Bodies

Add readable overlays:

- Freeze: icy shell facets, frost motes, blue-white crack lines.
- Burn: small flame cards/embers rising, orange edge glow.
- Bleed: dark red slash marks, dripping particles.
- Vulnerable: broken armor icon/ring, purple cracks.
- Stagger: stars/ring wobble, posture sag.
- Warded: bubble plus rotating runes, not just a ring.

### Enemy Spawn And Death Variety

Every enemy currently benefits from spawn beams and death particles. More ideas:

- Spire enemies assemble from glass shards.
- Forge enemies crawl out of sparks/slag.
- Abyss enemies invert inward, then pop into existence.
- Hollow enemies fade in as silhouettes before gaining detail.
- Death effects use enemy family material: glass shatter, ash burst, void implosion.

## Boss Graphics Ideas

### Boss Phase Transformations

Each phase should change the model, not only stats/attacks:

- Add glowing cracks after health thresholds.
- Break armor plates off.
- Add extra arms/orbs/shards.
- Change posture or hover height.
- Intensify eye/core materials.
- Alter the boss arena overlay as the fight escalates.

### Boss-Specific Telegraph Languages

Telegraphs can stay mechanically consistent while looking boss-authored:

- Pit Warden: red-orange impact circles with claw notches.
- Spire Caster: thin geometric glass lines and mirror reflections.
- Colossus: heavy stone rings with safe-lane cracks.
- Tyrant: rotating machinery arcs and reactor hazard bars.
- Unmaker: star/eclipse rings, inward sweeps, pale danger color.
- Rift Echo: duplicated delayed telegraphs offset from the real one.

### Boss Cutscene Upgrade Ideas

The current boss cutscene system already has a useful structure: letterbox on,
music duck, camera dolly to spawn, timed ring/burst beats, boss materialization,
title banner, boss-specific color palettes, aftershock variants, skip handling,
and separate phase cutscenes. The best next step is to make those beats feel
more authored per boss instead of sharing one mostly common sequence.

#### Cutscene Beat Structure

Give every boss intro a consistent cinematic grammar:

1. **Establish** - Wide shot shows the arena and the boss-corrupted floor.
2. **Omen** - The environment reacts before the boss appears.
3. **Summon** - Energy gathers at the spawn point with boss-specific shapes.
4. **Reveal** - Boss model materializes in a strong silhouette pose.
5. **Threat read** - Camera holds long enough to show the weapon/core/body plan.
6. **Title slam** - Name, subtitle, roar/sting, and final VFX burst.
7. **Return to control** - Camera eases back to follow mode and telegraphs begin.

This keeps the sequence readable and reusable while letting each boss own its
omen, summon, reveal, and aftershock.

#### Per-Boss Intro Concepts

- Pit Warden: the arena floor cracks in three claw marks, embers pull inward,
  then the Warden lands from above with a heavy dust ring.
- Spire Caster: mirror shards rise around the spawn point, briefly showing
  false copies before one reflection becomes real.
- Colossus: the camera trembles before anything appears, two giant fists punch
  up through the floor, then the body hauls itself into view.
- Rift Tyrant: reactor rings rotate around an empty point, lock into alignment,
  then the core ignites and armor plates assemble around it.
- Unmaker: all audio drops low, particles fall upward, the arena dims, and a
  small star unfolds into the boss without a conventional roar.
- Rift Echo: the camera frames an empty arena, the boss appears in multiple
  offset positions, then all copies snap into one body.

#### Phase Cutscene Variants

Phase cutscenes should communicate what changed, not only announce "Phase N":

- Add or expose a new boss weak point.
- Break armor or remove a mask.
- Change the boss posture, hover height, or silhouette.
- Recolor the arena overlay to match the new attack set.
- Show the next mechanic in a harmless preview for half a second.
- Let the boss perform a non-damaging signature motion before control returns.
- For the Unmaker finale, avoid the usual roar/flash language and make the beat
  quieter, slower, and sadder.

#### Player Framing

Cutscenes will feel more dramatic if the hero is part of the shot:

- Start some intros with the player in foreground and the boss spawn behind.
- Rotate the hero toward the spawn during the omen beat.
- Use a subtle cape/weapon reaction when the boss appears.
- Show scale by placing the hero near the bottom of the frame for large bosses.
- Return from the cutscene with the player already readable and centered.

#### Camera And Motion Polish

Camera ideas that fit the current `CameraRig.cinematic()` model:

- Add named shot presets: wide, low, close, two-shot, overhead, return.
- Ease between shots with per-beat durations instead of one continuous zoom.
- Use lower FOV for scale-heavy reveals and wider FOV for chaotic bosses.
- Add a brief orbit for bosses with interesting silhouettes.
- Avoid long shake during the title card so the name stays readable.
- Support Reduce Motion by replacing shake-heavy beats with stronger static
  framing, rings, and title animation.

#### Title Card And Boss Bar Polish

- Give each boss title card a unique frame, icon, and color pair.
- Delay the boss bar reveal until after the title slam finishes.
- Add a boss portrait silhouette or procedural emblem beside the bar.
- Animate the boss name as if it is being carved, mirrored, burned, or eclipsed
  based on boss identity.
- Use shorter subtitle copy so the player can read it before control returns.

#### Audio And VFX Sync

The visuals should lock to sound cues:

- Ring pulse on low drum hit.
- Materialization flash on boss roar or sting.
- Camera kick only on the impact transient.
- Boss title appears exactly with the first full silhouette frame.
- Music duck starts before the omen and recovers after the camera returns.
- Final boss phase uses music and silence more than loud impact.

#### Cutscene Authoring System

If this grows, move from ad hoc timers to a small data-driven beat list:

```ts
type BossCutsceneBeat =
  | { at: number; kind: "camera"; shot: "wide" | "close" | "twoShot"; zoom?: number }
  | { at: number; kind: "ring"; radius: number; color: number; duration: number }
  | { at: number; kind: "burst"; preset: string; colorA: number; colorB: number }
  | { at: number; kind: "banner"; title: string; subtitle: string }
  | { at: number; kind: "sound"; cue: string }
  | { at: number; kind: "flash"; color: string; intensity: number };
```

That would let each boss define an intro script while reusing the same safe
timer cleanup, skip behavior, letterbox, music ducking, and camera return.

#### Cutscene Safety Rules

- Keep skip available after a short grace window.
- Never let skip leave the camera, input, letterbox, music duck, or intervals in
  a bad state.
- Do not let phase cutscenes interrupt other cutscenes.
- Freeze the world only when the player also cannot act.
- Avoid hiding active telegraphs under title cards.
- Make every cutscene work with keyboard, mouse, and gamepad skip.
- Keep intros short enough that replayed bosses do not become tedious.

#### Cutscene Validation

Add screenshot or smoke coverage for:

- Each boss entrance at reveal frame.
- Each boss title card.
- Each phase transition.
- Skipping before and after reveal.
- Reduce Motion cutscene behavior.
- Low preset cutscene readability.
- Final Unmaker lament/mercy visual state.

### Boss Portraits Without Asset Bloat

For title cards and boss bars:

- Generate a simple procedural silhouette portrait from boss geometry.
- Use CSS masks or canvas-drawn icon portraits.
- Add boss-specific frame ornaments.
- Animate the portrait glow during phase changes.

This gives menus/HUD more authored identity without a full illustration pipeline.

### Death And Victory Beats

Current boss deaths already have cutscene hooks. Upgrade each:

- Warden collapses into molten chunks.
- Spire Caster shatters upward into glass.
- Colossus sinks into the floor, leaving a crater.
- Tyrant reactor spins down, then blows outward.
- Unmaker folds into a small star and fades.
- Echo splits into copies before evaporating.

After death, leave a short-lived arena mark where the boss fell.

### Mercy Ending Visual Pass

For the Hollow Star mercy ending:

- Shift grade from violent violet to quiet dawn white.
- Replace hostile particles with slow upward motes.
- Remove arena edge corruption progressively.
- Add a final still silhouette of hero and star before fade.
- Use a calm floor sigil instead of combat red.

## Combat VFX Ideas

### Hit Spark Families

Create a small library of hit reactions:

- Metal hit: short white/yellow sparks.
- Flesh/void hit: dark red/purple motes.
- Shield hit: radial shards and a hard ring.
- Heavy hit: bigger directional fan.
- Crit/finisher: white core flash plus colored trail.
- Warded hit: deflection arc that points away from boss.

### Slash Arc Upgrade

The sword trail is strong. Add:

- Distinct first/second/third-hit trail widths.
- Heavy finisher as a wider crescent.
- Hero-specific trail shapes.
- Trail color gradient from white core to cosmetic color.
- Sparks when slash intersects enemies or shields.
- Reduced-motion version with less trail persistence.

### Projectile Trail Upgrade

Projectiles can carry more identity:

- Arc-bolt: thin lightning jitter line.
- Fire/ember projectile: smoke and ember tail.
- Frost projectile: crystalline flakes.
- Void projectile: inward particle suction.
- Piercing shot: sharper spear trail.
- Boss lances: pre-fire charge at origin plus afterimage.

### Card Cast Visuals

Give every card a signature cast read:

- Small hand/weapon glow before cast.
- Ground sigil or direction marker.
- Cooldown-ready sparkle around the card slot and player weapon.
- Upgraded cards add extra geometry or a secondary color.
- Failed cast gets a clear dull flash instead of only slot shake.

### Execution Moments

Executions already exist mechanically. Visual ideas:

- Brief enemy outline flash before the finishing blow.
- Special slash trail on execution.
- Camera micro-kick, not hitstop.
- Enemy body splits into stylized shards/motes.
- Shards/currency fly toward the HUD after elite/boss execution.

### Combat Floor Feedback

Make combat affect the arena:

- Each hit emits a tiny floor ripple.
- Perfect dodge leaves a clean circular afterimage.
- Crash nova briefly reveals hidden floor glyphs.
- Cold crash adds frost cracks that fade.
- Overdrive changes floor ring color around the hero.

## Telegraph And Readability Ideas

### Telegraph Pattern Library

Add patterns in addition to color:

- Dashed circle for delayed AoE.
- Solid ring for immediate danger.
- Striped line for beam/sweep.
- Chevron wedges for dash paths.
- Inner safe/outer danger shown with different hatch density.

This helps colorblind players and makes hard fights fairer.

### Telegraph Height And Layering

Some telegraphs can be more readable if they exist in two layers:

- Ground layer shows exact hit area.
- Low vertical wall/beam shows direction and timing.
- Bright sweep shows current charge progress.

Use this for boss beams and long line attacks.

### Safe-Lane Language

For attacks with safe lanes:

- Use danger bands that leave visibly clean lanes.
- Add faint "safe shimmer" only during tutorial/early depth.
- Avoid filling the entire arena with similar opacity.
- Make ring attacks visually distinct from full-circle AoE.

### Off-Screen Threat Markers

When enemies attack from outside camera focus:

- Edge glows pointing toward the attack source.
- Small floor arrow near player.
- Distant projectile trails brightened when entering screen.
- Optional setting to increase off-screen indicators.

## UI And Menu Graphics

### Main Menu Scene

Make the first screen a miniature visual pitch:

- Live arena orbit with the selected hero standing in the center.
- Recent unlocked cosmetics visible.
- Continue Run subtly changes the scene to the saved act theme.
- Menu buttons stay simple but feel anchored to the world.
- Background camera slowly shows rim dressings and sky.

### Map Screen Visual Upgrade

The generated forked path can look more physical:

- Nodes projected onto the arena floor as glowing constellation points.
- Chosen path burns in behind the player.
- Boss node is a larger sealed gate/sigil.
- Rest/shop/treasure have distinctive symbols and colors.
- Hidden Rift Tear node flickers/glitches.

### Draft Card Art Without Illustrations

Cards can look richer without full card art:

- Procedural icon per card type.
- Animated rarity border.
- Background sigil based on card tags.
- Upgraded card gets a second bright inner border.
- Synergy highlights as connected runes, not just text.

### Relic And Armory Presentation

Relics and cosmetics are collectible, so make them feel tactile:

- 3D spinning relic icons generated from simple geometry.
- Hover glow tied to rarity.
- Locked silhouettes with hint glow.
- Armory mannequin showing cape/blade/aura/trail changes live.
- Boss-earned cosmetics displayed in boss-themed frames.

### HUD Clarity Pass

Ideas:

- Tone down HUD glow when combat VFX are intense.
- Add a compact "critical info only" HUD mode.
- Make boss bar frame boss-specific.
- Use stronger cooldown fill contrast on card slots.
- Add icon+color+shape for status effects.
- Ensure damage numbers do not stack over telegraphs in boss fights.

### Settings Visual Preview

Settings can preview graphics choices:

- Quality preset preview thumbnail or live mini scene.
- Bloom/chromatic/noise toggles if exposed later.
- Reduce Motion preview.
- Brightness calibration symbol.
- Colorblind telegraph preview.

## Menus, Store Assets, And Presentation

### Photo Mode

Features:

- Pause and hide HUD.
- Orbit/free camera.
- FOV slider.
- Roll angle.
- Toggle post effects.
- Toggle particles.
- Freeze/unfreeze animation frame.
- Export screenshot.
- Quick presets: combat, portrait, boss, arena.

### Trailer Capture Mode

Add debug-only capture helpers:

- Jump to boss intro.
- Spawn a fixed wave.
- Force specific act theme.
- Trigger victory/death/overdrive visuals.
- Slow camera orbit without changing gameplay speed.
- Hide debug text and cursor.

### App And Installer Visuals

Shipping polish ideas:

- Custom app icon.
- Installer header/banner.
- Main executable icon.
- Splash/loading screen if cold start becomes noticeable.
- Steam capsule art generated from in-game screenshot plus title treatment.

### Screenshot Targets

Plan screenshots for:

- Main menu with hero.
- Hero select.
- Map choice.
- Card draft.
- Each act arena.
- Each boss intro.
- Overdrive.
- Crash nova.
- Victory.
- Mercy ending.

## Technical Graphics Ideas

### Visual Debug Overlay

Add a graphics debug panel:

- FPS.
- Draw calls.
- Triangles.
- Active particles.
- Active telegraphs.
- Post preset.
- DPR.
- Shadow map size.
- Current theme.
- Current room feature.

This would make polish work faster and safer.

### Screenshot Smoke Matrix

Extend smoke tests to capture:

- Main menu.
- Hero select.
- First combat room.
- Each act theme.
- Each boss intro.
- Settings low/medium/high.
- Reduce Motion on/off.
- Colorblind mode on/off.

Then compare images manually at first, later with thresholds.

### Quality Preset Expansion

Current presets are Low/Medium/High. Consider granular controls:

- Bloom on/off/intensity.
- Chromatic aberration on/off.
- Noise/film grain on/off.
- Vignette intensity.
- Shadow quality.
- Render scale.
- Particle density.
- Ambient dressing density.
- Camera shake already exists; keep it.

### Performance Budgets

Proposed target budgets:

- 60 FPS during worst-case combat on a midrange laptop.
- Low preset stable on integrated graphics.
- No shader compile hitch during first boss/projectile/effect.
- Particle count capped under known limits.
- No per-frame material/geometry allocation in hot combat paths.
- Boss intro effects capped independently from combat effects.

### Geometry And Material Reuse

Continue the existing shared-geometry style:

- Shared primitive caches for enemy ornaments.
- Instanced edge dressing where practical.
- Shared material pools by theme/status.
- Reuse telegraph geometries for hazards.
- Avoid unique material creation per particle/status tick.

### Procedural Texture Library

Small generated canvases can do a lot:

- Floor cracks.
- Rune masks.
- Noise ramps.
- Dissolve masks.
- Card backgrounds.
- Relic icon backplates.
- Cape patterns.
- Boss title textures.

Cache by theme/seed/settings so transitions stay smooth.

### Optional Asset Strategy

If the game ever relaxes the zero-art-assets idea, keep assets selective:

- App icon and store art are worth it.
- A few hand-painted noise/mask textures can improve shaders.
- Full character sprite/model imports are a larger pipeline commitment.
- Avoid adding large asset dependencies until the procedural art direction is
  intentionally exhausted.

## Accessibility And Readability

### Colorblind-Safe Combat

The code already has a colorblind tempo palette path. Extend that idea:

- Telegraph patterns, not only colors.
- Affix ornaments, not only tints.
- Status effect icons/shapes.
- Enemy role silhouettes.
- Optional high-contrast floor mode.
- Separate "danger color" from "act accent color."

### Visual Noise Controls

Offer toggles/sliders:

- Particle density.
- Screen flash intensity.
- Bloom intensity.
- Damage number size.
- HUD animation intensity.
- Background dressing density.
- Camera shake already exists.

### Readability Review Checklist

For every new visual:

- Can the player see the exact hit area?
- Is the player's position always clear?
- Is the boss/enemy windup readable before the attack?
- Does the effect hide projectiles?
- Does the UI remain legible over the scene?
- Does it work in colorblind mode?
- Does it work with Reduce Motion?
- Does low quality preserve gameplay information?

## Suggested Visual Upgrade Bundles

### Bundle A: Screenshot Upgrade

Goal: make the game look better immediately in still images.

- Act-specific floor texture variants.
- Better hero select presentation.
- Boss title card styling.
- Stronger enemy silhouettes.
- Main menu camera staging.
- Custom app icon.

### Bundle B: Combat Readability Upgrade

Goal: make hard fights easier to parse while looking better.

- Telegraph pattern library.
- Status overlays.
- Enemy role shape pass.
- Affix ornaments.
- Off-screen threat markers.
- Reduce Motion alternatives.

### Bundle C: Boss Spectacle Upgrade

Goal: make bosses feel like the marketing moments.

- Boss arena overlays.
- Per-boss cutscene scripts.
- Boss phase cutscene variants.
- Phase model transformations.
- Boss-specific telegraph styles.
- Unique boss death visuals.
- Boss bar portrait/frame.
- Screenshot smoke for each boss intro.

### Bundle D: Cosmetics And Progression Upgrade

Goal: make progression more visually rewarding.

- Trail cosmetics.
- Aura cosmetics.
- Cape pattern cosmetics.
- Victory poses.
- Armory mannequin preview.
- Boss-earned cosmetic frames.

### Bundle E: Technical Art Pipeline Upgrade

Goal: make future graphics work safer and faster.

- Visual debug overlay.
- Screenshot smoke matrix.
- Generated texture cache.
- Material/geometry reuse audit.
- Expanded quality settings.
- Performance budget documentation.

## Phased Roadmap

### Phase 1: Fast Visual Wins

- Add per-act floor texture variants.
- Add affix ornaments.
- Tune bloom/exposure per act.
- Add boss-specific title card frame colors.
- Add screenshot targets for menu, combat, and one boss.

### Phase 2: Readability And Identity

- Enemy role silhouette pass.
- Telegraph pattern library.
- Status effect overlays.
- Boss arena overlays.
- Hero idle pose pass.

### Phase 3: Premium Presentation

- Hero select 3D showcase.
- Photo mode.
- Boss phase transformations.
- Unique boss death visuals.
- Armory mannequin and cosmetic previews.

### Phase 4: Shipping Visual Polish

- App icon and installer art.
- Store screenshot/trailer capture flow.
- Full screenshot smoke matrix.
- Granular visual settings.
- Final performance pass on Low/Medium/High.

## Concrete Backlog

| Idea | Impact | Effort | Primary Hook |
|---|---:|---:|---|
| Per-act generated floor textures | High | M | `render/arena.ts` |
| Boss arena overlay meshes | High | M | `game/boss*.ts`, `render/arena.ts` |
| Per-boss cutscene scripts | High | M | `main.ts`, `render/cameraRig.ts` |
| Boss phase cutscene variants | High | M | `main.ts`, `game/boss*.ts` |
| Enemy affix geometry ornaments | High | M | `game/affixes.ts`, `game/enemies.ts` |
| Telegraph patterns/hatching | High | M | `render/telegraphs.ts` |
| Hero select live 3D preview | High | M/L | `ui/menus.ts`, `game/player.ts` |
| Photo mode | High | M | `main.ts`, `render/cameraRig.ts`, `ui/menus.ts` |
| Boss death visuals | High | M | `main.ts`, `game/boss*.ts` |
| Per-act post grade | Medium | S/M | `render/stage.ts`, `render/arena.ts` |
| Cape motion pass | Medium | S/M | `game/player.ts` |
| Trail cosmetic slot | Medium | M | `game/cosmetics.ts`, `render/trail.ts` |
| Aura cosmetic slot | Medium | M | `game/cosmetics.ts`, `game/player.ts` |
| Status body overlays | Medium | M | `game/enemies.ts`, `game/combat.ts` |
| Projectile trail variants | Medium | S/M | `game/projectiles.ts`, `render/particles.ts` |
| Map screen visual upgrade | Medium | M | `ui/menus.ts`, `game/mapgen.ts` |
| Relic/card procedural icons | Medium | M | `ui/menus.ts`, `game/cards.ts`, `game/relics.ts` |
| Visual debug overlay | Medium | S/M | `render/stage.ts`, `ui/hud.ts` |
| Screenshot smoke matrix | Medium | S/M | `game/scripts/smoke-*.mjs` |
| App icon and installer art | Medium | S | `game/package.json`, `game/build/` |
| Granular graphics settings | Medium | M | `render/stage.ts`, `ui/menus.ts` |
| Main menu hero staging | Medium | M | `main.ts`, `ui/menus.ts`, `cameraRig.ts` |
| Boss portrait/title ornaments | Medium | M | `ui/hud.ts`, `ui/menus.ts` |
| Boss cutscene skip/readability smoke tests | Medium | S/M | `game/scripts/smoke-*.mjs` |
| Low-quality blob shadows | Medium | S | `game/player.ts`, `game/enemies.ts` |
| Room clear floor transformation | Medium | M | `main.ts`, `render/arena.ts` |
| Environmental story props | Medium | M | `render/arena.ts`, `game/mapgen.ts` |
| Trailer capture helpers | Nice | S/M | `main.ts`, smoke/debug scripts |
| Procedural cape patterns | Nice | M | `game/cosmetics.ts`, `game/player.ts` |
| Menu background act based on save | Nice | S/M | `ui/menus.ts`, `game/profile.ts` |
| High-contrast floor mode | Nice | S/M | `render/arena.ts`, `ui/menus.ts` |
| Optional volumetric beams | Nice | S | `render/particles.ts`, `game/features.ts` |
| Death scorch/fade decals | Nice | M | `render/arena.ts`, `game/combat.ts` |

## Validation Notes For Any Future Graphics Work

For graphics changes, a good verification pass should include:

1. `cd game && npm run verify`
2. Browser or Electron smoke of at least one combat room.
3. Screenshot check at desktop resolution.
4. Low/Medium/High quality preset check.
5. Reduce Motion and colorblind setting check if telegraphs, flashes, or palette
   behavior changed.
6. Boss intro screenshot if boss/camera/post effects changed.
7. FPS/draw-call sanity check if new geometry, particles, or post effects were
   added.

## Open Design Decisions

- Should the game stay strictly procedural for all in-game visuals, or allow a
  small curated texture/icon set?
- Should cosmetics remain color-first, or expand into geometry and VFX styles?
- Should boss arenas be purely visual overlays, or can they subtly affect room
  hazards later?
- Should photo mode be player-facing, debug-only, or both?
- Should visual regression be a CI gate or a manual artifact for review?
- How much darkness is acceptable before readability suffers on average monitors?
- Should the final act intentionally break the normal color rules for emotional
  contrast?

## Recommendation

The first serious graphics pass should combine **act identity**, **enemy
readability**, and **boss spectacle**. Those three areas improve screenshots,
game feel, and player comprehension at the same time. A good initial slice would
be: per-act floor textures, affix ornaments, boss arena overlays for one boss,
and a screenshot smoke path to compare before and after.
