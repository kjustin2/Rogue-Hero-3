import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { EnemyDef } from "../Enemy";
import { Player } from "../../player/Player";
import { BossBase } from "./BossBase";
import { Telegraph } from "../../fx/Telegraph";
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
 * Boss Brawler — close-range bruiser. Owns the dash FSM:
 *   chase → telegraph (0.5s windup, growing red bar) → attack (0.32s charge)
 *   → recover (0.6s) → chase
 *
 * Phase machinery (intro tween, threshold checks, BOSS_PHASE emission) lives
 * in `BossBase`. This class only owns the per-phase attack tick and the
 * brawler-specific visuals (fists, horns, chest plate).
 */
export class BossBrawler extends BossBase {
  private dashTimer = 3.5;
  private dashTelegraphTimer = 0;
  private dashActiveTimer = 0;
  private dashDir = new Vector3(0, 0, 1);
  private telegraphBar: Mesh | null = null;
  private telegraphMat: StandardMaterial | null = null;
  private readonly dashTelegraphLength = 6.0;
  private fistL!: Mesh;
  private fistR!: Mesh;
  /**
   * Phase-3 zigzag dash chain. When > 0, the boss skips the long inter-dash
   * cooldown and re-telegraphs immediately with a rotated direction.
   */
  private dashChainRemaining = 0;
  /**
   * Phase 2/3 ground-slam. Runs as a parallel sub-FSM that interrupts the dash
   * cycle when its cooldown is ready and the boss isn't mid-dash. Pure root +
   * radial AoE — telegraphed via the shared Telegraph ring so the player has
   * 1.4s to vacate the area.
   */
  private slamCooldown = 6.0;
  private slamWindUp = 0;
  private slamRecover = 0;
  /**
   * Subclasses (Spire, Colossus — currently inherit this class) opt out of
   * the slam attack when they own different combat verbs. Tier 1b-Spire and
   * Tier 1b-Colossus replace inheritance with their own BossBase subclasses.
   */
  protected slamEnabled = true;
  private static readonly SLAM_RADIUS = 5.0;
  private static readonly SLAM_WIND_UP = 1.4;
  private static readonly SLAM_DAMAGE = 22;

