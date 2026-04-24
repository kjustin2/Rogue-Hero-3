import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Enemy, EnemyDef } from "../Enemy";
import { Player } from "../../player/Player";
import { events } from "../../engine/EventBus";

export const CHASER_DEF: EnemyDef = {
  name: "chaser",
  hp: 30,
  speed: 3.2,
  radius: 0.55,
  contactDamage: 8,
  color: new Color3(0.7, 0.25, 0.25),
  aggroRange: 30,
};

/**
 * Melee chaser: runs at player; winds up for a short beat before each contact-damage swing so
 * the player can dodge or dash away.
 *
 * Lifecycle when close to player:
 *   chase → telegraph (WINDUP_DURATION, growing red ground ring + emissive flash) → strike
 *   (apply contact damage in a small tolerance radius) → cooldown → repeat.
 *
 * Previously the Chaser just dealt damage the instant it touched — no way for the player to see
 * an attack coming, which is the readability fix driven by the current feedback.
 */
export class Chaser extends Enemy {
  private contactCooldown = 0;
  private windupTimer = 0;
  private readonly WINDUP_DURATION = 0.35;
  private readonly ATTACK_RADIUS = 0.4; // how close you need to be when the strike lands
  private telegraph: Mesh | null = null;
  private telegraphMat: StandardMaterial | null = null;

  constructor(scene: Scene, shadow: ShadowGenerator, spawnPos: Vector3, idSuffix: string) {
    const body = MeshBuilder.CreateSphere(
      `chaser_${idSuffix}_body`,
      { diameter: CHASER_DEF.radius * 2, segments: 12 },
      scene,
    );
    body.position = new Vector3(0, CHASER_DEF.radius, 0);
    super(scene, shadow, CHASER_DEF, spawnPos, body, idSuffix);

    // Four radial spikes around the equator — tiny cones pointing outward.
    // Pure primitives; read as "spiky ball of malice" at distance. The spikes
    // share the chaser's dark-red tint and flash along with the body.
    const r = CHASER_DEF.radius;
    const spikeColor = new Color3(0.55, 0.15, 0.15);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const spike = MeshBuilder.CreateCylinder(
        `chaser_${idSuffix}_spike_${i}`,
        { diameterTop: 0, diameterBottom: 0.18, height: 0.42, tessellation: 6 },
        scene,
      );
      spike.position.set(Math.cos(a) * (r + 0.12), r, Math.sin(a) * (r + 0.12));
      // Rotate so +Y of the cone points radially outward (XZ plane).
      spike.rotation.z = Math.cos(a) > 0 ? Math.PI / 2 : -Math.PI / 2;
      spike.rotation.y = -a;
      this.addPart(spike, spikeColor);
      // Spikes skip shadow-casting — they're tiny and their contribution to the
      // soft-blurred 2048px shadow map isn't worth the cost per enemy × 4 parts.
    }

    // Tiny emissive core on top — a visible "eye" against the ball.
    const core = MeshBuilder.CreateSphere(
      `chaser_${idSuffix}_core`,
      { diameter: 0.18, segments: 8 },
      scene,
    );
    core.position.set(0, r + 0.3, r * 0.4);
    this.addPart(core, new Color3(1.0, 0.6, 0.3), {
      disableLighting: true,
      emissive: new Color3(1.0, 0.5, 0.15),
    });
  }

  private ensureTelegraph(): void {
    if (this.telegraph) return;
    this.telegraph = MeshBuilder.CreateDisc(
      `${this.id}_tel`,
      { radius: this.def.radius + this.ATTACK_RADIUS + 0.1, tessellation: 24 },
      this.body.getScene(),
    );
    this.telegraph.rotation.x = Math.PI / 2;
    this.telegraph.position = new Vector3(0, 0.06, 0);
    this.telegraph.parent = this.root;
    const mat = new StandardMaterial(`${this.id}_telMat`, this.body.getScene());
    mat.diffuseColor = new Color3(1, 0.15, 0.15);
    mat.emissiveColor = new Color3(0.9, 0.1, 0.1);
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mat.alpha = 0.0;
    this.telegraph.material = mat;
    this.telegraph.isVisible = false;
    this.telegraphMat = mat;
  }

  updateLogic(dt: number, player: Player): void {
    if (!this.alive) {
      if (this.telegraph) this.telegraph.isVisible = false;
      return;
    }
    this.tickCommon(dt);

    if (this.contactCooldown > 0) this.contactCooldown = Math.max(0, this.contactCooldown - dt);

    const dx = player.root.position.x - this.root.position.x;
    const dz = player.root.position.z - this.root.position.z;
    const distSq = dx * dx + dz * dz;
    const aggro = this.def.aggroRange;
    if (distSq > aggro * aggro) {
      this.state = "idle";
      if (this.telegraph) this.telegraph.isVisible = false;
      return;
    }

    const touchDist = this.def.radius + player.stats.radius;

    // Telegraph: growing red ring + emissive body pulse. Enemy holds position while winding up.
    if (this.state === "telegraph") {
      this.windupTimer -= dt;
      const t = 1 - this.windupTimer / this.WINDUP_DURATION;
      if (this.telegraph && this.telegraphMat) {
        this.telegraph.isVisible = true;
        this.telegraph.scaling.x = this.telegraph.scaling.z = 0.35 + 0.75 * t;
        this.telegraphMat.alpha = 0.3 + 0.5 * t;
      }
      // Subtle body flare — brighter red as the strike approaches.
      this.material.emissiveColor = new Color3(0.25 + 0.55 * t, 0.04, 0.04);

      if (this.windupTimer <= 0) {
        this.material.emissiveColor = new Color3(0, 0, 0);
        if (this.telegraph) this.telegraph.isVisible = false;
        // Strike: if the player is still within contact range, deal damage.
        if (distSq <= (touchDist + this.ATTACK_RADIUS) * (touchDist + this.ATTACK_RADIUS) && !player.isDodging) {
          player.hp = Math.max(0, player.hp - this.def.contactDamage);
          events.emit("DAMAGE_TAKEN", { amount: this.def.contactDamage, source: this.id });
        }
        this.contactCooldown = 0.75;
        this.state = "recover";
      }
      return;
    }

    // Chase toward player
    this.state = "chase";
    const dist = Math.sqrt(distSq);
    if (dist > 1e-4) {
      const nx = dx / dist;
      const nz = dz / dist;
      const step = this.def.speed * dt;
      this.root.position.x += nx * step;
      this.root.position.z += nz * step;
    }

    // Begin windup when we're in contact range and cooldown is ready.
    if (distSq <= touchDist * touchDist && this.contactCooldown === 0) {
      this.ensureTelegraph();
      this.state = "telegraph";
      this.windupTimer = this.WINDUP_DURATION;
    }
  }

  dispose(): void {
    if (this.telegraph) { this.telegraph.dispose(); this.telegraph = null; }
    if (this.telegraphMat) { this.telegraphMat.dispose(); this.telegraphMat = null; }
    super.dispose();
  }
}
