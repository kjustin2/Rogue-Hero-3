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

export const ELITE_DEF: EnemyDef = {
  name: "elite",
  hp: 75,
  speed: 2.6,
  radius: 0.85,
  contactDamage: 15,
  color: new Color3(0.85, 0.55, 0.1),
  aggroRange: 32,
};

/**
 * Beefier melee. Charges player with brief windup, slams. Armored: takes 50% damage.
 * (RH2 elite "armored" modifier port — half-damage incoming.)
 */
export class Elite extends Enemy {
  private contactCooldown = 0;
  private chargeWindup = 0;
  private chargeActive = 0;
  private chargeDir = new Vector3(0, 0, 1);
  private chargeRest = 2.5;
  private readonly CHARGE_TELEGRAPH_LEN = 5.0;
  private telegraphBar: Mesh | null = null;
  private telegraphMat: StandardMaterial | null = null;

  constructor(scene: Scene, shadow: ShadowGenerator, spawnPos: Vector3, idSuffix: string) {
    const body = MeshBuilder.CreateBox(
      `elite_${idSuffix}_body`,
      { width: ELITE_DEF.radius * 2, height: 2.1, depth: ELITE_DEF.radius * 2 },
      scene,
    );
    body.position = new Vector3(0, 1.05, 0);
    super(scene, shadow, ELITE_DEF, spawnPos, body, idSuffix);
    // Heavy armor — barely-perceptible weight shift; turned off during the charge attack.
    this.swayAmpY = 0.014;
    this.swayFreqHz = 0.45;

    // Armor plates — shoulders + helmet, darker gold-brass tint on the armored silhouette.
    const armor = new Color3(0.55, 0.38, 0.10);

    const shoulderL = MeshBuilder.CreateBox(
      `elite_${idSuffix}_shL`,
      { width: 0.6, height: 0.4, depth: ELITE_DEF.radius * 2.1 },
      scene,
    );
    shoulderL.position.set(-ELITE_DEF.radius - 0.15, 1.85, 0);
    this.addPart(shoulderL, armor);
    shadow.addShadowCaster(shoulderL);

    const shoulderR = MeshBuilder.CreateBox(
      `elite_${idSuffix}_shR`,
      { width: 0.6, height: 0.4, depth: ELITE_DEF.radius * 2.1 },
      scene,
    );
    shoulderR.position.set(ELITE_DEF.radius + 0.15, 1.85, 0);
    this.addPart(shoulderR, armor);
    shadow.addShadowCaster(shoulderR);

    const helmet = MeshBuilder.CreateBox(
      `elite_${idSuffix}_helm`,
      { width: 0.85, height: 0.55, depth: 0.85 },
      scene,
    );
    helmet.position.set(0, 2.35, 0);
    this.addPart(helmet, armor);
    shadow.addShadowCaster(helmet);

    // Two slit visor bars — emissive red, sells the "armored charger" threat read.
    const visor = MeshBuilder.CreateBox(
      `elite_${idSuffix}_visor`,
      { width: 0.5, height: 0.06, depth: 0.05 },
      scene,
    );
    visor.position.set(0, 2.38, 0.42);
    this.addPart(visor, new Color3(1, 0.2, 0.05), {
      disableLighting: true,
      emissive: new Color3(1, 0.2, 0.05),
    });
  }

  private ensureTelegraph(): void {
    if (this.telegraphBar) return;
    this.telegraphBar = MeshBuilder.CreateBox(
      `${this.id}_chargeBar`,
      { width: ELITE_DEF.radius * 2.2, height: 0.05, depth: 1.0 },
      this.body.getScene(),
    );
    const mat = new StandardMaterial(`${this.id}_chargeMat`, this.body.getScene());
    mat.diffuseColor = new Color3(1.0, 0.45, 0.05);
    mat.emissiveColor = new Color3(0.95, 0.4, 0.08);
    mat.alpha = 0.75;
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    this.telegraphBar.material = mat;
    this.telegraphBar.isVisible = false;
    this.telegraphMat = mat;
  }

  takeDamage(amount: number): void {
    super.takeDamage(amount * 0.5); // armored
  }

