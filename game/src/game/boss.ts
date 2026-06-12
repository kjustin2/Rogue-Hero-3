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

type BossState = "idle" | "dashTell" | "dashing" | "leap" | "slamTell" | "recover" | "phaseShift";

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
  private timer = 2.2;
  private dashDir = new THREE.Vector2();
  private dashesLeft = 0;
  private dashHit = false;
  private leapFrom = new THREE.Vector3();
  private leapTo = new THREE.Vector3();
  private leapT = 0;
  private slamCount = 0;
  private attackCd = 2.2;
  private coreMat: THREE.MeshStandardMaterial;
  private eyeMat: THREE.MeshStandardMaterial;
  private patches: FirePatch[] = [];
  private patchGeo: THREE.CircleGeometry;

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 380;
    this.speed = 3.0;
    this.radius = 1.4;

    const hide = this.stdMat(0x4a1d1d, 0x550808, 0.3);
    const plate = this.stdMat(0x2a1518);
    const horn = this.stdMat(0xc9b8a0);
    this.coreMat = this.stdMat(0x331111, 0xff4422, 1.8);
    this.eyeMat = this.stdMat(0x000000, 0xffaa22, 3);

    // Massive torso, hunched forward
    const torso = this.addMesh(new THREE.BoxGeometry(2.2, 1.7, 1.5), hide, 0, 1.7);
    torso.rotation.x = 0.25;
    this.addMesh(new THREE.BoxGeometry(1.0, 0.7, 0.5), this.coreMat, 0, 1.65, 0.78); // molten chest core
    this.addMesh(new THREE.BoxGeometry(1.6, 0.9, 1.1), plate, 0, 0.6, 0); // hips
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
    // Stubby legs
    this.addMesh(new THREE.BoxGeometry(0.6, 0.7, 0.7), hide, -0.55, 0.25, -0.15);
    this.addMesh(new THREE.BoxGeometry(0.6, 0.7, 0.7), hide, 0.55, 0.25, -0.15);

    this.patchGeo = new THREE.CircleGeometry(1.2, 24);
    this.patchGeo.rotateX(-Math.PI / 2);
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
      this.state = "phaseShift";
      this.timer = 1.2;
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

    switch (this.state) {
      case "idle": {
        const d = this.seek(p.pos.x, p.pos.z, dt, 0.9 + this.phase * 0.12);
        this.tryContactDamageBoss();
        this.attackCd -= dt;
        if (this.attackCd <= 0) {
          // Pick an attack: slams enter the pool at phase 2
          if (this.phase >= 2 && (this.slamCount % 2 === 0 || d > 9)) {
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
            this.timer = 0.8;
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

      case "slamTell":
      case "recover":
      case "phaseShift":
        this.facePlayer(dt);
        if (this.timer <= 0) {
          this.state = "idle";
          this.attackCd = Math.max(0.7, 2.4 - this.phase * 0.45);
        }
        break;
    }
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
    this.aimDash(0.45);
    this.state = "dashTell";
    this.timer = 0.45;
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
    this.timer = 1.0;
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
