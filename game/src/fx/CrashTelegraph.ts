import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CRASH_RADIUS } from "../tempo/TempoSystem";

/**
 * Ground ring telegraph that shows the player exactly where Crash will land
 * the moment it becomes available. Single torus mesh, additive blend, pulsing
 * alpha — no per-frame allocations, just a transform + alpha update each tick.
 *
 * Alpha cadence: 0.35 → 0.85 → 0.35 over ~1.0s, so the ring breathes while
 * waiting for the player to act. Color shifts toward red as more enemies are
 * within the kill zone (driven from main.ts via setEnemyDensity).
 */
export class CrashTelegraph {
  private ring: Mesh;
  private mat: StandardMaterial;
  private clock = 0;
  private visible = false;
  private density = 0;
  private readonly safeTint = new Color3(1.0, 0.65, 0.18);
  private readonly killTint = new Color3(1.0, 0.18, 0.10);

  constructor(scene: Scene) {
    // Diameter 2*CRASH_RADIUS so the *outer* edge of the visual ring matches
    // the damage radius — what the player sees is what gets hit.
    this.ring = MeshBuilder.CreateTorus(
      "crashTelegraph",
      { diameter: CRASH_RADIUS * 2, thickness: 0.18, tessellation: 64 },
      scene,
    );
    this.ring.position.y = 0.06;
    this.ring.isPickable = false;
    this.ring.doNotSyncBoundingInfo = true;
    this.ring.setEnabled(false);

    this.mat = new StandardMaterial("crashTelegraphMat", scene);
    this.mat.diffuseColor = this.safeTint.clone();
    this.mat.emissiveColor = this.safeTint.clone();
    this.mat.disableLighting = true;
    this.mat.alpha = 0.6;
    this.mat.alphaMode = 1; // ALPHA_ADD
    this.ring.material = this.mat;
  }

  /** Show or hide the ring. Called whenever crash-ready state changes. */
  setVisible(v: boolean): void {
    if (v === this.visible) return;
    this.visible = v;
    this.ring.setEnabled(v);
    if (!v) this.clock = 0;
  }

  /**
   * Number of enemies inside the kill zone (0 → infinity). Drives a color
   * lerp toward `killTint` as more enemies stack — bright red when the
   * crash will hit anything at all.
   */
  setEnemyDensity(count: number): void {
    this.density = count;
  }

  /** Per-frame update. Pass real player ground position. */
  tick(dt: number, playerX: number, playerZ: number): void {
    if (!this.visible) return;
    this.clock += dt;
    this.ring.position.x = playerX;
    this.ring.position.z = playerZ;

    // Breathing pulse — sin envelope on top of a base alpha.
    const breath = 0.5 + 0.5 * Math.sin(this.clock * Math.PI * 2);
    this.mat.alpha = 0.4 + 0.45 * breath;

    // Color shift — at density 0, full safe tint; at 1+, full kill tint.
    const t = Math.min(1, this.density / 1);
    const r = this.safeTint.r + (this.killTint.r - this.safeTint.r) * t;
    const g = this.safeTint.g + (this.killTint.g - this.safeTint.g) * t;
    const b = this.safeTint.b + (this.killTint.b - this.safeTint.b) * t;
    this.mat.diffuseColor.set(r, g, b);
    this.mat.emissiveColor.set(r, g, b);

    // Slow rotation so it doesn't read as a static decal.
    this.ring.rotation.y = this.clock * 0.6;
  }

  reset(): void {
    this.setVisible(false);
    this.density = 0;
    this.clock = 0;
  }

  dispose(): void {
    this.ring.dispose();
    this.mat.dispose();
  }
}
