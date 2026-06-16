# Rogue Hero 3 — Improvement Ideas

A deep menu of options to take the game from "polished and complete" to "memorable and replayable." Each idea is grounded in the systems that actually exist today, tagged with rough **Impact** (◆◆◆ high · ◆◆ medium · ◆ nice-to-have) and **Effort** (S small · M medium · L large), and noted with *where it hooks in*. Pick the numbers you want and we'll build them.

> Quick read on where the game stands: combat feel, presentation, content breadth (5 heroes/acts/bosses, 33 cards, 21 relics, 17 enemies), and narrative are all strong. The **thinner layers** are: build/synergy depth, the *active* use of the signature Tempo meter, enemy variety beyond "tankier elites," the meta-progression loop (shards only buy cosmetics), and explorable lore. The highest-leverage ideas below target exactly those.

---

## ★ Top recommendations (if you only pick a few)

These are the highest impact-to-effort ideas and they reinforce each other:

- **#1 Overdrive** — give the Tempo meter an *active* payoff. The single most identity-defining idea.
- **#5 Status & synergy ecosystem** + **#6 Card/relic tags** — turns drafting into real build-crafting.
- **#12 Elite affixes** — a cheap, massive variety multiplier on the enemies you already have.
- **#22 Lore codex + echoes** and **#24 the mercy/true ending** — pay off the bittersweet story you just built.
- **#30 Reroll/banish in drafts** + **#31 a real shard sink** — fix the RNG-agency and meta-loop gaps.

---

## 1. The Tempo meter as an active system (lean into the signature)

Tempo is the game's unique hook, but today it's *passive* — it only scales damage/speed by zone (cold/flowing/hot/critical) and pops a Crash nova. Make it something the player actively pilots.

1. **Overdrive (spend the meter for a hero super).** ◆◆◆ · M — At Critical (90+), let the player trigger a short, hero-specific Overdrive that *spends* the meter: Blade = a time-dilated flurry, Reaver = lifesteal frenzy, Bulwark = an unbreakable bastion stance, Sparkmage = free no-cooldown casts, Tempest = a dash-storm. Gives the meter a climactic payoff and a real risk/reward (do I bank heat or blow it?). *Hooks: `tempo.ts`, a new action in `input.ts`, per-hero branch in a new `overdrive.ts`.*
2. **Per-hero tempo identities.** ◆◆◆ · M — Beyond `comboTempoMult`, make the *meter itself* behave per hero: Tempest decays slower while moving ("surfing"), Bulwark converts overflow into shield, Reaver gains lifesteal that scales with heat, Sparkmage's cooldowns shrink with tempo. Deepens hero asymmetry through the signature system instead of flat stat multipliers. *Hooks: `tempo.ts` decay/gain, `combat.ts`.*
3. **Crescendo (reward for sustaining heat).** ◆◆ · S — Holding Critical for N seconds grants a stacking buff ("Crescendo x3") with an escalating audio/visual motif. Reinforces the rhythm fantasy and rewards aggressive, clean play. *Hooks: `tempo.ts`, HUD.*
4. **Crash mastery + cold-zone builds.** ◆◆ · M — Add a *charged* Crash (hold to drop a bigger nova + hazard), a "perfect crash" timing window for a bonus, and relics that make **Cold** desirable (e.g., "Frostbound: attacks freeze while Cold") so the whole 0–100 range is a deliberate choice rather than "stay hot." Builds on existing crash relics (Berserker Sigil, Resonant Bell). *Hooks: `combat.ts` crash, `relics.ts`.*

## 2. Build depth — synergy, statuses, deck-crafting

The build comes from hero + 3 honeable cards + relics, but there's no connective tissue between picks. This is the core of roguelike replay value.

