# Rogue Hero 3 — Graphics Glow-Up: Ideas

**Live backlog — the picked items have been removed as they shipped.** Twenty of the
original 52 are in the game (procedural PMREM environment map, fresnel rim shell, blob
contact shadows, per-act fog density, split-tone grade, tempo-reactive lighting + tint,
death/victory ramps, AgX bake-off, ground decals, enemy stride cycle, hit-flinch, footfall
impact, tempo framing, speed pull-back, dutch-tilt); the code carries `IDEAS-GRAPHICS #N`
back-references at each site. What remains below is unpicked. Owner cherry-picks by number.

## Lighting & Environment IBL

### 7. Tighten the shadow frustum + add `normalBias`
**What:** Shrink the directional shadow ortho box from the fixed ±30 to ~±22–24 (matched to `ARENA_RADIUS=19`), and set `keyLight.shadow.normalBias`.
**Why:** Free ~35–40% effective shadow-texel-density win at both 2048 and 1024 tiers with no perf cost; `normalBias` specifically kills acne on the flat-shaded low-poly set-dressing that dominates the scene.
**How:** Pure numeric tuning in `stage.ts` constructor + `applyQuality` (the four `shadow.camera` lines + `shadow.bias`). Verify per tier with a screenshot.
Impact: medium · Effort: S

### 8. Tier-gated contact AO (`SSAOEffect` + `NormalPass`)
**What:** Wire postprocessing's built-in `SSAOEffect` + `NormalPass` into the high (optionally medium) composer, darkening contact seams where actors meet the floor and each other.
**Why:** There is no ambient occlusion of any kind today, which is much of why the scene reads as "lit" rather than "grounded"; it ships in the already-installed `postprocessing` dependency.
**How:** In `buildPost()` when `quality !== 'low'`, add `NormalPass` before the main pass and push `SSAOEffect` (radius ~1.5, 8–11 samples high) ahead of bloom; warm under `warmUp()`, perf-gate on `programs.length`.
Impact: medium · Effort: L

### 10. Procedural god-rays from a proxy sun/rift-core (high tier only)
**What:** A small mostly-hidden bright proxy mesh per dressing family (Hollow Star, rift tear, molten horizon) driving postprocessing's `GodRaysEffect` through the fog.
**Why:** Makes the elaborate per-act sky shader feel like it casts light into the playspace instead of being a painted backdrop — the cinematic-depth lever for a fog-heavy void arena.
**How:** One emissive proxy per family reusing theme ember/crystal colors; gate strictly to `quality==='high'` (genuinely expensive multi-pass); warm under `warmUp()` following the existing high-tier gating pattern.
Impact: medium · Effort: M

## Materials & Surfaces

### 11. Shared canvas-painted detail map for plate/iron/hide families
**What:** Paint one small tileable canvas texture per material family (brushed-metal streaks + speckle; rough hide grain) using the proven `makeFloorTexture` technique, applied as `map` (+ a variant as `roughnessMap`) to the shared armor/iron/hide materials.
**Why:** The #1 flat/plastic tell — a single RGB swatch repeated across a dozen boxes reads as injection-molded toy parts. Box/Cone geometry already has UVs, so no geometry change.
**How:** `makeMetalDetailTexture()`/`makeHideDetailTexture()` in `render/materialFx.ts`, built once as module singletons (like `GLOW_TEX`) and shared across every material. One-time cost, zero per-frame allocation.
Impact: high · Effort: M

### 12. `MeshPhysicalMaterial` clearcoat for glass & gem units
**What:** Swap the Wisp's icosahedron shell, Tether/Caster focus crystals, arena dressing crystals, and the blade gem to `MeshPhysicalMaterial` with `clearcoat:1, clearcoatRoughness:0.1` (med/high), falling back to today's `MeshStandardMaterial` on low.
**Why:** Objects that are conceptually glass/gem currently shade identically to cloth and iron; clearcoat is the cheapest way to read as polished gem, scoped to a small unit count.
**How:** Gate at construction on `quality !== 'low'`; keep one shared physical material per accent color (not per-mesh) to control program count; construct + warm under `boot()` since it's a distinct program family.
Impact: medium · Effort: M

