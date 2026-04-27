import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { dampCoeff } from "../util/Smoothing";

/**
 * 1D value noise — smooth interpolation between deterministic random values
 * keyed on a continuous input. Unlike Math.random() per frame, this produces
 * a temporally-coherent wobble that reads as "heavy impact" rather than static.
 * Three samplers with coprime frequencies give uncorrelated axes.
 */
function hash1(n: number): number {
  // cheap integer hash → [-1, 1]
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}
function valueNoise1D(t: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const a = hash1(i);
  const b = hash1(i + 1);
  // smoothstep interpolation
  const u = f * f * (3 - 2 * f);
  return a + (b - a) * u;
}

/**
 * Third-person over-the-shoulder rig.
 * Built on ArcRotateCamera (mouse drag = orbit) with the player as the locked target.
 * Camera lerps toward target each frame so movement feels smooth, not glued.
 *
 * Optional enemy "focus" target — when set, the camera's pivot biases toward the
 * player→enemy midpoint so both actors stay framed. The shift is capped so a
 * distant enemy can't drag the camera off the player.
 */
export interface FollowCameraRig {
  camera: ArcRotateCamera;
  setTarget(t: TransformNode): void;
  /** Set or clear the enemy focus target. Null goes back to pure player follow. */
  setFocus(t: TransformNode | null): void;
  /** Kick the camera — stacks with existing shake, magnitude in meters. */
  shake(magnitude: number, duration?: number): void;
  /** Lerp FOV to a target value; pass null target to return to the default. */
  setFovTarget(fov: number | null, speed?: number): void;
  /**
   * Rotate the camera's alpha (yaw around the player) so the given world
   * point is framed between the player and the camera. Used when the player
   * cycles target lock — the camera visibly swings to put the new enemy on
   * screen. Lerped over a few frames; cleared once close enough to target.
   */
  orientToward(worldX: number, worldZ: number): void;
  /**
   * Start an "orbit a fixed world point" mode — used for the boss kill-cam.
   * The camera pivots around `center` at `radius`, rotating at `angVel` rad/sec
   * for `duration` seconds, then snaps back to following the player target.
   * Does not restore alpha — caller is expected to re-grab player focus.
   */
  startKillCam(center: Vector3, radius: number, angVel: number, duration: number): void;
  /** Call each frame after target moves */
  update(dt: number): void;
  dispose(): void;
}

// Max distance the camera pivot can drift away from the player toward the focus target.
// Kept small so far-away enemies don't yank the camera across the arena.
const FOCUS_BIAS = 0.35;   // fraction of player→focus vector
const FOCUS_MAX_OFFSET = 3;  // meters

