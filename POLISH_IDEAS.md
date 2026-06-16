# Rogue Hero 3 — Road to a Finished, Polished Game

A menu of improvement ideas, grounded in the **current** state of the codebase (surveyed June 2026). Each item is tagged so you can triage fast:

- **Effort** — `S` (hours), `M` (a day or two), `L` (multi-day / system-level)
- **Impact** — ★ (nice), ★★ (noticeable), ★★★ (game-defining)

Check the boxes you want and hand this back; I'll turn the selected ones into a build plan.

> **Where the game stands today:** mechanically complete and well-juiced core loop — 3 heroes, 20 cards (3 rarities), 16 relics, 3 acts × 4 rooms, 3 bosses, milestone unlocks, cosmetics, save/continue, story + boss cutscenes. The gaps are mostly in **breadth** (content variety, replayability systems), **front door** (onboarding, settings, accessibility), and **commercial finish** (music, gamepad, store integration). The fundamentals are strong; this is genuinely a polish-to-ship list, not a rescue list.

---

## ✅ Implementation status (updated 2026-06-14)

A large slice of this list has now shipped (all build/typecheck-clean, full smoke suite green):

**Done**
- **Music** — streaming adaptive soundtrack (menu / map / per-act combat / boss), crossfades, cutscene ducking, low-HP tension, separate Music slider (§B1–B6 core).
- **Game feel** — screen flash on crits/crash/boss-death/victory, combo counter, hit-direction glow, new SFX (§A1–A4).
- **Content** — +2 heroes (5 total), +5 cards (25), +5 relics (21), +3 enemies (15), +1 boss (Rift Tyrant), +10 cosmetics, +12 achievements (§D2/D5, content).
- **Levels** — Act IV "The Sundered Abyss" (4 rooms), 2 new arena themes (§C13, partial §L1).
- **Cutscenes** — per-boss-phase cinematics for every boss + death-jolt killcam (§A6).
- **Onboarding** — interactive Training Grounds tutorial (§E1).
- **Settings/accessibility** — SFX/Music sliders, **key rebinding**, brightness/gamma, FOV, Reduce Motion, **colorblind palette**, quit-to-desktop (§F, §G1–G2).
- **Input** — full **gamepad** support + rebindable action layer (§I1, §I3).
- **Screens** — Achievements, Credits, **Bestiary/Codex** (§H1–H3).
- **Replayability** — **daily + seeded runs** with local best (§C9–C10).
- **Branching map (forked path)** (§C2) — runs are now a generated map: at each chamber pick 1 of 2–3 node types (**combat / elite / shop / treasure / rest / event**), each act ends at its boss. Seeded + deterministic (resume + dailies reproduce). Replaces the old linear room list (`game/mapgen.ts`).
- **Ascension difficulty ("Rift Depth")** (§C1) — a 0–10 ladder of stacking modifiers (enemy HP/damage, fewer heals, extra elites, boss HP); win a depth to unlock the next. Depth picker on hero-select, HUD badge, end-screen stat (`game/difficulty.ts`).
- **Room-type variety** (§C3–C6) — shop / treasure / rest / event nodes, all chooseable on the map.
- **Ship hygiene** — save **export/import** (§N5), **GitHub Actions CI** running `verify` (§O2).

**Deferred (need external infrastructure)** — left unchecked below:
- **Steam integration, auto-update, code signing, cloud save** (§N1/N3/N4/N6) — require external accounts/SDKs/certs/a release server; can't be completed from source alone.
- **Full localization** (§O5) — i18n framework + string extraction across the whole UI; large mechanical pass.

---

## ⭐ If you only do a handful (highest impact per effort)

These are the items that most separate "impressive prototype" from "real game." Details for each live in the sections below.

- [ ] **Adaptive background music** — the single biggest missing piece; there is currently *no* in-combat music at all (§B1)
- [ ] **Difficulty ladder (Ascension / "Rift Depth")** — the #1 replayability lever once milestones are exhausted (§C1)
- [ ] **A real tutorial / first-run experience** — new players are dropped into Act I cold (§E1)
- [ ] **Expanded settings + audio mixing** (separate SFX/Music sliders, key rebinding) (§F)
- [ ] **Branching map with room-type variety** (shops, treasure, events) (§C2)
- [ ] **Gamepad support** (§I1)
- [ ] **Screen-flash & richer hit feedback on big hits / crits** — cheap, huge feel payoff (§A1)
- [ ] **Codex / Bestiary + Achievements screen** — makes the meta feel complete (§H1, §H2)

