# Menu Performance — Lag Audit & Fix Ideas

> **Status: all five ideas implemented + a follow-up that restores the rich menu
> backdrop (2026-06-18).** Verified with `npm run verify` (green) and
> `scripts/smoke-menu-perf.mjs` (ALL PASS, no console errors); combat re-verified at
> full fidelity via `scripts/smoke-browser.mjs`. See *Implementation notes* below.
>
> **Follow-up — "bring back the map background":** the first cut left the menu 3D
> backdrop crushed to near-black at `high`/`medium`. Root cause (found by diff-testing
> live, not by theory): the **directional key light's shadow** was darkening the wide
> orbiting menu view to black, and the original "freeze the shadow map" kept
> `castShadow = true`. Fix: render menus through a **dedicated lean composer** (RenderPass
> + vignette + grade — no bloom/grain/SMAA) with **shadows off entirely**. That restores
> the full rift vista (starfield, glowing spires, floating rocks, rim glow, aurora) *and*
> is cheaper than the full chain. A subtlety that forced the two-composer design: simply
> disabling the heavy passes on the full composer leaves a disabled *trailing* pass in
> `postprocessing`, which unroutes the output and renders black — so the lean chain is
> built as its own composer. Combat/cutscenes still use the full composer.

**Symptom:** the game stutters badly while navigating menus, worst at the **main menu → hero select → start of run** path. Combat itself is fine; the *menus* lag.

**Why that's surprising:** the menus are plain DOM (`ui/menus.ts`) drawn over the live 3D canvas. The DOM is cheap. The cost is everything happening *behind* it — the full 3D engine keeps rendering at combat fidelity while you read text.

There is already a smoke test for this — run it before and after any change:

```bash
cd game && npm run dev          # dev server on :5174 (separate terminal)
node scripts/smoke-menu-perf.mjs
```

It throttles the CPU 3× and reports `max`, `p95`, and long-task durations for boot, hero select, the card sweep, settings, etc. That is your before/after number.

---

## Root cause in one paragraph

The frame loop (`src/main.ts` ~line 1473) does this **every frame, in every state**:

```ts
ctx.arena.update(dt);
ctx.fx.update(dt);
ctx.tele.update(dt);
ctx.cam.update(dt);
ctx.stage.update(dt);
ctx.stage.render(dt);   // <-- full EffectComposer chain, always
```

`stage.render` runs the whole post chain (`src/render/stage.ts:183`). At the default `"high"` preset that is **bloom + chromatic aberration + vignette + hue/sat + brightness/contrast + film noise + SMAA**, plus a **2048×2048 PCF soft shadow map that re-renders every frame**, plus the animated sky shader and the ambient ember particle cloud. None of that needs to be live while a static menu is up — but nothing tells the engine to back off. A first-time player gets `quality: "high"` by default (`src/ui/menus.ts:60`), i.e. the heaviest path, the instant the menu appears.

The five ideas below are ordered **biggest win / least risk first**.

---

## Idea 1 — A "menu render mode" that skips the heavy post chain *(biggest win)*

**Problem:** `stage.render()` always renders through the full `EffectComposer`. In `menu` / `draft` / `paused` / hero-select states the scene is essentially still, yet bloom + CA + noise + SMAA + per-frame shadows keep firing.

**Fix:** add a lightweight path on `Stage` and switch to it whenever `state` is not `playing`/`cutscene`.

```ts
// stage.ts
setLowCost(on: boolean): void {
  this.renderer.shadowMap.autoUpdate = !on;   // freeze the 2048² shadow map
  this.lowCost = on;
}

render(dt: number): void {
  if (this.lowCost) {
    // Bypass the composer entirely — direct render, no bloom/CA/noise/SMAA.
    this.renderer.render(this.scene, this.camera);
  } else {
    this.composer.render(dt);
  }
}
```

```ts
// main.ts frame loop, before stage.render:
ctx.stage.setLowCost(state !== "playing" && state !== "cutscene");
```

If a bare render looks too flat behind the title, keep the composer but rebuild a **menu-only effect set** (vignette + grade only, like the `low` preset) instead of bypassing it.

**Bonus, ~free:** `renderer.shadowMap.autoUpdate = false` alone, while in menus, stops the most expensive single per-frame GPU job. Flip it back on entering combat.

**Impact:** very high. **Effort:** ~1 hour. **Risk:** low — purely a render-path swap, no gameplay change.

---

## Idea 2 — Cap the menu frame rate (don't render 144 Hz of a still screen)

