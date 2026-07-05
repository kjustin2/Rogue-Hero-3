import * as THREE from "three";
import type { TempoZone } from "../core/events";
import { Enemy, type EnemyKind } from "./enemies";
import type { Ctx } from "./ctx";

const WOUND_RED = 0xff2a4a;
const WOUND_PALE = 0xff9aa8;
const WOUND_EYE = 0xfff0f2;

const PHASE_LINES = [
  "YOU PUT OUT THE STAR. I AM WHAT IT WAS HOLDING SHUT.",
  "THE WARDENS FELL KEEPING ME BENEATH THE FLOOR.",
  "THERE IS NOTHING LEFT BETWEEN US.",
];

type WoundState = "idle" | "rakeTell" | "castTell" | "crashTell" | "guard" | "recover" | "phaseShift";

interface PendingRake { x: number; z: number; angle: number; timer: number; }
interface PendingRain { x: number; z: number; timer: number; }

const RAKE_LEN = 22;
const RAKE_W = 2.4;

/**
 * THE WOUND BENEATH — the Ascension true-final boss (depth 3+, after the Unmaker).
 * It mirrors the player's SYSTEMS: it runs its own visible tempo meter (heats up
 * while pressing you, crashes at the peak, goes sluggish when denied) and it
 * swallows one of your card slots per phase, casting a corrupted version of that
 * card back at you. Breaking a phase returns the card. Every attack telegraphs.
 */
export class WoundBoss extends Enemy {
  readonly kind: EnemyKind = "boss";
  phase = 1;
  private state: WoundState = "idle";
  private timer = 1.6;
  private attackPick = 0;
  private rakes: PendingRake[] = [];
  private rains: PendingRain[] = [];
  private volleyAt = -1;
  private crashAt = -1;

  // Its own tempo: pressing the player heats it; disengaging bleeds it cold.
  private bossTempo = 40;
  private tempoEmitAcc = 0;
  /** Seconds since spawn — drives the first-theft (base `t` starts randomized). */
  private spawnClock = 0;
  /** Slot currently swallowed (-1 = none yet). */
  private stolenSlot = -1;
  private stealAnnounced = false;
  /** Counts down the arena's phase-transition dim-then-snap-back; 0 = no dim pending. */
  private dimTimer = 0;

  private coreMat: THREE.MeshStandardMaterial;
  private eyeMat: THREE.MeshStandardMaterial;
  private talonMat: THREE.MeshStandardMaterial;
  private ringMat: THREE.MeshStandardMaterial;
  private eye: THREE.Mesh;
  private rings: THREE.Group;
  private talons: THREE.Object3D[] = [];
  private phaseSpurs: THREE.Object3D[] = [];

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 2400;
    this.speed = 3.2;
    this.radius = 1.8;
    this.wardColor = WOUND_RED;

    this.coreMat = this.stdMat(0x1a060a, WOUND_RED, 1.1);
    this.eyeMat = this.stdMat(0x0a0204, WOUND_EYE, 2.6);
    this.talonMat = this.stdMat(0x140408, WOUND_PALE, 0.9);
    this.ringMat = this.stdMat(0x10040a, WOUND_RED, 1.5);

