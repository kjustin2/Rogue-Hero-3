import * as THREE from "three";
import { angleDelta } from "../core/math";
import type { Ctx } from "./ctx";
import type { Enemy, DamageOpts } from "./enemies";

interface SwingStage {
  dur: number;
  dmg: number;
  /** Full arc width in radians. */
  arc: number;
  range: number;
  kb: number;
  heavy: boolean;
}

/** Light, light, 360° finisher. Clicking mid-swing buffers the next stage. */
const CHAIN: SwingStage[] = [
  { dur: 0.26, dmg: 8, arc: (130 * Math.PI) / 180, range: 2.9, kb: 3, heavy: false },
  { dur: 0.24, dmg: 8, arc: (130 * Math.PI) / 180, range: 2.9, kb: 3, heavy: false },
  { dur: 0.36, dmg: 17, arc: Math.PI * 2, range: 3.2, kb: 8, heavy: true },
];

const STRIKE_POINT = 0.3; // fraction of swing where the hit lands
const COMBO_TEMPO = [4, 8, 15, 20]; // by enemies caught: 1 / 2 / 3-4 / 5+

interface SlashArc {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  t: number;
  active: boolean;
}

export type PlayerDamageResult = "hit" | "dodged" | "shielded" | "invulnerable";

interface PlayerDamageOpts {
  /** Only hostile projectile bodies can be parried; melee/contact hits cannot. */
  parryable?: boolean;
}

// Scratch vectors for charge-glow blade points (avoid per-frame allocation).
const _chTip = new THREE.Vector3();
const _chBase = new THREE.Vector3();

/**
 * Hit resolution for everything: the player's melee chain, the central
 * dealDamage pipeline every player-sourced hit flows through (tempo damage
 * multiplier, floaters, sparks, combo tempo), incoming player damage with
 * perfect-dodge interception, and the tempo crash nova.
 */
export class Combat {
  private stageIdx = -1;
  private swingT = 0;
  private struck = false;
  private buffered = false;
  private chainReset = 0;
  private lastFinished = -1;
  private slashes: SlashArc[] = [];
  /** Cached slash-arc geometries keyed by (range,width) — reused across swings (no per-swing alloc). */
  private slashGeoCache = new Map<string, THREE.RingGeometry>();
  private coldCrashLatch = false;
  /** Brief invulnerability after crashing. */
  private crashIframes = 0;
  /** Enemies hit by the current swing (for combo tempo). */
  private swingHits = 0;
  /** In-run passive growth (Ascendant ranks) — a damage multiplier that climbs with kills. */
  runRankMult = 1;
  /** Charged-heavy state: how long attack has been held, and whether a charge is winding up. */
  private chargeT = 0;
  private charging = false;

  /** Parry window: the opening beat of any swing — meeting a hit here deflects it. */
  get parryActive(): boolean {
    return this.stageIdx >= 0 && this.swingT < 0.16;
  }
  /** True while a heavy strike is fully charged and ready to release. */
  get charged(): boolean {
    return this.chargeT >= 0.4;
  }

  constructor(private ctx: Ctx) {
    for (let i = 0; i < 5; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x88eeff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(new THREE.RingGeometry(1.1, 2.6, 32, 1, 0, Math.PI / 2), mat);
      mesh.visible = false;
      ctx.stage.scene.add(mesh);
      this.slashes.push({ mesh, mat, t: 0, active: false });
    }
  }

  get swinging(): boolean {
    return this.stageIdx >= 0;
  }

  /** Clear transient swing/charge state at a room boundary (so nothing carries across). */
  clearTransient(): void {
    this.chargeT = 0;
    this.charging = false;
    this.stageIdx = -1;
    this.swingT = 0;
    this.buffered = false;
    this.ctx.player.animSwing = null;
  }

