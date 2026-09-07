# Ability and cinematic pass

The Blade is the single protagonist. A run begins with Dash Strike and Arc Bolt,
then builds a three-ability hand. All 28 retained abilities can appear from the
first run. Permanent progression continues through relics, blessings, depth and
cosmetics. Old character saves load as the Blade; retired abilities migrate to
their retained counterparts without creating duplicate slots.

## Build differentiation

Two equipped abilities of one school activate its specialty. All matching
abilities recharge 15% faster. Honing has a distinct effect per ability, plus
30% shorter cooldown and 50% more cast tempo where the ability grants tempo.

| School | Specialty | Additional benefit | Signature Crash |
| --- | --- | --- | --- |
| Steel | Sword Saint | Finishers and charged blows deal 25% more damage. | Sovereign Cut: three piercing sword waves. |
| Storm | Stormbound | Sword hits refund 0.15s on storm cooldowns. | Thunder Reprise: chains through four foes, six when perfect. |
| Rime | Frostbreaker | Sword blows deal 35% more damage to frozen enemies. | Winter's Verdict: freezes and exposes survivors. |
| Ember | Ashbringer | Burns deal 35% more damage. | Funeral Pyre: ignites survivors; a meteor strikes the center. |
| Veil | Riftwalker | Veil casts grant 0.2s of invulnerability. | Eventide: gathers survivors and extends invulnerability. |
| Blood | Blood Reaver | Kills restore 3 HP. | Crimson Reckoning: consumes wounds and burns; heals up to 12 HP. |
| Guard | Oathkeeper | Guard casts add 6 barrier, up to 60. | Last Bastion: reflects nearby projectiles and raises barrier. |

The merchant supports replacements in a full hand. Swap previews show the
resulting specialty and lost honing. Held-card and honing views calculate
cooldowns through the same function used by casts.
Paid rerolls exclude the currently displayed options and only spend shards when
a different offer exists. Checkpoints preserve cast counters, used Second Wind,
Co-Aggro kill progress, Metronome pact and maximum-health sacrifices.

## Retained abilities

Each row has a combat purpose and a meaningful honing effect. This is a source
audit and implementation record, not a claim that every full-run combination
has been balance tested.

| Ability | Purpose | Honed change |
| --- | --- | --- |
| Dash Strike | Invulnerable lunge; damage follows the actual resolved path. | Longer travel and a landing burst. |
| Arc Bolt | Piercing ranged line. | Three-bolt spread. |
| Cleave | Heavy close crowd punish, with a short physical windup. | Full-circle sweep and more damage. |
| Frost Nova | Close crowd control. | Larger, stronger nova and longer freeze. |
| Phase Step | Cursor blink with a delayed phantom at the departure. | Second phantom. |
| Mine Field | Prepared ground traps. | Six mines instead of four. |
| Aegis | Four-second reprisal window: absorbed damage empowers a manual detonation; later barrier grants survive the blast. | 40 barrier, wider blast and more stored damage. |
| Chain Lightning | Automatic jumps through a nearby pack. | Six targets and stronger bolts. |
| Sunder | Successive ground eruptions along a committed lane. | Six eruptions instead of four. |
| Meteor Call | Marked area followed by a visible falling meteor. | Second impact at the same mark. |
| Bleeding Edge | Short cleave that stacks wounds. | Deeper and longer bleed. |
| Storm Conduit | Sword attacks spark to another nearby foe. | Eight-second duration and stronger sparks. |
| Gravity Well | Gather enemies, then burst and expose them. | Wider pull and stronger burst. |
| Blade Cyclone | Mobile spinning sword pulses. Dodge cancels it. | Fourth pulse and larger reach. |
| Riposte | Deny the next incoming hit and counter. | Longer stance and stronger answer. |
| Glacial Lance | Freeze enemies along a long line. | Wider, longer lance and deeper freeze. |
| War Cry | Recover health, barrier and tempo; shove nearby enemies. | More healing, barrier and force. |
| Seeker Swarm | Homing projectiles for scattered enemies. | Eight stronger seekers instead of five. |
| Tempest | Sustained area pressure from repeated lightning strikes. | Longer storm and stronger bolts. |
| Flamethrower | Aimable sustained cone with refreshed burns. | Longer, wider cone; stronger damage and burns. |
| Decoy Totem | Magnetic lure that gathers foes before erupting. | Longer pull and larger freezing blast. |
| Shield Bash | Collision-aware charge with contact damage and stun. | More travel, damage and stun, plus barrier. |
| Rend Blade | Outbound and returning hits that leave wounds. Returns to the moving hero. | More reach, damage and bleed. |
| Rift Hook | Pull enemies into melee and expose them. Bosses become vulnerable instead. | All-around reach, more damage and arrival freeze. |
| Blade Spirit | An orbiting spectral blade controls nearby space. | Longer duration, faster orbit and more damage. |
| Hemorrhage | Cash out remaining wounds and burns as immediate damage. | Larger radius and greater wound multiplier. |
| Hammer Drop | Real travel and airborne pose; damage occurs on landing. | Larger, harder impact and stronger barrier reward. |
| Soul Drain | Close drain whose healing rises at low health. No healing from warded hits. | More range, damage and healing. |

