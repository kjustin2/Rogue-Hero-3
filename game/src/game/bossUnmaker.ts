import * as THREE from "three";
import { ARENA_RADIUS } from "../render/arena";
import { Enemy, type EnemyKind } from "./enemies";
import type { Ctx } from "./ctx";

const PHASE_LINES = [
  "I AM THE HOLLOW STAR. COME, LITTLE LIGHT — END WHAT YOU CAME TO END.",
  "IS THIS WHAT THEY SENT YOU TO KILL? A FIRE THAT ONLY EVER KEPT YOU WARM?",
  "I HAVE HELD THE DARK ALONE FOR A HUNDRED YEARS. I AM SO TIRED.",
  // The fading phase — a whisper, not a war cry.
  "...thank you. there is nothing left to fight. finish it, and let the light go out.",
];

const VOID_WHITE = 0xeadcff;
const VOID_VIOLET = 0x9a4dff;
const VOID_CORE = 0xf4ecff;

type UnmakerState =
  | "idle"
  | "beamTrack" | "beamTell"
  | "novaTell"
  | "pullTell"
  | "starRainTell"
  | "guard"
  | "recover" | "phaseShift"
  | "fading"; // final, defenceless phase — the star gives up

/** A queued star-beam: locked angle, telegraphed line, fires hitscan on expiry. */
interface PendingBeam {
  x: number;
  z: number;
  angle: number;
  timer: number;
}

/** A queued collapse nova: telegraphed circle, then a ring of hostile bolts on expiry. */
interface PendingNova {
  x: number;
  z: number;
  count: number;
  spin: number;
  timer: number;
}

/** A queued implosion: pulls the player inward, then a telegraphed core slam lands. */
interface PendingPull {
  x: number;
  z: number;
  radius: number;
  timer: number;
  pulled: boolean;
}

/** A spawned visual beam from a fired star-lance — fades out on its own clock. */
interface PendingStar {
  x: number;
  z: number;
  radius: number;
  timer: number;
}

interface Beam {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  fade: number;
}

const BEAM_LEN = 26;
const BEAM_WIDTH = 2.4;
/** Shared star-beam geometry — reused for every beam (no per-shot allocation). */
const BEAM_GEO = new THREE.BoxGeometry(BEAM_WIDTH, 0.6, BEAM_LEN);
const BEAM_TELL = 0.46;
const STAR_TELL = 0.68;

/**
 * The Unmaker, the Hollow Star — the final boss (Act V). A collapsing star: a
 * blinding white-violet core caged inside dark broken rings, wreathed by a slow
 * cloud of orbiting void debris. It does not chase; it dictates space and pulls
 * the world inward.
 *
 * Phase 1: a sweeping star-beam and radial collapse novas of void-bolts.
 * Phase 2: faster cadence, twin-fan beams, denser spinning novas, summons voidlings.
 * Phase 3: an implosion pull + core slam layered with everything else, summons warpers.
 * Every attack telegraphs — the fairness contract holds even at the end of all things.
 */
export class Unmaker extends Enemy {
  readonly kind: EnemyKind = "boss";
  phase = 1;
  private state: UnmakerState = "idle";
  private timer = 1.2;
  private attackCd = 1.35;
  private attackPick = 0;
  private beams: PendingBeam[] = [];
  private novas: PendingNova[] = [];
  private pulls: PendingPull[] = [];
  private stars: PendingStar[] = [];
  private fxBeams: Beam[] = [];
  private lockAngle = 0;

  private coreMat: THREE.MeshStandardMaterial;
  private ringMat: THREE.MeshStandardMaterial;
  private debrisMat: THREE.MeshStandardMaterial;
  private cageMat: THREE.MeshStandardMaterial;

