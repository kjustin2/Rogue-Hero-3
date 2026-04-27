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

export const BRAWLER_DEF: EnemyDef = {
  name: "boss_brawler",
  hp: 220,
  speed: 3.4,
  radius: 1.4,
  contactDamage: 9,
  color: new Color3(0.85, 0.18, 0.10),
  aggroRange: 60,
};

/**
 * Boss Brawler — port of rogue-hero-2 Enemy.js BossBrawler.
 *
 * FSM:
 *   chase  → walks at player, melee on touch
 *   dash_telegraph → 0.5s windup with growing red ring
 *   dash → fast charge along locked direction for 0.3s, big damage on contact
 *   recover → 0.6s rest
 *
 * Phase 2: at 50% HP, emits BOSS_PHASE for the spawner to drop two chasers.
 */
export class BossBrawler extends Enemy {
  private dashTimer = 3.5;
  private dashTelegraphTimer = 0;
  private dashActiveTimer = 0;
  private dashDir = new Vector3(0, 0, 1);
  private contactCooldown = 0;
  private hasSplit = false;
  private telegraphBar: Mesh | null = null;
  private telegraphMat: StandardMaterial | null = null;
  private readonly dashTelegraphLength = 6.0;
  private fistL!: Mesh;
  private fistR!: Mesh;
  /** Intro animation — body rises from a kneeling crouch over `introDuration`. */
  introTimer = 3.0;
  introDuration = 3.0;
  /** Display name shown by the banner during intro. Subclasses override. */
  bossDisplayName = "BRAWLER OF THE PIT";

  constructor(scene: Scene, shadow: ShadowGenerator, spawnPos: Vector3, idSuffix: string) {
    const body = MeshBuilder.CreateCylinder(
      `brawler_${idSuffix}_body`,
      { diameterTop: BRAWLER_DEF.radius * 1.6, diameterBottom: BRAWLER_DEF.radius * 2.2, height: 2.6, tessellation: 18 },
      scene,
    );
    body.position = new Vector3(0, 1.3, 0);
    super(scene, shadow, BRAWLER_DEF, spawnPos, body, idSuffix);
    // Imposing slow shift — reads as a heavy creature breathing. Off during dash.
    this.swayAmpY = 0.03;
    this.swayFreqHz = 0.38;

    // Two massive fist cubes flanking the body — read as the primary threat.
    const fistColor = new Color3(0.7, 0.12, 0.06);
    this.fistL = MeshBuilder.CreateBox(
      `brawler_${idSuffix}_fistL`,
      { width: 1.0, height: 1.0, depth: 1.3 },
      scene,
    );
    this.fistL.position.set(-BRAWLER_DEF.radius - 0.7, 1.3, 0);
    this.addPart(this.fistL, fistColor);
    shadow.addShadowCaster(this.fistL);

    this.fistR = MeshBuilder.CreateBox(
      `brawler_${idSuffix}_fistR`,
      { width: 1.0, height: 1.0, depth: 1.3 },
      scene,
    );
    this.fistR.position.set(BRAWLER_DEF.radius + 0.7, 1.3, 0);
    this.addPart(this.fistR, fistColor);
    shadow.addShadowCaster(this.fistR);

    // Glowing chest plate — emissive visor strip to match the Elite's threat language.
    const chest = MeshBuilder.CreateBox(
      `brawler_${idSuffix}_chest`,
      { width: 1.4, height: 0.2, depth: 0.1 },
      scene,
    );
    chest.position.set(0, 2.0, BRAWLER_DEF.radius * 1.0);
    this.addPart(chest, new Color3(1, 0.25, 0.1), {
      disableLighting: true,
      emissive: new Color3(1, 0.25, 0.1),
    });

    // Small horned helmet for a readable head shape at 20m.
    const horns = MeshBuilder.CreateCylinder(
      `brawler_${idSuffix}_horns`,
      { diameterTop: 0, diameterBottom: 0.35, height: 0.7, tessellation: 10 },
      scene,
    );
    horns.position.set(-0.6, 2.95, 0);
    horns.rotation.z = Math.PI / 8;
    this.addPart(horns, new Color3(0.25, 0.10, 0.08));
    shadow.addShadowCaster(horns);

    const horns2 = MeshBuilder.CreateCylinder(
      `brawler_${idSuffix}_horns2`,
      { diameterTop: 0, diameterBottom: 0.35, height: 0.7, tessellation: 10 },
      scene,
    );
    horns2.position.set(0.6, 2.95, 0);
    horns2.rotation.z = -Math.PI / 8;
    this.addPart(horns2, new Color3(0.25, 0.10, 0.08));
    shadow.addShadowCaster(horns2);
  }

