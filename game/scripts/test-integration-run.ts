// End-to-end integration test: walk a full 3-act run on a NullEngine.
//
// Builds the same managers as test-startup.ts plus a RunManager, then for each
// of the 9 rooms in ACT_ROOMS:
//   - load the room (arena + enemy spawns happen inside RunManager.loadRoom)
//   - tick 60 frames to settle scene state
//   - on boss rooms, wait for BOSS_INTRO_START, tick 180 frames past the intro
//   - on the BossBrawler room (act 1), drain HP to 50% and assert at least one
//     add (chaser) gets spawned via the BOSS_PHASE event handler the test
//     installs (mirroring the production handler in main.ts)
//   - drop all enemies via takeDamage(1e6), tick the dissolve out
//   - assert ROOM_CLEARED fires exactly once
//   - advance to the next room
//
// Scope: simulates the GAME LOGIC of a complete run. Does not exercise the
// player-facing GUI flows for reward/hand pickers — those have separate
// pickIndexForTest() / pickFirstNForTest() hooks the test calls directly to
// confirm the picker promise resolves correctly when commanded.
//
// Run via: `npx tsx scripts/test-integration-run.ts`.

declare const process: { exit(code?: number): never };

// Polyfills must come before any Babylon import.
import "./test-polyfills";
import "../src/engine/babylonSideEffects";

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";

import { Player } from "../src/player/Player";
import { EnemyManager } from "../src/enemies/EnemyManager";
import { HostileProjectileSystem } from "../src/combat/handlers/hostileProjectile";
import { ProjectileSystem } from "../src/combat/handlers/projectile";
import { CombatManager } from "../src/combat/CombatManager";
import { TempoSystem } from "../src/tempo/TempoSystem";
import { ItemManager } from "../src/items/ItemManager";
import { BLADE } from "../src/characters/Blade";
import { GameState } from "../src/state/GameState";
import { RunManager, ACT_ROOMS } from "../src/run/RunManager";
import { events } from "../src/engine/EventBus";
import { RewardPicker } from "../src/ui/RewardPicker";
import { CardRewardPicker } from "../src/ui/CardRewardPicker";
import { HandPicker } from "../src/ui/HandPicker";
import { ItemDefinitions } from "../src/items/ItemDefinitions";
import { CardDefinitions } from "../src/deck/CardDefinitions";

