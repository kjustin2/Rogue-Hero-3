// Offline "does the game boot without throwing" test.
//
// Builds a NullEngine scene + all the major production systems (arena, enemies,
// player, combat, tempo, deck, item manager, projectiles) and ticks a handful
// of frames. Any side-effect missing from babylonSideEffects.ts, any bad
// construction path, or any un-plumbed event hook blows up here instead of in
// the browser.
//
// Scope: construction + N-frame ticks, not full gameplay simulation. For the
// end-to-end run sequence, see test-flow.ts (if/when it's added).
//
// Run via: `npx tsx scripts/test-startup.ts`.

// Minimal node shim so we avoid pulling in @types/node just for `process.exit`.
declare const process: { exit(code?: number): never };

// Install OffscreenCanvas + 2D-canvas stubs before Babylon imports so
// DynamicTexture creation under NullEngine doesn't crash on `new OffscreenCanvas`.
import "./test-polyfills";

import "../src/engine/babylonSideEffects";

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";

import { buildArena, VERDANT_ENV_PALETTE } from "../src/scene/ArenaBuilder";
import { Player } from "../src/player/Player";
import { EnemyManager } from "../src/enemies/EnemyManager";
import { HostileProjectileSystem } from "../src/combat/handlers/hostileProjectile";
import { ProjectileSystem } from "../src/combat/handlers/projectile";
import { CombatManager } from "../src/combat/CombatManager";
import { CardCaster } from "../src/combat/CardCaster";
import { TempoSystem } from "../src/tempo/TempoSystem";
import { CardDefinitions } from "../src/deck/CardDefinitions";
import { ItemManager } from "../src/items/ItemManager";
import { BLADE } from "../src/characters/Blade";
import { GameState } from "../src/state/GameState";
import { VERTICAL_SLICE_ROOMS } from "../src/run/RunManager";

let failures = 0;
function check(cond: unknown, label: string): void {
  if (cond) return;
  failures++;
  // eslint-disable-next-line no-console
  console.error(`  ✗ ${label}`);
}

// ---------- Build a headless Babylon scene ----------
const engine = new NullEngine({
  renderWidth: 512,
  renderHeight: 256,
  textureSize: 256,
  deterministicLockstep: false,
  lockstepMaxSteps: 1,
});
const scene = new Scene(engine);

new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
const sun = new DirectionalLight("sun", new Vector3(-0.4, -1, -0.3).normalize(), scene);
const shadow = new ShadowGenerator(512, sun);

const cam = new ArcRotateCamera("cam", Math.PI * 0.5, Math.PI * 0.4, 8, new Vector3(0, 1, 0), scene);
cam.checkCollisions = true;
cam.collisionRadius = new Vector3(0.6, 0.6, 0.6);

// ---------- Managers ----------
// eslint-disable-next-line no-console
console.log("[test-startup] constructing managers");

const player = new Player(scene, shadow);
check(!!player.root, "player.root exists");
check(!!player.body, "player.body exists");
check(!!player.head, "humanoid player has a head");
check(!!player.sword, "humanoid player has a sword");

const hostileProjectiles = new HostileProjectileSystem(scene, player);
const enemies = new EnemyManager(scene, shadow, hostileProjectiles);
const projectiles = new ProjectileSystem(scene, enemies);
const tempo = new TempoSystem();
tempo.setClassPassives(BLADE.passives);
const items = new ItemManager(tempo);
tempo.itemHooks = {
  shouldDecay: (v) => items.shouldDecay(v),
  crashResetOverride: () => items.crashResetOverride(),
};
const caster = new CardCaster(player, enemies, tempo, projectiles);
const combat = new CombatManager(scene, player);
const gs = new GameState();
gs.totalRooms = VERTICAL_SLICE_ROOMS.length;

