import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Enemy, EnemyDef } from "../Enemy";
import { Player } from "../../player/Player";
import { HostileProjectileSystem } from "../../combat/handlers/hostileProjectile";

export const SHOOTER_DEF: EnemyDef = {
  name: "shooter",
  hp: 22,
  speed: 2.4,
  radius: 0.5,
  contactDamage: 0,
  color: new Color3(0.3, 0.5, 0.85),
  aggroRange: 28,
};

/**
 * Ranged enemy. Tries to maintain ~10m from player.
 * Fires a slow telegraphed projectile every ~1.8s.
 */
export class Shooter extends Enemy {
  private fireTimer = 1.2;
  private kiteRange = 10;
  private kiteHysteresis = 1.5;
  /** Bow pivot — parented to root, yawed to face the player each frame. */
  private bowPivot: Mesh;
  /** Reused fire-direction buffer so each shot doesn't allocate a Vector3. */
  private fireDirBuf = new Vector3();

  constructor(
    scene: Scene,
    shadow: ShadowGenerator,
    spawnPos: Vector3,
    idSuffix: string,
    private projectiles: HostileProjectileSystem,
  ) {
    const body = MeshBuilder.CreateCapsule(
      `shooter_${idSuffix}_body`,
      { height: 1.6, radius: SHOOTER_DEF.radius, tessellation: 12 },
      scene,
    );
    body.position = new Vector3(0, 0.8, 0);
    super(scene, shadow, SHOOTER_DEF, spawnPos, body, idSuffix);
    // Light archer — small steady breathing bob while sighting.
    this.swayAmpY = 0.022;
    this.swayFreqHz = 0.85;

    // A small head cap so the capsule reads as "torso + head" rather than one lump.
    const head = MeshBuilder.CreateSphere(
      `shooter_${idSuffix}_head`,
      { diameter: 0.45, segments: 10 },
      scene,
    );
    head.position.set(0, 1.7, 0);
    this.addPart(head, new Color3(0.20, 0.35, 0.6));
    shadow.addShadowCaster(head);

    // Bow assembly — vertical thin box (bow body) + a horizontal arrow box.
    // Parented to a container that rotates to face the player each update, so
    // the ranged identity reads from silhouette, not colour.
    this.bowPivot = new Mesh(`shooter_${idSuffix}_bowPivot`, scene);
    this.bowPivot.parent = this.root;
    this.bowPivot.position.set(0, 1.1, 0);

    const bow = MeshBuilder.CreateBox(
      `shooter_${idSuffix}_bow`,
      { width: 0.08, height: 1.3, depth: 0.08 },
      scene,
    );
    bow.position.set(0.55, 0, 0); // held out to the enemy's right
    bow.parent = this.bowPivot;
    const bowMat = new StandardMaterial(`shooter_${idSuffix}_bowMat`, scene);
    bowMat.diffuseColor = new Color3(0.35, 0.22, 0.12);
    bow.material = bowMat;
    // Bow + arrow skip shadow casting — the capsule + head already cast the
    // dominant silhouette, and these are thin strips that would barely register
    // after the shadow blur kernel anyway.
    this.extraParts.push({ mesh: bow, mat: bowMat, baseColor: bowMat.diffuseColor.clone() });

    const arrow = MeshBuilder.CreateBox(
      `shooter_${idSuffix}_arrow`,
      { width: 0.08, height: 0.08, depth: 0.85 },
      scene,
    );
    arrow.position.set(0.55, 0, 0.35); // out the front of the bow
    arrow.parent = this.bowPivot;
    const arrowMat = new StandardMaterial(`shooter_${idSuffix}_arrowMat`, scene);
    arrowMat.diffuseColor = new Color3(0.8, 0.7, 0.3);
    arrowMat.emissiveColor = new Color3(0.35, 0.3, 0.1);
    arrowMat.disableLighting = true;
    arrow.material = arrowMat;
    this.extraParts.push({ mesh: arrow, mat: arrowMat, baseColor: arrowMat.diffuseColor.clone() });
  }

  updateLogic(dt: number, player: Player): void {
    if (!this.alive) return;
    this.tickCommon(dt);

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
      // Kite: move toward player if too far, away if too close
      let moveDir = 0;
      if (dist > this.kiteRange + this.kiteHysteresis) moveDir = 1;
      else if (dist < this.kiteRange - this.kiteHysteresis) moveDir = -1;
      const step = this.def.speed * dt * moveDir;
      this.root.position.x += nx * step;
      this.root.position.z += nz * step;
      // Face the player with the bow so the silhouette tracks intent.
      this.bowPivot.rotation.y = Math.atan2(nx, nz);
    }

    // Fire timer
    this.fireTimer -= dt;
    if (this.fireTimer <= 0 && distSq < 22 * 22) {
      this.fireTimer = 1.8;
      const origin = this.root.position;
      this.fireDirBuf.set(dx, 0, dz);
      this.projectiles.fire(origin, this.fireDirBuf, 11, 7, 2.5);
    }
  }
}
