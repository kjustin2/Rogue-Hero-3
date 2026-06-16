import * as THREE from "three";
import { Enemy, type EnemyKind } from "./enemies";
import type { Ctx } from "./ctx";

const ECHO_CORE = 0x9fe8ff;
const ECHO_EDGE = 0x3aa0ff;

const PHASE_LINES = [
  "I AM WHAT THE RIFT REMEMBERS OF YOU. FASTER. CRUELER.",
  "YOU CANNOT OUTRUN YOUR OWN REFLECTION.",
];

const LANE_LEN = 24;
const LANE_W = 2.6;
const LANE_TELL = 0.6;

type EchoState = "idle" | "lungeTell" | "novaTell" | "recover" | "phaseShift" | "guard";

interface PendingLane { x: number; z: number; angle: number; timer: number; }
interface PendingNova { x: number; z: number; count: number; timer: number; }

/**
 * The Rift Echo — a hidden superboss (an optional "Rift Tear" node in Acts IV–V): a
 * fast spectral duelist that mirrors the hero. Two telegraphed attacks — a dashing
 * lane-strike and a radial bolt nova — escalating across two phases. Every attack
 * telegraphs (the fairness contract). Optional, hard, and pays a relic.
 */
export class RiftEcho extends Enemy {
  readonly kind: EnemyKind = "boss";
  phase = 1;
  private state: EchoState = "idle";
  private timer = 1.4;
  private attackPick = 0;
  private lanes: PendingLane[] = [];
  private novas: PendingNova[] = [];
  private lockAngle = 0;

  private coreMat: THREE.MeshStandardMaterial;
  private ringMat: THREE.MeshStandardMaterial;
  private rings: THREE.Group;

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 1750;
    this.speed = 4.8;
    this.radius = 1.3;
    this.wardColor = ECHO_CORE;

    this.coreMat = this.stdMat(0x0a1626, ECHO_CORE, 2.6);
    this.ringMat = this.stdMat(0x0a1422, ECHO_EDGE, 1.4);

