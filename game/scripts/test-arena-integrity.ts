declare const process: { exit(code?: number): never };

import "./test-polyfills";
import "../src/engine/babylonSideEffects";

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";

import { buildArena, DOOR_OPENING_HEIGHT, ArenaOptions } from "../src/scene/ArenaBuilder";
import { ACT_ROOMS } from "../src/run/RunManager";
import { generateRunMap } from "../src/run/MapGenerator";

let failures = 0;
function check(cond: unknown, label: string): void {
  if (cond) {
    console.log(`  ok ${label}`);
    return;
  }
  failures++;
  console.error(`  fail ${label}`);
}

function visibleSolid(mesh: Mesh | null, label: string): void {
  check(!!mesh, `${label} exists`);
  if (!mesh) return;
  check(mesh.isEnabled(), `${label} enabled`);
  check(mesh.visibility > 0, `${label} visible`);
  const mat = mesh.material as StandardMaterial | null;
  check(!!mat, `${label} material`);
  if (mat) check(mat.alpha > 0.2, `${label} material alpha`);
}

function makeScene(): { engine: NullEngine; scene: Scene; shadow: ShadowGenerator } {
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
  return { engine, scene, shadow };
}

function expectedDoorCount(opts: ArenaOptions): number {
  if (opts.exitDoor === false) return 0;
  return opts.exitDoorCount ?? 1;
}

function validateArena(label: string, opts: ArenaOptions): void {
  console.log(`\n[arena] ${label}`);
  const { engine, scene, shadow } = makeScene();
  const arena = buildArena(scene, shadow, opts);
  const meshes = arena.root.getChildMeshes(false) as Mesh[];
  const byName = (name: string): Mesh | null => meshes.find((m) => m.name === name) ?? null;
  const named = (prefix: string): Mesh[] => meshes.filter((m) => m.name.startsWith(prefix));

  visibleSolid(arena.floor, "floor");
  check(!!(arena.floor.material as StandardMaterial | null)?.diffuseTexture, "floor has biome texture");

  if (opts.ceiling !== false) {
    visibleSolid(arena.ceiling, "ceiling");
    check(arena.ceiling?.checkCollisions === true, "ceiling blocks camera collision");
  } else {
    check(arena.ceiling === null, "open room has no ceiling");
  }

  for (const wallName of ["wallN", "wallE", "wallW"]) {
    const wall = byName(wallName);
    visibleSolid(wall, wallName);
    check(wall?.checkCollisions === true, `${wallName} has collision`);
  }

  const doorsExpected = expectedDoorCount(opts);
  check(arena.doors.length === doorsExpected, `door count ${doorsExpected}`);
  check(arena.doorPasses.length === doorsExpected, "door pass count matches doors");
  if (doorsExpected === 0) {
    const wall = byName("wallS");
    visibleSolid(wall, "solid south wall");
    check(wall?.checkCollisions === true, "solid south wall has collision");
  } else {
    check(named("wallS_").length >= doorsExpected + 1, "south wall segments/lintels exist");
    for (const wall of named("wallS_")) {
      visibleSolid(wall, wall.name);
      check(wall.checkCollisions === true, `${wall.name} has collision`);
    }
    for (let i = 0; i < arena.doors.length; i++) {
      const door = arena.doors[i];
      const pass = arena.doorPasses[i];
      visibleSolid(door.mesh, `door ${i}`);
      check(door.mesh.checkCollisions === true, `door ${i} starts collidable`);
      check(door.isLocked(), `door ${i} starts locked`);
      check(pass.active === false, `door ${i} pass starts inactive`);
      check(Math.abs(pass.xMin - door.xMin) < 1e-4 && Math.abs(pass.xMax - door.xMax) < 1e-4, `door ${i} pass aligns`);
      if ((opts.wallHeight ?? 4) > DOOR_OPENING_HEIGHT) {
        visibleSolid(byName(`wallS_lintel_${i}`), `door ${i} lintel`);
      }
    }
  }

  const half = (opts.size ?? 40) / 2;
  check(Math.abs(arena.bounds.minX - (-half + 0.5)) < 1e-4, "minX bound matches floor");
  check(Math.abs(arena.bounds.maxX - (half - 0.5)) < 1e-4, "maxX bound matches floor");
  check(Math.abs(arena.bounds.minZ - (-half + 0.5)) < 1e-4, "minZ bound matches floor");
  check(Math.abs(arena.bounds.maxZ - (half - 0.5)) < 1e-4, "maxZ bound matches floor");

  arena.dispose();
  scene.dispose();
  engine.dispose();
}

for (const room of ACT_ROOMS) validateArena(room.name, room.arena);

const map = generateRunMap(0x5150);
for (const node of map.nodes) {
  if (!node.descriptor) continue;
  validateArena(`map ${node.id} ${node.kind}`, {
    ...node.descriptor.arena,
    exitDoor: node.descriptor.arena.exitDoor !== false,
    exitDoorCount: 1,
  });
}

console.log(`\n${failures === 0 ? "ok arena integrity passed" : `fail ${failures} arena integrity check(s)`}`);
if (failures > 0) process.exit(1);
