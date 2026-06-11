declare const process: { exit(code?: number): never };

import "./test-polyfills";
import "../src/engine/babylonSideEffects";

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";

import { buildArena } from "../src/scene/ArenaBuilder";
import { Player } from "../src/player/Player";
import { PlayerController } from "../src/player/PlayerController";
import { TempoSystem } from "../src/tempo/TempoSystem";
import { EnemyManager } from "../src/enemies/EnemyManager";
import { HostileProjectileSystem } from "../src/combat/handlers/hostileProjectile";
import { ProjectileSystem } from "../src/combat/handlers/projectile";
import { CardCaster } from "../src/combat/CardCaster";
import { Telegraph } from "../src/fx/Telegraph";
import { CardDefinitions } from "../src/deck/CardDefinitions";
import { BLADE } from "../src/characters/Blade";
import { events } from "../src/engine/EventBus";

let failures = 0;
function check(cond: unknown, label: string): void {
  if (cond) {
    console.log(`  ok ${label}`);
    return;
  }
  failures++;
  console.error(`  fail ${label}`);
}

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

const arena = buildArena(scene, shadow, {
  size: 20,
  wallHeight: 10,
  pillarCount: 1,
  rngSeed: 101,
  ceiling: true,
  exitDoor: true,
});
const player = new Player(scene, shadow);
const tempo = new TempoSystem();
tempo.setClassPassives(BLADE.passives);
const controller = new PlayerController(player, {
  bounds: arena.bounds,
  pillars: arena.pillars,
  doorPass: arena.doorPass,
}, tempo);

const r = player.stats.radius;
console.log("\n[player bounds]");
let p = controller.resolvePosition(arena.bounds.maxX + 20, 0);
check(p.x <= arena.bounds.maxX - r + 1e-4, "east wall clamps player");
p = controller.resolvePosition(arena.bounds.minX - 20, 0);
check(p.x >= arena.bounds.minX + r - 1e-4, "west wall clamps player");
p = controller.resolvePosition(0, arena.bounds.maxZ + 20);
check(p.z <= arena.bounds.maxZ - r + 1e-4, "north wall clamps player");
p = controller.resolvePosition(0, arena.bounds.minZ - 20);
check(p.z >= arena.bounds.minZ + r - 1e-4, "locked south door clamps player");

arena.doorPass.active = true;
p = controller.resolvePosition(0, arena.bounds.minZ - 2);
check(p.z < arena.bounds.minZ, "unlocked door pass allows threshold crossing inside opening");
p = controller.resolvePosition(arena.doorPass.xMax + 2, arena.bounds.minZ - 2);
check(p.z >= arena.bounds.minZ + r - 1e-4, "unlocked door still blocks outside opening");
arena.doorPass.active = false;

if (arena.pillars[0]) {
  const pillar = arena.pillars[0];
  p = controller.resolvePosition(pillar.position.x, pillar.position.z);
  const dx = p.x - pillar.position.x;
  const dz = p.z - pillar.position.z;
  const minDist = 0.8 + r;
  check(dx * dx + dz * dz >= minDist * minDist - 1e-4, "pillar pushes player out");
}

console.log("\n[card movement]");
const hostile = new HostileProjectileSystem(scene, player);
const telegraph = new Telegraph(scene);
const enemies = new EnemyManager(scene, shadow, hostile, telegraph);
const projectiles = new ProjectileSystem(scene, enemies);
const caster = new CardCaster(player, enemies, tempo, projectiles);
caster.setMovementResolver((x, z) => controller.resolvePosition(x, z));

player.ap = player.stats.maxAp;
player.root.position.set(arena.bounds.maxX - r - 0.2, 0, 0);
player.setFacingDirection(1, 0);
check(caster.cast(CardDefinitions.dashstrike, null), "dashstrike casts near east wall");
check(player.root.position.x <= arena.bounds.maxX - r + 1e-4, "dashstrike endpoint cannot bypass east wall");

player.ap = player.stats.maxAp;
player.isDodging = false;
player.root.position.set(0, 0, arena.bounds.minZ + r + 0.2);
player.lastMoveDir.set(0, 0, -1);
check(caster.cast(CardDefinitions.phase_step, null), "phase step casts near locked south door");
check(player.root.position.z >= arena.bounds.minZ + r - 1e-4, "phase step cannot bypass locked south door");

console.log("\n[vertical dodges]");
let damageEvents = 0;
let perfectDodges = 0;
const offDamage = events.on("DAMAGE_TAKEN", () => { damageEvents++; });
const offPerfect = events.on("PERFECT_DODGE", () => { perfectDodges++; });
const tickHostile = (frames: number): void => {
  for (let i = 0; i < frames; i++) hostile.update(1 / 60);
};

player.isDodging = false;
player.root.position.set(0, 0, 0);
hostile.fire(new Vector3(-1, 0, 0), new Vector3(1, 0, 0), 4, 5, 1, {
  height: 0.35,
  hitRadius: 0.28,
  jumpClearanceY: 0.55,
});
tickHostile(30);
check(damageEvents === 1, "low projectile damages grounded player");

damageEvents = 0;
perfectDodges = 0;
hostile.reset();
player.root.position.set(0, 1.0, 0);
hostile.fire(new Vector3(-1, 0, 0), new Vector3(1, 0, 0), 4, 5, 1, {
  height: 0.35,
  hitRadius: 0.28,
  jumpClearanceY: 0.55,
});
tickHostile(30);
check(damageEvents === 0, "low projectile misses airborne player");
check(perfectDodges === 1, "jumping a low projectile rewards dodge timing");
offDamage();
offPerfect();

arena.dispose();
enemies.clear();
player.dispose();
projectiles.dispose();
hostile.dispose?.();
scene.dispose();
engine.dispose();
events.clear();

console.log(`\n${failures === 0 ? "ok player collision passed" : `fail ${failures} player collision check(s)`}`);
if (failures > 0) process.exit(1);
