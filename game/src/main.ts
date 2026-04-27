// Babylon side-effect imports — must run before any other Babylon code so prototype
// patching (camera rays, collision coordinator, particle lifecycle, post-processing)
// completes ahead of first use. See the file for what each import enables.
import "./engine/babylonSideEffects";

import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { HighlightLayer } from "@babylonjs/core/Layers/highlightLayer";

import { createSceneBundle, applyGradingPreset, applyBossLighting, tickBossLighting, GradingPreset } from "./scene/SceneSetup";
import { getQuality, cycleQuality } from "./engine/Quality";
import { ArenaHazards } from "./scene/ArenaHazards";
import { createFollowCamera } from "./scene/FollowCamera";
import { InputController } from "./input/InputController";
import { Player } from "./player/Player";
import { PlayerController } from "./player/PlayerController";
import { EnemyManager } from "./enemies/EnemyManager";
import { CombatManager } from "./combat/CombatManager";
import { Hud } from "./ui/Hud";
import { TempoSystem } from "./tempo/TempoSystem";
import { DeckManager } from "./deck/DeckManager";
import { STARTING_DECK } from "./deck/CardDefinitions";
import { ProjectileSystem } from "./combat/handlers/projectile";
import { HostileProjectileSystem } from "./combat/handlers/hostileProjectile";
import { CardCaster, CardArcFx } from "./combat/CardCaster";
import { validateBabylonRuntime } from "./engine/BabylonRuntimeCheck";
import { events } from "./engine/EventBus";
import { ItemManager } from "./items/ItemManager";
import { ItemDefinitions, ItemDef, ALL_ITEM_IDS } from "./items/ItemDefinitions";
import { RewardPicker } from "./ui/RewardPicker";
import { RunManager, VERTICAL_SLICE_ROOMS } from "./run/RunManager";
import { GameState } from "./state/GameState";
import { BLADE } from "./characters/Blade";
import { mulberry32 } from "./engine/Rng";
import { HitParticles } from "./fx/HitParticles";
import { DodgeGhosts } from "./fx/DodgeGhost";
import { WeaponTrail } from "./fx/WeaponTrail";
import { RelicAuras } from "./fx/RelicAuras";
import { Decals } from "./fx/Decals";
import { StepDust } from "./fx/StepDust";
import { SwordAura } from "./fx/SwordAura";
import { PlayerGroundPulse } from "./fx/PlayerGroundPulse";
import { CrashTelegraph } from "./fx/CrashTelegraph";
import { CRASH_RADIUS } from "./tempo/TempoSystem";
import { Fireflies } from "./fx/Fireflies";
import { EnvDecals } from "./fx/EnvDecals";
import { DamageNumbers } from "./ui/DamageNumbers";
import { EnemyHealthPips } from "./ui/EnemyHealthPips";
import { MenuSystem } from "./ui/MenuSystem";
import { DevOverlay } from "./ui/DevOverlay";
import { Enemy } from "./enemies/Enemy";

const AP_REGEN_PER_SEC = 0.5;

interface EnemyHitPayload {
  enemyId: string;
  x: number;
  y: number;
  z: number;
  amount: number;
  killed: boolean;
  isBoss: boolean;
}

