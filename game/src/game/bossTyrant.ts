import * as THREE from "three";
import { ARENA_RADIUS } from "../render/arena";
import { Enemy, type EnemyKind } from "./enemies";
import type { Ctx } from "./ctx";

const PHASE_LINES = [
  "THE RIFT ENGINE TURNS",
  "YOUR WORLD IS FUEL",
  "ALL THINGS COLLAPSE INWARD",
];

const RIFT_CYAN = 0x33e8ff;
const RIFT_VIOLET = 0x9a4dff;

type TyrantState = "idle" | "novaTell" | "lanceTrack" | "lanceTell" | "crossfireTell" | "slamTell" | "radialTell" | "stormTell" | "recover" | "phaseShift" | "guard";

/** A queued radial nova: telegraphed first, then fires a hostile-projectile ring on expiry. */
interface PendingNova {
  x: number;
  z: number;
  count: number;
  spin: number;
  timer: number;
}

/** A queued sweeping lance: locked angle, telegraphed line, fires hitscan on expiry. */
interface PendingLance {
  x: number;
  z: number;
  angle: number;
  timer: number;
}

/** A queued ground-slam shockwave: telegraphed circle, then radial damage on expiry.
 *  `light` detonations (the scattered rift-storm) land with cheaper FX + less force. */
interface PendingSlam {
  x: number;
  z: number;
  radius: number;
  timer: number;
  light?: boolean;
}

/** A spawned visual beam from a fired lance — fades out on its own clock. */
interface Beam {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  fade: number;
}

const LANCE_LEN = 20;
const LANCE_WIDTH = 2.2;
const LANCE_TELL = 0.42;
/** Shared rift-lance geometry — reused for every lance (no per-shot allocation). */
const TYRANT_LANCE_GEO = new THREE.BoxGeometry(LANCE_WIDTH, 0.5, LANCE_LEN);

/**
 * The Rift Tyrant — engine-of-the-rift boss. A hovering reactor of dark plating
 * around a caged rift-cyan core, crowned by a counter-spinning violet halo of
 * rift-shards. It does not chase so much as orbit and dictate space.
 *
 * Phase 1: radial novas of rift-bolts and a single tracking lance.
 * Phase 2: faster cadence, twin parallel lances, summons rift husks.
 * Phase 3: ground-slam shockwave rings layered with denser, spinning novas.
 * Every attack telegraphs — the fairness contract holds.
 */
export class RiftTyrant extends Enemy {
  readonly kind: EnemyKind = "boss";
  phase = 1;
  private state: TyrantState = "idle";
  private timer = 0.8;
  private attackCd = 0.85;
  private attackPick = 0;
  private novas: PendingNova[] = [];
  private lances: PendingLance[] = [];
  private slams: PendingSlam[] = [];
  private beams: Beam[] = [];
  private lockAngle = 0;
  /** 0→1 wind-up read: the caged core blazes and the halo spins up while charging. */
  private chargeAmt = 0;
  private coreMat: THREE.MeshStandardMaterial;
  private haloMat: THREE.MeshStandardMaterial;
  private plateMat: THREE.MeshStandardMaterial;
  private trimMat: THREE.MeshStandardMaterial;
  private hull: THREE.Mesh;
  private core: THREE.Mesh;
  private halo: THREE.Group;
  private shellL: THREE.Mesh;
  private shellR: THREE.Mesh;
  private cageStruts: THREE.Object3D[] = [];
  private ventPanels: THREE.Object3D[] = [];
  private stabilizers: THREE.Object3D[] = [];
  // Per-phase appearance escalation (built once, revealed on transition).
  private shardRing: THREE.Group;
  private p2Shards: THREE.Object3D[] = [];
  private p3Crown: THREE.Object3D[] = [];

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 1900;
    this.speed = 2.9;
    this.radius = 1.6;
    this.wardColor = RIFT_VIOLET;