  // ----------------------------------------------------------- player damage
  /**
   * Single entry point for damage to the player. Returns how it resolved so
   * sources can react (projectiles pass through perfect dodges, etc.).
   */
  damagePlayer(dmg: number, srcX: number, srcZ: number, opts: PlayerDamageOpts = {}): PlayerDamageResult {
    const { player, controller, tempo, events, stats } = this.ctx;
    if (!player.alive) return "invulnerable";
    if (this.crashIframes > 0) return "invulnerable";

    // Parry: only enemy projectile bodies can be deflected in the opening beat.
    if (opts.parryable && this.parryActive) {
      const dx = srcX - player.pos.x;
      const dz = srcZ - player.pos.z;
      if (Math.abs(angleDelta(player.facing, Math.atan2(dx, dz))) < 1.1) {
        this.parryRiposte(srcX, srcZ);
        return "shielded";
      }
    }

    if (controller.invulnerable) {
      if (controller.inPerfectWindow) {
        controller.consumePerfect();
        tempo.gain(15);
        stats.perfectDodges++;
        this.ctx.relics.onPerfectDodge();
        events.emit("PERFECT_DODGE", { x: player.pos.x, z: player.pos.z });
        this.ctx.fx.ring(player.pos.x, player.pos.z, { radius: 2.6, color: 0x66ffee, duration: 0.45 });
        this.ctx.fx.burst({
          x: player.pos.x, y: 1, z: player.pos.z,
          count: 22, color: [0x66ffee, 0xffffff],
          speed: [3, 9], up: 0.6, size: [0.4, 0.8], life: [0.25, 0.5], gravity: -2, drag: 3.5,
        });
        this.ctx.floaters.spawn(player.pos.x, 1.8, player.pos.z, "PERFECT", "tempo");
      }
      return "dodged";
    }

    dmg = Math.max(1, Math.round(dmg * this.ctx.relics.damageTakenMult() * player.hero.dmgTakenMult * this.ctx.difficulty.enemyDmgMult * this.ctx.overdrive.damageTakenMult));

    // Riposte stance: negate the hit and answer with a nova
    if (this.ctx.caster.riposteActive) {
      const honed = this.ctx.caster.riposteUpgradedActive;
      this.ctx.caster.consumeRiposte();
      const novaR = honed ? 5.5 : 4;
      const novaDmg = honed ? 40 : 25;
      for (const e of this.ctx.enemies.living()) {
        const dx = e.pos.x - player.pos.x;
        const dz = e.pos.z - player.pos.z;
        if (Math.hypot(dx, dz) < novaR + e.radius) {
          this.dealDamage(e, novaDmg, { kbX: dx, kbZ: dz, kb: 7, heavy: true });
        }
      }
      tempo.gain(10);
      this.ctx.fx.ring(player.pos.x, player.pos.z, { radius: novaR, color: 0xffe066, duration: 0.45 });
      this.ctx.fx.burst({
        x: player.pos.x, y: 1.1, z: player.pos.z,
        count: 26, color: [0xffe066, 0xffffff],
        speed: [4, 10], up: 0.5, size: [0.4, 0.8], life: [0.25, 0.5], gravity: -3, drag: 3,
      });
      this.ctx.floaters.spawn(player.pos.x, 2.0, player.pos.z, "RIPOSTE", "tempo");
      this.ctx.sfx.crash();
      this.ctx.cam.addTrauma(0.25);
      return "shielded";
    }

    // Shield soaks first
    if (player.shield > 0) {
      player.shield -= dmg;
      this.ctx.fx.burst({
        x: player.pos.x, y: 1.1, z: player.pos.z,
        count: 14, color: 0x66bbff, speed: [2, 6], up: 0.5, size: [0.35, 0.7], life: [0.2, 0.45], gravity: -3, drag: 3,
      });
      this.ctx.sfx.shieldHit();
      if (player.shield <= 0) {
        player.shield = 0;
        events.emit("SHIELD_BROKEN", {});
      }
      return "shielded";
    }

    // Second Wind: a lethal hit leaves you at 1 HP, once per run
    if (player.hp - dmg <= 0 && this.ctx.relics.consumeSecondWind()) {
      player.hp = 1;
      stats.damageTaken += dmg;
      this.ctx.fx.ring(player.pos.x, player.pos.z, { radius: 5, color: 0x7dffb0, duration: 0.7 });
      this.ctx.fx.burst({
        x: player.pos.x, y: 1, z: player.pos.z,
        count: 36, color: [0x7dffb0, 0xffffff],
        speed: [3, 9], up: 0.8, size: [0.4, 0.9], life: [0.3, 0.7], gravity: -2, drag: 3,
      });
      this.ctx.floaters.spawn(player.pos.x, 2.2, player.pos.z, "SECOND WIND", "heal");
      this.ctx.stage.punch(0.6);
      this.ctx.sfx.coldCrash();
      events.emit("PLAYER_HIT", { dmg, srcX, srcZ });
      return "hit";
    }

    player.hp = Math.max(0, player.hp - dmg);
    stats.damageTaken += dmg;
    player.flashHit();
    tempo.drain(10);
    events.emit("PLAYER_HIT", { dmg, srcX, srcZ });
    this.ctx.relics.onDamageTaken(srcX, srcZ);

    const dx = player.pos.x - srcX;
    const dz = player.pos.z - srcZ;
    const len = Math.hypot(dx, dz) || 1;
    this.ctx.cam.kick(dx / len, dz / len, 6);
    this.ctx.cam.addTrauma(0.45);
    this.ctx.stage.punch(0.55);
    this.ctx.controller.push((dx / len) * 4, (dz / len) * 4);
    this.ctx.floaters.spawn(player.pos.x, 1.9, player.pos.z, `-${Math.round(dmg)}`, "playerdmg");

    if (player.hp <= 0) {
      player.alive = false;
      events.emit("PLAYER_DIED", {});
      this.ctx.fx.burst({
        x: player.pos.x, y: 1, z: player.pos.z,
        count: 50, color: [0xffffff, 0x66ddff],
        speed: [3, 12], up: 0.8, size: [0.5, 1.1], life: [0.5, 1.2], gravity: -6, drag: 2,
      });
      player.root.visible = false;
    }
    return "hit";
  }