---

## A. Game Feel & Juice

The combat already has trauma shake, camera kick, screen punch, particles, telegraphs, kill streaks, and a deliberate no-hitstop design. These ideas push it further *without* violating the no-hitstop rule.

- [ ] **A1. Screen flash / color pop on big hits & crits** `S` ★★ — Today only vignette darkening + chromatic aberration respond to impact. Add a brief additive white/zone-colored full-screen flash for crits, finishers, and crash novas. Cheap, dramatic.
- [ ] **A2. Per-swing combo counter** `S` ★★ — A "×N HITS" combo readout (distinct from the existing kill streak) that climbs as you chain melee without getting hit, feeding the tempo fantasy.
- [ ] **A3. Hit-count floater on cleaves** `S` ★ — When a swing catches multiple enemies, show "3 HIT!" so the AoE payoff is legible (tempo already scales with enemies caught — surface it).
- [ ] **A4. Damage-direction indicators** `S` ★★ — Directional arcs on screen edge when hit from off-screen. Big readability win in crowded rooms.
- [ ] **A5. Motion trails on dashes & fast card moves** `M` ★ — You have a sword ribbon; extend the trail concept to dash-strike / phase-step for a smear of speed.
- [ ] **A6. Killcam / slow-pan on boss death** `M` ★★ — A brief cinematic beat when a boss dies (you already have the cutscene + letterbox plumbing) before the epitaph banner.
- [ ] **A7. Environmental reaction** `M` ★ — Arena disc ripples/embers react to crash novas and boss slams (you have a pooled particle system + arena shader to hook into).
- [ ] **A8. Controller/screen rumble hooks** `S` ★ — Wire trauma events to gamepad vibration (pairs with §I1).
- [ ] **A9. Dynamic tempo-zone vignette audio** `S` ★ — Subtle rising drone/heartbeat as you enter Hot/Critical zones (ties into §B adaptive music).
- [ ] **A10. "Last hit" lethal feedback** `S` ★ — Distinct flash + sound when a blow is the killing one, so kills read crisply even in a swarm.

## B. Audio & Music

**Today there is no music during gameplay** — only procedural SFX and a menu ambient pad. This is the most conspicuous "unfinished" tell for most players.

- [ ] **B1. Adaptive/layered background score** `L` ★★★ — Procedural (to honor the no-asset-files rule) or licensed tracks. Layer intensity by combat state: explore → engaged → boss → low-HP. Stems that fade in/out on tempo zone and wave count.
- [ ] **B2. Per-act musical themes** `M` ★★ — Distinct motif per act (Ember Rift / Shattered Spire / Molten Core) crossfading like the existing `arena.applyTheme`.
- [ ] **B3. Boss battle music + phase shifts** `M` ★★ — Music ramps at each of the 3 boss phases.
- [ ] **B4. Audio mixing buses + ducking** `M` ★★ — Add Master/Music/SFX/UI buses; duck music under big SFX and during cutscenes. Currently everything routes flat to master gain.
- [ ] **B5. Separate volume sliders** `S` ★★ — Music / SFX / UI / Master, instead of today's single master slider (pairs with §F1).
- [ ] **B6. Victory & menu stingers polish** `S` ★ — You have victory/defeat/unlock fanfares; add a triumphant act-clear theme and a main-menu signature motif.
- [ ] **B7. Spatial/positional SFX** `M` ★ — Pan enemy attacks and projectiles by screen position for situational awareness.

## C. Content & Replayability (run structure)

The run is currently **fixed and linear**: 3 acts × 4 rooms (combat, combat, elite, boss), deterministic route, no in-run economy, no events. This is the biggest lever for long-term play once unlocks are earned.

