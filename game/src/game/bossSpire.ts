import * as THREE from "three";
import { ARENA_RADIUS } from "../render/arena";
import { Enemy, type EnemyKind } from "./enemies";
import type { Ctx } from "./ctx";

const PHASE_LINES = [
  "THE GLASS CROWN AWAKENS",
  "THE SPIRE SPLITS ITS SHADOW",
  "ALL LANCES SEEK ONE HEART",
];

type SpireState = "idle" | "track" | "channel" | "recover" | "phaseShift";

interface PendingLance {
  x: number;
  z: number;
  angle: number;
  timer: number;
  /** Echo lances don't re-echo. */
  fromEcho: boolean;
}

interface Echo {
  group: THREE.Group;
  mat: THREE.MeshBasicMaterial;
  x: number;
  z: number;
}

interface Beam {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  fade: number;
}

const LANCE_LEN = 18;
const LANCE_TELL = 0.45;

/**
 * Act II boss: a kiting glass artillerist. Phase 1 telegraphed hitscan
 * lances; phase 2 roots into rotating bolt-fan channels and splits off two
 * mirror echoes that re-fire every lance from their own positions (each with
 * its own full telegraph — the fairness contract holds); phase 3 fires
 * triple convergence lances through your predicted position.
 */
export class SpireCaster extends Enemy {
  readonly kind: EnemyKind = "boss";
  phase = 1;
  private state: SpireState = "idle";
  private timer = 2.0;
  private attackCd = 2.4;
  private lanceCount = 0;
  private blinkCd = 0;
  private pending: PendingLance[] = [];
  private echoes: Echo[] = [];
  private beams: Beam[] = [];
  private channelStep = 0;
  private channelTimer = 0;
  private channelFired = false;
  private orbGroup: THREE.Group;
  private coreMat: THREE.MeshStandardMaterial;
  private playerVel = new THREE.Vector2();
  private lastPlayer = new THREE.Vector2();
  private channelsSinceShift = 0;

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 440;
    this.speed = 2.7;
    this.radius = 1.0;

    const robeMat = this.stdMat(0x0c2a24, 0x14705c, 0.7);
    const trimMat = this.stdMat(0x081a16, 0x2affc8, 1.2);
    this.coreMat = this.stdMat(0x06201a, 0x3effd2, 2.4);

    const robe = this.addMesh(new THREE.CylinderGeometry(0.35, 1.05, 2.6, 6), robeMat, 0, 1.3);
    robe.castShadow = true;
    this.addMesh(new THREE.TorusGeometry(1.05, 0.1, 8, 24), trimMat, 0, 0.18).rotation.x = Math.PI / 2;
    this.addMesh(new THREE.SphereGeometry(0.38, 10, 8), trimMat, 0, 3.0);
    this.addMesh(new THREE.BoxGeometry(0.5, 0.3, 0.3), this.coreMat, 0, 1.7, 0.5);

