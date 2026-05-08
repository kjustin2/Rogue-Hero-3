import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Enemy, EnemyDef } from "../Enemy";
import { Player } from "../../player/Player";
import { events } from "../../engine/EventBus";

export const MIRROR_DEF: EnemyDef = {
  name: "mirror",
  hp: 80,
  speed: 1.5,
  radius: 0.7,
  contactDamage: 10,
  color: new Color3(0.78, 0.85, 0.92),
  aggroRange: 26,
};

/**
 * Slow tank with a refraction shield. Walks at the player; when first dropped
 * to ≤50% HP, raises a shield (cyan glow + halo bubble) that *absorbs all
 * damage* for 2.5s. Player's only options are to kite, save big cooldowns, or
 * spend the window setting up positional advantage. Once the shield drops the
 * Mirror takes damage normally.
 *
 * Single-use shield per life — no infinite cycles. Forces the player to commit
 * burst damage to push past the threshold.
 */
export class Mirror extends Enemy {
  private contactCooldown = 0;
  private shieldUsed = false;
  private shielding = 0;
  private static readonly SHIELD_DURATION = 2.5;

  private halo!: Mesh;

  constructor(scene: Scene, shadow: ShadowGenerator, spawnPos: Vector3, idSuffix: string) {
    const body = MeshBuilder.CreateCylinder(
      `mirror_${idSuffix}_body`,
      { diameterTop: 1.0, diameterBottom: 1.5, height: 1.9, tessellation: 14 },
      scene,
    );
    body.position = new Vector3(0, 0.95, 0);
    super(scene, shadow, MIRROR_DEF, spawnPos, body, idSuffix);
    this.swayAmpY = 0.025;
    this.swayFreqHz = 0.32;

    // Plate "armor" sphere on top — reads as a heavy, polished construct.
    const head = MeshBuilder.CreateSphere(
      `mirror_${idSuffix}_head`,
      { diameter: 0.8, segments: 14 },
      scene,
    );
    head.position.set(0, 2.1, 0);
    this.addPart(head, new Color3(0.65, 0.72, 0.80));
    shadow.addShadowCaster(head);

    // Shield bubble — pre-built but invisible until the shield activates.
    this.halo = MeshBuilder.CreateSphere(
      `mirror_${idSuffix}_halo`,
      { diameter: 2.4, segments: 16 },
      scene,
    );
    this.halo.position.set(0, 1.2, 0);
    const haloRec = this.addPart(this.halo, new Color3(0.4, 0.85, 1.0), {
      disableLighting: true,
      emissive: new Color3(0.5, 0.9, 1.0),
    });
    haloRec.mat.alpha = 0.0;
    this.halo.isVisible = false;
  }

  override takeDamage(amount: number): void {
    // Shielded: absorb everything. Body still flashes via the parent flow if
    // we delegate, but we want a "ping" feedback; emit ENEMY_HIT manually for
    // the SFX without HP loss.
    if (this.shielding > 0) {
      events.emit("ENEMY_HIT", {
        enemyId: this.id,
        x: this.root.position.x,
        y: this.root.position.y + 1,
        z: this.root.position.z,
        amount: 0,
        killed: false,
        isBoss: false,
      });
      return;
    }
    // First drop to ≤50% HP raises the one-time shield. Apply the damage that
    // brought us here (so the threshold *is* crossed), then activate the shield
    // for the next interval.
    super.takeDamage(amount);
    if (!this.shieldUsed && this.alive && this.hp <= this.def.hp * 0.5) {
      this.shieldUsed = true;
      this.shielding = Mirror.SHIELD_DURATION;
      this.halo.isVisible = true;
      const haloMat = this.extraParts[this.extraParts.length - 1].mat;
      haloMat.alpha = 0.55;
    }
  }

  updateLogic(dt: number, player: Player): void {
    if (!this.alive) return;
    this.tickCommon(dt);

    if (this.contactCooldown > 0) this.contactCooldown = Math.max(0, this.contactCooldown - dt);

    if (this.shielding > 0) {
      this.shielding = Math.max(0, this.shielding - dt);
      if (this.shielding === 0) {
        this.halo.isVisible = false;
        const haloMat = this.extraParts[this.extraParts.length - 1].mat;
        haloMat.alpha = 0.0;
      } else {
        // Pulse the halo alpha while active so the visual reads as "active barrier".
        const haloMat = this.extraParts[this.extraParts.length - 1].mat;
        const pulse = 0.45 + 0.35 * Math.abs(Math.sin(this.partClock * 7));
        haloMat.alpha = pulse;
      }
    }

    const dx = player.root.position.x - this.root.position.x;
    const dz = player.root.position.z - this.root.position.z;
    const distSq = dx * dx + dz * dz;
    if (distSq > this.def.aggroRange * this.def.aggroRange) {
      this.state = "idle";
      return;
    }

    const dist = Math.sqrt(distSq);
    const touch = this.def.radius + player.stats.radius;
    if (dist > touch && dist > 1e-4) {
      this.state = "chase";
      const step = this.def.speed * this.speedScale() * dt;
      this.root.position.x += (dx / dist) * step;
      this.root.position.z += (dz / dist) * step;
    } else if (this.contactCooldown === 0) {
      if (!player.isDodging) {
        events.emit("DAMAGE_TAKEN", { amount: this.def.contactDamage, source: this.id });
        this.contactCooldown = 1.0;
      } else if (player.tryConsumePerfectDodge()) {
        events.emit("PERFECT_DODGE", {});
      }
    }
  }
}
