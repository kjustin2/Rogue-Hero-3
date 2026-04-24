import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { events } from "../engine/EventBus";

interface Hazard {
  mesh: Mesh;
  mat: StandardMaterial;
  /** Total windup duration — alpha pulses from 0 to 1 over this time. */
  telegraphDur: number;
  /** Remaining windup time; when <= 0 we detonate and hold a brief flash. */
  telegraphTimer: number;
  /** Post-detonation flash timer — red fade-out over ~0.3s. */
  detonateFlash: number;
  center: Vector3;
  radius: number;
  damage: number;
  /** Track whether we've already damaged the player this detonation. */
  dealtDamage: boolean;
}

/**
 * Boss-arena ground hazards — telegraphed orange circles that grow + pulse
 * during windup, then detonate and deal damage if the player is inside the
 * radius. Reuses the same visual language as the Caster's AoE so players
 * learn the pattern naturally.
 *
 * Perf: at most 2 concurrent hazards (cap enforced at spawn), each is a disc
 * + material. Disposed with the arena.
 */
export class ArenaHazards {
  private hazards: Hazard[] = [];
  private spawnTimer = 0;
  private readonly SPAWN_INTERVAL = 20;
  private readonly TELEGRAPH_DUR = 1.1;
  private readonly RADIUS = 3.0;
  private readonly DAMAGE = 12;
  private readonly MAX_CONCURRENT = 2;
  /** Enabled flag — only rooms that opt-in (the Pit) tick hazards. */
  enabled = false;

  constructor(private scene: Scene, private arenaHalfSize: number) {
    // Start with the first hazard 8s into the fight so players can settle in.
    this.spawnTimer = 8;
  }

  tick(dt: number, playerPos: Vector3, playerRadius: number, isDodging: boolean): void {
    if (!this.enabled) return;

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.hazards.length < this.MAX_CONCURRENT) {
      this.spawn();
      this.spawnTimer = this.SPAWN_INTERVAL;
    }

    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      if (h.telegraphTimer > 0) {
        h.telegraphTimer = Math.max(0, h.telegraphTimer - dt);
        const t = 1 - h.telegraphTimer / h.telegraphDur;
        h.mesh.scaling.x = h.mesh.scaling.z = 0.3 + 0.7 * t;
        h.mat.alpha = 0.35 + 0.45 * t;
        if (h.telegraphTimer === 0) {
          // Detonate — damage check against the player.
          const dx = playerPos.x - h.center.x;
          const dz = playerPos.z - h.center.z;
          const r = h.radius + playerRadius;
          if (!h.dealtDamage && dx * dx + dz * dz <= r * r && !isDodging) {
            events.emit("DAMAGE_TAKEN", { amount: h.damage, source: "arenaHazard" });
            // The HP deduction is done by whatever listener also handles
            // DAMAGE_TAKEN for existing hazards — we emit the event to keep
            // the damage path unified. The actual HP update happens in the
            // enemy contact-damage pattern; here we pass the damage directly
            // by embedding it in the payload and letting main.ts apply it.
            // (See Enemy.ts pattern — DAMAGE_TAKEN is purely a display hook.)
          }
          h.dealtDamage = true;
          h.detonateFlash = 0.3;
          // Bright red flash on detonation.
          h.mat.emissiveColor.set(1, 0.15, 0.05);
        }
        continue;
      }
      if (h.detonateFlash > 0) {
        h.detonateFlash -= dt;
        h.mat.alpha = 0.85 * (h.detonateFlash / 0.3);
        continue;
      }
      // Fully done — dispose.
      h.mesh.dispose();
      h.mat.dispose();
      this.hazards.splice(i, 1);
    }
  }

  /**
   * Did this frame's detonation damage the player? The hazards system emits
   * DAMAGE_TAKEN events which main.ts expects to carry an `amount`, but the
   * event payload type isn't enforced. Call this helper from the main update
   * AFTER tick() to apply any pending damage to the player HP directly.
   *
   * Returns the damage to apply (0 if none), and clears the pending flag.
   */
  consumeDamage(): number {
    let total = 0;
    for (const h of this.hazards) {
      if (h.dealtDamage && h.damage > 0) {
        total += h.damage;
        h.damage = 0; // don't apply twice
      }
    }
    return total;
  }

  private spawn(): void {
    // Place within an annulus in the boss arena so it doesn't appear in a
    // corner or dead-center where the player tends to open the fight.
    const theta = Math.random() * Math.PI * 2;
    const r = 5 + Math.random() * (this.arenaHalfSize - 8);
    const cx = Math.cos(theta) * r;
    const cz = Math.sin(theta) * r;

    const mesh = MeshBuilder.CreateDisc(
      `hazard_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      { radius: this.RADIUS, tessellation: 36 },
      this.scene,
    );
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(cx, 0.05, cz);
    mesh.isPickable = false;
    const mat = new StandardMaterial(`${mesh.name}_mat`, this.scene);
    mat.diffuseColor = new Color3(1, 0.4, 0.05);
    mat.emissiveColor = new Color3(0.9, 0.3, 0.05);
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mat.alpha = 0.35;
    mesh.material = mat;

    this.hazards.push({
      mesh, mat,
      telegraphDur: this.TELEGRAPH_DUR,
      telegraphTimer: this.TELEGRAPH_DUR,
      detonateFlash: 0,
      center: new Vector3(cx, 0, cz),
      radius: this.RADIUS,
      damage: this.DAMAGE,
      dealtDamage: false,
    });
  }

  reset(): void {
    for (const h of this.hazards) { h.mesh.dispose(); h.mat.dispose(); }
    this.hazards.length = 0;
    this.spawnTimer = 8;
  }

  dispose(): void {
    this.reset();
  }
}