  private rings: THREE.Group;
  private debris: THREE.Group;
  private core: THREE.Mesh;
  private innerCore: THREE.Mesh;
  private cageStruts: THREE.Object3D[] = [];
  private shroudShards: THREE.Object3D[] = [];
  private quietHalo: THREE.Object3D[] = [];
  // Per-phase escalation geometry (built once, unveiled on transition).
  private p2Shards: THREE.Object3D[] = [];
  private p3Spikes: THREE.Object3D[] = [];

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 3000;
    this.speed = 3.0;
    this.radius = 1.7;
    this.wardColor = VOID_VIOLET;

    this.cageMat = this.stdMat(0x0a0814, 0x2a1450, 0.5);
    this.ringMat = this.stdMat(0x100a1e, VOID_VIOLET, 1.4);
    this.debrisMat = this.stdMat(0x080610, 0x8a5aff, 1.2);
    this.coreMat = this.stdMat(0x0c0a18, VOID_CORE, 3.0);

    // Blinding collapsing core
    this.core = this.addMesh(new THREE.IcosahedronGeometry(1.0, 1), this.coreMat, 0, 2.2);
    this.core.castShadow = false;
    // A bright inner pip so the core reads as a star, not a ball
    this.innerCore = this.addMesh(new THREE.OctahedronGeometry(0.5), this.coreMat, 0, 2.2);
    const innerHalo = this.addMesh(new THREE.TorusGeometry(1.12, 0.035, 6, 36), this.coreMat, 0, 2.2);
    innerHalo.rotation.set(1.05, 0.22, 0.35);
    this.quietHalo.push(innerHalo);

