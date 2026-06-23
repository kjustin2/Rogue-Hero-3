import * as THREE from "three";
import { Enemy, type EnemyKind } from "./enemies";
import type { Ctx } from "./ctx";

interface FirePatch {
  x: number;
  z: number;
  life: number;
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  acc: number;
}

type BossState = "idle" | "dashTell" | "dashing" | "leap" | "slamTell" | "recover" | "phaseShift" | "guard";

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
  private slamCount = 0;
  private attackCd = 0.5;
  private guardWarned = false;
  private coreMat: THREE.MeshStandardMaterial;
  private eyeMat: THREE.MeshStandardMaterial;
  private core: THREE.Mesh;
  private chainLinks: THREE.Mesh[] = [];
  private backFlares: THREE.Object3D[] = [];
  private emberVents: THREE.Object3D[] = [];
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
  private walkPhase = 0;
  private gait = 0;
  private prevWalkX = 0;
  private prevWalkZ = 0;

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 1300;
    this.speed = 3.7;
    this.radius = 1.4;
    this.wardColor = 0xff7a3a;

    const hide = this.stdMat(0x4a1d1d, 0x550808, 0.3);
    const plate = this.stdMat(0x2a1518);
    const horn = this.stdMat(0xc9b8a0);
    const chain = this.stdMat(0x180d0b, 0xff7733, 0.55);
    const emberPlate = this.stdMat(0x3a0d06, 0xffaa44, 1.2);
    this.coreMat = this.stdMat(0x331111, 0xff4422, 1.8);
    this.eyeMat = this.stdMat(0x000000, 0xffaa22, 3);
    this.hide = hide;
    this.plate = plate;

    // Massive torso, hunched forward
    const torso = this.addMesh(new THREE.BoxGeometry(2.2, 1.7, 1.5), hide, 0, 1.7);
    torso.rotation.x = 0.25;
    this.core = this.addMesh(new THREE.BoxGeometry(1.0, 0.7, 0.5), this.coreMat, 0, 1.65, 0.78); // molten chest core
    // Layered frame around the core so the torso reads as armor over heat, not one block.
    this.addMesh(new THREE.BoxGeometry(1.18, 0.1, 0.16), emberPlate, 0, 2.03, 0.86);
    this.addMesh(new THREE.BoxGeometry(1.12, 0.1, 0.16), emberPlate, 0, 1.26, 0.86);
    for (const sx of [-1, 1]) {
      const rib = this.addMesh(new THREE.BoxGeometry(0.14, 0.78, 0.16), emberPlate, sx * 0.62, 1.64, 0.88);
      rib.rotation.z = sx * 0.12;
      this.emberVents.push(rib);
    }
    this.addMesh(new THREE.BoxGeometry(1.6, 0.9, 1.1), plate, 0, 0.6, 0); // hips
    this.addMesh(new THREE.BoxGeometry(1.85, 0.22, 1.18), chain, 0, 1.02, 0.08);
    this.addMesh(new THREE.BoxGeometry(0.55, 0.18, 1.2), emberPlate, -0.56, 0.78, 0.12);
    this.addMesh(new THREE.BoxGeometry(0.55, 0.18, 1.2), emberPlate, 0.56, 0.78, 0.12);
    // Head low between shoulders
    const head = this.addMesh(new THREE.BoxGeometry(0.85, 0.7, 0.8), plate, 0, 2.45, 0.55);
    head.rotation.x = 0.15;
    this.addMesh(new THREE.BoxGeometry(0.16, 0.12, 0.1), this.eyeMat, -0.22, 2.5, 0.98);
    this.addMesh(new THREE.BoxGeometry(0.16, 0.12, 0.1), this.eyeMat, 0.22, 2.5, 0.98);
    // Horns
    const hornL = this.addMesh(new THREE.ConeGeometry(0.18, 0.9, 5), horn, -0.55, 2.85, 0.45);
    hornL.rotation.z = 0.55;
    const hornR = this.addMesh(new THREE.ConeGeometry(0.18, 0.9, 5), horn, 0.55, 2.85, 0.45);
    hornR.rotation.z = -0.55;
    // Gorilla arms with huge fists
    this.addMesh(new THREE.BoxGeometry(0.55, 1.6, 0.55), hide, -1.35, 1.3, 0.2);
    this.addMesh(new THREE.BoxGeometry(0.55, 1.6, 0.55), hide, 1.35, 1.3, 0.2);
    this.addMesh(new THREE.BoxGeometry(0.85, 0.7, 0.85), plate, -1.35, 0.35, 0.2);
    this.addMesh(new THREE.BoxGeometry(0.85, 0.7, 0.85), plate, 1.35, 0.35, 0.2);
    for (const sx of [-1, 1]) {
      const pauldron = this.addMesh(new THREE.BoxGeometry(0.72, 0.28, 0.9), emberPlate, sx * 1.15, 2.05, 0.08);
      pauldron.rotation.z = sx * -0.2;
      const brace = this.addMesh(new THREE.BoxGeometry(0.72, 0.18, 0.5), chain, sx * 1.35, 0.78, 0.52);
      brace.rotation.z = sx * -0.12;
      this.chainLinks.push(brace);
      const elbowBand = this.addMesh(new THREE.BoxGeometry(0.66, 0.14, 0.64), emberPlate, sx * 1.35, 1.08, 0.2);
      elbowBand.rotation.z = sx * -0.16;
      this.emberVents.push(elbowBand);
      for (let i = 0; i < 3; i++) {
        const claw = this.addMesh(new THREE.ConeGeometry(0.08, 0.42, 4), emberPlate, sx * (1.12 + i * 0.16), 0.2, 0.72);
        claw.rotation.x = Math.PI / 2;
        claw.rotation.z = sx * 0.18;
      }
    }
    const chainA = this.addMesh(new THREE.BoxGeometry(1.55, 0.12, 0.12), chain, -0.05, 1.95, 0.93);
    chainA.rotation.z = 0.32;
    const chainB = this.addMesh(new THREE.BoxGeometry(1.35, 0.1, 0.1), chain, 0.08, 1.78, 0.95);
    chainB.rotation.z = -0.35;
    this.chainLinks.push(chainA, chainB);
    for (let i = 0; i < 5; i++) {
      const link = this.addMesh(new THREE.BoxGeometry(0.32, 0.08, 0.12), chain, -0.58 + i * 0.29, 1.86 + Math.sin(i) * 0.06, 1.07);
      link.rotation.z = i % 2 === 0 ? 0.55 : -0.42;
      this.chainLinks.push(link);
    }
    this.addMesh(new THREE.BoxGeometry(0.28, 0.28, 0.12), emberPlate, 0, 1.84, 1.02).rotation.z = Math.PI / 4;
    // Stubby legs — each on a hip-pivoted group so it swings through a walk cycle,
    // with the boot kept on its own pivot so the ankle can roll for toe-off/heel-strike.
    for (const sx of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(sx * 0.55, 0.62, -0.15);
      this.root.add(leg);
      this.addMesh(new THREE.BoxGeometry(0.6, 0.74, 0.7), hide, 0, -0.37, 0, leg);
      // Ankle pivot near the bottom of the shin; the boot hangs off it.
      const ankle = new THREE.Group();
      ankle.position.set(0, -0.66, 0.05);
      leg.add(ankle);
      const boot = this.addMesh(new THREE.BoxGeometry(0.76, 0.18, 0.85), plate, 0, 0, 0.18, ankle);
      boot.rotation.z = sx * 0.04;
      this.legs.push(leg); // [0] = left, [1] = right
      this.ankles.push(ankle);
    }
    this.prevWalkX = x;
    this.prevWalkZ = z;
    // Back furnace flares give the silhouette a professional layered read from every angle.
    for (let i = 0; i < 5; i++) {
      const x = (i - 2) * 0.38;
      const flare = this.addMesh(new THREE.ConeGeometry(0.12, 0.72 - Math.abs(i - 2) * 0.06, 4), emberPlate, x, 2.05 - Math.abs(i - 2) * 0.08, -0.74);
      flare.rotation.x = -0.9;
      flare.rotation.z = (i - 2) * 0.08;
      this.backFlares.push(flare);
    }

    this.patchGeo = new THREE.CircleGeometry(1.2, 24);
    this.patchGeo.rotateX(-Math.PI / 2);

    this.buildPhaseLooks();
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
      const sp = this.addMesh(spikeGeo, spikeMat, x, y, z);
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
      const fang = this.addMesh(fangGeo, crownMat, Math.sin(a) * 0.62, 2.95, 0.55 + Math.cos(a) * 0.4);
      fang.rotation.x = Math.cos(a) * 0.35;
      fang.rotation.z = -Math.sin(a) * 0.35;
      fang.visible = false;
      this.p3Crown.push(fang);
    }
    const knuckleGeo = new THREE.BoxGeometry(0.95, 0.3, 0.95);
    for (const fx of [-1.35, 1.35]) {
      const k = this.addMesh(knuckleGeo, crownMat, fx, 0.7, 0.2);
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
      this.hide.emissiveIntensity = 0.5;
      this.coreMat.emissive.set(0xff6622);
      this.eyeMat.emissive.set(0xffcc33);
    } else if (phase === 3) {
      this.setBossScale(1.15);
      this.eruptReveal(this.p3Crown);
      this.plate.emissive.set(0x551200);
      this.plate.emissiveIntensity = 0.6;
      this.coreMat.emissive.set(0xffaa44);
      this.eyeMat.emissive.set(0xffffff);
      this.eyeMat.emissiveIntensity = 4.5;
    }
    // Re-baseline flash registration so hit-flash settles to the NEW look.
    for (const f of this.flashMats) {
      f.baseEmissive.copy(f.mat.emissive);
      f.baseIntensity = f.mat.emissiveIntensity;
    }
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
    for (const pt of this.patches) {
      this.ctx.stage.scene.remove(pt.mesh);
      pt.mat.dispose();
    }
    this.patches = [];
    this.patchGeo.dispose();
    this.ctx.events.emit("BOSS_DEFEATED", { x: this.pos.x, z: this.pos.z });
    super.die();
  }

  protected tick(dt: number): void {
    const p = this.ctx.player;
    this.timer -= dt;
    this.updatePatches(dt);

    // Core breathes faster as phases climb
    this.coreMat.emissiveIntensity = 1.8 + this.phase * 0.5 + Math.sin(this.t * (2 + this.phase * 2)) * 0.7;
    const corePulse = 1 + Math.sin(this.t * (2.6 + this.phase * 0.65)) * 0.055;
    this.core.scale.set(1 + (corePulse - 1) * 1.2, 1 + (corePulse - 1) * 0.75, 1 + (corePulse - 1) * 1.45);
    for (let i = 0; i < this.chainLinks.length; i++) {
      const link = this.chainLinks[i];
      link.rotation.y = Math.sin(this.t * 1.45 + i * 0.7) * 0.045;
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
        this.legs[i].position.y = 0.62 + lift * 0.26 * g;
        // Ankle: toes down as the foot lifts, flat/heel as it plants.
        this.ankles[i].rotation.x = (lift * 0.7 - (1 - lift) * 0.25) * g;
      }
    }

    // Dramatic weight: coil on wind-ups, lunge on commits, rear up on phase shifts.
    this.poseForState(dt, this.state, this.state === "idle");

    switch (this.state) {
      case "idle": {
        const d = this.seek(p.pos.x, p.pos.z, dt, 1.05 + this.phase * 0.14);
        this.tryContactDamageBoss();
        this.attackCd -= dt;
        if (this.attackCd <= 0) {
          // Pick an attack: an armored brace every 3rd swing (can't be bursted down),
          // slams enter the pool at phase 2.
          if (this.slamCount % 3 === 2) {
            this.beginGuard();
          } else if (this.phase >= 2 && (this.slamCount % 2 === 0 || d > 9)) {
            this.beginLeap();
          } else {
            this.beginDashCombo();
          }
          this.slamCount++;
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
        if (this.timer <= 0) {
          this.dashesLeft--;
          if (this.dashesLeft > 0) {
            this.aimDash(0.3);
            this.state = "dashTell";
            this.timer = 0.3;
          } else {
            this.state = "recover";
            this.timer = 0.55;
          }
        }
        break;
      }

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
          this.timer = 0.6;
        }
        break;

      case "slamTell":
      case "recover":
      case "phaseShift":
        this.facePlayer(dt);
        if (this.timer <= 0) {
          this.state = "idle";
          this.attackCd = Math.max(0.28, 0.85 - this.phase * 0.18);
        }
        break;
    }
  }

  /** An armored ground-brace: invulnerable through a telegraphed quake that punishes melee. */
  private beginGuard(): void {
    this.setInvuln(1.4);
    this.state = "guard";
    this.guardWarned = false;
    this.timer = 0.74; // wind-up = telegraph duration
    this.ctx.tele.circle(this.pos.x, this.pos.z, 4.8, 0.74, 0xff7a3a);
    this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: 4.8, color: 0xffaa44, duration: 0.45, startRadius: 1.0 });
    this.ctx.sfx.bossRoar();
  }

  private tryContactDamageBoss(): void {
    if (this.contactCd > 0) return;
    const p = this.ctx.player;
    if (this.distToPlayer() < this.radius + p.radius + 0.3) {
      if (this.ctx.combat.damagePlayer(9, this.pos.x, this.pos.z) === "hit") {
        this.contactCd = 1.0;
      }
    }
  }

  private beginDashCombo(): void {
    this.dashesLeft = this.phase >= 3 ? 4 : 2;
    const tell = this.phase >= 3 ? 0.34 : 0.38;
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
    this.ctx.tele.line(this.pos.x, this.pos.z, Math.atan2(this.dashDir.x, this.dashDir.y), 8.5, 4.2, tellDur, 0xff5533);
  }

  private beginLeap(): void {
    const p = this.ctx.player;
    this.state = "leap";
    this.leapT = 0;
    this.leapFrom.copy(this.pos);
    this.leapTo.set(p.pos.x, 0, p.pos.z);
    this.ctx.tele.circle(p.pos.x, p.pos.z, 4.6, 0.62, 0xff7733);
    this.ctx.sfx.bossLeap();
  }

  private landSlam(): void {
    const R = 4.6;
    const p = this.ctx.player;
    this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: R, color: 0xff7733, duration: 0.5 });
    this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: R * 0.55, color: 0xffffff, duration: 0.35 });
    this.ctx.fx.burst({
      x: this.pos.x, y: 0.5, z: this.pos.z,
      count: 40, color: [0xff7733, 0xffcc66, 0x885544],
      speed: [4, 13], up: 0.9, size: [0.5, 1.1], life: [0.3, 0.8], gravity: -8, drag: 2.5,
    });
    this.ctx.cam.addTrauma(0.55);
    this.ctx.stage.punch(0.3);
    this.ctx.sfx.bossSlam();
    if (Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) < R + p.radius) {
      this.ctx.combat.damagePlayer(22, this.pos.x, this.pos.z);
    }
    // Phase 2+: the slam wakes adds
    if (this.phase >= 2 && this.slamCount % 2 === 1 && this.ctx.enemies.living().length < 5) {
      for (let i = 0; i < 2; i++) {
        const a = Math.random() * Math.PI * 2;
        this.ctx.enemies.spawn("swarmer", this.pos.x + Math.sin(a) * 5, this.pos.z + Math.cos(a) * 5, 1.0);
      }
    }
    this.state = "recover";
    this.timer = 0.7;
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
      if (Math.random() < dt * 6) {
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