    const plateMat = this.stdMat(0x14161f, 0x1b1030, 0.4);
    const trimMat = this.stdMat(0x0d1a24, RIFT_VIOLET, 0.9);
    this.coreMat = this.stdMat(0x06121a, RIFT_CYAN, 2.6);
    this.haloMat = this.stdMat(0x140a26, RIFT_VIOLET, 1.8);
    this.plateMat = plateMat;
    this.trimMat = trimMat;

    // Hovering octahedral hull — a faceted "engine block", point-down menace
    this.hull = this.addMesh(new THREE.OctahedronGeometry(1.7, 0), plateMat, 0, 2.0);
    this.hull.scale.set(1.0, 1.4, 1.0);
    this.hull.castShadow = true;
    // Exposed rift core inside the cage
    this.core = this.addMesh(new THREE.IcosahedronGeometry(0.7, 0), this.coreMat, 0, 2.0);
    this.addMesh(new THREE.TorusGeometry(0.86, 0.035, 6, 28), this.coreMat, 0, 2.0).rotation.x = Math.PI / 2;
    // Caging struts around the core
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const strut = this.addMesh(new THREE.BoxGeometry(0.14, 1.9, 0.14), trimMat, Math.sin(a) * 0.85, 2.0, Math.cos(a) * 0.85);
      strut.rotation.x = Math.sin(a) * 0.18;
      strut.rotation.z = Math.cos(a) * 0.18;
      this.cageStruts.push(strut);
    }
    // Heavy split shoulder vents that flare during attacks
    this.shellL = this.addMesh(new THREE.BoxGeometry(0.9, 1.4, 1.6), plateMat, -1.55, 2.0, 0);
    this.shellR = this.addMesh(new THREE.BoxGeometry(0.9, 1.4, 1.6), plateMat, 1.55, 2.0, 0);
    this.shellL.rotation.z = 0.25;
    this.shellR.rotation.z = -0.25;
    this.ventPanels.push(this.addMesh(new THREE.BoxGeometry(0.5, 0.9, 0.2), this.coreMat, -1.55, 2.0, 0.85));
    this.ventPanels.push(this.addMesh(new THREE.BoxGeometry(0.5, 0.9, 0.2), this.coreMat, 1.55, 2.0, 0.85));
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const vent = this.addMesh(new THREE.BoxGeometry(0.12, 0.54, 0.12), this.haloMat, sx * 1.18, 1.55 + i * 0.3, 1.03);
        vent.rotation.z = sx * 0.12;
        this.ventPanels.push(vent);
      }
    }
    // A jagged crown spike
    this.addMesh(new THREE.ConeGeometry(0.35, 1.6, 5), trimMat, 0, 3.9);
    // Skirt that anchors the silhouette to the floor
    this.addMesh(new THREE.CylinderGeometry(0.5, 1.3, 1.0, 6), plateMat, 0, 0.5);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const fin = this.addMesh(new THREE.BoxGeometry(0.12, 0.64, 0.32), trimMat, Math.sin(a) * 0.92, 0.9, Math.cos(a) * 0.92);
      fin.rotation.y = a;
      fin.rotation.z = Math.sin(a) * 0.22;
      this.stabilizers.push(fin);
    }

    // Counter-spinning halo of rift shards
    this.halo = new THREE.Group();
    this.halo.position.y = 2.0;
    this.root.add(this.halo);
    this.addMesh(new THREE.TorusGeometry(2.1, 0.08, 8, 32), this.haloMat, 0, 0, 0, this.halo).rotation.x = Math.PI / 2;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const shard = this.addMesh(new THREE.OctahedronGeometry(0.26), this.haloMat, Math.sin(a) * 2.1, 0, Math.cos(a) * 2.1, this.halo);
      shard.rotation.y = a;
    }
    const tiltedHalo = this.addMesh(new THREE.TorusGeometry(1.62, 0.045, 8, 36), this.coreMat, 0, 0, 0, this.halo);
    tiltedHalo.rotation.set(1.0, 0.35, 0.45);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const fang = this.addMesh(new THREE.ConeGeometry(0.12, 0.8, 4), this.trimMat, Math.sin(a) * 1.65, 0.05, Math.cos(a) * 1.65, this.halo);
      fang.rotation.set(Math.PI / 2, a, 0);
    }

    // A second, tighter shard ring unveiled across phases; parented to root so dispose() frees it.
    this.shardRing = new THREE.Group();
    this.shardRing.position.y = 2.0;
    this.root.add(this.shardRing);
    this.buildPhaseLooks();
  }

  /** Pre-build the escalation geometry hidden until its phase unveils it. */
  private buildPhaseLooks(): void {
    // Phase 2: a denser inner ring of rift shards splits off and counter-orbits.
    const shardMat = this.stdMat(0x1a0a30, 0xc070ff, 2.0);
    const shardGeo = new THREE.OctahedronGeometry(0.3);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const sh = this.addMesh(shardGeo, shardMat, Math.sin(a) * 1.25, 0, Math.cos(a) * 1.25, this.shardRing);
      sh.rotation.y = a;
      sh.visible = false;
      this.p2Shards.push(sh);
    }

    // Phase 3: a violet-white crown of rift spikes erupts above the hull as it collapses inward.
    const crownMat = this.stdMat(0x2a0a40, 0xe6d0ff, 3.0);
    const spikeGeo = new THREE.ConeGeometry(0.16, 1.1, 4);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const sp = this.addMesh(spikeGeo, crownMat, Math.sin(a) * 0.6, 3.55, Math.cos(a) * 0.6);
      sp.rotation.x = Math.cos(a) * 0.4;
      sp.rotation.z = -Math.sin(a) * 0.4;
      sp.visible = false;
      this.p3Crown.push(sp);
    }
  }

  /** Visibly escalate the boss at each phase transition. */
  private applyPhaseLook(phase: number): void {
    if (phase === 2) {
      this.setBossScale(1.08);
      this.eruptReveal(this.p2Shards);
      this.plateMat.emissive.set(0x2e1a52);
      this.plateMat.emissiveIntensity = 0.7;
      this.trimMat.emissive.set(0xb060ff);
      this.haloMat.emissive.set(0xc070ff);
    } else if (phase === 3) {
      this.setBossScale(1.15);
      this.eruptReveal(this.p3Crown);
      this.plateMat.color.set(0x241a3a);
      this.trimMat.emissive.set(0xe6d0ff);
      this.trimMat.emissiveIntensity = 1.6;
      this.coreMat.emissive.set(0xeafaff);
      this.haloMat.emissive.set(0xf0e0ff);
    }
    for (const f of this.flashMats) {
      f.baseEmissive.copy(f.mat.emissive);
      f.baseIntensity = f.mat.emissiveIntensity;
    }
  }

  protected deathColor(): number {
    return RIFT_CYAN;
  }

  protected barHeight(): number {
    return 4.6;
  }

  takeDamage(amount: number, opts = {}): boolean {
    // Bosses shrug off knockback
    const killed = super.takeDamage(amount, { ...opts, kb: 0 });
    this.ctx.events.emit("BOSS_HP", { hp: Math.max(0, this.hp), maxHp: this.maxHp });

    const frac = this.hp / this.maxHp;
    const targetPhase = frac <= 0.33 ? 3 : frac <= 0.66 ? 2 : 1;
    if (!killed && targetPhase > this.phase) {
      this.phase = targetPhase;
      this.state = "phaseShift";
      this.timer = 1.2;
      this.applyPhaseLook(this.phase);
      this.ctx.events.emit("BOSS_PHASE", { phase: this.phase, line: PHASE_LINES[this.phase - 1] });
      this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: 9, color: RIFT_VIOLET, duration: 0.75 });
      this.ctx.fx.burst({
        x: this.pos.x, y: 2.2, z: this.pos.z,
        count: 48, color: [RIFT_CYAN, RIFT_VIOLET, 0xffffff],
        speed: [4, 13], up: 0.8, size: [0.4, 1.0], life: [0.4, 0.9], gravity: -4, drag: 2.5,
      });
      this.ctx.cam.addTrauma(0.5);
      this.ctx.stage.punch(0.3);
      this.ctx.sfx.bossRoar();
      // Rift implosion shoves the player outward
      const p = this.ctx.player;
      const dx = p.pos.x - this.pos.x;
      const dz = p.pos.z - this.pos.z;
      const len = Math.hypot(dx, dz) || 1;
      this.ctx.controller.push((dx / len) * 8, (dz / len) * 8);
      // Phase 2 wakes a pair of rift husks
      if (this.phase === 2) this.summonAdds(2);
    }
    return killed;
  }

  freeze(duration: number): void {
    // An engine is hard to stall; queued (telegraphed) attacks still land.
    super.freeze(duration * 0.4);
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
    for (const b of this.beams) {
      this.ctx.stage.scene.remove(b.mesh);
      b.mat.dispose(); // geometry is shared (TYRANT_LANCE_GEO) — never disposed
    }
    this.beams = [];
    this.novas = [];
    this.lances = [];
    this.slams = [];
  }

  // ---------------------------------------------------------------- adds
  private summonAdds(n: number): void {
    if (this.ctx.enemies.living().length >= 6) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 7 + Math.random() * 3;
      const x = Math.max(-1, Math.min(1, Math.sin(a))) * Math.min(r, ARENA_RADIUS - 3);
      const z = Math.max(-1, Math.min(1, Math.cos(a))) * Math.min(r, ARENA_RADIUS - 3);
      // Light, modest adds — husks in P2, faster swarmers once critical
      this.ctx.enemies.spawn(this.phase >= 3 ? "swarmer" : "husk", x, z, 1.1);
    }
  }

  /** Rift bulwark: a barrier seals the engine (invulnerable), then a close rift nova. */
  private beginGuard(): void {
    this.setInvuln(1.6);
    this.state = "guard";
    this.timer = 0.7; // wind-up = telegraph duration
    this.ctx.tele.circle(this.pos.x, this.pos.z, 4.6, 0.7, RIFT_VIOLET);
    this.ctx.sfx.beamCharge();
  }

  // ---------------------------------------------------------------- nova
  private beginNova(): void {
    this.state = "novaTell";
    this.timer = 0.6;
    const count = this.phase >= 3 ? 18 : this.phase === 2 ? 13 : 10;
    const spin = this.phase >= 3 ? (Math.random() < 0.5 ? -1 : 1) * 0.4 : 0;
    // The whole ring is the threat — mark it with a circle the player must escape.
    this.ctx.tele.circle(this.pos.x, this.pos.z, 3.2, 0.6, RIFT_CYAN);
    this.novas.push({ x: this.pos.x, z: this.pos.z, count, spin, timer: 0.6 });
    this.ctx.sfx.beamCharge();
  }

  private fireNova(nv: PendingNova): void {
    const base = Math.atan2(this.ctx.player.pos.x - nv.x, this.ctx.player.pos.z - nv.z) + nv.spin;
    for (let i = 0; i < nv.count; i++) {
      const a = base + (i / nv.count) * Math.PI * 2;
      this.ctx.hostiles.fire(nv.x, nv.z, a, { speed: 8.5, dmg: 9, color: RIFT_CYAN, radius: 0.3 });
    }
    this.ctx.fx.ring(nv.x, nv.z, { radius: 3.2, color: RIFT_CYAN, duration: 0.4 });
    this.ctx.fx.burst({
      x: nv.x, y: 2.0, z: nv.z,
      count: 24, color: [RIFT_CYAN, 0xffffff], speed: [4, 11], up: 0.5, size: [0.3, 0.7], life: [0.25, 0.5], gravity: -2, drag: 3,
    });
    this.ctx.cam.addTrauma(0.2);
    this.ctx.sfx.enemyShoot();
  }

  // ---------------------------------------------------------------- lance
  private beginLanceTrack(): void {
    this.state = "lanceTrack";
    this.timer = 0.36;
    const p = this.ctx.player;
    this.lockAngle = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
  }

  private commitLances(): void {
    this.state = "lanceTell";
    this.timer = LANCE_TELL;
    const p = this.ctx.player;
    this.lockAngle = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    // P2+: a second parallel lane offset perpendicular to the aim
    const lanes = this.phase >= 2 ? 2 : 1;
    for (let i = 0; i < lanes; i++) {
      const off = lanes === 1 ? 0 : (i - (lanes - 1) / 2) * 3.2;
      const ox = Math.cos(this.lockAngle) * off;
      const oz = -Math.sin(this.lockAngle) * off;
      this.ctx.tele.line(this.pos.x + ox, this.pos.z + oz, this.lockAngle, LANCE_LEN, LANCE_WIDTH, LANCE_TELL, RIFT_VIOLET);
      this.lances.push({ x: this.pos.x + ox, z: this.pos.z + oz, angle: this.lockAngle, timer: LANCE_TELL });
    }
    this.ctx.sfx.beamCharge();
  }

  private beginCrossfire(): void {
    this.state = "crossfireTell";
    this.timer = LANCE_TELL;
    const p = this.ctx.player;
    const base = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    const angles = this.phase >= 3
      ? [base, base + Math.PI * 0.5, base - Math.PI * 0.5, base + Math.PI * 0.25]
      : [base, base + Math.PI * 0.5, base - Math.PI * 0.5];
    for (const angle of angles) {
      const sx = Math.sin(angle);
      const cz = Math.cos(angle);
      const x = p.pos.x - sx * LANCE_LEN * 0.46;
      const z = p.pos.z - cz * LANCE_LEN * 0.46;
      this.ctx.tele.line(x, z, angle, LANCE_LEN, LANCE_WIDTH * 0.82, LANCE_TELL, RIFT_CYAN);
      this.lances.push({ x, z, angle, timer: LANCE_TELL });
    }
    this.ctx.sfx.beamCharge();
  }

  private fireLance(l: PendingLance): void {
    const p = this.ctx.player;
    const sx = Math.sin(l.angle);
    const cz = Math.cos(l.angle);

    // Visual beam
    const mat = new THREE.MeshBasicMaterial({
      color: 0xddbbff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(TYRANT_LANCE_GEO, mat);
    mesh.position.set(l.x + sx * LANCE_LEN * 0.5, 1.4, l.z + cz * LANCE_LEN * 0.5);
    mesh.rotation.y = l.angle;
    this.ctx.stage.scene.add(mesh);
    this.beams.push({ mesh, mat, fade: 0.9 });
    this.ctx.sfx.beamFire();
    this.ctx.cam.addTrauma(0.15);

    // Hitscan: perpendicular distance from player to the lane segment
    const px = p.pos.x - l.x;
    const pz = p.pos.z - l.z;
    const along = px * sx + pz * cz;
    if (along > 0 && along < LANCE_LEN) {
      const perp = Math.abs(px * cz - pz * sx);
      if (perp < LANCE_WIDTH * 0.5 + p.radius) this.ctx.combat.damagePlayer(17, l.x, l.z);
    }
  }

  // ---------------------------------------------------------------- slam
  private beginSlam(): void {
    this.state = "slamTell";
    this.timer = 0.68;
    const R = this.phase >= 3 ? 5.6 : 5.0;
    this.ctx.tele.circle(this.pos.x, this.pos.z, R, 0.68, RIFT_VIOLET);
    this.slams.push({ x: this.pos.x, z: this.pos.z, radius: R, timer: 0.68 });
    // P3: pair the slam with a spinning nova so the safe space squeezes
    if (this.phase >= 3) {
      const count = 14;
      const spin = (Math.random() < 0.5 ? -1 : 1) * 0.5;
      this.ctx.tele.circle(this.pos.x, this.pos.z, 3.2, 0.68, RIFT_CYAN);
      this.novas.push({ x: this.pos.x, z: this.pos.z, count, spin, timer: 0.68 });
    }
    this.ctx.sfx.beamCharge();
  }

  private landSlam(sl: PendingSlam): void {
    const p = this.ctx.player;
    this.ctx.fx.ring(sl.x, sl.z, { radius: sl.radius, color: RIFT_VIOLET, duration: 0.5 });
    this.ctx.fx.ring(sl.x, sl.z, { radius: sl.radius * 0.5, color: 0xffffff, duration: 0.35 });
    this.ctx.fx.burst({
      x: sl.x, y: 0.5, z: sl.z,
      count: sl.light ? 14 : 38, color: [RIFT_VIOLET, RIFT_CYAN, 0xffffff],
      speed: [4, sl.light ? 9 : 13], up: 0.9, size: [0.5, 1.1], life: [0.3, 0.8], gravity: -7, drag: 2.5,
    });
    this.ctx.cam.addTrauma(sl.light ? 0.22 : 0.5);
    this.ctx.stage.punch(sl.light ? 0.14 : 0.3);
    this.ctx.sfx.bossSlam();
    const d = Math.hypot(p.pos.x - sl.x, p.pos.z - sl.z);
    if (d < sl.radius + p.radius) {
      this.ctx.combat.damagePlayer(sl.light ? 14 : 20, sl.x, sl.z);
      const len = Math.max(0.001, d);
      const force = sl.light ? 5 : 7;
      this.ctx.controller.push(((p.pos.x - sl.x) / len) * force, ((p.pos.z - sl.z) / len) * force);
    }
  }

  // ---------------------------------------------------------------- radial lance fan
  /** A star of lances fired outward from the engine — sweep the gaps, not the lanes. */
  private beginRadialBurst(): void {
    this.state = "radialTell";
    const tell = 0.52;
    this.timer = tell;
    const n = this.phase >= 3 ? 6 : 5;
    const base = Math.random() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const angle = base + (i / n) * Math.PI * 2;
      this.ctx.tele.line(this.pos.x, this.pos.z, angle, LANCE_LEN, LANCE_WIDTH * 0.78, tell, RIFT_CYAN);
      this.lances.push({ x: this.pos.x, z: this.pos.z, angle, timer: tell });
    }
    this.ctx.sfx.beamCharge();
  }

  // ---------------------------------------------------------------- scattered rift storm
  /** A storm of small rift detonations rains around the player — keep moving. */
  private beginRiftStorm(): void {
    this.state = "stormTell";
    const p = this.ctx.player;
    const n = this.phase >= 3 ? 4 : 3;
    const R = 3.3;
    let maxT = 0;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const dist = i === 0 ? 0 : 3 + Math.random() * 3.5;
      let x = p.pos.x + Math.sin(a) * dist;
      let z = p.pos.z + Math.cos(a) * dist;
      const rr = Math.hypot(x, z);
      const maxR = ARENA_RADIUS - 2.5;
      if (rr > maxR) { x = (x / rr) * maxR; z = (z / rr) * maxR; }
      const t = 0.7 + i * 0.22;
      maxT = Math.max(maxT, t);
      this.ctx.tele.circle(x, z, R, t, RIFT_VIOLET);
      this.slams.push({ x, z, radius: R, timer: t, light: true });
    }
    this.timer = maxT + 0.1;
    this.ctx.sfx.beamCharge();
  }

  // ---------------------------------------------------------------- tick
  protected tick(dt: number): void {
    const p = this.ctx.player;
    this.timer -= dt;

    // Wind-up read: while charging any attack, the caged core blazes, the halo spins
    // up, and the shoulder vents gape — then it all settles back between volleys.
    const charging = this.state.endsWith("Tell") || this.state === "lanceTrack" || this.state === "guard";
    this.chargeAmt += ((charging ? 1 : 0) - this.chargeAmt) * Math.min(1, dt * 6);

    // Living engine: core pulses, halo counter-spins, the hull breathes a hover.
    this.coreMat.emissiveIntensity = 2.6 + this.phase * 0.5 + Math.sin(this.t * (2 + this.phase * 1.5)) * 0.9 + this.chargeAmt * 2.4;
    this.haloMat.emissiveIntensity = 1.8 + Math.sin(this.t * 2.4) * 0.5 + this.chargeAmt * 1.1;
    this.halo.rotation.y -= dt * (1.0 + this.phase * 0.55 + this.chargeAmt * 2.5);
    this.shardRing.rotation.y += dt * (1.3 + this.phase * 0.5 + this.chargeAmt * 2.0);
    this.pos.y = 0.35 + Math.sin(this.t * 1.6) * 0.14;
    this.hull.rotation.y += dt * 0.12;
    const corePulse = 1 + Math.sin(this.t * (2.4 + this.phase * 0.4)) * 0.06 + this.chargeAmt * 0.18;
    this.core.scale.setScalar(corePulse);
    for (let i = 0; i < this.cageStruts.length; i++) {
      const strut = this.cageStruts[i];
      strut.rotation.y = Math.sin(this.t * 1.25 + i) * 0.06;
    }
    // Vents flare smoothly with the charge-up (covers every wind-up state).
    const flare = 0.25 + this.chargeAmt * 0.22;
    this.shellL.rotation.z = flare;
    this.shellR.rotation.z = -flare;
    this.shellL.position.x = -1.55 - (flare - 0.25) * 0.45;
    this.shellR.position.x = 1.55 + (flare - 0.25) * 0.45;
    for (let i = 0; i < this.ventPanels.length; i++) {
      const panel = this.ventPanels[i];
      panel.scale.y = 1 + (flare - 0.25) * 0.55 + Math.sin(this.t * 4 + i) * 0.04;
    }
    for (let i = 0; i < this.stabilizers.length; i++) {
      const fin = this.stabilizers[i];
      fin.scale.y = 1 + Math.sin(this.t * 2.1 + i) * 0.055;
    }

    // Queued attacks always advance — even mid-freeze or phase shift.
    for (let i = this.novas.length - 1; i >= 0; i--) {
      this.novas[i].timer -= dt;
      if (this.novas[i].timer <= 0) {
        this.fireNova(this.novas[i]);
        this.novas.splice(i, 1);
      }
    }
    for (let i = this.lances.length - 1; i >= 0; i--) {
      this.lances[i].timer -= dt;
      if (this.lances[i].timer <= 0) {
        this.fireLance(this.lances[i]);
        this.lances.splice(i, 1);
      }
    }
    for (let i = this.slams.length - 1; i >= 0; i--) {
      this.slams[i].timer -= dt;
      if (this.slams[i].timer <= 0) {
        this.landSlam(this.slams[i]);
        this.slams.splice(i, 1);
      }
    }
    // Beam visuals fade
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.fade -= dt * 3.0;
      b.mat.opacity = Math.max(0, b.fade);
      if (b.fade <= 0) {
        this.ctx.stage.scene.remove(b.mesh);
        b.mat.dispose(); // shared geometry (TYRANT_LANCE_GEO) is not disposed
        this.beams.splice(i, 1);
      }
    }

    // Dramatic weight: coil on tells, lunge on novas/lances/slams, rear on phase shifts.
    this.poseForState(dt, this.state, this.state === "idle");

    switch (this.state) {
      case "idle": {
        const d = this.distToPlayer();
        this.facePlayer(dt);
        // Orbit at a mid band: back off if crowded, close if too far.
        if (d < 7) this.seek(this.pos.x * 2 - p.pos.x, this.pos.z * 2 - p.pos.z, dt, 1.04);
        else if (d > 13) this.seek(p.pos.x, p.pos.z, dt, 0.92);
        else {
          const ang = Math.atan2(this.pos.x - p.pos.x, this.pos.z - p.pos.z) + 0.5 * dt;
          this.seek(p.pos.x + Math.sin(ang) * d, p.pos.z + Math.cos(ang) * d, dt, 0.58);
        }
        if (this.timer <= 0) this.pickAttack(d);
        break;
      }
      case "novaTell":
        this.facePlayer(dt * 0.6);
        if (this.timer <= 0 && this.novas.length === 0) {
          this.state = "recover";
          this.timer = 0.35;
        }
        break;
      case "lanceTrack":
        // Track the player, then commit the locked angle.
        this.facePlayer(dt * 1.4);
        if (this.timer <= 0) this.commitLances();
        break;
      case "lanceTell":
        if (this.timer <= 0 && this.lances.length === 0) {
          this.state = "recover";
          this.timer = 0.35;
        }
        break;
      case "crossfireTell":
        if (this.timer <= 0 && this.lances.length === 0) {
          this.state = "recover";
          this.timer = 0.42;
        }
        break;
      case "slamTell":
        if (this.timer <= 0 && this.slams.length === 0) {
          this.state = "recover";
          this.timer = 0.45;
        }
        break;
      case "radialTell":
        this.facePlayer(dt * 0.4);
        if (this.timer <= 0 && this.lances.length === 0) {
          this.state = "recover";
          this.timer = 0.42;
        }
        break;
      case "stormTell":
        if (this.timer <= 0 && this.slams.length === 0) {
          this.state = "recover";
          this.timer = 0.45;
        }
        break;
      case "guard":
        this.facePlayer(dt * 0.5);
        if (this.timer <= 0) {
          this.wardShock(4.6, 18, RIFT_VIOLET);
          this.state = "recover";
          this.timer = 0.45;
        }
        break;
      case "recover":
      case "phaseShift":
        this.facePlayer(dt);
        if (this.timer <= 0) {
          this.state = "idle";
          this.attackCd = Math.max(0.26, 0.8 - this.phase * 0.15);
          this.timer = this.attackCd;
        }
        break;
    }
  }

  private pickAttack(d: number): void {
    this.attackPick++;
    // P2+: crossfire lances pin the player's current location from multiple lanes.
    if (this.phase >= 2 && (this.attackPick % 5 === 0 || (this.phase >= 3 && this.attackPick % 6 === 1))) {
      this.beginCrossfire();
      return;
    }
    // P2+: a radial lance star fires outward — sweep the safe gaps between the lanes.
    if (this.phase >= 2 && this.attackPick % 7 === 2) { this.beginRadialBurst(); return; }
    // P3: a scattered rift storm rains small detonations around the player.
    if (this.phase >= 3 && this.attackPick % 5 === 3) { this.beginRiftStorm(); return; }
    // A rift bulwark every 4th attack — invulnerable behind a barrier, then a close nova.
    if (this.attackPick % 4 === 3) { this.beginGuard(); return; }
    // Slams enter the pool at phase 2, and only when the player is in range.
    if (this.phase >= 2 && this.attackPick % 3 === 0 && d < 8) {
      this.beginSlam();
    } else if (this.attackPick % 2 === 0) {
      this.beginLanceTrack();
    } else {
      this.beginNova();
    }
    // P2+ periodically seeds a couple of adds between attacks.
    if (this.phase >= 2 && this.attackPick % 4 === 0) this.summonAdds(this.phase >= 3 ? 2 : 1);
  }
}
