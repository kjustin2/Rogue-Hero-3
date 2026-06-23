import * as THREE from "three";
import { Enemy, type EnemyKind } from "./enemies";
import type { Ctx } from "./ctx";

const PHASE_LINES = [
  "THE ENGINE OF THE CORE IGNITES",
  "THE MOUNTAIN REMEMBERS HOW TO BURN",
  "THE CORE GOES CRITICAL",
];

type ColossusState = "idle" | "poundSeq" | "mines" | "tectonicTell" | "recover" | "phaseShift" | "guard";

interface FirePatch {
  x: number;
  z: number;
  life: number;
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  acc: number;
}

interface PendingPound {
  x: number;
  z: number;
  timer: number;
}

interface PendingMine {
  x: number;
  z: number;
  timer: number;
}

interface TectonicRing {
  inner: number;
  outer: number;
  timer: number;
}

interface FireWave {
  radius: number;
  hit: boolean;
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
}

/**
 * Act III final boss: a rooted mountain of slag. It never chases — its fists
 * and the floor itself are the threat. Pounds chase your position, magma
 * mines carpet the ground, and tectonic slams send annulus shockwaves with
 * safe lanes between. Phase 3 adds slow expanding fire waves to dodge through.
 */
export class Colossus extends Enemy {
  readonly kind: EnemyKind = "boss";
  phase = 1;
  private state: ColossusState = "idle";
  private timer = 1.1;
  private attackPick = 0;
  private pounds: PendingPound[] = [];
  private poundsLeft = 0;
  private poundGap = 0;
  private mines: PendingMine[] = [];
  private rings: TectonicRing[] = [];
  private waves: FireWave[] = [];
  private patches: FirePatch[] = [];
  private patchGeo: THREE.CircleGeometry;
  private coreMat: THREE.MeshStandardMaterial;
  private veinMat: THREE.MeshStandardMaterial;
  private slagMat: THREE.MeshStandardMaterial;
  private core: THREE.Mesh;
  private fistL: THREE.Mesh;
  private fistR: THREE.Mesh;
  private crownBand: THREE.Mesh;
  private heatVents: THREE.Object3D[] = [];
  private armorBands: THREE.Object3D[] = [];
  private fistAnim = 0;
  // Per-phase appearance escalation (built once, revealed on transition).
  private p2Plates: THREE.Object3D[] = [];
  private p3Crown: THREE.Object3D[] = [];

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 3000;
    this.speed = 0; // rooted — it pivots, the arena moves instead
    this.radius = 2.2;
    this.wardColor = 0xff5522;

    const slagMat = this.stdMat(0x241210, 0x440f05, 0.4);
    const plateMat = this.stdMat(0x161009);
    this.coreMat = this.stdMat(0x2a0d05, 0xff5522, 2.6);
    this.veinMat = this.stdMat(0x331105, 0xff7733, 1.6);
    const eyeMat = this.stdMat(0x000000, 0xffcc44, 3.2);
    this.slagMat = slagMat;