  // ----------------------------------------------------------- deal damage
  private enemyHitFx(e: Enemy, opts: DamageOpts, color: number, critical: boolean, killed: boolean): void {
    const armored = e.kind === "bastion" || e.kind === "sentinel" || e.kind === "brute" || e.kind === "mirror";
    const voidTouched = e.kind === "shade" || e.kind === "voidling" || e.kind === "warper" || e.kind === "boss";
    const p = this.ctx.player;
    const dx = e.pos.x - p.pos.x;
    const dz = e.pos.z - p.pos.z;
    const dl = Math.hypot(dx, dz) || 1;
    const ix = e.pos.x - (dx / dl) * e.radius * 0.45;
    const iz = e.pos.z - (dz / dl) * e.radius * 0.45;
    const palette = armored
      ? [0xffe0a0, 0xffffff, color]
      : voidTouched
        ? [0x9a5cff, 0xe8e0ff, color]
        : [0xffeeaa, color, critical ? 0xffffff : color];
    this.ctx.fx.burst({
      x: ix, y: armored ? 1.1 : 0.9, z: iz,
      count: opts.heavy ? 12 : critical ? 10 : 6,
      color: [0xffffff, opts.heavy ? 0xffcc66 : color],
      speed: [1.5, opts.heavy || critical ? 9 : 6],
      up: 0.25,
      size: [0.16, opts.heavy ? 0.52 : 0.36],
      life: [0.08, 0.22],
      gravity: -5,
      drag: 5,
      jitter: 0.08,
    });
    const count = killed ? 22 : opts.heavy ? 18 : critical ? 14 : 8;
    this.ctx.fx.burst({
      x: e.pos.x, y: armored ? 1.15 : voidTouched ? 1.08 : 1.0, z: e.pos.z,
      count,
      color: palette,
      speed: [armored ? 3 : 2, opts.heavy ? 11 : critical ? 9 : 7],
      up: armored ? 0.3 : voidTouched ? 0.85 : 0.5,
      size: [0.28, opts.heavy || critical ? 0.9 : 0.68],
      life: [0.15, voidTouched ? 0.52 : 0.38],
      gravity: voidTouched ? -1.2 : -5,
      drag: armored ? 4.4 : 3.4,
      jitter: voidTouched ? 0.55 : 0.2,
    });
    if (opts.heavy) this.ctx.fx.ring(e.pos.x, e.pos.z, { radius: e.radius * 2.8, color: 0xffffff, duration: 0.24 });
    if (critical) this.ctx.fx.ring(e.pos.x, e.pos.z, { radius: e.radius * 2.1, color, duration: 0.28 });
    if (armored) this.ctx.fx.burst({ x: e.pos.x, y: 0.75, z: e.pos.z, count: 6, color: [0xffffff, 0xffcc66], speed: [4, 9], up: 0.1, size: [0.18, 0.42], life: [0.12, 0.28], gravity: -8, drag: 5 });
  }