- [ ] **C1. Difficulty ladder ("Rift Depth" / Ascension / Heat)** `L` ★★★ — Stacking modifiers unlocked by winning (more enemy HP, new attack patterns, less healing, elite affixes…). The single best replayability system for a roguelike; gives the milestone-maxed player a reason to keep going.
- [ ] **C2. Branching map with path choice** `L` ★★★ — Slay-the-Spire-style node map: choose between combat / elite / shop / treasure / event / rest. Turns a linear corridor into a run with decisions.
- [ ] **C3. In-run shop rooms** `M` ★★★ — Spend rift shards (or a run-local currency) mid-run on cards, relics, heals, removals. You already have the shard economy and draft UI to build on.
- [ ] **C4. Treasure / reward rooms** `S` ★★ — Guaranteed relic or rare-card pickups; risk/reward (e.g., cursed chest).
- [ ] **C5. Event / encounter rooms** `M` ★★ — Narrative choices with mechanical payoffs (gamble HP for a relic, shrine that boosts tempo gain, etc.). Adds texture and world-building.
- [ ] **C6. Rest / forge rooms** `S` ★★ — Heal **or** upgrade a card **or** remove a card. Classic meaningful choice.
- [ ] **C7. Mini-bosses / elite affixes** `M` ★★ — Today there are only 3 bosses (one per act). Add affixed elites (shielded, enraged, splitting) for mid-act spikes.
- [ ] **C8. Card upgrade system** `M` ★★ — Cards never improve mid-run today. Add "+" upgraded versions (more damage, lower cooldown, extra arc) via forge/shop. Deepens build choices.
- [ ] **C9. Daily run with shared seed + local leaderboard** `M` ★★ — A reproducible daily seed and a best-score table. Strong retention hook; runs are currently fully stateless/unseeded.
- [ ] **C10. Custom / seeded runs** `S` ★ — Let players enter a seed for sharing/practice (requires threading the RNG through a seed — `core/rng.ts`).
- [ ] **C11. Run modifiers / mutators** `M` ★ — Optional toggles (double speed, glass-cannon mode, no-cards melee-only) for variety and challenge.
- [ ] **C12. Endless / survival mode** `M` ★ — Post-victory infinite scaling mode for high scores.
- [ ] **C13. More act/room variety within the same length** `M` ★★ — Even without new acts, vary wave compositions, obstacle layouts (you have `arena.obstacles`), and arena hazards per room.

## D. Heroes, Cards, Relics — build depth

- [ ] **D1. Unique hero abilities, not just stat multipliers** `L` ★★★ — Heroes today differ only by numbers (HP/speed/power) + a passive. Give each a signature mechanic (e.g., Bulwark gets a parry, Sparkmage a mana/overcharge resource). Biggest "these feel like different games" win.
- [ ] **D2. A 4th hero (or more)** `M` ★★ — New playstyle to chase; you have the data-driven hero framework to extend.
- [ ] **D3. Card/relic synergy tags & build archetypes** `M` ★★ — Surface synergies (bleed builds, frost builds, tempo-engine builds) so drafting feels intentional rather than 3 random picks.
- [ ] **D4. Curse / double-edged relics** `M` ★ — Only Glass Cannon is double-edged today. Add high-risk/high-reward and cursed items for spicier drafts.
- [ ] **D5. More cards & relics** `M` ★★ — 20 cards / 16 relics is a solid base; another tier each (especially rares and build-enablers) extends replay.
- [ ] **D6. Draft tooltips & detail view** `S` ★★ — Expand the draft screen with full stats, synergy hints, and "what this combos with." Currently just name + short desc.
- [ ] **D7. Loadout / starting-deck customization** `M` ★ — Let players pick their 2 starting cards from unlocked pools at hero select.
- [ ] **D8. Relic/card "remove" or reroll** `S` ★ — Spend shards to reroll a draft or remove a dead card (pairs with shops §C3).

## E. Onboarding & Tutorial

New players currently get a "How to Play" text screen + fading HUD hints, then go straight into Act I. No interactive teaching.

- [ ] **E1. Interactive tutorial room** `M` ★★★ — A scripted first encounter: move here, attack the dummy, dodge the telegraph (teach perfect-dodge!), cast a card, build tempo, crash. The perfect-dodge and tempo systems are your signature mechanics and are currently *undiscoverable*.
- [ ] **E2. Contextual first-time hints** `M` ★★ — One-time popups ("You can perfect-dodge — dodge the instant the attack lands!") triggered the first time a player faces each mechanic.
- [ ] **E3. Tooltips everywhere** `S` ★★ — Hover tooltips on cards, relics, tempo dial, and HUD elements explaining what they do.
- [ ] **E4. Telegraph legend / threat glossary** `S` ★ — Brief in-codex explainer of what circle vs. line telegraphs mean.
- [ ] **E5. Difficulty/assist options for new players** `S` ★ — An easy mode or assist toggles (see §G) lowers the bounce rate.

## F. Settings & Options

Today the entire settings panel is **three controls**: master volume, screen-shake amount, graphics quality (low/med/high). A finished game's options menu is much deeper.