    // Dark broken cage struts hemming the core
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const strut = this.addMesh(new THREE.BoxGeometry(0.16, 2.2, 0.16), this.cageMat, Math.sin(a) * 1.05, 2.2, Math.cos(a) * 1.05);
      strut.rotation.x = Math.sin(a) * 0.22;
      strut.rotation.z = Math.cos(a) * 0.22;
      this.cageStruts.push(strut);
    }
    // Jagged shroud shards clinging around the core
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const sh = this.addMesh(new THREE.TetrahedronGeometry(0.4), this.cageMat, Math.sin(a) * 1.3, 2.2 + Math.cos(a * 1.7) * 0.5, Math.cos(a) * 1.3);
      sh.rotation.set(a, a * 1.3, a * 0.7);
      this.shroudShards.push(sh);
    }
    // Anchoring skirt
    this.addMesh(new THREE.CylinderGeometry(0.5, 1.4, 0.9, 6), this.cageMat, 0, 0.5);

    // Dark broken rings caging the star (counter-spinning groups)
    this.rings = new THREE.Group();
    this.rings.position.y = 2.2;
    this.root.add(this.rings);
    const r1 = this.addMesh(new THREE.TorusGeometry(2.3, 0.1, 6, 40, Math.PI * 1.55), this.ringMat, 0, 0, 0, this.rings);
    r1.rotation.x = Math.PI / 2;
    const r2 = this.addMesh(new THREE.TorusGeometry(2.6, 0.08, 6, 40, Math.PI * 1.3), this.ringMat, 0, 0, 0, this.rings);
    r2.rotation.set(Math.PI / 2, 0, 0);
    r2.rotation.z = 0.7;
    r2.rotation.x = 1.1;
    const r3 = this.addMesh(new THREE.TorusGeometry(1.75, 0.055, 6, 40, Math.PI * 1.75), this.coreMat, 0, 0, 0, this.rings);
    r3.rotation.set(0.85, 0.35, 1.2);
    this.quietHalo.push(r1, r2, r3);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.2;
      const spike = this.addMesh(new THREE.ConeGeometry(0.1, 0.82, 4), this.ringMat, Math.sin(a) * 2.15, Math.cos(a * 2) * 0.25, Math.cos(a) * 2.15, this.rings);
      spike.rotation.set(Math.PI / 2 + Math.cos(a) * 0.2, a, 0);
    }

    // Orbiting void debris cloud
    this.debris = new THREE.Group();
    this.debris.position.y = 2.2;
    this.root.add(this.debris);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const rr = 2.9 + (i % 3) * 0.4;
      const piece = this.addMesh(new THREE.OctahedronGeometry(0.22 + (i % 2) * 0.1), this.debrisMat, Math.sin(a) * rr, Math.sin(a * 2) * 0.5, Math.cos(a) * rr, this.debris);
      piece.rotation.set(a, a * 1.5, 0);
    }
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.12;
      const rr = 2.15 + (i % 4) * 0.28;
      const shard = this.addMesh(new THREE.TetrahedronGeometry(0.09 + (i % 2) * 0.04), this.debrisMat, Math.sin(a) * rr, Math.cos(a * 3) * 0.35, Math.cos(a) * rr, this.debris);
      shard.rotation.set(a * 0.4, a * 1.8, a);
    }

    this.buildPhaseLooks();
  }

  /** Pre-build escalation geometry hidden until its phase unveils it. */
  private buildPhaseLooks(): void {
    // Phase 2: a second debris belt of brighter violet shards spins out.
    const shardMat = this.stdMat(0x18082e, 0xc070ff, 2.0);
    const shardGeo = new THREE.OctahedronGeometry(0.26);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const sh = this.addMesh(shardGeo, shardMat, Math.sin(a) * 1.7, 0, Math.cos(a) * 1.7, this.debris);
      sh.rotation.y = a;
      sh.visible = false;
      this.p2Shards.push(sh);
    }
    // Phase 3: a white-violet crown of star-spikes erupts as the core swells.
    const spikeMat = this.stdMat(0x2a0a44, VOID_WHITE, 3.0);
    const spikeGeo = new THREE.ConeGeometry(0.18, 1.3, 4);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const sp = this.addMesh(spikeGeo, spikeMat, Math.sin(a) * 0.7, 3.9, Math.cos(a) * 0.7);
      sp.rotation.x = Math.cos(a) * 0.45;
      sp.rotation.z = -Math.sin(a) * 0.45;
      sp.visible = false;
      this.p3Spikes.push(sp);
    }
  }

  /** Visibly escalate the boss at each phase transition. */
  private applyPhaseLook(phase: number): void {
    if (phase === 2) {
      this.root.scale.setScalar(1.1);
      for (const s of this.p2Shards) s.visible = true;
      this.ringMat.emissive.set(0xc070ff);
      this.ringMat.emissiveIntensity = 2.0;
      this.debrisMat.emissive.set(0xb080ff);
      this.coreMat.emissive.set(0xf6f0ff);
    } else if (phase === 3) {
      this.root.scale.setScalar(1.2);
      for (const s of this.p3Spikes) s.visible = true;
      this.core.scale.setScalar(1.25);
      this.cageMat.color.set(0x1a1030);
      this.ringMat.emissive.set(0xe6d0ff);
      this.ringMat.emissiveIntensity = 2.6;
      this.coreMat.emissive.set(0xffffff);
      this.coreMat.emissiveIntensity = 4.0;
    } else if (phase === 4) {
      // Fading: the star dims, cools to a sad blue-grey, and sags inward — spent.
      this.root.scale.setScalar(1.04);
      this.core.scale.setScalar(0.95);
      this.cageMat.color.set(0x0a0a14);
      this.ringMat.emissive.set(0x4a5a8a);
      this.ringMat.emissiveIntensity = 0.55;
      this.debrisMat.emissive.set(0x3a4a78);
      this.debrisMat.emissiveIntensity = 0.4;
      this.coreMat.emissive.set(0x8a9ad0);
      this.coreMat.emissiveIntensity = 0.7;
    }
    for (const f of this.flashMats) {
      f.baseEmissive.copy(f.mat.emissive);
      f.baseIntensity = f.mat.emissiveIntensity;
    }
  }

  protected deathColor(): number {
    return VOID_WHITE;
  }

  protected barHeight(): number {
    return 5.0;
  }

  takeDamage(amount: number, opts = {}): boolean {
    // A star does not stagger — knockback is stripped.
    const killed = super.takeDamage(amount, { ...opts, kb: 0 });
    this.ctx.events.emit("BOSS_HP", { hp: Math.max(0, this.hp), maxHp: this.maxHp });

    const frac = this.hp / this.maxHp;
    const targetPhase = frac <= 0.12 ? 4 : frac <= 0.33 ? 3 : frac <= 0.66 ? 2 : 1;
    if (!killed && targetPhase > this.phase) {
      this.phase = targetPhase;
      if (this.phase === 4) {
        this.enterFading();
      } else {
        this.state = "phaseShift";
        this.timer = 1.3;
        this.applyPhaseLook(this.phase);
        this.ctx.events.emit("BOSS_PHASE", { phase: this.phase, line: PHASE_LINES[this.phase - 1] });
        this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: 10, color: VOID_VIOLET, duration: 0.8 });
        this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: 5, color: VOID_WHITE, duration: 0.6 });
        this.ctx.fx.burst({
          x: this.pos.x, y: 2.4, z: this.pos.z,
          count: 56, color: [VOID_WHITE, VOID_VIOLET, 0xffffff],
          speed: [4, 15], up: 0.9, size: [0.4, 1.1], life: [0.4, 1.0], gravity: -4, drag: 2.5,
        });
        this.ctx.cam.addTrauma(0.55);
        this.ctx.stage.punch(0.35);
        this.ctx.sfx.bossRoar();
        // Collapse shoves the player outward.
        const p = this.ctx.player;
        const dx = p.pos.x - this.pos.x;
        const dz = p.pos.z - this.pos.z;
        const len = Math.hypot(dx, dz) || 1;
        this.ctx.controller.push((dx / len) * 9, (dz / len) * 9);
        if (this.phase === 2) this.summonAdds(3);
      }
    }
    return killed;
  }

  freeze(duration: number): void {
    // The Hollow Star barely cools — queued (telegraphed) attacks still land.
    super.freeze(duration * 0.35);
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
    for (const b of this.fxBeams) {
      this.ctx.stage.scene.remove(b.mesh);
      b.mat.dispose(); // geometry is shared (BEAM_GEO) — never disposed
    }
    this.fxBeams = [];
    this.beams = [];
    this.novas = [];
    this.pulls = [];
    this.stars = [];
  }

  // ---------------------------------------------------------------- fading (the end)
  /** The star gives up: it stops fighting, dims, and waits for the last blow. */
  private enterFading(): void {
    this.state = "fading";
    this.timer = 1e9; // never queues another attack
    // Drop everything in flight — it will not raise a hand against you again.
    this.beams = [];
    this.novas = [];
    this.pulls = [];
    this.stars = [];
    this.applyPhaseLook(4);
    // Its minions wink out with it — the end is meant to be just you and the dying star.
    this.ctx.enemies.clearNonBosses();
    this.ctx.hostiles.clear();
    this.ctx.events.emit("BOSS_PHASE", { phase: 4, line: PHASE_LINES[3] });
    // A soft inward sigh, not a roar.
    this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: 8, color: VOID_VIOLET, duration: 1.2 });
    this.ctx.fx.burst({
      x: this.pos.x, y: 2.4, z: this.pos.z,
      count: 30, color: [VOID_VIOLET, 0x6a78b0], speed: [1, 5], up: 0.4, size: [0.3, 0.8], life: [0.8, 1.7], gravity: 0.6, drag: 1.6,
    });
    this.ctx.cam.addTrauma(0.18);
  }

  // ---------------------------------------------------------------- adds
  private summonAdds(n: number): void {
    if (this.phase >= 4) return;
    if (this.ctx.enemies.living().length >= 7) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.min(8 + Math.random() * 3, ARENA_RADIUS - 3);
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      // Voidlings swarm earlier; warpers harry in the final phase.
      this.ctx.enemies.spawn(this.phase >= 3 ? "warper" : "voidling", x, z, 1.1);
    }
  }

  /** Unmaking ward: the star seals itself (invulnerable), then a close annihilation pulse. */
  private beginGuard(): void {
    this.setInvuln(1.45);
    this.state = "guard";
    this.timer = 0.58; // wind-up = telegraph duration
    this.ctx.tele.circle(this.pos.x, this.pos.z, 4.8, 0.58, VOID_WHITE);
    this.ctx.sfx.beamCharge();
  }

  // ---------------------------------------------------------------- star-beam
  private beginBeamTrack(): void {
    this.state = "beamTrack";
    this.timer = 0.4;
    const p = this.ctx.player;
    this.lockAngle = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
  }

  private commitBeams(): void {
    this.state = "beamTell";
    this.timer = BEAM_TELL;
    const p = this.ctx.player;
    this.lockAngle = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    // P2+: a fanned pair of lances straddling the aim; P3 widens the fan.
    const fan = this.phase >= 2 ? 2 : 1;
    const spread = this.phase >= 3 ? 0.42 : 0.3;
    for (let i = 0; i < fan; i++) {
      const off = fan === 1 ? 0 : (i - (fan - 1) / 2) * spread * 2;
      const angle = this.lockAngle + off;
      this.ctx.tele.line(this.pos.x, this.pos.z, angle, BEAM_LEN, BEAM_WIDTH, BEAM_TELL, VOID_WHITE);
      this.beams.push({ x: this.pos.x, z: this.pos.z, angle, timer: BEAM_TELL });
    }
    this.ctx.sfx.beamCharge();
  }

  private fireBeam(b: PendingBeam): void {
    const p = this.ctx.player;
    const sx = Math.sin(b.angle);
    const cz = Math.cos(b.angle);

    const mat = new THREE.MeshBasicMaterial({
      color: VOID_WHITE, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(BEAM_GEO, mat);
    mesh.position.set(b.x + sx * BEAM_LEN * 0.5, 1.6, b.z + cz * BEAM_LEN * 0.5);
    mesh.rotation.y = b.angle;
    this.ctx.stage.scene.add(mesh);
    this.fxBeams.push({ mesh, mat, fade: 0.95 });
    this.ctx.sfx.beamFire();
    this.ctx.cam.addTrauma(0.18);

    // Hitscan: perpendicular distance from the player to the lane segment.
    const px = p.pos.x - b.x;
    const pz = p.pos.z - b.z;
    const along = px * sx + pz * cz;
    if (along > 0 && along < BEAM_LEN) {
      const perp = Math.abs(px * cz - pz * sx);
      if (perp < BEAM_WIDTH * 0.5 + p.radius) this.ctx.combat.damagePlayer(19, b.x, b.z);
    }
  }

  // ---------------------------------------------------------------- collapse nova
  private beginNova(): void {
    this.state = "novaTell";
    this.timer = 0.62;
    const count = this.phase >= 3 ? 23 : this.phase === 2 ? 17 : 12;
    const spin = this.phase >= 2 ? (Math.random() < 0.5 ? -1 : 1) * (0.25 + this.phase * 0.12) : 0;
    this.ctx.tele.circle(this.pos.x, this.pos.z, 3.4, 0.62, VOID_VIOLET);
    this.novas.push({ x: this.pos.x, z: this.pos.z, count, spin, timer: 0.62 });
    this.ctx.sfx.beamCharge();
  }

  private fireNova(nv: PendingNova): void {
    const base = Math.atan2(this.ctx.player.pos.x - nv.x, this.ctx.player.pos.z - nv.z) + nv.spin;
    for (let i = 0; i < nv.count; i++) {
      const a = base + (i / nv.count) * Math.PI * 2;
      this.ctx.hostiles.fire(nv.x, nv.z, a, { speed: 9, dmg: 9, color: VOID_VIOLET, radius: 0.32 });
    }
    this.ctx.fx.ring(nv.x, nv.z, { radius: 3.4, color: VOID_VIOLET, duration: 0.45 });
    this.ctx.fx.burst({
      x: nv.x, y: 2.2, z: nv.z,
      count: 26, color: [VOID_VIOLET, VOID_WHITE], speed: [4, 12], up: 0.5, size: [0.3, 0.8], life: [0.25, 0.55], gravity: -2, drag: 3,
    });
    this.ctx.cam.addTrauma(0.22);
    this.ctx.sfx.enemyShoot();
  }

  // ---------------------------------------------------------------- implosion pull + slam
  private beginPull(): void {
    this.state = "pullTell";
    this.timer = 0.8;
    const R = this.phase >= 3 ? 6.2 : 5.4;
    // The deadly core slam at the center — escape its radius before it lands.
    this.ctx.tele.circle(this.pos.x, this.pos.z, R, 0.8, VOID_WHITE);
    this.pulls.push({ x: this.pos.x, z: this.pos.z, radius: R, timer: 0.8, pulled: false });
    // P3 pairs the implosion with a spinning nova so the safe ground squeezes.
    if (this.phase >= 3) {
      this.ctx.tele.circle(this.pos.x, this.pos.z, 3.4, 0.8, VOID_VIOLET);
      this.novas.push({ x: this.pos.x, z: this.pos.z, count: 18, spin: (Math.random() < 0.5 ? -1 : 1) * 0.5, timer: 0.8 });
    }
    this.ctx.sfx.beamCharge();
  }

  /** Steady inward tug while the implosion charges — the world falls toward the star. */
  private applyPull(pl: PendingPull, dt: number): void {
    const p = this.ctx.player;
    const dx = pl.x - p.pos.x;
    const dz = pl.z - p.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    if (len > 1.5) {
      const strength = (this.phase >= 3 ? 5.0 : 3.5) * dt;
      this.ctx.controller.push((dx / len) * strength, (dz / len) * strength);
    }
  }

  private landSlam(pl: PendingPull): void {
    const p = this.ctx.player;
    this.ctx.fx.ring(pl.x, pl.z, { radius: pl.radius, color: VOID_WHITE, duration: 0.55 });
    this.ctx.fx.ring(pl.x, pl.z, { radius: pl.radius * 0.5, color: VOID_VIOLET, duration: 0.4 });
    this.ctx.fx.burst({
      x: pl.x, y: 0.6, z: pl.z,
      count: 44, color: [VOID_WHITE, VOID_VIOLET, 0xffffff],
      speed: [5, 15], up: 0.9, size: [0.5, 1.2], life: [0.3, 0.9], gravity: -7, drag: 2.5,
    });
    this.ctx.cam.addTrauma(0.6);
    this.ctx.stage.punch(0.4);
    this.ctx.sfx.bossSlam();
    const d = Math.hypot(p.pos.x - pl.x, p.pos.z - pl.z);
    if (d < pl.radius + p.radius) {
      this.ctx.combat.damagePlayer(24, pl.x, pl.z);
      const len = Math.max(0.001, d);
      this.ctx.controller.push(((p.pos.x - pl.x) / len) * 9, ((p.pos.z - pl.z) / len) * 9);
    }
  }

  // ---------------------------------------------------------------- star rain
  private beginStarRain(): void {
    this.state = "starRainTell";
    this.timer = STAR_TELL + 0.28;
    const p = this.ctx.player.pos;
    const count = this.phase >= 3 ? 7 : 5;
    for (let i = 0; i < count; i++) {
      const a = (i / Math.max(1, count - 1)) * Math.PI * 2 + this.t * 0.7;
      const dist = i === 0 ? 0 : 2.0 + (i % 3) * 1.15;
      let x = p.x + Math.sin(a) * dist;
      let z = p.z + Math.cos(a) * dist;
      const rr = Math.hypot(x, z);
      const maxR = ARENA_RADIUS - 2.2;
      if (rr > maxR) {
        x = (x / rr) * maxR;
        z = (z / rr) * maxR;
      }
      const timer = STAR_TELL + i * 0.06;
      const radius = this.phase >= 3 ? 1.55 : 1.4;
      this.ctx.tele.circle(x, z, radius, timer, i === 0 ? VOID_WHITE : VOID_VIOLET);
      this.stars.push({ x, z, radius, timer });
    }
    this.ctx.sfx.beamCharge();
  }

  private landStar(st: PendingStar): void {
    const p = this.ctx.player;
    this.ctx.fx.ring(st.x, st.z, { radius: st.radius * 1.8, color: VOID_WHITE, duration: 0.38 });
    this.ctx.fx.burst({
      x: st.x, y: 2.4, z: st.z,
      count: 18, color: [VOID_WHITE, VOID_VIOLET, 0xffffff],
      speed: [3, 11], up: -0.8, size: [0.32, 0.9], life: [0.25, 0.65], gravity: -1.5, drag: 2.2, jitter: 0.5,
    });
    const d = Math.hypot(p.pos.x - st.x, p.pos.z - st.z);
    if (d < st.radius + p.radius) {
      this.ctx.combat.damagePlayer(this.phase >= 3 ? 20 : 16, st.x, st.z);
      const len = Math.max(0.001, d);
      this.ctx.controller.push(((p.pos.x - st.x) / len) * 5, ((p.pos.z - st.z) / len) * 5);
    }
  }

  // ---------------------------------------------------------------- tick
  protected tick(dt: number): void {
    const p = this.ctx.player;
    this.timer -= dt;

    // Living star: core pulses, rings counter-spin, the body breathes a hover.
    if (this.phase < 4) {
      this.coreMat.emissiveIntensity = 3.0 + this.phase * 0.6 + Math.sin(this.t * (2.5 + this.phase * 1.5)) * 1.0;
      this.rings.rotation.y -= dt * (0.8 + this.phase * 0.5);
      this.debris.rotation.y += dt * (1.1 + this.phase * 0.45);
    } else {
      // Fading: a dim, guttering core; rings slow almost to a stop; debris settles.
      this.coreMat.emissiveIntensity = 0.55 + Math.sin(this.t * 1.1) * 0.22;
      this.rings.rotation.y -= dt * 0.15;
      this.debris.rotation.y += dt * 0.18;
    }
    this.rings.rotation.x = Math.sin(this.t * 0.6) * 0.2;
    this.pos.y = 0.4 + Math.sin(this.t * 1.4) * 0.16;
    this.core.rotation.y += dt * (this.phase >= 4 ? 0.08 : 0.22 + this.phase * 0.04);
    this.innerCore.rotation.y -= dt * (this.phase >= 4 ? 0.12 : 0.55 + this.phase * 0.1);
    this.innerCore.scale.setScalar(this.phase >= 4 ? 0.82 + Math.sin(this.t * 1.2) * 0.035 : 1 + Math.sin(this.t * 3.6) * 0.07);
    for (let i = 0; i < this.cageStruts.length; i++) {
      const strut = this.cageStruts[i];
      strut.rotation.y = Math.sin(this.t * 0.85 + i) * (this.phase >= 4 ? 0.025 : 0.08);
    }
    for (let i = 0; i < this.shroudShards.length; i++) {
      const shard = this.shroudShards[i];
      shard.scale.setScalar(1 + Math.sin(this.t * 1.9 + i) * (this.phase >= 4 ? 0.025 : 0.07));
    }
    for (let i = 0; i < this.quietHalo.length; i++) {
      const ring = this.quietHalo[i];
      ring.rotation.z += dt * (this.phase >= 4 ? 0.025 : 0.12 + i * 0.02);
    }

    // Queued attacks always advance — even mid-freeze or phase shift.
    for (let i = this.novas.length - 1; i >= 0; i--) {
      this.novas[i].timer -= dt;
      if (this.novas[i].timer <= 0) {
        this.fireNova(this.novas[i]);
        this.novas.splice(i, 1);
      }
    }
    for (let i = this.beams.length - 1; i >= 0; i--) {
      this.beams[i].timer -= dt;
      if (this.beams[i].timer <= 0) {
        this.fireBeam(this.beams[i]);
        this.beams.splice(i, 1);
      }
    }
    for (let i = this.pulls.length - 1; i >= 0; i--) {
      const pl = this.pulls[i];
      pl.timer -= dt;
      this.applyPull(pl, dt);
      if (pl.timer <= 0) {
        this.landSlam(pl);
        this.pulls.splice(i, 1);
      }
    }
    for (let i = this.stars.length - 1; i >= 0; i--) {
      this.stars[i].timer -= dt;
      if (this.stars[i].timer <= 0) {
        this.landStar(this.stars[i]);
        this.stars.splice(i, 1);
      }
    }
    // Beam visuals fade.
    for (let i = this.fxBeams.length - 1; i >= 0; i--) {
      const b = this.fxBeams[i];
      b.fade -= dt * 3.0;
      b.mat.opacity = Math.max(0, b.fade);
      if (b.fade <= 0) {
        this.ctx.stage.scene.remove(b.mesh);
        b.mat.dispose(); // shared geometry (BEAM_GEO) is not disposed
        this.fxBeams.splice(i, 1);
      }
    }

    switch (this.state) {
      case "idle": {
        const d = this.distToPlayer();
        this.facePlayer(dt);
        // Hold a mid band: drift out if crowded, close if too far, orbit otherwise.
        if (d < 7) this.seek(this.pos.x * 2 - p.pos.x, this.pos.z * 2 - p.pos.z, dt, 0.98);
        else if (d > 14) this.seek(p.pos.x, p.pos.z, dt, 0.92);
        else {
          const ang = Math.atan2(this.pos.x - p.pos.x, this.pos.z - p.pos.z) + 0.45 * dt;
          this.seek(p.pos.x + Math.sin(ang) * d, p.pos.z + Math.cos(ang) * d, dt, 0.52);
        }
        if (this.timer <= 0) this.pickAttack();
        break;
      }
      case "beamTrack":
        this.facePlayer(dt * 1.4);
        if (this.timer <= 0) this.commitBeams();
        break;
      case "beamTell":
        if (this.timer <= 0 && this.beams.length === 0) {
          this.state = "recover";
          this.timer = 0.35;
        }
        break;
      case "novaTell":
        this.facePlayer(dt * 0.6);
        if (this.timer <= 0 && this.novas.length === 0) {
          this.state = "recover";
          this.timer = 0.35;
        }
        break;
      case "pullTell":
        if (this.timer <= 0 && this.pulls.length === 0) {
          this.state = "recover";
          this.timer = 0.45;
        }
        break;
      case "starRainTell":
        if (this.timer <= 0 && this.stars.length === 0) {
          this.state = "recover";
          this.timer = 0.42;
        }
        break;
      case "guard":
        this.facePlayer(dt * 0.5);
        if (this.timer <= 0) {
          this.wardShock(4.8, 20, VOID_WHITE);
          this.state = "recover";
          this.timer = 0.45;
        }
        break;
      case "recover":
      case "phaseShift":
        this.facePlayer(dt);
        if (this.timer <= 0) {
          this.state = "idle";
          this.attackCd = Math.max(0.42, 1.35 - this.phase * 0.28);
          this.timer = this.attackCd;
        }
        break;
      case "fading":
        // It does not fight, flee, or recover — it only turns to face you, and waits.
        this.facePlayer(dt * 0.5);
        break;
    }
  }

  private pickAttack(): void {
    this.attackPick++;
    if (this.phase >= 2 && (this.attackPick % 5 === 0 || (this.phase >= 3 && this.attackPick % 6 === 1))) {
      this.beginStarRain();
      return;
    }
    // An unmaking ward every 4th attack (phases 1–3 only — never in the fading end).
    if (this.phase < 4 && this.attackPick % 4 === 3) { this.beginGuard(); return; }
    // The implosion pull joins the pool at phase 3.
    if (this.phase >= 3 && this.attackPick % 3 === 0) {
      this.beginPull();
    } else if (this.attackPick % 2 === 0) {
      this.beginBeamTrack();
    } else {
      this.beginNova();
    }
    // P2+ periodically seeds adds between attacks.
    if (this.phase >= 2 && this.attackPick % 4 === 0) this.summonAdds(this.phase >= 3 ? 2 : 1);
  }
}
