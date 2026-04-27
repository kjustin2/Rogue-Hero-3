import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

interface GhostSlot {
  mesh: Mesh;
  mat: StandardMaterial;
  ttl: number;
  initialTtl: number;
  active: boolean;
}

/**
 * Dodge i-frame trail — stamps a transparent cyan capsule behind the player at
 * a fixed interval while the dodge is active, fading each out over its TTL.
 *
 * Pooled: 8 capsule meshes pre-allocated at construction. A single dodge stamps
 * 4-5 ghosts in 0.18s (the player's dodge duration), so 8 covers two
 * back-to-back dodges without recycling. When all slots are busy, the oldest
 * stamp is recycled — a fresh dodge always paints visibly.
 */
export class DodgeGhosts {
  private readonly POOL_SIZE = 8;
  private pool: GhostSlot[] = [];
  private cursor = 0;
  private stampTimer = 0;
  private readonly stampInterval = 0.04;

  constructor(scene: Scene) {
    for (let i = 0; i < this.POOL_SIZE; i++) {
      const mesh = MeshBuilder.CreateCapsule(
        `dodgeGhost_${i}`,
        { height: 2.0, radius: 0.5, tessellation: 10 },
        scene,
      );
      mesh.isPickable = false;
      mesh.setEnabled(false);
      const mat = new StandardMaterial(`dodgeGhost_${i}_mat`, scene);
      mat.diffuseColor = new Color3(0.3, 0.85, 1.0);
      mat.emissiveColor = new Color3(0.2, 0.7, 0.95);
      mat.disableLighting = true;
      mat.alpha = 0.45;
      mat.backFaceCulling = false;
      mesh.material = mat;
      this.pool.push({ mesh, mat, ttl: 0, initialTtl: 0, active: false });
    }
  }

  /** Called every frame while the player is mid-dodge. */
  tickDodging(dt: number, pos: Vector3): void {
    this.stampTimer -= dt;
    if (this.stampTimer <= 0) {
      this.spawnGhost(pos);
      this.stampTimer = this.stampInterval;
    }
  }

  /** Called every frame — fades and hides expiring ghosts regardless of dodge state. */
  update(dt: number): void {
    for (const g of this.pool) {
      if (!g.active) continue;
      g.ttl -= dt;
      if (g.ttl <= 0) {
        g.active = false;
        g.mesh.setEnabled(false);
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
    // Round-robin acquire — we accept overwriting the oldest stamp when the
    // pool is saturated (rare; 8 slots cover 0.32s of continuous dodging).
    const slot = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.POOL_SIZE;
    slot.mesh.position.set(pos.x, pos.y + 1.0, pos.z);
    slot.mat.alpha = 0.45;
    slot.ttl = 0.26;
    slot.initialTtl = 0.26;
    slot.active = true;
    slot.mesh.setEnabled(true);
  }

  /** Drop all ghosts — for in-place run restart. Pool slots persist. */
  reset(): void {
    for (const g of this.pool) {
      g.active = false;
      g.ttl = 0;
      g.mesh.setEnabled(false);
    }
    this.cursor = 0;
    this.stampTimer = 0;
  }

  dispose(): void {
    for (const g of this.pool) { g.mesh.dispose(); g.mat.dispose(); }
    this.pool.length = 0;
  }
}
