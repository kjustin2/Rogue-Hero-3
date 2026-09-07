import * as THREE from "three";
import { Enemy, type EnemyKind } from "./enemies";
import type { Ctx } from "./ctx";
import { forgeWarden } from "../render/wardenForge";
import { ARENA_RADIUS } from "../render/arena";
import { ParticleShape } from "../render/particles";
import { PIT_WARDEN_MOVE_PROFILE, bossRecoverySeconds, chooseBossMove, type BossRecoveryClass, type PitWardenMove } from "./bossMoves";

interface FirePatch {
  x: number;
  z: number;
  life: number;
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  acc: number;
}

type BossState =
  | "idle" | "dashTell" | "dashing" | "leapTell" | "leap" | "recover" | "phaseShift" | "guard"
  | "fanTell" | "fissureTell";

const PHASE_LINES = [
  "THE PIT WARDEN STIRS",
  "THE WARDEN'S BLOOD BOILS",
  "THE PIT DEMANDS AN ENDING",
];

/**
 * Act boss: a hulking brute. Phase 1 dash combos, phase 2 adds leaping slams
 * and swarmer adds, phase 3 chains burning dashes. Every attack telegraphs.
 */
export class PitWarden extends Enemy {
  readonly kind: EnemyKind = "boss";
  phase = 1;
  private state: BossState = "idle";
  private timer = 1.5;
  private dashDir = new THREE.Vector2();
  private dashesLeft = 0;
  private dashHit = false;
  private leapFrom = new THREE.Vector3();
  private leapTo = new THREE.Vector3();
  private leapT = 0;
  private actionCount = 0;
  private lastMove: PitWardenMove | null = null;
  private currentMove: PitWardenMove | null = null;
  private currentRecovery: BossRecoveryClass = "standard";
  private attackCd = 0.5;
  private guardWarned = false;
  private coreMat: THREE.MeshStandardMaterial;
  private eyeMat: THREE.MeshStandardMaterial;
  private core: THREE.Mesh;
  private chainLinks: THREE.Mesh[] = [];
  private backFlares: THREE.Object3D[] = [];
  private emberVents: THREE.Object3D[] = [];
  // Shoulder-pivot arm groups so swings/raises/thrusts read as real blows.
  private arms: THREE.Group[] = [];
  private armPose = 0; // 0 = relaxed locomotion → 1 = full attack pose
  // Ranged ember fan: a spread of magma bolts the player must side-step.
  private fanAngle = 0;
  // Ground fissures: radiating cracks of fire with safe wedges between them.
  private fissures: { angle: number }[] = [];
  private readonly fissureLen = 13;
  private readonly fissureHalfW = 1.6;
  private patches: FirePatch[] = [];
  private patchGeo: THREE.CircleGeometry;
  // Per-phase appearance escalation (built once, revealed on transition).
  private hide: THREE.MeshStandardMaterial;
  private plate: THREE.MeshStandardMaterial;
  private p2Spikes: THREE.Object3D[] = [];
  private p3Crown: THREE.Object3D[] = [];
  // Hip-pivoted leg groups (+ ankle pivots) so the walk reads as steps, not a slide.
  private legs: THREE.Group[] = [];
  private ankles: THREE.Group[] = [];
  // Hip-pivot height of the legs. Tuned so the thigh plants and the boot rests ON
  // the arena floor (y≈0) rather than sinking ~0.13 below it — the old base left
  // the boots mostly buried, a "feet clipping through the ground" look from behind.
  private readonly legBaseY = 0.92;
  private walkPhase = 0;
  private gait = 0;
  private prevWalkX = 0;
  private prevWalkZ = 0;

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 1500;
    this.speed = 3.9;
    this.radius = 1.4;
    this.wardColor = 0xff7a3a;

    const rig = forgeWarden(this.root, (color, emissive, intensity) => this.stdMat(color, emissive, intensity));
    this.bindCinematicParts(rig.arms);
    this.core = rig.core; this.coreMat = rig.coreMat; this.eyeMat = rig.eyeMat;
    this.hide = rig.hide; this.plate = rig.plate;
    this.arms = rig.arms; this.legs = rig.legs; this.ankles = rig.ankles;
    for (const node of rig.ankles) this.footContacts.push({node,offset:new THREE.Vector3(0,-.1,.3),radius:.32});
    this.chainLinks = rig.chains; this.backFlares = rig.flares; this.emberVents = rig.vents;
    this.prevWalkX = x; this.prevWalkZ = z;