export function createFollowCamera(scene: Scene, canvas: HTMLCanvasElement): FollowCameraRig {
  // alpha = π/2 places the camera on +Z of the target; player spawns facing −Z so this puts the
  // rig over the player's shoulder looking into the arena. Wall clipping is handled via spawn
  // placement in main.ts plus cam.checkCollisions below.
  const cam = new ArcRotateCamera(
    "followCam",
    Math.PI * 0.5,
    Math.PI * 0.42,       // beta (pitch) — slightly above
    8,                    // radius — slightly closer; camera collisions keep it off walls
    new Vector3(0, 1, 0),
    scene,
  );
  cam.lowerRadiusLimit = 4;
  cam.upperRadiusLimit = 16;
  cam.lowerBetaLimit = 0.2;
  // Never let the rig pitch high enough to graze the new stone ceiling — at
  // radius 8 with target y≈1.2, beta=π*0.46 (~83°) keeps the camera under
  // ~9.7m even in the largest room (10–12m ceiling). Wall/ceiling collisions
  // catch any leftover edge cases.
  cam.upperBetaLimit = Math.PI * 0.46;
  cam.wheelDeltaPercentage = 0.02;
  cam.angularSensibilityX = 900;
  cam.angularSensibilityY = 900;
  cam.minZ = 0.1;
  cam.maxZ = 200;
  // Camera collisions — with checkCollisions on walls, the camera slides along/inside them
  // instead of being occluded by the arena perimeter.
  cam.checkCollisions = true;
  cam.collisionRadius = new Vector3(0.6, 0.6, 0.6);
  cam.attachControl(canvas, true);

  // Orbit moved off RMB so right-click can cycle the selected card. MMB drag orbits the rig.
  // LMB stays reserved for the primary attack (playing the selected card).
  const pointers = cam.inputs.attached.pointers as { buttons?: number[] } | undefined;
  if (pointers) pointers.buttons = [1];

  // Remove the arrow-key orbit handler — arrow keys are used for player movement, and having
  // both consumers fight over the same input makes the camera swing erratically.
  cam.inputs.removeByType("ArcRotateCameraKeyboardMoveInput");

  // Soft lerp target vs hard lock
  const desiredTarget = new Vector3(0, 1.2, 0);
  let trackedNode: TransformNode | null = null;
  let focusNode: TransformNode | null = null;

  // Transient shake — `shakeAmp` decays linearly to zero over `shakeTime`, and
  // each frame the target is nudged by a random XZ offset scaled by the remaining amplitude.
  // Multiple shakes stack by taking the max of the remaining amplitude.
  const SHAKE_MAX = 0.35;
  let shakeAmp = 0;
  let shakeTime = 0;
  let shakeTotal = 0;

  // FOV lerp — set by `setFovTarget(fov, speed)`. Speed is 1/sec lerp rate.
  const defaultFov = cam.fov;
  let fovTarget: number | null = null;
  let fovSpeed = 2;

  // Alpha (yaw) lerp — drives the target-switch swing. When the player hits Q
  // the camera lerps toward `alphaTarget` at `alphaLerpRate` per second.
  let alphaTarget: number | null = null;
  const ALPHA_LERP_RATE = 7; // 1/sec — snaps in ~150ms feel

  // Kill-cam state — when `killCamTimer` > 0, the update loop ignores the
  // follow target and instead orbits `killCamCenter` at `killCamRadius`.
  let killCamTimer = 0;
  let killCamCenter = new Vector3();
  let killCamRadius = 10;
  let killCamAngVel = 0.8; // rad/sec
  let killCamAngle = 0;

  return {
    camera: cam,
    setTarget(t: TransformNode) {
      trackedNode = t;
      desiredTarget.copyFrom(t.position);
      desiredTarget.y += 1.2;
      cam.setTarget(desiredTarget.clone());
    },
    setFocus(t: TransformNode | null) {
      focusNode = t;
    },
    shake(magnitude: number, duration = 0.28) {
      const amp = Math.min(SHAKE_MAX, Math.max(0, magnitude));
      // If a stronger shake is already active, keep it. Otherwise replace — stacking
      // by summation just produces nausea during rapid-fire hits.
      if (amp > shakeAmp) {
        shakeAmp = amp;
        shakeTime = duration;
        shakeTotal = duration;
      }
    },
    setFovTarget(fov: number | null, speed = 2) {
      fovTarget = fov;
      fovSpeed = speed;
    },
    orientToward(worldX: number, worldZ: number) {
      if (!trackedNode) return;
      // We want the camera behind the player relative to the target direction.
      // In Babylon's ArcRotateCamera, alpha=π/2 places the camera on +Z of the
      // target (looking toward -Z). Thus to look toward world direction (dx,dz)
      // from the player, the camera has to sit at the OPPOSITE side — world
      // angle π + atan2(dx, dz). We translate that into Babylon's alpha axis
      // which measures from +X rotating toward +Z.
      const dx = worldX - trackedNode.position.x;
      const dz = worldZ - trackedNode.position.z;
      if (dx * dx + dz * dz < 1e-4) return;
      // Camera should sit on the line player→target, on the opposite side.
      // Azimuth of target from player, in Babylon's alpha (0 = +X, increases toward +Z):
      const targetAlpha = Math.atan2(dz, dx) + Math.PI;
      alphaTarget = targetAlpha;
    },
    startKillCam(center: Vector3, radius: number, angVel: number, duration: number) {
      killCamCenter = center.clone();
      killCamRadius = radius;
      killCamAngVel = angVel;
      killCamTimer = duration;
      killCamAngle = cam.alpha;
      // Keep the beta (pitch) as-is; the orbit motion is purely in alpha.
    },
    update(dt: number) {
      // Kill-cam override — drives the target + alpha directly, ignoring the
      // tracked player. Runs its own short arc then releases to normal follow.
      if (killCamTimer > 0) {
        killCamTimer = Math.max(0, killCamTimer - dt);
        killCamAngle += killCamAngVel * dt;
        cam.alpha = killCamAngle;
        cam.radius = killCamRadius;
        const t = cam.target as Vector3;
        const kk = dampCoeff(6, dt);
        t.x += (killCamCenter.x - t.x) * kk;
        t.y += (killCamCenter.y + 1.2 - t.y) * kk;
        t.z += (killCamCenter.z - t.z) * kk;
        return;
      }

      if (!trackedNode) return;
      desiredTarget.copyFrom(trackedNode.position);
      desiredTarget.y += 1.2;
      if (focusNode) {
        // Shift the pivot a capped distance toward the focus node so the locked
        // enemy stays visible without losing the player from the frame.
        let dx = focusNode.position.x - trackedNode.position.x;
        let dz = focusNode.position.z - trackedNode.position.z;
        const len = Math.hypot(dx, dz);
        if (len > 1e-3) {
          let off = Math.min(len * FOCUS_BIAS, FOCUS_MAX_OFFSET);
          dx = (dx / len) * off;
          dz = (dz / len) * off;
          desiredTarget.x += dx;
          desiredTarget.z += dz;
        }
      }
      const t = cam.target as Vector3;
      // dampCoeff keeps the follow rate constant in wall-clock time regardless
      // of refresh rate. At 60Hz this lands on ≈0.181 — near-identical to the
      // old `dt*12` clamp of 0.2 — but stays stable at 144Hz+ instead of
      // over-lerping.
      const k = dampCoeff(12, dt);
      t.x += (desiredTarget.x - t.x) * k;
      t.y += (desiredTarget.y - t.y) * k;
      t.z += (desiredTarget.z - t.z) * k;

      if (shakeTime > 0) {
        shakeTime = Math.max(0, shakeTime - dt);
        const remaining = shakeTotal > 0 ? shakeTime / shakeTotal : 0;
        const s = shakeAmp * remaining * remaining; // ease-out
        // Value-noise shake — three coprime frequencies give uncorrelated
        // XYZ wobble that reads as "heavy impact" rather than the jittery
        // hash Math.random() produced. The `performance.now()` seeds each
        // axis so a new shake doesn't visibly restart the waveform.
        const nowMs = performance.now();
        t.x += valueNoise1D(nowMs * 0.028) * s;        // ~28 Hz
        t.y += valueNoise1D(nowMs * 0.034 + 71.3) * s * 0.5; // ~34 Hz, offset seed
        t.z += valueNoise1D(nowMs * 0.024 + 137.1) * s;      // ~24 Hz, offset seed
        if (shakeTime === 0) shakeAmp = 0;
      }

      // FOV lerp toward `fovTarget` (or default if null). Step per-second lerp
      // lands on the target smoothly — useful for the boss-phase zoom beat.
      const tgt = fovTarget ?? defaultFov;
      if (Math.abs(cam.fov - tgt) > 0.001) {
        cam.fov += (tgt - cam.fov) * dampCoeff(fovSpeed, dt);
      }

      // Alpha lerp — "swing to new target" feel when the player hits Q. Wraps
      // around the short way (handling the 2π seam) so we never take the long
      // route around the orbit.
      if (alphaTarget !== null) {
        let diff = alphaTarget - cam.alpha;
        diff = ((diff + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
        const step = diff * dampCoeff(ALPHA_LERP_RATE, dt);
        cam.alpha += step;
        if (Math.abs(diff) < 0.02) alphaTarget = null;
      }
    },
    dispose() {
      cam.dispose();
    },
  };
}