  updateLogic(dt: number, player: Player): void {
    if (!this.alive) return;
    this.tickCommon(dt);

    if (this.contactCooldown > 0) this.contactCooldown = Math.max(0, this.contactCooldown - dt);
    if (this.chargeRest > 0) this.chargeRest = Math.max(0, this.chargeRest - dt);

    const dx = player.root.position.x - this.root.position.x;
    const dz = player.root.position.z - this.root.position.z;
    const distSq = dx * dx + dz * dz;
    if (distSq > this.def.aggroRange * this.def.aggroRange) {
      this.state = "idle";
      return;
    }

    // Charge attack windup at medium range
    if (this.state !== "telegraph" && this.state !== "attack" && distSq < 8 * 8 && distSq > 3 * 3 && this.chargeRest === 0) {
      this.chargeWindup = 0.45;
      this.state = "telegraph";
    }

    // Disable idle sway while telegraphing or charging — body.scaling is being
    // animated and the root Y bob would fight it. Re-enabled by tickCommon
    // automatically next frame when state returns to chase/recover.
    this.swayActive = this.state !== "telegraph" && this.state !== "attack";

    if (this.state === "telegraph") {
      this.chargeWindup -= dt;
      const d = Math.sqrt(distSq);
      if (d > 1e-4) {
        this.chargeDir.x = dx / d;
        this.chargeDir.z = dz / d;
      }
      const t = 1 - this.chargeWindup / 0.45;
      // body pulse + emissive red flare so the enemy visibly "charges up"
      this.body.scaling.x = this.body.scaling.z = 1 + 0.25 * t;
      // Mutate the existing emissive in place — was allocating a fresh
      // Color3 every frame for the entire telegraph window.
      this.material.emissiveColor.set(0.2 + 0.6 * t, 0.08, 0.02);

      // Ground bar along the charge line so the player can SEE where the charge will go.
      this.ensureTelegraph();
      if (this.telegraphBar && this.telegraphMat) {
        const halfLen = this.CHARGE_TELEGRAPH_LEN / 2;
        this.telegraphBar.position.x = this.root.position.x + this.chargeDir.x * halfLen;
        this.telegraphBar.position.y = 0.07;
        this.telegraphBar.position.z = this.root.position.z + this.chargeDir.z * halfLen;
        this.telegraphBar.rotation.y = Math.atan2(this.chargeDir.x, this.chargeDir.z);
        this.telegraphBar.scaling.z = this.CHARGE_TELEGRAPH_LEN;
        this.telegraphBar.scaling.x = 0.8 + 0.4 * t;
        this.telegraphBar.isVisible = true;
        this.telegraphMat.alpha = 0.5 + 0.4 * t;
      }

      if (this.chargeWindup <= 0) {
        if (this.telegraphBar) this.telegraphBar.isVisible = false;
        this.material.emissiveColor.set(0, 0, 0);
        this.state = "attack";
        this.chargeActive = 0.4;
      }
      return;
    }

    if (this.state === "attack") {
      this.chargeActive -= dt;
      // Charge forward fast
      const chargeSpeed = this.def.speed * 3.2;
      this.root.position.x += this.chargeDir.x * chargeSpeed * dt;
      this.root.position.z += this.chargeDir.z * chargeSpeed * dt;
      // Contact damage
      const touchDist = this.def.radius + player.stats.radius;
      if (distSq <= touchDist * touchDist && this.contactCooldown === 0 && !player.isDodging) {
        player.hp = Math.max(0, player.hp - this.def.contactDamage);
        events.emit("DAMAGE_TAKEN", { amount: this.def.contactDamage, source: this.id });
        this.contactCooldown = 0.7;
      }
      if (this.chargeActive <= 0) {
        this.state = "recover";
        this.body.scaling.x = this.body.scaling.z = 1;
        this.chargeRest = 1.6;
      }
      return;
    }

    // Default chase
    this.state = "chase";
    const dist = Math.sqrt(distSq);
    if (dist > 1e-4) {
      this.root.position.x += (dx / dist) * this.def.speed * dt;
      this.root.position.z += (dz / dist) * this.def.speed * dt;
    }
    const touchDist = this.def.radius + player.stats.radius;
    if (distSq <= touchDist * touchDist && this.contactCooldown === 0 && !player.isDodging) {
      player.hp = Math.max(0, player.hp - this.def.contactDamage);
      events.emit("DAMAGE_TAKEN", { amount: this.def.contactDamage, source: this.id });
      this.contactCooldown = 0.7;
    }
  }

  dispose(): void {
    if (this.telegraphBar) { this.telegraphBar.dispose(); this.telegraphBar = null; }
    if (this.telegraphMat) { this.telegraphMat.dispose(); this.telegraphMat = null; }
    super.dispose();
  }
}
