import * as THREE from "three";
import { ARENA_RADIUS } from "../render/arena";
import { Enemy, type EnemyKind } from "./enemies";
import type { Ctx } from "./ctx";

const PHASE_LINES = [
  "THE GLASS CROWN AWAKENS",
  "THE SPIRE SPLITS ITS SHADOW",
  "ALL LANCES SEEK ONE HEART",
];

type SpireState = "idle" | "track" | "channel" | "recover" | "phaseShift" | "guard";

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
/** Shared beam geometry — reused for every lance (no per-shot allocation). */
const LANCE_GEO = new THREE.BoxGeometry(0.45, 0.45, LANCE_LEN);

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
  private timer = 1.0;
  private attackCd = 1.1;
  private lanceCount = 0;
  private attacksSinceGuard = 0;
  private blinkCd = 0;
  private pending: PendingLance[] = [];
  private echoes: Echo[] = [];
  private beams: Beam[] = [];
  private channelStep = 0;
  private channelTimer = 0;
  private channelFired = false;
  private orbGroup: THREE.Group;
  private coreMat: THREE.MeshStandardMaterial;
  private trimMat: THREE.MeshStandardMaterial;
  private robeMat: THREE.MeshStandardMaterial;
  private crownOrb: THREE.Mesh;
  private haloRings: THREE.Object3D[] = [];
  private finPanels: THREE.Object3D[] = [];
  private robeStrips: THREE.Object3D[] = [];
  private playerVel = new THREE.Vector2();
  private lastPlayer = new THREE.Vector2();
  private channelsSinceShift = 0;
  /** 0→1 wind-up read: orbs pull inward and the core surges while charging an attack. */
  private chargeAmt = 0;
  // Per-phase appearance escalation (built once, revealed on transition).
  private shardRing: THREE.Group;
  private p2Shards: THREE.Object3D[] = [];
  private p3Crown: THREE.Object3D[] = [];

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 1550;
    this.speed = 3.3;
    this.radius = 1.0;
    this.wardColor = 0x3effd2;

    // Dimmer glass robe so the bright crystalline crown/fins/orbs read as the
    // glowing "glass crown" against a darker body — value contrast the old
    // brighter-teal silhouette lacked (it blurred into one glowing blob).
    const robeMat = this.stdMat(0x0a201e, 0x105046, 0.48);
    const trimMat = this.stdMat(0x081a16, 0x2affc8, 1.2);
    this.coreMat = this.stdMat(0x06201a, 0x3effd2, 2.4);
    this.robeMat = robeMat;
    this.trimMat = trimMat;

    const robe = this.addMesh(new THREE.CylinderGeometry(0.35, 1.05, 2.6, 6), robeMat, 0, 1.3);
    robe.castShadow = true;
    this.addMesh(new THREE.TorusGeometry(1.05, 0.1, 8, 24), trimMat, 0, 0.18).rotation.x = Math.PI / 2;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const strip = this.addMesh(new THREE.BoxGeometry(0.09, 1.58, 0.08), trimMat, Math.sin(a) * 0.74, 1.22, Math.cos(a) * 0.74);
      strip.rotation.y = a;
      strip.rotation.z = Math.sin(a) * 0.08;
      this.robeStrips.push(strip);
    }
    this.crownOrb = this.addMesh(new THREE.SphereGeometry(0.38, 10, 8), trimMat, 0, 3.0);
    this.addMesh(new THREE.BoxGeometry(0.5, 0.3, 0.3), this.coreMat, 0, 1.7, 0.5);
    // The lance focus: a forward aperture the echo-lances pour out of — echoes the
    // Sentinel's beam-lens motif so the glass artillerist reads as artillery.
    this.addMesh(new THREE.TorusGeometry(0.26, 0.06, 6, 24), trimMat, 0, 1.7, 0.62).rotation.x = 0;
    this.addMesh(new THREE.CircleGeometry(0.22, 18), this.coreMat, 0, 1.7, 0.64);
    for (const sx of [-1, 1]) {
      const guide = this.addMesh(new THREE.ConeGeometry(0.05, 0.5, 4), trimMat, sx * 0.34, 1.7, 0.6);
      guide.rotation.x = Math.PI / 2;
    }
    for (const sx of [-1, 1]) {
      const fin = this.addMesh(new THREE.BoxGeometry(0.12, 1.45, 0.46), trimMat, sx * 0.72, 1.55, 0.05);
      fin.rotation.z = sx * -0.26;
      fin.rotation.y = sx * 0.18;
      this.finPanels.push(fin);
      const prism = this.addMesh(new THREE.OctahedronGeometry(0.18), this.coreMat, sx * 0.62, 2.35, 0.36);
      prism.scale.y = 1.55;
      prism.rotation.z = sx * 0.25;
      this.finPanels.push(prism);
    }
    const lowerHalo = this.addMesh(new THREE.TorusGeometry(0.72, 0.035, 6, 36), trimMat, 0, 2.62);
    lowerHalo.rotation.x = Math.PI / 2;
    const crownHalo = this.addMesh(new THREE.TorusGeometry(0.58, 0.025, 6, 36), this.coreMat, 0, 3.14);
    crownHalo.rotation.x = Math.PI / 2;
    const tiltedHalo = this.addMesh(new THREE.TorusGeometry(0.92, 0.026, 6, 36), this.coreMat, 0, 2.88);
    tiltedHalo.rotation.set(0.95, 0.24, 0.55);
    this.haloRings.push(lowerHalo, crownHalo, tiltedHalo);

    // Orbiting crystal orbs
    this.orbGroup = new THREE.Group();
    this.orbGroup.position.y = 2.1;
    this.root.add(this.orbGroup);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      this.addMesh(new THREE.OctahedronGeometry(0.22), this.coreMat, Math.sin(a) * 1.1, 0, Math.cos(a) * 1.1, this.orbGroup);
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const chip = this.addMesh(new THREE.TetrahedronGeometry(0.08), trimMat, Math.sin(a) * 1.36, Math.cos(a * 2) * 0.16, Math.cos(a) * 1.36, this.orbGroup);
      chip.rotation.set(a, a * 1.7, 0);
    }

    this.lastPlayer.set(ctx.player.pos.x, ctx.player.pos.z);

    // Phase shard-ring orbits the spire's waist; parented to root so dispose() frees it.
    this.shardRing = new THREE.Group();
    this.shardRing.position.y = 1.6;
    this.root.add(this.shardRing);
    this.buildPhaseLooks();
  }

  /** Pre-build the escalation geometry hidden until its phase unveils it. */
  private buildPhaseLooks(): void {
    // Phase 2: a slow ring of glass shards splits off and orbits the body.
    const shardMat = this.stdMat(0x0a3a30, 0x2affc8, 1.6);
    const shardGeo = new THREE.OctahedronGeometry(0.28);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const sh = this.addMesh(shardGeo, shardMat, Math.sin(a) * 1.7, 0, Math.cos(a) * 1.7, this.shardRing);
      sh.rotation.y = a;
      sh.visible = false;
      this.p2Shards.push(sh);
    }

    // Phase 3: a jagged glass crown of upward lances flares around the head.
    const crownMat = this.stdMat(0x0a4438, 0xbfffe8, 2.8);
    const spikeGeo = new THREE.ConeGeometry(0.13, 0.9, 4);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const sp = this.addMesh(spikeGeo, crownMat, Math.sin(a) * 0.45, 3.35, Math.cos(a) * 0.45);
      sp.rotation.x = Math.cos(a) * 0.45;
      sp.rotation.z = -Math.sin(a) * 0.45;
      sp.visible = false;
      this.p3Crown.push(sp);
    }
  }

  /** Visibly escalate the boss at each phase transition. */
  private applyPhaseLook(phase: number): void {
    if (phase === 2) {
      this.setBossScale(1.08);
      this.eruptReveal(this.p2Shards);
      this.robeMat.emissive.set(0x1aa884);
      this.robeMat.emissiveIntensity = 1.0;
      this.trimMat.emissive.set(0x6affe0);
      this.coreMat.emissive.set(0x8affe8);
    } else if (phase === 3) {
      this.setBossScale(1.15);
      this.eruptReveal(this.p3Crown);
      this.robeMat.color.set(0x103a4a);
      this.trimMat.emissive.set(0xbfffe8);
      this.trimMat.emissiveIntensity = 1.8;
      this.coreMat.emissive.set(0xdcffff);
    }
    for (const f of this.flashMats) {
      f.baseEmissive.copy(f.mat.emissive);
      f.baseIntensity = f.mat.emissiveIntensity;
    }
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
      this.applyPhaseLook(this.phase);
      this.ctx.events.emit("BOSS_PHASE", { phase: this.phase, line: PHASE_LINES[this.phase - 1] });
      this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: 8, color: 0x3effd2, duration: 0.7 });
      this.ctx.fx.burst({
        x: this.pos.x, y: 2.2, z: this.pos.z,
        count: 46, color: [0x3effd2, 0xbfffe8, 0xffffff],
        speed: [4, 12], up: 0.8, size: [0.4, 1.0], life: [0.4, 0.9], gravity: -3, drag: 2.5,
      });
      this.ctx.cam.addTrauma(0.45);
      this.ctx.stage.punch(0.3);
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
      b.mat.dispose(); // geometry is shared (LANCE_GEO) — never disposed
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
    const mesh = new THREE.Mesh(LANCE_GEO, mat);
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

  /** Glass ward: invulnerable behind a shard shell, then a close shard-burst punish. */
  private beginGuard(): void {
    this.setInvuln(1.5);
    this.state = "guard";
    this.timer = 0.65; // wind-up = telegraph duration
    this.ctx.tele.circle(this.pos.x, this.pos.z, 4.4, 0.65, 0x3effd2);
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
          this.ctx.hostiles.fire(this.pos.x, this.pos.z, a, { speed: this.phase >= 3 ? 11 : 9, dmg: 7, color: 0x55ffcc, radius: 0.28 });
        }
        this.ctx.sfx.enemyShoot();
        this.channelFired = false;
        this.channelStep++;
        // The frenzied third-phase channel reloads faster, leaning on the bolt-fan.
        this.channelTimer = this.phase >= 3 ? 0.42 : 0.7;
      }
    }
    if (this.channelStep >= 3) {
      this.state = "recover";
      this.timer = 0.65;
    }
  }

  private fanAngles: number[] = [];

  // ---------------------------------------------------------------- tick
  protected tick(dt: number): void {
    const p = this.ctx.player;
    this.timer -= dt;
    this.blinkCd -= dt;
    // Wind-up read: while charging a lance/channel/ward, the orbs spin up and pull
    // inward and the whole crown brightens — then it all snaps loose on the fire.
    const charging = this.state === "track" || this.state === "channel" || this.state === "guard";
    this.chargeAmt += ((charging ? 1 : 0) - this.chargeAmt) * Math.min(1, dt * 6);
    this.orbGroup.rotation.y += dt * (1.2 + this.phase * 0.5 + this.chargeAmt * 3);
    this.orbGroup.scale.setScalar(1 - this.chargeAmt * 0.22);
    this.shardRing.rotation.y -= dt * (0.8 + this.phase * 0.4 + this.chargeAmt * 2);
    this.coreMat.emissiveIntensity = 2.4 + Math.sin(this.t * (2 + this.phase)) * 0.8 + this.chargeAmt * 2.6;
    this.pos.y = Math.sin(this.t * 1.8) * 0.12;
    this.crownOrb.scale.setScalar(1 + Math.sin(this.t * 2.4) * 0.045 + this.chargeAmt * 0.32);
    for (let i = 0; i < this.haloRings.length; i++) {
      const ring = this.haloRings[i];
      ring.rotation.z += dt * (0.22 + i * 0.09) * (i % 2 === 0 ? 1 : -1);
    }
    for (let i = 0; i < this.finPanels.length; i++) {
      const panel = this.finPanels[i];
      panel.rotation.x = Math.sin(this.t * 1.7 + i) * 0.045;
      // Fins flare open as the artillerist charges, a clear "about to fire" tell.
      panel.scale.y = 1 + Math.sin(this.t * 2.2 + i * 0.8) * 0.035 + this.chargeAmt * 0.16;
    }
    for (let i = 0; i < this.robeStrips.length; i++) {
      const strip = this.robeStrips[i];
      strip.scale.y = 1 + Math.sin(this.t * 1.35 + i) * 0.025;
    }

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
        b.mat.dispose(); // shared geometry (LANCE_GEO) is not disposed
        this.beams.splice(i, 1);
      }
    }
    // Echo shimmer
    for (const e of this.echoes) {
      e.mat.opacity = 0.28 + Math.sin(this.t * 3 + e.x) * 0.1;
      e.group.rotation.y += dt * 0.6;
    }

    // Dramatic weight: coil while channeling/guarding, lunge on casts, rear on phase shifts.
    this.poseForState(dt, this.state, this.state === "idle");

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
          this.attacksSinceGuard++;
          // A glass ward every 3rd action — invulnerable while it punishes anyone point-blank.
          if (this.attacksSinceGuard >= 3) {
            this.attacksSinceGuard = 0;
            this.beginGuard();
          } else if (this.phase >= 2 && this.channelsSinceShift === 0) {
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
          this.timer = this.phase >= 3 ? 0.32 : 0.5;
        }
        break;
      case "channel":
        this.facePlayer(dt * 0.5);
        this.tickChannel(dt);
        break;
      case "guard":
        this.facePlayer(dt * 0.5);
        if (this.timer <= 0) {
          this.wardShock(4.4, 16, 0x3effd2);
          // A radial shard burst so rushing the glass crown point-blank is punished.
          for (let i = 0; i < 8; i++) {
            this.ctx.hostiles.fire(this.pos.x, this.pos.z, (i / 8) * Math.PI * 2, { speed: 8, dmg: 7, color: 0x55ffcc, radius: 0.28 });
          }
          this.ctx.sfx.enemyShoot();
          this.state = "recover";
          this.timer = 0.6;
        }
        break;
      case "recover":
      case "phaseShift":
        if (this.timer <= 0) {
          this.state = "idle";
          // Phase 3 (the Spire's frenzy) fires markedly faster between volleys.
          const base = this.phase >= 3 ? 0.42 : this.phase === 2 ? 0.9 : 1.1;
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