    // A bright crystalline core
    this.addMesh(new THREE.OctahedronGeometry(0.8, 0), this.coreMat, 0, 2.0);
    this.addMesh(new THREE.OctahedronGeometry(0.45, 0), this.coreMat, 0, 2.0);
    // Cage of spectral blades
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const blade = this.addMesh(new THREE.ConeGeometry(0.12, 1.3, 4), this.ringMat, Math.sin(a) * 0.9, 2.0, Math.cos(a) * 0.9);
      blade.rotation.set(Math.PI, a, 0);
    }
    this.addMesh(new THREE.CylinderGeometry(0.4, 1.1, 0.7, 6), this.ringMat, 0, 0.4);

    // Counter-spinning ring
    this.rings = new THREE.Group();
    this.rings.position.y = 2.0;
    this.root.add(this.rings);
    const r1 = this.addMesh(new THREE.TorusGeometry(1.8, 0.08, 6, 32), this.ringMat, 0, 0, 0, this.rings);
    r1.rotation.x = Math.PI / 2;
  }

  protected deathColor(): number { return ECHO_CORE; }
  protected barHeight(): number { return 4.2; }

  takeDamage(amount: number, opts = {}): boolean {
    const killed = super.takeDamage(amount, { ...opts, kb: 0 });
    this.ctx.events.emit("BOSS_HP", { hp: Math.max(0, this.hp), maxHp: this.maxHp });
    if (!killed && this.phase === 1 && this.hp <= this.maxHp * 0.5) {
      this.phase = 2;
      this.state = "phaseShift";
      this.timer = 1.1;
      this.speed = 6.2;
      this.coreMat.emissive.set(0xffffff);
      this.coreMat.emissiveIntensity = 3.4;
      this.ringMat.emissive.set(ECHO_CORE);
      for (const f of this.flashMats) { f.baseEmissive.copy(f.mat.emissive); f.baseIntensity = f.mat.emissiveIntensity; }
      this.ctx.events.emit("BOSS_PHASE", { phase: 2, line: PHASE_LINES[1] });
      this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: 9, color: ECHO_CORE, duration: 0.7 });
      this.ctx.cam.addTrauma(0.5);
      this.ctx.sfx.bossRoar();
    }
    return killed;
  }

  freeze(duration: number): void { super.freeze(duration * 0.4); }

  die(): void {
    this.lanes = [];
    this.novas = [];
    this.ctx.events.emit("BOSS_DEFEATED", { x: this.pos.x, z: this.pos.z });
    super.die();
  }

  // ---------------------------------------------------------------- attacks
  private beginLunge(): void {
    this.state = "lungeTell";
    this.timer = LANE_TELL;
    const p = this.ctx.player;
    this.lockAngle = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    const fan = this.phase >= 2 ? 2 : 1;
    for (let i = 0; i < fan; i++) {
      const angle = this.lockAngle + (fan === 1 ? 0 : (i - 0.5) * 0.5);
      this.ctx.tele.line(this.pos.x, this.pos.z, angle, LANE_LEN, LANE_W, LANE_TELL, ECHO_CORE);
      this.lanes.push({ x: this.pos.x, z: this.pos.z, angle, timer: LANE_TELL });
    }
    this.ctx.sfx.beamCharge();
  }

  private fireLane(l: PendingLane): void {
    const p = this.ctx.player;
    const sx = Math.sin(l.angle);
    const cz = Math.cos(l.angle);
    // Dash the body along the lane + hitscan the player.
    this.pos.x = l.x + sx * 9;
    this.pos.z = l.z + cz * 9;
    this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: 2.4, color: ECHO_CORE, duration: 0.35 });
    this.ctx.fx.burst({ x: l.x + sx * 5, y: 1, z: l.z + cz * 5, count: 24, color: [ECHO_CORE, 0xffffff], speed: [4, 13], up: 0.5, size: [0.3, 0.8], life: [0.2, 0.5], gravity: -3, drag: 3 });
    this.ctx.sfx.beamFire();
    this.ctx.cam.addTrauma(0.22);
    const px = p.pos.x - l.x;
    const pz = p.pos.z - l.z;
    const along = px * sx + pz * cz;
    if (along > 0 && along < LANE_LEN) {
      const perp = Math.abs(px * cz - pz * sx);
      if (perp < LANE_W * 0.5 + p.radius) this.ctx.combat.damagePlayer(this.phase >= 2 ? 20 : 16, l.x, l.z);
    }
  }

  private beginNova(): void {
    this.state = "novaTell";
    this.timer = 0.7;
    const count = this.phase >= 2 ? 18 : 12;
    this.ctx.tele.circle(this.pos.x, this.pos.z, 3.0, 0.7, ECHO_EDGE);
    this.novas.push({ x: this.pos.x, z: this.pos.z, count, timer: 0.7 });
    this.ctx.sfx.beamCharge();
  }

  private fireNova(nv: PendingNova): void {
    const base = Math.atan2(this.ctx.player.pos.x - nv.x, this.ctx.player.pos.z - nv.z);
    for (let i = 0; i < nv.count; i++) {
      const a = base + (i / nv.count) * Math.PI * 2;
      this.ctx.hostiles.fire(nv.x, nv.z, a, { speed: 9, dmg: 8, color: ECHO_EDGE, radius: 0.3 });
    }
    this.ctx.fx.ring(nv.x, nv.z, { radius: 3, color: ECHO_EDGE, duration: 0.4 });
    this.ctx.cam.addTrauma(0.2);
    this.ctx.sfx.enemyShoot();
  }

  // ---------------------------------------------------------------- tick
  protected tick(dt: number): void {
    const p = this.ctx.player;
    this.timer -= dt;
    this.coreMat.emissiveIntensity = 2.6 + this.phase * 0.4 + Math.sin(this.t * 4) * 0.6;
    this.rings.rotation.y += dt * (1.5 + this.phase);
    this.pos.y = 0.3 + Math.sin(this.t * 2) * 0.12;

    for (let i = this.novas.length - 1; i >= 0; i--) {
      this.novas[i].timer -= dt;
      if (this.novas[i].timer <= 0) { this.fireNova(this.novas[i]); this.novas.splice(i, 1); }
    }
    for (let i = this.lanes.length - 1; i >= 0; i--) {
      this.lanes[i].timer -= dt;
      if (this.lanes[i].timer <= 0) { this.fireLane(this.lanes[i]); this.lanes.splice(i, 1); }
    }

    switch (this.state) {
      case "idle": {
        const d = this.distToPlayer();
        this.facePlayer(dt);
        if (d > 6) this.seek(p.pos.x, p.pos.z, dt, 0.92);
        else { const ang = Math.atan2(this.pos.x - p.pos.x, this.pos.z - p.pos.z) + 0.8 * dt; this.seek(p.pos.x + Math.sin(ang) * d, p.pos.z + Math.cos(ang) * d, dt, 0.58); }
        if (this.timer <= 0) this.pickAttack();
        break;
      }
      case "lungeTell":
        if (this.timer <= 0 && this.lanes.length === 0) { this.state = "recover"; this.timer = 0.42; }
        break;
      case "novaTell":
        this.facePlayer(dt * 0.5);
        if (this.timer <= 0 && this.novas.length === 0) { this.state = "recover"; this.timer = 0.42; }
        break;
      case "guard":
        this.facePlayer(dt * 0.5);
        if (this.timer <= 0) { this.wardShock(4.2, 16, ECHO_CORE); this.state = "recover"; this.timer = 0.45; }
        break;
      case "recover":
      case "phaseShift":
        this.facePlayer(dt);
        if (this.timer <= 0) { this.state = "idle"; this.timer = Math.max(0.4, 1.25 - this.phase * 0.28); }
        break;
    }
  }

  private pickAttack(): void {
    this.attackPick++;
    // A phase ward every 3rd attack — a quick invulnerable blink + close nova.
    if (this.attackPick % 3 === 2) { this.beginGuard(); return; }
    if (this.attackPick % 2 === 0) this.beginLunge();
    else this.beginNova();
  }

  /** Phase ward: a fast invulnerable flicker, then a close nova that punishes hugging. */
  private beginGuard(): void {
    this.setInvuln(1.3);
    this.state = "guard";
    this.timer = 0.6; // wind-up = telegraph duration
    this.ctx.tele.circle(this.pos.x, this.pos.z, 4.2, 0.6, ECHO_CORE);
    this.ctx.sfx.beamCharge();
  }
}
