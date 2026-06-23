# Rogue Hero 3 Combat Look And Feel Audit

Date: 2026-06-18

Scope: audit only. No source, asset, package, or existing-doc changes were made.

Reviewed:

- Project guides: `README.md`, `CLAUDE.md`, `game/README.md`
- Existing idea docs: `POLISH_IDEAS.md`, `IMPROVEMENT_IDEAS.md`, `GRAPHICS_POLISH_IDEAS.md`, `NEXT_POLISH_APPROVAL_IDEAS.md`, `improve.md`
- Core implementation: `game/src/game/player.ts`, `game/src/game/heroes.ts`, `game/src/game/enemies.ts`, `game/src/game/enemies2.ts`, `game/src/game/combat.ts`, `game/src/game/controller.ts`
- Visual evidence: recent ignored smoke screenshots in `game/shots/`
- Verification check: `npm run typecheck` passed

## Executive Read

Rogue Hero 3 is not missing enough systems to explain the current look-and-feel concern. The game already has a strong procedural-art foundation, a wide enemy roster, readable telegraphs, camera trauma, postprocessing, slash arcs, damage floaters, particles, parry, charged heavy, executions, crash nova, Overdrive, and a large smoke-test suite.

The main weakness is that the bodies are not carrying enough of the fantasy yet. The hero, enemies, and combat are often readable because rings, glow, HUD, and particles are readable. They should be readable because the hero has weight, enemies have threat posture, and hits look like physical contact.

The highest-value direction is not "add more enemies" or "add more content." It is a character-and-combat presentation pass.

## 1. Professionalize Hero Locomotion And Combat Animation

### Current Finding

The player model is a detailed procedural rig, but the locomotion is still driven by a compact sine-wave gait in `Player.update`. It moves the legs, body bob, cape, and arms, but it does not yet have convincing foot plants, acceleration, braking, strafing weight, or hero-specific movement style. This matches the note in `improve.md`: the hero's legs read like a waddle.

The current smoke test (`smoke-player-animation.mjs`) checks useful technical signals, such as leg stride, restrained side sway, cape stability, and mesh detail. It does not judge whether the motion looks professional in play.

### Why This Matters

The hero is the one thing the player watches for the entire run. If normal movement looks amateurish, every fight inherits that feeling even when combat systems are mechanically solid.

### Improvement

Build a procedural locomotion pass around "weight and intent":

- Add foot-plant phases so each foot briefly locks instead of sliding through a constant sine cycle.
- Add acceleration and braking poses: lean into movement, settle on stop, slight recoil after a dash.
- Make strafing, backpedaling, and forward running look different instead of using one stride with sign changes.
- Give each hero a movement identity: Bulwark heavy planted steps, Tempest quick light steps, Reaver predatory forward lean, Sparkmage hovering/caster posture.
- Improve transitions between idle, run, dodge, attack windup, strike, and recovery.
- Add restrained secondary motion for sword, cape, shoulders, and head so the rig feels alive without visual noise.

### Likely Hooks

- `game/src/game/player.ts`
- `game/src/game/heroes.ts`
- `game/scripts/smoke-player-animation.mjs`

### Suggested Acceptance Criteria

- A still screenshot no longer needs explanation to show the hero is mid-stride.
- The hero can move diagonally, sideways, backward, and forward without the same leg cycle reading as a waddle.
- Each unlocked hero has a recognizable stance or gait before color is considered.
- New smoke coverage captures several movement phases, not just one screenshot.

Impact: Very high  
Effort: Medium to large  
Priority: First

## 2. Make Enemy Bodies Communicate Role And Intent

### Current Finding

The enemy roster is much stronger than a placeholder set. `enemies.ts` and `enemies2.ts` already define distinct meshes, colors, telegraphs, affixes, shields, status behavior, and several different behaviors. The issue is visual hierarchy: in combat screenshots, attack rings, floor effects, and glow often speak louder than enemy posture.

Enemies currently communicate a lot through telegraph geometry and emissive windup, which is fair and readable. But a better-feeling action game also lets the player read intent from the body before the ground marker finishes the sentence.

### Why This Matters

Better enemy body language improves both feel and fairness. The player should know "that charger is coiling," "that caster is committing," or "that shield unit is bracing" from silhouette and pose, not only from red circles.

### Improvement

Do an enemy role-pose pass:

- Chargers crouch, lower their head, scrape forward, then launch.
- Casters raise the orb/staff, pull energy inward, then release.
- Bombers visibly swell, shake, spark, and become more unstable as the fuse runs down.
- Shield enemies brace behind a larger readable front plane, then expose a vulnerable recovery pose.
- Fliers hover with a distinct bob/orbit language that reads as aerial even from the top-down camera.
- Elite affixes get bigger animated ornaments, not just small crowns/tints.
- Status effects show on bodies: freeze as locked posture and frost shell, burn as ember cracks, vulnerable as a bright exposed core.

This should not replace telegraphs. Telegraphs are the fairness contract. The body language should make the telegraphs feel authored instead of purely mechanical.

### Likely Hooks

- `game/src/game/enemies.ts`
- `game/src/game/enemies2.ts`
- `game/src/game/affixes.ts`
- `game/src/render/telegraphs.ts`
- `game/scripts/smoke-enemy-visual.mjs`

### Suggested Acceptance Criteria

