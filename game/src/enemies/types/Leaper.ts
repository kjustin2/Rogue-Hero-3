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

export const LEAPER_DEF: EnemyDef = {
  name: "leaper",
  hp: 28,
  speed: 4.0,
  radius: 0.55,
  contactDamage: 14,
  color: new Color3(0.45, 0.25, 0.65),
  aggroRange: 30,
};

/**
 * Predator that leaps onto its target. Loop:
 *   chase → telegraph (0.6s flat ground disc at predicted landing point) →
 *   leap (0.5s parabola, no XZ control) → impact (AoE damage in 2.5m) → recover.
 *
 * Manages its own Y; flips swayActive off so the parent's idle-bob doesn't
 * fight the parabola. Player can dodge by moving 2m+ off the predicted spot.
 */
export class Leaper extends Enemy {
  private mode: "chase" | "telegraph" | "leap" | "recover" = "chase";
  private telegraphTimer = 0;
  private leapTimer = 0;
  private recoverTimer = 0;
  private readonly TELEGRAPH = 0.6;
  private readonly LEAP_DUR = 0.5;
  private readonly RECOVER = 0.9;
  private readonly LEAP_AOE = 2.5;
  private readonly LEAD = 0.4;
  private targetX = 0;
  private targetZ = 0;
  private leapStartX = 0;
  private leapStartZ = 0;
  private telegraph: Mesh | null = null;
  private telegraphMat: StandardMaterial | null = null;

  constructor(scene: Scene, shadow: ShadowGenerator, spawnPos: Vector3, idSuffix: string) {
    const body = MeshBuilder.CreateBox(
      `leaper_${idSuffix}_body`,
      { width: LEAPER_DEF.radius * 2, height: LEAPER_DEF.radius * 1.5, depth: LEAPER_DEF.radius * 2 },
      scene,
    );
    body.position = new Vector3(0, LEAPER_DEF.radius * 0.75, 0);
    super(scene, shadow, LEAPER_DEF, spawnPos, body, idSuffix);
    // Predator crouches low — minimal idle bob until it primes a leap.
    this.swayAmpY = 0;
    this.swayFreqHz = 0;

    // Two glowing eye dots at the front for read.
    const eyeColor = new Color3(1.0, 0.55, 0.20);
    for (const ex of [-0.18, 0.18]) {
      const eye = MeshBuilder.CreateSphere(
        `leaper_${idSuffix}_eye_${ex}`,
        { diameter: 0.12, segments: 6 },
        scene,
      );
      eye.position.set(ex, LEAPER_DEF.radius * 1.1, LEAPER_DEF.radius * 0.7);
      this.addPart(eye, eyeColor, { disableLighting: true, emissive: eyeColor });
    }

    // Hind legs — two rectangles trailing back to sell the crouching pose.
    const legColor = new Color3(0.32, 0.18, 0.45);
    for (const lx of [-0.28, 0.28]) {
      const leg = MeshBuilder.CreateBox(
        `leaper_${idSuffix}_leg_${lx}`,
        { width: 0.18, height: 0.5, depth: 0.4 },
        scene,
      );
      leg.position.set(lx, 0.25, -0.32);
      this.addPart(leg, legColor);
    }
  }

