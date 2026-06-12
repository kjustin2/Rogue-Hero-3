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
  { dur: 0.26, dmg: 9, arc: (130 * Math.PI) / 180, range: 2.9, kb: 3, heavy: false },
  { dur: 0.24, dmg: 9, arc: (130 * Math.PI) / 180, range: 2.9, kb: 3, heavy: false },
  { dur: 0.36, dmg: 18, arc: Math.PI * 2, range: 3.2, kb: 8, heavy: true },
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
  private coldCrashLatch = false;
  /** Brief invulnerability after crashing. */
  private crashIframes = 0;
  /** Enemies hit by the current swing (for combo tempo). */
  private swingHits = 0;

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

  // ----------------------------------------------------------- player damage
  /**
   * Single entry point for damage to the player. Returns how it resolved so
   * sources can react (projectiles pass through perfect dodges, etc.).
   */
  damagePlayer(dmg: number, srcX: number, srcZ: number): PlayerDamageResult {
    const { player, controller, tempo, events, stats } = this.ctx;
    if (!player.alive) return "invulnerable";
    if (this.crashIframes > 0) return "invulnerable";

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

    dmg = Math.max(1, Math.round(dmg * this.ctx.relics.damageTakenMult()));

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

    player.hp = Math.max(0, player.hp - dmg);
    stats.damageTaken += dmg;
    player.flashHit();
    tempo.drain(10);
    events.emit("PLAYER_HIT", { dmg });

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
  /** Every player-sourced hit on an enemy flows through here. */
  dealDamage(e: Enemy, baseDmg: number, opts: DamageOpts & { countCombo?: boolean } = {}): void {
    const { tempo, stats, events } = this.ctx;
    const zone = tempo.zone;
    const dmg = Math.max(1, Math.round(baseDmg * zone.damageMult * this.ctx.relics.damageDealtMult(e)));
    const killed = e.takeDamage(dmg, opts);
    stats.damageDealt += dmg;

    const critical = zone.zone === "critical";
    this.ctx.floaters.spawn(
      e.pos.x, 1.6, e.pos.z,
      String(dmg),
      opts.heavy || critical ? "crit" : "dmg"
    );
    this.ctx.fx.burst({
      x: e.pos.x, y: 1.0, z: e.pos.z,
      count: opts.heavy ? 16 : 8,
      color: [0xffeeaa, zone.color],
      speed: [2, opts.heavy ? 10 : 7], up: 0.5, size: [0.3, 0.75], life: [0.15, 0.4], gravity: -5, drag: 3.5,
    });
    events.emit("ENEMY_HIT", { x: e.pos.x, y: 1, z: e.pos.z, dmg, heavy: !!opts.heavy, killed });
    if (opts.countCombo) this.swingHits++;
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
    this.ctx.tempo.gain(COMBO_TEMPO[idx]);
    this.ctx.events.emit("COMBO_HIT", { count: hits });
  }

  // ----------------------------------------------------------- crash
  crashNova(): void {
    const { tempo, player } = this.ctx;
    if (!tempo.crashReady) return;
    const mult = tempo.zone.damageMult;
    tempo.crash(this.ctx.relics.crashResetValue() ?? undefined);
    this.crashIframes = 0.45;
    this.ctx.stats.crashes++;
    const R = 6;
    this.ctx.events.emit("CRASH", { x: player.pos.x, z: player.pos.z });
    for (const e of this.ctx.enemies.living()) {
      const dx = e.pos.x - player.pos.x;
      const dz = e.pos.z - player.pos.z;
      if (Math.hypot(dx, dz) < R + e.radius) {
        this.dealDamage(e, 15 * mult, { kbX: dx, kbZ: dz, kb: 12, heavy: true });
      }
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
    if (input.pressed("KeyF") && this.ctx.tempo.crashReady) {
      this.crashNova();
    }

    // Melee chain
    this.chainReset -= dt;
    if (input.mousePressed[0] && !this.ctx.controller.dodging) {
      if (this.stageIdx < 0) {
        // Within the chain window, the combo resumes where it left off
        const next = this.chainReset > 0 ? (this.lastFinished + 1) % CHAIN.length : 0;
        this.startSwing(next);
      } else if (this.swingT / CHAIN[this.stageIdx].dur > 0.45) {
        this.buffered = true;
      }
    }

    if (this.stageIdx >= 0) {
      const stage = CHAIN[this.stageIdx];
      this.swingT += dt;
      const phase = Math.min(1, this.swingT / stage.dur);
      player.animSwing = { phase, heavy: stage.heavy };

      if (!this.struck && phase >= STRIKE_POINT) {
        this.struck = true;
        this.swingHits = 0;
        const hits = this.meleeSweep(player.facing, stage.arc, stage.range, stage.dmg, stage.kb, stage.heavy);
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
    s.mesh.geometry.dispose();
    s.mesh.geometry = new THREE.RingGeometry(stage.range * 0.45, stage.range * 0.95, 36, 1, 0, width);
    s.mesh.geometry.rotateX(-Math.PI / 2);
    s.mesh.position.set(p.pos.x, 1.0, p.pos.z);
    // Flattened sector spans planar angles [0, width] from local +X; center it on facing.
    s.mesh.rotation.set(-0.12, p.facing - Math.PI / 2 - width / 2, 0);
    s.mat.opacity = 0.7;
    s.mat.color.set(stage.heavy ? 0xffcc66 : 0x88eeff);
    s.mesh.scale.setScalar(1);
  }
}