    this.patchGeo = new THREE.CircleGeometry(1.2, 24);
    this.patchGeo.rotateX(-Math.PI / 2);

    this.buildPhaseLooks();
  }

  protected animateDeath(dt: number, progress: number): boolean {
    const sink = Math.min(1, progress / .5);
    const weight = sink * sink * (3 - 2 * sink);
    this.root.position.y -= weight * .17;
    this.settleDeathPart(this.root, dt, .16, this.root.rotation.y, -.055);
    for (let i = 0; i < this.arms.length; i++) {
      this.settleDeathPart(this.arms[i], dt, -.24, 0, i === 0 ? -.06 : .1);
      this.settleDeathPart(this.legs[i], dt, i === 0 ? -.55 : -.28, 0, i === 0 ? -.09 : .09);
      this.settleDeathPart(this.ankles[i], dt, i === 0 ? .42 : .16, 0, 0);
    }
    return true;
  }

  /** Pre-build the escalation geometry hidden until its phase unveils it. */
  private buildPhaseLooks(): void {
    // Phase 2: ridge of jagged ember spikes erupts across the back/shoulders.
    const spikeMat = this.stdMat(0x3a0a06, 0xff5522, 1.4);
    const spikeGeo = new THREE.ConeGeometry(0.16, 0.95, 5);
    const ridge: [number, number, number, number][] = [
      [-0.85, 2.3, -0.5, -0.5], [0, 2.55, -0.55, 0], [0.85, 2.3, -0.5, 0.5],
      [-1.35, 1.55, -0.2, -0.7], [1.35, 1.55, -0.2, 0.7],
    ];
    for (const [x, y, z, tilt] of ridge) {
      const sp = this.addMesh(spikeGeo, spikeMat, x, y+0.22, z);
      sp.rotation.x = -0.6;
      sp.rotation.z = tilt;
      sp.visible = false;
      this.p2Spikes.push(sp);
    }

    // Phase 3: a molten crown of fangs rings the head + glowing knuckle plates.
    const crownMat = this.stdMat(0x4a0d06, 0xffdd66, 2.6);
    const fangGeo = new THREE.ConeGeometry(0.12, 0.6, 4);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const fang = this.addMesh(fangGeo, crownMat, Math.sin(a) * 0.62, 3.17, 0.55 + Math.cos(a) * 0.4);
      fang.rotation.x = Math.cos(a) * 0.35;
      fang.rotation.z = -Math.sin(a) * 0.35;
      fang.visible = false;
      this.p3Crown.push(fang);
    }
    const knuckleGeo = new THREE.BoxGeometry(0.95, 0.3, 0.95);
    for (const arm of this.arms) {
      const k = this.addMesh(knuckleGeo, crownMat, 0, -1.65, 0.2, arm);
      k.visible = false;
      this.p3Crown.push(k);
    }
  }

  /** Visibly escalate the boss at each phase transition. */
  private applyPhaseLook(phase: number): void {
    if (phase === 2) {
      this.setBossScale(1.08);
      this.eruptReveal(this.p2Spikes);
      // Hide darkens to char, core burns hotter and shifts toward orange-white.
      this.hide.color.set(0x5a1410);
      this.hide.emissive.set(0x8a1606);
      this.hide.emissiveIntensity = 0.12;
      this.coreMat.emissive.set(0xff5522);
      this.eyeMat.emissive.set(0xffcc33);
    } else if (phase === 3) {
      this.setBossScale(1.15);
      this.eruptReveal(this.p3Crown);
      this.plate.emissive.set(0x551200);
      this.plate.emissiveIntensity = 0.12;
      this.coreMat.emissive.set(0xff7a32);
      this.eyeMat.emissive.set(0xffffff);
      this.eyeMat.emissiveIntensity = 3.2;
    }
    // Re-baseline flash registration so hit-flash settles to the NEW look.
    for (const f of this.flashMats) {
      f.baseEmissive.copy(f.mat.emissive);
      f.baseIntensity = f.mat.emissiveIntensity;
    }
  }

  interruptAttack(): void {
    super.interruptAttack();
    this.dashesLeft = 0; this.fissures = []; this.leapT = 1; this.pos.y = 0;
    this.clearPatches();
  }

  protected onGuardBroken(): void {
    this.state = "recover";
    this.timer = 1.35;
  }

  protected animateCinematic(action: string, time: number, dt: number): boolean {
    const k = Math.min(1, time / 0.65), ease = k*k*(3-2*k);
    const landing = action === "land", drop = action === "drop", drag = action === "drag";
    const spread = action === "roar" || action === "last-stand";
    const pull = spread ? Math.sin(Math.min(1, time / 0.6)*Math.PI) : 0;
    this.drivePose(dt, { lunge: landing ? 0.2*(1-ease) : drag ? 0.13 : drop ? 0.16 : 0.04, rear: spread ? 0.065*ease : 0 });
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const x = drop ? -1.05 : landing ? -0.18 : drag ? (i === 0 ? -0.32 : 0.12) : -0.32-pull*0.55-(i===0 ? 0.12 : 0);
      const z = drop ? side*0.18 : spread ? side*(pull*0.3-ease*0.18) : side*0.045;
      this.arms[i].rotation.x += (x-this.arms[i].rotation.x)*Math.min(1,dt*12);
      this.arms[i].rotation.y += ((i===0 ? -0.08 : 0.12)-this.arms[i].rotation.y)*Math.min(1,dt*9);
      this.arms[i].rotation.z += (z-this.arms[i].rotation.z)*Math.min(1,dt*12);
      this.legs[i].rotation.x = drop ? 0.5 : 0;
      this.ankles[i].rotation.x = drop ? -0.3 : 0;
      this.legs[i].position.y = this.legBaseY;
    }
    this.coreMat.emissiveIntensity = 1 + pull*0.6 + Math.sin(time*3)*0.08;
    return true;
  }

  protected deathColor(): number {
    return 0xff5522;
  }

  protected barHeight(): number {
    return 3.8;
  }

  freeze(duration: number): void {
    // Never freeze mid-leap (would hang the boss in the air); ground freezes
    // are halved — a boss that locks up for 2.5s deflates the fight.
    if (this.state === "leap") return;
    super.freeze(duration * 0.5);
  }

  takeDamage(amount: number, opts = {}): boolean {
    // Bosses shrug off knockback
    const killed = super.takeDamage(amount, { ...opts, kb: 0 });
    this.ctx.events.emit("BOSS_HP", { hp: Math.max(0, this.hp), maxHp: this.maxHp });

    const frac = this.hp / this.maxHp;
    const targetPhase = frac <= 0.35 ? 3 : frac <= 0.7 ? 2 : 1;
    if (!killed && targetPhase > this.phase) {
      this.phase = targetPhase;
      // A phase shift can interrupt a mid-leap. The phase cutscene freezes the
      // world, so if we leave the boss airborne it hangs frozen in the sky for a
      // beat — snap it down to the ground and end the leap before transitioning.
      if (this.state === "leap") { this.pos.y = 0; this.leapT = 1; }
      this.interruptAttack();
      this.state = "phaseShift";
      this.timer = 1.2;
      this.applyPhaseLook(this.phase);
      this.ctx.events.emit("BOSS_PHASE", { phase: this.phase, line: PHASE_LINES[this.phase - 1] });
      this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: 8, color: 0xff5522, duration: 0.7 });
      this.ctx.fx.burst({
        x: this.pos.x, y: 2, z: this.pos.z,
        count: 50, color: [0xff5522, 0xffaa44],
        speed: [4, 13], up: 0.8, size: [0.5, 1.1], life: [0.4, 0.9], gravity: -5, drag: 2.5,
      });
      this.ctx.cam.addTrauma(0.5);
      this.ctx.sfx.bossRoar();
      // Shockwave shoves the player back
      const p = this.ctx.player;
      const dx = p.pos.x - this.pos.x;
      const dz = p.pos.z - this.pos.z;
      const len = Math.hypot(dx, dz) || 1;
      this.ctx.controller.push((dx / len) * 9, (dz / len) * 9);
    }
    return killed;
  }

  die(): void {
    if (!this.alive) return;
    this.disposeExtras();
    super.die();
    this.ctx.events.emit("BOSS_DEFEATED", { x: this.pos.x, z: this.pos.z });
  }

  // Room teardown for a still-alive Warden (player death / exit) calls dispose(),
  // not die() — so the scene-added fire patches must be freed here too, else they
  // orphan in the scene and patchGeo leaks. (Matches Colossus/Tyrant.)
  dispose(): void {
    this.disposeExtras();
    super.dispose();
  }

  private disposeExtras(): void {
    this.clearPatches();
    this.patchGeo.dispose();
  }

  private clearPatches(): void {
    for (const pt of this.patches) {
      this.ctx.stage.scene.remove(pt.mesh);
      pt.mat.dispose();
    }
    this.patches = [];
  }

  protected tick(dt: number): void {
    const p = this.ctx.player;
    this.timer -= dt;
    this.updatePatches(dt);

    // Core breathes faster as phases climb
    this.coreMat.emissiveIntensity = 0.85 + this.phase * 0.16 + Math.sin(this.t * (2 + this.phase * 2)) * 0.2;
    const corePulse = 1 + Math.sin(this.t * (2.6 + this.phase * 0.65)) * 0.055;
    this.core.scale.set(1 + (corePulse - 1) * 1.2, 1 + (corePulse - 1) * 0.75, 1 + (corePulse - 1) * 1.45);
    for (let i = 0; i < this.chainLinks.length; i++) {
      const link = this.chainLinks[i];
      link.rotation.y = (i % 2) * 1.05 + Math.sin(this.t * 1.45 + i * 0.7) * 0.045;
    }
    for (let i = 0; i < this.backFlares.length; i++) {
      const flare = this.backFlares[i];
      const heat = 1 + Math.sin(this.t * 3.2 + i) * 0.09;
      flare.scale.set(1, heat, 1);
    }
    for (let i = 0; i < this.emberVents.length; i++) {
      const vent = this.emberVents[i];
      const heat = 1 + Math.sin(this.t * 4.1 + i * 0.8) * 0.05;
      vent.scale.set(1, heat, 1);
    }

    // Leg stride: a pronounced alternating step driven by how far the boss actually
    // walks (no foot-slide). Each leg lifts and reaches forward on its swing, plants
    // and pushes back on its stance, with the ankle rolling for heel-strike/toe-off.
    {
      const dxw = this.pos.x - this.prevWalkX;
      const dzw = this.pos.z - this.prevWalkZ;
      this.prevWalkX = this.pos.x;
      this.prevWalkZ = this.pos.z;
      const stepDist = Math.hypot(dxw, dzw);
      const speed2d = stepDist / Math.max(dt, 1e-4);
      const airborne = this.pos.y > 0.4;
      // Advance the cycle with distance walked, plus a small idle creep so a slow
      // shuffle still animates; gait scales the whole motion to movement intensity.
      this.walkPhase += stepDist * 3.0 + (speed2d > 0.2 ? dt * 1.2 : 0);
      const targetGait = airborne ? 0 : Math.min(1, speed2d / 2.0);
      this.gait += (targetGait - this.gait) * Math.min(1, dt * 10);
      const g = this.gait;
      for (let i = 0; i < 2; i++) {
        const s = Math.sin(this.walkPhase + i * Math.PI); // legs in opposite phase
        const lift = Math.max(0, s); // 0 on stance, 1 at peak of swing
        // Reach forward while lifting, drive back while planted.
        this.legs[i].rotation.x = s * 0.85 * g;
        this.legs[i].position.y = this.legBaseY + lift * 0.26 * g;
        // Ankle: toes down as the foot lifts, flat/heel as it plants.
        this.ankles[i].rotation.x = (lift * 0.7 - (1 - lift) * 0.25) * g;
      }

      // Arm motion: counter-swing with the legs while walking, then cock back,
      // raise overhead, or thrust forward depending on the attack. (+rotation.x
      // swings the fist back/up; −rotation.x drives it forward.)
      let armX = 0;
      switch (this.state) {
        case "dashTell": armX = 0.95; break;     // wind both fists back
        case "dashing": armX = -1.15; break;     // drive them forward through the charge
        case "leapTell": armX = 0.75; break;
        case "leap": armX = -2.4; break;         // raise overhead for the smash
        case "guard": armX = -1.95; break;       // braced fists up in front
        case "fanTell": armX = 1.05; break;      // rear back, gathering embers
        case "fissureTell": armX = -2.25; break; // both fists raised to crack the ground
        case "recover":
          // Stay planted over the delivered blow before pulling the fists free.
          armX = this.currentMove === "leap" || this.currentMove === "fissure" || this.currentMove === "guard"
            ? -0.62 * Math.min(1, this.timer * 2) : -0.22 * Math.min(1, this.timer * 2);
          break;
      }
      const armActive = this.state !== "idle" && this.state !== "phaseShift";
      this.armPose += ((armActive ? 1 : 0) - this.armPose) * Math.min(1, dt * 12);
      for (let i = 0; i < this.arms.length; i++) {
        const walkSwing = Math.sin(this.walkPhase + i * Math.PI) * 0.5 * this.gait;
        this.arms[i].rotation.x = walkSwing * (1 - this.armPose) + armX * this.armPose;
        this.arms[i].rotation.z = (i === 0 ? 1 : -1) * 0.05;
      }
    }

    // Dramatic weight: coil on wind-ups, lunge on commits, rear up on phase shifts.
    this.poseForState(dt, this.state, this.state === "idle");

    switch (this.state) {
      case "idle": {
        const d = this.seek(p.pos.x, p.pos.z, dt, 1.05 + this.phase * 0.14);
        this.attackCd -= dt;
        if (this.attackCd <= 0) {
          const move = chooseBossMove(PIT_WARDEN_MOVE_PROFILE, this.phase, this.lastMove, d, this.ctx.rng.next());
          this.lastMove = move.id;
          this.currentMove = move.id;
          this.currentRecovery = move.recovery;
          // An armored brace every 4th action (can't be bursted down).
          if (move.id === "guard") {
            this.beginGuard();
          } else if (move.id === "leap") {
            // The player is kiting — answer from range, or close the gap with a leap.
            this.beginLeap();
          } else if (move.id === "fissure") {
            this.beginFissure();
          } else if (move.id === "fan") {
            this.beginFan();
          } else {
            this.beginDashCombo();
          }
          this.actionCount++;
        }
        break;
      }

      case "dashTell":
        if (this.timer <= 0) {
          this.state = "dashing";
          this.timer = 0.42;
          this.dashHit = false;
          this.ctx.sfx.bossDash();
        }
        break;

      case "dashing": {
        const sp = 17;
        this.pos.x += this.dashDir.x * sp * dt;
        this.pos.z += this.dashDir.y * sp * dt;
        this.heading = Math.atan2(this.dashDir.x, this.dashDir.y);
        if (this.phase >= 3) this.dropPatch();
        if (!this.dashHit && this.distToPlayer() < this.radius + p.radius + 0.4) {
          this.dashHit = true;
          this.ctx.combat.damagePlayer(14, this.pos.x, this.pos.z);
        }
        const wall = ARENA_RADIUS - this.radius;
        const radial = Math.hypot(this.pos.x, this.pos.z);
        if (radial >= wall && this.pos.x * this.dashDir.x + this.pos.z * this.dashDir.y > 0) {
          this.pos.x *= wall / radial;
          this.pos.z *= wall / radial;
          this.dashesLeft = 0;
          this.state = "recover";
          this.timer = 1.5;
          this.applyVulnerable(1.5, 1.35);
          this.ctx.floaters.spawn(this.pos.x, 3.2, this.pos.z, "EXPOSED", "crit");
          this.ctx.fx.burst({ x: this.pos.x, y: 1.3, z: this.pos.z, count: 18, color: [0xb8a38a, 0xe8c68e], speed: [3, 9], up: 0.5, size: [0.08, 0.25], life: [0.25, 0.55], gravity: -6, drag: 3, shape: ParticleShape.shard });
          this.ctx.cam.addTrauma(0.28);
          this.ctx.sfx.bossSlam();
          break;
        }
        if (this.timer <= 0) {
          this.dashesLeft--;
          if (this.dashesLeft > 0) {
            this.aimDash(0.3);
            this.state = "dashTell";
            this.timer = 0.3;
          } else {
            this.state = "recover";
            this.timer = bossRecoverySeconds(this.currentRecovery);
          }
        }
        break;
      }

      case "leapTell":
        if (this.timer <= 0) {
          this.state = "leap";
          this.leapFrom.copy(this.pos);
          this.ctx.sfx.bossLeap();
        }
        break;

      case "leap": {
        this.leapT += dt / 0.62;
        const k = Math.min(1, this.leapT);
        this.pos.x = this.leapFrom.x + (this.leapTo.x - this.leapFrom.x) * k;
        this.pos.z = this.leapFrom.z + (this.leapTo.z - this.leapFrom.z) * k;
        this.pos.y = Math.sin(k * Math.PI) * 4.5;
        if (k >= 1) {
          this.pos.y = 0;
          this.landSlam();
        }
        break;
      }

      case "guard":
        // Planted, invulnerable brace — back off, the quake punishes hugging.
        this.facePlayer(dt);
        if (!this.guardWarned && this.timer <= 0.18) {
          this.guardWarned = true;
          this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: 4.8, color: 0xffffff, duration: 0.22, startRadius: 3.9 });
          this.ctx.fx.burst({
            x: this.pos.x, y: 0.25, z: this.pos.z,
            count: 18, color: [0xff7a3a, 0xffffff],
            speed: [1.5, 5], up: 0.35, size: [0.28, 0.65], life: [0.16, 0.34], gravity: -1.5, drag: 2.4,
          });
        }
        if (this.timer <= 0) {
          this.wardShock(4.8, 18, 0xff7a3a);
          this.ctx.sfx.bossSlam();
          this.state = "recover";
          this.timer = bossRecoverySeconds(this.currentRecovery);
        }
        break;

      case "fanTell":
        this.facePlayer(dt * 0.5);
        if (this.timer <= 0) {
          this.fireFan();
          this.state = "recover";
          this.timer = bossRecoverySeconds(this.currentRecovery);
        }
        break;

      case "fissureTell":
        if (this.timer <= 0) {
          this.eruptFissures();
          this.state = "recover";
          this.timer = bossRecoverySeconds(this.currentRecovery);
        }
        break;

      case "recover":
      case "phaseShift":
        this.facePlayer(dt);
        if (this.timer <= 0) {
          this.state = "idle";
          this.attackCd = Math.max(0.24, 0.78 - this.phase * 0.18);
        }
        break;
    }
  }

  /** An armored ground-brace: invulnerable through a telegraphed quake that punishes melee. */
  private beginGuard(): void {
    this.raiseGuard();
    this.state = "guard";
    this.guardWarned = false;
    this.timer = this.phase === 1 ? 0.95 : 0.85;
    this.warnCircle(this.pos.x, this.pos.z, 4.8, this.timer, 0xff7a3a);
    this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: 4.8, color: 0xffaa44, duration: 0.45, startRadius: 1.0 });
    this.ctx.sfx.bossRoar();
  }

  private beginDashCombo(): void {
    this.dashesLeft = this.phase >= 3 ? 3 : 2;
    const tell = this.phase >= 3 ? 0.4 : 0.48;
    this.aimDash(tell);
    this.state = "dashTell";
    this.timer = tell;
  }

  /** Telegraph duration must match the tell timer so the sweep completing == dash launching. */
  private aimDash(tellDur: number): void {
    const p = this.ctx.player;
    const dx = p.pos.x - this.pos.x;
    const dz = p.pos.z - this.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    this.dashDir.set(dx / len, dz / len);
    // 17 m/s × 0.42 s travel plus the boss's own bulk; width covers
    // radius(1.4) + player(0.5) + grace(0.4) on each side.
    this.warnLine(this.pos.x, this.pos.z, Math.atan2(this.dashDir.x, this.dashDir.y), 8.5, 4.2, tellDur, 0xff5533);
  }

  private beginLeap(): void {
    const p = this.ctx.player;
    this.state = "leapTell";
    this.timer = 0.24;
    this.leapT = 0;
    this.leapFrom.copy(this.pos);
    this.leapTo.set(p.pos.x, 0, p.pos.z);
    this.warnCircle(p.pos.x, p.pos.z, 4.6, 0.86, 0xff7733);
  }

  /** Ranged answer to a kiting player: rear back and belch a spreading fan of
   *  magma bolts. Locked toward the player on wind-up, so dodge sideways. */
  private beginFan(): void {
    const p = this.ctx.player;
    this.state = "fanTell";
    this.timer = 0.65;
    this.fanAngle = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    const n = this.phase >= 3 ? 9 : this.phase >= 2 ? 7 : 5;
    const spread = this.phase >= 3 ? 1.25 : 0.95;
    for (let i = 0; i < n; i++) {
      this.warnLine(this.pos.x, this.pos.z, this.fanAngle + (i - (n - 1) / 2) * spread / (n - 1), 22, 0.68, this.timer, 0xff7733);
    }
    this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: 2.2, color: 0xffaa44, duration: 0.4, startRadius: 0.4 });
    this.ctx.sfx.beamCharge();
  }

  private fireFan(): void {
    const n = this.phase >= 3 ? 9 : this.phase >= 2 ? 7 : 5;
    const spread = this.phase >= 3 ? 1.25 : 0.95;
    for (let i = 0; i < n; i++) {
      const a = this.fanAngle + (i - (n - 1) / 2) * (spread / (n - 1));
      this.ctx.hostiles.fire(this.pos.x, this.pos.z, a, { speed: 8.5, dmg: 10, color: 0xff5522, radius: 0.34 });
    }
    this.ctx.fx.burst({
      x: this.pos.x + Math.sin(this.fanAngle) * 1.2, y: 1.7, z: this.pos.z + Math.cos(this.fanAngle) * 1.2,
      count: 24, color: [0xff5522, 0xffaa44, 0xffffff],
      speed: [4, 12], up: 0.4, size: [0.35, 0.9], life: [0.25, 0.6], gravity: -2, drag: 2.8,
    });
    this.ctx.cam.addTrauma(0.25);
    this.ctx.sfx.enemyShoot();
  }

  /** Slam the ground so fire cracks radiate outward in evenly-spaced spokes —
   *  the player must read the safe wedges between them. */
  private beginFissure(): void {
    this.state = "fissureTell";
    this.timer = 0.82;
    const arms = this.phase >= 3 ? 6 : 4;
    const off = this.ctx.rng.next() * Math.PI;
    this.fissures = [];
    for (let i = 0; i < arms; i++) {
      const angle = off + (i / arms) * Math.PI * 2;
      this.warnLine(this.pos.x, this.pos.z, angle, this.fissureLen, this.fissureHalfW * 2, 0.82, 0xff5533);
      this.fissures.push({ angle });
    }
    this.ctx.sfx.bossRoar();
  }

  private eruptFissures(): void {
    const p = this.ctx.player;
    let hit = false;
    for (const f of this.fissures) {
      const sx = Math.sin(f.angle);
      const cz = Math.cos(f.angle);
      for (let s = 1; s <= 6; s++) {
        const r = (s / 6) * this.fissureLen;
        this.ctx.fx.burst({
          x: this.pos.x + sx * r, y: 0.2, z: this.pos.z + cz * r, count: 2,
          color: [0xff5522, 0xffaa44], speed: [2, 7], up: 1.4, size: [0.35, 0.8], life: [0.25, 0.6], gravity: -4, drag: 2.5,
        });
      }
      if (!hit) {
        const px = p.pos.x - this.pos.x;
        const pz = p.pos.z - this.pos.z;
        const along = px * sx + pz * cz;
        if (along > 0 && along < this.fissureLen) {
          const perp = Math.abs(px * cz - pz * sx);
          if (perp < this.fissureHalfW + p.radius) {
            this.ctx.combat.damagePlayer(this.phase >= 3 ? 16 : 13, this.pos.x, this.pos.z);
            hit = true;
          }
        }
      }
    }
    this.fissures = [];
    this.ctx.cam.addTrauma(0.45);
    this.ctx.stage.punch(0.3);
    this.ctx.sfx.bossSlam();
  }

  private landSlam(): void {
    const R = 4.6;
    const p = this.ctx.player;
    this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: R, color: 0xff7733, duration: 0.5 });
    this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: R * 0.55, color: 0xffffff, duration: 0.35 });
    this.ctx.fx.burst({
      x: this.pos.x, y: 0.5, z: this.pos.z,
      count: 22, color: [0xff7733, 0xccb397, 0x66594e],
      speed: [4, 13], up: 0.9, size: [0.08, 0.28], life: [0.3, 0.7], gravity: -8, drag: 2.5, shape: ParticleShape.shard,
    });
    this.ctx.cam.addTrauma(0.55);
    this.ctx.stage.punch(0.3);
    this.ctx.sfx.bossSlam();
    if (Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) < R + p.radius) {
      this.ctx.combat.damagePlayer(22, this.pos.x, this.pos.z);
    }
    // Phase 2+: the slam wakes adds
    if (this.phase >= 2 && this.actionCount % 2 === 1) {
      const available = Math.max(0, 5 - this.ctx.enemies.living().length);
      for (let i = 0; i < Math.min(2, available); i++) {
        const a = this.ctx.rng.next() * Math.PI * 2;
        this.ctx.enemies.spawn("swarmer", this.pos.x + Math.sin(a) * 5, this.pos.z + Math.cos(a) * 5, 1.0);
      }
    }
    this.state = "recover";
    this.timer = bossRecoverySeconds(this.currentRecovery);
  }

  debugMove(): string {
    return `${this.currentMove ?? "none"}:${this.state}:phase-${this.phase}`;
  }

  debugForceMove(move: string): boolean {
    const phase = PIT_WARDEN_MOVE_PROFILE.find((entry) => entry.phase === this.phase);
    const def = phase?.moves.find((entry) => entry.id === move);
    if (!def) return false;
    this.currentMove = def.id;
    this.lastMove = def.id;
    this.currentRecovery = def.recovery;
    if (def.id === "guard") this.beginGuard();
    else if (def.id === "leap") this.beginLeap();
    else if (def.id === "fissure") this.beginFissure();
    else if (def.id === "fan") this.beginFan();
    else this.beginDashCombo();
    return true;
  }

  private dropPatch(): void {
    // Throttle: one patch per ~0.55 world units of dash travel
    const last = this.patches[this.patches.length - 1];
    if (last && Math.hypot(last.x - this.pos.x, last.z - this.pos.z) < 1.4) return;
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff5522, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.patchGeo, mat);
    mesh.position.set(this.pos.x, 0.04, this.pos.z);
    this.ctx.stage.scene.add(mesh);
    this.patches.push({ x: this.pos.x, z: this.pos.z, life: 3, mesh, mat, acc: 0 });
  }

  private updatePatches(dt: number): void {
    const p = this.ctx.player;
    for (let i = this.patches.length - 1; i >= 0; i--) {
      const pt = this.patches[i];
      pt.life -= dt;
      pt.mat.opacity = Math.min(0.45, pt.life * 0.5);
      if (Math.random() < dt * 6) { // cosmetic: fx/jitter — NOT sim state (must stay off ctx.rng)
        this.ctx.fx.burst({
          x: pt.x, y: 0.1, z: pt.z, count: 1, color: 0xff7733,
          speed: [0.3, 1], up: 1.5, vertical: 0.2, size: [0.3, 0.5], life: [0.4, 0.8], gravity: 0.5, drag: 1, jitter: 0.8,
        });
      }
      pt.acc -= dt;
      if (pt.acc <= 0 && Math.hypot(p.pos.x - pt.x, p.pos.z - pt.z) < 1.2 + p.radius) {
        if (this.ctx.combat.damagePlayer(5, pt.x, pt.z) === "hit") pt.acc = 0.5;
      }
      if (pt.life <= 0) {
        this.ctx.stage.scene.remove(pt.mesh);
        pt.mat.dispose();
        this.patches.splice(i, 1);
      }
    }
  }
}
