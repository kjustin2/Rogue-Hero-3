import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Enemy, EnemyDef } from "../Enemy";
import { Player } from "../../player/Player";
import { events } from "../../engine/EventBus";

export const SWARMER_DEF: EnemyDef = {
  name: "swarmer",
  hp: 12,
  speed: 5.5,
  radius: 0.35,
  contactDamage: 6,
  color: new Color3(0.85, 0.35, 0.20),
  aggroRange: 28,
};

/**
 * Tiny, fast melee. Movement vector is base chase + perlin-style jitter so a
 * pack reads as a swarm, not a line. Damages on touch with a brief cooldown
 * so multiple swarmers can't combine into a single instant burst.
 */
export class Swarmer extends Enemy {
  private contactCooldown = 0;
  private jitterPhase = Math.random() * Math.PI * 2;
  private jitterFreq = 4 + Math.random() * 2;

  constructor(scene: Scene, shadow: ShadowGenerator, spawnPos: Vector3, idSuffix: string) {
    const body = MeshBuilder.CreateSphere(
      `swarmer_${idSuffix}_body`,
      { diameter: SWARMER_DEF.radius * 2, segments: 10 },
      scene,
    );
    body.position = new Vector3(0, SWARMER_DEF.radius, 0);
    super(scene, shadow, SWARMER_DEF, spawnPos, body, idSuffix);
    // Energetic skitter — tighter, faster bob than Chaser.
    this.swayAmpY = 0.06;
    this.swayFreqHz = 2.4;

    // Three short antennae for skittery silhouette.
    const antColor = new Color3(0.55, 0.20, 0.10);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const ant = MeshBuilder.CreateCylinder(
        `swarmer_${idSuffix}_ant_${i}`,
        { diameterTop: 0, diameterBottom: 0.06, height: 0.3, tessellation: 4 },
        scene,
      );
      ant.position.set(Math.cos(a) * 0.1, SWARMER_DEF.radius * 1.6, Math.sin(a) * 0.1);
      ant.rotation.z = Math.cos(a) * 0.5;
      ant.rotation.x = Math.sin(a) * 0.5;
      this.addPart(ant, antColor);
    }
  }

  updateLogic(dt: number, player: Player): void {
    if (!this.alive) return;
    this.tickCommon(dt);

    if (this.contactCooldown > 0) this.contactCooldown = Math.max(0, this.contactCooldown - dt);

    const dx = player.root.position.x - this.root.position.x;
    const dz = player.root.position.z - this.root.position.z;
    const distSq = dx * dx + dz * dz;
    if (distSq > this.def.aggroRange * this.def.aggroRange) {
      this.state = "idle";
      return;
    }

    this.state = "chase";
    const dist = Math.sqrt(distSq);
    if (dist > 1e-4) {
      const nx = dx / dist;
      const nz = dz / dist;
      // Erratic jitter — small perpendicular wobble whose phase drifts per-frame.
      const t = this.partClock * this.jitterFreq + this.jitterPhase;
      const wobble = Math.sin(t) * 0.55;
      const px = -nz; // perp (left-of)
      const pz = nx;
      const step = this.def.speed * this.speedScale() * dt;
      this.root.position.x += (nx + px * wobble) * step;
      this.root.position.z += (nz + pz * wobble) * step;
    }

    // Contact damage on touch (with short cooldown to keep swarms tunable).
    const touchDist = this.def.radius + player.stats.radius;
    if (distSq <= touchDist * touchDist && this.contactCooldown === 0 && !player.isDodging) {
      events.emit("DAMAGE_TAKEN", { amount: this.def.contactDamage, source: this.id });
      this.contactCooldown = 0.55;
    }
  }
}
