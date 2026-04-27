import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { getQuality } from "../engine/Quality";

interface Pulse {
  mesh: Mesh;
  mat: StandardMaterial;
  ttl: number;
  initialTtl: number;
  maxRadius: number;
  startAlpha: number;
  active: boolean;
}

/**
 * Rhythmic ground pulse under the player at HOT and CRITICAL tempo. Reads as
 * a heartbeat shockwave radiating from the player's feet — sells "you are
 * powered up" continuously instead of only at the zone transition.
 *
 * Pooled (4 thin tori, additive-blended) so even tightly-spaced critical-tempo
 * pulses don't allocate. Off below HOT and entirely off on low quality.
 */
export class PlayerGroundPulse {
  private readonly POOL_SIZE = 4;
  private pool: Pulse[] = [];
  private cursor = 0;
  private accum = 0;
  private enabled: boolean;
  private warmTint = new Color3(1.0, 0.6, 0.18);
  private hotTint = new Color3(1.0, 0.35, 0.08);

  constructor(scene: Scene) {
    this.enabled = getQuality().tier !== "low";
    if (!this.enabled) return;

    for (let i = 0; i < this.POOL_SIZE; i++) {
      const ring = MeshBuilder.CreateTorus(
        `groundPulse_${i}`,
        { diameter: 2, thickness: 0.12, tessellation: 32 },
        scene,
      );
      ring.position.y = 0.05;
      ring.isPickable = false;
      ring.doNotSyncBoundingInfo = true;
      ring.setEnabled(false);
      const mat = new StandardMaterial(`groundPulseMat_${i}`, scene);
      mat.diffuseColor = this.warmTint.clone();
      mat.emissiveColor = this.warmTint.clone();
      mat.disableLighting = true;
      mat.alpha = 0.55;
      // Additive blend so multiple overlapping pulses just glow brighter
      // instead of stacking dark torus rims on top of each other.
      mat.alphaMode = 1; // BABYLON.Engine.ALPHA_ADD
      ring.material = mat;
      this.pool.push({
        mesh: ring, mat,
        ttl: 0, initialTtl: 0,
        maxRadius: 0, startAlpha: 0.55,
        active: false,
      });
    }
  }

  /**
   * Per-frame tick. Emits pulses on a tempo-driven cadence:
   *   tempo < 70:  off
   *   70-89:       1 pulse / 0.85s, warm gold, max radius 3.5m
   *   >= 90:       1 pulse / 0.55s, hot orange, max radius 4.8m, brighter
   */
  tick(dt: number, playerX: number, playerZ: number, tempoVal: number): void {
    if (!this.enabled) return;
    // Animate active pulses regardless of tempo so existing ones finish their
    // fade if the player drops out of HOT mid-pulse.
    for (const p of this.pool) {
      if (!p.active) continue;
      p.ttl -= dt;
      if (p.ttl <= 0) {
        p.active = false;
        p.mesh.setEnabled(false);
        continue;
      }
      const t = 1 - p.ttl / p.initialTtl;
      const scale = 0.6 + (p.maxRadius - 0.6) * t;
      p.mesh.scaling.x = p.mesh.scaling.z = scale;
      p.mat.alpha = p.startAlpha * (1 - t);
    }

    if (tempoVal < 70) {
      this.accum = 0;
      return;
    }
    const isCritical = tempoVal >= 90;
    const period = isCritical ? 0.55 : 0.85;
    this.accum += dt;
    if (this.accum < period) return;
    this.accum = 0;
    this.spawn(playerX, playerZ, isCritical);
  }

  private spawn(x: number, z: number, isCritical: boolean): void {
    const slot = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.POOL_SIZE;
    slot.mesh.position.x = x;
    slot.mesh.position.z = z;
    slot.mesh.scaling.x = slot.mesh.scaling.z = 0.6;
    const tint = isCritical ? this.hotTint : this.warmTint;
    slot.mat.diffuseColor.copyFrom(tint);
    slot.mat.emissiveColor.copyFrom(tint);
    slot.startAlpha = isCritical ? 0.7 : 0.5;
    slot.mat.alpha = slot.startAlpha;
    slot.maxRadius = isCritical ? 4.8 : 3.5;
    const dur = isCritical ? 0.7 : 0.9;
    slot.ttl = dur;
    slot.initialTtl = dur;
    slot.active = true;
    slot.mesh.setEnabled(true);
  }

  /** Hide all pulses and reset the cadence timer — for in-place run restart. */
  reset(): void {
    this.accum = 0;
    this.cursor = 0;
    for (const p of this.pool) {
      p.active = false;
      p.ttl = 0;
      p.mesh.setEnabled(false);
    }
  }

  dispose(): void {
    for (const p of this.pool) { p.mesh.dispose(); p.mat.dispose(); }
    this.pool.length = 0;
  }
}