async function boot() {
  const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
  if (!canvas) throw new Error("renderCanvas not found");

  const sceneBundle = createSceneBundle(canvas);
  const { engine, scene, shadow, attachPostFx, setHeavyPostFx } = sceneBundle;

  const player = new Player(scene, shadow);
  const cam = createFollowCamera(scene, canvas);
  cam.setTarget(player.root);
  const pipeline = attachPostFx(cam.camera);
  // Apply the heavy post-fx (SSAO + god rays) that match the current quality tier.
  // On medium/low these are no-ops; on high they spin up the pipelines.
  {
    const q0 = getQuality();
    setHeavyPostFx(cam.camera, { ssao: q0.ssaoEnabled, godRays: q0.godRaysEnabled });
  }

  validateBabylonRuntime(scene, cam.camera);

  const input = new InputController(scene);

  const hostileProjectiles = new HostileProjectileSystem(scene, player);
  const enemies = new EnemyManager(scene, shadow, hostileProjectiles);

  // Run sequence
  const run = new RunManager(scene, shadow, enemies, VERTICAL_SLICE_ROOMS);
  const arena0 = run.loadRoom(0);
  input.setFloorReference(arena0.floor);
  enemies.setPillars(arena0.pillars);

  // Tempo first — PlayerController reads tempo.speedMultiplier() each frame
  // so we need it constructed before the controller.
  const tempo = new TempoSystem();
  tempo.setClassPassives(BLADE.passives);

  const controller = new PlayerController(player, {
    bounds: arena0.bounds,
    pillars: arena0.pillars,
    doorPass: arena0.doorPass,
  }, tempo);

  // Spawn the player well inside the arena facing the center. Previously we placed the hero 4m
  // from the south wall — that tucked the follow camera outside the wall since the rig sits
  // ~8m behind the target. 10m of back-clearance keeps the camera inside even at zoomed-out radii.
  function placePlayerAtSpawn(b: { minX: number; maxX: number; minZ: number; maxZ: number }): void {
    player.root.position.x = 0;
    player.root.position.z = b.maxZ - 10;
    // Spawn facing -Z (toward arena center). setFacingDirection syncs the
    // smoothed-yaw target so tickAnim doesn't slerp away from the spawn pose.
    player.setFacingDirection(0, -1);
  }
  placePlayerAtSpawn(arena0.bounds);

  const combat = new CombatManager(scene, player);
  const items = new ItemManager(tempo);
  tempo.itemHooks = {
    shouldDecay: (v) => items.shouldDecay(v),
    crashResetOverride: () => items.crashResetOverride(),
  };

  const deck = new DeckManager(STARTING_DECK, 0xc0ffee);
  const projectiles = new ProjectileSystem(scene, enemies);
  const caster = new CardCaster(player, enemies, tempo, projectiles);
  const hud = new Hud(scene, player, enemies, tempo, deck);
  // HUD button for cycling lock — routed through the same cycleLock() as the keybind,
  // plus the camera-orient swing so mouse and keyboard behave identically.
  hud.setCycleTargetHandler(() => {
    cycleLock();
    if (lock.enemy) {
      cam.orientToward(lock.enemy.root.position.x, lock.enemy.root.position.z);
    }
  });

  // Highlight layer — one extra render pass that draws outlines around tagged
  // meshes. Cyan stays on the player silhouette (permanent); yellow tracks the
  // currently-locked enemy and re-binds on cycle. Cheaper than a per-mesh outline
  // shader because it runs as a single additive pass after the main scene.
  const outline = new HighlightLayer("outline", scene, {
    mainTextureRatio: 0.5,
    blurHorizontalSize: 0.6,
    blurVerticalSize: 0.6,
  });
  outline.outerGlow = true;
  outline.innerGlow = false;
  outline.addMesh(player.body, new Color3(0.2, 0.95, 1.0));
  outline.addMesh(player.head, new Color3(0.2, 0.95, 1.0));
  outline.addMesh(player.sword, new Color3(1.0, 0.9, 0.35));
  let lockedOutlineTarget: Enemy | null = null;
  // Saved previous rim color per locked enemy — so unlocking restores the red
  // threat rim that Enemy.ts applies by default, instead of leaving the orange
  // lock color stuck on.
  let lockedRimOriginal: Color3 | null = null;
  const LOCK_RIM_COLOR = new Color3(1.0, 0.75, 0.2);
  const LOCK_OUTLINE_COLOR = new Color3(1.0, 0.9, 0.2);
  // Soft warm outline applied to every alive enemy so silhouettes pop against
  // the floor at distance. addMesh REPLACES the color when called twice on the
  // same mesh, so applyLockOutline below can swap to LOCK_OUTLINE_COLOR and
  // back to this default without ever calling removeMesh until the enemy is
  // disposed.
  const DEFAULT_ENEMY_OUTLINE_COLOR = new Color3(0.9, 0.55, 0.35);
  function applyLockOutline(e: Enemy | null): void {
    if (lockedOutlineTarget === e) return;
    // Restore previous target's default outline (rather than removing it
    // entirely — it stays in the layer with its baseline tint until dispose).
    if (lockedOutlineTarget) {
      if (lockedOutlineTarget.alive) {
        for (const m of lockedOutlineTarget.getOutlineMeshes()) outline.addMesh(m, DEFAULT_ENEMY_OUTLINE_COLOR);
      }
      const fp = lockedOutlineTarget.material.emissiveFresnelParameters;
      if (fp && lockedRimOriginal) fp.leftColor.copyFrom(lockedRimOriginal);
    }
    lockedOutlineTarget = e;
    lockedRimOriginal = null;
    if (e && e.alive) {
      // Hoisted outline color — was being allocated fresh on every lock change.
      for (const m of e.getOutlineMeshes()) outline.addMesh(m, LOCK_OUTLINE_COLOR);
      // Override the fresnel rim with a warm lock color — composes with the
      // cyan HighlightLayer outline for an unambiguous "this is your target"
      // read even in a crowd.
      const fp = e.material.emissiveFresnelParameters;
      if (fp) {
        lockedRimOriginal = fp.leftColor.clone();
        fp.leftColor.copyFrom(LOCK_RIM_COLOR);
      }
    }
  }
  // Register a default outline on each spawned enemy and clear it on dispose,
  // plus a small end-of-dissolve ash puff. Wired AFTER hitFx is created below
  // so onDispose's burst() call has a target — see also the catch-up loop right
  // after wiring that registers enemies that already spawned during room 0
  // load (RunManager.loadRoom calls spawnAll before this point).
  const rewardPicker = new RewardPicker(scene);
  const hitFx = new HitParticles(scene);
  // Now that outline and hitFx exist, wire the EnemyManager lifecycle hooks.
  // onSpawn paints a default warm outline on every body part; onDispose removes
  // the outline and spits a small ash puff at the dissolve point so the body
  // doesn't just vanish. Reused scratch Vector3 hoisted below; we use a local
  // here because evScratch is declared further down — small dedicated buffer.
  const ashScratch = new Vector3();
  enemies.onSpawn = (e) => {
    for (const m of e.getOutlineMeshes()) outline.addMesh(m, DEFAULT_ENEMY_OUTLINE_COLOR);
  };
  enemies.onDispose = (e) => {
    for (const m of e.getOutlineMeshes()) outline.removeMesh(m);
    // y is fixed at ground level — by the time dispose fires, the dissolve has
    // sunk the root ~0.4m below floor, so reading e.root.position.y would put
    // the puff underground.
    ashScratch.set(e.root.position.x, 0.25, e.root.position.z);
    const isBoss = e.def.name.startsWith("boss_");
    hitFx.burst(ashScratch, isBoss ? 28 : 10, [0.62, 0.55, 0.48], isBoss ? 1.4 : 0.7);
  };
  // Catch up enemies spawned by run.loadRoom(0) before this wiring existed.
  for (const e of enemies.enemies) enemies.onSpawn(e);
  const dodgeGhosts = new DodgeGhosts(scene);
  const weaponTrail = new WeaponTrail(scene);
  const relicAuras = new RelicAuras(scene, player);
  const decals = new Decals(scene);
  const stepDust = new StepDust(scene);
  events.on<{ x: number; z: number }>("PLAYER_STEP", (p) => stepDust.puff(p.x, p.z));
  // Sword aura — hot-orange particle vortex when tempo is CRITICAL. Off entirely
  // outside that zone; intensity lerps via setTargetIntensity for smooth fade.
  const swordAura = new SwordAura(scene, player.sword);
  // Heartbeat ground pulse from player feet — only at HOT/CRITICAL. Continuous
  // visual confirmation of "you are powered up". Off on low quality.
  const groundPulse = new PlayerGroundPulse(scene);
  const crashTelegraph = new CrashTelegraph(scene);
  // Ambient atmosphere — fireflies + static moss patches. Session-level (not
  // per-arena) since the arena footprint is a constant 40m. Fireflies toggle
  // off in the boss room; moss decals stay on throughout.
  // AmbientWind (drifting leaves) was used when rooms were open-sky; with the
  // enclosed stone ceilings the leaves clipped through the roof, so the
  // session no longer instantiates it.
  const ARENA_SIZE = 40;
  const fireflies = new Fireflies(scene, ARENA_SIZE);
  const envDecals = new EnvDecals(scene, ARENA_SIZE);
  const sessionFx = [envDecals, fireflies];
  // Best-effort teardown on tab close — Babylon's resource handlers do most of
  // this for us, but explicit dispose of GPU-side particle systems / meshes
  // avoids stragglers in dev hot-reload scenarios.
  window.addEventListener("beforeunload", () => {
    for (const fx of sessionFx) fx.dispose();
  });
  const damageNumbers = new DamageNumbers(scene);
  const enemyHpPips = new EnemyHealthPips(scene);
  // F3 toggles a small top-right overlay with FPS / frame time / mesh count /
  // draw calls. Off by default so players never see it.
  const devOverlay = new DevOverlay(scene, engine);

  // ---------- Dynamic resolution scaling (pressure valve, low-tier only) ----------
  // Active ONLY on the low quality tier. On medium/high we keep the canvas at
  // full resolution all the time — the scaling pass blurs the GUI text (since
  // the entire canvas is downscaled then upscaled), and the visible
  // sharpness-flicker reads as a bug. Low-tier players are already opting into
  // visual cuts so the brief blur is the right tradeoff there.
  //
  // The thresholds are also more conservative than before: only sustained
  // sub-30fps for 3+ seconds triggers the downscale, and we recover to full
  // resolution within 2 seconds of frame time stabilizing.
  let frameTimeEma = 16.67; // ms
  let scalingLevel = 1.0;
  let pressureSeconds = 0;
  let recoverySeconds = 0;
  const PRESSURE_THRESHOLD_MS = 33;  // ~30 fps — only engage on real distress
  const RECOVER_THRESHOLD_MS = 20;   // ~50 fps
  const SCALING_LOW = 1.15;          // render at ~87% (much milder than 80%)
  const SCALING_HIGH = 1.0;          // full resolution
  function tickAdaptiveScaling(realDt: number): void {
    // Re-checked each frame so cycling quality with G correctly enables/disables
    // the pressure valve.
    if (getQuality().tier !== "low") return;
    const ms = realDt * 1000;
    // Fast EMA — alpha 0.1 ≈ ~6 frames of memory, responsive but smoothed.
    frameTimeEma += (ms - frameTimeEma) * 0.1;
    if (scalingLevel === SCALING_HIGH && frameTimeEma > PRESSURE_THRESHOLD_MS) {
      pressureSeconds += realDt;
      recoverySeconds = 0;
      if (pressureSeconds > 3) {
        engine.setHardwareScalingLevel(SCALING_LOW);
        scalingLevel = SCALING_LOW;
        pressureSeconds = 0;
      }
    } else if (scalingLevel === SCALING_LOW && frameTimeEma < RECOVER_THRESHOLD_MS) {
      recoverySeconds += realDt;
      pressureSeconds = 0;
      if (recoverySeconds > 2) {
        engine.setHardwareScalingLevel(SCALING_HIGH);
        scalingLevel = SCALING_HIGH;
        recoverySeconds = 0;
      }
    } else {
      // Conditions don't match either trigger — let counters drift back so a
      // brief stutter doesn't accumulate to a downscale 60 seconds later.
      pressureSeconds = Math.max(0, pressureSeconds - realDt * 0.5);
      recoverySeconds = Math.max(0, recoverySeconds - realDt * 0.5);
    }
  }
  // Arena hazards — only the boss room turns them on. Half-size is injected per
  // room load so the spawn radius matches the current arena.
  const arenaHazards = new ArenaHazards(scene, 27);
  // Reused buffer so the sword-tip sampler doesn't allocate a Vector3 per frame.
  const swordTipBuf = new Vector3();

  // ---------- Deferred callback tracker ----------
  // Every setTimeout in this file (boss-kill ember, shock ring stagger,
  // boss-phase FOV restore, room transition swap, etc) can fire AFTER a
  // resetRun() — if the user hits R mid-flight, those callbacks land on
  // freshly-reset state (e.g. spawning a shock ring at the new player position
  // milliseconds into a clean run). `defer()` wraps setTimeout, tracks the id,
  // and `clearDeferred()` (called by resetRun) cancels all pending timers so
  // the reset is clean.
  const deferredTimers = new Set<ReturnType<typeof setTimeout>>();
  function defer(fn: () => void, ms: number): void {
    let id: ReturnType<typeof setTimeout>;
    id = setTimeout(() => {
      deferredTimers.delete(id);
      fn();
    }, ms);
    deferredTimers.add(id);
  }
  function clearDeferred(): void {
    for (const id of deferredTimers) clearTimeout(id);
    deferredTimers.clear();
  }

  // ---------- Global juice: screen shake ----------
  // Hitstop (the brief gameplay-update freeze on impact) was removed entirely
  // — players read it as the game stuttering rather than as impact weight.
  // Camera shake + flashes + particles still sell every hit; gameplay runs
  // at full speed at all times.

  // Shared scratch Vector3 buffers for combat event handlers — these fire
  // many times per frame during chained hits, so allocating fresh per-event
  // was a real GC source. Each handler is synchronous so they can safely share.
  const evScratch = new Vector3();
  const evScratchGround = new Vector3();
  const emberScratch = new Vector3();

  // Combo-scaled feedback — a 6-kill chain shakes harder than a stand-alone
  // kill, so chaining feels physically louder. Window matches the HUD's combo
  // counter (3s); separate state since the HUD tracker is private.
  let comboCount = 0;
  let lastKillMs = 0;

  // Hit feedback
  events.on<EnemyHitPayload>("ENEMY_HIT", (p) => {
    evScratch.set(p.x, p.y, p.z);
    if (p.killed) {
      const nowMs = performance.now();
      if (nowMs - lastKillMs < 3000) comboCount++;
      else comboCount = 1;
      lastKillMs = nowMs;
      hitFx.burst(evScratch, p.isBoss ? 60 : 32, [1.0, 0.55, 0.2], p.isBoss ? 1.6 : 1.0);
      // Crit-style flare on the ground beneath the kill — scales bigger for boss kills.
      hitFx.flare(evScratch, p.isBoss ? [1.0, 0.35, 0.1] : [1.0, 0.75, 0.25], p.isBoss ? 3.2 : 2.4, p.isBoss ? 0.35 : 0.24);
      // Shake scales with combo size — capped so a 12-chain doesn't blur the
      // screen permanently. Bosses still hit their own larger baseline.
      const comboBoost = Math.min(0.16, comboCount * 0.025);
      cam.shake(p.isBoss ? 0.18 : 0.06 + comboBoost, p.isBoss ? 0.45 : 0.25 + comboBoost * 0.5);
      // Blood splat on the ground under the kill. Medium/high quality only.
      evScratchGround.set(p.x, 0, p.z);
      decals.spawn("blood", evScratchGround, p.isBoss ? 2.6 : 1.3);
      // Delayed "ember rise" — a small upward second burst at chest height
      // 200ms after death. Sells the dissolve as the spirit leaving the body.
      // Captured x/y/z so the closure doesn't retain pos.
      const ex = p.x, ey = p.y, ez = p.z;
      const isBoss = p.isBoss;
      defer(() => {
        emberScratch.set(ex, ey + 0.4, ez);
        hitFx.burst(emberScratch, isBoss ? 24 : 12, [1.0, 0.85, 0.55], isBoss ? 1.4 : 0.7);
      }, 200);
    } else {
      hitFx.burst(evScratch, 14, [1.0, 0.85, 0.4], 0.7);
      cam.shake(0.03, 0.18);
    }
    damageNumbers.spawn(evScratch, p.amount, p.killed ? "#ff7733" : "#ffe066", p.killed);
  });

  // Player damage flash — vignette pulses red briefly when player takes damage.
  let damageFlashTimer = 0;
  events.on<{ amount: number; source: string }>("DAMAGE_TAKEN", (p) => {
    damageFlashTimer = 0.35;
    cam.shake(0.12, 0.32);
    // Red-tinted floating number at the player's chest — makes it obvious how
    // hard each hit lands during mob scrums.
    if (p && typeof p.amount === "number" && p.amount > 0) {
      damageNumbers.spawnPlayerHit(player.root.position, p.amount);
    }
  });

  // Boss kill-cam — when the boss dies, orbit its last position for 2.5s with
  // a deeper hitstop + chromatic burst. The dissolve already takes 1.5s, so the
  // kill-cam covers the fade cleanly. ROOM_CLEARED fires after — the existing
  // handleRoomCleared flow then takes us to VICTORY.
  events.on<{ enemyId: string }>("KILL", ({ enemyId }) => {
    // Find the dying boss entry (still in the enemies list during dissolve).
    const dying = enemies.enemies.find((e) => e.id === enemyId);
    if (!dying) return;
    if (!dying.def.name.startsWith("boss_")) return;
    // One-shot per run, but still: clone() since startKillCam holds the
    // reference. Below burst uses the scratch buffer.
    const center = dying.root.position.clone();
    center.y = 0;
    cam.startKillCam(center, 9, 0.9, 2.5);
    cam.shake(0.2, 0.8);
    // Soul-wisp style burst + ground flare at the boss's feet.
    hitFx.flare(center, [1.0, 0.55, 0.1], 5.0, 1.0);
    evScratch.set(center.x, 0.5, center.z);
    hitFx.burst(evScratch, 80, [1.0, 0.7, 0.25], 1.6);
  });

  // Boss phase 2 — big kick moment. Banner + banner clear handled below via BOSS_PHASE.
  let bossPhaseFlashTimer = 0;
  events.on<{ bossId: string; phase: number; spawnPos: Vector3 }>("BOSS_PHASE", ({ spawnPos }) => {
    cam.shake(0.28, 0.7);
    bossPhaseFlashTimer = 1.6;
    hud.setBanner("THE BRAWLER ENRAGES");
    hud.flashBossPhase();
    // Zoom the camera in for the reveal, then return to default after ~1.2s.
    cam.setFovTarget(0.7, 4);
    defer(() => cam.setFovTarget(null, 2), 1200);
    // Transient grading intensification — drop saturation hard and deepen shadows
    // for ~1.6s, then restore the room's preset. We tweak the live ColorCurves
    // directly instead of swapping presets, since the boss room is already Pit
    // and a preset swap would be a no-op.
    const curves = pipeline.imageProcessing.colorCurves;
    if (curves) {
      const prevSat = curves.globalSaturation;
      const prevShadowsDensity = curves.shadowsDensity;
      curves.globalSaturation = -60;
      curves.shadowsDensity = 60;
      defer(() => {
        curves.globalSaturation = prevSat;
        curves.shadowsDensity = prevShadowsDensity;
      }, 1600);
    }
    // Ground shock ring emanating from the boss's current position — uses the
    // same pool as the player Crash, with a red tint + longer duration.
    spawnBossShockRing(spawnPos.x, spawnPos.z);
  });

  // ---------- Crash AoE: damages enemies + spawns expanding shock-ring fx ----------
  // Pooled — pre-allocated ring meshes + materials are hidden instead of disposed
  // so rapid Crashes (3 staggered rings each) don't churn GPU resources. 6 slots
  // covers the burst (up to 4 concurrent during boss-phase + one player Crash).
  interface ShockRing {
    mesh: Mesh;
    mat: StandardMaterial;
    ttl: number;
    initialTtl: number;
    maxRadius: number;
    active: boolean;
    startAlpha: number;
    baseDiffuse: Color3;
    baseEmissive: Color3;
  }
  const SHOCK_POOL_SIZE = 6;
  const shockRings: ShockRing[] = [];
  for (let i = 0; i < SHOCK_POOL_SIZE; i++) {
    const ring = MeshBuilder.CreateTorus(`shock_${i}`, { diameter: 2, thickness: 0.18, tessellation: 36 }, scene);
    ring.position.y = 0.06;
    ring.isPickable = false;
    ring.doNotSyncBoundingInfo = true;
    ring.setEnabled(false);
    const mat = new StandardMaterial(`shockMat_${i}`, scene);
    mat.diffuseColor = new Color3(1, 0.8, 0.3);
    mat.emissiveColor = new Color3(1, 0.7, 0.2);
    mat.alpha = 0.85;
    mat.disableLighting = true;
    ring.material = mat;
    shockRings.push({
      mesh: ring, mat, ttl: 0, initialTtl: 0, maxRadius: 0,
      active: false, startAlpha: 0.85,
      baseDiffuse: new Color3(1, 0.8, 0.3),
      baseEmissive: new Color3(1, 0.7, 0.2),
    });
  }

  function acquireShockRing(): ShockRing | null {
    for (const r of shockRings) if (!r.active) return r;
    return null; // all slots busy — drop this ring; better than allocating
  }

  function spawnShockRing(maxRadius: number): void {
    const r = acquireShockRing();
    if (!r) return;
    r.mesh.position.x = player.root.position.x;
    r.mesh.position.z = player.root.position.z;
    r.mesh.scaling.x = r.mesh.scaling.z = 1;
    r.mat.diffuseColor.copyFrom(r.baseDiffuse);
    r.mat.emissiveColor.copyFrom(r.baseEmissive);
    r.mat.alpha = 0.85;
    r.startAlpha = 0.85;
    r.ttl = 0.55;
    r.initialTtl = 0.55;
    r.maxRadius = maxRadius;
    r.active = true;
    r.mesh.setEnabled(true);
  }

  /**
   * Custom-spawn variant used by the boss-phase moment — different position,
   * tint, and duration. Same pool.
   */
  function spawnBossShockRing(x: number, z: number): void {
    const r = acquireShockRing();
    if (!r) return;
    r.mesh.position.x = x;
    r.mesh.position.z = z;
    r.mesh.scaling.x = r.mesh.scaling.z = 1;
    r.mat.diffuseColor.set(1, 0.25, 0.05);
    r.mat.emissiveColor.set(1, 0.2, 0.05);
    r.mat.alpha = 0.9;
    r.startAlpha = 0.9;
    r.ttl = 0.9;
    r.initialTtl = 0.9;
    r.maxRadius = 10;
    r.active = true;
    r.mesh.setEnabled(true);
  }

  /**
   * Cyan-white ice ring used for the cold-crash moment. Lingers a touch longer
   * than a normal Crash ring so the freeze beat reads as "everything stopped".
   */
  function spawnFrostShockRing(maxRadius: number, durSec = 0.85): void {
    const r = acquireShockRing();
    if (!r) return;
    r.mesh.position.x = player.root.position.x;
    r.mesh.position.z = player.root.position.z;
    r.mesh.scaling.x = r.mesh.scaling.z = 1;
    r.mat.diffuseColor.set(0.55, 0.85, 1.0);
    r.mat.emissiveColor.set(0.45, 0.75, 1.0);
    r.mat.alpha = 0.9;
    r.startAlpha = 0.9;
    r.ttl = durSec;
    r.initialTtl = durSec;
    r.maxRadius = maxRadius;
    r.active = true;
    r.mesh.setEnabled(true);
  }

  function updateShockRings(dt: number): void {
    for (const r of shockRings) {
      if (!r.active) continue;
      r.ttl -= dt;
      if (r.ttl <= 0) {
        r.mesh.setEnabled(false);
        r.active = false;
        continue;
      }
      const t = 1 - r.ttl / r.initialTtl;
      const scale = 1 + (r.maxRadius - 1) * t;
      r.mesh.scaling.x = r.mesh.scaling.z = scale;
      r.mat.alpha = r.startAlpha * (1 - t);
    }
  }

  // ---------- Card FX: pooled ground meshes so Cleave/Dash read visually ----------
  // Pre-allocate 3 arc discs + 3 dash bars at their canonical sizes, then
  // re-skin/reposition on each cast. The original implementation allocated a
  // fresh mesh + material + (for arc) TransformNode per cast and disposed on
  // expire — that's the kind of GC churn we're systematically removing.
  //
  // The arc disc geometry is built at a fixed reference radius/arcDeg and we
  // scale the parent to match the cast's range — visual angle/tessellation
  // approximates the CombatManager preview without per-cast geometry rebuild.
  interface CardFxSlot {
    mesh: Mesh;
    mat: StandardMaterial;
    pivot?: TransformNode;
    kind: "arc" | "dash";
    ttl: number;
    initial: number;
    active: boolean;
  }
  const CARD_ARC_REF_RADIUS = 1; // unit disc — scale parent to actual range
  const CARD_ARC_REF_DEG = 100;
  const cardFxPool: CardFxSlot[] = [];
  const CARD_FX_ARC_SLOTS = 3;
  const CARD_FX_DASH_SLOTS = 3;
  for (let i = 0; i < CARD_FX_ARC_SLOTS; i++) {
    const mesh = MeshBuilder.CreateDisc(
      `cardArc_${i}`,
      { radius: CARD_ARC_REF_RADIUS, tessellation: 36, arc: CARD_ARC_REF_DEG / 360 },
      scene,
    );
    mesh.rotation.x = Math.PI / 2;
    mesh.rotation.y = ((CARD_ARC_REF_DEG / 2) * Math.PI) / 180 - Math.PI / 2;
    mesh.isPickable = false;
    mesh.doNotSyncBoundingInfo = true;
    const parent = new TransformNode(`cardArcPivot_${i}`, scene);
    parent.position.y = 0.08;
    mesh.parent = parent;
    parent.setEnabled(false);
    const mat = new StandardMaterial(`cardArcMat_${i}`, scene);
    mat.diffuseColor = new Color3(1, 0.7, 0.25);
    mat.emissiveColor = new Color3(1, 0.55, 0.15);
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mat.alpha = 0.7;
    mesh.material = mat;
    cardFxPool.push({ mesh, mat, pivot: parent, kind: "arc", ttl: 0, initial: 0, active: false });
  }
  for (let i = 0; i < CARD_FX_DASH_SLOTS; i++) {
    // Reference geometry: 1m depth, 1.6m wide. Scaled per cast to actual range.
    const mesh = MeshBuilder.CreateBox(
      `cardDash_${i}`,
      { width: 1.6, height: 0.02, depth: 1 },
      scene,
    );
    mesh.position.y = 0.07;
    mesh.isPickable = false;
    mesh.doNotSyncBoundingInfo = true;
    mesh.setEnabled(false);
    const mat = new StandardMaterial(`cardDashMat_${i}`, scene);
    mat.diffuseColor = new Color3(0.8, 0.55, 1.0);
    mat.emissiveColor = new Color3(0.75, 0.4, 1.0);
    mat.disableLighting = true;
    mat.alpha = 0.7;
    mesh.material = mat;
    cardFxPool.push({ mesh, mat, kind: "dash", ttl: 0, initial: 0, active: false });
  }

  function acquireCardFxSlot(kind: "arc" | "dash"): CardFxSlot | null {
    for (const s of cardFxPool) if (s.kind === kind && !s.active) return s;
    // All busy — recycle the one with the least time left so a fresh cast paints.
    let oldest: CardFxSlot | null = null;
    for (const s of cardFxPool) {
      if (s.kind === kind && (!oldest || s.ttl < oldest.ttl)) oldest = s;
    }
    return oldest;
  }

  function spawnCardFx(fx: CardArcFx): void {
    if (fx.kind === "arc") {
      const slot = acquireCardFxSlot("arc");
      if (!slot || !slot.pivot) return;
      slot.pivot.position.x = fx.x;
      slot.pivot.position.z = fx.z;
      slot.pivot.rotation.y = Math.atan2(fx.fx, fx.fz);
      // Scale the parent to match the cast's range — a uniform XZ scale on
      // the unit disc reproduces the original per-cast geometry.
      slot.pivot.scaling.x = fx.range;
      slot.pivot.scaling.z = fx.range;
      slot.mat.alpha = 0.7;
      slot.ttl = 0.3;
      slot.initial = 0.3;
      slot.active = true;
      slot.pivot.setEnabled(true);
    } else {
      const slot = acquireCardFxSlot("dash");
      if (!slot) return;
      slot.mesh.position.x = fx.x + fx.fx * fx.range * 0.5;
      slot.mesh.position.z = fx.z + fx.fz * fx.range * 0.5;
      slot.mesh.rotation.y = Math.atan2(fx.fx, fx.fz);
      // Scale Z to match dash range — reference depth is 1m.
      slot.mesh.scaling.z = Math.max(0.2, fx.range);
      slot.mat.alpha = 0.7;
      slot.ttl = 0.28;
      slot.initial = 0.28;
      slot.active = true;
      slot.mesh.setEnabled(true);
    }
  }

  function updateCardFx(dt: number): void {
    for (const s of cardFxPool) {
      if (!s.active) continue;
      s.ttl -= dt;
      if (s.ttl <= 0) {
        s.active = false;
        if (s.pivot) s.pivot.setEnabled(false);
        else s.mesh.setEnabled(false);
        continue;
      }
      const t = s.ttl / s.initial;
      s.mat.alpha = 0.7 * t;
    }
  }

  events.on<CardArcFx>("CARD_FX", (p) => spawnCardFx(p));

  // Cast FX — small hand-level flare + particle burst at the spawn point when a
  // non-melee card fires. Sells the moment of casting at chest height, not the
  // feet. Pooled HitParticles handles both.
  events.on<{ kind: "bolt" | "dash"; x: number; y: number; z: number }>("CAST_FX", (p) => {
    evScratch.set(p.x, p.y, p.z);
    evScratchGround.set(p.x, 0, p.z);
    if (p.kind === "bolt") {
      // Small outward burst in cool gold (matches projectile emissive) + a tiny
      // ground flare so the cast reads from overhead too.
      hitFx.burst(evScratch, 18, [1.0, 0.85, 0.35], 0.8);
      hitFx.flare(evScratchGround, [1.0, 0.85, 0.35], 1.1, 0.14);
    } else {
      // Dash: purple ground flare + small burst at the start position.
      hitFx.burst(evScratch, 14, [0.8, 0.55, 1.0], 0.9);
      hitFx.flare(evScratchGround, [0.8, 0.55, 1.0], 1.4, 0.18);
    }
  });

  // Chromatic aberration burst timer — separate from the low-HP ramp so they
  // compose cleanly. Peak amount 14px, decays linearly.
  let crashAberrationTimer = 0;
  const crashAberrationDuration = 0.4;

  events.on<{ radius: number; dmg: number; accidental: boolean }>("CRASH_ATTACK", ({ radius, dmg }) => {
    // Crash radius is now player-tight (~6m) so the visual ring matches the
    // damage zone exactly — no more "screen-clear that doesn't show the AOE".
    const visRadius = radius;
    // Three concentric shock rings, staggered by 0.05s. Creates a "wave train" read.
    spawnShockRing(visRadius);
    defer(() => spawnShockRing(visRadius * 0.75), 50);
    defer(() => spawnShockRing(visRadius * 0.5), 110);
    // Crash is the climactic payoff — big shake + bright flare under the player.
    cam.shake(0.22, 0.5);
    evScratchGround.set(player.root.position.x, 0, player.root.position.z);
    hitFx.flare(evScratchGround, [1.0, 0.85, 0.25], 5.5, 0.5);
    // Scorch decal under the Crash — visible proof of the blast for a while.
    decals.spawn("scorch", evScratchGround, 5.5);
    // Cracked-earth decal sits slightly smaller than the scorch so the lines
    // read through the dark scorch tint — "split open by the blast".
    decals.spawn("crack", evScratchGround, 4.2);
    // Kick the chromatic aberration ramp — driven by the render loop so it composes
    // with any low-HP aberration that might already be running.
    crashAberrationTimer = crashAberrationDuration;
    const px = player.root.position.x;
    const pz = player.root.position.z;
    const r2 = radius * radius;
    for (const e of enemies.enemies) {
      if (!e.alive) continue;
      const dx = e.root.position.x - px;
      const dz = e.root.position.z - pz;
      if (dx * dx + dz * dz <= r2) {
        e.takeDamage(dmg);
        // Outward knockback from the player — sells the shockwave.
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > 1e-4) e.knockback(dx / d, dz / d, 9);
      }
    }
  });

  // ---------- Cold Crash (tempo bottomed out) ----------
  // Tempo dropping to zero is a "you stalled" beat — it's not a damage event,
  // it's a punishment. Read it visually as the world flash-freezing around the
  // player: cyan rings, ice decal, blue vignette, brief hitstop, hard shake.
  // The mechanical reset (value→20, 0.6s recover lockout) lives in TempoSystem.
  events.on<{ radius: number; freezeDur: number }>("COLD_CRASH", () => {
    spawnFrostShockRing(11, 0.9);
    defer(() => spawnFrostShockRing(7.5, 0.75), 70);
    defer(() => spawnFrostShockRing(4.5, 0.6), 150);
    cam.shake(0.18, 0.55);
    // Pale icy flare under the player + a frost decal that lingers ~8s — a
    // ground footprint of where the freeze landed. Both reads use the shared
    // ground/elevated scratch buffers.
    evScratchGround.set(player.root.position.x, 0, player.root.position.z);
    hitFx.flare(evScratchGround, [0.55, 0.85, 1.0], 4.2, 0.45);
    decals.spawn("frost", evScratchGround, 4.6);
    // Burst of "ice mote" particles upward from the feet.
    evScratch.set(player.root.position.x, 0.5, player.root.position.z);
    hitFx.burst(evScratch, 36, [0.7, 0.9, 1.0], 1.3);
    // Vignette flash — cyan, longer than the ZONE_TRANSITION drop tick (0.35s)
    // so the freeze beat dominates the screen-edge tint while crashRecoverTimer
    // (~0.6s) ticks down.
    zoneTransitionFlashTimer = 0.7;
    zoneTransitionFlashColor.set(0.45, 0.7, 1.0);
  });

  // ---------- Tempo zone-transition VFX ----------
  // The biggest "I just powered up" moment was previously invisible. On any
  // climb (FLOWING→HOT, HOT→CRITICAL) we kick a shock ring + camera shake +
  // vignette flash; on any drop we do a brief desaturation pulse so falling
  // out of the zone reads as a setback. Existing TempoSystem.ZONE_TRANSITION
  // already fires both directions.
  const ZONE_RANK: Record<string, number> = { COLD: 0, FLOWING: 1, HOT: 2, CRITICAL: 3 };
  let zoneTransitionFlashTimer = 0;
  let zoneTransitionFlashColor = new Color3(1, 0.6, 0.2);
  events.on<{ oldZone: string; newZone: string }>("ZONE_TRANSITION", ({ oldZone, newZone }) => {
    const oldR = ZONE_RANK[oldZone] ?? 1;
    const newR = ZONE_RANK[newZone] ?? 1;
    if (newR > oldR) {
      // Climb — celebrate. HOT gets warm orange + medium ring; CRITICAL gets
      // red-white + larger ring + bigger shake.
      const isCritical = newZone === "CRITICAL";
      spawnShockRing(isCritical ? 8 : 6);
      cam.shake(isCritical ? 0.16 : 0.10, isCritical ? 0.45 : 0.32);
      evScratchGround.set(player.root.position.x, 0, player.root.position.z);
      hitFx.flare(
        evScratchGround,
        isCritical ? [1.0, 0.55, 0.25] : [1.0, 0.75, 0.25],
        isCritical ? 4.4 : 3.2,
        isCritical ? 0.42 : 0.30,
      );
      zoneTransitionFlashTimer = 0.5;
      zoneTransitionFlashColor.set(
        isCritical ? 1.0 : 1.0,
        isCritical ? 0.45 : 0.65,
        isCritical ? 0.10 : 0.18,
      );
    } else if (newR < oldR) {
      // Drop — brief blue desaturation flash via the same vignette path.
      zoneTransitionFlashTimer = 0.35;
      zoneTransitionFlashColor.set(0.3, 0.4, 0.85);
    }
  });

  // ---------- Selected-card state ----------
  // LMB plays the card at selectedSlot; RMB cycles selectedSlot to the next populated slot.
  // 1–4 keys select a slot directly without playing (handy for experienced players).
  const selection = { slot: 0 };

  function ensureValidSelection(): void {
    // Prefer the current slot if it's populated; otherwise scan forward for the next non-empty one.
    if (deck.peek(selection.slot)) return;
    for (let offset = 1; offset <= 4; offset++) {
      const s = (selection.slot + offset) % 4;
      if (deck.peek(s)) { selection.slot = s; return; }
    }
    // Hand is empty — leave slot as-is (the HUD will render it empty).
  }

  function cycleSelection(): void {
    for (let offset = 1; offset <= 4; offset++) {
      const s = (selection.slot + offset) % 4;
      if (deck.peek(s)) { selection.slot = s; return; }
    }
  }

  function refreshAttackPreview(): void {
    combat.setSelectedCard(deck.peek(selection.slot));
  }

  // Re-emit a slot-aware play event so the HUD can flash the right slot.
  // (CardCaster only knows card.id; main.ts owns the slot index.)

  // ---------- Target lock ----------
  // Auto-locks to the nearest alive enemy so the camera has something to frame
  // besides the player's back. Q / Tab cycles to the next alive enemy; a HUD
  // button does the same. Lock clears automatically when the target dies.
  const lock: { enemy: Enemy | null } = { enemy: null };

  function nearestEnemy(): Enemy | null {
    let best: Enemy | null = null;
    let bestD = Infinity;
    const px = player.root.position.x;
    const pz = player.root.position.z;
    for (const e of enemies.enemies) {
      if (!e.alive) continue;
      const dx = e.root.position.x - px;
      const dz = e.root.position.z - pz;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  function cycleLock(): void {
    const alive = enemies.enemies.filter((e) => e.alive);
    if (alive.length === 0) { lock.enemy = null; return; }
    const cur = lock.enemy && lock.enemy.alive ? alive.indexOf(lock.enemy) : -1;
    lock.enemy = alive[(cur + 1) % alive.length];
  }

  function validateLock(): void {
    if (lock.enemy && !lock.enemy.alive) lock.enemy = null;
    if (!lock.enemy) lock.enemy = nearestEnemy();
  }

  function prettyEnemyName(e: Enemy): string {
    // Strip boss_ prefix, uppercase the rest, include remaining HP so the button
    // doubles as a secondary target readout.
    const raw = e.def.name.replace(/^boss_/, "");
    const hp = Math.max(0, Math.round(e.hp));
    return `${raw.toUpperCase()}  ${hp}/${e.def.hp}`;
  }

  // Lock indicator — a cyan torus that follows the locked enemy's feet. Pulses
  // so it pops against the existing red threat rings.
  const lockRing = MeshBuilder.CreateTorus("lockRing", { diameter: 2.2, thickness: 0.09, tessellation: 32 }, scene);
  const lockRingMat = new StandardMaterial("lockRingMat", scene);
  lockRingMat.diffuseColor = new Color3(0.3, 1.0, 1.0);
  lockRingMat.emissiveColor = new Color3(0.2, 0.9, 1.0);
  lockRingMat.disableLighting = true;
  lockRingMat.alpha = 0.85;
  lockRing.material = lockRingMat;
  lockRing.isPickable = false;
  lockRing.setEnabled(false);
  let lockRingPulse = 0;

  function updateLockRing(dt: number): void {
    if (!lock.enemy || !lock.enemy.alive) {
      lockRing.setEnabled(false);
      return;
    }
    lockRing.setEnabled(true);
    const r = lock.enemy.def.radius;
    const d = r * 2 + 0.9;
    lockRing.scaling.x = lockRing.scaling.z = d / 2.2;
    lockRing.position.x = lock.enemy.root.position.x;
    lockRing.position.y = 0.08;
    lockRing.position.z = lock.enemy.root.position.z;
    lockRingPulse += dt * 4;
    lockRingMat.alpha = 0.55 + 0.35 * Math.abs(Math.sin(lockRingPulse));
    lockRing.rotation.y += dt * 1.2;
  }

  const gs = new GameState();
  gs.totalRooms = run.rooms.length;
  gs.roomIndex = 0;
  hud.setRoomIndicator(`${run.rooms[0].name} (1/${run.rooms.length})`);

  // Color grading preset per room index — verdant biome for 0/1, pit for the boss arena.
  function presetForRoom(idx: number): GradingPreset {
    if (idx >= run.rooms.length - 1) return "pit";
    return "verdant";
  }
  function isBossRoom(idx: number): boolean {
    return idx >= run.rooms.length - 1;
  }
  applyGradingPreset(pipeline, presetForRoom(0));
  applyBossLighting(sceneBundle, isBossRoom(0));
  // Fireflies belong to the verdant biome — kill them in the boss arena where
  // the firelight palette would fight the cool spec highlights.
  fireflies.setEnabled(!isBossRoom(0));

  // Arena hazards are only active in the boss room (the last index). The flag
  // flips in handleRoomCleared's transition block and on reset.
  function updateArenaHazardsEnabled(): void {
    arenaHazards.enabled = gs.roomIndex === run.rooms.length - 1;
    if (!arenaHazards.enabled) arenaHazards.reset();
  }
  updateArenaHazardsEnabled();

  const rewardRng = mulberry32(0xfeed);

  function pickRewardOptions(): ItemDef[] {
    const owned = items.equipped;
    const available = ALL_ITEM_IDS.filter((id) => {
      const def = ItemDefinitions[id];
      if (owned.has(id)) return false;
      if (def.charSpecific && def.charSpecific !== BLADE.id) return false;
      return true;
    });
    const out: ItemDef[] = [];
    const pool = available.slice();
    while (out.length < 3 && pool.length > 0) {
      const idx = Math.floor(rewardRng() * pool.length);
      out.push(ItemDefinitions[pool[idx]]);
      pool.splice(idx, 1);
    }
    return out;
  }

  function handleRoomCleared(): void {
    if (gs.phase !== "playing") return;
    // Last room → straight to victory. The boss arena has no exit door, so
    // there's nothing to walk through; clearing it ends the run.
    if (run.isLastRoom()) {
      gs.setPhase("victory");
      hud.setBanner("VICTORY — press R to play again");
      return;
    }
    // Otherwise: open the door and let the player walk to it themselves. The
    // reward picker fires AFTER they cross the threshold, in `runDoorTransition`.
    gs.setPhase("door_open");
    hud.setBanner("EXIT THROUGH THE DOOR");
    const arena = run.arena;
    if (arena && arena.door) {
      arena.door.setLocked(false);
      arena.doorPass.active = true;
    } else {
      // Defensive fallback — if the room has no door (shouldn't happen for a
      // non-last room, but if a future room descriptor sets exitDoor:false
      // mid-run we want to still be able to advance), skip straight to
      // transition. Reuses the same path the doorway crossing fires.
      void runDoorTransition();
    }
  }

  /**
   * Player has crossed the doorway threshold (or no door exists). Fade with a
   * brief flash, swap the arena under cover, then surface the reward picker
   * as the player "enters" the new room.
   */
  async function runDoorTransition(): Promise<void> {
    if (gs.phase !== "door_open" && gs.phase !== "playing") return;
    gs.setPhase("transitioning");
    hud.setBanner(null);
    // Brief white flash hides the arena swap. Swap happens at the apex (~75ms in).
    const flashPromise = hud.playFlash("#ffffff", 180, 0.92);
    setTimeout(() => {
      const nextArena = run.nextRoom();
      gs.roomIndex = run.currentIndex;
      input.setFloorReference(nextArena.floor);
      enemies.setPillars(nextArena.pillars);
      controller.setArena({
        bounds: nextArena.bounds,
        pillars: nextArena.pillars,
        doorPass: nextArena.doorPass,
      });
      placePlayerAtSpawn(nextArena.bounds);
      hud.setRoomIndicator(`${run.rooms[gs.roomIndex].name} (${gs.roomIndex + 1}/${run.rooms.length})`);
      applyGradingPreset(pipeline, presetForRoom(gs.roomIndex));
      applyBossLighting(sceneBundle, isBossRoom(gs.roomIndex));
      fireflies.setEnabled(!isBossRoom(gs.roomIndex));
      updateArenaHazardsEnabled();
      // Hand is fixed for the whole run — no re-draw between rooms.
      ensureValidSelection();
    }, 90);
    await flashPromise;
    // Reward picker now fires "as the player enters" — narratively framed as
    // their reward for clearing the previous room rather than a meta-screen
    // between arenas.
    await openRewardPicker();
    gs.setPhase("playing");
  }

  async function openRewardPicker(): Promise<void> {
    const options = pickRewardOptions();
    if (options.length === 0) return;
    hud.setBanner("CHOOSE A RELIC");
    pipeline.depthOfFieldEnabled = true;
    pipeline.depthOfField.focalLength = 50;
    pipeline.depthOfField.fStop = 1.4;
    pipeline.depthOfField.focusDistance = 8000;
    pipeline.depthOfField.lensSize = 50;
    try {
      const picked = await rewardPicker.open(options);
      if (picked) {
        items.equip(picked.id);
        events.emit("RELIC_EQUIPPED", { id: picked.id, name: picked.name, color: picked.color });
      }
    } finally {
      pipeline.depthOfFieldEnabled = false;
      hud.setBanner(null);
    }
  }

  function resetRun(): void {
    // Cancel any in-flight deferred callbacks first — without this, an
    // ember burst from a kill 100ms before reset would land at the new spawn
    // position, or a queued shock-ring stagger would fire on a fresh arena.
    clearDeferred();
    player.reset();
    tempo.reset();
    deck.reset();
    items.reset();
    projectiles.reset();
    hostileProjectiles.reset();
    damageNumbers.reset();
    dodgeGhosts.reset();
    weaponTrail.reset();
    relicAuras.reset();
    enemyHpPips.reset();
    arenaHazards.reset();
    decals.reset();
    hitFx.resetFlares();
    stepDust.reset();
    swordAura.reset();
    groundPulse.reset();
    crashTelegraph.reset();
    // Shock rings are pre-allocated pools now — hide and reset state instead
    // of disposing (which would empty the pool for the rest of the session).
    for (const r of shockRings) {
      r.active = false;
      r.ttl = 0;
      r.mesh.setEnabled(false);
    }
    // Card FX pool — hide all and reset state, never dispose (pool persists).
    for (const s of cardFxPool) {
      s.active = false;
      s.ttl = 0;
      if (s.pivot) s.pivot.setEnabled(false);
      else s.mesh.setEnabled(false);
    }
    damageFlashTimer = 0;
    bossPhaseFlashTimer = 0;
    pipeline.chromaticAberrationEnabled = false;
    pipeline.bloomWeight = 0.4;
    hud.clearRelicBadges();
    selection.slot = 0;
    gs.setPhase("playing");
    gs.roomIndex = 0;
    const arena = run.loadRoom(0);
    input.setFloorReference(arena.floor);
    enemies.setPillars(arena.pillars);
    controller.setArena({
      bounds: arena.bounds,
      pillars: arena.pillars,
      doorPass: arena.doorPass,
    });
    placePlayerAtSpawn(arena.bounds);
    hud.setBanner(null);
    hud.setRoomIndicator(`${run.rooms[0].name} (1/${run.rooms.length})`);
    applyGradingPreset(pipeline, presetForRoom(0));
    applyBossLighting(sceneBundle, isBossRoom(0));
    fireflies.setEnabled(!isBossRoom(0));
    updateArenaHazardsEnabled();
    refreshAttackPreview();
  }

  events.on("ROOM_CLEARED", () => {
    void handleRoomCleared();
  });

  // Boss Phase 2: spawn two chasers next to the boss
  events.on<{ bossId: string; phase: number; spawnPos: Vector3 }>("BOSS_PHASE", ({ spawnPos }) => {
    const off = 4.0;
    enemies.spawn("chaser", new Vector3(spawnPos.x - off, 0, spawnPos.z));
    enemies.spawn("chaser", new Vector3(spawnPos.x + off, 0, spawnPos.z));
  });

  // Inspector toggle + restart on R + quality cycle on G
  let inspectorLoaded = false;
  window.addEventListener("keydown", async (e) => {
    if (e.key === "`") {
      if (!inspectorLoaded) {
        await import("@babylonjs/inspector");
        inspectorLoaded = true;
      }
      if (scene.debugLayer.isVisible()) scene.debugLayer.hide();
      else scene.debugLayer.show({ embedMode: true });
    }
    if (e.key.toLowerCase() === "r" && (gs.phase === "dead" || gs.phase === "victory")) {
      resetRun();
    }
    if (e.key.toLowerCase() === "g") {
      // Cycle low → medium → high. SSAO + god rays toggle immediately; shadow +
      // bloom kernel changes apply next arena load (they're baked into the
      // SceneBundle at creation) so we show a transient banner prompting a
      // restart if those settings would actually differ.
      const q = cycleQuality();
      setHeavyPostFx(cam.camera, { ssao: q.ssaoEnabled, godRays: q.godRaysEnabled });
      // Adaptive scaling may have downscaled the framebuffer in response to a
      // load spike. A manual quality cycle should reset that — otherwise the
      // user wonders why "high" quality is rendering at 80% resolution.
      engine.setHardwareScalingLevel(1.0);
      scalingLevel = 1.0;
      pressureSeconds = 0;
      recoverySeconds = 0;
      hud.setBanner(`GRAPHICS: ${q.tier.toUpperCase()}`);
      defer(() => { if (gs.phase === "playing") hud.setBanner(null); }, 1200);
    }
  });

  // All materials are created by this point (arena, env, player, enemies for
  // room 0, FX pools). Freeze the dirty-material check so Babylon skips the
  // per-frame "which uniforms changed" scan on every material. Rebuilds on room
  // load and relic equips are fine — they create *new* materials, not mutate
  // existing flags.
  scene.blockMaterialDirtyMechanism = true;

  // Menu system — owns the start menu, pause menu, and shared controls panel.
  // Gameplay phase begins as "menu" (set in GameState default) so the gameplay
  // tick below bails out until the player clicks START.
  const menus = new MenuSystem(scene);
  engine.runRenderLoop(() => scene.render());

  // Pause menu plumbing. Esc toggles when the player is mid-game; on the menus
  // themselves it routes to the controls overlay's back action. Installed
  // BEFORE the first start menu so Esc can close the controls panel even
  // before the game has started.
  let pauseInFlight = false;
  async function openPauseMenu(): Promise<void> {
    if (pauseInFlight) return;
    if (gs.phase !== "playing") return;
    pauseInFlight = true;
    gs.setPhase("paused");
    const choice = await menus.showPauseMenu();
    menus.hide();
    pauseInFlight = false;
    if (choice === "resume") {
      gs.setPhase("playing");
    } else if (choice === "quit") {
      window.close();
    } else if (choice === "mainMenu") {
      // Wipe the run, drop back to the start screen, then loop back into play.
      resetRun();
      gs.setPhase("menu");
      await runStartMenu();
    }
  }

  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (menus.isAnyOpen) {
      if (menus.handleEscape()) e.preventDefault();
      return;
    }
    if (gs.phase === "playing") {
      e.preventDefault();
      void openPauseMenu();
    }
  });

  async function runStartMenu(): Promise<void> {
    const choice = await menus.showStartMenu();
    if (choice === "quit") {
      window.close();
      return;
    }
    menus.hide();
    gs.setPhase("playing");
  }
  await runStartMenu();

  // Tab-blur / stall recovery: after the tab becomes visible again, the first
  // frame's engine.getDeltaTime() reflects the wall-clock gap (seconds to minutes).
  // Even with the dt clamp below, timers/physics would still step forward by the
  // clamp's max per frame after a long stall. Instead, skip one frame on resume.
  let skipNextFrame = true; // also skip the very first render frame after boot
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") skipNextFrame = true;
  });

  scene.onBeforeRenderObservable.add(() => {
    if (skipNextFrame) {
      skipNextFrame = false;
      return;
    }

    // Frozen states — start menu before play, or pause menu mid-play. Skip ALL
    // gameplay + visual ticks so the world is genuinely paused under the menu.
    // The next render still draws the last gameplay frame underneath the dim
    // overlay, which is exactly what we want for "snapshot of where I left off".
    if (gs.isFrozen()) return;

    // Clamp dt to at most 1/30s. Protects against single long frames (GC pause,
    // alt-tab without the visibility event firing, browser throttling) from
    // teleporting the player through walls or advancing timers by seconds.
    const realDt = Math.min(engine.getDeltaTime() / 1000, 1 / 30);
    // Capture once per frame so multiple post-fx readers (vignette, chromatic
    // aberration, bloom lift, sword shimmer) share the same `performance.now()`
    // and the same sin samples. Saves ~5 trig calls + 5 perf.now syscalls.
    const nowMs = performance.now();
    const heartbeatPulse = 0.5 + 0.5 * Math.sin(nowMs * 0.0075);
    const camForward = cam.camera.getForwardRay().direction;
    const frame = input.consume(camForward);

    // Gameplay dt always equals realDt — no hitstop, no slowdown. Impact reads
    // come from camera shake + flashes + particles, all of which run regardless.
    const dt = realDt;

    controller.update(dt, frame);

    if (gs.isInteractive()) {
      enemies.update(dt, player);
      combat.update(dt);
      projectiles.update(dt);
      hostileProjectiles.update(dt);

      ensureValidSelection();

      // Target lock: auto-pick nearest when unset or the current target dies.
      validateLock();
      if (frame.cycleTargetPressed) {
        cycleLock();
        // Swing the camera to frame the new target so attacks feel deliberate.
        if (lock.enemy) {
          cam.orientToward(lock.enemy.root.position.x, lock.enemy.root.position.z);
        }
      }
      cam.setFocus(lock.enemy ? lock.enemy.root : null);
      applyLockOutline(lock.enemy);

      // 1–4: direct-select a slot (does NOT play — that's LMB now).
      for (const slot1 of frame.selectSlotPressed) {
        const idx = slot1 - 1;
        if (idx >= 0 && idx < 4 && deck.peek(idx)) selection.slot = idx;
      }

      // RMB: cycle to the next populated slot.
      if (frame.cycleSelectedPressed) cycleSelection();

      // LMB: play whatever is selected. Cards are NOT consumed — AP is the cost.
      // The same 4 cards stay in the same slots for the entire run; only the AP
      // bar drains on cast.
      if (frame.attackPressed) {
        const idx = selection.slot;
        const card = deck.peek(idx);
        if (card) {
          const cast = caster.cast(card, frame.aimPoint);
          if (cast) {
            if (card.type === "melee") combat.triggerFlash();
            deck.play(idx);
            events.emit("CARD_PLAYED_SLOT", { slot: idx });
          }
        }
      }

      refreshAttackPreview();
      hud.setSelectedSlot(selection.slot);
      hud.setLockedTargetName(lock.enemy ? prettyEnemyName(lock.enemy) : null);

      if (frame.crashPressed) {
        tempo.triggerCrash();
      }

      if (player.ap < player.stats.maxAp) {
        player.ap = Math.min(player.stats.maxAp, player.ap + AP_REGEN_PER_SEC * dt);
      }

      tempo.update(dt);

      if (player.hp <= 0 && gs.phase === "playing") {
        gs.setPhase("dead");
        hud.setBanner("DEFEATED — press R to restart");
      }
    }

    damageNumbers.update(realDt);
    updateShockRings(realDt);
    updateCardFx(realDt);
    updateLockRing(realDt);
    hitFx.updateFlares(realDt);
    dodgeGhosts.update(realDt);
    decals.update(realDt);
    enemyHpPips.update(enemies.enemies);
    // Environment wind + future ambient effects. Guarded by arena presence —
    // RunManager.arena is null only before the first loadRoom() call.
    if (run.arena?.env) {
      run.arena.env.tick(realDt);
      // Tempo-driven mote density boost — the air visibly thickens with
      // energy at HOT/CRITICAL. Linear ramp from 1.0 at tempo 70 to 1.5 at 90+.
      const moteBoost = tempo.value < 70
        ? 1.0
        : 1.0 + 0.5 * Math.min(1, (tempo.value - 70) / 20);
      run.arena.env.setMoteBoost(moteBoost);
    }
    fireflies.tick(realDt);
    tickBossLighting(sceneBundle, realDt);

    // Arena hazards — only active in the boss room. Tick FIRST with the current
    // player position, then consume any pending damage to apply to HP. Uses the
    // gameplay dt (so hitstop freezes the telegraphs along with everything else).
    if (gs.isInteractive()) {
      arenaHazards.tick(dt, player.root.position, player.stats.radius, player.isDodging);
      const hazardDmg = arenaHazards.consumeDamage();
      if (hazardDmg > 0) {
        player.hp = Math.max(0, player.hp - hazardDmg);
        // DAMAGE_TAKEN was already emitted inside the hazard for the visual
        // flash; we just update the HP number here.
      }
    }

    // Weapon trail samples every frame; records new samples only during the
    // brief swing window so trails stay concise. Intensity scales with tempo:
    // 0.6 at COLD, 1.0 at FLOWING, 1.5 at CRITICAL — visible thickening of
    // the swing as the player rides higher zones.
    player.getSwordTipWorld(swordTipBuf);
    const trailIntensity = 0.6 + 0.9 * (tempo.value / 100);
    weaponTrail.tick(swordTipBuf, player.isSwinging(), trailIntensity);

    // Sword aura — only at CRITICAL (tempo >= 90). Ramps in/out smoothly via
    // SwordAura's internal lerp so zone transitions look like the aura
    // "ignites" rather than snapping on.
    const auraTarget = tempo.value >= 90 ? Math.min(1, (tempo.value - 90) / 8) : 0;
    swordAura.setTargetIntensity(auraTarget);
    swordAura.tick(realDt);
    groundPulse.tick(realDt, player.root.position.x, player.root.position.z, tempo.value);

    // Crash telegraph — appears the moment tempo crosses the threshold and
    // hides on crash trigger / drop below it. Density count (0-N enemies in
    // range) drives the color shift toward red, so the ring tells the player
    // both *where* and *how lethal* their next F press will be.
    const crashReady = tempo.canCrash();
    crashTelegraph.setVisible(crashReady && gs.phase === "playing");
    if (crashReady) {
      let inRange = 0;
      const cR2 = CRASH_RADIUS * CRASH_RADIUS;
      const cpx = player.root.position.x;
      const cpz = player.root.position.z;
      for (const e of enemies.enemies) {
        if (!e.alive) continue;
        const dx = e.root.position.x - cpx;
        const dz = e.root.position.z - cpz;
        if (dx * dx + dz * dz <= cR2) inRange++;
      }
      crashTelegraph.setEnemyDensity(inRange);
      crashTelegraph.tick(realDt, cpx, cpz);
    }

    // Relic auras — Runaway trail, Berserker Heart emissive ramp, Metronome dot.
    // `movingSpeed` = approximate magnitude of movement this frame (not per-second).
    const moveMag = player.isDodging ? 1 : (frame.move.lengthSquared() > 1e-3 ? 1 : 0);
    relicAuras.tick(realDt, items, tempo, moveMag);
    hud.setMetronomeActive(items.has("metronome"));

    // Dodge visual state — drive body alpha, foot-ring emissive brightness, and
    // stamp ghost capsules along the dodge path while active. We key off the
    // player's `isDodging` flag directly so this works regardless of dodge source
    // (space/shift OR Dash Strike's i-frame window).
    if (player.isDodging) {
      player.bodyMat.alpha = 0.55;
      player.footRingMat.emissiveColor.set(0.5, 1.0, 1.0);
      dodgeGhosts.tickDodging(realDt, player.root.position);
    } else {
      player.bodyMat.alpha = 1;
      player.footRingMat.emissiveColor.copyFrom(player.footRingBaseEmissive);
      dodgeGhosts.resetStamp();
    }

    // Boss phase banner — clears itself on a short timer so it doesn't linger
    // into next-room transitions. bossPhaseFlashTimer is set when BOSS_PHASE fires.
    if (bossPhaseFlashTimer > 0) {
      bossPhaseFlashTimer = Math.max(0, bossPhaseFlashTimer - realDt);
      if (bossPhaseFlashTimer === 0) hud.setBanner(null);
    }

    // Low-HP heartbeat — takes over from the tempo-zone tint when HP drops.
    // Vignette priority: damage flash > low-HP heartbeat > tempo-zone tint.
    const vc = pipeline.imageProcessing.vignetteColor;
    const hpRatio = Math.max(0, player.hp / player.stats.maxHp);
    if (damageFlashTimer > 0) {
      damageFlashTimer = Math.max(0, damageFlashTimer - realDt);
      const t = damageFlashTimer / 0.35;
      vc.r = 1; vc.g = 0.05; vc.b = 0.05; vc.a = 0.85 * t;
    } else if (hpRatio > 0 && hpRatio < 0.33) {
      // Heartbeat pulse — ~1.2Hz, amplitude scales as HP drops further (peak at 15%).
      const urgency = Math.min(1, (0.33 - hpRatio) / 0.18);
      vc.r = 1.0; vc.g = 0.08; vc.b = 0.08;
      vc.a = (0.35 + 0.35 * heartbeatPulse) * urgency;
    } else if (zoneTransitionFlashTimer > 0) {
      // Transient flash from a tempo zone change — overrides the ambient zone
      // tint for a brief moment so the transition reads as a discrete event.
      zoneTransitionFlashTimer = Math.max(0, zoneTransitionFlashTimer - realDt);
      const t = zoneTransitionFlashTimer / 0.5;
      vc.r = zoneTransitionFlashColor.r;
      vc.g = zoneTransitionFlashColor.g;
      vc.b = zoneTransitionFlashColor.b;
      vc.a = 0.55 * t;
    } else {
      // Zone-driven ambient tint: subtle in COLD/HOT, hot red in CRITICAL.
      const zone = tempo.stateName();
      switch (zone) {
        case "COLD":     vc.r = 0.20; vc.g = 0.40; vc.b = 0.85; vc.a = 0.18; break;
        case "FLOWING":  vc.r = 0;    vc.g = 0;    vc.b = 0;    vc.a = 0;    break;
        case "HOT":      vc.r = 0.95; vc.g = 0.55; vc.b = 0.15; vc.a = 0.20; break;
        case "CRITICAL": vc.r = 1.00; vc.g = 0.20; vc.b = 0.05; vc.a = 0.32; break;
      }
    }
    // Chromatic aberration composes low-HP "bleeding" + transient Crash burst.
    // Enable the post-process once we have either contribution and set the max.
    let aberration = 0;
    if (hpRatio > 0 && hpRatio < 0.15) {
      // Same heartbeatPulse used by the vignette above — both at ~1.2Hz so they
      // visibly sync, and only one trig call per frame is paid.
      aberration = 14 * heartbeatPulse;
    }
    if (crashAberrationTimer > 0) {
      crashAberrationTimer = Math.max(0, crashAberrationTimer - realDt);
      const t = crashAberrationTimer / crashAberrationDuration;
      // Ease-out: starts big, fades. Peak ~22px.
      const crashBurst = 22 * t * t;
      if (crashBurst > aberration) aberration = crashBurst;
    }
    if (aberration > 0) {
      pipeline.chromaticAberrationEnabled = true;
      pipeline.chromaticAberration.aberrationAmount = aberration;
    } else {
      pipeline.chromaticAberrationEnabled = false;
    }

    // Tempo CRITICAL bloom lift — "crash ready" should feel electric, not just labeled.
    // Baseline bloomWeight is 0.4 (set in SceneSetup). Pulse 0.4 → 0.68 at ~1.6Hz while >= 85.
    // Plus a contrast nudge so highlights pop and the world looks more decisive
    // when the player is in the zone — composes with the existing bloom pulse.
    if (tempo.value >= 85 && !tempo.isCrashed) {
      const lift = 0.5 + 0.5 * Math.sin(nowMs * 0.01);
      pipeline.bloomWeight = 0.4 + 0.28 * lift;
      pipeline.imageProcessing.contrast = 1.05 + 0.10 * lift;
    } else {
      pipeline.bloomWeight = 0.4;
      pipeline.imageProcessing.contrast = 1.05;
    }

    // Hot blade — ramp the sword's emissive toward orange/red as Tempo rises
    // above 70. Below 70 we hold the cold baseline (0.25, 0.22, 0.1). At 100
    // we peak near (1.2, 0.45, 0.08) — heavily bloomed. A small sin pulse on
    // top gives the "about to crash" shimmer when the bar is electric.
    {
      const t = Math.max(0, Math.min(1, (tempo.value - 70) / 30));
      const shimmer = t > 0.5 ? Math.sin(nowMs * 0.012) * 0.12 : 0;
      player.swordMat.emissiveColor.set(
        0.25 + 0.95 * t + shimmer,
        0.22 + 0.23 * t,
        0.10 - 0.02 * t,
      );
    }

    const r = player.stats.radius;
    const a = controller.arena;
    if (player.root.position.x < a.bounds.minX + r) player.root.position.x = a.bounds.minX + r;
    if (player.root.position.x > a.bounds.maxX - r) player.root.position.x = a.bounds.maxX - r;
    const dpSafety = a.doorPass;
    const inDoorSafety = !!dpSafety && dpSafety.active
      && player.root.position.x > dpSafety.xMin + r
      && player.root.position.x < dpSafety.xMax - r;
    if (!inDoorSafety && player.root.position.z < a.bounds.minZ + r) player.root.position.z = a.bounds.minZ + r;
    if (player.root.position.z > a.bounds.maxZ - r) player.root.position.z = a.bounds.maxZ - r;

    // Door tick + threshold trigger. The arena's door (when present) animates
    // open after unlock; once the player crosses the doorway plane on the
    // -Z side while in the door's x-range, fire the room transition exactly
    // once. The phase guard prevents re-entry while the swap is in flight.
    if (run.arena && run.arena.door) run.arena.door.tick(realDt);
    if (gs.phase === "door_open" && run.arena && run.arena.door) {
      const door = run.arena.door;
      const px = player.root.position.x;
      const pz = player.root.position.z;
      if (pz < door.zPlane - 0.4 && px > door.xMin && px < door.xMax) {
        void runDoorTransition();
      }
    }

    cam.update(dt);
    // HUD animates in real time — hitstop shouldn't freeze bar lerps, that'd
    // read as a UI bug. Pass realDt.
    hud.update(realDt);
    devOverlay.update(realDt);
    tickAdaptiveScaling(realDt);
  });

  // eslint-disable-next-line no-console
  console.log(`[Rogue Hero 3] Run started: ${run.rooms.length} rooms. Backtick (\`) toggles inspector.`);
}

boot().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[Rogue Hero 3] Boot failed:", err);
});