  constructor(scene: Scene, shadow: ShadowGenerator, spawnPos: Vector3, idSuffix: string, telegraph: Telegraph) {
    const body = MeshBuilder.CreateCylinder(
      `brawler_${idSuffix}_body`,
      { diameterTop: BRAWLER_DEF.radius * 1.6, diameterBottom: BRAWLER_DEF.radius * 2.2, height: 2.6, tessellation: 18 },
      scene,
    );
    body.position = new Vector3(0, 1.3, 0);
    super(scene, shadow, BRAWLER_DEF, spawnPos, body, idSuffix, telegraph);
    this.bossDisplayName = "BRAWLER OF THE PIT";
    // Three-phase fight. P1 = pure dash; P2 unlocks the ground slam; P3 also
    // upgrades the dash to a 3-hit zigzag chain.
    this.phaseHpThresholds = [0.66, 0.33];
    this.enrageLines = ["THE BRAWLER ROARS", "BLOOD FOR BLOOD"];
    this.spawnComposition = [
      ["chaser", "chaser"],
      ["elite", "chaser", "chaser"],
    ];
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
    // Long thin emissive bar lying on the ground along the dash direction.
    // Built unit-length on +Z, scaled and rotated each telegraph frame.
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

  protected override onDeadFrame(): void {
    if (this.telegraphBar) this.telegraphBar.isVisible = false;
  }

  protected override phaseAttackTick(dt: number, player: Player): void {
    // Sway off during the dash itself; on through the rest of the FSM so the
    // boss is never statue-still. tickCommon (in base) reads this each frame.
    this.swayActive = this.state !== "attack" && this.slamWindUp === 0;

    // ----- Slam sub-FSM (P2+) — runs in parallel with dash, interrupts when ready -----
    if (this.slamEnabled && this.currentPhase >= 2) {
      if (this.slamWindUp > 0) {
        this.slamWindUp = Math.max(0, this.slamWindUp - dt);
        if (this.slamWindUp === 0) this.detonateSlam(player);
        return; // rooted while telegraphing
      }
      if (this.slamRecover > 0) {
        this.slamRecover = Math.max(0, this.slamRecover - dt);
        return;
      }
      this.slamCooldown -= dt;
      // Only initiate slam if the dash isn't mid-flight; otherwise the dash
      // and slam would visually clash and the slam ring would spawn at a
      // misleading position.
      if (
        this.slamCooldown <= 0 &&
        (this.state === "chase" || this.state === "recover")
      ) {
        this.beginSlam();
        return;
      }
    }

    const dx = player.root.position.x - this.root.position.x;
    const dz = player.root.position.z - this.root.position.z;
    const distSq = dx * dx + dz * dz;
    const dist = Math.sqrt(distSq);

    this.dashTimer -= dt;

    if (this.state === "telegraph") {
      this.dashTelegraphTimer -= dt;
      this.ensureTelegraph();
      if (this.telegraphBar && this.telegraphMat) {
        const t = 1 - this.dashTelegraphTimer / 0.5;
        const halfLen = this.dashTelegraphLength / 2;
        const cx = this.root.position.x + this.dashDir.x * halfLen;
        const cz = this.root.position.z + this.dashDir.z * halfLen;
        this.telegraphBar.position.x = cx;
        this.telegraphBar.position.y = 0.06;
        this.telegraphBar.position.z = cz;
        this.telegraphBar.rotation.y = Math.atan2(this.dashDir.x, this.dashDir.z);
        this.telegraphBar.scaling.x = 0.9 + 0.4 * t;
        this.telegraphBar.scaling.z = this.dashTelegraphLength;
        this.telegraphBar.isVisible = true;
        this.telegraphMat.alpha = 0.55 + 0.4 * t;
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
      // Recompute distSq AFTER the dash position update — the cached value at
      // the top was sampled before the boss moved, so contact range was read
      // one frame stale during the dash.
      const adx = player.root.position.x - this.root.position.x;
      const adz = player.root.position.z - this.root.position.z;
      const adistSq = adx * adx + adz * adz;
      const touch = this.def.radius + player.stats.radius;
      if (adistSq <= (touch + 0.6) * (touch + 0.6)) {
        this.tryContactDamage(player, 18, 0.6);
      }
      if (this.dashActiveTimer <= 0) {
        this.state = "recover";
        // Zigzag chain (P3): the next dash reuses the same overall threat
        // window but pivots ~45° from the current heading. Three dashes
        // bracket the player from alternating angles before the boss takes
        // its breather. dashChainRemaining is seeded at the start of the
        // *first* dash in the chain (see telegraph branch below).
        if (this.dashChainRemaining > 0) {
          this.dashChainRemaining -= 1;
          this.dashActiveTimer = 0.18; // short inter-dash beat
          this.dashTimer = 0; // queue next telegraph immediately
        } else {
          this.dashTimer = 3.5;
          this.dashActiveTimer = 0.6;
        }
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

    if (this.dashTimer <= 0 && dist > 4) {
      this.state = "telegraph";
      this.dashTelegraphTimer = 0.5;
      if (dist > 1e-4) {
        // Phase 3: lead the chain with a fresh aim at the player on dash 1,
        // then alternate ±45° pivots from the locked direction on follow-ups.
        if (this.currentPhase >= 3 && this.dashChainRemaining === 0) {
          this.dashChainRemaining = 2; // 2 follow-ups → 3 dashes total
          this.dashDir.x = dx / dist;
          this.dashDir.z = dz / dist;
        } else if (this.dashChainRemaining > 0) {
          // Pivot ~45° on alternating sides — flips on each follow-up so the
          // player can't out-strafe in a single direction.
          const sign = this.dashChainRemaining === 2 ? 1 : -1;
          const angle = sign * (Math.PI / 4);
          const cs = Math.cos(angle);
          const sn = Math.sin(angle);
          const ndx = this.dashDir.x * cs - this.dashDir.z * sn;
          const ndz = this.dashDir.x * sn + this.dashDir.z * cs;
          this.dashDir.x = ndx;
          this.dashDir.z = ndz;
        } else {
          this.dashDir.x = dx / dist;
          this.dashDir.z = dz / dist;
        }
      }
      return;
    }

    this.state = "chase";
    if (dist > this.def.radius + player.stats.radius && dist > 1e-4) {
      this.root.position.x += (dx / dist) * this.def.speed * dt;
      this.root.position.z += (dz / dist) * this.def.speed * dt;
    } else {
      // P3 contact bites harder — frothing rage, +50% touch damage.
      const contact = this.currentPhase >= 3
        ? Math.round(this.def.contactDamage * 1.5)
        : this.def.contactDamage;
      this.tryContactDamage(player, contact, 0.9);
    }
  }

  protected override onPhaseEnter(phase: number): void {
    // Each phase entry primes a slam ~1s after the transition so the player
    // has a beat to read the new state, then pressure resumes immediately.
    if (phase >= 2) {
      this.slamCooldown = 1.0;
    }
  }

  /** Begin the ground-slam wind-up — root the boss, spawn the ring telegraph. */
  private beginSlam(): void {
    this.slamWindUp = BossBrawler.SLAM_WIND_UP;
    this.state = "telegraph"; // suppress sway, prevent dash from queueing
    // Bright red ring on the floor centered under the boss. Grows from 0 →
    // SLAM_RADIUS over the wind-up so the danger zone reads like a tightening
    // fence the player must vacate.
    this.telegraph.spawnRing(
      this.root.position,
      BossBrawler.SLAM_RADIUS,
      BossBrawler.SLAM_WIND_UP,
      [1.0, 0.18, 0.06],
    );
    // Cock both fists overhead — readable "about to come down hard" pose. The
    // dash cycle's fist-thrust will reset on its own when dash resumes.
    this.fistL.position.z = 0;
    this.fistR.position.z = 0;
    this.fistL.position.y = 1.0;
    this.fistR.position.y = 1.0;
  }

  /** Resolve the slam impact — radial damage check + screen feedback. */
  private detonateSlam(player: Player): void {
    const dx = player.root.position.x - this.root.position.x;
    const dz = player.root.position.z - this.root.position.z;
    const distSq = dx * dx + dz * dz;
    const r = BossBrawler.SLAM_RADIUS;
    if (distSq <= r * r) {
      // Direct hit: deal slam damage + heavy knockback away from the boss.
      // Honor the player's dodge i-frames the same way contact damage does.
      if (!player.isDodging) {
        events.emit("DAMAGE_TAKEN", { amount: BossBrawler.SLAM_DAMAGE, source: this.id });
      } else if (player.tryConsumePerfectDodge()) {
        events.emit("PERFECT_DODGE", {});
      }
    }
    // Heavy-impact stinger so audio + screen layer treat it as a major beat.
    // HEAVY_HIT is already wired to SfxManager + tempo gain — reuse it instead
    // of inventing a new event.
    events.emit("HEAVY_HIT", { x: this.root.position.x, z: this.root.position.z });
    // Shorter cooldown in P3 — the slam comes much more often.
    const baseCd = this.currentPhase >= 3 ? 4.0 : 7.0;
    this.slamCooldown = baseCd;
    this.slamRecover = 0.5;
    // Drop fists back to baseline; dash cycle takes over from here.
    this.fistL.position.y = 1.3;
    this.fistR.position.y = 1.3;
    this.state = "recover";
    this.dashActiveTimer = 0.5;
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
    if (this.fistL) this.fistL.dispose();
    if (this.fistR) this.fistR.dispose();
    super.dispose();
  }
}