- [ ] **F1. Separate audio sliders** `S` ★★ — Master / Music / SFX / UI (pairs with §B4–B5).
- [ ] **F2. Key rebinding UI** `M` ★★ — All keys are hardcoded across input/controller/combat/deck. Add a rebinding layer + UI. Expected in any PC action game.
- [ ] **F3. Brightness / gamma slider** `S` ★★ — Tone-mapping exposure is currently baked at a fixed value; let players adjust.
- [ ] **F4. Granular graphics toggles** `M` ★ — Individual bloom / chromatic aberration / film grain / vignette / SMAA toggles + intensity, beyond the 3 presets.
- [ ] **F5. FOV slider** `S` ★ — Base FOV is fixed at 50°.
- [ ] **F6. Resolution / fullscreen / vsync / FPS cap** `S` ★★ — Standard display options for the Electron window.
- [ ] **F7. Camera-shake split from "punch"** `S` ★ — Separate sliders for shake vs. screen punch vs. FOV pulses (motion-comfort).
- [ ] **F8. Quit-to-desktop + confirmation** `S` ★★ — There is no explicit quit flow; ESC only pauses. Add Quit (with confirm) to pause/main menu.
- [ ] **F9. Persist & reset-to-default** `S` ★ — A "restore defaults" button and clear settings versioning.

## G. Accessibility

Currently the only accessibility-adjacent options are screen-shake amount and quality presets. Accessibility is increasingly an expectation (and a storefront feature).

- [ ] **G1. Colorblind modes** `M` ★★ — Tempo zones are cyan/gold/red and telegraphs are red — not colorblind-safe. Add palette options + non-color cues (icons/patterns) for zones and threats.
- [ ] **G2. Reduce-motion mode** `S` ★★ — One toggle that caps trauma, screen punch, FOV pulses, and chromatic aberration for motion-sensitive players.
- [ ] **G3. Text scaling / UI scaling** `M` ★★ — HUD and menus use fixed px sizing; add a UI scale slider for readability and high-DPI.
- [ ] **G4. High-contrast / readable-font mode** `S` ★ — Optional high-contrast HUD and dyslexia-friendly font toggle.
- [ ] **G5. Captions/subtitles for cutscenes & audio cues** `S` ★ — Story intro is on-screen text already; add visual captions for important *audio* cues (boss roar, beam charge).
- [ ] **G6. Assist toggles** `M` ★★ — Damage reduction, slower enemy projectiles, larger perfect-dodge window, auto-aim assist. Lets more people finish the game.
- [ ] **G7. Hold-vs-tap & input-timing options** `S` ★ — Configurable dodge buffering / timing windows.
- [ ] **G8. Photosensitivity pass** `S` ★★ — Audit bloom/flash frequency; provide a flash-reduction toggle (also derisks storefront/age-rating review).

## H. UI / UX & Missing Screens

The HUD and menus are well-built, but several "expected" screens don't exist.

- [ ] **H1. Bestiary / Codex** `M` ★★ — An encyclopedia of enemies (12 types), bosses, cards, and relics — unlocked as you encounter them. Great for lore + teaching telegraphs.
- [ ] **H2. Achievements / trophies screen** `M` ★★ — Today there's only an unlock-hints grid in Progress. A proper achievement list (with hidden ones) drives completion (pairs with §N3 for Steam).
- [ ] **H3. Credits screen** `S` ★ — No credits exist. Required for ship; add team/tools/music attribution with a nice scroll.
- [ ] **H4. Detailed end-of-run summary** `S` ★★ — Death/victory screens show core stats; add a richer recap (build taken, biggest hit, tempo-time-in-zone, damage by source, "cause of death").
- [ ] **H5. Run-history detail view** `S` ★ — Click a past run to see its build and stats, not just outcome/kills/time.
- [ ] **H6. Minimap / arena overview** `S` ★ — Optional small indicator of off-screen enemies / room bounds.
- [ ] **H7. Cosmetic preview** `S` ★ — Armory swatches are tiny; show a full rotating hero preview with the equipped cape/blade.
- [ ] **H8. Pause-menu polish** `S` ★ — Add Restart Run, Settings (exists), Codex, Quit; show current build at a glance.
- [ ] **H9. Notification/toast system** `S` ★ — Unified toasts for unlocks, milestone progress ("12/15 perfect dodges"), and shard gains.
- [ ] **H10. Loading/transition screens with lore tips** `S` ★ — Use room transitions to surface gameplay tips and flavor.

## I. Input & Platform

