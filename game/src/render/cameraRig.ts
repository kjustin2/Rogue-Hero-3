import * as THREE from "three";
import { clamp01, damp, lerp } from "../core/math";

// Reused scratch for the per-frame aim-lead so the follow path allocates nothing.
const _lead = new THREE.Vector3();

// Must track menus.ts's fov slider max — speed pull-back (#49) never pushes the
// effective FOV past the player's own ceiling.
const FOV_SETTINGS_MAX = 62;

/**
 * Trauma-based follow camera. Shake intensity is trauma², so small hits whisper
 * and big hits roar. Directional kicks shove the camera opposite to impacts.
 */
export class CameraRig {
  /** What the camera chases (player during runs, arena center in menus). */
  readonly target = new THREE.Vector3();
  /** Fraction of the way toward the aim point the camera leads (0 = none). */
  lookAhead = 0.22;
  aimPoint = new THREE.Vector3();

  private trauma = 0;
  private kickVel = new THREE.Vector3();
  private kickOffset = new THREE.Vector3();
  private smoothed = new THREE.Vector3();
  private fovPulse = 0;
  private baseFov = 50;
  private t = 0;
  private orbitAngle = 0;
  /** "menu" orbits the arena; "follow" chases the target; "cinematic" dollies to a point. */
  mode: "follow" | "menu" | "cinematic" = "menu";
  shakeScale = 1;
  private cineTarget = new THREE.Vector3();
  private cineZoom = 0.62;
  private zoom = 1;
  // Cinematic language (#45): flat, near-eye-level framing blended in during a cinematic
  // hold (instead of just shrinking the steep gameplay offset), plus a slow angular drift
  // around the dolly target. cineDrift only advances while a cinematic shot is blended in.
  private cineFlatOffset = new THREE.Vector3(0, 3.4, 5.6);
  private cineBlend = 0;
  private cineDrift = 0;
  // Menu-orbit framing: wide arena sweep by default; heroOrbit() pulls it in
  // close for the victory beauty shot. Reset via menuOrbit().
  private orbitCenter = new THREE.Vector3();
  private orbitRadius = 26;
  private orbitHeight = 13;
  private orbitLookY = 1.5;

  private offset = new THREE.Vector3(0, 15.5, 9.6);
  // Speed pull-back (#49) / tempo framing (#46): damped FOV + dolly deltas driven by
  // setSpeed()/setTempo(), released back to zero at rest / low tempo.
  private speedFrac = 0;
  private tempoFrac = 0;
  private speedFov = 0;
  private speedZoomOff = 0;
  private tempoFov = 0;
  private tempoZoomOff = 0;
  // Dutch-roll kick (#50): scalar spring on the camera's up-tilt, same shape as the
  // kickVel/kickOffset positional spring below.
  private rollVel = 0;
  private rollAngle = 0;

  constructor(private camera: THREE.PerspectiveCamera) {
    this.baseFov = camera.fov;
    this.smoothed.copy(this.target);
  }

  addTrauma(amount: number): void {
    this.trauma = clamp01(this.trauma + amount);
  }

  /** Directional shove, e.g. away from a hit. */
  kick(dirX: number, dirZ: number, strength: number): void {
    this.kickVel.x += dirX * strength;
    this.kickVel.z += dirZ * strength;
  }

  /** Momentary FOV widen — dashes, crashes. */
  pulseFov(amount: number): void {
    this.fovPulse = Math.max(this.fovPulse, amount);
  }

  /** Player FOV preference (degrees) — the resting FOV the rig pulses around. */
  setBaseFov(deg: number): void {
    this.baseFov = deg;
  }

  /** Speed pull-back (#49): 0 at rest, 1 at full pace. Widens FOV + dollies out, damped. */
  setSpeed(frac: number): void {
    this.speedFrac = clamp01(frac);
  }

  /** Tempo framing (#46): 0 cold, 1 at max tempo. Narrows FOV + dollies in, damped. */
  setTempo(frac: number): void {
    this.tempoFrac = clamp01(frac);
  }

