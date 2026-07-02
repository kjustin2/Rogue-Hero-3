# Boss Cutscene Audit — Making Them More Dynamic

Audit of the entrance + phase cutscene system (`main.ts`: `playBossCutscene`,
`buildBossIntroBeats`, `playBossPhaseCutscene`, `BOSS_FX`, `addBossOmen`).
Ideas only — cherry-pick; nothing is implemented. Delete after picking.

## What exists today (short)

Entrances are a **data-driven beat list** (`{at, type, ...}` → camera / ring /
burst / prop / flash / sound / pulse / reveal) played over ~5.5s with letterbox,
a per-boss palette + "omen" prop (claws/mirrors/fists/reactor/star), an ambient
particle storm, a name-drop reveal at ~2.5s, per-boss extra beats, skip-on-input
after 700ms, and a no-dead-air handback. Phase shifts are a shorter frozen beat
(dolly + roar + staged triple eruption + banner, ~5.8s; the Unmaker's fading
phase is a beautiful quiet variant). This is a genuinely good foundation — the
weaknesses below are all "the pieces around the beats", not the beat system.

## Ranked improvements

### 1. The boss doesn't act — make the body perform the entrance (biggest win)
Everything today is FX *around* a spawn point; the boss just appears inside it.
Every boss class already owns a posed procedural rig and a state machine — give
each a scripted entrance performance driven by the same beat clock:

- **Warden**: crashes down at the `seismic` beat (drop from y=8, dust on land),
  drags a claw through the floor walking forward two steps, roars at reveal.
- **Spire Caster**: assembles from its own mirror shards (the shards omen flies
  INTO the body instead of floating).
- **Colossus**: fists land first (the fists omen becomes its actual fists),
  then the body hauls itself up out of the floor between them.
- **Tyrant**: steps out of a tear that opens mid-air (tear flash already exists).
- **Echo**: fades in *mirroring the player's current idle*, then "sharpens"
  (scale/color snap) at the name-drop. It's your reflection — show it.
- **Unmaker**: keep quiet — it should simply *be there* when the light clears.

Sketch: add a `performEntrance(tMs)` hook on the boss base class + a
`{type:"boss", cue:"land"|"rise"|"step"|"roar"}` beat. The boss is already
spawned with 5s grace during the cutscene, so the body exists to animate.
Effort: medium-high, but this is the difference between "fireworks at a point"
and "a monster arriving". Do one boss first (Colossus — fists already exist).

### 2. Camera language — more than one shot
`cam.cinematic()` is a single fixed high-angle dolly; zoom changes are the only
camera motion. Cheap additions to the rig (it already has menu-orbit + cinematic):

- **Slow push-in**: animate `cineZoom` over the charge-up (0.75 → 0.5) instead
  of stepping it — tension reads instantly.
- **Reaction cut**: dolly to the HERO for ~500ms right before the reveal
  (`{type:"camera", target:"hero"}`), then snap back for the name-drop. A/B
  eyelines are the oldest trick in boss intros and it works.
- **Low-angle reveal**: a second offset preset (camera lower + closer, lookAt
  boss chest height) used only for the reveal beat — bosses should tower.
- **Slow orbit hold** on the final beats (reuse the new `heroOrbit` machinery
  pointed at the boss with a wide radius).
Effort: low-medium — all rig-side, beats already exist to trigger it.

### 3. The hero doesn't react
The player model stands in its combat idle through the whole entrance. One
one-shot pose layer (`animFlourish`, same layering slot as `animSwing`):
plant the blade and brace at the first ring; cape gust at the reveal
(wind impulse on the cape cloth). Pairs with the reaction cut in #2.
Effort: low (player pose layering already exists).

### 4. Phase cutscenes: vary by phase + shorten the freeze
Phase 2 and phase 3 play the identical 5.8s frozen shape, mid-combat, twice a
fight (thrice for the Unmaker). Suggested:
- **Phase 2**: quick punch — no world freeze, ~2s: flash + eruption + banner
  while the fight keeps moving (the boss is already in `phaseShift` stagger, so
  it's safe). Keeps combat tempo, and makes phase 3 feel bigger by contrast.
- **Phase 3 (last stand)**: keep the full frozen beat, add the #1/#2 tricks
  (boss performs: Warden tears its own crown off, Colossus pounds its chest;
  camera pushes in).
- The banner line already dwells correctly — keep that.
Effort: low for the split; medium with performances.

### 5. The arena should hold its breath
During the charge-up, dim the world: rim/crystal emissive eases toward ~40%
(the new `criticalHeat` easing pattern is exactly the right shape — add a
`cutsceneDim` sibling), sky stars fade, ambient ember rate drops to near zero —
then everything snaps back to full at the name-drop together with the flash.
Darkness → impact is the cheapest "cinematic" there is. Uniform-only changes,
no composer flips (the program-cache pitfall stays respected).
Effort: low.

### 6. Sound: a riser, and a musical hit on the name-drop
Today: one intro sting + one roar. Add a procedural 2–2.5s riser (filtered
noise sweep + rising sine, sfx.ts style) starting at the gate beat and landing
exactly on the reveal; duck music deeper (0.2) during the charge-up and pop it
back at reveal so the name-drop also lands musically. The per-act boss themes
already exist — starting the boss track *at the reveal* instead of at room load
would sync the whole room to the arrival.
Effort: low (sfx) / medium (music start-point plumbing).

### 7. Skip should fast-forward, not hard-cut
Skipping now tears down everything, so skippers never see the name-drop.
Better: skip jumps the clock to the reveal beat (play reveal + banner + the
final ring instantly, then hand back control ~600ms later). Repeat players keep
the identity beat; the skip still saves ~4s.
Effort: low-medium (beat timers need a "flush to time T" path).

### 8. Honor guards arrive rudely (depth 5+)
The two guard adds spawn silently mid-cutscene and are just... there when
control returns. Either delay their spawn to reveal+300ms with two small
side-rings + a shard burst each ("the warden brings retainers"), or give them
a one-line banner tag ("IT DOES NOT COME ALONE"). Effort: trivial-low.

### 9. Small polish, cheap wins
- **Letterbox ease**: letterbox slides in instantly today (CSS state) — a 300ms
  ease-in sells "a scene is starting". (Check `setLetterbox` CSS.)
- **Reveal title treatment**: the banner class is shared with gameplay banners;
  a cutscene-only variant with letter-tracking animation (CSS only) would make
  the name-drop feel authored.
- **Boss HP bar reveal**: it fades in at a fixed 2600ms; tie it to the reveal
  beat instead so the choreography owns the timing end to end (the phase-tick
  marks now on the bar make this reveal a real moment).
- **Storm interval** uses `Math.random()` — fine (render-side), but pulling
  positions from the theme's ember color ramp + biasing them toward the gate
  would make the storm read as "leaking from the gate" instead of everywhere.

## Suggested order
1 (Colossus only) → 2 → 5 → 4 → 3 → 6 → 7 → 8/9 as filler. #1 across all six
bosses is the long pole; everything else is a day or less each.
