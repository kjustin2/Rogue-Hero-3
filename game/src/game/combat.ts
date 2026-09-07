import { BLADE_MOTION } from "./bladeMotionData";
import * as THREE from "three";
import { angleDelta } from "../core/math";
import { ParticleShape } from "../render/particles";
import type { Ctx } from "./ctx";
import type { Enemy, DamageOpts } from "./enemies";
import type { AttackFamily } from "../presentation/types";
import { crashRadius, PERFECT_CRASH_THRESHOLD } from "./tempo";
import { ATTACK_ELEMENT, BOSS_ATTACK_FAMILY, ENEMY_ATTACK_FAMILY } from "../presentation/profiles";
import { schoolElement } from "./specialties";

interface SwingStage {
  dur: number;
  dmg: number;
  /** Full arc width in radians. */
  arc: number;
  range: number;
  kb: number;
  heavy: boolean;
  family: AttackFamily;
  strikePoint: number;
}

/** Light, light, 360° finisher. Clicking mid-swing buffers the next stage. */
const CHAIN: SwingStage[] = [
  { dur: 0.26, dmg: 9, arc: (125 * Math.PI) / 180, range: 2.9, kb: 2.4, heavy: false, family: "blade-opener", strikePoint: BLADE_MOTION[0].strikePoint },
  { dur: 0.29, dmg: 11, arc: (150 * Math.PI) / 180, range: 3.1, kb: 2.8, heavy: false, family: "blade-return", strikePoint: BLADE_MOTION[1].strikePoint },
  { dur: 0.44, dmg: 22, arc: Math.PI * 2, range: 3.5, kb: 8, heavy: true, family: "blade-finisher", strikePoint: BLADE_MOTION[2].strikePoint },
];
const CHARGED_SWING: SwingStage = { dur: 0.48, dmg: 40, arc: Math.PI * 2, range: 4.2, kb: 14, heavy: true, family: "charged-heavy", strikePoint: BLADE_MOTION[3].strikePoint };
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
  /** Presentation-only origin metadata; never participates in resolution. */
  sourceId?: string;
  sourceKind?: string;
  attackFamily?: AttackFamily;
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
  /** Counter window: a perfect dodge arms the next melee strike (bonus damage + tempo). Public for the smoke seam. */
  counterWindow = 0;
  /** Debug god-mode: when on, all player damage is ignored (toggled via __rh3debug.godmode). */
  god = false;
  private queuedAttack = 0;
  private dashAttack = false;
  /** In-run passive growth (Ascendant ranks) — a damage multiplier that climbs with kills. */
  runRankMult = 1;
  /** The spared star's gift: once, a lethal hit is refused (Wound fight on mercy runs). */
  emberRevive = false;
  /** Charged-heavy state: how long attack has been held, and whether a charge is winding up. */
  private chargeT = 0;
  private charging = false;
  private currentFamily: AttackFamily = "blade-opener";

  /** Parry window: the opening beat of any swing — meeting a hit here deflects it. */
  get parryActive(): boolean {
    return this.stageIdx >= 0 && this.swingT < 0.16;
  }
  /** True while a heavy strike is fully charged and ready to release. */
  get charged(): boolean {
    return this.chargeT >= 0.4;
  }
  get chargeProgress(): number { return Math.min(1, this.chargeT / 0.4); }
  private get swingStage(): SwingStage { return this.stageIdx === 3 ? CHARGED_SWING : CHAIN[this.stageIdx]; }

  constructor(private ctx: Ctx) {
    for (let i = 0; i < 5; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x88eeff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        vertexColors: true,
      });
      const mesh = new THREE.Mesh(new THREE.RingGeometry(1.1, 2.6, 32, 1, 0, Math.PI / 2), mat);
      mesh.visible = false;
      mesh.userData.solidity = "fx";
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
    this.counterWindow = 0;
    this.stageIdx = -1;
    this.swingT = 0;
    this.struck = false;
    this.buffered = false;
    this.chainReset = 0;
    this.lastFinished = -1;
    this.queuedAttack = 0;
    this.dashAttack = false;
    this.currentFamily = "blade-opener";
    this.coldCrashLatch = false; // a new room must be able to cold-crash again
    this.crashIframes = 0;
    this.ctx.player.animSwing = null;
    this.ctx.player.animCharge = 0;
    this.clearSlashVisuals();
  }

  /** Dodge cancels wind-up and recovery immediately; it never swings through a roll. */
  cancelSwing(): void {
    this.stageIdx = -1;
    this.buffered = false;
    this.chargeT = 0;
    this.charging = false;
    this.ctx.player.animSwing = null;
    this.ctx.player.animCharge = 0;
    this.clearSlashVisuals();
  }

  // ----------------------------------------------------------- player damage
  private incomingPresentationSource(srcX: number, srcZ: number, opts: PlayerDamageOpts): Required<Pick<PlayerDamageOpts, "sourceId" | "sourceKind" | "attackFamily">> {
    if (opts.sourceId && opts.sourceKind && opts.attackFamily) return {
      sourceId: opts.sourceId, sourceKind: opts.sourceKind, attackFamily: opts.attackFamily,
    };
    let nearest: Enemy | null = null;
    let nearestD = 7;
    for (const enemy of this.ctx.enemies.living()) {
      const d = Math.hypot(enemy.pos.x - srcX, enemy.pos.z - srcZ);
      if (d < nearestD) { nearest = enemy; nearestD = d; }
    }
    if (nearest) {
      const bossKind = nearest.kind === "boss" ? this.ctx.run.currentNode?.bossKind : undefined;
      return {
        sourceId: opts.sourceId ?? `${nearest.kind === "boss" ? "boss" : "enemy"}:${nearest.id}`,
        sourceKind: opts.sourceKind ?? (bossKind ?? nearest.kind),
        attackFamily: opts.attackFamily ?? (bossKind ? BOSS_ATTACK_FAMILY[bossKind] : ENEMY_ATTACK_FAMILY[nearest.kind]) ?? "enemy-contact",
      };
    }
    const feature = this.ctx.run.currentNode?.feature;
    const family: AttackFamily = feature === "sweeper" ? "hazard-sweeper"
      : feature === "flamevent" ? "hazard-flame" : feature === "spikes" ? "hazard-spikes"
      : feature === "drifters" ? "hazard-drifter" : "hazard-rift";
    return { sourceId: opts.sourceId ?? `environment:${feature ?? "arena"}`, sourceKind: opts.sourceKind ?? "environment", attackFamily: opts.attackFamily ?? family };
  }

  private playerHitFx(dmg: number, srcX: number, srcZ: number, opts: PlayerDamageOpts, shielded = false): void {
    const p = this.ctx.player;
    const source = this.incomingPresentationSource(srcX, srcZ, opts);
    const dx = p.pos.x - srcX;
    const dz = p.pos.z - srcZ;
    const len = Math.hypot(dx, dz) || 1;
    this.ctx.events.emit("IMPACT_CUE", {
      sourceId: source.sourceId,
      sourceKind: source.sourceKind,
      targetId: `hero:${p.hero.id}`,
      targetKind: "hero",
      attackFamily: source.attackFamily,
      x: p.pos.x - (dx / len) * p.radius * 0.35,
      y: 1,
      z: p.pos.z - (dz / len) * p.radius * 0.35,
      dirX: dx / len,
      dirZ: dz / len,
      damage: dmg,
      color: shielded ? 0x8bdcff : 0xff8b7d,
      strength: shielded ? "critical" : dmg >= 16 ? "heavy" : "light",
      element: shielded ? "frost" : ATTACK_ELEMENT[source.attackFamily] ?? "rift",
      shielded,
      killed: !shielded && p.hp <= 0,
    });
  }

  /**
   * Single entry point for damage to the player. Returns how it resolved so
   * sources can react (projectiles pass through perfect dodges, etc.).
   */
  damagePlayer(dmg: number, srcX: number, srcZ: number, opts: PlayerDamageOpts = {}): PlayerDamageResult {
    const { player, controller, tempo, events, stats } = this.ctx;
    if (!player.alive || this.ctx.run.state === "victory") return "invulnerable";
    if (this.god) return "invulnerable";
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
        this.counterWindow = 1.6;
        this.ctx.relics.onPerfectDodge();
        events.emit("PERFECT_DODGE", { x: player.pos.x, z: player.pos.z });
        this.ctx.fx.ring(player.pos.x, player.pos.z, { radius: 2.6, color: 0x66ffee, duration: 0.45 });
        this.ctx.fx.burst({
          x: player.pos.x, y: 1, z: player.pos.z,
          count: 22, color: [0x66ffee, 0xffffff],
          speed: [3, 9], up: 0.6, size: [0.4, 0.8], life: [0.25, 0.5], gravity: -2, drag: 3.5,
        });
        this.ctx.floaters.spawn(player.pos.x, 1.8, player.pos.z, "PERFECT", "tempo");
        this.ctx.floaters.spawn(player.pos.x, 2.35, player.pos.z, "COUNTER READY", "label");
      }
      return "dodged";
    }

    dmg = Math.max(1, Math.round(dmg * this.ctx.relics.damageTakenMult() * player.hero.dmgTakenMult * this.ctx.difficulty.enemyDmgMult));

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
          if (this.ctx.arena.blocksSegment(player.pos.x, player.pos.z, e.pos.x, e.pos.z)) continue;
          this.dealDamage(e, novaDmg, { kbX: dx, kbZ: dz, kb: 7, heavy: true, attackFamily: "card", impactColor: 0xffe066 });
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
      const absorbed = Math.min(player.shield, dmg);
      this.ctx.caster.absorbAegisBarrier(absorbed);
      player.shield -= absorbed;
      dmg -= absorbed;
      this.ctx.fx.burst({
        x: player.pos.x, y: 1.1, z: player.pos.z,
        count: 14, color: 0x66bbff, speed: [2, 6], up: 0.5, size: [0.35, 0.7], life: [0.2, 0.45], gravity: -3, drag: 3,
      });
      this.ctx.sfx.shieldHit();
      if (player.shield <= 0) {
        player.shield = 0;
        events.emit("SHIELD_BROKEN", {});
      }
      this.playerHitFx(absorbed, srcX, srcZ, opts, true);
      if (dmg <= 0) {
        controller.grantIframes(0.22);
        return "shielded";
      }
    }

    // The ember you spared refuses to let you go out — once, restored to half.
    if (player.hp - dmg <= 0 && this.emberRevive) {
      this.emberRevive = false;
      player.hp = Math.max(1, Math.round(player.maxHp * 0.5));
      controller.grantIframes(1);
      stats.damageTaken += dmg;
      this.ctx.fx.ring(player.pos.x, player.pos.z, { radius: 6, color: 0xffd8a0, duration: 0.8 });
      this.ctx.fx.burst({
        x: player.pos.x, y: 1, z: player.pos.z,
        count: 40, color: [0xffd8a0, 0xffffff],
        speed: [3, 10], up: 0.9, size: [0.4, 0.9], life: [0.4, 0.9], gravity: -1, drag: 2.5,
      });
      this.ctx.floaters.spawn(player.pos.x, 2.2, player.pos.z, "THE EMBER HOLDS YOU", "heal");
      this.ctx.stage.punch(0.6);
      this.ctx.sfx.coldCrash();
      events.emit("PLAYER_HIT", { dmg, srcX, srcZ });
      this.playerHitFx(dmg, srcX, srcZ, opts);
      return "hit";
    }

    // Second Wind: a lethal hit is survived, restoring to 40% HP, once per run
    if (player.hp - dmg <= 0 && this.ctx.relics.consumeSecondWind()) {
      player.hp = Math.max(1, Math.round(player.maxHp * 0.4));
      controller.grantIframes(1);
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
      this.playerHitFx(dmg, srcX, srcZ, opts);
      return "hit";
    }

    player.hp = Math.max(0, player.hp - dmg);
    controller.grantIframes(0.28);
    stats.damageTaken += dmg;
    player.flashHit();
    tempo.drain(10);
    events.emit("PLAYER_HIT", { dmg, srcX, srcZ });
    this.playerHitFx(dmg, srcX, srcZ, opts);
    this.ctx.relics.onDamageTaken(srcX, srcZ);

    const dx = player.pos.x - srcX;
    const dz = player.pos.z - srcZ;
    const len = Math.hypot(dx, dz) || 1;
    this.ctx.cam.kick(dx / len, dz / len, 6);
    this.ctx.cam.addTrauma(0.45);
    this.ctx.cam.kickRoll((dx / len) * 0.04); // slight dutch-roll on the hit (IDEAS-GRAPHICS #50)
    this.ctx.stage.punch(0.55);
    this.ctx.player.hitReaction(dx / len, dz / len); // directional body flinch (IDEAS-GRAPHICS #38)
    this.ctx.controller.push((dx / len) * 4, (dz / len) * 4);
    // A lethal hit owns the whole death composition; a giant damage number only
    // obscures it and can force the first player-damage text layout on that frame.
    if (player.hp > 0) this.ctx.floaters.spawn(player.pos.x, 1.9, player.pos.z, `-${Math.round(dmg)}`, "playerdmg");

    if (player.hp <= 0) {
      player.alive = false;
      events.emit("PLAYER_DIED", {});
      this.ctx.fx.burst({
        x: player.pos.x, y: 1, z: player.pos.z,
        count: 50, color: [0xffffff, 0x66ddff],
        speed: [3, 12], up: 0.8, size: [0.5, 1.1], life: [0.5, 1.2], gravity: -6, drag: 2,
      });
      player.root.visible = true;
    }
    return "hit";
  }

  // ----------------------------------------------------------- deal damage
  private enemyHitFx(e: Enemy, opts: DamageOpts, color: number, critical: boolean, killed: boolean, shielded: boolean): void {
    const p = this.ctx.player;
    const dx = e.pos.x - p.pos.x;
    const dz = e.pos.z - p.pos.z;
    const dl = Math.hypot(dx, dz) || 1;
    const ix = e.pos.x - (dx / dl) * e.radius * 0.45;
    const iz = e.pos.z - (dz / dl) * e.radius * 0.45;
    this.ctx.events.emit("IMPACT_CUE", {
      sourceId: `hero:${p.hero.id}`,
      sourceKind: "hero",
      targetId: `enemy:${e.id}`,
      targetKind: e.kind,
      attackFamily: opts.attackFamily ?? (this.stageIdx >= 0 ? this.currentFamily : "card"),
      x: ix, y: e.kind === "boss" ? 1.25 : 0.95, z: iz,
      dirX: dx / dl, dirZ: dz / dl,
      damage: e.lastBodyDamage,
      color: shielded ? 0xffd27a : opts.impactColor ?? color,
      strength: killed ? "execute" : critical || shielded ? "critical" : opts.heavy ? "heavy" : "light",
      element: shielded ? "steel" : opts.element ?? "steel",
      shielded,
      killed,
      sustained: opts.sustained,
    });
    // The floor keeps a record of the fight (IDEAS-GRAPHICS #29): kills crack it, heavy blows scorch it.
    if (!shielded && killed) this.ctx.decals.crack(e.pos.x, e.pos.z, e.radius * 1.3);
    else if (!shielded && opts.heavy) this.ctx.decals.scorch(e.pos.x, e.pos.z, e.radius);
  }

  /** Every player-sourced hit on an enemy flows through here. */
  dealDamage(e: Enemy, baseDmg: number, opts: DamageOpts = {}): void {
    if (!e.alive || e.hp <= 0) return;
    const { tempo, stats, events } = this.ctx;
    const zone = tempo.zone;
    const wasFrozen = e.frozen > 0;
    const family = opts.attackFamily;
    const sword = family === "blade-opener" || family === "blade-return" || family === "blade-finisher" || family === "charged-heavy";
    const specialty = this.ctx.deck.specialty?.id;
    const unravel = family === "charged-heavy" && e.unravel.exposed > 0;
    const buildMult = specialty === "steel" && (family === "blade-finisher" || family === "charged-heavy") ? 1.25
      : specialty === "rime" && sword && wasFrozen ? 1.35 : 1;
    const dmg = Math.max(1, Math.round(
      baseDmg * (unravel ? (this.ctx.relics.has("widows-needle") ? 2 : 1.5) : 1) * buildMult * zone.damageMult * tempo.crescendoMult * this.runRankMult * e.vulnerableMult * this.ctx.relics.damageDealtMult(e)
    ));
    let killed = e.takeDamage(dmg, opts);
    let bodyDmg = e.lastBodyDamage;
    // Wards and armor can refuse a hit. Never award damage, hit effects, or
    // execution for damage that did not reach the body.
    if (bodyDmg <= 0 && !e.lastHitShielded) return;
    if (bodyDmg > 0 && unravel) {
      e.unravel.consume();
      tempo.gain(10);
      if (this.ctx.relics.has("keepers-thread")) this.ctx.deck.reduceCooldowns(0.75);
      this.ctx.floaters.spawn(e.pos.x, 2.5, e.pos.z, "UNRAVEL", "tempo");
      this.ctx.fx.ring(e.pos.x, e.pos.z, { radius: e.radius + 0.8, color: 0xffe0a3, duration: 0.28 });
      this.ctx.sfx.shieldHit();
    } else if (bodyDmg > 0 && e.alive && !opts.sustained && !opts.noDetonate && (sword || family === "card")) {
      if (e.unravel.hit(sword ? "blade" : "ability", this.ctx.relics.has("widows-needle") ? 1.5 : this.ctx.relics.has("keepers-thread") ? 5 : 3)) {
        this.ctx.floaters.spawn(e.pos.x, 2.4, e.pos.z, "SEAM EXPOSED", "tempo");
      }
    }
    // Shatterglass: a blow on a frozen foe shatters the ice for a frost burst.
    if (bodyDmg > 0 && !opts.noDetonate && wasFrozen && this.ctx.relics.has("shatterglass")) {
      this.shatter(e);
      killed = !e.alive;
    }
    // Execution: a heavy blow finishes a badly-wounded foe outright — tempo + a sliver of heal.
    if (bodyDmg > 0 && !killed && opts.heavy && e.kind !== "boss" && e.alive && e.hp <= e.maxHp * 0.12) {
      const remainingHp = e.hp;
      e.takeDamage(99999);
      killed = !e.alive;
      if (killed) bodyDmg += remainingHp;
      tempo.gain(6);
      const p = this.ctx.player;
      if (p.alive && p.hp < p.maxHp) { p.hp = Math.min(p.maxHp, p.hp + 2); events.emit("HEAL", { amount: 2 }); }
      this.ctx.floaters.spawn(e.pos.x, 2.3, e.pos.z, "EXECUTE", "tempo");
      this.ctx.player.playExecution();
      this.ctx.fx.ring(e.pos.x, e.pos.z, { radius: 2.4, color: 0xffffff, duration: 0.3 });
      this.ctx.cam.addTrauma(0.16);
    }
    // A shielded hit drains the guard (the enemy spawns its own chip floater + sparks);
    // only what reached the BODY counts toward the stat and the generic FX.
    stats.damageDealt += bodyDmg;

    if (!e.lastHitShielded) {
      const critical = zone.zone === "critical";
      this.ctx.floaters.spawn(
        e.pos.x, 1.6, e.pos.z,
        String(Math.round(bodyDmg)),
        opts.heavy || critical ? "crit" : "dmg"
      );
    }
    this.enemyHitFx(e, opts, zone.color, zone.zone === "critical", killed, e.lastHitShielded);
    events.emit("ENEMY_HIT", { x: e.pos.x, y: 1, z: e.pos.z, dmg: bodyDmg, heavy: !!opts.heavy, killed, sword });
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
        if (this.ctx.arena.blocksSegment(src.pos.x, src.pos.z, e.pos.x, e.pos.z)) continue;
        this.dealDamage(e, 14, { kbX: dx, kbZ: dz, kb: 5, heavy: true, noDetonate: true, attackFamily: "card", element: "frost", impactColor: 0xbfeaff });
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
  meleeSweep(arcCenter: number, arcWidth: number, range: number, dmg: number, kb: number, heavy: boolean, attackFamily: AttackFamily = "card"): number {
    const p = this.ctx.player;
    let hits = 0;
    for (const e of this.ctx.enemies.living()) {
      if (!e.alive || e.hp <= 0) continue;
      const dx = e.pos.x - p.pos.x;
      const dz = e.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > range + e.radius) continue;
      const ang = Math.atan2(dx, dz);
      if (Math.abs(angleDelta(arcCenter, ang)) > arcWidth / 2 + Math.atan2(e.radius, Math.max(0.5, d))) continue;
      if (this.ctx.arena.blocksSegment(p.pos.x, p.pos.z, e.pos.x, e.pos.z)) continue;
      this.dealDamage(e, dmg, { kbX: dx, kbZ: dz, kb, heavy, attackFamily });
      if (e.lastBodyDamage > 0 || e.lastHitShielded) hits++;
    }
    return hits;
  }

  /** Public slash-arc FX for cards that swing outside the basic chain. */
  slashVisual(arc: number, range: number, heavy: boolean): void {
    this.spawnSlashArc({ dur: 0, dmg: 0, arc, range, kb: 0, heavy, family: "card", strikePoint: 0 });
  }

  /** Instantly hide all slash arcs. The fade only ticks while playing, so the boot
   *  warm-up must clear its warm arc or it freezes over the menu hero. */
  clearSlashVisuals(): void {
    for (const s of this.slashes) {
      s.active = false;
      s.mesh.visible = false;
    }
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
    if (!tempo.crashReady || !player.alive) return;
    // Crash mastery: cashing out near the very top (≥95) is a "perfect crash" —
    // a wider, harder nova that refunds a little heat back.
    const perfect = tempo.value >= PERFECT_CRASH_THRESHOLD;
    const R = crashRadius(tempo.value);
    const mult = tempo.zone.damageMult * (perfect ? 1.2 : 1);
    const specialty = this.ctx.deck.specialty;
    const color = specialty ? Number.parseInt(specialty.color.slice(1), 16) : 0xff7966;
    tempo.crash(this.ctx.relics.crashResetValue() ?? undefined);
    this.crashIframes = 0.45;
    this.ctx.stats.crashes++;
    const caught: Enemy[] = [];
    this.ctx.events.emit("CRASH", { x: player.pos.x, z: player.pos.z });
    for (const e of this.ctx.enemies.living()) {
      const dx = e.pos.x - player.pos.x;
      const dz = e.pos.z - player.pos.z;
      if (Math.hypot(dx, dz) < R + e.radius) {
        if (!e.alive || (e.warded && !e.guardBreakable)) continue;
        if (this.ctx.arena.blocksSegment(player.pos.x,player.pos.z,e.pos.x,e.pos.z)) continue;
        this.dealDamage(e, 42 * mult, { kbX: dx, kbZ: dz, kb: specialty?.id === "veil" ? 0 : specialty?.id === "ember" ? 1.5 : 8, heavy: true, attackFamily: "crash", element: specialty ? schoolElement(specialty.id) : "steel", impactColor: color });
        if (e.lastBodyDamage > 0) caught.push(e);
      }
    }
    if (specialty) this.ctx.caster.specialtyCrash(specialty.id, perfect, player.pos.x, player.pos.z, R, caught);
    player.castGesture = { kind: specialty?.id === "guard" ? "guard" : "invoke", time: 0, duration: 0.32 };
    if (perfect) {
      tempo.gain(15);
    }
    this.ctx.floaters.spawn(player.pos.x, 2.1, player.pos.z, `${perfect ? "PERFECT · " : ""}${specialty?.crashName.toUpperCase() ?? "CRASH"}`, "tempo");
    this.ctx.fx.ring(player.pos.x, player.pos.z, { radius: R, color, duration: 0.4 });
    this.ctx.fx.burst({
      x: player.pos.x, y: 1, z: player.pos.z,
      count: 22, color: [color, 0xeee5cf],
      speed: [5, 13], up: 0.4, size: [0.08, 0.26], life: [0.2, 0.55], gravity: -5, drag: 2.5,
      shape: ParticleShape.shard, // crash throws debris shards (IDEAS-GRAPHICS #32)
    });
    this.ctx.decals.scorch(player.pos.x, player.pos.z, R * 0.7); // the nova scorches the floor (#29)
    this.ctx.cam.addTrauma(0.32);
    this.ctx.cam.pulseFov(0.65);
    this.ctx.cam.kickRoll(perfect ? 0.025 : 0.015);
    this.ctx.stage.punch(0.22);
    this.ctx.sfx.crash();
    this.ctx.relics.onCrash();
  }

  /** Released charged heavy: a wide guard-breaking sweep that leaves foes Vulnerable. */
  private chargedHeavy(counter: boolean): number {
    const p = this.ctx.player;
    const hero = p.hero;
    const range = 4.2;
    const hits = this.meleeSweep(p.facing, Math.PI * 2, range, 40 * hero.meleeDmgMult * (counter ? 1.75 : 1), 14 * hero.kbMult, true, "charged-heavy");
    for (const e of this.ctx.enemies.living()) {
      if (Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z) < range + e.radius && !this.ctx.arena.blocksSegment(p.pos.x, p.pos.z, e.pos.x, e.pos.z)) e.applyVulnerable(3, 1.25);
    }
    this.slashVisual(Math.PI * 2, range, true);
    if (hits > 0) this.ctx.tempo.gain(10);
    this.ctx.cam.addTrauma(0.42);
    this.ctx.cam.kick(Math.sin(p.facing), Math.cos(p.facing), 5);
    this.ctx.stage.punch(0.5);
    this.ctx.cam.pulseFov(0.6);
    this.ctx.fx.ring(p.pos.x, p.pos.z, { radius: range, color: 0xffcc66, duration: 0.45 });
    this.ctx.fx.burst({
      x: p.pos.x, y: 1, z: p.pos.z,
      count: 40, color: [0xffcc66, 0xffffff], speed: [5, 15], up: 0.7, size: [0.4, 1.1], life: [0.3, 0.7], gravity: -4, drag: 2.5,
    });
    this.ctx.sfx.swing(2);
    if (hits > 0) this.ctx.floaters.spawn(p.pos.x, 2.1, p.pos.z, "HEAVY", "crit");
    return hits;
  }

  private coldCrash(): void {
    const { tempo, player } = this.ctx;
    tempo.crash(25);
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
    this.counterWindow = Math.max(0, this.counterWindow - dt);
    if (!player.alive) {
      player.animSwing = null;
      return;
    }

    // Counter armed: a cyan shimmer on the hero sells the live window.
    if (this.counterWindow > 0 && Math.random() < dt * 14) {
      this.ctx.fx.burst({
        x: player.pos.x, y: 1.1, z: player.pos.z, count: 1, color: 0x66ffee,
        speed: [0.5, 1.8], up: 1.3, size: [0.25, 0.5], life: [0.2, 0.4], gravity: 0, drag: 2, jitter: 0.5,
      });
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
    this.queuedAttack = Math.max(0, this.queuedAttack - dt);
    if (input.actionPressed("attack")) {
      if (this.ctx.controller.dodging) this.queuedAttack = 0.3;
      else if (this.stageIdx >= 0) this.buffered = true;
      else this.queuedAttack = 0.12;
    }
    if (this.queuedAttack > 0 && !this.ctx.controller.dodging) {
      if (this.stageIdx < 0) {
        const next = this.ctx.controller.followUpWindow > 0 ? 0 : this.chainReset > 0 ? (this.lastFinished + 1) % CHAIN.length : 0;
        this.startSwing(next);
        this.queuedAttack = 0;
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
      // Tapping dodge while charged is a clean bail — cancel the wind-up instead of
      // firing a guard-break sweep mid-roll.
      if (this.charged && this.stageIdx < 0 && !this.ctx.controller.dodging) this.startSwing(3);
      this.charging = false;
      this.chargeT = 0;
    }
    player.animCharge = this.charging ? this.chargeProgress : 0;

    if (this.stageIdx >= 0) {
      const stage = this.swingStage;
      this.swingT += dt;
      const phase = Math.min(1, this.swingT / stage.dur);
      player.animSwing = { phase, heavy: stage.heavy, stage: this.stageIdx };

      if (!this.struck && phase >= stage.strikePoint) {
        this.struck = true;
        const hero = player.hero;
        const counter = this.counterWindow > 0;
        const hits = this.stageIdx === 3 ? this.chargedHeavy(counter) : this.meleeSweep(
          player.facing, stage.arc, stage.range + (this.dashAttack ? 0.8 : 0),
          stage.dmg * hero.meleeDmgMult * (counter ? 1.75 : 1) * (this.dashAttack ? 1.5 : 1), stage.kb * hero.kbMult, stage.heavy, this.currentFamily
        );
        // Counter payoff: the armed strike lands hard — extra tempo + a clear read.
        if (counter && hits > 0) {
          this.counterWindow = 0;
          this.ctx.tempo.gain(12);
          this.ctx.floaters.spawn(player.pos.x, 2.1, player.pos.z, "COUNTER!", "crit");
          this.ctx.fx.ring(player.pos.x, player.pos.z, { radius: 3, color: 0x66ffee, duration: 0.4 });
          this.ctx.cam.addTrauma(0.2);
          this.ctx.sfx.critical();
        }
        this.comboTempoPayout(hits);
        if (this.stageIdx !== 3) {
          this.spawnSlashArc(this.dashAttack ? { ...stage, range: stage.range + 0.8 } : stage);
          this.ctx.sfx.swing(this.stageIdx);
        }
        if (hits > 0) {
          if (stage.heavy) {
            this.ctx.tempo.gain(8);
            this.ctx.deck.reduceCooldowns(0.65);
            this.ctx.cam.kick(Math.sin(player.facing), Math.cos(player.facing), 1.8);
          }
          if (this.dashAttack) this.ctx.fx.ring(player.pos.x, player.pos.z, { radius: 2, color: player.bladeColor, duration: 0.25 });
        }
      }

      if (phase >= 1) {
        const wasIdx = this.stageIdx;
        this.stageIdx = -1;
        this.lastFinished = wasIdx === 3 ? 2 : wasIdx;
        player.animSwing = null;
        this.chainReset = 0.9;
        if (this.buffered) {
          this.buffered = false;
          this.startSwing(wasIdx >= 2 ? 0 : wasIdx + 1);
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
      // Follow-through: hold bright through the first half, then expand + drop —
      // the arc reads as a swing's wake, not a decal blinking off.
      s.mat.opacity = 0.48 * (1 - k) * (1 - k);
      s.mesh.scale.setScalar(1 + k * 0.12);
    }
  }

  private startSwing(idx: number): void {
    this.stageIdx = idx;
    this.swingT = 0;
    this.struck = false;
    this.dashAttack = idx === 0 && this.ctx.controller.followUpWindow > 0;
    if (this.dashAttack) this.ctx.controller.followUpWindow = 0;
    this.currentFamily = idx === 3 ? "charged-heavy" : this.dashAttack ? "dash-strike" : CHAIN[idx].family;
    // Small forward step into the swing — keeps melee aggressive
    const p = this.ctx.player;
    const step = this.dashAttack ? 7 : idx === 0 ? 2.35 : idx === 1 ? 1.7 : 1.15;
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
      geo = new THREE.RingGeometry(stage.range * 0.93, stage.range * 0.98, 64, 1, 0, width);
      const colors: number[] = [];
      const positions = geo.getAttribute("position");
      for (let i = 0; i < positions.count; i++) {
        const angle = (i % 65) / 64;
        const fade = Math.pow(Math.sin(angle * Math.PI), 0.65);
        colors.push(fade, fade, fade);
      }
      geo.setAttribute("color", new THREE.Float32BufferAttribute(colors,3));
      geo.rotateX(-Math.PI / 2);
      this.slashGeoCache.set(key, geo);
    }
    s.mesh.geometry = geo; // shared/cached — never disposed per-swing
    s.mesh.position.set(p.pos.x, 1.0, p.pos.z);
    // Flattened sector spans planar angles [0, width] from local +X; center it on facing.
    s.mesh.rotation.set(-0.12, p.facing - Math.PI / 2 - width / 2, 0);
    s.mat.opacity = 0.48;
    s.mat.color.set(stage.heavy ? 0xffcc66 : this.ctx.player.bladeColor);
    s.mesh.scale.setScalar(1);
  }
}
