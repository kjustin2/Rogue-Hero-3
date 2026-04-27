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

export const LANCER_DEF: EnemyDef = {
  name: "lancer",
  hp: 60,
  speed: 2.5,
  radius: 0.7,
  contactDamage: 0,
  color: new Color3(0.8, 0.65, 0.30),
  aggroRange: 30,
};

/**
 * Heavy ranged. Channel-charges a long beam telegraph (1.5s) along the
 * direction it's facing when the channel starts, then deals hitscan damage if
 * the player is anywhere along that line at the strike. Move slowly otherwise;
 * if the player closes the gap they break the channel by getting too close.
 */
export class Lancer extends Enemy {
  private mode: "chase" | "channel" | "recover" = "chase";
  private channelTimer = 0;
  private recoverTimer = 0;
  private readonly CHANNEL_DUR = 1.5;
  private readonly RECOVER_DUR = 1.0;
  private readonly BEAM_LEN = 18;
  private readonly BEAM_W = 1.0;
  private readonly DAMAGE = 18;
  private beam: Mesh | null = null;
  private beamMat: StandardMaterial | null = null;
  private beamDirX = 0;
  private beamDirZ = 1;

  constructor(scene: Scene, shadow: ShadowGenerator, spawnPos: Vector3, idSuffix: string) {
    const body = MeshBuilder.CreateCapsule(
      `lancer_${idSuffix}_body`,
      { height: 2.0, radius: LANCER_DEF.radius, tessellation: 12 },
      scene,
    );
    body.position = new Vector3(0, 1.0, 0);
    super(scene, shadow, LANCER_DEF, spawnPos, body, idSuffix);
    this.swayAmpY = 0.018;
    this.swayFreqHz = 0.6;

    // Tall lance held vertically — silhouette read.
    const lance = MeshBuilder.CreateBox(
      `lancer_${idSuffix}_lance`,
      { width: 0.15, height: 2.6, depth: 0.15 },
      scene,
    );
    lance.position.set(0.7, 1.2, 0);
    this.addPart(lance, new Color3(0.55, 0.4, 0.15));

    // Glowing tip on the lance — pulses while channeling.
    const tip = MeshBuilder.CreateSphere(
      `lancer_${idSuffix}_tip`,
      { diameter: 0.32, segments: 10 },
      scene,
    );
    tip.position.set(0.7, 2.4, 0);
    this.addPart(tip, new Color3(1.0, 0.7, 0.2), {
      disableLighting: true,
      emissive: new Color3(1.0, 0.55, 0.15),
    });
  }

  private ensureBeam(): void {
    if (this.beam) return;
    const sc = this.body.getScene();
    // Beam telegraph is a thin elongated box on the floor pointing forward.
    this.beam = MeshBuilder.CreateBox(
      `${this.id}_beam`,
      { width: this.BEAM_W, height: 0.04, depth: this.BEAM_LEN },
      sc,
    );
    this.beam.position = new Vector3(0, 0.025, this.BEAM_LEN / 2);
    this.beam.parent = this.root;
    const mat = new StandardMaterial(`${this.id}_beamMat`, sc);
    mat.disableLighting = true;
    mat.diffuseColor = new Color3(0, 0, 0);
    mat.emissiveColor = new Color3(1.0, 0.65, 0.2);
    mat.alpha = 0;
    this.beam.material = mat;
    this.beam.isPickable = false;
    this.beamMat = mat;
  }

  updateLogic(dt: number, player: Player): void {
    if (!this.alive) {
      if (this.beam) this.beam.isVisible = false;
      return;
    }
    this.tickCommon(dt);
    const speedMul = this.speedScale();

    const dx = player.root.position.x - this.root.position.x;
    const dz = player.root.position.z - this.root.position.z;
    const distSq = dx * dx + dz * dz;

    if (this.mode === "channel") {
      this.channelTimer -= dt;
      // Beam grows in opacity over the channel; aim is locked at channel start.
      if (this.beam && this.beamMat) {
        this.beam.isVisible = true;
        const t = 1 - this.channelTimer / this.CHANNEL_DUR;
        this.beamMat.alpha = 0.15 + 0.6 * t;
      }
      // Channel breaks if player gets very close (forces enemy to back off).
      if (distSq < 4 * 4) {
        this.mode = "recover";
        this.recoverTimer = this.RECOVER_DUR;
        if (this.beam) this.beam.isVisible = false;
        return;
      }
      if (this.channelTimer <= 0) {
        // Strike — check the player against the beam line in world space.
        const px = player.root.position.x - this.root.position.x;
        const pz = player.root.position.z - this.root.position.z;
        // Project onto beam direction.
        const along = px * this.beamDirX + pz * this.beamDirZ;
        const perpX = px - along * this.beamDirX;
        const perpZ = pz - along * this.beamDirZ;
        const perpDistSq = perpX * perpX + perpZ * perpZ;
        const inLength = along >= 0 && along <= this.BEAM_LEN;
        const halfWidth = this.BEAM_W / 2 + player.stats.radius;
        if (inLength && perpDistSq <= halfWidth * halfWidth && !player.isDodging) {
          events.emit("DAMAGE_TAKEN", { amount: this.DAMAGE, source: this.id });
        }
        this.mode = "recover";
        this.recoverTimer = this.RECOVER_DUR;
        if (this.beam) this.beam.isVisible = false;
      }
      return;
    }

    if (this.mode === "recover") {
      this.recoverTimer -= dt;
      if (this.recoverTimer <= 0) this.mode = "chase";
      return;
    }

    // Chase — slow, but close in to ~12m before channeling.
    this.state = "chase";
    const dist = Math.sqrt(distSq);
    if (dist > 12 && dist > 1e-4) {
      const nx = dx / dist;
      const nz = dz / dist;
      const step = this.def.speed * speedMul * dt;
      this.root.position.x += nx * step;
      this.root.position.z += nz * step;
    }

    // In firing range — start a channel toward the player.
    if (distSq <= 18 * 18 && distSq >= 5 * 5) {
      this.ensureBeam();
      // Lock the beam direction (rotate the root so the beam-as-child
      // points at the player). Storing the unit-vector lets us hit-test in
      // world space without re-deriving from the rotation each frame.
      const len = Math.hypot(dx, dz) || 1;
      this.beamDirX = dx / len;
      this.beamDirZ = dz / len;
      this.root.rotation.y = Math.atan2(this.beamDirX, this.beamDirZ);
      this.mode = "channel";
      this.channelTimer = this.CHANNEL_DUR;
    }
  }

  dispose(): void {
    if (this.beam) { this.beam.dispose(); this.beam = null; }
    if (this.beamMat) { this.beamMat.dispose(); this.beamMat = null; }
    super.dispose();
  }
}