- [ ] **I1. Full gamepad support** `L` ★★★ — Zero controller support today (keyboard + mouse only). Twin-stick action games are vastly better on a pad; also a prerequisite for console ports and "couch" appeal. Includes aim-stick, glyph swapping in UI, and menu navigation.
- [ ] **I2. On-screen control glyphs that match the active device** `M` ★ — Swap keyboard/mouse prompts for controller glyphs automatically.
- [ ] **I3. Input rebinding** `M` ★★ — (same as §F2, listed here for the input track).
- [ ] **I4. Steam Deck verification pass** `M` ★★ — Controller-first UX + readable text + default graphics that hit 60fps on Deck. Strong distribution opportunity for an indie roguelike.
- [ ] **I5. Touch / mobile control scheme** `L` ★ — Only if you're considering a mobile/tablet build; large effort.

## J. Meta-Progression depth

- [ ] **J1. Difficulty ladder rewards** `M` ★★ — Tie cosmetics / lore / titles to ascension tiers (depends on §C1).
- [ ] **J2. Persistent permanent upgrades (Hades-style "Mirror")** `M` ★★ — Optional opt-in meta-upgrades bought with shards. Note: can clash with a "pure" roguelike vision — decide intent first.
- [ ] **J3. More cosmetics + cosmetic types** `M` ★ — Today: cape + blade colors. Add trails, auras, victory poses, hero skins, arena themes.
- [ ] **J4. Titles / ranks / mastery per hero** `S` ★ — Per-hero mastery tracks and display titles.
- [ ] **J5. Stat dashboard** `S` ★ — A richer lifetime-stats page (favorite cards, win rate per hero, time in each tempo zone).
- [ ] **J6. Milestone/quest log** `S` ★ — Show active milestone goals and progress, not just retrospective unlocks.

## K. Narrative & World

You have a 3-line story intro, act flavor text, and boss epitaphs — a nice skeleton. A finished game usually layers more.

- [ ] **K1. Expanded lore via codex/events** `M` ★ — Flesh out the Rift, the three wardens, and the heroes through codex entries and event-room vignettes.
- [ ] **K2. Hero-specific intros/endings** `M` ★ — Different opening/victory beats per hero for replay incentive.
- [ ] **K3. Boss dialogue / taunts** `S` ★ — Lightweight pre-fight lines (text + your existing roar SFX) to give bosses character.
- [ ] **K4. A true final-victory epilogue** `S` ★ — A more cinematic "Rift Sealed" ending beat (you have cutscene plumbing).
- [ ] **K5. Environmental storytelling** `M` ★ — Visual details in arenas that hint at the fallen kingdom.

## L. Visual / Art Direction Polish

- [ ] **L1. More distinct arena identities per act/room** `M` ★★ — Lean harder into the per-act `THEMES`; vary geometry, sky, lighting, and hazards so rooms feel different.
- [ ] **L2. Better boss/elite silhouettes & tells** `M` ★ — Stronger visual language so threats read instantly.
- [ ] **L3. Richer enemy variety in look** `M` ★ — Procedural meshes are clean; add silhouette/animation variety so the 12 types are instantly distinguishable.
- [ ] **L4. Hero idle/victory animations & personality** `S` ★ — Idle flourishes, a victory pose, taunts — cheap character with the existing pose-layering system.
- [ ] **L5. Polished main-menu scene** `M` ★★ — A living menu (slow orbit exists) with hero on display, animated rift, signature music (§B6).
- [ ] **L6. Lighting & post pass per quality tier** `M` ★ — Make High mode genuinely showcase-worthy for trailers/screenshots.
- [ ] **L7. Screenshot / photo mode** `S` ★ — A pause-and-frame mode (hide HUD, free camera). Great for marketing and players sharing builds.

## M. Performance & Technical Health

- [ ] **M1. Performance budget & profiling pass** `M` ★★ — Verify 60fps on mid hardware across all rooms + worst-case swarms; profile particle/post costs.
- [ ] **M2. Object pooling audit** `M` ★ — Confirm no per-frame allocations / GC hitches in combat (you pool particles, telegraphs, slash arcs — extend the discipline everywhere).
- [ ] **M3. Dynamic quality scaling** `M` ★ — Auto-drop effects if frame time spikes, to protect feel on low-end machines.
- [ ] **M4. FPS / frame-time overlay (dev + optional player)** `S` ★ — A toggleable perf overlay.
- [ ] **M5. Loading-time & first-paint optimization** `S` ★ — Ensure fast cold start; lazy-load non-critical bits.
- [ ] **M6. Memory-leak soak test** `S` ★ — Long-session test for leaks across many room loads/disposes.