  /** Every player-sourced hit on an enemy flows through here. */
  dealDamage(e: Enemy, baseDmg: number, opts: DamageOpts & { countCombo?: boolean } = {}): void {
    const { tempo, stats, events } = this.ctx;
    const zone = tempo.zone;
    const wasFrozen = e.frozen > 0;
    const dmg = Math.max(1, Math.round(
      baseDmg * zone.damageMult * tempo.crescendoMult * this.ctx.overdrive.damageMult * this.runRankMult * e.vulnerableMult * this.ctx.relics.damageDealtMult(e)
    ));
    const killed = e.takeDamage(dmg, opts);
    this.ctx.overdrive.onDamageDealt(e.lastHitShielded ? e.lastBodyDamage : dmg);
    // Shatterglass: a blow on a frozen foe shatters the ice for a frost burst.
    if (!opts.noDetonate && wasFrozen && this.ctx.relics.has("shatterglass")) {
      this.shatter(e);
    }
    // Execution: a heavy blow finishes a badly-wounded foe outright — tempo + a sliver of heal.
    if (!killed && opts.heavy && e.kind !== "boss" && e.alive && e.hp <= e.maxHp * 0.12) {
      e.takeDamage(99999);
      tempo.gain(6);
      const p = this.ctx.player;
      if (p.alive && p.hp < p.maxHp) { p.hp = Math.min(p.maxHp, p.hp + 2); events.emit("HEAL", { amount: 2 }); }
      this.ctx.floaters.spawn(e.pos.x, 2.3, e.pos.z, "EXECUTE", "tempo");
      this.ctx.fx.ring(e.pos.x, e.pos.z, { radius: 2.4, color: 0xffffff, duration: 0.3 });
      this.ctx.cam.addTrauma(0.16);
    }
    // A shielded hit drains the guard (the enemy spawns its own chip floater + sparks);
    // only what reached the BODY counts toward the stat and the generic FX.
    const bodyDmg = e.lastHitShielded ? e.lastBodyDamage : dmg;
    stats.damageDealt += bodyDmg;

    if (!e.lastHitShielded) {
      const critical = zone.zone === "critical";
      this.ctx.floaters.spawn(
        e.pos.x, 1.6, e.pos.z,
        String(dmg),
        opts.heavy || critical ? "crit" : "dmg"
      );
      this.enemyHitFx(e, opts, zone.color, critical, killed);
    }
    events.emit("ENEMY_HIT", { x: e.pos.x, y: 1, z: e.pos.z, dmg: bodyDmg, heavy: !!opts.heavy, killed });
    if (opts.countCombo) this.swingHits++;
  }

  /** Parry: negate the blow, surge tempo, and counter the attacker. */
  private parryRiposte(srcX: number, srcZ: number): void {
    const p = this.ctx.player;
    this.ctx.tempo.gain(8);
    this.ctx.cam.addTrauma(0.2);
    this.ctx.stage.punch(0.3);
    this.ctx.fx.ring(p.pos.x, p.pos.z, { radius: 2.4, color: 0xffe066, duration: 0.35 });
    this.ctx.fx.burst({
      x: p.pos.x, y: 1.1, z: p.pos.z,
      count: 20, color: [0xffe066, 0xffffff], speed: [4, 11], up: 0.5, size: [0.35, 0.8], life: [0.2, 0.45], gravity: -2, drag: 3,
    });
    this.ctx.floaters.spawn(p.pos.x, 2.0, p.pos.z, "PARRY", "tempo");
    this.ctx.sfx.shieldHit();
    // Counter the nearest foe to the blow's source.
    let best: Enemy | null = null;
    let bestD = 4;
    for (const e of this.ctx.enemies.living()) {
      const d = Math.hypot(e.pos.x - srcX, e.pos.z - srcZ);
      if (d < bestD) { bestD = d; best = e; }
    }
    if (best) this.dealDamage(best, 10, { kbX: best.pos.x - p.pos.x, kbZ: best.pos.z - p.pos.z, kb: 3 });
  }