// ---- Tiny test harness ----
let failures = 0;
function check(cond: unknown, label: string): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}`);
}
function section(title: string): void { console.log(`\n[${title}]`); }

// ---- Boot a headless Babylon scene ----
const engine = new NullEngine({
  renderWidth: 512, renderHeight: 256, textureSize: 256,
  deterministicLockstep: false, lockstepMaxSteps: 1,
});
const scene = new Scene(engine);
new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
const sun = new DirectionalLight("sun", new Vector3(-0.4, -1, -0.3).normalize(), scene);
const shadow = new ShadowGenerator(512, sun);
const cam = new ArcRotateCamera("cam", Math.PI * 0.5, Math.PI * 0.4, 8, new Vector3(0, 1, 0), scene);
cam.checkCollisions = true;
cam.collisionRadius = new Vector3(0.6, 0.6, 0.6);

// ---- Construct production managers ----
const player = new Player(scene, shadow);
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
const combat = new CombatManager(scene, player);
const gs = new GameState();
gs.totalRooms = ACT_ROOMS.length;
const run = new RunManager(scene, shadow, enemies, ACT_ROOMS);

// ---- Mirror the production BOSS_PHASE → spawn-adds handler from main.ts ----
// In main.ts this lives in the BOSS_PHASE listener and spawns 2 chasers
// flanking the boss. Replicating it here lets the test assert the same
// downstream effect (enemy count grows when the phase event fires).
let bossPhaseFireCount = 0;
events.on<{ bossId: string; phase: number; spawnPos: Vector3 }>("BOSS_PHASE", ({ spawnPos }) => {
  bossPhaseFireCount++;
  const off = 4.0;
  enemies.spawn("chaser", new Vector3(spawnPos.x - off, 0, spawnPos.z));
  enemies.spawn("chaser", new Vector3(spawnPos.x + off, 0, spawnPos.z));
});

// ---- Picker hooks: confirm pickIndexForTest resolves the promise ----
section("picker test hooks");
const rewardPicker = new RewardPicker(scene);
const cardRewardPicker = new CardRewardPicker(scene);
const handPicker = new HandPicker(scene);

const sampleItems = Object.values(ItemDefinitions).slice(0, 3);
const samplePromise = rewardPicker.open(sampleItems);
rewardPicker.pickIndexForTest(0);
const sampleResult = await samplePromise;
check(sampleResult === sampleItems[0], "RewardPicker.pickIndexForTest resolves with options[0]");

const sampleCards = Object.values(CardDefinitions).slice(0, 3);
const cardPromise = cardRewardPicker.open(sampleCards);
cardRewardPicker.pickIndexForTest(1);
const cardResult = await cardPromise;
check(cardResult === sampleCards[1], "CardRewardPicker.pickIndexForTest resolves with options[1]");

const handPromise = handPicker.open(BLADE.startingDeck.map((id) => CardDefinitions[id]), [null, null, null]);
handPicker.pickFirstNForTest();
const handResult = await handPromise;
check(handResult.length === 3, "HandPicker.pickFirstNForTest resolves with 3 cards");

// ---- Helpers for the room-by-room flow ----
const dt = 1 / 60;
let frameExceptions = 0;

function tickFrames(n: number): void {
  for (let i = 0; i < n; i++) {
    try {
      enemies.update(dt, player);
      combat.update(dt);
      projectiles.update(dt);
      hostileProjectiles.update(dt);
      tempo.update(dt);
      if (run.arena?.env) run.arena.env.tick(dt);
    } catch (err) {
      frameExceptions++;
      console.error("  ✗ frame threw:", err);
    }
  }
}

/** Subscribe to `name`, run ticks until it fires or `maxTicks` elapse. */
function waitForEvent(name: string, maxTicks: number): boolean {
  let fired = false;
  const off = events.on(name, () => { fired = true; });
  for (let i = 0; i < maxTicks && !fired; i++) tickFrames(1);
  off();
  return fired;
}

function killAllAlive(): void {
  for (const e of enemies.enemies) {
    if (e.alive) e.takeDamage(1e6);
  }
}

// ---- Walk every room in the run ----
section("3-act run walkthrough");
let roomClearedTotal = 0;
events.on("ROOM_CLEARED", () => { roomClearedTotal++; });

for (let idx = 0; idx < ACT_ROOMS.length; idx++) {
  const desc = ACT_ROOMS[idx];
  console.log(`\n-- room ${idx}: ${desc.name}${desc.isBoss ? " (BOSS)" : ""} --`);

  // Park the player far from the boss spawn so no contact damage interferes.
  player.root.position.set(0, 0.85, 18);
  player.hp = player.stats.maxHp;

  // RunManager.loadRoom both disposes the previous arena/enemies AND
  // calls enemies.spawnAll(desc.spawns), so any BOSS_INTRO_START emission
  // happens synchronously inside this call.
  let bossIntroFired = false;
  const offIntro = events.on("BOSS_INTRO_START", () => { bossIntroFired = true; });
  const arena = run.loadRoom(idx);
  enemies.setPillars(arena.pillars);
  offIntro();

  check(enemies.aliveCount() === desc.spawns.length, `room ${idx} spawned ${desc.spawns.length} enemies`);
  if (desc.isBoss) {
    check(bossIntroFired, `room ${idx} fired BOSS_INTRO_START on spawn`);
  }

  // Settle: 60 frames of normal tick. Boss rooms need 180 more (3.0s intro).
  tickFrames(60);
  if (desc.isBoss) tickFrames(180);

  // Special-case BossBrawler (act 1, idx 2): exercise the phase-2 add spawn.
  if (idx === 2) {
    const boss = enemies.enemies.find((e) => e.def.name === "boss_brawler");
    check(!!boss, "BossBrawler is in the enemies list");
    if (boss) {
      const phaseFireBefore = bossPhaseFireCount;
      const aliveBefore = enemies.aliveCount();
      // Drain to just below 50% (def.hp = 220, threshold is hp <= def.hp * 0.5 = 110).
      const targetDamage = boss.hp - boss.def.hp * 0.5 + 1;
      boss.takeDamage(targetDamage);
      tickFrames(30);
      check(bossPhaseFireCount === phaseFireBefore + 1, "BossBrawler emitted BOSS_PHASE at <=50% HP");
      check(enemies.aliveCount() > aliveBefore, "BOSS_PHASE handler spawned at least one add (alive count grew)");
    }
  }

  // Damage everything to zero, then tick the dissolve out (~120 frames is the
  // window the existing startup test uses).
  killAllAlive();
  const cleared = waitForEvent("ROOM_CLEARED", 240);
  check(cleared, `room ${idx} fired ROOM_CLEARED within 240 ticks`);
  // Tick a few extra frames so all dissolves finish and the enemies array empties.
  tickFrames(60);
  check(enemies.enemies.length === 0, `room ${idx} fully cleared all enemies`);

  // Drive the appropriate picker between rooms (skip after the last room).
  // Boss rooms award a CardRewardPicker; regular rooms award a RewardPicker.
  if (idx < ACT_ROOMS.length - 1) {
    if (desc.isBoss) {
      const opts = Object.values(CardDefinitions).slice(0, 3);
      const p = cardRewardPicker.open(opts);
      cardRewardPicker.pickIndexForTest(0);
      const picked = await p;
      check(picked === opts[0], `room ${idx} card-reward picker resolved`);
    } else {
      const opts = Object.values(ItemDefinitions).slice(0, 3);
      const p = rewardPicker.open(opts);
      rewardPicker.pickIndexForTest(0);
      const picked = await p;
      check(picked === opts[0], `room ${idx} relic-reward picker resolved`);
      if (picked) items.equip(picked.id);
    }
  }
}

// ---- Final assertions ----
section("end of run");
check(run.currentIndex === ACT_ROOMS.length - 1, `currentIndex == ${ACT_ROOMS.length - 1} after final room`);
check(run.isLastRoom(), "run.isLastRoom() reports true after walking all rooms");
check(enemies.enemies.length === 0, "no enemies remain after final boss kill");
check(roomClearedTotal === ACT_ROOMS.length, `ROOM_CLEARED fired ${ACT_ROOMS.length} times (once per room)`);
check(bossPhaseFireCount === 1, "BOSS_PHASE fired exactly once across the run (BossBrawler only)");
check(frameExceptions === 0, "no frame ticks threw exceptions across the full run");

// Simulate the production "victory" phase set when last boss falls.
gs.setPhase("victory");
check(gs.phase === "victory", "GameState transitions to victory after run completion");

// ---- Tear down ----
run.arena?.dispose();
enemies.clear();
player.dispose();
combat.dispose();
projectiles.dispose();
hostileProjectiles.dispose?.();
scene.dispose();
engine.dispose();
events.clear();

console.log(`\n${failures === 0 ? "✓ integration test passed" : `✗ ${failures} integration check(s) failed`}`);
if (failures > 0) process.exit(1);
