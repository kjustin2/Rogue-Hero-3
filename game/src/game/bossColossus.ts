import * as THREE from "three";
import { Enemy, type EnemyKind } from "./enemies";
import type { Ctx } from "./ctx";
import { forgeColossus } from "../render/colossusForge";

const PHASE_LINES = [
  "THE ENGINE OF THE CORE IGNITES",
  "THE MOUNTAIN REMEMBERS HOW TO BURN",
  "THE CORE GOES CRITICAL",
];

type ColossusState = "idle" | "poundSeq" | "mines" | "tectonicTell" | "novaTell" | "recover" | "phaseShift" | "guard";

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
  private shoulders: THREE.Group[];
  private elbows: THREE.Group[];
  private slamClocks = [0, 0];
  private slamDurations = [0.82, 0.82];
  private nextFist = 0;
  private crownBand: THREE.Mesh;
  /** Spin offset locked at a radial nova's wind-up so tell and fire agree. */
  private novaSpin = 0;
  private heatVents: THREE.Object3D[] = [];
  private armorBands: THREE.Object3D[] = [];
  /** 0→1 wind-up read: the core blazes and the heat vents gape while charging. */
  private chargeAmt = 0;
  // Per-phase appearance escalation (built once, revealed on transition).
  private p2Plates: THREE.Object3D[] = [];
  private p3Crown: THREE.Object3D[] = [];

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 3300;
    this.speed = 0; // rooted — it pivots, the arena moves instead
    this.radius = 2.2;
    this.wardColor = 0xff5522;

    const rig = forgeColossus(this.root, (color, emissive, intensity) => this.stdMat(color, emissive, intensity));
    this.bindCinematicParts([...rig.shoulders,...rig.elbows]);
    this.core = rig.core;
    this.coreMat = rig.coreMat;
    this.veinMat = rig.veinMat;
    this.slagMat = rig.slagMat;
    this.shoulders = rig.shoulders;
    for(const sign of [-1,1]) this.footContacts.push({node:this.root,offset:new THREE.Vector3(sign*.92,.04,.52),radius:.68});
    this.elbows = rig.elbows;
    this.crownBand = rig.crownBand;
    this.heatVents = rig.heatVents;
    this.armorBands = rig.armorBands;
    this.p2Plates = rig.phasePlates;
    this.p3Crown = rig.phaseHorns;

    this.patchGeo = new THREE.CircleGeometry(1.3, 24);
    this.patchGeo.rotateX(-Math.PI / 2);

  }

  /** Visibly escalate the boss at each phase transition. */
  private applyPhaseLook(phase: number): void {
    if (phase === 2) {
      this.setBossScale(1.08);
      this.eruptReveal(this.p2Plates);
      this.slagMat.emissive.set(0x7a1c08);
      this.slagMat.emissiveIntensity = 0.14;
      this.coreMat.emissive.set(0xff7733);
      this.veinMat.emissive.set(0xff9944);
    } else if (phase === 3) {
      this.setBossScale(1.15);
      this.eruptReveal(this.p3Crown);
      this.slagMat.color.set(0x401a12);
      this.slagMat.emissive.set(0xb83008);
      this.slagMat.emissiveIntensity = 0.24;
      this.coreMat.emissive.set(0xffcc66);
      this.veinMat.emissive.set(0xffdd88);
    }
    for (const f of this.flashMats) {
      f.baseEmissive.copy(f.mat.emissive);
      f.baseIntensity = f.mat.emissiveIntensity;
    }
  }

  interruptAttack(): void {
    super.interruptAttack();
    this.clearHazards();
    this.poundsLeft = 0; this.slamClocks.fill(0);
  }

  protected animateDeath(dt: number, progress: number): boolean {
    this.settleDeathPart(this.root, dt, .07, this.root.rotation.y, 0);
    for (let i = 0; i < this.shoulders.length; i++) {
      // One fist braces first; the second follows as the furnace goes cold.
      const delay = i === 1 && progress < .15 ? .18 : 1;
      this.settleDeathPart(this.shoulders[i], dt * delay, -.2, 0, i === 0 ? -.04 : .04);
      this.settleDeathPart(this.elbows[i], dt * delay, .08, 0, 0);
    }
    this.core.scale.setScalar(1 - Math.min(1, progress * 2) * .12);
    return true;
  }

  protected onGuardBroken(): void {
    this.state = "recover";
    this.timer = 1.35;
  }

  protected animateCinematic(action: string, time: number, dt: number): boolean {
    const strike=action==="ignite"||action==="phase"||action==="last-stand";
    const lift=strike?Math.min(1,time/.43):0;
    const fall=strike?Math.min(1,Math.max(0,(time-.43)/.24)):0;
    const load=lift*(1-fall*fall), settle=Math.exp(-Math.max(0,time-.67)*5);
    this.drivePose(dt,{lunge:strike&&fall===1?.08*settle:.012});
    for (let i=0;i<2;i++) {
      const k=Math.min(1,dt*19), arm=this.shoulders[i], elbow=this.elbows[i];
      const armLift = load*(i===0 ? .22 : 1.55);
      arm.rotation.x += (-0.04-armLift-arm.rotation.x)*k;
      arm.rotation.z += ((i===0?1:-1)*0.04-arm.rotation.z)*k;
      elbow.rotation.x += (-armLift*.34-elbow.rotation.x)*k;
    }
    this.coreMat.emissiveIntensity = .85+load*.45+(strike?fall*settle*.38:Math.min(1,time)*.2);
    this.veinMat.emissiveIntensity = .45+load*.2+(strike?fall*.3:0);
    return true;
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
      const from = this.phase;
      this.phase = targetPhase;
      this.interruptAttack();
      this.state = "phaseShift";
      this.timer = 1.3;
      // Walk intervening phases so a two-threshold hit still fires each phase's content.
      for (let p = from + 1; p <= targetPhase; p++) {
        this.applyPhaseLook(p);
        if (p === 2) {
          for (let i = 0; i < 2; i++) {
            const a = this.ctx.rng.next() * Math.PI * 2;
            this.ctx.enemies.spawn("leaper", this.pos.x + Math.sin(a) * 9, this.pos.z + Math.cos(a) * 9, 1.2);
          }
        }
      }
      this.ctx.events.emit("BOSS_PHASE", { phase: this.phase, line: PHASE_LINES[this.phase - 1] });
      // Layered molten shockwave: a fast bright flare inside a slow wide magma wave.
      this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: 6, color: 0xffffcc, duration: 0.3 });
      this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: 10, color: 0xff5522, duration: 0.8 });
      this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: 14, color: 0x7a1c08, duration: 1.2, startRadius: 3 });
      this.ctx.fx.burst({
        x: this.pos.x, y: 3.0, z: this.pos.z,
        count: 75, color: [0xff5522, 0xffaa44, 0xffffff],
        speed: [4, 16], up: 0.9, size: [0.5, 1.3], life: [0.4, 0.95], gravity: -5, drag: 2.5,
      });
      this.ctx.cam.addTrauma(0.7);
      this.ctx.cam.kickRoll((Math.random() < 0.5 ? -1 : 1) * 0.09); // cosmetic: fx/jitter — NOT sim state (must stay off ctx.rng)
      this.ctx.cam.pulseFov(0.9);
      this.ctx.stage.punch(0.48);
      this.ctx.sfx.bossRoar();
      // The mountain's fresh cracks exhale outward — a shove off the slag.
      const player = this.ctx.player;
      const dx = player.pos.x - this.pos.x;
      const dz = player.pos.z - this.pos.z;
      const len = Math.hypot(dx, dz) || 1;
      this.ctx.controller.push((dx / len) * 7, (dz / len) * 7);
    }
    return killed;
  }

  freeze(duration: number): void {
    // A mountain does not freeze easily
    super.freeze(duration * 0.35);
  }

  die(): void {
    if (!this.alive) return;
    this.disposeExtras();
    super.die();
    this.ctx.events.emit("BOSS_DEFEATED", { x: this.pos.x, z: this.pos.z });
  }

  dispose(): void {
    this.disposeExtras();
    super.dispose();
  }

  private disposeExtras(): void {
    this.clearHazards();
    this.patchGeo.dispose();
  }

  private clearHazards(): void {
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
    this.pounds = [];
    this.mines = [];
    this.rings = [];
  }

  // ---------------------------------------------------------------- attacks
  /** Stone carapace: armor seals (invulnerable) and a wide ring slam punishes melee range. */
  private beginGuard(): void {
    this.raiseGuard();
    this.state = "guard";
    this.timer = 0.95; // wind-up = telegraph duration
    this.raiseFists(0.95);
    this.warnCircle(this.pos.x, this.pos.z, 6.4, 0.95, 0xff5522);
    this.ctx.sfx.beamCharge();
  }

  private raiseFists(duration: number): void {
    this.slamClocks.fill(duration);
    this.slamDurations.fill(duration);
  }

  private beginPoundSeq(): void {
    this.state = "poundSeq";
    // A heavier barrage — the mountain commits more fists each cycle.
    this.poundsLeft = this.phase >= 3 ? 5 : this.phase >= 2 ? 4 : 3;
    this.poundGap = 0;
  }

  /** A radial burst of magma bolts — the mountain spits fire in every direction,
   *  so even at range there is always something to side-step. */
  private beginNova(): void {
    this.state = "novaTell";
    this.timer = 0.6;
    this.novaSpin = this.phase >= 2 ? (this.ctx.rng.next() < 0.5 ? -1 : 1) * (0.2 + this.phase * 0.1) : 0;
    this.raiseFists(0.6);
    this.warnCircle(this.pos.x, this.pos.z, 4.4, 0.6, 0xff7733);
    this.ctx.sfx.beamCharge();
  }

  private fireNova(): void {
    const count = this.phase >= 3 ? 26 : this.phase >= 2 ? 20 : 15;
    const p = this.ctx.player;
    const base = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z) + this.novaSpin;
    for (let i = 0; i < count; i++) {
      const a = base + (i / count) * Math.PI * 2;
      this.ctx.hostiles.fire(this.pos.x, this.pos.z, a, { speed: 8.5, dmg: 10, color: 0xff7733, radius: 0.34 });
    }
    this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: 4.4, color: 0xff7733, duration: 0.45 });
    this.ctx.fx.burst({
      x: this.pos.x, y: 2.4, z: this.pos.z,
      count: 28, color: [0xff5522, 0xffaa44, 0xffffff],
      speed: [4, 13], up: 0.6, size: [0.4, 0.9], life: [0.3, 0.6], gravity: -3, drag: 2.8,
    });
    this.ctx.cam.addTrauma(0.3);
    this.ctx.sfx.enemyShoot();
  }

  private aimPound(): void {
    const p = this.ctx.player;
    // Bigger, faster-chained slams — the fists fall harder and cover more ground.
    this.warnCircle(p.pos.x, p.pos.z, 3.9, 0.82, 0xff7733);
    this.pounds.push({ x: p.pos.x, z: p.pos.z, timer: 0.82 });
    this.poundsLeft--;
    this.poundGap = 0.48;
    const fist = this.nextFist++ % 2;
    this.slamClocks[fist] = this.slamDurations[fist] = 0.82;
    this.ctx.sfx.bossLeap();
  }

  private landPound(pd: PendingPound): void {
    const p = this.ctx.player;
    this.ctx.fx.ring(pd.x, pd.z, { radius: 3.9, color: 0xff7733, duration: 0.45 });
    this.ctx.fx.burst({
      x: pd.x, y: 0.5, z: pd.z,
      count: 34, color: [0xff7733, 0xffcc66, 0x885544],
      speed: [4, 12], up: 0.9, size: [0.5, 1.0], life: [0.3, 0.7], gravity: -8, drag: 2.5,
    });
    this.ctx.cam.addTrauma(0.4);
    this.ctx.stage.punch(0.2);
    this.ctx.sfx.bossSlam();
    const d = Math.hypot(p.pos.x - pd.x, p.pos.z - pd.z);
    if (d < 3.9 + p.radius) {
      const result = this.ctx.combat.damagePlayer(22, pd.x, pd.z);
      if (result === "hit" || result === "shielded") {
        const len = Math.max(0.001, d);
        this.ctx.controller.push(((p.pos.x - pd.x) / len) * 8, ((p.pos.z - pd.z) / len) * 8);
      }
    }
  }

  private beginMines(): void {
    this.state = "mines";
    this.timer = 0.6;
    const p = this.ctx.player;
    const n = this.phase >= 3 ? 8 : 6;
    for (let i = 0; i < n; i++) {
      const a = this.ctx.rng.range(0, Math.PI * 2);
      const r = this.ctx.rng.range(0, 5.0);
      const x = p.pos.x + Math.sin(a) * r;
      const z = p.pos.z + Math.cos(a) * r;
      const fuse = 1.05 + i * 0.15;
      this.warnCircle(x, z, 2.1, fuse, 0xff5522);
      this.mines.push({ x, z, timer: fuse });
    }
    this.ctx.sfx.fuse();
  }

  private eruptMine(m: PendingMine): void {
    const p = this.ctx.player;
    this.ctx.fx.ring(m.x, m.z, { radius: 2.1, color: 0xff5522, duration: 0.35 });
    this.ctx.fx.burst({
      x: m.x, y: 0.4, z: m.z,
      count: 18, color: [0xff5522, 0xffaa44],
      speed: [3, 9], up: 1.2, size: [0.4, 0.8], life: [0.25, 0.55], gravity: -6, drag: 2.5,
    });
    this.ctx.sfx.explosion();
    if (Math.hypot(p.pos.x - m.x, p.pos.z - m.z) < 2.1 + p.radius) {
      this.ctx.combat.damagePlayer(14, m.x, m.z);
    }
    this.dropPatch(m.x, m.z, 2.4);
  }

  private beginTectonic(): void {
    this.state = "tectonicTell";
    this.timer = 1.6;
    this.raiseFists(0.6);
    // Wider annulus bands with narrower safe lanes — harder to thread.
    const bands: [number, number, number][] = [
      [3.6, 5.7, 0.6],
      [7.6, 9.8, 1.0],
      [11.6, 14.0, 1.4],
    ];
    for (const [inner, outer, delay] of bands) {
      this.warnRing(this.pos.x, this.pos.z, inner, outer, delay, 0xff5522);
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
      this.ctx.combat.damagePlayer(18, this.pos.x, this.pos.z);
    }
    // Phase 3: the outermost slam launches a travelling fire wave
    if (this.phase >= 3 && r.inner > 11) this.launchWave();
  }

  private launchWave(): void {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff6622, transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const geo = new THREE.RingGeometry(1.9, 3.1, 64);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(this.pos.x, 0.35, this.pos.z);
    mesh.scale.setScalar(1);
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
    // Wind-up read: the core blazes white-hot and the vents gape as it loads a blow.
    const charging = this.state === "novaTell" || this.state === "tectonicTell" || this.state === "guard";
    this.chargeAmt += ((charging ? 1 : 0) - this.chargeAmt) * Math.min(1, dt * 5);
    this.coreMat.emissiveIntensity = 0.95 + this.phase * 0.12 + Math.sin(this.t * (1.5 + this.phase)) * 0.14 + this.chargeAmt * 0.85;
    this.veinMat.emissiveIntensity = 0.65 + Math.sin(this.t * 2.3) * 0.15 + this.chargeAmt * 0.65;
    const corePulse = 1 + Math.sin(this.t * (1.7 + this.phase * 0.35)) * 0.055;
    this.core.scale.set(corePulse, corePulse, 1 + (corePulse - 1) * 1.35);
    this.crownBand.rotation.z += dt * (0.12 + this.phase * 0.04);
    for (let i = 0; i < this.heatVents.length; i++) {
      const vent = this.heatVents[i];
      vent.scale.z = 1 + Math.sin(this.t * 3.1 + i) * 0.12 + this.chargeAmt * 0.45;
      vent.scale.y = 1 + Math.sin(this.t * 2.2 + i * 0.5) * 0.05 + this.chargeAmt * 0.2;
    }
    for (let i = 0; i < this.armorBands.length; i++) {
      const band = this.armorBands[i];
      band.rotation.x += Math.sin(this.t * 0.9 + i) * dt * 0.015;
    }

    // Shoulder and elbow share a hierarchy: armor, knuckles and fingers follow the blow.
    // Each alternating fist commits at the same instant as its ground eruption.
    for (let i = 0; i < 2; i++) {
      const active = this.slamClocks[i] > 0;
      this.slamClocks[i] = Math.max(0, this.slamClocks[i] - dt);
      const progress = 1 - this.slamClocks[i] / this.slamDurations[i];
      const lift = !active ? 0 : progress < 0.28 ? smooth(progress / 0.28) : progress < 0.8 ? 1 : 1 - smooth((progress - 0.8) / 0.2);
      const breathe = Math.sin(this.t * 1.3 + i * 0.3) * 0.018;
      this.shoulders[i].rotation.x = -lift * 1.25 + breathe;
      this.shoulders[i].rotation.z = (i === 0 ? 1 : -1) * (0.08 + lift * 0.1);
      this.elbows[i].rotation.x = -lift * 0.42;
    }

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
      // Move a constant-width annulus; growing the mesh also grew the apparent hit band.
      const positions = w.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let vertex = 0; vertex < positions.count; vertex++) {
        const x = positions.getX(vertex), z = positions.getZ(vertex);
        const length = Math.hypot(x, z);
        const radius = vertex < 65 ? w.radius - 0.6 : w.radius + 0.6;
        positions.setXYZ(vertex, x / length * radius, 0, z / length * radius);
      }
      positions.needsUpdate = true;
      w.mesh.geometry.computeBoundingSphere();
      w.mat.opacity = Math.max(0, 0.65 * (1 - w.radius / 22));
      if (Math.random() < dt * 18) { // cosmetic: fx/jitter — NOT sim state (must stay off ctx.rng)
        const a = Math.random() * Math.PI * 2; // cosmetic: fx/jitter — NOT sim state (must stay off ctx.rng)
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
          const k = this.attackPick;
          // Seal the carapace (invulnerable) for a close ring slam every 5th action.
          if (k % 5 === 4) this.beginGuard();
          // A radial magma nova every ~3rd action keeps bolts in the air to weave.
          else if (k % 3 === 1) this.beginNova();
          else if (this.phase >= 2 && k % 4 === 2) this.beginTectonic();
          else if (this.phase >= 2 && k % 4 === 0) this.beginMines();
          else this.beginPoundSeq();
        }
        break;
      case "guard":
        if (this.timer <= 0) {
          this.wardShock(6.4, 22, 0xff5522);
          this.state = "recover";
          this.timer = 0.58;
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
      case "novaTell":
        if (this.timer <= 0) {
          this.fireNova();
          this.state = "recover";
          this.timer = 0.55;
        }
        break;
      case "recover":
      case "phaseShift":
        if (this.timer <= 0) {
          this.state = "idle";
          // Quicker between attacks — the mountain barely pauses now.
          this.timer = Math.max(0.18, 0.62 - this.phase * 0.18);
        }
        break;
    }
  }
}

function smooth(t: number): number { return t * t * (3 - 2 * t); }
