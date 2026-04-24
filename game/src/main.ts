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

import { createSceneBundle, applyGradingPreset, GradingPreset } from "./scene/SceneSetup";
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
import { DamageNumbers } from "./ui/DamageNumbers";
import { EnemyHealthPips } from "./ui/EnemyHealthPips";
import { IntroScreen } from "./ui/IntroScreen";
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

  const { engine, scene, shadow, attachPostFx, setHeavyPostFx } = createSceneBundle(canvas);

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

  const controller = new PlayerController(player, {
    bounds: arena0.bounds,
    pillars: arena0.pillars,
  });

  // Spawn the player well inside the arena facing the center. Previously we placed the hero 4m
  // from the south wall — that tucked the follow camera outside the wall since the rig sits
  // ~8m behind the target. 10m of back-clearance keeps the camera inside even at zoomed-out radii.
  function placePlayerAtSpawn(b: { minX: number; maxX: number; minZ: number; maxZ: number }): void {
    player.root.position.x = 0;
    player.root.position.z = b.maxZ - 10;
    player.facing.set(0, 0, -1);
    player.aimPivot.rotation.y = Math.PI;
  }
  placePlayerAtSpawn(arena0.bounds);

  const combat = new CombatManager(scene, player);
  const tempo = new TempoSystem();
  tempo.setClassPassives(BLADE.passives);
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
  function applyLockOutline(e: Enemy | null): void {
    if (lockedOutlineTarget === e) return;
    // Clear previous target's outline meshes.
    if (lockedOutlineTarget) {
      for (const m of lockedOutlineTarget.getOutlineMeshes()) outline.removeMesh(m);
    }
    lockedOutlineTarget = e;
    if (e && e.alive) {
      const c = new Color3(1.0, 0.9, 0.2);
      for (const m of e.getOutlineMeshes()) outline.addMesh(m, c);
    }
  }
  const rewardPicker = new RewardPicker(scene);
  const hitFx = new HitParticles(scene);
  const dodgeGhosts = new DodgeGhosts(scene);
  const weaponTrail = new WeaponTrail(scene);
  const relicAuras = new RelicAuras(scene, player);
  const decals = new Decals(scene);
  const damageNumbers = new DamageNumbers(scene);
  const enemyHpPips = new EnemyHealthPips(scene);
  // Arena hazards — only the boss room turns them on. Half-size is injected per
  // room load so the spawn radius matches the current arena.
  const arenaHazards = new ArenaHazards(scene, 27);
  // Reused buffer so the sword-tip sampler doesn't allocate a Vector3 per frame.
  const swordTipBuf = new Vector3();

  // ---------- Global juice: hitstop + screen shake ----------
  // Hitstop freezes gameplay update (not rendering) for a few frames on impact,
  // selling the weight of each swing. Multiple rapid hits take the longest
  // pending duration rather than stacking. Camera shake follows the same event.
  let hitstopRemaining = 0;
  function addHitstop(dur: number): void {
    if (dur > hitstopRemaining) hitstopRemaining = dur;
  }

  // Hit feedback
  events.on<EnemyHitPayload>("ENEMY_HIT", (p) => {
    const pos = new Vector3(p.x, p.y, p.z);
    if (p.killed) {
      hitFx.burst(pos, p.isBoss ? 60 : 32, [1.0, 0.55, 0.2], p.isBoss ? 1.6 : 1.0);
      // Crit-style flare on the ground beneath the kill — scales bigger for boss kills.
      hitFx.flare(pos, p.isBoss ? [1.0, 0.35, 0.1] : [1.0, 0.75, 0.25], p.isBoss ? 3.2 : 2.4, p.isBoss ? 0.35 : 0.24);
      cam.shake(p.isBoss ? 0.18 : 0.06, p.isBoss ? 0.45 : 0.25);
      // Hitstop tuned down from 60/100ms so chains of kills don't feel like
      // a series of micro-freezes. Boss kill keeps a longer pause since it's
      // a once-per-run moment.
      addHitstop(p.isBoss ? 0.08 : 0.035);
      // Blood splat on the ground under the kill. Medium/high quality only.
      decals.spawn("blood", new Vector3(pos.x, 0, pos.z), p.isBoss ? 2.6 : 1.3);
    } else {
      hitFx.burst(pos, 14, [1.0, 0.85, 0.4], 0.7);
      cam.shake(0.03, 0.18);
      addHitstop(0.022);
    }
    damageNumbers.spawn(pos, p.amount, p.killed ? "#ff7733" : "#ffe066", p.killed);
  });

  // Player damage flash — vignette pulses red briefly when player takes damage.
  let damageFlashTimer = 0;
  events.on("DAMAGE_TAKEN", () => {
    damageFlashTimer = 0.35;
    cam.shake(0.12, 0.32);
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
    const center = dying.root.position.clone();
    center.y = 0;
    cam.startKillCam(center, 9, 0.9, 2.5);
    addHitstop(0.28);
    cam.shake(0.2, 0.8);
    // Soul-wisp style burst + ground flare at the boss's feet.
    hitFx.flare(center, [1.0, 0.55, 0.1], 5.0, 1.0);
    hitFx.burst(new Vector3(center.x, 0.5, center.z), 80, [1.0, 0.7, 0.25], 1.6);
  });

  // Boss phase 2 — big kick moment. Banner + banner clear handled below via BOSS_PHASE.
  let bossPhaseFlashTimer = 0;
  events.on<{ bossId: string; phase: number; spawnPos: Vector3 }>("BOSS_PHASE", ({ spawnPos }) => {
    cam.shake(0.28, 0.7);
    addHitstop(0.18); // deeper freeze than a normal hit
    bossPhaseFlashTimer = 1.6;
    hud.setBanner("THE BRAWLER ENRAGES");
    hud.flashBossPhase();
    // Zoom the camera in for the reveal, then return to default after ~1.2s.
    cam.setFovTarget(0.7, 4);
    setTimeout(() => cam.setFovTarget(null, 2), 1200);
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
      setTimeout(() => {
        curves.globalSaturation = prevSat;
        curves.shadowsDensity = prevShadowsDensity;
      }, 1600);
    }
    // Ground shock ring emanating from the boss's current position.
    const ring = MeshBuilder.CreateTorus(`bossShock_${Date.now()}`, { diameter: 2, thickness: 0.22, tessellation: 36 }, scene);
    ring.position.set(spawnPos.x, 0.06, spawnPos.z);
    const ringMat = new StandardMaterial(`${ring.name}_mat`, scene);
    ringMat.diffuseColor = new Color3(1, 0.25, 0.05);
    ringMat.emissiveColor = new Color3(1, 0.2, 0.05);
    ringMat.disableLighting = true;
    ringMat.alpha = 0.9;
    ring.material = ringMat;
    shockRings.push({ mesh: ring, mat: ringMat, ttl: 0.9, initialTtl: 0.9, maxRadius: 10 });
  });

  // ---------- Crash AoE: damages enemies + spawns expanding shock-ring fx ----------
  interface ShockRing { mesh: Mesh; mat: StandardMaterial; ttl: number; initialTtl: number; maxRadius: number; }
  const shockRings: ShockRing[] = [];

  function spawnShockRing(maxRadius: number): void {
    const ring = MeshBuilder.CreateTorus(`shock_${Date.now()}`, { diameter: 2, thickness: 0.18, tessellation: 36 }, scene);
    ring.position.x = player.root.position.x;
    ring.position.y = 0.06;
    ring.position.z = player.root.position.z;
    const mat = new StandardMaterial(`shockMat_${Date.now()}`, scene);
    mat.diffuseColor = new Color3(1, 0.8, 0.3);
    mat.emissiveColor = new Color3(1, 0.7, 0.2);
    mat.alpha = 0.85;
    mat.disableLighting = true;
    ring.material = mat;
    shockRings.push({ mesh: ring, mat, ttl: 0.55, initialTtl: 0.55, maxRadius });
  }

  function updateShockRings(dt: number): void {
    for (let i = shockRings.length - 1; i >= 0; i--) {
      const r = shockRings[i];
      r.ttl -= dt;
      if (r.ttl <= 0) {
        r.mesh.dispose();
        r.mat.dispose();
        shockRings.splice(i, 1);
        continue;
      }
      const t = 1 - r.ttl / r.initialTtl;
      const scale = 1 + (r.maxRadius - 1) * t;
      r.mesh.scaling.x = r.mesh.scaling.z = scale;
      r.mat.alpha = 0.85 * (1 - t);
    }
  }

  // ---------- Card FX: ephemeral ground meshes so Cleave/Dash read visually ----------
  interface CardFxMesh { mesh: Mesh; mat: StandardMaterial; ttl: number; initial: number; }
  const cardFx: CardFxMesh[] = [];

  function spawnCardFx(fx: CardArcFx): void {
    if (fx.kind === "arc") {
      const arcDeg = fx.arcDegrees ?? 100;
      const mesh = MeshBuilder.CreateDisc(
        `cardArc_${Date.now()}`,
        { radius: fx.range, tessellation: 36, arc: arcDeg / 360 },
        scene,
      );
      // Same YXZ composition used in CombatManager — tip into XZ, then yaw so arc centers on +Z.
      mesh.rotation.x = Math.PI / 2;
      mesh.rotation.y = ((arcDeg / 2) * Math.PI) / 180 - Math.PI / 2;
      // Then rotate the whole mesh so +Z local maps onto the facing direction in world space.
      const parent = new TransformNode(`cardArcPivot_${Date.now()}`, scene);
      parent.position.x = fx.x;
      parent.position.y = 0.08;
      parent.position.z = fx.z;
      parent.rotation.y = Math.atan2(fx.fx, fx.fz);
      mesh.parent = parent;
      const mat = new StandardMaterial(`cardArcMat_${Date.now()}`, scene);
      mat.diffuseColor = new Color3(1, 0.7, 0.25);
      mat.emissiveColor = new Color3(1, 0.55, 0.15);
      mat.disableLighting = true;
      mat.backFaceCulling = false;
      mat.alpha = 0.7;
      mesh.material = mat;
      cardFx.push({ mesh, mat, ttl: 0.3, initial: 0.3 });
      (mesh as Mesh & { __pivot?: TransformNode }).__pivot = parent;
    } else {
      // Dash swept line: a thin flat box from start → along direction for `range` meters.
      const mesh = MeshBuilder.CreateBox(
        `cardDash_${Date.now()}`,
        { width: 1.6, height: 0.02, depth: Math.max(0.2, fx.range) },
        scene,
      );
      mesh.position.x = fx.x + fx.fx * fx.range * 0.5;
      mesh.position.y = 0.07;
      mesh.position.z = fx.z + fx.fz * fx.range * 0.5;
      mesh.rotation.y = Math.atan2(fx.fx, fx.fz);
      const mat = new StandardMaterial(`cardDashMat_${Date.now()}`, scene);
      mat.diffuseColor = new Color3(0.8, 0.55, 1.0);
      mat.emissiveColor = new Color3(0.75, 0.4, 1.0);
      mat.disableLighting = true;
      mat.alpha = 0.7;
      mesh.material = mat;
      cardFx.push({ mesh, mat, ttl: 0.28, initial: 0.28 });
    }
  }

  function updateCardFx(dt: number): void {
    for (let i = cardFx.length - 1; i >= 0; i--) {
      const f = cardFx[i];
      f.ttl -= dt;
      if (f.ttl <= 0) {
        const pivot = (f.mesh as Mesh & { __pivot?: TransformNode }).__pivot;
        f.mesh.dispose();
        f.mat.dispose();
        if (pivot) pivot.dispose();
        cardFx.splice(i, 1);
        continue;
      }
      const t = f.ttl / f.initial;
      f.mat.alpha = 0.7 * t;
    }
  }

  events.on<CardArcFx>("CARD_FX", (p) => spawnCardFx(p));

  // Chromatic aberration burst timer — separate from the low-HP ramp so they
  // compose cleanly. Peak amount 14px, decays linearly.
  let crashAberrationTimer = 0;
  const crashAberrationDuration = 0.4;

  events.on<{ radius: number; dmg: number; accidental: boolean }>("CRASH_ATTACK", ({ radius, dmg }) => {
    // RH2's crash is huge by design (radius=100). Cap visual ring at a sane size for our arenas
    // so it reads as "wave from the player" instead of an invisible omni-blast.
    const visRadius = Math.min(radius, 14);
    // Three concentric shock rings, staggered by 0.05s. Creates a "wave train" read.
    spawnShockRing(visRadius);
    setTimeout(() => spawnShockRing(visRadius * 0.75), 50);
    setTimeout(() => spawnShockRing(visRadius * 0.5), 110);
    // Crash is the climactic payoff — big shake, a brief hitstop, and a bright flare under the player.
    cam.shake(0.22, 0.5);
    addHitstop(0.1);
    hitFx.flare(new Vector3(player.root.position.x, 0, player.root.position.z), [1.0, 0.85, 0.25], 5.5, 0.5);
    // Scorch decal under the Crash — visible proof of the blast for a while.
    decals.spawn("scorch", new Vector3(player.root.position.x, 0, player.root.position.z), 5.5);
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
  applyGradingPreset(pipeline, presetForRoom(0));

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

  async function handleRoomCleared(): Promise<void> {
    if (gs.phase !== "playing") return;
    gs.setPhase("reward");
    const options = pickRewardOptions();
    if (options.length > 0) {
      hud.setBanner("ROOM CLEARED");
      const picked = await rewardPicker.open(options);
      if (picked) {
        items.equip(picked.id);
        // HUD listens for RELIC_EQUIPPED to show the banner + expanding ring + persistent badge.
        events.emit("RELIC_EQUIPPED", { id: picked.id, name: picked.name, color: picked.color });
      }
      hud.setBanner(null);
    }

    if (run.isLastRoom()) {
      gs.setPhase("victory");
      hud.setBanner("VICTORY — press R to play again");
      return;
    }

    gs.setPhase("transitioning");
    // Wipe to black, then swap arena under cover, then wipe out. The Hud.playWipe
    // returns once the full fade-in + hold + fade-out sequence completes.
    const nextRoomIdx = run.currentIndex + 1;
    const nextRoomName = run.rooms[nextRoomIdx].name;
    const wipePromise = hud.playWipe(nextRoomName);
    // Swap the arena once the screen is fully black (~400ms in). Run it concurrently
    // with the wipe Promise so we can await the full sequence at the end.
    setTimeout(() => {
      const nextArena = run.nextRoom();
      gs.roomIndex = run.currentIndex;
      input.setFloorReference(nextArena.floor);
      enemies.setPillars(nextArena.pillars);
      controller.setArena({ bounds: nextArena.bounds, pillars: nextArena.pillars });
      placePlayerAtSpawn(nextArena.bounds);
      hud.setRoomIndicator(`${run.rooms[gs.roomIndex].name} (${gs.roomIndex + 1}/${run.rooms.length})`);
      applyGradingPreset(pipeline, presetForRoom(gs.roomIndex));
      updateArenaHazardsEnabled();
      // Hand is fixed for the whole run — no re-draw between rooms.
      ensureValidSelection();
    }, 420);
    await wipePromise;
    gs.setPhase("playing");
  }

  function resetRun(): void {
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
    for (const r of shockRings) { r.mesh.dispose(); r.mat.dispose(); }
    shockRings.length = 0;
    for (const f of cardFx) {
      const pivot = (f.mesh as Mesh & { __pivot?: TransformNode }).__pivot;
      f.mesh.dispose();
      f.mat.dispose();
      if (pivot) pivot.dispose();
    }
    cardFx.length = 0;
    damageFlashTimer = 0;
    hitstopRemaining = 0;
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
    controller.setArena({ bounds: arena.bounds, pillars: arena.pillars });
    placePlayerAtSpawn(arena.bounds);
    hud.setBanner(null);
    hud.setRoomIndicator(`${run.rooms[0].name} (1/${run.rooms.length})`);
    applyGradingPreset(pipeline, presetForRoom(0));
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
      hud.setBanner(`GRAPHICS: ${q.tier.toUpperCase()}`);
      setTimeout(() => { if (gs.phase === "playing") hud.setBanner(null); }, 1200);
    }
  });

  // Intro screen — wait for user dismissal before starting the loop
  const intro = new IntroScreen(scene);
  engine.runRenderLoop(() => scene.render());
  await intro.wait();

  scene.onBeforeRenderObservable.add(() => {
    const realDt = engine.getDeltaTime() / 1000;
    const camForward = cam.camera.getForwardRay().direction;
    const frame = input.consume(camForward);

    // Hitstop: gameplay update freezes briefly while visuals, camera, and post-fx
    // keep running at full speed. The counter drains against realDt so the freeze
    // is wall-clock, not stretched by itself.
    let dt = realDt;
    if (hitstopRemaining > 0) {
      hitstopRemaining = Math.max(0, hitstopRemaining - realDt);
      dt = realDt * 0.08;
    }

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

      if (frame.crashPressed && tempo.value >= 85 && !tempo.isCrashed) {
        tempo.setValue(100);
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
    if (run.arena?.env) run.arena.env.tick(realDt);

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
    // brief swing window so trails stay concise.
    player.getSwordTipWorld(swordTipBuf);
    weaponTrail.tick(swordTipBuf, player.isSwinging());

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
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.0075);
      vc.r = 1.0; vc.g = 0.08; vc.b = 0.08;
      vc.a = (0.35 + 0.35 * pulse) * urgency;
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
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.0075);
      aberration = 14 * pulse;
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
    if (tempo.value >= 85 && !tempo.isCrashed) {
      const lift = 0.5 + 0.5 * Math.sin(performance.now() * 0.01);
      pipeline.bloomWeight = 0.4 + 0.28 * lift;
    } else {
      pipeline.bloomWeight = 0.4;
    }

    // Hot blade — ramp the sword's emissive toward orange/red as Tempo rises
    // above 70. Below 70 we hold the cold baseline (0.25, 0.22, 0.1). At 100
    // we peak near (1.2, 0.45, 0.08) — heavily bloomed. A small sin pulse on
    // top gives the "about to crash" shimmer when the bar is electric.
    {
      const t = Math.max(0, Math.min(1, (tempo.value - 70) / 30));
      const shimmer = t > 0.5 ? Math.sin(performance.now() * 0.012) * 0.12 : 0;
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
    if (player.root.position.z < a.bounds.minZ + r) player.root.position.z = a.bounds.minZ + r;
    if (player.root.position.z > a.bounds.maxZ - r) player.root.position.z = a.bounds.maxZ - r;

    cam.update(dt);
    hud.update();
  });

  // eslint-disable-next-line no-console
  console.log(`[Rogue Hero 3] Run started: ${run.rooms.length} rooms. Backtick (\`) toggles inspector.`);
}

boot().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[Rogue Hero 3] Boot failed:", err);
});