**Problem:** `setAnimationLoop` runs at the display's full refresh. A 144 Hz monitor renders the static menu 144×/sec for no benefit, and on a weak/integrated GPU that's exactly where frames start dropping under the post-chain load.

**Fix:** throttle rendering (not logic) to ~30–40 fps while not in active combat:

```ts
let menuAccum = 0;
const MENU_FRAME = 1 / 30;
// inside the loop, after updates:
if (ctx.playing || state === "cutscene") {
  ctx.stage.render(dt);
} else {
  menuAccum += dt;
  if (menuAccum >= MENU_FRAME) { menuAccum = 0; ctx.stage.render(MENU_FRAME); }
}
```

Menus stay smooth to the eye at 30 fps and the GPU does a third of the work. Combine with Idea 1 for the biggest swing.

**Impact:** high. **Effort:** ~30 min. **Risk:** low — keep input/gamepad polling at full rate so menu navigation stays responsive; only gate the *render*.

---

## Idea 3 — Stop rebuilding the hero mesh on every hover

**Problem:** hovering a hero card calls `previewHero` → `Player.applyHero` (`src/ui/menus.ts:139`), which **disposes and recreates the procedural hero geometry/materials on the main thread**. Sweeping across the six cards rebuilds it six times. It's debounced 120 ms + one rAF, but a deliberate move card-to-card still triggers a full rebuild each time — that's the hitch you feel on hero select. (The smoke test's `quick sweep over hero cards` exercises exactly this.)

**Fix — pick one, cheapest first:**

1. **Skip the live 3D preview on `low`/`medium` quality.** Each card already shows a CSS silhouette (`.hero-card__figure`), so the 3D mesh is a nicety, not load-bearing. Gate `previewHero` behind `quality === "high"`.
2. **Lengthen the debounce** from 120 ms to ~250 ms and only rebuild once the pointer *settles* — a fast sweep then builds one mesh, not six.
3. **Cache built hero meshes** keyed by `hero.id` (+ cosmetics) and swap `visible` instead of dispose/recreate. Biggest change, removes the cost entirely for repeat hovers.

**Impact:** high on hero select specifically. **Effort:** option 1 ~15 min, option 3 ~2 hours. **Risk:** low.

---

## Idea 4 — Trim the always-on CSS animations on menu screens

**Problem:** `src/style.css` has **80+ `infinite` keyframe animations** (`card-scan`, `card-flicker`, `card-jitter`, `card-spin`, `card-pulse`, `menu-sigil-drift`, `title-glow`, hero-figure auras…). On hero select and the draft screens, dozens animate **simultaneously, forever**, compositing and repainting over the live WebGL canvas every frame. That these are all killed under Reduce Motion (`style.css:1044 — animation: none !important`) is the tell that they're a measurable cost.

**Fix:**

- Gate the most expensive ones (`card-jitter`/`card-flicker` use `steps()` + `filter`, which repaint hard) behind `quality === "high"`, mirroring the Reduce-Motion off-switch.
- Prefer **transform/opacity-only** animations (compositor-only, no layout/paint). Audit any keyframe touching `filter`, `box-shadow`, `width`, `top` — those are the repaint-heavy ones.
- Pause animations on offscreen/non-focused cards (`animation-play-state: paused`).
- Add `will-change: transform` only to the few elements that actually move, so the compositor can promote them once instead of thrashing.

**Impact:** medium (mostly draft/hero screens, and CPU-side paint rather than GPU). **Effort:** ~1–2 hours of CSS triage. **Risk:** low — purely cosmetic.

---

## Idea 5 — Default to auto-detected quality, and quiet the menu particle/DOM churn

Two cheap, independent wins:

**5a — Don't ship `"high"` as the blind default.** `SETTINGS_DEFAULTS.quality = "high"` (`src/ui/menus.ts:60`) hands a first-time player the heaviest post chain (bloom + CA + noise + SMAA + 2048 shadows) before they've seen a single fight. Detect the device once and default accordingly:

```ts
const lowEnd = navigator.hardwareConcurrency <= 4 || /Intel|Iris|UHD|HD Graphics/i.test(rendererString);
quality: lowEnd ? "medium" : "high",
```

(Pull the GL `RENDERER` string via `WEBGL_debug_renderer_info`.) Users can still opt up in Settings. One line, broad reach.

**5b — Reduce menu-side per-frame churn.**
- The ambient ember cloud runs every frame; `ctx.fx.ambientRate` is set to 10 on the menu and **18** during the opening cutscene (`main.ts` `toMenu` / `startRun`). Lower the menu rate (and scale it by quality) — fewer pooled particles to update and draw behind a screen you're reading.
- Several menu handlers re-render an entire screen via `innerHTML` on each click — e.g. every quality/reduce-motion/colorblind toggle calls `showSettings(back)` again, re-parsing a large template and re-wiring every listener (`src/ui/menus.ts:709-736`). The depth picker already does the right thing — it patches just the changed nodes (`renderHeroSelect`'s `refreshDepth`, `menus.ts:353`). Apply that same targeted-update pattern to the settings toggles and blessing chips so a click flips a class instead of rebuilding the DOM subtree.

**Impact:** 5a high for low-end machines, 5b low–medium. **Effort:** ~1 hour combined. **Risk:** low.

---

## Suggested order of attack

| # | Fix | Win | Effort |
|---|-----|-----|--------|
| 1 | Menu render mode (bypass post chain + freeze shadows) | ★★★ | 1h |
| 2 | Cap menu render to ~30 fps | ★★★ | 30m |
| 5a | Auto-detect default quality | ★★★ (low-end) | 15m |
| 3 | Stop rebuilding hero mesh on hover | ★★ | 15m–2h |
| 4 | Trim infinite CSS animations | ★★ | 1–2h |
| 5b | Lower menu particles + targeted DOM updates | ★ | 1h |

**Fastest meaningful relief:** Idea 1's one-liner (`renderer.shadowMap.autoUpdate = false` in menus) + Idea 2 (fps cap) + Idea 5a (default `medium` on weak GPUs). That trio is ~1 hour total and attacks the dominant cost directly.

## How to verify each change

```bash
cd game && npm run verify                 # tsc + build must stay green
node scripts/smoke-menu-perf.mjs          # before/after: max, p95, longMax must drop
node scripts/smoke-browser.mjs            # confirm combat still renders at full fidelity
```

Watch that combat fidelity is unchanged — the goal is to back off **only** while a menu/draft/pause overlay is up, then restore the full chain the moment `state === "playing"`.

---

## Implementation notes (what shipped)

| Idea | Where | What changed |
|------|-------|--------------|
| 1 — Menu render mode | `render/stage.ts` (`setLowCost`, dual composers), `main.ts` frame loop | While not in combat/cutscene, `render()` switches to a **lean menu composer** (RenderPass + vignette + grade) and the key light's **shadow is turned off**. Skips bloom/grain/SMAA *and* the shadow-map render — and (see the follow-up note at the top) makes the rift backdrop read **rich** instead of crushed-black. Combat/cutscenes use the full composer with shadows. |
| 2 — Menu FPS cap | `main.ts` frame loop | Logic + input/gamepad still poll every vsync; the *render* is capped to ~40 fps (`MENU_FRAME = 1/40`) while a menu/overlay is up. Combat and cutscenes render uncapped. |
| 3 — Hero preview cost | `ui/menus.ts` `previewHero` | The live 3D mesh rebuild is now **`high`-quality only** (the CSS silhouette covers the rest) and the debounce went 120 ms → 220 ms so a fast sweep rebuilds once, not six times. |
| 4 — Trim CSS flourishes | `ui/menus.ts` `applySettings` + `style.css` | A `body.rh-no-anim` class (set when Reduce Motion is on **or** quality is Low) halts the continuous, paint-heavy animations the OS media query couldn't reach: card/slot sigils, the title's animated drop-shadow, and the drifting menu sigils. |
| 5a — Auto default quality | `ui/menus.ts` `detectDefaultQuality` | A *fresh* profile now starts at `low`/`medium`/`high` based on GPU renderer string + `hardwareConcurrency` instead of a blind `high`. A saved choice always wins. |
| 5b — Menu churn | `main.ts` `toMenu`, `ui/menus.ts` settings handlers | Ambient ember rate scales with quality on the menu; settings toggles flip the active chip in place (`flipGroup`) instead of rebuilding the whole panel + rewiring every listener per click. |

**Helper script:** `game/scripts/shot-menu.mjs` captures main-menu / hero-select / hover / settings screenshots at a forced `SHOT_QUALITY` (default `high`) into `shots/` for eyeballing the look after a change.

---

## Follow-up 2 — first-startup hitch + the "3-second boss-death freeze" (2026-06-19)

The earlier work fixed *steady-state* menu cost. Two remaining symptoms were separate
problems, both rooted in **synchronous WebGL shader-program compiles/relinks on a live
frame**, found by deep-tracing + adversarial verification against the Three.js source:

1. **"Menus lag a little right after startup."** Nothing warmed the menu render path
   before the first frame. `index.html` was bare, and the menu draws through a *different*
   composer (`menuComposer`) than `warmUp()` ever compiled — so the sky shader, hero/arena
   standard materials, the particle cloud, and the lean composer's `EffectPass` all compiled
   lazily on the first 1–2 frames. Webfonts (Cinzel/Rajdhani) also swapped/reflowed (FOUT).

2. **"Phase Step + a boss killed me → ~3-second freeze."** The phase-step correlation was
   incidental. The real cause is the **render-path flip at the death→`dead` transition**:
   when `state` flips to `dead`, the frame loop calls `setLowCost(true)`, which both drops
   the directional light's shadow (`castShadow=false`) **and** switches from the full
   `composer` to the lean `menuComposer`. In Three a material's program cache key includes
   the shadow-light count **and** the active tone-mapping/composer state, so that flip forces
   a synchronous **relink of every lit material in the scene on one live frame** — worst in a
   boss room, where the boss + pack are still on the field (you died, they didn't). On a slow
   GPU driver that relink (~6 distinct programs × hundreds of ms each) plus the intentional
   1.7 s death beat reads as one ~3-second freeze. The same flip also hitched menu→combat.

   *Empirically pinned* via `renderer.info.programs` (Three's program cache — GPU-independent):
   the flip compiled 6 new programs even after a both-state pre-warm, because a warm render
   can't reproduce the exact composer/tone-mapping state of the real death frame.

### What shipped

| Fix | Where | What changed |
|-----|-------|--------------|
| **Hold the full path through `dead`/`victory`** *(the freeze fix)* | `main.ts` frame loop | `fullPath = playing \|\| cutscene \|\| dead \|\| victory`. The dead/victory screens stay on the full composer with shadows **on** while the dense boss scene is still present — so there is **no flip, no relink** on that frame (proven: `flipDelta=0`). The cheap flip is deferred to `toMenu()`/retry, which has already cleared the scene back to the (warm) menu, where it's a handful of materials. |
| Both-shadow-state warm-up | `render/stage.ts` `warmUp()` | Compiles **both** shadow states + **both** composers (restored in `finally`), so the menu→combat first frame and any future state flip find their variants cached. Belt-and-suspenders alongside the path-hold fix. |
| Menu warm API | `render/stage.ts` `warmMenu()` | Compiles the in-scene materials + the lean `menuComposer` `EffectPass` — the menu's actual draw path — so the first menu frame after boot doesn't compile. |
| Cool loading screen | `index.html` | Static, inline-CSS Ember-Rift loader (spinning rift diamond, drifting embers, progress bar, status line) that paints **before** the JS bundle evaluates, covering the whole module-eval + warm window. |
| Boot orchestration | `main.ts` `boot()` + a `booting` render gate | Under the loader: build the menu scene → await webfonts (bounded 1.5s, kills FOUT) → `warmMenu()` → pre-render the combat roster + card effects (`caster`/`enemies.precompile`, in two yielded chunks so the loader stays smooth) → hold a ~900ms minimum → fade the loader out. The frame loop **skips the visible render while `booting`** (the loader is opaque), so the menu's first real frame is already warm. |

### Verify

```bash
cd game && npm run verify                 # tsc + build
node scripts/smoke-menu-perf.mjs          # boot longMax ~200ms (chunked warm under the loader); ALL PASS
node scripts/smoke-death-perf.mjs         # forces HIGH quality, enters a boss room, kills the player;
                                          #   asserts flipDelta==0 (the playing->dead flip relinks nothing)
node scripts/shot-loader.mjs              # eyeball the loading screen (shots/loader-*.png)
```

> **Why `flipDelta`, not wall-time:** headless Chromium's SwiftShader links programs cheaply,
> so the multi-second hang doesn't reproduce there. But the *program cache* is a Three-level
> structure populated regardless of GPU, so `smoke-death-perf.mjs` proves the fix directly —
> the playing→`dead` flip adds **0** programs (a whole-scene relink would add ~6). It samples
> tightly across the flip because the still-fighting boss compiles incidental attack-VFX
> programs through the 1.7 s death beat that would otherwise pollute a whole-window count.

**Known low-priority follow-up:** `Player.spawnGhost()` deep-clones the ~39-mesh hero per
dodge/dash (GC churn under spam — *not* the freeze, ≈0.5 ms/frame). The safe fix (pooled
pose-snapshot) was deferred to avoid risking the afterimage visuals for an unreported
micro-stutter.