  /** Shatterglass detonation: clear the freeze and blast nearby foes with frost. */
  private shatter(src: Enemy): void {
    src.frozen = 0;
    const R = 3.2;
    for (const e of this.ctx.enemies.living()) {
      if (e === src) continue;
      const dx = e.pos.x - src.pos.x;
      const dz = e.pos.z - src.pos.z;
      if (Math.hypot(dx, dz) < R + e.radius) {
        this.dealDamage(e, 14, { kbX: dx, kbZ: dz, kb: 5, heavy: true, noDetonate: true });
      }
    }
    this.ctx.fx.ring(src.pos.x, src.pos.z, { radius: R, color: 0xbfeaff, duration: 0.4 });
    this.ctx.fx.burst({
      x: src.pos.x, y: 1, z: src.pos.z,
      count: 24, color: [0xbfeaff, 0xffffff], speed: [4, 12], up: 0.5, size: [0.3, 0.8], life: [0.2, 0.5], gravity: -3, drag: 3,
    });
    this.ctx.sfx.coldCrash();
    this.ctx.cam.addTrauma(0.18);
  }

  /** Sweep all living enemies inside an arc. Returns number hit. */
  meleeSweep(arcCenter: number, arcWidth: number, range: number, dmg: number, kb: number, heavy: boolean): number {
    const p = this.ctx.player;
    let hits = 0;
    for (const e of this.ctx.enemies.living()) {
      const dx = e.pos.x - p.pos.x;
      const dz = e.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > range + e.radius) continue;
      const ang = Math.atan2(dx, dz);
      if (Math.abs(angleDelta(arcCenter, ang)) > arcWidth / 2 + Math.atan2(e.radius, Math.max(0.5, d))) continue;
      this.dealDamage(e, dmg, { kbX: dx, kbZ: dz, kb, heavy });
      hits++;
    }
    return hits;
  }

  /** Public slash-arc FX for cards that swing outside the basic chain. */
  slashVisual(arc: number, range: number, heavy: boolean): void {
    this.spawnSlashArc({ dur: 0, dmg: 0, arc, range, kb: 0, heavy });
  }

  /** Tempo payout scaling with enemies caught in one swing. */
  private comboTempoPayout(hits: number): void {
    if (hits <= 0) return;
    const idx = hits >= 5 ? 3 : hits >= 3 ? 2 : hits - 1;
    this.ctx.tempo.gain(Math.round(COMBO_TEMPO[idx] * this.ctx.player.hero.comboTempoMult));
    this.ctx.events.emit("COMBO_HIT", { count: hits });
  }

  // ----------------------------------------------------------- crash
  crashNova(): void {
    const { tempo, player } = this.ctx;
    if (!tempo.crashReady) return;
    // Crash mastery: cashing out near the very top (≥95) is a "perfect crash" —
    // a wider, harder nova that refunds a little heat back.
    const perfect = tempo.value >= 95;
    const mult = tempo.zone.damageMult * (perfect ? 1.2 : 1);
    tempo.crash(this.ctx.relics.crashResetValue() ?? undefined);
    this.crashIframes = 0.45;
    this.ctx.stats.crashes++;
    const R = perfect ? 6.6 : 5.2;
    this.ctx.events.emit("CRASH", { x: player.pos.x, z: player.pos.z });
    for (const e of this.ctx.enemies.living()) {
      const dx = e.pos.x - player.pos.x;
      const dz = e.pos.z - player.pos.z;
      if (Math.hypot(dx, dz) < R + e.radius) {
        this.dealDamage(e, 8 * mult, { kbX: dx, kbZ: dz, kb: 8, heavy: true });
      }
    }
    if (perfect) {
      tempo.gain(15);
      this.ctx.floaters.spawn(player.pos.x, 2.1, player.pos.z, "PERFECT CRASH", "tempo");
    }
    this.ctx.fx.ring(player.pos.x, player.pos.z, { radius: R, color: 0xff4252, duration: 0.55 });
    this.ctx.fx.ring(player.pos.x, player.pos.z, { radius: R * 0.6, color: 0xffffff, duration: 0.4 });
    this.ctx.fx.burst({
      x: player.pos.x, y: 1, z: player.pos.z,
      count: 60, color: [0xff4252, 0xffaa66, 0xffffff],
      speed: [5, 16], up: 0.6, size: [0.5, 1.2], life: [0.3, 0.8], gravity: -5, drag: 2.5,
    });
    this.ctx.cam.addTrauma(0.55);
    this.ctx.cam.pulseFov(1);
    this.ctx.stage.punch(0.5);
    this.ctx.sfx.crash();
    this.ctx.relics.onCrash();
  }

  /** Released charged heavy: a wide guard-breaking sweep that leaves foes Vulnerable. */
  private chargedHeavy(): void {
    const p = this.ctx.player;
    const hero = p.hero;
    const range = 4.2;
    const hits = this.meleeSweep(p.facing, Math.PI * 2, range, 40 * hero.meleeDmgMult, 14 * hero.kbMult, true);
    for (const e of this.ctx.enemies.living()) {
      if (Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z) < range + e.radius) e.applyVulnerable(3, 1.25);
    }
    this.slashVisual(Math.PI * 2, range, true);
    this.ctx.tempo.gain(10);
    this.ctx.cam.addTrauma(0.42);
    this.ctx.cam.kick(Math.sin(p.facing), Math.cos(p.facing), 5);
    this.ctx.stage.punch(0.5);
    this.ctx.cam.pulseFov(0.6);
    this.ctx.fx.ring(p.pos.x, p.pos.z, { radius: range, color: 0xffcc66, duration: 0.45 });
    this.ctx.fx.burst({
      x: p.pos.x, y: 1, z: p.pos.z,
      count: 40, color: [0xffcc66, 0xffffff], speed: [5, 15], up: 0.7, size: [0.4, 1.1], life: [0.3, 0.7], gravity: -4, drag: 2.5,
    });
    this.ctx.sfx.swing(2, hits > 0);
    this.ctx.floaters.spawn(p.pos.x, 2.1, p.pos.z, "HEAVY", "crit");
  }

  private coldCrash(): void {
    const { tempo, player } = this.ctx;
    tempo.value = 25;
    tempo.gain(0);
    this.ctx.enemies.freezeAll(2.5);
    this.ctx.events.emit("COLD_CRASH", { x: player.pos.x, z: player.pos.z });
    this.ctx.fx.ring(player.pos.x, player.pos.z, { radius: 9, color: 0x4f8dff, duration: 0.8 });
    this.ctx.fx.burst({
      x: player.pos.x, y: 1, z: player.pos.z,
      count: 40, color: [0x4f8dff, 0xaaddff],
      speed: [3, 10], up: 0.7, size: [0.4, 0.9], life: [0.4, 0.9], gravity: -2, drag: 3,
    });
    this.ctx.sfx.coldCrash();
  }

  // ----------------------------------------------------------- update
  update(dt: number): void {
    const { input, player } = this.ctx;
    this.crashIframes = Math.max(0, this.crashIframes - dt);
    if (!player.alive) {
      player.animSwing = null;
      return;
    }

    // Cold crash trigger
    if (this.ctx.tempo.value <= 0 && !this.coldCrashLatch) {
      this.coldCrashLatch = true;
      this.coldCrash();
    }
    if (this.ctx.tempo.value > 5) this.coldCrashLatch = false;

    // Crash input
    if (input.actionPressed("crash") && this.ctx.tempo.crashReady) {
      this.crashNova();
    }

    // Melee chain
    this.chainReset -= dt;
    if (input.actionPressed("attack") && !this.ctx.controller.dodging) {
      if (this.stageIdx < 0) {
        // Within the chain window, the combo resumes where it left off
        const next = this.chainReset > 0 ? (this.lastFinished + 1) % CHAIN.length : 0;
        this.startSwing(next);
      } else if (this.swingT / CHAIN[this.stageIdx].dur > 0.45) {
        this.buffered = true;
      }
    }

    // Charged heavy: holding attack between swings winds up a guard-breaking blow.
    const attackDown = input.actionDown("attack");
    if (attackDown && this.stageIdx < 0 && !this.ctx.controller.dodging) {
      this.chargeT += dt;
      this.charging = this.chargeT > 0.18;
      if (this.charging && Math.random() < dt * 26) {
        player.getBladePoints(_chTip, _chBase);
        this.ctx.fx.burst({ x: _chTip.x, y: _chTip.y, z: _chTip.z, count: 2, color: [0xffcc66, 0xffffff], speed: [0.5, 2], up: 1, size: [0.2, 0.5], life: [0.2, 0.5], gravity: -1, drag: 2 });
      }
    } else {
      if (this.charged) this.chargedHeavy();
      this.charging = false;
      this.chargeT = 0;
    }

    if (this.stageIdx >= 0) {
      const stage = CHAIN[this.stageIdx];
      this.swingT += dt;
      const phase = Math.min(1, this.swingT / stage.dur);
      player.animSwing = { phase, heavy: stage.heavy };

      if (!this.struck && phase >= STRIKE_POINT) {
        this.struck = true;
        this.swingHits = 0;
        const hero = player.hero;
        const hits = this.meleeSweep(
          player.facing, stage.arc, stage.range,
          stage.dmg * hero.meleeDmgMult, stage.kb * hero.kbMult, stage.heavy
        );
        this.comboTempoPayout(hits);
        this.spawnSlashArc(stage);
        this.ctx.sfx.swing(this.stageIdx, hits > 0);
        if (hits > 0) {
          const fx = Math.sin(player.facing);
          const fz = Math.cos(player.facing);
          this.ctx.cam.kick(fx, fz, stage.heavy ? 4.5 : 2);
          this.ctx.cam.addTrauma(stage.heavy ? 0.3 : 0.14);
          if (stage.heavy) this.ctx.tempo.gain(8);
        }
      }

      if (phase >= 1) {
        const wasIdx = this.stageIdx;
        this.stageIdx = -1;
        this.lastFinished = wasIdx;
        player.animSwing = null;
        this.chainReset = 0.9;
        if (this.buffered) {
          this.buffered = false;
          this.startSwing((wasIdx + 1) % CHAIN.length);
        }
      }
    }

    // Slash arc fade
    for (const s of this.slashes) {
      if (!s.active) continue;
      s.t += dt;
      const k = s.t / 0.2;
      if (k >= 1) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      s.mat.opacity = 0.7 * (1 - k);
      s.mesh.scale.setScalar(1 + k * 0.25);
    }
  }

  private startSwing(idx: number): void {
    this.stageIdx = idx;
    this.swingT = 0;
    this.struck = false;
    // Small forward step into the swing — keeps melee aggressive
    const p = this.ctx.player;
    const step = CHAIN[idx].heavy ? 1.4 : 2.2;
    this.ctx.controller.push(Math.sin(p.facing) * step, Math.cos(p.facing) * step);
  }

  private spawnSlashArc(stage: SwingStage): void {
    const s = this.slashes.find((x) => !x.active);
    if (!s) return;
    const p = this.ctx.player;
    s.active = true;
    s.t = 0;
    s.mesh.visible = true;
    // RingGeometry sector is drawn in the XY plane starting at +X; lay it flat
    // and rotate so it's centered on the facing direction.
    const width = Math.min(stage.arc, Math.PI * 1.9);
    const key = `${stage.range.toFixed(2)}|${width.toFixed(3)}`;
    let geo = this.slashGeoCache.get(key);
    if (!geo) {
      geo = new THREE.RingGeometry(stage.range * 0.45, stage.range * 0.95, 36, 1, 0, width);
      geo.rotateX(-Math.PI / 2);
      this.slashGeoCache.set(key, geo);
    }
    s.mesh.geometry = geo; // shared/cached — never disposed per-swing
    s.mesh.position.set(p.pos.x, 1.0, p.pos.z);
    // Flattened sector spans planar angles [0, width] from local +X; center it on facing.
    s.mesh.rotation.set(-0.12, p.facing - Math.PI / 2 - width / 2, 0);
    s.mat.opacity = 0.7;
    s.mat.color.set(stage.heavy ? 0xffcc66 : this.ctx.player.bladeColor);
    s.mesh.scale.setScalar(1);
  }
}