    // A low, crawling maw: a flattened dark mass with a single white-hot eye,
    // ringed by inward-curving talons — the thing that was under the floor.
    const body = this.addMesh(new THREE.IcosahedronGeometry(1.5, 0), this.coreMat, 0, 1.1);
    body.scale.set(1.25, 0.62, 1.25);
    this.eye = this.addMesh(new THREE.SphereGeometry(0.5, 12, 10), this.eyeMat, 0, 1.55, 0.7);
    const talonGeo = new THREE.ConeGeometry(0.22, 1.9, 5);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const talon = this.addMesh(talonGeo, this.talonMat, Math.sin(a) * 1.7, 0.9, Math.cos(a) * 1.7);
      talon.rotation.set(Math.cos(a) * 0.55, a, -Math.sin(a) * 0.55);
      this.talons.push(talon);
    }
    // Torn rings orbiting low — the wound's edges, never quite closing.
    this.rings = new THREE.Group();
    this.rings.position.y = 1.2;
    this.root.add(this.rings);
    const r1 = this.addMesh(new THREE.TorusGeometry(2.2, 0.09, 6, 40, Math.PI * 1.55), this.ringMat, 0, 0, 0, this.rings);
    r1.rotation.x = Math.PI / 2.2;
    const r2 = this.addMesh(new THREE.TorusGeometry(1.6, 0.06, 6, 36, Math.PI * 1.3), this.ringMat, 0, 0.3, 0, this.rings);
    r2.rotation.set(Math.PI / 1.9, 0.8, 0.4);
    // Phase spurs: hidden crimson spikes that erupt as it escalates.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const spur = this.addMesh(new THREE.ConeGeometry(0.16, 1.4, 4), this.ringMat, Math.sin(a) * 1.1, 2.0, Math.cos(a) * 1.1);
      spur.rotation.set(-0.4 + Math.cos(a) * 0.3, a, Math.sin(a) * 0.3);
      spur.visible = false;
      this.phaseSpurs.push(spur);
    }
  }

  protected deathColor(): number { return WOUND_RED; }
  protected barHeight(): number { return 3.6; }

  takeDamage(amount: number, opts = {}): boolean {
    const killed = super.takeDamage(amount, { ...opts, kb: 0 });
    this.ctx.events.emit("BOSS_HP", { hp: Math.max(0, this.hp), maxHp: this.maxHp });
    const frac = this.hp / this.maxHp;
    const targetPhase = frac <= 0.33 ? 3 : frac <= 0.66 ? 2 : 1;
    if (!killed && targetPhase > this.phase) {
      const from = this.phase;
      this.phase = targetPhase;
      this.state = "phaseShift";
      this.timer = 1.2;
      this.speed = 3.2 + this.phase * 0.5;
      this.setBossScale(1 + (this.phase - 1) * 0.07);
      // Walk intervening phases so a two-threshold hit still reveals each phase's spurs.
      for (let p = from + 1; p <= targetPhase; p++) {
        if (p === 2) this.eruptReveal(this.phaseSpurs.slice(0, 3));
        else this.eruptReveal(this.phaseSpurs.slice(3));
      }
      // Breaking a phase pries your card back out of it — then it swallows another.
      this.returnStolen();
      this.stealCard();
      this.ctx.events.emit("BOSS_PHASE", { phase: this.phase, line: PHASE_LINES[this.phase - 1] });
      // Layered shockwave: a fast bright tear inside a slow wide crimson wave.
      this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: 5, color: WOUND_EYE, duration: 0.3 });
      this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: 9, color: WOUND_RED, duration: 0.7 });
      this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: 13, color: 0x5a0a18, duration: 1.15, startRadius: 3 });
      this.ctx.fx.burst({
        x: this.pos.x, y: 1.6, z: this.pos.z,
        count: 66, color: [WOUND_RED, WOUND_PALE, 0xffffff],
        speed: [4, 14], up: 0.7, size: [0.4, 1.05], life: [0.4, 0.9], gravity: -3, drag: 2.5,
      });
      this.ctx.cam.addTrauma(0.65);
      this.ctx.cam.kickRoll((Math.random() < 0.5 ? -1 : 1) * 0.08);
      this.ctx.cam.pulseFov(0.8);
      this.ctx.stage.punch(0.4);
      this.ctx.sfx.bossRoar();
      // The room holds its breath a beat, then snaps back to full light.
      this.ctx.arena.cutsceneDim = 1;
      this.dimTimer = 0.6;
      // The floor tears wider — a shove off the wound as it splits.
      const player = this.ctx.player;
      const dx = player.pos.x - this.pos.x;
      const dz = player.pos.z - this.pos.z;
      const len = Math.hypot(dx, dz) || 1;
      this.ctx.controller.push((dx / len) * 7, (dz / len) * 7);
    }
    return killed;
  }

  freeze(duration: number): void { super.freeze(duration * 0.35); }

  die(): void {
    // Safety net: a killing blow landing inside the phase-shift dim window must not
    // leave the arena stuck dark — tick() stops running the instant alive flips false.
    if (this.dimTimer > 0) { this.dimTimer = 0; this.ctx.arena.cutsceneDim = 0; }
    this.rakes = [];
    this.rains = [];
    this.returnStolen();
    this.ctx.events.emit("BOSS_DEFEATED", { x: this.pos.x, z: this.pos.z });
    super.die();
  }

  dispose(): void {
    this.returnStolen(); // never leave a slot swallowed (quit-to-menu mid-fight)
    super.dispose();
  }

  // ------------------------------------------------------------- card theft
  private stealCard(): void {
    // Never orphan a held slot: return whatever's swallowed before taking another,
    // and disarm the first-theft gate so a fast phase-1 break can't double-steal.
    if (this.stolenSlot >= 0) this.returnStolen();
    this.stealAnnounced = true;
    const deck = this.ctx.deck;
    const candidates = deck.slots.map((c, i) => (c && !deck.stolen[i] ? i : -1)).filter((i) => i >= 0);
    if (!candidates.length) return;
    this.stolenSlot = candidates[Math.floor(this.ctx.rng.range(0, candidates.length)) % candidates.length];
    deck.steal(this.stolenSlot);
    const p = this.ctx.player;
    this.ctx.floaters.spawn(p.pos.x, 2.3, p.pos.z, "IT SWALLOWS YOUR ART", "label");
    this.ctx.fx.burst({
      x: p.pos.x, y: 1.2, z: p.pos.z,
      count: 18, color: [WOUND_RED, 0xffffff], speed: [2, 7], up: 1.2, size: [0.3, 0.7], life: [0.3, 0.6], gravity: 0.5, drag: 2,
    });
    this.ctx.sfx.deny();
  }

  private returnStolen(): void {
    if (this.stolenSlot < 0) return;
    this.ctx.deck.restore(this.stolenSlot);
    this.stolenSlot = -1;
    const p = this.ctx.player;
    this.ctx.floaters.spawn(p.pos.x, 2.3, p.pos.z, "YOUR ART RETURNS", "tempo");
  }

  /** The corrupted cast mimics the swallowed card's school (by its tags). */
  private stolenTags(): string[] {
    if (this.stolenSlot < 0) return [];
    return this.ctx.deck.slots[this.stolenSlot]?.tags ?? [];
  }

  // ------------------------------------------------------------- its tempo
  private gainTempo(n: number): void {
    this.bossTempo = Math.max(0, Math.min(100, this.bossTempo + n));
  }

  private get tempoZone(): TempoZone {
    return this.bossTempo >= 90 ? "critical" : this.bossTempo >= 70 ? "hot" : this.bossTempo >= 30 ? "flowing" : "cold";
  }

  /** Its attacks report their hits here — landing blows stokes it, like yours do. */
  private hitPlayer(dmg: number, sx: number, sz: number): void {
    if (this.ctx.combat.damagePlayer(dmg, sx, sz) === "hit") this.gainTempo(12);
  }

  // ------------------------------------------------------------- attacks
  private beginRake(): void {
    this.state = "rakeTell";
    this.timer = 0.65;
    const p = this.ctx.player;
    const base = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    const fan = this.phase >= 2 ? 3 : 2;
    for (let i = 0; i < fan; i++) {
      const angle = base + (i - (fan - 1) / 2) * 0.42;
      this.ctx.tele.line(this.pos.x, this.pos.z, angle, RAKE_LEN, RAKE_W, 0.65, WOUND_RED);
      this.rakes.push({ x: this.pos.x, z: this.pos.z, angle, timer: 0.65 });
    }
    this.ctx.sfx.beamCharge();
  }

  private fireRake(r: PendingRake): void {
    const p = this.ctx.player;
    const sx = Math.sin(r.angle);
    const cz = Math.cos(r.angle);
    this.pos.x = r.x + sx * 7;
    this.pos.z = r.z + cz * 7;
    this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: 2.6, color: WOUND_RED, duration: 0.35 });
    this.ctx.fx.burst({ x: r.x + sx * 5, y: 0.8, z: r.z + cz * 5, count: 22, color: [WOUND_RED, WOUND_PALE], speed: [4, 12], up: 0.4, size: [0.3, 0.8], life: [0.2, 0.5], gravity: -3, drag: 3 });
    this.ctx.sfx.bossDash();
    this.ctx.cam.addTrauma(0.2);
    const px = p.pos.x - r.x;
    const pz = p.pos.z - r.z;
    const along = px * sx + pz * cz;
    if (along > 0 && along < RAKE_LEN) {
      const perp = Math.abs(px * cz - pz * sx);
      if (perp < RAKE_W * 0.5 + p.radius) this.hitPlayer(this.phase >= 2 ? 18 : 15, r.x, r.z);
    }
  }

  /** The corrupted card: your swallowed school, turned on you. */
  private beginCorruptedCast(): void {
    this.state = "castTell";
    const tags = this.stolenTags();
    const p = this.ctx.player;
    if (tags.includes("fire") || tags.includes("arcane")) {
      // Corrupted rain (meteor/starfall school): telegraphed impacts around the player.
      this.timer = 0.95;
      const n = this.phase >= 3 ? 5 : 4;
      for (let i = 0; i < n; i++) {
        const a = this.ctx.rng.range(0, Math.PI * 2);
        const rr = i === 0 ? 0 : this.ctx.rng.range(1.5, 5);
        const x = p.pos.x + Math.sin(a) * rr;
        const z = p.pos.z + Math.cos(a) * rr;
        this.ctx.tele.circle(x, z, 2.1, 0.95, WOUND_RED);
        this.rains.push({ x, z, timer: 0.95 });
      }
    } else if (tags.includes("frost") || tags.includes("force") || tags.includes("guard")) {
      // Corrupted nova (frost/force school): a crash-style burst centered on itself.
      this.timer = 0.85;
      this.crashAt = 0.85;
      this.ctx.tele.circle(this.pos.x, this.pos.z, 6.2, 0.85, WOUND_PALE);
    } else {
      // Corrupted volley (bolt school — and its default before any theft).
      this.timer = 0.6;
      this.volleyAt = 0.6;
      this.ctx.tele.circle(this.pos.x, this.pos.z, 2.6, 0.6, WOUND_RED);
    }
    this.ctx.sfx.beamCharge();
  }

  private fireRain(r: PendingRain): void {
    this.ctx.fx.ring(r.x, r.z, { radius: 2.1, color: WOUND_RED, duration: 0.4 });
    this.ctx.fx.burst({ x: r.x, y: 0.8, z: r.z, count: 18, color: [WOUND_RED, 0xffffff], speed: [3, 10], up: 0.8, size: [0.35, 0.85], life: [0.25, 0.55], gravity: -5, drag: 2.6 });
    this.ctx.sfx.explosion();
    const p = this.ctx.player;
    if (Math.hypot(p.pos.x - r.x, p.pos.z - r.z) < 2.1 + p.radius) this.hitPlayer(14, r.x, r.z);
  }

  private fireVolley(): void {
    const p = this.ctx.player;
    const base = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    const n = this.phase >= 3 ? 9 : 7;
    for (let i = 0; i < n; i++) {
      const a = base + (i - (n - 1) / 2) * 0.16;
      this.ctx.hostiles.fire(this.pos.x, this.pos.z, a, { speed: 9.5, dmg: 8, color: WOUND_RED, radius: 0.3 });
    }
    this.ctx.sfx.enemyShoot();
  }

  private fireCrash(radius: number, dmg: number): void {
    const p = this.ctx.player;
    this.ctx.fx.ring(this.pos.x, this.pos.z, { radius, color: WOUND_RED, duration: 0.55 });
    this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: radius * 0.55, color: 0xffffff, duration: 0.4 });
    this.ctx.fx.burst({
      x: this.pos.x, y: 1, z: this.pos.z,
      count: 44, color: [WOUND_RED, WOUND_PALE, 0xffffff], speed: [5, 14], up: 0.6, size: [0.4, 1.0], life: [0.3, 0.7], gravity: -4, drag: 2.5,
    });
    this.ctx.cam.addTrauma(0.4);
    this.ctx.sfx.crash();
    if (Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) < radius + p.radius) this.hitPlayer(dmg, this.pos.x, this.pos.z);
  }

  // ------------------------------------------------------------- tick
  protected tick(dt: number): void {
    const p = this.ctx.player;
    this.timer -= dt;
    this.spawnClock += dt;
    // Phase-transition dim: holds the arena dark for a beat, then snaps back to full light.
    if (this.dimTimer > 0) {
      this.dimTimer -= dt;
      if (this.dimTimer <= 0) this.ctx.arena.cutsceneDim = 0;
    }

    // Living idle: the eye tracks, talons flex, rings grind, glow rides its tempo.
    const heat = this.bossTempo / 100;
    this.coreMat.emissiveIntensity = 0.9 + heat * 1.4 + Math.sin(this.t * 3.2) * 0.25;
    this.eyeMat.emissiveIntensity = 2.2 + heat * 1.6;
    this.rings.rotation.y += dt * (0.8 + heat * 1.6);
    this.eye.position.y = 1.55 + Math.sin(this.t * 2.1) * 0.08;
    for (let i = 0; i < this.talons.length; i++) {
      this.talons[i].rotation.x += Math.sin(this.t * 2.6 + i) * dt * 0.25;
    }

    // Its tempo: pressing you heats it, disengaging bleeds it. Cold = sluggish.
    const d = this.distToPlayer();
    this.gainTempo((d < 9 ? 7 : -5) * dt);
    this.tempoEmitAcc -= dt;
    if (this.tempoEmitAcc <= 0) {
      this.tempoEmitAcc = 0.15;
      this.ctx.events.emit("BOSS_TEMPO", { value: this.bossTempo, zone: this.tempoZone });
    }
    const zoneSpeed = this.tempoZone === "cold" ? 0.75 : this.tempoZone === "hot" ? 1.15 : this.tempoZone === "critical" ? 1.3 : 1;

    // First theft: once the entrance settles, it takes its first card.
    if (!this.stealAnnounced && this.spawnClock > 6.5) {
      this.stealCard(); // sets stealAnnounced + returns any already-held slot
    }

    // Its CRASH: at the peak it cashes its heat out exactly like you do — dodge it.
    // Never interrupt a wind-up mid-cast — a preempted castTell/rakeTell keeps its own
    // countdown and would land a SECOND nova moments after the crash (double damage).
    // Tempo clamps at 100 and only resets after the crash fires, so this just defers
    // the crash to the next tick once the boss exits the cast — no attack is lost.
    if (this.bossTempo >= 100 && this.state !== "crashTell" && this.state !== "phaseShift" && this.state !== "guard" && this.state !== "castTell" && this.state !== "rakeTell") {
      this.state = "crashTell";
      this.timer = 0.9;
      this.ctx.tele.circle(this.pos.x, this.pos.z, 7.2, 0.9, 0xffffff);
      this.ctx.sfx.beamCharge();
    }

    for (let i = this.rains.length - 1; i >= 0; i--) {
      this.rains[i].timer -= dt;
      if (this.rains[i].timer <= 0) { this.fireRain(this.rains[i]); this.rains.splice(i, 1); }
    }
    for (let i = this.rakes.length - 1; i >= 0; i--) {
      this.rakes[i].timer -= dt;
      if (this.rakes[i].timer <= 0) { this.fireRake(this.rakes[i]); this.rakes.splice(i, 1); }
    }
    if (this.volleyAt > 0) {
      this.volleyAt -= dt;
      if (this.volleyAt <= 0) { this.fireVolley(); this.volleyAt = -1; }
    }
    if (this.crashAt > 0) {
      this.crashAt -= dt;
      if (this.crashAt <= 0) { this.fireCrash(6.2, 20); this.crashAt = -1; }
    }

    this.poseForState(dt, this.state, this.state === "idle");

    switch (this.state) {
      case "idle": {
        this.facePlayer(dt);
        if (d > 5.5) this.seek(p.pos.x, p.pos.z, dt, 0.85 * zoneSpeed);
        else {
          const ang = Math.atan2(this.pos.x - p.pos.x, this.pos.z - p.pos.z) + 0.6 * dt;
          this.seek(p.pos.x + Math.sin(ang) * d, p.pos.z + Math.cos(ang) * d, dt, 0.5 * zoneSpeed);
        }
        if (this.timer <= 0) this.pickAttack();
        break;
      }
      case "rakeTell":
        if (this.timer <= 0 && this.rakes.length === 0) { this.state = "recover"; this.timer = 0.5; }
        break;
      case "castTell":
        this.facePlayer(dt * 0.5);
        if (this.timer <= 0 && this.rains.length === 0 && this.volleyAt < 0 && this.crashAt < 0) {
          this.state = "recover";
          this.timer = 0.5;
        }
        break;
      case "crashTell":
        if (this.timer <= 0) {
          this.fireCrash(7.2, 24);
          this.bossTempo = 30;
          this.state = "recover";
          this.timer = 0.6;
        }
        break;
      case "guard":
        this.facePlayer(dt * 0.5);
        if (this.timer <= 0) { this.wardShock(4.4, 16, WOUND_RED); this.state = "recover"; this.timer = 0.5; }
        break;
      case "recover":
      case "phaseShift":
        this.facePlayer(dt);
        if (this.timer <= 0) { this.state = "idle"; this.timer = Math.max(0.35, 1.0 - this.phase * 0.18); }
        break;
    }
  }

  private pickAttack(): void {
    this.attackPick++;
    if (this.attackPick % 4 === 3) {
      this.setInvuln(1.2);
      this.state = "guard";
      this.timer = 0.6;
      this.ctx.tele.circle(this.pos.x, this.pos.z, 4.4, 0.6, WOUND_PALE);
      this.ctx.sfx.beamCharge();
      return;
    }
    if (this.attackPick % 2 === 0) this.beginRake();
    else this.beginCorruptedCast();
  }
}
