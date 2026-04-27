import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { getQuality } from "../engine/Quality";

interface Firefly {
  mesh: Mesh;
  mat: StandardMaterial;
  centerX: number;
  centerZ: number;
  centerY: number;
  radius: number;
  angle: number;
  angleSpeed: number;
  bobPhase: number;
  bobSpeed: number;
  pulsePhase: number;
}

/**
 * Floating warm-yellow point sprites scattered around the arena. Each fly
 * orbits its own random center at a unique speed/radius and bobs vertically
 * so the swarm looks alive rather than synchronized.
 *
 * Quality gates count: 0 on low, 4 on medium, 8 on high.
 *
 * The boss room toggles them off via setEnabled(false) since the dramatic
 * lighting calls for emptier air; verdant rooms turn them back on.
 */
export class Fireflies {
  private flies: Firefly[] = [];
  private enabled = true;
  private active: boolean;

  constructor(scene: Scene, arenaSize: number) {
    const q = getQuality();
    this.active = q.tier !== "low";
    if (!this.active) return;

    const count = q.tier === "high" ? 8 : 4;
    const half = arenaSize / 2 - 2;
    for (let i = 0; i < count; i++) {
      const mesh = MeshBuilder.CreateDisc(`firefly_${i}`, { radius: 0.09, tessellation: 12 }, scene);
      // Billboard so the sprite always faces the camera regardless of orbit.
      mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
      mesh.isPickable = false;
      mesh.doNotSyncBoundingInfo = true;
      const mat = new StandardMaterial(`firefly_${i}_mat`, scene);
      mat.diffuseColor = new Color3(1.0, 0.95, 0.55);
      mat.emissiveColor = new Color3(1.0, 0.85, 0.45);
      mat.disableLighting = true;
      mat.alpha = 0.9;
      mesh.material = mat;
      this.flies.push({
        mesh, mat,
        centerX: (Math.random() * 2 - 1) * half,
        centerZ: (Math.random() * 2 - 1) * half,
        centerY: 1.4 + Math.random() * 1.2,
        radius: 0.6 + Math.random() * 1.0,
        angle: Math.random() * Math.PI * 2,
        // 50/50 clockwise vs counter-clockwise — visually unsynchronized.
        angleSpeed: (0.4 + Math.random() * 0.5) * (Math.random() < 0.5 ? -1 : 1),
        bobPhase: Math.random() * Math.PI * 2,
        bobSpeed: 0.8 + Math.random() * 0.6,
        pulsePhase: Math.random() * Math.PI * 2,
      });
    }
  }

  /** Per-frame update — orbits + alpha pulse. No-ops on low quality. */
  tick(dt: number): void {
    if (!this.active || !this.enabled) return;
    for (const f of this.flies) {
      f.angle += f.angleSpeed * dt;
      f.bobPhase += f.bobSpeed * dt;
      f.pulsePhase += dt * 1.4;
      f.mesh.position.x = f.centerX + Math.cos(f.angle) * f.radius;
      f.mesh.position.z = f.centerZ + Math.sin(f.angle) * f.radius;
      f.mesh.position.y = f.centerY + Math.sin(f.bobPhase) * 0.22;
      // Soft asymmetric pulse — abs(sin) gives a sharper "blink" that reads as a
      // firefly's tail, not a steady glow.
      f.mat.alpha = 0.5 + 0.45 * Math.abs(Math.sin(f.pulsePhase));
    }
  }

  /** Toggle visibility — boss room calls setEnabled(false). */
  setEnabled(on: boolean): void {
    this.enabled = on;
    for (const f of this.flies) f.mesh.setEnabled(on && this.active);
  }

  dispose(): void {
    for (const f of this.flies) { f.mesh.dispose(); f.mat.dispose(); }
    this.flies.length = 0;
  }
}