### 13. Cloth-specific shading for cape/robe/shroud
**What:** Give the cape, sparkmage skirt, and revenant shroud a canvas-painted vertical gradient (darker hem, subtle fold streaks) + varied roughness (0.75–0.95) so cloth reads soft where armor reads hard.
**Why:** Cloth and metal use the identical flat recipe today; the cape is on-screen behind every hero every frame.
**How:** `makeClothTexture(baseColor)` in the shared `materialFx` module, applied as `map` on `capeMat`. Pure texture swap on existing UV'd `PlaneGeometry` — effectively free.
Impact: medium · Effort: S

### 14. Baked vertex-color grime/AO on hero + enemy geometry
**What:** After building each mesh, paint a `color` vertex attribute that darkens verts near the ground and at concave joints via a cheap analytic falloff computed once at construction.
**Why:** The free version of AO/dirt-accumulation — makes every unit look like it's stood in the arena and been in a fight rather than a stamped-out box set. Costs nothing at runtime.
**How:** `paintGrime(mesh, intensity)` helper called after each `box()`/`spike()` build; flip `vertexColors:true` on the shared materials (a stock flag, zero program-count impact).
Impact: medium · Effort: S

### 15. Toon-ramp cel look — options-then-pick prototype (art-direction fork)
**What:** Prototype `MeshToonMaterial.gradientMap` (tiny 4–8px canvas 1D ramp) on one hero + one enemy behind a debug flag, screenshot against the current PBR look, present as a named option.
**Why:** Flat-shaded low-poly + full PBR sits in an uncomfortable middle ground; a toon ramp commits harder to one direction. This is a visual-identity decision the owner should pick, not a default change — flagged per the aesthetic-work process.
**How:** Debug-flag swap; if picked, `MeshToonMaterial` is a distinct program family requiring its own warm-up/perf budget, so ship only if chosen over the current look.
Impact: medium · Effort: L

## Post & Color

### 16. Selective/keyed bloom: hero + active VFX vs ambient emissives
**What:** Replace the single global `BloomEffect` with `SelectiveBloomEffect` (already in the package) — blade/trail tip, crash nova, card VFX get the bright layer; ~15+ ambient enemy-eye/orb emissives stay on a dimmer default.
**Why:** Everything above 0.32 luminance blooms identically now, so a room of enemy eyes washes into the same haze as the player's own weapon; selective bloom keeps the player's action the focal point and directly reduces additive-white screen-fill risk.
**How:** In `buildPost()`, use render `Layers` or `SelectiveBloomEffect.selection.set([...])` on the hero group + active VFX; keep the plain global `BloomEffect` as the med/low fallback (gate selective to high).
Impact: high · Effort: M

