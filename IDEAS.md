# Rogue Hero 3 — Possible Improvements

Cherry-pick; nothing here is committed work. Grouped by payoff-per-effort.
Delete this doc once picked over.

## High payoff, low effort

1. **Daily run** — mapgen is already seeded/deterministic; a "Daily Rift" button
   is just `seed = dateHash(today)` + a fixed hero/depth + a one-line result
   stored in the profile. Biggest replay feature for the smallest diff.
2. **Run seed on the recap + "retry this seed"** — show the seed on the
   end-screen recap and let the player re-run it. Free from the same plumbing.
3. **Card removal at shops** — classic roguelike deck-thinning valve. Shop
   already exists; one new purchase row. Makes late-game drafts meaningful
   instead of dilutive.
4. **Relic tooltips in the pause/HUD relic row** — if hover/select doesn't
   already show full text, players forget what their 6th relic does. Pure DOM.
5. **Stats on the pause screen** — current run damage dealt/taken, perfect
   dodges, crashes, crescendo peak. The combat pipeline already counts these
   for the recap; surface them mid-run.
6. **Death recap: what killed you** — name the enemy/attack + last 3 damage
   events. `damagePlayer` already returns how damage resolved; log a ring
   buffer of 3.

## Combat / moment-to-moment

7. **Perfect-dodge payoff escalation** — perfect dodge currently intercepts;
   add a brief "riposte window" where the next hit gains tempo or auto-crits.
   Makes the dodge skill ceiling visible.
8. **Execution variety** — executions exist; give 2–3 procedural finisher
   poses picked by weapon/hero so the 100th execution still reads.
9. **Enemy elite affix telegraphing** — affixed elites should read at a glance
   (colored rim/crown per affix) before the first hit, not after. Cheap
   material tint per affix.
10. **Crowd control diminishing returns** — if freeze-chains can stunlock
    packs indefinitely, add stacking freeze resistance per enemy. Balance
    valve, protects the depth ladder.
11. **A "pull" verb** — every current verb pushes/evades. One card family that
    yanks enemies together (pairs with Shatterglass/volatile) opens a new
    build axis without new systems.

## Run structure / meta

12. **Events need teeth** — if event nodes are mostly flavor + small rewards,
    add 3–4 risk/reward events (cursed relic offers, HP-for-legendary, tempo
    pact that locks your floor higher). Cursed relics already exist; events
    are the natural delivery vehicle.
13. **Hero mastery tracks** — per-hero win counts already live in the profile;
    hang small unlocks off them (a hero-locked card at 1 win, a cosmetic at
    depth 5). Gives each hero a reason to be replayed.
14. **Depth-15 capstone** — the ladder ends at 15; give the top a distinct
    reward (unique blade cosmetic, title on the main menu) so the grind has a
    summit.
15. **Weekly modifier mutators** — one rotating rule (all elites champion,
    tempo drains 2×, shops closed) layered on the daily. Reuses the
    difficulty-modifier plumbing.
16. **Shop reroll** — draft reroll exists; shops probably want the same shard
    sink.

## Presentation / feel

17. **Boss health-bar phase ticks** — segment the boss bar at phase
    thresholds so players see the next drama beat coming. DOM only.
18. **Kill-streak audio layer** — music system already ducks/swells; add a
    thin percussion layer that fades in while Tempo is Critical. Sells
    Crescendo harder than any UI number.
19. **Arena reactivity at Critical** — embers/sky pulse subtly with the tempo
    zone. `applyTheme` + particles already exist; this is a uniform tweak,
    not a new system.
20. **Photo-worthy victory shot** — on RUN_VICTORY, freeze a beauty frame
    (hero pose, slow orbit) behind the recap instead of the raw last frame.

## Hardening / tooling (only if they've bitten you)

21. **GC-pause follow-through** — the soak found 999ms GC pauses in heavy
    combat. If still unfixed: audit per-frame allocations in the hot loop
    (vector temps, string building in HUD diff, floater churn) and pool the
    top offenders. This is the one perf item players actually feel.
22. **Save-slot count** — single RunSave means an accidental "New Run" click
    can eat a depth-14 checkpoint. A confirm dialog is the lazy fix; a second
    slot is the full one.
23. **Smoke consolidation** — ~40 smokes is a lot of serial wall-clock; a
    `smoke:core` alias running the 6 highest-signal ones keeps the
    per-round loop fast (full fleet stays for release).

## Deliberately not proposed

- New acts/heroes/bosses — scope expansion, your call, not an "improvement".
- Multiplayer/leaderboards-with-backend — cost posture (server) doesn't fit
  the free-tier constraint; daily runs give 90% of the value locally.
- Asset pipelines of any kind — policy says no.
