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
  hp: 340,
  speed: 3.4,
  radius: 1.4,
  contactDamage: 9,
  color: new Color3(0.85, 0.18, 0.10),
  aggroRange: 60,
};

/**
 * Boss Brawler — close-range bruiser. Owns the dash FSM:
 *   chase → telegraph (0.35s windup, growing red bar) → attack (0.32s charge)
 *   → recover (0.6s) → chase
 *
 * Four-phase fight (P1 100→75% / P2 →50% / P3 →25% / P4 →0%). Each phase
 * unlocks a new attack tier:
 *   P1: Dash only.
 *   P2: + Ground Slam (radial root AoE).
 *   P3: + Earthsplitter Throw (boulder lob → ring + 3 fissures) and the
 *       Adrenaline Roar phase-entry buff (window where any hit on the boss
 *       shaves 0.4s off active cooldowns — incentivises aggressive dodging).
 *   P4: Berserker Lunge — dash chain extends from 3 → 5 hops and each hop
 *       drops a 2s damage trail the player has to weave through.
 *
 * Phase machinery (intro tween, threshold checks, BOSS_PHASE emission, the
 * deferred-strike queue and hyperarmor flag) lives in `BossBase`. This class
 * only owns the per-phase attack tick and the brawler-specific visuals
 * (fists, horns, chest plate).
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
   * P3+ zigzag dash chain. P3 seeds 2 follow-ups (3 dashes total); P4 seeds 4
   * follow-ups (5 dashes total) and each dash drops a damage trail. The chain
   * skips the long inter-dash cooldown and re-telegraphs with a rotated dir.
   */
  private dashChainRemaining = 0;
  /** Cadence timer for dropping the P4 dash-trail telegraphs during a dash. */
  private trailDropAcc = 0;
  /**
   * Phase 2+ ground-slam. Runs as a parallel sub-FSM that interrupts the dash
   * cycle when its cooldown is ready and the boss isn't mid-dash. Pure root +
   * radial AoE — telegraphed via the shared Telegraph ring so the player has
   * 1.0s to vacate the area.
   */
  private slamCooldown = 6.0;
  private slamWindUp = 0;
  private slamRecover = 0;
  /**
   * P3+ Earthsplitter Throw — telegraphed boulder lob. Wind-up phase shows a
   * line from the boss to the impact disc; on resolve, the impact spawns a
   * ring + 3 fissures (deferred line strikes radiating outward from the disc).
   */
  private earthsplitCooldown = 6.0;
  private earthsplitWindUp = 0;
  private earthsplitTarget = new Vector3();
  /**
   * P3/P4 Adrenaline Roar window — set on phase entry. While > 0, every hit
   * the boss takes shaves 0.4s off all live attack cooldowns, so the player
   * cannot just stand still trading damage during the buff (forces dodging).
   * Visualised via the chest emissive ramp (handled in `phaseAttackTick`).
   */
  private roarBuffTimer = 0;
  private static readonly ROAR_DURATION = 1.5;
  private static readonly ROAR_HIT_REDUCTION = 0.4;
  /**
   * Subclasses (Spire, Colossus — currently inherit this class) opt out of
   * the slam attack when they own different combat verbs. Tier 1b-Spire and
   * Tier 1b-Colossus replace inheritance with their own BossBase subclasses.
   */
  protected slamEnabled = true;
  private static readonly SLAM_RADIUS = 5.0;
  private static readonly SLAM_WIND_UP = 1.0;
  private static readonly SLAM_DAMAGE = 22;
  private static readonly EARTHSPLIT_WIND_UP = 1.2;
  private static readonly EARTHSPLIT_RADIUS = 3.6;
  private static readonly EARTHSPLIT_DAMAGE = 26;
  private static readonly EARTHSPLIT_FISSURE_RANGE = 6.5;
  private static readonly EARTHSPLIT_FISSURE_DAMAGE = 12;
  private static readonly DASH_TRAIL_DAMAGE = 12;
  private static readonly DASH_WIND_UP = 0.35;
  private static readonly FLOOR_CRACK_RADIUS = 2.4;
  private static readonly FLOOR_CRACK_DAMAGE = 14;
  private static readonly FLOOR_CRACK_INTERVAL = 1.5;

  constructor(scene: Scene, shadow: ShadowGenerator, spawnPos: Vector3, idSuffix: string, telegraph: Telegraph) {
    const body = MeshBuilder.CreateCylinder(
      `brawler_${idSuffix}_body`,
      { diameterTop: BRAWLER_DEF.radius * 1.6, diameterBottom: BRAWLER_DEF.radius * 2.2, height: 2.6, tessellation: 18 },
      scene,
    );
    body.position = new Vector3(0, 1.3, 0);
    super(scene, shadow, BRAWLER_DEF, spawnPos, body, idSuffix, telegraph);
    this.bossDisplayName = "BRAWLER OF THE PIT";
    // Four-phase fight. P1 = pure dash; P2 unlocks ground slam; P3 unlocks
    // Earthsplitter Throw + Adrenaline Roar; P4 turns every dash into a
    // five-hop Berserker Lunge with damage trails.
    this.phaseHpThresholds = [0.75, 0.50, 0.25];
    this.enrageLines = ["THE BRAWLER ROARS", "BLOOD FOR BLOOD", "BREAK THE WORLD"];
    this.spawnComposition = [
      ["chaser", "chaser"],
      ["elite", "chaser", "chaser"],
      ["elite", "elite"],
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
    // Drain pending strikes (Earthsplitter fissures, Berserker dash trails)
    // every frame regardless of substate.
    this.tickPending(dt, player);

    // Adrenaline Roar countdown — pure visual + buff window. The damage hook
    // that consumes it lives in `takeDamage` below.
    if (this.roarBuffTimer > 0) {
      this.roarBuffTimer = Math.max(0, this.roarBuffTimer - dt);
    }

    // Sway off during the dash itself; on through the rest of the FSM so the
    // boss is never statue-still. tickCommon (in base) reads this each frame.
    this.swayActive = this.state !== "attack" && this.slamWindUp === 0 && this.earthsplitWindUp === 0;

    // ----- Earthsplitter Throw (P3+) — interrupts dash when ready -----
    if (this.currentPhase >= 3) {
      if (this.earthsplitWindUp > 0) {
        this.earthsplitWindUp = Math.max(0, this.earthsplitWindUp - dt);
        if (this.earthsplitWindUp === 0) this.detonateEarthsplit();
        return; // committed — hyperarmor on, dash suppressed
      }
      // Adaptive AI — vs. a storm-dominant player (charged beam / chain
      // lightning), the Brawler tilts harder into Earthsplitter to punish
      // ranged kiting. We accelerate the cooldown by 50% on each tick.
      const earthsplitTickRate = this.dominantArchetype === "storm" ? 1.5 : 1.0;
      this.earthsplitCooldown -= dt * earthsplitTickRate;
      if (
        this.earthsplitCooldown <= 0 &&
        this.slamWindUp === 0 &&
        (this.state === "chase" || this.state === "recover")
      ) {
        this.beginEarthsplit(player);
        return;
      }
    }

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
        const t = 1 - this.dashTelegraphTimer / BossBrawler.DASH_WIND_UP;
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
      // P4 — Berserker Lunge drops a damage trail along the dash path. Pace the
      // drops so a 0.32s dash leaves ~3 markers spaced ~1.5m apart; each marker
      // is a 2.5m disc telegraph + 2 deferred strikes (the lingering "step here
      // and burn" beat the plan calls for, without HazardZones — that system
      // exists for player attacks in Phase 3).
      if (this.currentPhase >= 4) {
        this.trailDropAcc += dt;
        if (this.trailDropAcc >= 0.11) {
          this.trailDropAcc -= 0.11;
          this.dropDashTrail();
        }
      }
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
      this.dashTelegraphTimer = BossBrawler.DASH_WIND_UP;
      if (dist > 1e-4) {
        // P3+: lead the chain with a fresh aim at the player on dash 1, then
        // alternate ±45° pivots from the locked direction on follow-ups. P4
        // extends the chain to 5 dashes (4 follow-ups) and each dash drops a
        // damage trail behind it via the trail accumulator below.
        if (this.currentPhase >= 3 && this.dashChainRemaining === 0) {
          this.dashChainRemaining = this.currentPhase >= 4 ? 4 : 2;
          this.dashDir.x = dx / dist;
          this.dashDir.z = dz / dist;
        } else if (this.dashChainRemaining > 0) {
          // Pivot ~45° on alternating sides — flips each follow-up so the
          // player can't out-strafe in a single direction. Parity-based so
          // the 5-hop P4 chain alternates correctly across all follow-ups.
          const sign = (this.dashChainRemaining % 2 === 0) ? 1 : -1;
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
      this.root.position.x += (dx / dist) * this.def.speed * this.speedScale() * dt;
      this.root.position.z += (dz / dist) * this.def.speed * this.speedScale() * dt;
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
    if (phase >= 3) {
      this.earthsplitCooldown = 4.5;
      // Floor cracks — 2 persistent damaging discs at fixed arena positions.
      // Telegraph + queueStrike loop — re-fires every 1.5 s while the boss
      // lives so the cracks read as a constant denied zone, not a one-shot.
      this.spawnFloorCrackPair();
      // Adrenaline Roar window — telegraphed via the chest visor pulse and
      // a wide ring under the boss. Hits during this window shave cooldowns.
      this.roarBuffTimer = BossBrawler.ROAR_DURATION;
      this.telegraph.spawnRing(
        this.root.position,
        4.5,
        BossBrawler.ROAR_DURATION,
        [1.0, 0.55, 0.10],
      );
    }
    if (phase >= 4) {
      // P4 entry: shorten ALL cooldowns so the boss feels like it's spilling
      // attacks. Player has to be on the move continuously.
      this.slamCooldown = Math.min(this.slamCooldown, 0.8);
      this.earthsplitCooldown = Math.min(this.earthsplitCooldown, 1.8);
    }
  }

  override takeDamage(amount: number): void {
    // Adrenaline Roar consumption — every hit during the window shaves
    // cooldowns. Capped at zero so the player can't push them negative.
    if (this.roarBuffTimer > 0) {
      const cut = BossBrawler.ROAR_HIT_REDUCTION;
      this.slamCooldown = Math.max(0, this.slamCooldown - cut);
      this.earthsplitCooldown = Math.max(0, this.earthsplitCooldown - cut);
      this.dashTimer = Math.max(0, this.dashTimer - cut);
    }
    super.takeDamage(amount);
  }

  /** Begin the ground-slam wind-up — root the boss, spawn the ring telegraph. */
  private beginSlam(): void {
    this.slamWindUp = BossBrawler.SLAM_WIND_UP;
    this.state = "telegraph"; // suppress sway, prevent dash from queueing
    this.hyperarmorActive = true; // committed slam — can't be punted off it
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

  /**
   * Begin Earthsplitter Throw — telegraphed boulder lob at the player's
   * current position. Visualised by a line from boss to landing disc; on
   * impact the disc converts to a damaging ring + 3 outward fissures.
   */
  private beginEarthsplit(player: Player): void {
    this.earthsplitWindUp = BossBrawler.EARTHSPLIT_WIND_UP;
    this.state = "telegraph";
    this.hyperarmorActive = true;
    // Land where the player is right now — the fissures fan out from there,
    // so the player must commit to a direction during the windup.
    this.earthsplitTarget.copyFrom(player.root.position);
    const dx = this.earthsplitTarget.x - this.root.position.x;
    const dz = this.earthsplitTarget.z - this.root.position.z;
    const dist = Math.max(1e-4, Math.sqrt(dx * dx + dz * dz));
    // Throw arc telegraph — line from boss out to target.
    this.telegraph.spawnLine(
      this.root.position,
      dx / dist,
      dz / dist,
      dist,
      0.7,
      BossBrawler.EARTHSPLIT_WIND_UP,
      [0.95, 0.35, 0.08],
    );
    // Landing zone telegraph — disc the player must vacate.
    this.telegraph.spawnDisc(
      this.earthsplitTarget,
      BossBrawler.EARTHSPLIT_RADIUS,
      BossBrawler.EARTHSPLIT_WIND_UP,
      [1.0, 0.20, 0.06],
    );
    // Cock both fists overhead with extra pull — readable "winding up to lob".
    this.fistL.position.y = 1.5;
    this.fistR.position.y = 1.5;
  }

  /** Resolve the boulder impact — direct ring damage + 3 fissures. */
  private detonateEarthsplit(): void {
    const cx = this.earthsplitTarget.x;
    const cz = this.earthsplitTarget.z;
    // Direct hit — radial damage at the landing point. Routed through
    // HOSTILE_AOE so the main.ts handler resolves the dodge / DAMAGE_TAKEN
    // dance without duplicating that logic here.
    events.emit("HOSTILE_AOE", {
      x: cx,
      z: cz,
      radius: BossBrawler.EARTHSPLIT_RADIUS,
      damage: BossBrawler.EARTHSPLIT_DAMAGE,
      source: this.id,
    });
    // 3 fissures fanning from the impact point. Each is a deferred line strike
    // — telegraphed for 0.45s, resolved at end of that window. Spread across
    // 360° so two of the three are guaranteed near the player's vector.
    const baseAngle = Math.random() * Math.PI * 2;
    for (let i = 0; i < 3; i++) {
      const a = baseAngle + (i * Math.PI * 2) / 3;
      const ndx = Math.cos(a);
      const ndz = Math.sin(a);
      const origin = new Vector3(cx, 0, cz);
      this.telegraph.spawnLine(
        origin,
        ndx,
        ndz,
        BossBrawler.EARTHSPLIT_FISSURE_RANGE,
        1.0,
        0.45,
        [1.0, 0.45, 0.10],
      );
      this.queueStrike(0.45, (player) => {
        if (!this.alive) return;
        const px = player.root.position.x - cx;
        const pz = player.root.position.z - cz;
        const along = px * ndx + pz * ndz;
        const perp = Math.abs(px * -ndz + pz * ndx);
        if (
          along >= 0 &&
          along <= BossBrawler.EARTHSPLIT_FISSURE_RANGE &&
          perp <= 0.5 + player.stats.radius
        ) {
          if (!player.isDodging) {
            events.emit("DAMAGE_TAKEN", {
              amount: BossBrawler.EARTHSPLIT_FISSURE_DAMAGE,
              source: this.id,
            });
          } else if (player.tryConsumePerfectDodge()) {
            events.emit("PERFECT_DODGE", {});
          }
        }
      });
    }
    // Recovery + cooldown. P4 keeps the cooldown short so the throw becomes a
    // recurring threat rather than a once-per-encounter beat.
    this.earthsplitCooldown = this.currentPhase >= 4 ? 5.5 : 7.5;
    this.state = "recover";
    this.dashActiveTimer = 0.45;
    this.fistL.position.y = 1.3;
    this.fistR.position.y = 1.3;
    this.hyperarmorActive = false;
  }

  /**
   * Drop a P4 dash-trail marker at the boss's current position. Telegraphed
   * disc + 2 deferred strikes so a player who lingers on the trail mid-dash
   * actually gets bitten, while a clean dodge clears the trail.
   */
  private dropDashTrail(): void {
    const cx = this.root.position.x;
    const cz = this.root.position.z;
    const center = new Vector3(cx, 0, cz);
    const radius = 1.25;
    this.telegraph.spawnDisc(center, radius, 2.0, [1.0, 0.30, 0.05]);
    for (const delay of [0.5, 1.4]) {
      this.queueStrike(delay, (player) => {
        if (!this.alive) return;
        const dx = player.root.position.x - cx;
        const dz = player.root.position.z - cz;
        const r = radius + player.stats.radius;
        if (dx * dx + dz * dz <= r * r) {
          if (!player.isDodging) {
            events.emit("DAMAGE_TAKEN", {
              amount: BossBrawler.DASH_TRAIL_DAMAGE,
              source: this.id,
            });
          } else if (player.tryConsumePerfectDodge()) {
            events.emit("PERFECT_DODGE", {});
          }
        }
      });
    }
  }

  /**
   * P3+ floor cracks — 2 fixed-position danger zones at the pit's NE and SW
   * arena spots. Refreshes every FLOOR_CRACK_INTERVAL via queueStrike so the
   * threat persists until boss death. Player must keep clear of both.
   */
  private spawnFloorCrackPair(): void {
    const positions: Array<[number, number]> = [[8, -8], [-8, 8]];
    const refresh = () => {
      if (!this.alive) return;
      for (const [cx, cz] of positions) {
        this.telegraph.spawnDisc(
          new Vector3(cx, 0, cz),
          BossBrawler.FLOOR_CRACK_RADIUS,
          BossBrawler.FLOOR_CRACK_INTERVAL,
          [0.55, 0.10, 0.05],
        );
        this.queueStrike(BossBrawler.FLOOR_CRACK_INTERVAL * 0.6, (player) => {
          if (!this.alive) return;
          const dx = player.root.position.x - cx;
          const dz = player.root.position.z - cz;
          const r = BossBrawler.FLOOR_CRACK_RADIUS + player.stats.radius;
          if (dx * dx + dz * dz <= r * r) {
            if (!player.isDodging) {
              events.emit("DAMAGE_TAKEN", { amount: BossBrawler.FLOOR_CRACK_DAMAGE, source: this.id });
            } else if (player.tryConsumePerfectDodge()) {
              events.emit("PERFECT_DODGE", {});
            }
          }
        });
      }
      this.queueStrike(BossBrawler.FLOOR_CRACK_INTERVAL, refresh);
    };
    refresh();
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
    this.hyperarmorActive = false;
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