5. **Status-effect ecosystem.** ◆◆◆ · M — You have Freeze and Bleed. Add **Burn** (stacking DoT — Ember Wave/Flamethrower already imply it), **Shock** (chains on hit), and **Vulnerable** (takes +% damage). Then add *detonators*: "Shatter" frozen enemies for an AoE, "Ignite" bleeding enemies for burst. Frost Chord already rewards frozen targets — generalize that into a combo language. *Hooks: `enemies.ts` status fields, `combat.ts`, `cards.ts`.*
6. **Card & relic tags + synergy highlighting.** ◆◆◆ · M — Tag cards (Fire/Frost/Lightning/Bleed/Shockwave/Summon/Mobility/Guard) and add relics that scale a tag ("Pyre Codex: Fire cards +30%", "Stormcaller: Lightning chains +2"). The draft UI highlights cards that synergize with what you already hold. Suddenly every draft is a build decision. *Hooks: `CardDef`/`RelicDef` add `tags`, draft UI in `menus.ts`.* (Pairs with #5.)
7. **Legendary & cursed relics.** ◆◆ · M — Add a top rarity with run-defining effects ("every 3rd cast is free", "Crash also re-fires your last card", "perfect dodges briefly stop time"). Add *cursed* relics — strong with a real drawback (Glass Cannon is the template). Gives drafts spikes and identity. *Hooks: `relics.ts` rarity tier, draft weighting.*
8. **Card transform / forge / duplicate at shops.** ◆◆ · M — You can Hone; add **Transmute** (swap a card for a random higher-rarity one), **Forge** (fuse two cards into a stronger hybrid), and **Duplicate** (run the same card in two slots). Real deck-sculpting beyond a single upgrade. *Hooks: `deck.ts`, shop/rest screens in `menus.ts`.*
9. **A 4th card slot / loadout choices as a rare reward.** ◆◆ · M — A very rare relic/shrine grants a 4th card slot. A meaningful chase item that changes how a run plays. *Hooks: `deck.ts` HAND_SIZE, HUD.*

## 3. Enemies & bosses — variety from what you already have

17 enemy types is plenty; the variety problem is that elites are just *tankier*, and encounters are mostly "seek the player."

10. **Elite affixes.** ◆◆◆ · M — Roll 1–2 random modifiers on elites: Shielded, Volatile (death nova), Hasted, Healer (mends nearby foes), Splitting, Teleporting, Frost-Aura, Mirror (reflects a card). One system multiplies the threat-variety of every existing enemy. Scales beautifully with Ascension. *Hooks: a new `affixes.ts`, applied at the spawn choke in `enemies.ts`.*
11. **Coordinated packs (roles).** ◆◆ · M — Spawn intentional groups: a Bastion shield-wall fronting casters, a Tether healer behind brutes. Forces target prioritization instead of mowing the nearest blob. *Hooks: `mapgen.ts` wave generation.*
12. **Reactive AI.** ◆◆ · M — Enemies sidestep your *telegraphed* cards, scatter when you hit Critical, or bait your dodge. Right now they mostly path to you. A big feel upgrade. *Hooks: per-enemy `tick` in `enemies2.ts`.*
13. **Champion / mini-boss nodes.** ◆◆ · M — A single beefy custom enemy with a 2–3 attack telegraph kit, sitting between elites and act bosses. Fills the mid-act difficulty gap and showcases mechanics. *Hooks: new node kind, a light boss class.*
14. **Ascension boss variants.** ◆◆ · M — At higher depths, bosses gain a new attack or an extra phase (the Unmaker's fading phase shows the pattern). Keeps the endgame from feeling like the same five fights. *Hooks: boss classes guard on `ctx.difficulty.depth`.*
15. **A hidden superboss / secret encounter.** ◆◆ · L — A concealed node or a condition-gated fight (see #24) — the strongest single optional-content payoff, and a natural home for the "true" story beat. *Hooks: `mapgen.ts`, a new boss.*

## 4. Combat feel & skill ceiling

16. **Parry / deflect.** ◆◆ · M — Perfect-dodge rewards *whiffing* an attack; add a parry that rewards *meeting* a telegraphed melee or projectile with a well-timed strike — reflects projectiles, pays tempo. Raises the skill ceiling for confident players. *Hooks: `controller.ts`/`combat.ts` timing window vs `tele` events.*
17. **Executions / finishers.** ◆◆ · S — Low-HP enemies flash "executable"; a finisher gives a quick flourish + tempo + a sliver of heal. Ties into the Executioner relic and feels great. *Hooks: `combat.ts` kill path, `player.ts` pose.*
18. **Light/heavy attack or a charged heavy.** ◆◆ · L — The melee is a fixed chain; a hold-to-charge heavy (armor-break, launches, or guard-break vs shields) adds a real decision to basic attacks. *Hooks: `combat.ts`, `controller.ts`, `input.ts`.*
19. **Richer hit feedback (still no hitstop).** ◆ · S — Directional damage indicators (which side a hit came from), a kill-flash outline shader, and an enemy "wind-up intensity" ramp before attacks. Stays true to the no-hitstop rule (it's all shader/shake, never time-scale). *Hooks: `render/`, HUD.*

## 5. Heroes & progression

20. **Give Blade a signature card.** ◆◆ · S — Every hero except Blade (the balanced starter) has a hero-locked card (Singularity/Tempest/Shield Bash/Rend Blade). Add a Blade one — e.g., "Tempo Edge: a flurry whose hit count scales with current Tempo." Closes a real, visible gap. *Hooks: `cards.ts` `hero: "blade"`, milestone unlock in `profile.ts`.*
21. **In-run hero passive growth.** ◆◆ · M — A hero's passive *levels up* mid-run as you hit thresholds (kills, perfect dodges, crashes), giving light in-run progression that isn't another card/relic. *Hooks: `heroes.ts` data + `profile`/run stats.*
22. **Loadout / blessing choice at run start.** ◆◆ · S — Let the player pick their 2 starting cards from a small per-hero pool, or choose a run-opening "blessing." Early agency, more run-to-run variety. *Hooks: hero-select flow, `deck.resetForRun`.*
23. **A 6th hero with a genuinely new playstyle.** ◆◆ · L — e.g., a **Conductor** (commands turrets/echoes — a summoner) or a **Revenant** (lifesteal + a risk mechanic). The data-driven hero system makes the *stats* easy; the new mesh + a unique mechanic is the work. *Hooks: `heroes.ts`, `player.ts`, possibly a hero-specific system.*

## 6. Narrative & world (cash in the bittersweet arc)

You built a strong tragic throughline — now make it explorable and consequential.

24. **The mercy / true ending.** ◆◆◆ · M-L — A way to *not* extinguish the light: a "Relic of Mercy," or sparing the wardens, or a condition met across the run, opening an alternate final beat and a second ending. The single biggest payoff for the story investment. *Hooks: run state flag, branch in `RUN_VICTORY`/the ending, maybe #15.*
25. **Lore codex + collectible "echoes."** ◆◆ · M — Murals/inscriptions in arenas and droppable lore fragments that assemble the wardens' full tragedy in a readable codex (a great place to revive the dormant Bestiary as an *earned* collection). Gives a reason to explore and a long-term completion goal. *Hooks: a `codex.ts`, a menu screen, fragments as rare node rewards.*
26. **Hero-specific ending reactions.** ◆ · S — One closing line at the ending reflecting *who* you played (the Reaver's bloodlust quieting, the Sparkmage losing the power that defined them). Cheap, high-flavor, deepens replay. *Hooks: `ENDING_LINES` keyed by hero.*
27. **Carry the fallen wardens.** ◆◆ · M — Each warden you beat grants a small boon "in their memory" (a passive echoing their kit), making them allies-in-death — mechanically *and* narratively reinforcing the theme that they were never the enemy. *Hooks: run boon system, `relics`-like hooks.*
28. **NG+ / "the grey dawn."** ◆◆ · M — A post-victory mode where the Rift reopens: remixed enemy pools, a desaturated palette, and harder pacing, carrying a token of your last run. Fresh endgame that fits the fiction. *Hooks: `mapgen.ts` pools, theme, a profile flag.*

## 7. Run structure & variety

29. **More events + a recurring NPC.** ◆◆ · M — 8–12 new event vignettes (you have 4) plus a recurring character — a surviving warden's echo, a wandering merchant — who threads a small side-story across nodes. *Hooks: the `EVENTS` table in `menus.ts` (factor it into `events.data.ts`).*
30. **New node kinds.** ◆◆ · M — A **Shrine** (sacrifice HP/a relic for power), **Forge** (#8), **Gamble** (risk a relic for a better one), **Memory** (a lore beat, #25). Builds directly on the existing node system. *Hooks: `mapgen.ts` node kinds, `main.ts`/`menus.ts` screens.*
31. **Path intel / map foresight.** ◆◆ · S — Show a hint of what each branch leads to deeper (elite-guarded treasure, double-shop, a boss-fast route). Makes routing a decision, not a coin flip. *Hooks: `mapgen.ts` metadata, `showMap` in `menus.ts`.*
32. **Covenants / run modifiers.** ◆◆ · M — Optional self-imposed challenges for bonus shards/score: no-cards, glass-only, time attack, ironman. Replayability for skilled players. *Hooks: a modifiers config consulted at run start.*

## 8. Meta-progression & endgame loop

Shards currently only buy Armory cosmetics — the between-runs loop is thin.

33. **Reroll / banish in drafts.** ◆◆◆ · S — Spend shards to reroll a draft, or banish a card from the run's pool so future drafts improve. The cheapest, biggest agency-over-RNG win. *Hooks: `deck.draftChoices`, draft UI, shard spend.*
34. **A real shard sink (carefully).** ◆◆ · M — An optional meta layer: draft rerolls (above), a starting blessing, an extra relic at run start. Two framings to choose between: (a) a light **meta-upgrade tree** (more agency, some power creep risk), or (b) keep power runs pure and spend shards only on *convenience + cosmetics + unlocks* (anti-power-creep, more "fair"). Worth a deliberate design call. *Hooks: `profile.ts`, a meta screen.*
35. **Ascension rewards.** ◆◆ · S — Each depth cleared grants a title/cosmetic/relic unlock, not just "the next depth is available." A carrot for climbing. *Hooks: `profile.ts` on depth-clear.*
36. **Score / style system + weekly seed.** ◆◆ · M — Score runs on style (time-in-Critical, no-hit streaks, speed) with a local leaderboard and a weekly seeded challenge alongside the daily. *Hooks: a scoring module, `profile` history, daily/weekly seed.*
37. **Endless / pinnacle mode.** ◆ · M — After depth 15, an endlessly escalating mode purely for score. *Hooks: `difficulty.ts` extrapolation past MAX_DEPTH.*

## 9. UX, juice & polish

38. **Run recap / build summary on the end screen.** ◆◆ · S — Final loadout, biggest single hit, time-in-each-tempo-zone graph, cards honed, relics held. Satisfying and shareable. *Hooks: end screens in `menus.ts`, run stats.*
39. **Revive the Bestiary as an earned Codex.** ◆◆ · M — It exists (`bestiary.ts`) but is unwired. Bring it back as a real collection (enemies + bosses + relics + lore from #25) with completion %. *Hooks: re-add to menu, wire to kills/encounters.*
40. **Smarter draft cards.** ◆ · S — "New!" badges, synergy highlights (#6), and a compare-to-owned hint. *Hooks: `menus.ts` `cardEl`/`relicEl`.*
41. **Combo/style meter + optional combat log.** ◆ · S — A hit counter and a "style" readout for players who want feedback on their flow. *Hooks: HUD.*
42. **More accessibility.** ◆◆ · S-M — Controller rumble/haptics, an aim-assist toggle (gamepad twin-stick), a one-handed layout, and a screen-reader pass on menus. Builds on the existing colorblind/brightness/FOV/reduce-motion options. *Hooks: `input.ts`, settings.*
43. **Seed sharing UI.** ◆ · S — Paste a seed (with depth) to replay a friend's exact run. Daily/seeded plumbing already exists. *Hooks: hero-select/settings.*

## 10. Audio (you now have bespoke per-act tracks)

44. **Adaptive / layered music.** ◆◆ · M — Intensity layers that swell in combat and thin in lulls, and that brighten at Hot/Critical — extending the existing duck + low-HP tension. Makes the soundtrack breathe with the Tempo meter. *Hooks: `music.ts`.*
45. **Tempo & event stingers.** ◆ · S — Short musical stings for Crash, hitting Critical, perfect dodge, and boss-phase shifts, layered over the streaming bed. *Hooks: `music.ts`/`sfx.ts`, event bus.*

## 11. Technical & quality-of-life

46. **Bundle/perf budget.** ◆ · M — The JS bundle is ~960 KB; code-split menus/cutscenes, and define a perf budget so the Low quality preset holds 60 fps on weak hardware. *Hooks: Vite config, `stage.applyQuality`.*
47. **Visual-regression CI.** ◆ · S — The smoke scripts already screenshot; diff them in CI to catch unintended visual changes. *Hooks: `.github/workflows`, smoke scripts.*
48. **Multiple save profiles / cloud sync (Electron).** ◆ · M — Separate profiles, and optional cloud backup of `rh3v2-profile`. *Hooks: `profile.ts`, Electron main.*

---

## Suggested bundles (ideas that combine well)

- **"Deckbuilder" bundle:** #5 statuses + #6 tags + #7 legendaries + #33 reroll/banish → drafting becomes the star of the game.
- **"Signature" bundle:** #1 Overdrive + #2 per-hero tempo + #3 Crescendo → the Tempo meter becomes the thing people talk about.
- **"Living world" bundle:** #10 affixes + #12 reactive AI + #11 packs + #14 boss variants → every fight feels authored.
- **"Cash in the story" bundle:** #24 mercy ending + #25 codex/echoes + #27 carry the wardens + #26 hero reactions → the narrative becomes a reason to replay.
- **"Endgame loop" bundle:** #33 reroll + #34 shard sink + #35 ascension rewards + #36 score/weekly → a reason to keep climbing.

## Sequencing notes (what to build first)

- #6 (tags) should land **before** tag-scaling relics in #7; both should land **before/with** #5 statuses so detonators have something to detonate.
- #25 (codex) is the natural home for reviving the Bestiary (#39) and for #24's lore.
- #10 (affixes) and #14 (boss variants) make #35 (ascension rewards) feel earned — build them together if you want the endgame to sing.

## Considered but probably *not* (kept off the menu on purpose)

- **Multiplayer / co-op / PvP** — would fight the tight single-player, twin-stick, tempo-solo identity and is a huge lift. Mentioned only so you know it was weighed.
- **Open-world / hub town** — the run-based forked-map structure is a strength; a persistent hub would dilute pacing. A small "between-runs" framing screen is the most I'd consider.
- **Procedural *audio* for music** — your bespoke per-act tracks are better than anything synthesized; keep SFX procedural, music authored.