    // Mountain body
    const body = this.addMesh(new THREE.CylinderGeometry(1.4, 2.3, 3.6, 7), slagMat, 0, 1.8);
    body.castShadow = true;
    this.addMesh(new THREE.CylinderGeometry(1.1, 1.5, 1.0, 7), plateMat, 0, 3.9);
    this.core = this.addMesh(new THREE.SphereGeometry(0.55, 8, 6), this.coreMat, 0, 2.4, 1.85);
    this.addMesh(new THREE.TorusGeometry(0.72, 0.055, 6, 24), this.veinMat, 0, 2.4, 1.86).rotation.x = Math.PI / 2;
    this.addMesh(new THREE.BoxGeometry(0.18, 0.7, 0.16), this.veinMat, 0, 1.78, 1.88);
    // Eyes must clear the faceted head surface (facet depth 1.10–1.22 here)
    this.addMesh(new THREE.BoxGeometry(0.22, 0.16, 0.14), eyeMat, -0.45, 4.1, 1.32);
    this.addMesh(new THREE.BoxGeometry(0.22, 0.16, 0.14), eyeMat, 0.45, 4.1, 1.32);
    // Magma veins
    for (let i = 0; i < 5; i++) {
      const v = this.addMesh(new THREE.BoxGeometry(0.16, 1.8 + Math.random(), 0.16), this.veinMat, 0, 1.8, 0);
      const a = (i / 5) * Math.PI * 2;
      v.position.set(Math.sin(a) * 1.75, 1.4 + Math.random() * 0.8, Math.cos(a) * 1.75);
      v.rotation.z = (Math.random() - 0.5) * 0.5;
    }
    // Broken outer armor bands make the mountain read as layered slag plates.
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + row * 0.28;
        const r = 1.35 + row * 0.18;
        const band = this.addMesh(new THREE.BoxGeometry(0.54, 0.18, 0.28), plateMat, Math.sin(a) * r, 1.04 + row * 0.62, Math.cos(a) * r);
        band.rotation.y = a;
        band.rotation.x = 0.12;
        this.armorBands.push(band);
      }
    }
    // Fists on heavy arms. Warmer than pitch-black so the arms read as connected
    // slag rather than disconnected voids floating beside the body.
    const armMat = this.stdMat(0x33231a, 0x5a2408, 0.5);
    this.addMesh(new THREE.BoxGeometry(0.9, 2.6, 0.9), armMat, -2.6, 2.6, 0.3).rotation.z = 0.25;
    this.addMesh(new THREE.BoxGeometry(0.9, 2.6, 0.9), armMat, 2.6, 2.6, 0.3).rotation.z = -0.25;
    this.fistL = this.addMesh(new THREE.BoxGeometry(1.5, 1.2, 1.5), plateMat, -3.1, 1.0, 0.5);
    this.fistR = this.addMesh(new THREE.BoxGeometry(1.5, 1.2, 1.5), plateMat, 3.1, 1.0, 0.5);
    for (const sx of [-1, 1]) {
      const vent = this.addMesh(new THREE.BoxGeometry(0.4, 0.25, 0.75), this.coreMat, sx * 1.45, 3.32, 1.15);
      vent.rotation.z = sx * -0.22;
      this.heatVents.push(vent);
      const sideVent = this.addMesh(new THREE.BoxGeometry(0.22, 0.52, 0.18), this.veinMat, sx * 1.72, 2.1, 1.1);
      sideVent.rotation.z = sx * -0.18;
      this.heatVents.push(sideVent);
      for (let i = 0; i < 3; i++) {
        const knuckle = this.addMesh(new THREE.BoxGeometry(0.38, 0.18, 0.32), this.veinMat, sx * (2.68 + i * 0.28), 1.65, 1.08);
        knuckle.rotation.y = sx * 0.12;
      }
      const shoulderSlab = this.addMesh(new THREE.BoxGeometry(0.74, 0.44, 0.72), plateMat, sx * 1.85, 3.02, 0.12);
      shoulderSlab.rotation.z = sx * -0.35;
      this.armorBands.push(shoulderSlab);
    }
    this.crownBand = this.addMesh(new THREE.TorusGeometry(1.25, 0.055, 6, 36), this.veinMat, 0, 3.75);
    this.crownBand.rotation.x = Math.PI / 2;
    const crownShardMat = this.stdMat(0x211008, 0xff7733, 1.0);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const shard = this.addMesh(new THREE.BoxGeometry(0.16, 0.55, 0.2), crownShardMat, Math.sin(a) * 1.15, 4.05, Math.cos(a) * 1.15);
      shard.rotation.y = a;
      shard.rotation.x = 0.25;
      this.armorBands.push(shard);
    }

    this.patchGeo = new THREE.CircleGeometry(1.3, 24);
    this.patchGeo.rotateX(-Math.PI / 2);

    this.buildPhaseLooks();
  }

  /** Pre-build the escalation geometry hidden until its phase unveils it. */
  private buildPhaseLooks(): void {
    // Phase 2: molten armor plates erupt and ring the shoulders like cooling slag.
    const plateMat = this.stdMat(0x3a1206, 0xff5522, 1.5);
    const plateGeo = new THREE.BoxGeometry(0.7, 1.1, 0.4);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const pl = this.addMesh(plateGeo, plateMat, Math.sin(a) * 2.0, 3.0, Math.cos(a) * 2.0);
      pl.rotation.y = a;
      pl.rotation.x = 0.3;
      pl.visible = false;
      this.p2Plates.push(pl);
    }

    // Phase 3: a crown of molten horns blazes from the head as the core goes critical.
    const crownMat = this.stdMat(0x4a1404, 0xffdd55, 2.8);
    const hornGeo = new THREE.ConeGeometry(0.22, 1.3, 5);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const h = this.addMesh(hornGeo, crownMat, Math.sin(a) * 0.95, 4.5, Math.cos(a) * 0.95);
      h.rotation.x = Math.cos(a) * 0.5;
      h.rotation.z = -Math.sin(a) * 0.5;
      h.visible = false;
      this.p3Crown.push(h);
    }
  }

  /** Visibly escalate the boss at each phase transition. */
  private applyPhaseLook(phase: number): void {
    if (phase === 2) {
      this.setBossScale(1.08);
      this.eruptReveal(this.p2Plates);
      this.slagMat.emissive.set(0x7a1c08);
      this.slagMat.emissiveIntensity = 0.7;
      this.coreMat.emissive.set(0xff7733);
      this.veinMat.emissive.set(0xff9944);
    } else if (phase === 3) {
      this.setBossScale(1.15);
      this.eruptReveal(this.p3Crown);
      this.slagMat.color.set(0x401a12);
      this.slagMat.emissive.set(0xb83008);
      this.slagMat.emissiveIntensity = 1.0;
      this.coreMat.emissive.set(0xffcc66);
      this.veinMat.emissive.set(0xffdd88);
    }
    for (const f of this.flashMats) {
      f.baseEmissive.copy(f.mat.emissive);
      f.baseIntensity = f.mat.emissiveIntensity;
    }
  }

  protected deathColor(): number {
    return 0xff5522;
  }

  protected barHeight(): number {
    return 5.2;
  }

  takeDamage(amount: number, opts = {}): boolean {
    const killed = super.takeDamage(amount, { ...opts, kb: 0 });
    this.ctx.events.emit("BOSS_HP", { hp: Math.max(0, this.hp), maxHp: this.maxHp });

    const frac = this.hp / this.maxHp;
    const targetPhase = frac <= 0.35 ? 3 : frac <= 0.7 ? 2 : 1;
    if (!killed && targetPhase > this.phase) {
      this.phase = targetPhase;
      this.state = "phaseShift";
      this.timer = 1.3;
      this.applyPhaseLook(this.phase);
      this.ctx.events.emit("BOSS_PHASE", { phase: this.phase, line: PHASE_LINES[this.phase - 1] });
      this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: 10, color: 0xff5522, duration: 0.8 });
      this.ctx.fx.burst({
        x: this.pos.x, y: 3.0, z: this.pos.z,
        count: 50, color: [0xff5522, 0xffaa44, 0xffffff],
        speed: [4, 14], up: 0.9, size: [0.5, 1.2], life: [0.4, 0.9], gravity: -5, drag: 2.5,
      });
      this.ctx.cam.addTrauma(0.55);
      this.ctx.stage.punch(0.35);
      this.ctx.sfx.bossRoar();
      if (this.phase === 2) {
        for (let i = 0; i < 2; i++) {
          const a = Math.random() * Math.PI * 2;
          this.ctx.enemies.spawn("leaper", this.pos.x + Math.sin(a) * 9, this.pos.z + Math.cos(a) * 9, 1.2);
        }
      }
    }
    return killed;
  }

  freeze(duration: number): void {
    // A mountain does not freeze easily
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
    for (const pt of this.patches) {
      this.ctx.stage.scene.remove(pt.mesh);
      pt.mat.dispose();
    }
    this.patches = [];
    for (const w of this.waves) {
      this.ctx.stage.scene.remove(w.mesh);
      w.mesh.geometry.dispose();
      w.mat.dispose();
    }
    this.waves = [];
    this.patchGeo.dispose();
    this.pounds = [];
    this.mines = [];
    this.rings = [];
  }

  // ---------------------------------------------------------------- attacks
  /** Stone carapace: armor seals (invulnerable) and a wide ring slam punishes melee range. */
  private beginGuard(): void {
    this.setInvuln(1.6);
    this.state = "guard";
    this.timer = 0.85; // wind-up = telegraph duration
    this.fistAnim = 1;
    this.ctx.tele.circle(this.pos.x, this.pos.z, 5.5, 0.85, 0xff5522);
    this.ctx.sfx.beamCharge();
  }

  private beginPoundSeq(): void {
    this.state = "poundSeq";
    this.poundsLeft = this.phase >= 3 ? 3 : 2;
    this.poundGap = 0;
  }

  private aimPound(): void {
    const p = this.ctx.player;
    this.ctx.tele.circle(p.pos.x, p.pos.z, 3.0, 0.9, 0xff7733);
    this.pounds.push({ x: p.pos.x, z: p.pos.z, timer: 0.9 });
    this.poundsLeft--;
    this.poundGap = 0.5;
    this.fistAnim = 1;
    this.ctx.sfx.bossLeap();
  }

  private landPound(pd: PendingPound): void {
    const p = this.ctx.player;
    this.ctx.fx.ring(pd.x, pd.z, { radius: 3.0, color: 0xff7733, duration: 0.45 });
    this.ctx.fx.burst({
      x: pd.x, y: 0.5, z: pd.z,
      count: 34, color: [0xff7733, 0xffcc66, 0x885544],
      speed: [4, 12], up: 0.9, size: [0.5, 1.0], life: [0.3, 0.7], gravity: -8, drag: 2.5,
    });
    this.ctx.cam.addTrauma(0.4);
    this.ctx.stage.punch(0.2);
    this.ctx.sfx.bossSlam();
    const d = Math.hypot(p.pos.x - pd.x, p.pos.z - pd.z);
    if (d < 3.0 + p.radius) {
      this.ctx.combat.damagePlayer(20, pd.x, pd.z);
      const len = Math.max(0.001, d);
      this.ctx.controller.push(((p.pos.x - pd.x) / len) * 7, ((p.pos.z - pd.z) / len) * 7);
    }
  }

  private beginMines(): void {
    this.state = "mines";
    this.timer = 0.6;
    const p = this.ctx.player;
    const n = this.phase >= 3 ? 7 : 5;
    for (let i = 0; i < n; i++) {
      const a = this.ctx.rng.range(0, Math.PI * 2);
      const r = this.ctx.rng.range(0, 4.5);
      const x = p.pos.x + Math.sin(a) * r;
      const z = p.pos.z + Math.cos(a) * r;
      const fuse = 1.2 + i * 0.18;
      this.ctx.tele.circle(x, z, 1.6, fuse, 0xff5522);
      this.mines.push({ x, z, timer: fuse });
    }
    this.ctx.sfx.fuse();
  }

  private eruptMine(m: PendingMine): void {
    const p = this.ctx.player;
    this.ctx.fx.ring(m.x, m.z, { radius: 1.6, color: 0xff5522, duration: 0.35 });
    this.ctx.fx.burst({
      x: m.x, y: 0.4, z: m.z,
      count: 18, color: [0xff5522, 0xffaa44],
      speed: [3, 9], up: 1.2, size: [0.4, 0.8], life: [0.25, 0.55], gravity: -6, drag: 2.5,
    });
    this.ctx.sfx.explosion();
    if (Math.hypot(p.pos.x - m.x, p.pos.z - m.z) < 1.6 + p.radius) {
      this.ctx.combat.damagePlayer(13, m.x, m.z);
    }
    this.dropPatch(m.x, m.z, 2.0);
  }

  private beginTectonic(): void {
    this.state = "tectonicTell";
    this.timer = 1.8;
    this.fistAnim = 1;
    const bands: [number, number, number][] = [
      [4.0, 5.6, 0.7],
      [8.0, 9.6, 1.1],
      [12.0, 13.6, 1.5],
    ];
    for (const [inner, outer, delay] of bands) {
      this.ctx.tele.ring(this.pos.x, this.pos.z, inner, outer, delay, 0xff5522);
      this.rings.push({ inner, outer, timer: delay });
    }
    this.ctx.sfx.beamCharge();
  }

  private slamRing(r: TectonicRing): void {
    const p = this.ctx.player;
    const mid = (r.inner + r.outer) / 2;
    this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: r.outer, color: 0xff5522, duration: 0.4, startRadius: r.inner });
    // Eruption ring of particles along the band
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      this.ctx.fx.burst({
        x: this.pos.x + Math.sin(a) * mid, y: 0.3, z: this.pos.z + Math.cos(a) * mid,
        count: 4, color: [0xff5522, 0xffaa44],
        speed: [2, 7], up: 1.4, size: [0.4, 0.8], life: [0.2, 0.5], gravity: -6, drag: 2.5,
      });
    }
    this.ctx.cam.addTrauma(0.3);
    this.ctx.sfx.bossSlam();
    const d = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    if (d > r.inner - p.radius && d < r.outer + p.radius) {
      this.ctx.combat.damagePlayer(16, this.pos.x, this.pos.z);
    }
    // Phase 3: the outermost slam launches a travelling fire wave
    if (this.phase >= 3 && r.inner > 11) this.launchWave();
  }

  private launchWave(): void {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff6622, transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const geo = new THREE.RingGeometry(0.85, 1.0, 64);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(this.pos.x, 0.35, this.pos.z);
    mesh.scale.setScalar(2.5);
    this.ctx.stage.scene.add(mesh);
    this.waves.push({ radius: 2.5, hit: false, mesh, mat });
  }

  private dropPatch(x: number, z: number, life: number): void {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff5522, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.patchGeo, mat);
    mesh.position.set(x, 0.04, z);
    this.ctx.stage.scene.add(mesh);
    this.patches.push({ x, z, life, mesh, mat, acc: 0 });
  }

  // ---------------------------------------------------------------- tick
  protected tick(dt: number): void {
    const p = this.ctx.player;
    this.timer -= dt;
    this.facePlayer(dt * 0.7);
    this.coreMat.emissiveIntensity = 2.6 + this.phase * 0.6 + Math.sin(this.t * (1.5 + this.phase)) * 0.8;
    this.veinMat.emissiveIntensity = 1.6 + Math.sin(this.t * 2.3) * 0.5;
    const corePulse = 1 + Math.sin(this.t * (1.7 + this.phase * 0.35)) * 0.055;
    this.core.scale.set(corePulse, corePulse, 1 + (corePulse - 1) * 1.35);
    this.crownBand.rotation.z += dt * (0.12 + this.phase * 0.04);
    for (let i = 0; i < this.heatVents.length; i++) {
      const vent = this.heatVents[i];
      vent.scale.z = 1 + Math.sin(this.t * 3.1 + i) * 0.12;
      vent.scale.y = 1 + Math.sin(this.t * 2.2 + i * 0.5) * 0.05;
    }
    for (let i = 0; i < this.armorBands.length; i++) {
      const band = this.armorBands[i];
      band.rotation.x += Math.sin(this.t * 0.9 + i) * dt * 0.015;
    }

    // Fist slam animation
    this.fistAnim = Math.max(0, this.fistAnim - dt * 2.2);
    const fistY = 1.0 + Math.sin(this.fistAnim * Math.PI) * 1.6;
    this.fistL.position.y = fistY;
    this.fistR.position.y = fistY;
    const fistSquash = Math.sin(this.fistAnim * Math.PI);
    this.fistL.scale.set(1 + fistSquash * 0.08, 1 - fistSquash * 0.05, 1 + fistSquash * 0.08);
    this.fistR.scale.copy(this.fistL.scale);

    // Pending pounds / mines / rings always advance
    for (let i = this.pounds.length - 1; i >= 0; i--) {
      this.pounds[i].timer -= dt;
      if (this.pounds[i].timer <= 0) {
        this.landPound(this.pounds[i]);
        this.pounds.splice(i, 1);
      }
    }
    for (let i = this.mines.length - 1; i >= 0; i--) {
      this.mines[i].timer -= dt;
      if (this.mines[i].timer <= 0) {
        this.eruptMine(this.mines[i]);
        this.mines.splice(i, 1);
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      this.rings[i].timer -= dt;
      if (this.rings[i].timer <= 0) {
        this.slamRing(this.rings[i]);
        this.rings.splice(i, 1);
      }
    }

    // Travelling fire waves
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      const prev = w.radius;
      w.radius += dt * 5;
      w.mesh.scale.setScalar(w.radius);
      w.mat.opacity = Math.max(0, 0.65 * (1 - w.radius / 22));
      if (Math.random() < dt * 18) {
        const a = Math.random() * Math.PI * 2;
        this.ctx.fx.burst({
          x: this.pos.x + Math.sin(a) * w.radius, y: 0.3, z: this.pos.z + Math.cos(a) * w.radius,
          count: 2, color: 0xff6622, speed: [0.5, 2], up: 1.6, vertical: 0.3, size: [0.3, 0.55], life: [0.3, 0.6], gravity: 0.5, drag: 1.5,
        });
      }
      if (!w.hit) {
        const d = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
        // The wave band crossed the player this frame
        if (d > prev - 0.6 && d < w.radius + 0.6) {
          if (this.ctx.combat.damagePlayer(10, this.pos.x, this.pos.z) !== "invulnerable") w.hit = true;
        }
      }
      if (w.radius > 22) {
        this.ctx.stage.scene.remove(w.mesh);
        w.mesh.geometry.dispose();
        w.mat.dispose();
        this.waves.splice(i, 1);
      }
    }

    // Fire patches
    for (let i = this.patches.length - 1; i >= 0; i--) {
      const pt = this.patches[i];
      pt.life -= dt;
      pt.mat.opacity = Math.min(0.42, pt.life * 0.5);
      pt.acc -= dt;
      if (pt.acc <= 0 && Math.hypot(p.pos.x - pt.x, p.pos.z - pt.z) < 1.3 + p.radius) {
        if (this.ctx.combat.damagePlayer(5, pt.x, pt.z) === "hit") pt.acc = 0.5;
      }
      if (pt.life <= 0) {
        this.ctx.stage.scene.remove(pt.mesh);
        pt.mat.dispose();
        this.patches.splice(i, 1);
      }
    }

    // Dramatic weight: brace on wind-ups, lunge on slams/tectonics, rear on phase shifts.
    this.poseForState(dt, this.state, this.state === "idle");

    switch (this.state) {
      case "idle":
        if (this.timer <= 0) {
          this.attackPick++;
          // Seal the carapace (invulnerable) for a close ring slam every 4th action.
          if (this.attackPick % 4 === 3) this.beginGuard();
          else if (this.phase >= 2 && this.attackPick % 3 === 0) this.beginTectonic();
          else if (this.phase >= 2 && this.attackPick % 3 === 2) this.beginMines();
          else this.beginPoundSeq();
        }
        break;
      case "guard":
        if (this.timer <= 0) {
          this.wardShock(5.5, 20, 0xff5522);
          this.state = "recover";
          this.timer = 0.7;
        }
        break;
      case "poundSeq":
        this.poundGap -= dt;
        if (this.poundsLeft > 0 && this.poundGap <= 0) this.aimPound();
        if (this.poundsLeft <= 0 && this.pounds.length === 0) {
          this.state = "recover";
          this.timer = 0.65;
        }
        break;
      case "mines":
        if (this.timer <= 0 && this.mines.length === 0) {
          this.state = "recover";
          this.timer = 0.58;
        }
        break;
      case "tectonicTell":
        if (this.timer <= 0 && this.rings.length === 0) {
          this.state = "recover";
          this.timer = 0.72;
        }
        break;
      case "recover":
      case "phaseShift":
        if (this.timer <= 0) {
          this.state = "idle";
          this.timer = Math.max(0.28, 0.9 - this.phase * 0.2);
        }
        break;
    }
  }
}
