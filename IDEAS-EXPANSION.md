# Rogue Hero 3 — Expansion Ideas

Ideas only, no code. Cherry-pick; delete after picking. Companion to the
leftover quick wins in `IDEAS.md` (daily runs, card removal, death recap…)
and the cutscene performances in `BOSS-CUTSCENE-AUDIT.md` — none repeated here.

---

## 1. The true final boss (your idea, fleshed out)

**THE WOUND — the thing that hollowed the star.** On an Ascension run
(suggest depth 3+ so it's earned but not depth-15-only), killing or sparing
the Unmaker doesn't seal the Rift. The floor tears open mid-victory beat and
the run gets one more fight against the thing that's been beneath every arena
all game — the source the Wardens actually fell guarding against.

What makes it a TRUE final boss rather than a sixth boss:

- **It fights with your own kit.** It has a visible Tempo meter of its own:
  it heats up as it presses you, crashes when it peaks (a real crash nova you
  must dodge), and goes cold and sluggish if you deny it hits. Your signature
  mechanic, mirrored — the player finally reads an enemy the way enemies read
  them. (The Rift Echo already copies your *shape*; The Wound copies your
  *system*. Echo stays the mid-run optional duel.)
- **It corrupts your cards.** Each phase it "swallows" one of your 3 slots
  (the HUD slot cracks, card unusable) and casts a hostile version of it at
  you — your own Meteor Call / Gravity Well / Frost Nova as boss attacks,
  driven by the same card defs so every player sees THEIR loadout weaponized.
  Kill the phase to take the card back (slot restores with a flourish).
- **Mercy pays off mechanically.** If you SPARED the Hollow Star this run,
  the ember you carried fights with you: a drifting light that periodically
  charges your tempo and revives you once (a story-earned Second Wind).
  Kill the star instead and you fight The Wound alone in a darker arena.
  This makes the true ending a *strategic* choice, not just a sentimental one.
- **Arena participates.** The fight is on the shattered underside of the disc:
  rim gone (no wall to hug — falling off the edge costs HP and teleports you
  back), floor segments crack and drop on a telegraph, the sky is the inside
  of the rift (new theme, one entry in `THEMES`).
- **Rewards**: a guaranteed legendary + a big shard multiplier, a unique
  "Woundbreaker" title + blade cosmetic for the first kill, and its own
  milestone line. Depth ladder unchanged — The Wound is the same fight at
  every depth, only its HP/damage scale, so it stays a summit rather than
  a second grind.

Build note: it slots into the existing `BOSSES` registry + `debugLoadBoss`
harness; the victory pipeline needs one branch (depth ≥ N → interstitial tear
cutscene → wound fight → the existing ending). Biggest new work is the
card-corruption system — but it reuses `CardDef` + the hostile projectile /
telegraph plumbing.

---

## 2. A new combat system (options, ranked)

**A. Break / Posture system (recommended).** Every non-trash enemy gets a
posture bar under its HP: heavy hits, counters, parries, and perfect-dodge
punishes build it; it decays if you disengage. Filling it BREAKS the enemy —
3s stagger, +50% damage taken, and executions work at ANY health during the
break window. Bosses get phase-tuned posture and a big visible break (crown
shatters, knees hit the floor — pairs with the planned boss performances).
Why it's the right fit: it gives heavy/charged attacks and the new Counter
window a shared payoff, creates a second decision axis (burst HP vs. build
break), and makes fast aggressive play — the Tempo fantasy — literally crack
enemies open. Slots into `Enemy.takeDamage` + one bar sprite; no new input.

**B. Beat-synced combat (signature-amplifying, riskier).** The soundtrack
already drives per-act tempo — let attacks landed ON the music's beat gain
+15% damage and a visible on-beat flourish (blade flash sync'd to a HUD
pulse on the tempo dial). Crescendo stacks make the window more generous.
Turns the music system into gameplay and is a genuine differentiator (Hi-Fi
Rush energy), but needs careful beat-tracking against streamed MP3s and can
feel punishing for players who don't hear rhythm — must stay a bonus, never
a requirement.

**C. Charge-and-release card casting.** Holding a card key overcharges it
(bigger radius/damage, tempo cost per second held) — every one of the 41
cards gets a hold variant for free via a global multiplier hook. Adds an
input skill layer with almost no new content, but overlaps conceptually with
the honing system.

**D. Enemy weak points.** Directional armor: bastions/brutes/bosses take
bonus damage from behind or on a glowing node that migrates. Rewards the
mobility cards; cheap; but it's more "more of the same positioning" than a
new system.

Pick A alone, or A + B if you want a headline feature for a big update.

---

## 3. Further build-out (grab bag)

- **Endless descent.** After depth 15: "The Rift goes deeper" — procedurally
  stacking modifiers with no cap, leaderboard-style personal best depth on
  the menu strip. Cheap (difficulty.ts already composes modifiers) and gives
  the daily-run crowd a forever goal.
- **Custom challenge runs.** A "Rift Contract" screen: hand-pick your own
  modifier set (glass cannon, no heals, elite-only…) for shard multipliers.
  Reuses the Ascension modifier table as a menu.
- **Boss rush mode.** Menu entry: all 5 bosses + Echo (+ The Wound) back to
  back, fixed loadout drafts between fights, timed. The `debugLoadBoss`
  plumbing is basically this already.
- **A 7th hero built on the new systems** — e.g. "The Warden's Remnant":
  parry/posture-themed passive (breaks build twice as fast, no dodge i-frame
  bonus) to showcase system A.
- **Relic set bonuses.** 2-3 piece sets (all frost relics = Shatterglass
  radius up, etc.) — makes late-run relic drafting a build puzzle instead of
  raw stat soup. Data-only.
- **Act interlude vignettes.** One 20-second playable beat between acts (walk
  a short bridge, one story line, one choice tile) instead of a map screen
  jump — big pacing win for a small scene.
- **Arena variants per act.** Each act gets 1 alternate arena mechanic pulled
  from `features.ts` (rotating beam in act 3, drifting void tiles in act 5)
  so chamber 3 doesn't look like chamber 1. The MapFeatures seam exists.
- **Ship it wider**: electron-builder is wired — a Steam-shaped pass
  (achievements mapped from milestones, cloud-save = the existing profile
  JSON, a settings "reset profile" confirm) is mostly checklist work.

Suggested order if you want a headline update: **1 (The Wound) + 2A (Break
system)** ship together as "The Depths Update" — the break system makes the
new boss fight better, and the boss justifies the system.