Bosses resist long freezes. Pulls respect their resistance, and travel abilities
resolve collisions against the actual arena. Card delays and transient effects
clear at room boundaries. Cosmetic fire and storm particles do not consume the
gameplay random stream.

Direct hits carry their school's contact color, material fragments and synthesized
impact sound. Sustained ticks keep that identity without repeated camera jolts.
Area damage, pulls, freezes and chain jumps respect cover; body-hit effects do
not pass through wards. Seekers sweep their path through cover, and Rend's
return remains reachable around obstacles. Ground marks resolve inside walls.

Phase Step leaves a snapshot of the Blade's actual armor and pose. Decoy Totem
uses a planted ward with a moving crown; Gravity Well has a dark core and
contracting orbital rings. Mines have steady light instead of a rapid strobe.

The 19 retired abilities were redundant variants or character signatures. Their
save mapping lives in `LEGACY_CARDS` in `src/game/cards.ts`; their old dispatch,
effect update paths and obsolete sigil styles have been removed.

## Cinematic flow

- Opening: the Blade walks into the Rift while the premise is established.
- Act crossings: an authored walk, readable story captions, then a choice of gifts.
- All seven bosses: create the actual rig, reveal and pose it, show its identity,
  then return the camera before releasing combat. Entrances last 4.2–5.2 seconds.
- Phase changes: a short boss performance while attacks are held; the Hollow
  Star's fading phase retains the mercy choice.
- Boss deaths: the Warden braces, the Colossus lowers its fists, the Echo kneels,
  the Regent's orbs fall inward, the Tyrant closes, the star contracts and the
  Wound's talons fold. Mid-run aftermaths last 3.4 seconds and skip directly to
  the same reward. Dead rigs lose lingering hit/freeze emission as they settle.
- Deeper finale: the star falls, the broken seal is explained, the Wound rises,
  and the ending reflects both the Wound's defeat and the mercy decision.

Skipping uses the same finalizer as completion. Story timing follows the game
clock. Normal movement keys no longer accidentally skip a boss scene.
Debug scenario cuts no longer leave a delayed skip loop running into later scenes.
The final boss bounty and unlocks are included before victory is recorded;
the ending stops combat and the run timer while the bodies finish their motion.

Boss combat guards last exactly until the attack resolves, including freezes.
A charged heavy or Crash shatters the guard, cancels the attack and opens 1.35s
of recovery. The Wound also loses 30 tempo and returns its stolen ability.
Phase breaks clear queued attacks and their warnings; the cinematic blocks
follow-up damage until handoff. The Warden commits to its dash direction and
becomes exposed for 1.5s after striking the boundary.

## Evidence and limits

Brief isolated Electron sessions exercised all 28 upgraded cast dispatches,
the opening, boss skip, the walking interlude and release, draft layout, Rift
Hook travel, all seven boss reveals, and the deeper finale through its entrance,
combat handoff and matching ending. The built app also returned from victory
through Run It Back into an active room with input, follow camera and visible
HUD restored. Frame errors were empty in those sessions. Current visual
captures live in ignored `shots/craft/`.

The production build passed. Its basic smoke passed in **8.3 seconds including
cleanup**. A brief focused check confirmed checkpoint restoration, distinct
rerolls, boss aftermath handoff, final bounty accounting and stopped resolution
timers. Optional captures are development evidence, not a background suite.

Only `scripts/smoke.mjs` remains as an automated test entry point. It checks
basic gameplay inputs and pause/resume, with a 30-second hard deadline.
Detailed combat feel, complete-run balance and cinematic direction are manual
review work owned by the player.
