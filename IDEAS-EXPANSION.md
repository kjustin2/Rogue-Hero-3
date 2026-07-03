# Rogue Hero 3 — Expansion Ideas

Ideas only, no code. Cherry-pick; delete after picking. Companion to the
leftover quick wins in `IDEAS.md` (daily runs, card removal, death recap…)
and the cutscene performances in `BOSS-CUTSCENE-AUDIT.md` — none repeated here.

---

## 1. ~~The true final boss~~ — SHIPPED (THE WOUND BENEATH, depth 3+)

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
- **Ship it wider**: electron-builder is wired — a Steam-shaped pass
  (achievements mapped from milestones, cloud-save = the existing profile
  JSON, a settings "reset profile" confirm) is mostly checklist work.

Suggested order if you want a headline update: **1 (The Wound) + 2A (Break
system)** ship together as "The Depths Update" — the break system makes the
new boss fight better, and the boss justifies the system.
