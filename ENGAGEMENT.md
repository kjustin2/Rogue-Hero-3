# Engagement Backlog

Ideas to make Rogue Hero 3 more engaging and fun, organised by surface area. **Not** a requirements doc — a brainstorm. Each section is scannable; the implementation pass that produced this file (boss four-phase rework, signature card mechanics, ultimate removal) is already shipped.

---

## 1. Boss systems beyond this pass

- **Adaptive AI** — bosses read the player's loadout and bias their telegraphs (e.g. Brawler tilts toward Earthsplitter Throw against ranged builds, the Spire's Convergence aim widens vs. fast-moving builds).
- **Enrage timers** — every boss has an outer time limit; past 90 s the boss adds a permanent attack-speed multiplier per 30 s elapsed. Forces commitment.
- **Mid-fight environment changes** — Brawler's pit floor cracks at P3, exposing two pools of unsafe ground. Spire's arena tilts on P4 (visual, not gameplay) so the player has to re-read their position.
- **Boss-specific arena modifiers** — Magma Colossus arena starts dark; lava patches light progressively as phases tick over so visibility tracks intensity.
- **Co-aggro relic** — a rare relic that makes one of your kills mid-fight summon a temporary boss-side ally enemy that turns on the boss for 6 s.

## 2. Card system depth

- **Combo chains** — pairs of cards trigger named combos when cast within 1.5 s. Cleave (Bleed) → Crashing Blow triggers "Hemorrhage Burst": consumes all bleed stacks for instant lump damage. Frost Nova → Charged Beam = "Frostlance": beam tier auto-promotes one tier.
- **Archetype synergy passives** — equipping 3 fire-tagged cards/relics grants Burning Path; 3 frost grants Glacial Tempo; 3 storm grants Conduit Web. Cosmetic + light gameplay shift, not a stat-power bonus.
- **Card upgrades during run** — between rooms, opt to spend AP-debt or HP shards to upgrade a card (e.g. Cleave → Cleave+ adds a third arc swing on the same cast).
- **Card discard for power** — a one-shot "I burn this card permanently for a strong cast" mode. Spike-power moments reward decision-making over dumping AP.
- **Mutator drafts** — one of every three card rewards is a "Mutator" you attach to an existing card (e.g. "your next 5 Cleaves chain to a second target"). Limited stacks, expires per-room.

## 3. Run-level engagement

- **Anomalies / curses per room** — random room modifiers like "Frost Mirror: every Frost Field also damages you", "Echo Chamber: every card you cast plays a second time on a 0.5 s delay". 1 anomaly per non-boss room, optional skip.
- **Branching map paths** — between Acts, choose: more rooms (more loot) vs. fewer rooms (faster, harder bosses).
- **Elite mini-bosses** — between rooms 4–5 and 7–8, a single elite that drops a guaranteed rare relic. Smaller than a boss, reuses existing enemy art with rim glow + telegraph pool.
- **Run-modifier shrines** — optional rooms with a single shrine that costs 30 % HP, returns: rare relic / +1 hand slot / starting deck swap.
- **Memory rooms** — at room 6, a flashback room where you replay an earlier room with the difficulty scaled to your *current* deck. Tests build coherence.

## 4. Player progression & meta

- **Hero unlock conditions** — bosses defeated under specific constraints unlock new heroes (e.g. "no-hit Spire P3 → Stalker variant skin").
- **Persistent stat shards** — every full run yields 1–3 shards spendable on universal trickle-buffs (max HP +5, AP +1, dodge i-frames +0.05) capped per hero.
- **Daily seeds + leaderboards** — fixed seed across all players for the day, ranked by clear time / deathless flag / damage-taken.
- **Cosmetic skins per boss** — skins drop only after defeating the boss flawless. No stat differences.
- **Audio glossary unlock** — new SFX preview screen unlocks as you discover cards, like Slay the Spire's keyword glossary.

## 5. Moment-to-moment polish

- **Combo meter** — consecutive hits without taking damage build a meter; tier 1 boosts colour saturation, tier 2 adds bloom, tier 3 plays a brief drum kicker. No stat bonus, just "feel".
- **Screen-effect tiers for combos** — chromatic aberration tightens at high combos, releases on hit-taken.
- **Dynamic music layers** — base bed loop always plays; layers stack as tempo zone climbs (FLOWING → HOT → CRITICAL adds a percussion stem each).
- **Dust + light response** — heavy hits kick up a transient dust ring around the player, shadow-soft for ~0.4 s.
- **Camera spring on telegraphs** — when a boss begins a signature wind-up (Earthsplitter, Convergence, Tectonic Slam), the camera nudges 5° toward the impact point and snaps back on detonate.

## 6. Risk/reward systems

- **High-risk room paths** — opt-in modifier per non-boss room: "+50 % enemy HP, double rewards". Caster can stack but late-Act risk piles up fast.
- **Perfect-clear bonuses** — `no-hit-room`, `no-cards-used-room`, `under-30s-room` each award a different colour shard the next reward picker reads.
- **Skull modifiers** — sacrifice a max-HP point for a quality-tier bump on the next relic offer. Compounding choice across the run.
- **Boss-only modifiers** — pick a "Curse" before a boss for +1 reward roll: "boss heals 5 % per 10 s" / "your max HP halved during fight" / "one of your relics disabled for fight".

## 7. Quality of life

- **Telegraph color legend** — toggleable in pause: red = damage, gold = mark, blue = lance, orange = magma, purple = phantom. Most players never get the colour language without a key.
- **Deck-builder UI between rooms** — peek at your deck composition + remaining draw probabilities before you draft. Currently the player has to mentally track their deck.
- **Glossary of statuses + keywords** — Bleed, Conduit, Frost Field, Hyperarmor, etc. — one-page lookup any time.
- **Damage breakdown popup on boss death** — last 5 s of damage attribution per card. Helps players understand which cards carry their build.
- **AP trail** — small subtle floating numbers showing AP regenerating over time, so players can pace their casts visually.

## 8. Audio direction

- **Per-zone musical motifs** — Act 1 Pit gets brass-led aggression; Act 2 Spire gets choral high-end; Act 3 Forge gets sub-low rumble.
- **Dynamic instrument layers** — bed loop is always playing; one new instrument layer per phase (boss enters P2 = strings join; P3 = snare; P4 = full ensemble).
- **Boss leitmotifs** — every boss has its own 3-note signature that plays on entry, on each phase transition, and on death — at progressively richer instrumentation tiers.
- **Diegetic environment audio** — magma vents, wind through the spires, crowd ambience in the pit. Unique to each act, helps the room transitions read.
- **Stinger overlays for combos** — at combo tier 3, a brief brass / synth stinger plays *over* the music bed. Not replacing — layering.

---

## Suggested sequencing

If picking a follow-up pass after this one, the order with the highest engagement-per-hour ratio is roughly:

1. **Combo meter + dynamic music layers** (§5) — visceral, immediate, no new content needed.
2. **Anomalies per room** (§3) — high replay-value bump for ~1 day of work; reuses boss telegraph + existing enemies.
3. **Card upgrades + combo chains** (§2) — extends the build-craft surface so the same 10-card pool feels like 30+ in practice.
4. **Mid-fight environment changes + adaptive boss AI** (§1) — the next layer of fight depth once the basic four-phase structure is shipped.
5. **Daily seeds + leaderboards** (§4) — meta-loop to keep players returning across patches.