## N. Shipping & Commercial Finish

These are the things that make it a *product*, not just a build.

- [ ] **N1. Auto-update** `M` ★★ — No update mechanism today. Add `electron-updater` so you can ship balance patches post-launch.
- [ ] **N2. Crash reporting & opt-in analytics** `M` ★★ — Currently unhandled exceptions just kill the window, and there's no telemetry. Add a crash handler + (consented) basic funnel analytics to see where players drop.
- [ ] **N3. Steam integration** `L` ★★★ — Achievements, Cloud saves, rich presence, overlay. The standard distribution path for a PC roguelike; pairs with §H2/§N5.
- [ ] **N4. Cloud / multi-device saves** `M` ★ — Today it's localStorage only (lost on cache clear, not portable). Steam Cloud (via §N3) is the easy path.
- [ ] **N5. Save robustness & backup** `S` ★★ — Add save backup/restore, corruption recovery, and an export/import for the single profile + run save. Plaintext JSON in localStorage is fragile.
- [ ] **N6. Code signing** `M` ★★ — Unsigned Electron triggers Windows SmartScreen / macOS Gatekeeper warnings. Sign builds for trust.
- [ ] **N7. Multi-platform packaged installers** `M` ★ — Proper Win/Mac/Linux installers (electron-builder) with icons, file associations, uninstaller.
- [ ] **N8. Versioning & changelog / patch notes** `S` ★ — Version is a static `2.0.0`; add a real release process and an in-game "What's New."
- [ ] **N9. Store presence assets** `M` ★★ — Capsule art, trailer, screenshots, GIFs, store description. (Photo mode §L7 + killcam §A6 help here.)
- [ ] **N10. EULA / privacy / licenses screen** `S` ★ — Required boilerplate for a storefront release (esp. if analytics added).
- [ ] **N11. Age-rating / content-descriptor prep** `S` ★ — Photosensitivity audit (§G8) + descriptors for ESRB/PEGI self-rating.

## O. Quality Assurance & Stability

- [ ] **O1. Unit / integration test suite** `M` ★★ — Only headless smoke scripts exist today. Add `vitest` unit tests for damage pipeline, tempo math, relic hooks, save serialization — the logic most likely to regress.
- [ ] **O2. CI pipeline** `S` ★★ — No CI today. GitHub Actions running `verify` + smoke tests on every push.
- [ ] **O3. Balance pass & telemetry-driven tuning** `M` ★★ — Once §N2 analytics exist, tune difficulty curve, card/relic pick rates, death distribution.
- [ ] **O4. Edge-case & soft-lock hardening** `S` ★ — Audit state-machine transitions (the code already guards a boss dying mid-cutscene — extend that rigor).
- [ ] **O5. Localization framework** `L` ★ — Externalize all UI strings (currently hardcoded English) to enable translations; big reach win for indie roguelikes.
- [ ] **O6. Playtest program & feedback loop** `M` ★★ — Structured external playtests before launch; the single best source of polish priorities.

## P. Stretch / Long-Shots

- [ ] **P1. Co-op or versus multiplayer** `L` ★ — Large undertaking; only if it fits the vision.
- [ ] **P2. Weekly community challenges / events** `M` ★ — Seeded weekly runs with modifiers + leaderboard.
- [ ] **P3. Mod / custom-content support** `L` ★ — Data-driven cards/relics already lean this way; expose them for community content.
- [ ] **P4. New Game+ / prestige** `M` ★ — Post-completion remix mode.
- [ ] **P5. Boss rush mode** `S` ★ — All bosses back-to-back; reuses existing content.

---

## Suggested phasing (a possible order)

1. **Feel & front door (fast wins):** §A1–A4, §F (settings + rebinding), §G2 reduce-motion, §H3 credits, §F8 quit.
2. **The big "real game" pillars:** §B1 music, §E1 tutorial, §C1 difficulty ladder, §I1 gamepad.
3. **Replayability depth:** §C2 branching map, §C3 shops, §C5 events, §D1 hero abilities, §H1 codex.
4. **Commercial finish:** §N1 auto-update, §N3 Steam (achievements + cloud), §N5/N6 save robustness + signing, §O1/O2 tests + CI.

> Tell me which boxes you want (or just name a phase) and I'll draft the implementation plan, respecting the project invariants — no asset files (procedural audio/meshes), typed events, all damage through the combat pipeline, dispose-what-you-create, and tempo changes only via `gain/drain/crash`.