### 19. Procedural per-act 3D LUT via `LUT3DEffect`
**What:** Generate a neutral-identity 16³ `Data3DTexture` in code, apply a per-act transform (contrast curve + color bias from the THEMES entry) to bake 5–6 distinct LUTs at boot, crossfaded like the theme colors.
**Why:** LUTs are the industry-standard grade; doing it procedurally respects the no-imported-assets rule while giving the richest per-act/per-state control. (Consider this the richer alternative to #5 — pick one grade backbone.)
**How:** `render/lut.ts` `bakeLUT(size, transformFn)` filling a Float32Array; `LUT3DEffect` warmed once; crossfade like `applyTheme`. Gate to med/high.
Impact: high · Effort: M

### 20. Depth-of-field softening the arena backdrop only
**What:** `DepthOfFieldEffect` (already in the package) with focus range wide enough to keep the entire disc tack-sharp — only the starfield/aurora beyond the rim blurs.
**Why:** The arena is conceptually a floating disc in a void; a soft-focus backdrop sells "sharp stage against a matte painting" without ever softening a telegraph, enemy, or the hero.
**How:** Add to `buildPost()` on med/high with `focusDistance`/`focalLength` covering the disc radius; warm in both `warmUp()` calls; re-check `programs.length` cost in the soak, off on low.
Impact: medium · Effort: M

### 23. Cheap unsharp-mask "clarity" pass for render-scale <1 / medium
**What:** A tiny custom `Effect` doing a luminance-weighted unsharp mask, enabled only when `renderScale < 1` or on `medium` (where no grain/CA layer hides upscale softness).
**Why:** Directly serves the graceful-degradation constraint — makes the cheaper render-scale settings look intentional rather than blurry.
**How:** A few-line GLSL neighbor-sample Effect added to `buildPost()` only under that condition; strength scales with how far below 1 the scale is; warm only when actually engaged.
Impact: low · Effort: S

## Atmosphere / Sky / Fog

### ~~24. Standing volumetric light shafts~~ — BANNED
Decorative additive light-shafts were removed from this game for glitchy flicker (see CLAUDE.md). Do not reintroduce.
### 25. Per-act-family ambient particle profiles (not just recolor)
**What:** Swap motion parameters (rise-speed, gravity, size, jitter, spawn radius) per dressing family, not only color — forge gets falling ash + rising embers, spire cold drifting motes, abyss sparse dust, hollow rare bright light-snow.
**Why:** The air becomes a per-act signature instead of one reused effect in different tints — big perceived-variety win, still funneled through the existing pooled `burst()` API (no new draw calls).
**How:** An `AMBIENT_PROFILES` table keyed by dressing, applied via a `Particles.setAmbientProfile()` at the node-set call sites in `main.ts`/`run.ts`; the ambient-emit branch reads the active profile's fields.
Impact: medium · Effort: S

### 26. Depth-layered floating debris with per-act silhouettes
**What:** Replace the single ring of 22 identical icosahedron rocks with 3 parallax bands (near/mid/far, faster→slower drift) and per-family debris shapes (chain links + bridge spans for rift/void, glass shards for spire, slag boulders for forge) from the existing `shareGeo` cache.
**Why:** Cheap parallax makes the void read as genuinely deep space rather than a static prop ring, and per-act debris reinforces "a different broken place" the way boundary dressing already does.
**How:** Add a `bands` array in the constructor rock-spawn loop picking geometry per family from `shareGeo`; keep the existing emissive-recolor tinting.
Impact: medium · Effort: M

### 27. Lit, vein-textured disc underside + broken bottom edge
**What:** Replace the flat `0x07070d` underside with a canvas-painted emissive vein texture (reusing the floor's `crack()`/`glow()` helpers) and ring the bottom edge with jagged downward shards so the disc reads as a torn-off fragment.
**Why:** Players do look over the edge (the sky's elaborate depths-below effect proves the team cares about this view), yet the one piece of real geometry there is the cheapest-looking flat color in the scene.
**How:** Factor the crack/glow canvas helpers into standalone functions, paint a second texture for the underside material's `emissiveMap`; add 6–8 `shareGeo` shards jutting down around the rim.
Impact: medium · Effort: S

## Combat VFX & Impact

### 30. Enemy death: dissolve/char instead of instant vanish
**What:** Replace `die()`'s same-frame `dispose()` with a ~0.35–0.5s death state — ramp `flashMats` emissive to a hot rim, scale the root up slightly, fade opacity down, then dispose.
**Why:** The difference between "the object was destroyed" and "the object popped out of existence"; currently every kill including bosses just deletes the mesh under a puff.
**How:** Add a `dying` flag + `dyingT` timer to the `Enemy` base; in `update()` drive `flashMats` (reusing the `hitFlash` pipeline) + `root.scale` + material `opacity`→0, call real `dispose()` when done. No new shader for the baseline.
Impact: high · Effort: M

### 31. Particle shape atlas: streaks, motes, shards
**What:** Extend the single procedural point-shader with a small canvas sprite atlas (2×2: soft mote, spark streak, debris shard, ring fragment) sampled via a new `aShape` attribute picked per-burst.
**Why:** Every spark/ember/chip in the game is the same soft circle recolored — parries, shield breaks, crits, embers all look alike. Shape variety touches every `burst()` call site at once.
**How:** Bake one atlas at boot (like `getGlowTexture`); add `aShape` as a `Float32Array` written only on spawn; fragment samples the cell by `floor(vShape*4.0)`; `BurstOpts` gains an optional `shape` (default mote).
Impact: high · Effort: M

### 33. Real projectile trail ribbons (reuse the SwordTrail technique)
**What:** Give each in-flight shot a short tapered quad-strip ribbon (wide glowing head → point tail) from 4–6 trailing samples, using the proven `trail.ts` CPU-rebuild technique, instead of the every-0.03s single-particle puff.
**Why:** The current "trail" reads as a dotted line of disconnected puffs; a continuous streak makes every projectile read faster and more premium.
**How:** A lightweight `ProjectileTrail` modeled on `trail.ts`, tinted per-shot; gate full ribbons to `quality !== 'low'`, keep the point-puff as the free low fallback.
Impact: medium · Effort: M

### 34. Core + corona pass on the shared glow/particle look
**What:** Redraw `getGlowTexture` with a tight near-white inner core under the colored corona, and add a sharper second power falloff (`+ pow(1.0-d, 6.0)`) in the particle fragment shader.
**Why:** This texture/shader is shared by every particle and every shot, so one canvas redraw + a few shader lines visibly upgrades every effect at once — the cheapest possible quality bump.
**How:** Second inner `createRadialGradient` stop in `getGlowTexture()`; extend the existing `vColor*(1.0+(1.0-d)*1.4)` term in `particles.ts`. Zero new attributes/pools.
Impact: medium · Effort: S

### 35. Soft (depth-faded) particles
**What:** Fade each particle's alpha as it nears scene depth so sparks/embers/rings don't show a hard seam cutting into solid geometry.
**Why:** The classic cheap fire/dust giveaway; fixing it in the one pooled cloud fixes the seam everywhere at once.
**How:** Add a `DepthTexture` to the render target, read it in a custom `ShaderMaterial` replacing the default points material: `fade = saturate((sceneDepth - particleDepth)/softness)`. Gate to high (med/low keep hard-edged); warm the program under `warmUp()`.
Impact: medium · Effort: M

### 36. Scrolling directional telegraph shading
**What:** Swap the flat `MeshBasicMaterial` on the `line`/`ring` telegraphs for a `ShaderMaterial` sampling a canvas chevron-stripe texture with a scrolling UV uniform, so warnings flow toward the impact point.
**Why:** Telegraphs nail the fairness contract but look like a flat red wash; motion-coded direction sells threat harder at the same cost while keeping the readable color/shape language.
**How:** Bake one chevron texture at boot; shared `ShaderMaterial` with `uTexture`/`uColor`/`uScroll` incremented in `Telegraphs.update(dt)`; leave `circle` as-is; warm under boot per the relink rule.
Impact: medium · Effort: M

## Animation & Character

### 40. Two-segment knee (and elbow) bend
**What:** Split the rigid leg box into a thigh + child shin group with its own pivot, driving a knee counter-rotation during the lift phase instead of translating the whole hip socket up.
**Why:** Removes the peg-leg pendulum stiffness at high stride amplitude and reads as real weight transfer — extends the "no sliding/hovering feet" bar to "no stiff unbent legs."
**How:** Wrap the existing lower-leg boxes in `shinR`/`shinL` groups pivoting at knee height; `shinR.rotation.x = max(0, liftR) * kneeAmount` in the locomotion block. Same technique for elbow-lag on the swing follow-through.
Impact: medium · Effort: M

### 41. Segmented cape for real cloth lag
**What:** Replace the single rigid cape plane with 2–3 stacked segments, each following the one above via `damp()` with decreasing rate down the chain, so the cape trails and ripples instead of snapping.
**Why:** Secondary motion is one of the cheapest "feels expensive" wins; the current cape snaps to a hinge angle, a clear miss for a system the game charges cosmetic shards for.
**How:** Split the cape in `applyHero()`; chain rotation targets in `update()` with preallocated scratch (no per-frame allocation). Gate segment count by tier (low keeps today's single plane).
Impact: medium · Effort: M

### 42. Extend boss pose vocabulary to elites
**What:** Call the already-existing `drivePose`/`poseForState` (boss-exclusive only by convention) from elite-affix enemy state transitions, so affixed elites get the rear/lunge/rise/swell body language.
**Why:** The project's own rule says elites should be "near boss-grade," but they're currently trash mobs + a recolor + crown; the pose machinery is already written and tested in the shared base.
**How:** At the same transition points that call `setIntentPose()`, add a parallel `this.poseForState(dt, state)` gated on `this.affixes.length > 0`. No new API.
Impact: medium · Effort: S

### 43. Universal trash-mob idle fidget
**What:** Add a small always-on breathing/scale pulse to base `Enemy.update()` so non-flying, non-attacking enemies stop reading as frozen statues between state transitions.
**Why:** Cheapest win against "no living idle" — a couple of lines generalizing what flyers and bosses already get.
**How:** Extend the boss-only `root.scale` breathe block at the bottom of `Enemy.update()` to non-bosses at much smaller amplitude: `sin(t*2 + id) * small`.
Impact: low · Effort: S

### 44. Animate the "reaching" static limbs
**What:** Parent Husk claws / Brute fists / Bastion shield-arms under pivot groups driven by the already-computed `intentPose`, so they grasp/pump/brace during windup.
**Why:** These enemies tell a story with static geometry (claws reaching, fists cocked) but the story never moves; `intentPose` is computed every frame and only drives the tiny role crown today.
**How:** Reparent the limb meshes under a group in the constructor; 1–2 lines in `tick()` rotating it proportional to `intentPose`, mirroring the base class's `roleSilhouettes` pattern.
Impact: low · Effort: M

## Camera & Composition

### 45. Give cinematic mode its own camera language
**What:** When `mode === 'cinematic'`, blend toward a flatter/lower near-eye-level offset (not the steep gameplay offset scaled by zoom) and add a slow angular drift around the dolly target for the hold's duration.
**Why:** Every boss intro currently just zooms the top-down gameplay camera; a genuinely different pitch + a living drift sells "we cut to a cinema camera," and it fixes the dead-static 7.6s fading-phase hold.
**How:** Add a `cineOffset(0,8,13)` + a `cineBlend` damped toward 1 in cinematic mode; lerp the used offset before the zoom scale; slowly rotate the offset's x/z. Pure vector math, reuse scratch vectors, free on every tier.
Impact: high · Effort: M

### 47. Tilt-shift diorama look for held beauty shots
**What:** A third dedicated composer using `TiltShiftEffect` (already in the package, no depth texture, cheap half-res blur) only for menu/hero orbit (victory) and the boss fading hold — never combat.
**Why:** The "floating disc" reads as a precious diorama examined from above — an instant "looks expensive" cue for exactly the shots players screenshot; because it's menu/hold-only it can't fill the combat screen or hit the perf-critical path.
**How:** Build `cineComposer` alongside the two existing chains, `TiltShiftEffect` after the grade; gate `quality !== 'low'`; warm in `warmUp()`; switch to it only in the specific held states via an explicit flag, never mid-combat.
Impact: high · Effort: M

### 48. Idle handheld sway in follow mode
**What:** A tiny always-on multi-sine positional offset (~0.03–0.06 units, frequencies distinct from the shake noise) so the follow cam never sits perfectly rigid.
**Why:** The cheapest fix for the biggest amateur-camera tell — a follow cam dead-still except on hits reads as a locked tripod; AAA action cams always carry a whisper of organic motion.
**How:** Add `sin(t*0.9)*0.04 + sin(t*1.7+1.2)*0.02`-style terms (different phase per axis) into the follow branch's final position, **scaled by `shakeScale`** so Reduce Motion still gets a still camera. No allocations.
Impact: medium · Effort: S

### 51. Make Reduce Motion actually reduce all camera motion
**What:** Scale `kick()` and `pulseFov()`'s contribution by `shakeScale`, the way trauma-shake already is — not just the noise term.
**Why:** A correctness gap: a player who turns on Reduce Motion still gets a full-strength positional shove and a rapid FOV zoom (one of the strongest nausea triggers) on every boss hit.
**How:** Multiply the kick-offset contribution and the FOV-pulse delta by `this.shakeScale` in `update()`. One line per term, zero new state.
Impact: low · Effort: S

### 52. Threat-aware framing pull-back for pack fights
**What:** Scale the follow offset outward a small capped amount (up to ~+15%) based on nearby living-enemy count, so crowded elite fights get more breathing room than a lone wisp.
**Why:** Framing is oblivious to fight density today; the busiest, highest-stakes moments most need peripheral space to read incoming telegraphs — a fairness-adjacent win, not just aesthetic.
**How:** `cam.setThreat(count)` from `ctx.enemies.living()`, damped, blended as `1 + threatPull*0.15` into the offset math, cap small so boss zoom tuning survives. Lowest-confidence here — prototype before committing.
Impact: low · Effort: S

---

## Suggested next pass

The foundation items are done. Highest impact-to-effort of what is left:

1. **#30 enemy dissolve death** — kills currently vanish; the single biggest remaining
   weightlessness tell now that decals and stride cycles have landed.
2. **#33 projectile trail ribbons** + **#34 core+corona glow** — reuse the shipped
   `SwordTrail` technique so every shot reads as motion, not a sprite.
3. **#41 segmented cape** + **#40 two-segment knee** — the next rung of the animation bar.
4. **#16 selective bloom** — separates hero/VFX from ambient emissives, which is what keeps
   the bright acts from washing out.

Perf-gate #8/#20 on `renderer.info.programs.length` in the soak, not fps. Capture a contact
sheet after each round for the judge.
