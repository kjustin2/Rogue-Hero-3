import * as THREE from "three";
import { clamp01, damp, lerp } from "../core/math";

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

  private offset = new THREE.Vector3(0, 15.5, 9.6);

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

  update(dt: number): void {
    this.t += dt;

    if (this.mode === "menu") {
      this.orbitAngle += dt * 0.08;
      const r = 26;
      this.camera.position.set(
        Math.cos(this.orbitAngle) * r,
        13 + Math.sin(this.t * 0.21) * 1.2,
        Math.sin(this.orbitAngle) * r
      );
      this.camera.lookAt(0, 1.5, 0);
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
      const lead = new THREE.Vector3()
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

    // Trauma shake (perlin-ish via incommensurate sines)
    this.trauma = Math.max(0, this.trauma - dt * 1.7);
    const sh = this.trauma * this.trauma * this.shakeScale;
    const n1 = Math.sin(this.t * 47.3) + Math.sin(this.t * 29.7) * 0.6;
    const n2 = Math.sin(this.t * 41.1 + 2.1) + Math.sin(this.t * 33.9 + 0.7) * 0.6;
    const n3 = Math.sin(this.t * 53.7 + 4.2) * 0.7;
    const shakeX = n1 * sh * 0.55;
    const shakeY = n2 * sh * 0.4;
    const shakeZ = n3 * sh * 0.45;

    // Cinematic mode pulls the rig in close for drama
    this.zoom = damp(this.zoom, cine ? this.cineZoom : 1, 2.8, dt);
    this.camera.position.set(
      this.smoothed.x + this.offset.x * this.zoom + this.kickOffset.x + shakeX,
      this.offset.y * this.zoom + shakeY,
      this.smoothed.z + this.offset.z * this.zoom + this.kickOffset.z + shakeZ
    );
    this.camera.lookAt(this.smoothed.x + shakeX * 0.5, cine ? 1.6 : 0.5, this.smoothed.z + shakeZ * 0.5);

    // FOV pulse decay
    this.fovPulse = Math.max(0, this.fovPulse - dt * 3.2);
    this.camera.fov = lerp(this.baseFov, this.baseFov + 9, this.fovPulse);
    this.camera.updateProjectionMatrix();
  }
}
