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

export const CASTER_DEF: EnemyDef = {
  name: "caster",
  hp: 28,
  speed: 1.8,
  radius: 0.55,
  contactDamage: 0,
  color: new Color3(0.6, 0.3, 0.8),
  aggroRange: 24,
};

/**
 * Stationary-ish AoE caster. When player is in range:
 *   chase briefly to reposition → telegraph (1.6s, growing red disc on the ground at player's last
 *   known location) → blast (radius damage) → cooldown (2.5s) → repeat.
 */
export class Caster extends Enemy {
  private telegraphMesh: Mesh | null = null;
  private telegraphMat: StandardMaterial | null = null;
  private telegraphRadius = 3.2;
  private telegraphDur = 1.6;
  private telegraphTimer = 0;
  private cooldown = 1.5;
  private telegraphCenter = new Vector3();

  /** Floating orb anchored above the head — sine-bobs and pulses while casting. */
  private orb!: Mesh;
  private orbMat!: StandardMaterial;

  constructor(scene: Scene, shadow: ShadowGenerator, spawnPos: Vector3, idSuffix: string) {
    // Tall conical robe: cylinder tapered toward top, 1.9m tall.
    const body = MeshBuilder.CreateCylinder(
      `caster_${idSuffix}_body`,
      { diameterTop: 0.55, diameterBottom: 1.15, height: 1.9, tessellation: 16 },
      scene,
    );
    body.position = new Vector3(0, 0.95, 0);
    super(scene, shadow, CASTER_DEF, spawnPos, body, idSuffix);
    // Floating spectre — slow, longer-amplitude lift sells the "channeling" pose.
    this.swayAmpY = 0.06;
    this.swayFreqHz = 0.55;

    // Robe hem — a flat torus at the base, sells the floating-robe read.
    const hem = MeshBuilder.CreateTorus(
      `caster_${idSuffix}_hem`,
      { diameter: 1.3, thickness: 0.14, tessellation: 20 },
      scene,
    );
    hem.position.set(0, 0.08, 0);
    this.addPart(hem, new Color3(0.4, 0.18, 0.55));

    // Hood cone on top of the body.
    const hood = MeshBuilder.CreateCylinder(
      `caster_${idSuffix}_hood`,
      { diameterTop: 0, diameterBottom: 0.6, height: 0.5, tessellation: 14 },
      scene,
    );
    hood.position.set(0, 2.15, 0);
    this.addPart(hood, new Color3(0.45, 0.22, 0.6));
    // Hood skips shadow-casting — the main robe cylinder covers the silhouette
    // on the ground already. Saves ~1 caster per caster enemy.

    // Floating orb — disableLighting so the emissive color stays punchy even in shadow.
    this.orb = MeshBuilder.CreateSphere(
      `caster_${idSuffix}_orb`,
      { diameter: 0.32, segments: 12 },
      scene,
    );
    this.orb.position.set(0.55, 2.15, 0);
    const orbRec = this.addPart(this.orb, new Color3(1.0, 0.5, 0.95), {
      disableLighting: true,
      emissive: new Color3(0.85, 0.35, 0.9),
    });
    this.orbMat = orbRec.mat;
  }

  private ensureTelegraph(): void {
    if (this.telegraphMesh) return;
    this.telegraphMesh = MeshBuilder.CreateDisc(
      `${this.id}_telegraph`,
      { radius: this.telegraphRadius, tessellation: 32 },
      this.body.getScene(),
    );
    this.telegraphMesh.rotation.x = Math.PI / 2;
    this.telegraphMat = new StandardMaterial(`${this.id}_telegraphMat`, this.body.getScene());
    this.telegraphMat.diffuseColor = new Color3(0.9, 0.2, 0.25);
    this.telegraphMat.emissiveColor = new Color3(0.5, 0.05, 0.1);
    this.telegraphMat.alpha = 0.35;
    this.telegraphMat.disableLighting = true;
    this.telegraphMat.backFaceCulling = false;
    this.telegraphMesh.material = this.telegraphMat;
    this.telegraphMesh.isVisible = false;
  }