  private ensureTelegraph(): void {
    if (this.telegraph) return;
    const sc = this.body.getScene();
    this.telegraph = MeshBuilder.CreateDisc(
      `${this.id}_leapTel`,
      { radius: this.LEAP_AOE, tessellation: 24 },
      sc,
    );
    this.telegraph.rotation.x = Math.PI / 2;
    this.telegraph.position = new Vector3(0, 0.06, 0);
    const mat = new StandardMaterial(`${this.id}_leapTelMat`, sc);
    mat.diffuseColor = new Color3(0.85, 0.4, 1.0);
    mat.emissiveColor = new Color3(0.65, 0.2, 0.95);
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mat.alpha = 0.3;
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

    const speedMul = this.speedScale();
    const dx = player.root.position.x - this.root.position.x;
    const dz = player.root.position.z - this.root.position.z;
    const distSq = dx * dx + dz * dz;

    if (this.mode === "leap") {
      this.leapTimer -= dt;
      const t = 1 - this.leapTimer / this.LEAP_DUR;
      // XZ: linear interp from leapStart toward (targetX, targetZ).
      this.root.position.x = this.leapStartX + (this.targetX - this.leapStartX) * t;
      this.root.position.z = this.leapStartZ + (this.targetZ - this.leapStartZ) * t;
      // Y: parabolic arc (peak at t=0.5, height ~3.5m).
      this.root.position.y = Math.sin(t * Math.PI) * 3.5;
      if (this.leapTimer <= 0) {
        // Impact — radial damage check at landing point.
        this.root.position.y = 0;
        const ddx = player.root.position.x - this.root.position.x;
        const ddz = player.root.position.z - this.root.position.z;
        const reach = this.LEAP_AOE + player.stats.radius;
        if (ddx * ddx + ddz * ddz <= reach * reach && !player.isDodging && !player.isAirborne()) {
          events.emit("DAMAGE_TAKEN", { amount: this.def.contactDamage, source: this.id });
        }
        this.mode = "recover";
        this.recoverTimer = this.RECOVER;
      }
      return;
    }

    if (this.mode === "recover") {
      this.recoverTimer -= dt;
      if (this.recoverTimer <= 0) this.mode = "chase";
      return;
    }

    if (distSq > this.def.aggroRange * this.def.aggroRange) {
      this.state = "idle";
      if (this.telegraph) this.telegraph.isVisible = false;
      return;
    }

    if (this.mode === "telegraph") {
      this.telegraphTimer -= dt;
      const t = 1 - this.telegraphTimer / this.TELEGRAPH;
      // Lock the telegraph at the predicted target by re-rooting it via world
      // position each frame (it's parent-less so we set xyz directly).
      if (this.telegraph && this.telegraphMat) {
        this.telegraph.isVisible = true;
        this.telegraph.position.x = this.targetX;
        this.telegraph.position.z = this.targetZ;
        this.telegraph.scaling.x = this.telegraph.scaling.z = 0.6 + 0.5 * t;
        this.telegraphMat.alpha = 0.3 + 0.55 * t;
      }
      // Body crouches lower then primes for jump as the timer ends.
      this.root.position.y = -0.05 + 0.05 * Math.sin(t * Math.PI);
      if (this.telegraphTimer <= 0) {
        if (this.telegraph) this.telegraph.isVisible = false;
        this.mode = "leap";
        this.leapTimer = this.LEAP_DUR;
        this.leapStartX = this.root.position.x;
        this.leapStartZ = this.root.position.z;
      }
      return;
    }

    // Chase — close the distance, primarily to get into leap range (~10m).
    this.state = "chase";
    const dist = Math.sqrt(distSq);
    if (dist > 10) {
      const nx = dx / dist;
      const nz = dz / dist;
      const step = this.def.speed * speedMul * dt;
      this.root.position.x += nx * step;
      this.root.position.z += nz * step;
    } else if (dist > 1e-4) {
      // In range — pick a leap target and start the telegraph. Predict the
      // player's position assuming current velocity isn't tracked: use a
      // small forward lead based on facing × LEAD distance.
      this.ensureTelegraph();
      const fl = Math.hypot(player.facing.x, player.facing.z) || 1;
      this.targetX = player.root.position.x + (player.facing.x / fl) * this.LEAD;
      this.targetZ = player.root.position.z + (player.facing.z / fl) * this.LEAD;
      this.mode = "telegraph";
      this.telegraphTimer = this.TELEGRAPH;
    }
  }

  dispose(): void {
    if (this.telegraph) { this.telegraph.dispose(); this.telegraph = null; }
    if (this.telegraphMat) { this.telegraphMat.dispose(); this.telegraphMat = null; }
    super.dispose();
  }
}