    // Orbiting crystal orbs
    this.orbGroup = new THREE.Group();
    this.orbGroup.position.y = 2.1;
    this.root.add(this.orbGroup);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      this.addMesh(new THREE.OctahedronGeometry(0.22), this.coreMat, Math.sin(a) * 1.1, 0, Math.cos(a) * 1.1, this.orbGroup);
    }

    this.lastPlayer.set(ctx.player.pos.x, ctx.player.pos.z);
  }

  protected deathColor(): number {
    return 0x3effd2;
  }

  protected barHeight(): number {
    return 3.8;
  }

  takeDamage(amount: number, opts = {}): boolean {
    const killed = super.takeDamage(amount, { ...opts, kb: 0 });
    this.ctx.events.emit("BOSS_HP", { hp: Math.max(0, this.hp), maxHp: this.maxHp });

    const frac = this.hp / this.maxHp;
    const targetPhase = frac <= 0.35 ? 3 : frac <= 0.7 ? 2 : 1;
    if (!killed && targetPhase > this.phase) {
      this.phase = targetPhase;
      this.state = "phaseShift";
      this.timer = 1.2;
      this.channelsSinceShift = 0;
      this.ctx.events.emit("BOSS_PHASE", { phase: this.phase, line: PHASE_LINES[this.phase - 1] });
      this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: 8, color: 0x3effd2, duration: 0.7 });
      this.ctx.cam.addTrauma(0.45);
      this.ctx.sfx.bossRoar();
      if (this.phase === 2) {
        this.spawnEchoes();
        for (let i = 0; i < 2; i++) {
          const a = Math.random() * Math.PI * 2;
          this.ctx.enemies.spawn("wisp", Math.sin(a) * 8, Math.cos(a) * 8, 1.2);
        }
      }
    }
    return killed;
  }

  freeze(duration: number): void {
    super.freeze(duration * 0.5);
    // Cancel an un-telegraphed aim; queued (telegraphed) lances still land
    if (this.state === "track") {
      this.state = "recover";
      this.timer = 0.6;
    }
  }

  die(): void {
    this.disposeExtras();
    this.ctx.events.emit("BOSS_DEFEATED", { x: this.pos.x, z: this.pos.z });
    super.die();
  }

  dispose(): void {
    this.disposeExtras();
    super.dispose();
  }

  private disposeExtras(): void {
    for (const e of this.echoes) {
      this.ctx.stage.scene.remove(e.group);
      e.mat.dispose();
      e.group.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
    }
    this.echoes = [];
    for (const b of this.beams) {
      this.ctx.stage.scene.remove(b.mesh);
      b.mesh.geometry.dispose();
      b.mat.dispose();
    }
    this.beams = [];
    this.pending = [];
  }

  // ---------------------------------------------------------------- echoes
  private spawnEchoes(): void {
    // Static mirrors of the boss's position: across center, and rotated 90°
    const spots: [number, number][] = [
      [-this.pos.x, -this.pos.z],
      [this.pos.z, -this.pos.x],
    ];
    for (const [ex, ez] of spots) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x3effd2, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const group = new THREE.Group();
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.9, 2.4, 6), mat);
      cone.position.y = 1.2;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), mat);
      head.position.y = 2.8;
      group.add(cone, head);
      group.position.set(ex, 0, ez);
      this.ctx.stage.scene.add(group);
      this.echoes.push({ group, mat, x: ex, z: ez });
      this.ctx.fx.burst({
        x: ex, y: 1.4, z: ez,
        count: 18, color: 0x3effd2, speed: [1, 5], up: 0.6, size: [0.3, 0.7], life: [0.3, 0.6], gravity: -1, drag: 3,
      });
    }
    this.ctx.sfx.spawn();
  }

  // ---------------------------------------------------------------- lances
  /** Telegraph + queue a lance. Echo copies are scheduled when it fires. */
  private queueLance(x: number, z: number, angle: number, fromEcho: boolean): void {
    this.ctx.tele.line(x, z, angle, LANCE_LEN, 2.0, LANCE_TELL, 0x3effd2);
    this.pending.push({ x, z, angle, timer: LANCE_TELL, fromEcho });
    if (!fromEcho) this.ctx.sfx.beamCharge();
  }

  private fireLance(l: PendingLance): void {
    const p = this.ctx.player;
    const sx = Math.sin(l.angle);
    const cz = Math.cos(l.angle);
    // Visual beam
    const mat = new THREE.MeshBasicMaterial({
      color: 0xaaffe8, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, LANCE_LEN), mat);
    mesh.position.set(l.x + sx * LANCE_LEN * 0.5, 1.2, l.z + cz * LANCE_LEN * 0.5);
    mesh.rotation.y = l.angle;
    this.ctx.stage.scene.add(mesh);
    this.beams.push({ mesh, mat, fade: 0.9 });
    this.ctx.sfx.beamFire();
    this.ctx.cam.addTrauma(0.12);

    // Hitscan
    const px = p.pos.x - l.x;
    const pz = p.pos.z - l.z;
    const along = px * sx + pz * cz;
    if (along > 0 && along < LANCE_LEN) {
      const perp = Math.abs(px * cz - pz * sx);
      if (perp < 0.55 + p.radius) this.ctx.combat.damagePlayer(16, l.x, l.z);
    }

    // Echo re-fire (telegraphed from the echo's own position)
    if (!l.fromEcho) {
      for (const e of this.echoes) {
        this.queueLance(e.x, e.z, l.angle, true);
      }
    }
  }

  private beginLanceVolley(): void {
    const p = this.ctx.player;
    this.lanceCount++;
    const aim = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    if (this.phase >= 3 && this.lanceCount % 2 === 0) {
      this.beginConvergence();
      return;
    }
    const doubles = this.lanceCount % 3 === 0;
    const n = doubles ? (this.phase >= 3 ? 3 : 2) : 1;
    for (let i = 0; i < n; i++) {
      // Parallel lanes offset perpendicular to the aim
      const off = n === 1 ? 0 : (i - (n - 1) / 2) * 2.6;
      const ox = Math.cos(aim) * off;
      const oz = -Math.sin(aim) * off;
      this.queueLance(this.pos.x + ox, this.pos.z + oz, aim, false);
    }
  }

  private beginConvergence(): void {
    const p = this.ctx.player;
    // Lead the player; all three origins lance through that point
    const tx = p.pos.x + this.playerVel.x * 0.6;
    const tz = p.pos.z + this.playerVel.y * 0.6;
    this.ctx.tele.circle(tx, tz, 1.4, 0.75, 0x3effd2);
    const origins: [number, number][] = [[this.pos.x, this.pos.z], ...this.echoes.map((e) => [e.x, e.z] as [number, number])];
    for (const [ox, oz] of origins) {
      const ang = Math.atan2(tx - ox, tz - oz);
      this.ctx.tele.line(ox, oz, ang, LANCE_LEN, 2.0, 0.75, 0x3effd2);
      this.pending.push({ x: ox, z: oz, angle: ang, timer: 0.75, fromEcho: true });
    }
    this.ctx.sfx.beamCharge();
  }

  // ---------------------------------------------------------------- channel
  private beginChannel(): void {
    this.state = "channel";
    this.channelStep = 0;
    this.channelTimer = 0;
    this.channelFired = false;
    this.channelsSinceShift++;
  }

  private tickChannel(dt: number): void {
    const p = this.ctx.player;
    this.channelTimer -= dt;
    if (this.channelTimer <= 0 && this.channelStep < 3) {
      if (!this.channelFired) {
        // Lock and telegraph this volley's fan
        const aim = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z) + this.channelStep * 0.26;
        const n = this.phase >= 3 ? 7 : 5;
        this.fanAngles = [];
        for (let i = 0; i < n; i++) {
          const a = aim + (i - (n - 1) / 2) * 0.21;
          this.fanAngles.push(a);
          this.ctx.tele.line(this.pos.x, this.pos.z, a, 11, 1.0, 0.4, 0x55ffcc);
        }
        this.channelFired = true;
        this.channelTimer = 0.4;
      } else {
        for (const a of this.fanAngles) {
          this.ctx.hostiles.fire(this.pos.x, this.pos.z, a, { speed: 9, dmg: 7, color: 0x55ffcc, radius: 0.28 });
        }
        this.ctx.sfx.enemyShoot();
        this.channelFired = false;
        this.channelStep++;
        this.channelTimer = 0.7;
      }
    }
    if (this.channelStep >= 3) {
      this.state = "recover";
      this.timer = 0.9;
    }
  }

  private fanAngles: number[] = [];

  // ---------------------------------------------------------------- tick
  protected tick(dt: number): void {
    const p = this.ctx.player;
    this.timer -= dt;
    this.blinkCd -= dt;
    this.orbGroup.rotation.y += dt * (1.2 + this.phase * 0.5);
    this.coreMat.emissiveIntensity = 2.4 + Math.sin(this.t * (2 + this.phase)) * 0.8;
    this.pos.y = Math.sin(this.t * 1.8) * 0.12;

    // Player velocity estimate (for convergence leads)
    const vx = (p.pos.x - this.lastPlayer.x) / Math.max(dt, 0.001);
    const vz = (p.pos.z - this.lastPlayer.y) / Math.max(dt, 0.001);
    this.playerVel.x += (vx - this.playerVel.x) * Math.min(1, dt * 8);
    this.playerVel.y += (vz - this.playerVel.y) * Math.min(1, dt * 8);
    this.lastPlayer.set(p.pos.x, p.pos.z);

    // Pending lances always advance — even mid-blink or phase shift
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const l = this.pending[i];
      l.timer -= dt;
      if (l.timer <= 0) {
        this.pending.splice(i, 1);
        this.fireLance(l);
      }
    }
    // Beam visuals fade
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.fade -= dt * 3.2;
      b.mat.opacity = Math.max(0, b.fade);
      if (b.fade <= 0) {
        this.ctx.stage.scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        b.mat.dispose();
        this.beams.splice(i, 1);
      }
    }
    // Echo shimmer
    for (const e of this.echoes) {
      e.mat.opacity = 0.28 + Math.sin(this.t * 3 + e.x) * 0.1;
      e.group.rotation.y += dt * 0.6;
    }

    switch (this.state) {
      case "idle": {
        const d = this.distToPlayer();
        this.facePlayer(dt);
        // Kite band 9–14
        if (d < 9) this.seek(this.pos.x * 2 - p.pos.x, this.pos.z * 2 - p.pos.z, dt, 0.9);
        else if (d > 14) this.seek(p.pos.x, p.pos.z, dt, 0.8);
        // Panic blink when cornered
        if (d < 5.5 && this.blinkCd <= 0) this.blink();

        if (this.timer <= 0) {
          // Channel periodically from phase 2 on
          if (this.phase >= 2 && this.channelsSinceShift === 0) {
            this.beginChannel();
          } else {
            this.state = "track";
            this.timer = 0.5;
          }
        }
        break;
      }
      case "track":
        this.facePlayer(dt * 1.4);
        if (this.timer <= 0) {
          this.beginLanceVolley();
          this.state = "recover";
          this.timer = 0.7;
        }
        break;
      case "channel":
        this.facePlayer(dt * 0.5);
        this.tickChannel(dt);
        break;
      case "recover":
      case "phaseShift":
        if (this.timer <= 0) {
          this.state = "idle";
          const base = this.phase >= 3 ? 1.5 : this.phase === 2 ? 1.9 : 2.3;
          // Roughly every 4th attack in P2+ is a channel
          if (this.phase >= 2 && this.lanceCount % 4 === 3) this.channelsSinceShift = 0;
          this.attackCd = base;
          this.timer = this.attackCd;
        }
        break;
    }
  }

  private blink(): void {
    this.blinkCd = this.phase >= 3 ? 2.0 : 3.0;
    const fromX = this.pos.x;
    const fromZ = this.pos.z;
    const a = Math.random() * Math.PI * 2;
    const r = 10 + Math.random() * 3;
    this.pos.x = Math.max(-1, Math.min(1, Math.sin(a))) * Math.min(r, ARENA_RADIUS - 3);
    this.pos.z = Math.max(-1, Math.min(1, Math.cos(a))) * Math.min(r, ARENA_RADIUS - 3);
    for (const [bx, bz] of [[fromX, fromZ], [this.pos.x, this.pos.z]] as const) {
      this.ctx.fx.burst({
        x: bx, y: 1.5, z: bz,
        count: 16, color: 0x3effd2, speed: [1, 6], up: 0.6, size: [0.35, 0.7], life: [0.25, 0.5], gravity: -1, drag: 3,
      });
    }
    this.ctx.sfx.spawn();
  }
}
