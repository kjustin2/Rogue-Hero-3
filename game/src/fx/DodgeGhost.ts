import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

interface GhostCapsule {
  mesh: Mesh;
  mat: StandardMaterial;
  ttl: number;
  initialTtl: number;
}

/**
 * Dodge i-frame trail — stamps a transparent cyan capsule behind the player at a
 * fixed interval while the dodge is active, fading each out over its TTL.
 * Meshes are disposed as they expire so no long-lived allocation.
 */
export class DodgeGhosts {
  private ghosts: GhostCapsule[] = [];
  private stampTimer = 0;
  private readonly stampInterval = 0.04;

  constructor(private scene: Scene) {}

  /** Called every frame while the player is mid-dodge. */
  tickDodging(dt: number, pos: Vector3): void {
    this.stampTimer -= dt;
    if (this.stampTimer <= 0) {
      this.spawnGhost(pos);
      this.stampTimer = this.stampInterval;
    }
  }

  /** Called every frame — fades and disposes existing ghosts regardless of dodge state. */
  update(dt: number): void {
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      g.ttl -= dt;
      if (g.ttl <= 0) {
        g.mesh.dispose();
        g.mat.dispose();
        this.ghosts.splice(i, 1);
        continue;
      }
      const t = g.ttl / g.initialTtl;
      g.mat.alpha = 0.45 * t;
    }
  }

  /** Reset timer so the next dodge doesn't inherit an old stamp clock. */
  resetStamp(): void {
    this.stampTimer = 0;
  }

  private spawnGhost(pos: Vector3): void {
    const mesh = MeshBuilder.CreateCapsule(
      `dodgeGhost_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      { height: 2.0, radius: 0.5, tessellation: 10 },
      this.scene,
    );
    mesh.position.set(pos.x, pos.y + 1.0, pos.z);
    mesh.isPickable = false;
    const mat = new StandardMaterial(`${mesh.name}_mat`, this.scene);
    mat.diffuseColor = new Color3(0.3, 0.85, 1.0);
    mat.emissiveColor = new Color3(0.2, 0.7, 0.95);
    mat.disableLighting = true;
    mat.alpha = 0.45;
    mat.backFaceCulling = false;
    mesh.material = mat;
    this.ghosts.push({ mesh, mat, ttl: 0.26, initialTtl: 0.26 });
  }

  /** Drop all ghosts — for in-place run restart. */
  reset(): void {
    for (const g of this.ghosts) {
      g.mesh.dispose();
      g.mat.dispose();
    }
    this.ghosts.length = 0;
    this.stampTimer = 0;
  }
}
