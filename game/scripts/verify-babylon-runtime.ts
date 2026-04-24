// Offline Babylon side-effect probe.
//
// Runs the same validateBabylonRuntime checks `main.ts` runs at boot, but
// against a NullEngine in Node — so `npm run verify` can catch missing
// side-effect imports before anyone has to spin up `npm run dev` and notice
// the browser console crash.
//
// Mirrors production's camera setup (ArcRotateCamera.checkCollisions = true)
// so the ArcRotateCamera._getViewMatrix → scene.collisionCoordinator path
// trips whenever `@babylonjs/core/Collisions/collisionCoordinator` is missing
// from babylonSideEffects.ts.
//
// Run via: `npx tsx scripts/verify-babylon-runtime.ts`

// Load the canonical side-effect registry first — identical to what main.ts does.
import "../src/engine/babylonSideEffects";

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

import { validateBabylonRuntime } from "../src/engine/BabylonRuntimeCheck";

const engine = new NullEngine({
  renderWidth: 256,
  renderHeight: 256,
  textureSize: 256,
  deterministicLockstep: false,
  lockstepMaxSteps: 1,
});

const scene = new Scene(engine);
const camera = new ArcRotateCamera(
  "probeCam",
  Math.PI * 0.5,
  Math.PI * 0.4,
  8,
  new Vector3(0, 1, 0),
  scene,
);
// Match FollowCamera production config so getWorldMatrix hits the collision path.
camera.checkCollisions = true;
camera.collisionRadius = new Vector3(0.6, 0.6, 0.6);

validateBabylonRuntime(scene, camera);

scene.dispose();
engine.dispose();

// eslint-disable-next-line no-console
console.log("[verify-babylon-runtime] OK — all Babylon side-effect probes passed.");