  updateLogic(dt: number, player: Player): void {
    if (!this.alive) {
      this.disposeTelegraph();
      return;
    }
    this.tickCommon(dt);

    const dx = player.root.position.x - this.root.position.x;
    const dz = player.root.position.z - this.root.position.z;
    const distSq = dx * dx + dz * dz;
    if (distSq > this.def.aggroRange * this.def.aggroRange) {
      this.state = "idle";
      this.cooldown = Math.max(0, this.cooldown - dt);
      return;
    }

    if (this.state === "telegraph") {
      this.telegraphTimer -= dt;
      // Pulse the telegraph alpha
      if (this.telegraphMesh && this.telegraphMat) {
        const t = 1 - this.telegraphTimer / this.telegraphDur;
        this.telegraphMat.alpha = 0.25 + 0.5 * t;
        this.telegraphMesh.scaling.x = this.telegraphMesh.scaling.y = this.telegraphMesh.scaling.z =
          0.4 + 0.6 * t;
        // Orb ramps emissive intensity as the AoE commits — subliminal telegraph.
        const em = 0.5 + 0.9 * t;
        this.orbMat.emissiveColor.set(em, 0.35 * em, em * 0.95);
      }
      // Orbit the orb around the hood while casting so it reads as "channeling".
      const a = this.partClock * 5;
      this.orb.position.set(Math.cos(a) * 0.55, 2.15 + Math.sin(a * 0.7) * 0.08, Math.sin(a) * 0.55);
      if (this.telegraphTimer <= 0) {
        this.detonate(player);
        this.state = "recover";
        this.cooldown = 2.5;
        this.orbMat.emissiveColor.set(0.85, 0.35, 0.9);
      }
      return;
    }

    // Idle bob for the orb — slower, subtler.
    this.orb.position.y = 2.15 + Math.sin(this.partClock * 1.8) * 0.06;

    if (this.state === "recover" || this.cooldown > 0) {
      this.cooldown = Math.max(0, this.cooldown - dt);
      // Slowly back away from player a bit
      const dist = Math.sqrt(distSq);
      if (dist < 6 && dist > 1e-4) {
        this.root.position.x -= (dx / dist) * this.def.speed * 0.5 * dt;
        this.root.position.z -= (dz / dist) * this.def.speed * 0.5 * dt;
      }
      if (this.cooldown === 0) this.state = "chase";
      return;
    }

    // Chase to ~5m, then begin telegraph
    const dist = Math.sqrt(distSq);
    if (dist > 5 && dist > 1e-4) {
      this.state = "chase";
      this.root.position.x += (dx / dist) * this.def.speed * dt;
      this.root.position.z += (dz / dist) * this.def.speed * dt;
    } else {
      this.beginTelegraph(player);
    }
  }

  private beginTelegraph(player: Player): void {
    this.ensureTelegraph();
    if (!this.telegraphMesh) return;
    this.telegraphCenter.copyFrom(player.root.position);
    this.telegraphMesh.position.x = this.telegraphCenter.x;
    this.telegraphMesh.position.y = 0.05;
    this.telegraphMesh.position.z = this.telegraphCenter.z;
    this.telegraphMesh.isVisible = true;
    this.telegraphTimer = this.telegraphDur;
    this.state = "telegraph";
  }

  private detonate(player: Player): void {
    const dx = player.root.position.x - this.telegraphCenter.x;
    const dz = player.root.position.z - this.telegraphCenter.z;
    const r = this.telegraphRadius + player.stats.radius;
    if (dx * dx + dz * dz <= r * r && !player.isDodging) {
      events.emit("DAMAGE_TAKEN", { amount: 14, source: this.id });
    }
    if (this.telegraphMesh) this.telegraphMesh.isVisible = false;
  }

  private disposeTelegraph(): void {
    if (this.telegraphMesh) {
      this.telegraphMesh.dispose();
      this.telegraphMesh = null;
    }
    if (this.telegraphMat) {
      this.telegraphMat.dispose();
      this.telegraphMat = null;
    }
  }

  dispose(): void {
    this.disposeTelegraph();
    super.dispose();
  }
}