  private ensureTelegraph(): void {
    if (this.telegraphBar) return;
    // A long thin emissive bar that lies on the ground, pointing along the dash direction.
    // Built unit-length on +Z, then scaled and rotated each telegraph frame.
    this.telegraphBar = MeshBuilder.CreateBox(
      `${this.id}_dashBar`,
      { width: 1.6, height: 0.05, depth: 1.0 },
      this.body.getScene(),
    );
    this.telegraphMat = new StandardMaterial(`${this.id}_dashMat`, this.body.getScene());
    this.telegraphMat.diffuseColor = new Color3(1, 0.4, 0.05);
    this.telegraphMat.emissiveColor = new Color3(0.95, 0.35, 0.08);
    this.telegraphMat.alpha = 0.75;
    this.telegraphMat.disableLighting = true;
    this.telegraphMat.backFaceCulling = false;
    this.telegraphBar.material = this.telegraphMat;
    this.telegraphBar.isVisible = false;
  }

  updateLogic(dt: number, player: Player): void {
    if (!this.alive) {
      if (this.telegraphBar) this.telegraphBar.isVisible = false;
      return;
    }
    // Intro animation — body lerps scale.y from 0.4 → 1.0 over introDuration.
    // While the timer is positive, the boss is invulnerable to AI logic but
    // still ticks for hit-flash / shadow setup. The main.ts layer drives the
    // camera orbit + banner via BOSS_INTRO_START emitted in EnemyManager.spawn.
    if (this.introTimer > 0) {
      this.introTimer = Math.max(0, this.introTimer - dt);
      const t = 1 - this.introTimer / this.introDuration;
      this.root.scaling.y = 0.4 + 0.6 * t;
      // No XZ movement, no AI — just stand and rise.
      this.tickCommon(dt);
      return;
    }
    // Sway off during the dash itself; on through the rest of the FSM so the
    // boss is never statue-still. tickCommon reads this each frame.
    this.swayActive = this.state !== "attack";
    this.tickCommon(dt);
    if (this.contactCooldown > 0) this.contactCooldown = Math.max(0, this.contactCooldown - dt);

    // Phase 2: spawn adds at 50% HP (boss survives)
    if (!this.hasSplit && this.hp <= this.def.hp * 0.5) {
      this.hasSplit = true;
      events.emit("BOSS_PHASE", { bossId: this.id, phase: 2, spawnPos: this.root.position.clone() });
    }

    const dx = player.root.position.x - this.root.position.x;
    const dz = player.root.position.z - this.root.position.z;
    const distSq = dx * dx + dz * dz;
    const dist = Math.sqrt(distSq);

    // Dash logic
    this.dashTimer -= dt;

    if (this.state === "telegraph") {
      this.dashTelegraphTimer -= dt;
      this.ensureTelegraph();
      if (this.telegraphBar && this.telegraphMat) {
        const t = 1 - this.dashTelegraphTimer / 0.5;
        // Position the bar so it starts at the boss and extends along the dash direction.
        const halfLen = this.dashTelegraphLength / 2;
        const cx = this.root.position.x + this.dashDir.x * halfLen;
        const cz = this.root.position.z + this.dashDir.z * halfLen;
        this.telegraphBar.position.x = cx;
        this.telegraphBar.position.y = 0.06;
        this.telegraphBar.position.z = cz;
        // Rotate to face dash direction (atan2 in XZ — same convention as Player.faceTowards).
        this.telegraphBar.rotation.y = Math.atan2(this.dashDir.x, this.dashDir.z);
        // Stretch length along Z (local), pulse width slightly so the warning grows.
        this.telegraphBar.scaling.x = 0.9 + 0.4 * t;
        this.telegraphBar.scaling.z = this.dashTelegraphLength;
        this.telegraphBar.isVisible = true;
        this.telegraphMat.alpha = 0.55 + 0.4 * t;
        // Fists cock backward as the wind-up builds — readable "about to swing" motion.
        const pull = 0.9 * t;
        this.fistL.position.z = -pull;
        this.fistR.position.z = -pull;
        this.fistL.scaling.set(1 + 0.15 * t, 1 + 0.15 * t, 1 + 0.15 * t);
        this.fistR.scaling.set(1 + 0.15 * t, 1 + 0.15 * t, 1 + 0.15 * t);
      }
      if (this.dashTelegraphTimer <= 0) {
        this.state = "attack";
        this.dashActiveTimer = 0.32;
        if (this.telegraphBar) this.telegraphBar.isVisible = false;
        // Thrust fists forward for the dash.
        this.fistL.position.z = 0.5;
        this.fistR.position.z = 0.5;
      }
      return;
    }

    if (this.state === "attack") {
      this.dashActiveTimer -= dt;
      const dashSpeed = 14;
      this.root.position.x += this.dashDir.x * dashSpeed * dt;
      this.root.position.z += this.dashDir.z * dashSpeed * dt;
      const touch = this.def.radius + player.stats.radius;
      if (distSq <= (touch + 0.6) * (touch + 0.6) && this.contactCooldown === 0 && !player.isDodging) {
        const dmg = 18;
        events.emit("DAMAGE_TAKEN", { amount: dmg, source: this.id });
        this.contactCooldown = 0.6;
      }
      if (this.dashActiveTimer <= 0) {
        this.state = "recover";
        this.dashTimer = 3.5;
        // Brief rest
        this.dashActiveTimer = 0.6;
        // Reset fist positions so the boss looks relaxed during cooldown.
        this.fistL.position.z = 0;
        this.fistR.position.z = 0;
        this.fistL.scaling.set(1, 1, 1);
        this.fistR.scaling.set(1, 1, 1);
      }
      return;
    }

    if (this.state === "recover") {
      this.dashActiveTimer -= dt;
      if (this.dashActiveTimer <= 0) this.state = "chase";
      return;
    }

    // Begin dash telegraph
    if (this.dashTimer <= 0 && dist > 4) {
      this.state = "telegraph";
      this.dashTelegraphTimer = 0.5;
      if (dist > 1e-4) {
        this.dashDir.x = dx / dist;
        this.dashDir.z = dz / dist;
      }
      return;
    }

    // Default chase
    this.state = "chase";
    if (dist > this.def.radius + player.stats.radius && dist > 1e-4) {
      this.root.position.x += (dx / dist) * this.def.speed * dt;
      this.root.position.z += (dz / dist) * this.def.speed * dt;
    } else if (this.contactCooldown === 0 && !player.isDodging) {
      events.emit("DAMAGE_TAKEN", { amount: this.def.contactDamage, source: this.id });
      this.contactCooldown = 0.9;
    }
  }

  dispose(): void {
    if (this.telegraphBar) {
      this.telegraphBar.dispose();
      this.telegraphBar = null;
    }
    if (this.telegraphMat) {
      this.telegraphMat.dispose();
      this.telegraphMat = null;
    }
    super.dispose();
  }
}