- In a screenshot with HUD disabled, a player can identify charger, caster, shield, flier, bomber, and elite roles from silhouette alone.
- Each enemy's windup is visible on the body at least 0.2-0.4 seconds before impact.
- Affixes are readable at normal combat zoom without relying only on color.
- Visual smoke captures mixed enemy packs in each act, not just isolated enemies.

Impact: Very high  
Effort: Medium  
Priority: Second

## 3. Add Physical Hit Reactions And Contact Language

### Current Finding

The combat pipeline is mature. `combat.ts` already centralizes player damage, enemy damage, combo payout, parry, crash nova, charged heavy, executions, camera kick, stage punch, particle bursts, rings, and slash arcs. The current design intentionally avoids hitstop.

The remaining gap is contact. Hits often read as a slash arc plus particles plus number. That is clear, but not always physical. Enemy bodies should react directionally to hits, and the weapon should feel like it made contact with a specific target.

### Why This Matters

Combat feel is not only math and effects. It is the illusion that the attack connected. Without more body reaction, stronger VFX can make the screen busier without making the strike feel heavier.

### Improvement

Add a hit-reaction layer that preserves the no-hitstop rule:

- Add `Enemy.reactToHit(...)` or equivalent hooks called from `Combat.dealDamage`.
- Pass impact direction, heavy/crit/shielded/killed, and source type into the reaction.
- Light hits cause a small flinch or lean away from the impact direction.
- Heavy hits cause a stronger stagger, shoulder twist, or guard-break pose for non-boss enemies.
- Bosses use subtler material pulses, armor plate shifts, and phase-specific impact reactions.
- Executions get a brief readable flourish: enemy outline, hero commit pose, directional burst, then dissolve.
- Weapon contact gets a small bright edge/spark near the actual blade tip or impact direction, not only at enemy center.

This stays within the current design philosophy: no time scaling, no hard hitstop. Use 100-180 ms pose reactions, camera kick, FOV pulse, material flash, and particles.

### Likely Hooks

- `game/src/game/combat.ts`
- `game/src/game/enemies.ts`
- `game/src/game/enemies2.ts`
- `game/src/render/particles.ts`
- `game/src/render/trail.ts`

### Suggested Acceptance Criteria

- Light, heavy, crit, parry, crash, shielded hit, and execution all look distinct in side-by-side screenshots.
- A hit against a moving enemy visibly affects the enemy body, not only the floor and HUD.
- Bosses do not jitter or look cheap, but they still acknowledge big hits.
- Existing `npm run typecheck` and combat smoke scripts stay clean.

Impact: High  
Effort: Medium  
Priority: Third

## 4. Rebalance Visual Hierarchy Around Characters, Not Effects

### Current Finding

The game's macro presentation is attractive: the arena, menu scene, bloom, color grade, floor rings, boss bars, and HUD already create a strong identity. But in active combat, character scale and character clarity can lose priority to glowing floor rings, edge effects, telegraphs, card VFX, and damage numbers.

Hero select also undersells the best thing the game has: procedural playable heroes. The current hero cards are functional, but they mostly show icons, locks, bars, and text. The model is not the star.

### Why This Matters

Look and feel improves fastest when the player's eye naturally lands on the hero, the nearest threat, and the attack connection. If everything glows equally, the game can be technically impressive but emotionally flat.

### Improvement

Run a visual hierarchy pass:

- Make the selected hero a live 3D showcase on hero select: full-size model, idle pose, weapon/cape motion, short ability preview.
- Add a combat camera or zoom review to ensure the hero is not too small during normal fights.
- Tone down idle floor emissive and nonessential glow when active telegraphs or hit effects are present.
- Give player, enemy, telegraph, and reward VFX separate brightness budgets.
- Make hero-specific trail shapes and Overdrive visuals more distinctive so heroes feel collectible and not just stat palettes.
- Add optional screenshot modes for hero portrait, enemy pack, boss, and combat contact states.

### Likely Hooks

- `game/src/game/player.ts`
- `game/src/game/heroes.ts`
- `game/src/ui/menus.ts`
- `game/src/render/cameraRig.ts`
- `game/src/render/arena.ts`
- `game/src/render/stage.ts`

### Suggested Acceptance Criteria

- The hero is the first readable object in a normal combat screenshot unless a boss attack is actively warning.
- Hero select makes locked and unlocked heroes feel like characters, not only menu entries.
- VFX still look rich, but enemy attack warnings remain the only effects allowed to dominate the combat floor.
- The game has a repeatable screenshot matrix for menu, hero select, enemy pack, combat hit, and boss attack.

Impact: High  
Effort: Medium to large  
Priority: Fourth

## Recommended Build Order

1. Hero locomotion and attack transition pass.
2. Enemy body-language and role silhouette pass.
3. Hit reaction/contact pass.
4. Character-first visual hierarchy and hero showcase pass.

This order is intentional. Movement quality affects every second of play. Enemy body language then improves fairness and threat readability. Hit reactions make the existing combat systems feel physical. The visual hierarchy pass ties the work together and makes screenshots, menus, and moment-to-moment play look more premium.

## What I Would Not Prioritize Next

- More enemy types. The roster is already broad enough; the existing enemies need stronger motion and identity first.
- More cards/relics before combat feel. Build depth is valuable, but it will not fix the current hero/enemy/combat presentation concern.
- Bigger VFX alone. The game already has many strong effects. Without body reactions and hierarchy, bigger effects may make readability worse.
- A full art-style replacement. The procedural low-poly style is viable. The issue is animation, pose language, contact, and composition.
