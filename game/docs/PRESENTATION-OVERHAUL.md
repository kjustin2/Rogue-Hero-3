# Presentation and Combat Rebuild

The owner chose **Hades: stylized, crisp, fast combat** as the reference.
Rogue Hero III uses original procedural bodies, architecture and materials,
with the Blade's tempo and equipment-based specialties defining its combat.

## World and visual direction

- Five physical chamber outlines: processional nave, split gallery, hounds'
  walk, shield court and breach. The same outlines govern masonry, movement,
  spawning and attacks. Tall rear walls and low foreground parapets preserve sightlines.
- Four cover constructions, with floor wear located around their actual colliders.
  Enemies route around cover; swept projectiles stop at it.
- Large cut-stone slabs, brass and porphyry inlay, original heraldry, painted
  leaded glass and restrained window light. Boss courts have their own seals.
- One articulated Blade, 17 field enemies and seven boss rigs. Equipment,
  faces, hinged wings, legs and hands establish silhouettes and readable actions.
- Linear HDR rendering with explicit tone mapping retains material color.
  Emission stays local to eyes, magic and contact; no bloom, film grain or hitstop.
- Bounded damage labels track world positions and combine nearby hits. The HUD
  stays quiet in combat and yields completely to cinematic framing.

## Combat and build choices

- Camera-relative movement, two dash charges, buffered three-hit melee,
  charged heavies, dash attacks and perfect-dodge counters.
- Staggered melee commitments keep packs readable. Bombers can be disarmed by
  killing them; volatile remains have a full warning window before detonation.
- Boss guards break under charged heavies and Crashes, canceling the attack and
  exposing 1.35 seconds of recovery. The Warden can be baited into a wall;
  breaking the Wound's guard returns its stolen ability and drains its tempo.
- Twenty-eight retained abilities across seven schools. Pairing a school changes
  Crash itself and grants a matching passive and faster recharge. Honing changes
  each ability's behavior. See ABILITY-AUDIT.md for the complete retained catalog.
- Cover consistently blocks spell damage and control. Movement spells use their
  actual collision-resolved travel; ground marks remain inside the room.
- Each school has distinct contact fragments and synthesized impact sounds.
  Sustained damage uses quiet local effects instead of repeated camera jolts.
- Phase Step copies the Blade's real pose. The ward totem is planted, the gravity
  core contracts, and mines hold steady light. Aegis stores absorbed damage for
  a manual reprisal without taking away later barrier grants.
- Full-hand purchases allow replacement and show the resulting specialty and
  lost honing. Paid rerolls offer different choices before charging shards.

## Story and persistence

- The opening and act crossings follow an authored walk, readable story beats
  and an interactive gift choice. Every boss reveal performs on the actual rig.
- Phase transitions cancel attacks and their warnings. One finalizer restores
  camera, input, HUD and grace after completion or skip.
- Bosses have individual collapse actions. Short mid-run aftermaths lead directly
  to rewards, including when skipped. The Echo has its own epitaph; mechanical
  bosses use actions and wording that fit their bodies.
- The star's mercy choice, Wound emergence and deeper ending form a connected
  sequence. New runs reset the ending's presentation state.
- Boss kills and bounties are committed before the victory record. Combat and
  run time stop at resolution while body animation and effects finish.
- Complete checkpoints are written after rewards and before the next fork.
  They retain the route, random stream, pacts, health sacrifices, cast counters
  and spent revives. Exiting a fight preserves that complete checkpoint.

## Development verification

Only scripts/smoke.mjs remains as an automated test entry point. npm test,
smoke, qa, qa:fast and qa:loop alias the same basic check; run one, once.
It has a 30-second hard deadline, no rebuild, and no screenshots by default.
The Electron window is hidden, muted and isolated from the player's saves.
The production build separately checks TypeScript and bundles the application.

Optional captures in ignored shots/craft are inspected directly while making
visual changes. Detail, balance, complete runs and feel belong to manual play.
Do not restore analyzers, bots, video QA, soak tests or automatic review loops.