// ---------- Build the first arena + spawn its enemies ----------
const roomDesc = VERTICAL_SLICE_ROOMS[0];
const arena = buildArena(scene, shadow, { ...roomDesc.arena, envPalette: roomDesc.arena.envPalette ?? VERDANT_ENV_PALETTE });
check(!!arena.root, "arena.root built");
check(arena.pillars.length === roomDesc.arena.pillarCount, "arena has the expected pillar count");
check(!!arena.env, "arena owns an env bundle");
check(arena.bounds.maxX > arena.bounds.minX, "arena bounds.maxX > minX");
check(arena.bounds.maxZ > arena.bounds.minZ, "arena bounds.maxZ > minZ");

enemies.setPillars(arena.pillars);
enemies.spawnAll(roomDesc.spawns);
check(enemies.enemies.length === roomDesc.spawns.length, "enemies spawned for room 0");
check(enemies.aliveCount() === roomDesc.spawns.length, "all spawned enemies are alive");

// ---------- Tick a few frames ----------
// eslint-disable-next-line no-console
console.log("[test-startup] ticking 60 frames");
const dt = 1 / 60;
let exceptions = 0;
for (let i = 0; i < 60; i++) {
  try {
    enemies.update(dt, player);
    combat.update(dt);
    projectiles.update(dt);
    hostileProjectiles.update(dt);
    tempo.update(dt);
    if (arena.env) arena.env.tick(dt);
  } catch (err) {
    exceptions++;
    // eslint-disable-next-line no-console
    console.error(`  ✗ frame ${i} threw:`, err);
  }
}
check(exceptions === 0, "60 update frames ticked without throwing");

// ---------- Cast every card once — verifies CardCaster dispatch table ----------
player.ap = player.stats.maxAp;
for (const id of Object.keys(CardDefinitions)) {
  const card = CardDefinitions[id];
  const aimPoint = new Vector3(1, 0, 1);
  try {
    // Aerial cards require the player to be airborne — lift them for the cast.
    const wasGroundY = player.root.position.y;
    if (card.requiresAirborne) player.root.position.y = 1.0;
    const before = player.ap;
    const ok = caster.cast(card, aimPoint);
    check(ok, `caster.cast("${id}") succeeded`);
    check(player.ap <= before, `AP decreased (or held) after casting "${id}"`);
    // Reset Y + AP for the next card.
    player.root.position.y = wasGroundY;
    player.verticalVelocity = 0;
    player.aerialSlamming = false;
    player.pendingAerialCardId = null;
    player.ap = player.stats.maxAp;
  } catch (err) {
    failures++;
    // eslint-disable-next-line no-console
    console.error(`  ✗ caster.cast("${id}") threw:`, err);
  }
}

// ---------- Flow sim: damage everything, watch for ROOM_CLEARED ----------
// Import the event bus lazily so we can assert ROOM_CLEARED fires exactly
// once when all enemies are gone. The event handler is registered before we
// nuke enemy HP so we catch the emission.
import { events } from "../src/engine/EventBus";
let roomClearedCount = 0;
events.on("ROOM_CLEARED", () => { roomClearedCount++; });

for (const e of enemies.enemies) e.takeDamage(1000);
// Tick past the dissolve duration so enemies finish cleaning up + the
// room-cleared emission fires from the EnemyManager.
for (let i = 0; i < 120; i++) {
  try {
    enemies.update(dt, player);
  } catch (err) {
    failures++;
    // eslint-disable-next-line no-console
    console.error(`  ✗ dissolve frame ${i} threw:`, err);
  }
}
check(enemies.enemies.length === 0, "all enemies disposed after dissolve");
check(roomClearedCount === 1, "ROOM_CLEARED fired exactly once after wipe");

// ---------- Tear down ----------
arena.dispose();
enemies.clear();
player.dispose();
combat.dispose();
projectiles.dispose();
hostileProjectiles.dispose?.();
scene.dispose();
engine.dispose();

// eslint-disable-next-line no-console
console.log(`\n${failures === 0 ? "✓ startup test passed" : `✗ ${failures} startup check(s) failed`}`);
if (failures > 0) process.exit(1);