  /** Dutch-roll kick (#50) — small camera.up tilt (radians) that springs back in ~150-200ms. */
  kickRoll(amount: number): void {
    this.rollVel += amount;
  }

  snapTo(x: number, z: number): void {
    this.target.set(x, 0, z);
    this.smoothed.copy(this.target);
  }

  /** Dolly toward a world point, pulled in close — boss entrances. */
  cinematic(x: number, z: number, zoom = 0.62): void {
    this.mode = "cinematic";
    this.cineTarget.set(x, 0, z);
    this.cineZoom = zoom;
  }

  /** Default wide arena orbit for menus. */
  menuOrbit(): void {
    this.mode = "menu";
    this.orbitCenter.set(0, 0, 0);
    this.orbitRadius = 26;
    this.orbitHeight = 13;
    this.orbitLookY = 1.5;
  }

  /** Slow, close orbit around a world point — the victory beauty shot. */
  heroOrbit(x: number, z: number): void {
    this.mode = "menu";
    this.orbitCenter.set(x, 0, z);
    this.orbitRadius = 8;
    this.orbitHeight = 3.6;
    this.orbitLookY = 1.2;
  }

  update(dt: number): void {
    this.t += dt;

    if (this.mode === "menu") {
      this.camera.up.set(0, 1, 0); // guard against a dutch-roll left mid-spring from combat
      this.orbitAngle += dt * 0.08;
      const r = this.orbitRadius;
      this.camera.position.set(
        this.orbitCenter.x + Math.cos(this.orbitAngle) * r,
        this.orbitHeight + Math.sin(this.t * 0.21) * r * 0.046,
        this.orbitCenter.z + Math.sin(this.orbitAngle) * r
      );
      this.camera.lookAt(this.orbitCenter.x, this.orbitLookY, this.orbitCenter.z);
      this.camera.fov = damp(this.camera.fov, this.baseFov, 4, dt);
      this.camera.updateProjectionMatrix();
      return;
    }

    // Follow with aim lead — or a slow dolly to the cinematic target
    const cine = this.mode === "cinematic";
    let dx: number;
    let dz: number;
    if (cine) {
      dx = this.cineTarget.x;
      dz = this.cineTarget.z;
    } else {
      const lead = _lead
        .subVectors(this.aimPoint, this.target)
        .multiplyScalar(this.lookAhead);
      lead.clampLength(0, 4.5);
      dx = this.target.x + lead.x;
      dz = this.target.z + lead.z;
    }
    const rate = cine ? 2.6 : 7;
    this.smoothed.x = damp(this.smoothed.x, dx, rate, dt);
    this.smoothed.z = damp(this.smoothed.z, dz, rate, dt);

    // Kick spring (no per-frame allocation)
    this.kickVel.multiplyScalar(Math.exp(-9 * dt));
    this.kickOffset.addScaledVector(this.kickVel, dt);
    this.kickOffset.multiplyScalar(Math.exp(-7 * dt));

    // Dutch-roll spring (#50) — same shape as the kick spring above, but a scalar tilt
    // angle instead of a vector. Decays to ~0 in about 150-200ms.
    this.rollVel *= Math.exp(-16 * dt);
    this.rollAngle += this.rollVel * dt;
    this.rollAngle *= Math.exp(-14 * dt);
    const roll = this.rollAngle * this.shakeScale; // gated by shake/reduce-motion (#51)

    // Trauma shake (perlin-ish via incommensurate sines)
    this.trauma = Math.max(0, this.trauma - dt * 1.7);
    const sh = this.trauma * this.trauma * this.shakeScale;
    const n1 = Math.sin(this.t * 47.3) + Math.sin(this.t * 29.7) * 0.6;
    const n2 = Math.sin(this.t * 41.1 + 2.1) + Math.sin(this.t * 33.9 + 0.7) * 0.6;
    const n3 = Math.sin(this.t * 53.7 + 4.2) * 0.7;
    const shakeX = n1 * sh * 0.55;
    const shakeY = n2 * sh * 0.4;
    const shakeZ = n3 * sh * 0.45;

    // Idle handheld sway (#48) — tiny always-on drift at frequencies well below the shake
    // noise above, so a stationary follow cam never reads as locked-off. Reduce Motion
    // silences it via shakeScale, same as the shake.
    let swayX = 0;
    let swayY = 0;
    let swayZ = 0;
    if (!cine) {
      swayX = (Math.sin(this.t * 1.7) + Math.sin(this.t * 2.3 + 1.3) * 0.5) * 0.02 * this.shakeScale;
      swayY = Math.sin(this.t * 1.1 + 0.6) * 0.015 * this.shakeScale;
      swayZ = (Math.sin(this.t * 2.9 + 2.4) + Math.sin(this.t * 0.7 + 0.2) * 0.5) * 0.02 * this.shakeScale;
    }

    // Speed pull-back (#49) / tempo framing (#46) — both damp toward zero during a
    // cinematic hold so they never fight the dolly-to-target framing below.
    const speedTarget = cine ? 0 : this.speedFrac;
    this.speedFov = damp(this.speedFov, speedTarget * 2.5, 6, dt);
    this.speedZoomOff = damp(this.speedZoomOff, speedTarget * 0.045, 6, dt);
    const tempoTarget = cine ? 0 : this.tempoFrac;
    this.tempoFov = damp(this.tempoFov, tempoTarget * 4.5, 3, dt);
    this.tempoZoomOff = damp(this.tempoZoomOff, tempoTarget * 0.08, 3, dt);
    const lifeZoom = 1 + this.speedZoomOff - this.tempoZoomOff;

    // Cinematic mode pulls the rig in close for drama
    this.zoom = damp(this.zoom, cine ? this.cineZoom : 1, 2.8, dt);

    // Cinematic language (#45) — blend from the steep gameplay offset (scaled by zoom and
    // the speed/tempo dolly) toward a flatter, near-eye-level offset that slowly drifts
    // around the dolly target for the hold, rather than just shrinking the steep offset.
    this.cineBlend = damp(this.cineBlend, cine ? 1 : 0, 3.5, dt);
    if (cine) this.cineDrift += dt * 0.06;
    const flatZ = this.cineFlatOffset.z;
    const driftX = -flatZ * Math.sin(this.cineDrift);
    const driftZ = flatZ * Math.cos(this.cineDrift);
    const steepZoom = this.zoom * lifeZoom;
    const offX = lerp(this.offset.x * steepZoom, driftX, this.cineBlend);
    const offY = lerp(this.offset.y * steepZoom, this.cineFlatOffset.y, this.cineBlend);
    const offZ = lerp(this.offset.z * steepZoom, driftZ, this.cineBlend);

    this.camera.position.set(
      this.smoothed.x + offX + this.kickOffset.x * this.shakeScale + shakeX + swayX,
      offY + shakeY + swayY,
      this.smoothed.z + offZ + this.kickOffset.z * this.shakeScale + shakeZ + swayZ
    );

    if (Math.abs(roll) > 0.0005) {
      this.camera.up.set(Math.sin(roll), Math.cos(roll), 0);
    } else {
      this.camera.up.set(0, 1, 0); // settled — snap back exactly, no float creep
    }
    this.camera.lookAt(this.smoothed.x + shakeX * 0.5, cine ? 1.6 : 0.5, this.smoothed.z + shakeZ * 0.5);

    // FOV pulse decay, layered under the speed/tempo framing and gated by shakeScale (#51)
    this.fovPulse = Math.max(0, this.fovPulse - dt * 3.2);
    const speedFovCapped = Math.min(this.speedFov, Math.max(0, FOV_SETTINGS_MAX - this.baseFov));
    const framedFov = this.baseFov + speedFovCapped - this.tempoFov;
    this.camera.fov = lerp(framedFov, framedFov + 9 * this.shakeScale, this.fovPulse);
    this.camera.updateProjectionMatrix();
  }
}
