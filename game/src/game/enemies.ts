import * as THREE from "three";
import { ARENA_RADIUS } from "../render/arena";
import { dampAngle, TAU } from "../core/math";
import type { Ctx } from "./ctx";

export type EnemyKind =
  | "husk" | "spitter" | "swarmer" | "bomber" | "sentinel"
  | "wisp" | "leaper" | "tether" | "mirror" | "caster"
  | "shade" | "bastion"
  | "brute" | "harrier" | "splitter"
  | "voidling" | "warper"
  | "boss";

let NEXT_ID = 1;

/** 0xRRGGBB → "#rrggbb" for DOM floater tints. */
function hex(c: number): string {
  return "#" + c.toString(16).padStart(6, "0");
}

interface FlashMat {
  mat: THREE.MeshStandardMaterial;
  baseEmissive: THREE.Color;
  baseIntensity: number;
}

type RoleSilhouette = "charger" | "caster" | "swarm" | "bomber" | "shield" | "flier" | "void" | "splitter";

interface RoleSilhouetteRecord {
  kind: RoleSilhouette;
  group: THREE.Group;
}

export interface DamageOpts {
  kbX?: number;
  kbZ?: number;
  kb?: number;
  heavy?: boolean;
  allowShieldStagger?: boolean;
  /** Guards detonator relics (Shatterglass) from recursing on their own AoE. */
  noDetonate?: boolean;
}

// Shared assets for the ground-contact glow under every enemy (one soft radial
// sprite + one flat plane, reused across all enemies — only the material is
// per-enemy so each can tint to its own accent).
let GLOW_TEX: THREE.CanvasTexture | null = null;
let GLOW_GEO: THREE.PlaneGeometry | null = null;
function groundGlowAssets(): { tex: THREE.CanvasTexture; geo: THREE.PlaneGeometry } {
  if (!GLOW_TEX) {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 64;
    const g = cv.getContext("2d")!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.4, "rgba(255,255,255,0.45)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    GLOW_TEX = new THREE.CanvasTexture(cv);
  }
  if (!GLOW_GEO) {
    GLOW_GEO = new THREE.PlaneGeometry(1, 1);
    GLOW_GEO.rotateX(-Math.PI / 2);
  }
  return { tex: GLOW_TEX, geo: GLOW_GEO };
}

/**
 * Base enemy: HP, knockback physics, hit-flash, freeze, billboard HP bar and
 * a per-type `tick` brain. All attacks must telegraph — that's the contract.
 */
export abstract class Enemy {
  readonly id = NEXT_ID++;
  abstract readonly kind: EnemyKind;
  readonly pos = new THREE.Vector3();
  radius = 0.5;
  hp = 30;
  maxHp = 30;
  speed = 3;
  alive = true;
  frozen = 0;
  /** Vulnerable status: takes extra damage while >0 (status-combo enabler). */
  vulnTime = 0;
  private vulnMult = 1;
  /** Elite affix ids (hasted/volatile/regenerator/frenzied/siphon) — may carry several. */
  affixes: string[] = [];
  protected affixSpeedMult = 1;
  private affixTimer = 0;
  contactDmg = 0;
  protected contactCd = 0;

  // --- Breakable shields (Bastion front-wall, Mirror bubble). Shield HP lives in
  // the SAME final-damage units as body HP, so every player multiplier already
  // applied in dealDamage accelerates the break for free.
  protected shieldHp = 0;
  protected shieldMaxHp = 0;
  protected shieldBarColor = 0xffffff;
  /** Brief post-break exposure that interrupts any in-progress attack (not freeze — no blue tint). */
  protected stagger = 0;
  private spawnGrace = 0;
  private spawnGraceUntil = 0;
  /** Read by combat.dealDamage for honest floaters/stats: how much of the last hit reached the body, and whether a shield ate it. */
  lastBodyDamage = 0;
  lastHitShielded = false;
  private shieldBg: THREE.Sprite | null = null;
  private shieldFill: THREE.Sprite | null = null;
  private affixCrown: THREE.Group | null = null;
  private roleSilhouettes: RoleSilhouetteRecord[] = [];
  private intentPose = 0;
  // Dramatic boss flourish — additive pose the base folds into the root transform.
  // All default-neutral so non-bosses are unaffected. Bosses drive these via
  // drivePose()/setBossScale()/eruptReveal() to give attacks, movement, and phase
  // shifts weight: poseRear leans back (coil/roar), poseLunge leans forward
  // (commit), poseRise lifts (rear up / leap), poseSwell pulses the body bigger.
  protected poseRear = 0;
  protected poseLunge = 0;
  protected poseRise = 0;
  protected poseSwell = 0;
  protected bossScale = 1;          // target base scale (phase growth)
  private bossScaleCur = 1;         // smoothly eased toward bossScale
  private eruptList: { o: THREE.Object3D; s: THREE.Vector3 }[] = [];
  private eruptT = 0;
  private eruptDur = 0;
  private reactT = 0;
  private reactDur = 0.16;
  private reactPitch = 0;
  private reactRoll = 0;
  private reactYaw = 0;
  private reactLift = 0;
  private readonly flashWhite = new THREE.Color(0xffffff);
  private readonly vulnColor = new THREE.Color(0xffd86b);
  private readonly emissiveScratch = new THREE.Color();

  readonly root = new THREE.Group();
  protected heading = 0;
  protected kb = new THREE.Vector2();
  protected hitFlash = 0;
  protected flashMats: FlashMat[] = [];
  protected t = Math.random() * 10;
  /** While >0 the enemy deflects ALL damage — a telegraphed boss ward window. */
  protected invulnTime = 0;
  private deflectCd = 0;
  private wardRing: THREE.Mesh | null = null;
  private groundGlow: THREE.Mesh | null = null;
  private groundGlowInit = false;
  private bossFxAcc = 0;
  /** Ward-aura colour; bosses override to match their palette. */
  protected wardColor = 0x88ccff;

  private hpBg: THREE.Sprite;
  private hpFill: THREE.Sprite;

  constructor(protected ctx: Ctx, x: number, z: number) {
    this.pos.set(x, 0, z);
    this.root.position.copy(this.pos);
    ctx.stage.scene.add(this.root);

    const barMatBg = new THREE.SpriteMaterial({ color: 0x000000, opacity: 0.55, transparent: true, depthWrite: false });
    const barMatFill = new THREE.SpriteMaterial({ color: 0xff5544, opacity: 0.95, transparent: true, depthWrite: false });
    this.hpBg = new THREE.Sprite(barMatBg);
    this.hpFill = new THREE.Sprite(barMatFill);
    this.hpBg.scale.set(1.1, 0.09, 1);
    this.hpFill.scale.set(1.06, 0.055, 1);
    this.hpFill.center.set(0, 0.5);
    this.hpBg.visible = this.hpFill.visible = false;
    this.root.add(this.hpBg, this.hpFill);
  }

  /** Lazily build the shield bar (only shielded enemies ever need it). */
  private ensureShieldBar(): void {
    if (this.shieldBg) return;
    // A deliberately slim, bright indicator — distinct from the HP bar so it never
    // reads as a redundant "empty health bar". Only a faint track sits behind it.
    const bg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x05070d, opacity: 0.3, transparent: true, depthWrite: false }));
    const fill = new THREE.Sprite(new THREE.SpriteMaterial({ color: this.shieldBarColor, opacity: 1.0, transparent: true, depthWrite: false }));
    bg.scale.set(0.84, 0.04, 1);
    fill.scale.set(0.8, 0.052, 1);
    fill.center.set(0, 0.5);
    bg.visible = fill.visible = false;
    this.root.add(bg, fill);
    this.shieldBg = bg;
    this.shieldFill = fill;
  }

  /** Lazily add a soft ground-contact glow, auto-tinted from the enemy's own
   *  brightest emissive accent — grounds the body and lifts it off the dark floor.
   *  Built on first update, once the subclass has registered all its materials. */
  private ensureGroundGlow(): void {
    if (this.groundGlowInit) return;
    this.groundGlowInit = true;
    let best = 0.25;
    const color = new THREE.Color(0x000000);
    for (const f of this.flashMats) {
      const c = f.baseEmissive;
      const lum = (c.r + c.g + c.b) * Math.min(1.5, Math.max(0.3, f.baseIntensity));
      if (lum > best) { best = lum; color.copy(c); }
    }
    if (color.r + color.g + color.b <= 0.02) return; // no emissive accent → no glow
    const { tex, geo } = groundGlowAssets();
    const mat = new THREE.MeshBasicMaterial({
      map: tex, color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const m = new THREE.Mesh(geo, mat);
    // Bosses get a wider, more menacing pool than rank-and-file enemies.
    const s = this.kind === "boss" ? Math.max(6, this.radius * 4.6) : Math.max(1.5, this.radius * 3.4);
    m.scale.set(s, s, s);
    m.renderOrder = -1;
    this.ctx.stage.scene.add(m);
    this.groundGlow = m;
  }

  /** Force first-time visual sub-objects (the ground glow) into the scene so their
   *  shader programs compile during warm-up, not as a mid-fight hitch on first spawn. */
  warmVisuals(): void { this.ensureGroundGlow(); }

  protected registerFlash(mat: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
    this.flashMats.push({ mat, baseEmissive: mat.emissive.clone(), baseIntensity: mat.emissiveIntensity });
    return mat;
  }

  protected stdMat(color: number, emissive = 0x000000, intensity = 0): THREE.MeshStandardMaterial {
    return this.registerFlash(
      new THREE.MeshStandardMaterial({
        color, emissive, emissiveIntensity: intensity, roughness: 0.6, metalness: 0.2, flatShading: true,
      })
    );
  }

  protected addMesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = this.root): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  protected addRoleSilhouette(kind: RoleSilhouette, color: number): void {
    const g = new THREE.Group();
    g.name = `role-${kind}`;
    this.root.add(g);
    this.roleSilhouettes.push({ kind, group: g });
    const mat = this.stdMat(0x0b0d14, color, 0.75);
    const bright = this.stdMat(0x11131f, color, 1.35);
    const accent = this.stdMat(0x06080f, color, 1.8);

    const core = this.addMesh(new THREE.OctahedronGeometry(Math.max(0.055, this.radius * 0.12)), accent, 0, 0.92, this.radius + 0.12, g);
    core.scale.y = 0.48;
    core.rotation.y = Math.PI / 4;
    const brow = this.addMesh(new THREE.BoxGeometry(Math.max(0.22, this.radius * 0.65), 0.055, 0.09), bright, 0, 1.18, this.radius + 0.13, g);
    brow.rotation.x = -0.08;
    for (const sx of [-1, 1]) {
      const rib = this.addMesh(new THREE.BoxGeometry(0.055, 0.34, 0.08), mat, sx * (this.radius + 0.08), 0.78, 0.18, g);
      rib.rotation.z = sx * -0.22;
      rib.rotation.y = sx * 0.35;
    }

    // Shared detail pass: a readable layered front, shoulder accents, and a
    // small base ring keep procedural enemies from reading as single primitives.
    const trim = this.stdMat(0x141722, color, 1.05);
    const dim = this.stdMat(0x05070d, color, 0.45);
    const faceplate = this.addMesh(new THREE.BoxGeometry(Math.max(0.22, this.radius * 0.7), 0.055, 0.08), trim, 0, 1.02, this.radius + 0.18, g);
    faceplate.rotation.x = -0.12;
    const chestPlate = this.addMesh(new THREE.BoxGeometry(Math.max(0.28, this.radius * 0.92), 0.07, 0.1), dim, 0, 0.58, this.radius + 0.08, g);
    chestPlate.rotation.x = 0.08;
    for (const sx of [-1, 1]) {
      const pauldron = this.addMesh(new THREE.BoxGeometry(0.16, 0.12, 0.28), trim, sx * (this.radius + 0.2), 1.02, 0.25, g);
      pauldron.rotation.z = sx * -0.22;
      pauldron.rotation.y = sx * 0.28;
      const boot = this.addMesh(new THREE.BoxGeometry(Math.max(0.1, this.radius * 0.28), 0.08, 0.2), dim, sx * this.radius * 0.42, 0.08, this.radius * 0.2, g);
      boot.rotation.y = sx * 0.12;
    }
    const base = this.addMesh(new THREE.TorusGeometry(Math.max(0.28, this.radius * 0.72), 0.018, 5, 24), trim, 0, 0.08, 0, g);
    base.rotation.x = Math.PI / 2;

    if (kind === "charger") {
      for (const sx of [-1, 1]) {
        const horn = this.addMesh(new THREE.ConeGeometry(0.08, 0.62, 4), bright, sx * (this.radius + 0.16), 1.18, 0.5, g);
        horn.rotation.set(Math.PI / 2, 0, sx * 0.22);
      }
      this.addMesh(new THREE.BoxGeometry(this.radius * 1.1, 0.08, 0.5), mat, 0, 0.18, 0.46, g);
    } else if (kind === "caster") {
      const halo = this.addMesh(new THREE.TorusGeometry(this.radius + 0.18, 0.025, 6, 28), bright, 0, 1.72, 0, g);
      halo.rotation.x = Math.PI / 2;
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU;
        const shard = this.addMesh(new THREE.OctahedronGeometry(0.065), bright, Math.cos(a) * (this.radius + 0.28), 1.72, Math.sin(a) * (this.radius + 0.28), g);
        shard.rotation.set(a, a * 1.4, 0);
      }
    } else if (kind === "swarm") {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU;
        const barb = this.addMesh(new THREE.ConeGeometry(0.035, 0.25, 4), bright, Math.cos(a) * 0.24, 0.62, Math.sin(a) * 0.24, g);
        barb.rotation.set(0.5, 0, -a);
      }
    } else if (kind === "bomber") {
      const ring = this.addMesh(new THREE.TorusGeometry(this.radius + 0.2, 0.035, 6, 24), bright, 0, 1.42, 0, g);
      ring.rotation.x = Math.PI / 2;
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + Math.PI / 4;
        this.addMesh(new THREE.BoxGeometry(0.08, 0.08, 0.28), bright, Math.cos(a) * (this.radius + 0.2), 1.42, Math.sin(a) * (this.radius + 0.2), g).rotation.y = a;
      }
    } else if (kind === "shield") {
      this.addMesh(new THREE.BoxGeometry(this.radius * 2.3, 0.12, 0.12), bright, 0, 1.92, 0.52, g);
      for (const sx of [-1, 1]) {
        const fin = this.addMesh(new THREE.BoxGeometry(0.1, 0.65, 0.32), mat, sx * (this.radius + 0.22), 1.12, 0.44, g);
        fin.rotation.z = sx * 0.22;
      }
    } else if (kind === "flier") {
      for (const sx of [-1, 1]) {
        const wing = this.addMesh(new THREE.BoxGeometry(0.68, 0.04, 0.22), bright, sx * (this.radius + 0.3), 0.1, -0.12, g);
        wing.rotation.z = sx * -0.32;
      }
      this.addMesh(new THREE.ConeGeometry(0.07, 0.45, 4), bright, 0, 0.1, -0.55, g).rotation.x = -Math.PI / 2;
    } else if (kind === "void") {
      for (let i = 0; i < 2; i++) {
        const ring = this.addMesh(new THREE.TorusGeometry(this.radius + 0.16 + i * 0.13, 0.022, 6, 36), bright, 0, 0.85, 0, g);
        ring.rotation.set(Math.PI / 2 + i * 0.7, i * 1.1, 0);
      }
    } else {
      const split = this.addMesh(new THREE.BoxGeometry(0.08, 0.9, this.radius * 1.15), bright, 0, 0.7, 0.08, g);
      split.rotation.z = 0.12;
      for (const sx of [-1, 1]) {
        this.addMesh(new THREE.TorusGeometry(0.26, 0.025, 5, 16), bright, sx * 0.33, 0.62, 0.28, g).rotation.x = Math.PI / 2;
      }
    }
  }

  /** Subclasses refresh this while winding up, bracing, fusing, or committing. */
  protected setIntentPose(amount: number): void {
    this.intentPose = Math.max(this.intentPose, amount);
  }

  /** Ease the dramatic boss pose toward target offsets — call once per tick. */
  protected drivePose(dt: number, t: { rear?: number; lunge?: number; rise?: number; swell?: number }, rate = 9): void {
    const k = Math.min(1, dt * rate);
    this.poseRear += ((t.rear ?? 0) - this.poseRear) * k;
    this.poseLunge += ((t.lunge ?? 0) - this.poseLunge) * k;
    this.poseRise += ((t.rise ?? 0) - this.poseRise) * k;
    this.poseSwell += ((t.swell ?? 0) - this.poseSwell) * k;
  }

  /** Map a boss attack-state name to a dramatic pose and ease toward it. Wind-ups
   *  (…Tell / guard / channel / track) coil back; commits (…ing / nova / slam /
   *  pound / crush / pulse / rain) lunge forward; phaseShift rears up + swells. */
  protected poseForState(dt: number, state: string, moving = false): void {
    let t: { rear?: number; lunge?: number; rise?: number; swell?: number };
    if (state === "phaseShift") t = { rear: 0.34, rise: 0.18, swell: 0.12 };
    else if (state === "leap") t = { lunge: 0.16, rise: 0.24 };
    else if (state === "fading") t = { rear: -0.14 };
    else if (/tell$|guard|channel|track|brace$/i.test(state)) t = { rear: 0.22, swell: 0.03 };
    else if (/ing$|nova|slam|pound|crush|pulse|tecton|rain|crossfire|beam$|seq$/i.test(state)) t = { lunge: 0.26 };
    else t = moving ? { lunge: 0.07 } : {};
    this.drivePose(dt, t);
  }

  /** Set the boss's base body-scale target (smoothly grown toward in update). */
  protected setBossScale(s: number): void { this.bossScale = s; }

  /** Reveal phase geometry with an erupting overshoot scale-pop (0 → ~1.2 → rest). */
  protected eruptReveal(meshes: THREE.Object3D[], dur = 0.75): void {
    for (const o of meshes) {
      o.visible = true;
      this.eruptList.push({ o, s: o.scale.clone() });
      o.scale.setScalar(0.0001);
    }
    this.eruptDur = dur;
    this.eruptT = dur;
  }

  private hitReaction(opts: DamageOpts = {}, shielded = false): void {
    if (this.kind === "boss" && !opts.heavy) return;
    const p = this.ctx.player;
    const dx = opts.kbX ?? (this.pos.x - p.pos.x);
    const dz = opts.kbZ ?? (this.pos.z - p.pos.z);
    const len = Math.hypot(dx, dz) || 1;
    const local = Math.atan2(dx / len, dz / len) - this.heading;
    const heavy = !!opts.heavy;
    const base = shielded ? 0.08 : heavy ? 0.17 : 0.1;
    const bossScale = this.kind === "boss" ? 0.45 : 1;
    this.reactDur = heavy ? 0.24 : 0.15;
    this.reactT = this.reactDur;
    this.reactPitch = -Math.cos(local) * base * bossScale;
    this.reactRoll = Math.sin(local) * base * 1.25 * bossScale;
    this.reactYaw = Math.sin(local) * base * 0.65 * bossScale;
    this.reactLift = (shielded ? 0.02 : heavy ? 0.08 : 0.045) * bossScale;
  }

  /** Public entry. Subclasses override to insert a shield check, then call super (full body) or hitShield. */
  takeDamage(amount: number, opts: DamageOpts = {}): boolean {
    this.lastHitShielded = false;
    return this.applyBodyDamage(amount, opts);
  }

  /** The actual HP/knockback/death logic. Never re-enters a subclass shield check. */
  protected applyBodyDamage(amount: number, opts: DamageOpts = {}): boolean {
    if (!this.alive) {
      this.lastBodyDamage = 0;
      return false;
    }
    // Warded: the boss is briefly invulnerable — deflect the hit entirely.
    if (this.invulnTime > 0) {
      this.lastBodyDamage = 0;
      this.deflect();
      return false;
    }
    // Ascension: non-boss foes shrug off flat armor (you always land ≥1) and can resist knockback.
    const diff = this.ctx.difficulty;
    if (this.kind !== "boss" && diff.enemyArmor > 0) amount = Math.max(1, amount - diff.enemyArmor);
    const kbResist = this.kind === "boss" ? 0 : diff.enemyKbResist;
    this.lastBodyDamage = Math.min(amount, Math.max(0, this.hp));
    this.hp -= amount;
    this.hitFlash = 1;
    this.hitReaction(opts);
    const kbStrength = (opts.kb ?? 0) * (opts.heavy ? 1.4 : 1) * (1 - kbResist);
    if (kbStrength > 0) {
      const len = Math.hypot(opts.kbX ?? 0, opts.kbZ ?? 0) || 1;
      this.kb.x += ((opts.kbX ?? 0) / len) * kbStrength;
      this.kb.y += ((opts.kbZ ?? 0) / len) * kbStrength;
    }
    if (this.hp <= 0) {
      this.die();
      return true;
    }
    return false;
  }

  /**
   * Route a hit into the shield: it drains the FULL hit off shieldHp and leaks
   * `chipFrac` to the body (min 1, no knockback) so the player always sees
   * progress. When shieldHp crosses 0 the shield shatters — overkill spills to
   * the body (keeping knockback), the shatter FX fire, and onShieldBreak() runs.
   * Returns true if the body died. Caller decides a hit is shielded.
   */
  protected hitShield(amount: number, opts: DamageOpts, chipFrac: number, color: number, breakWord: string): boolean {
    const before = this.shieldHp;
    this.shieldHp = Math.max(0, before - amount);
    this.lastHitShielded = true;
    this.hitFlash = 1;
    this.hitReaction(opts, true);
    if (this.shieldHp > 0) {
      // Chipped: show the guard-colored number that hit the shield, leak a little to the body.
      this.ctx.floaters.spawn(this.pos.x, 1.7, this.pos.z, String(Math.round(amount)), "dmg", hex(color));
      const leak = Math.max(1, Math.round(amount * chipFrac));
      return this.applyBodyDamage(leak, { heavy: opts.heavy });
    }
    // Broke this frame.
    this.shatterFx(color, breakWord);
    this.onShieldBreak(opts);
    const overkill = amount - before;
    if (overkill > 0) return this.applyBodyDamage(Math.round(overkill), opts); // breaking blow jolts
    return this.applyBodyDamage(Math.max(1, Math.round(amount * chipFrac)), { heavy: opts.heavy });
  }

  /** Hook for break behavior (stagger, attack interrupt, regen). FX are handled by shatterFx. */
  protected onShieldBreak(_opts?: DamageOpts): void {}

  private shatterFx(color: number, word: string): void {
    this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: 2.5, color, duration: 0.55 });
    this.ctx.fx.burst({
      x: this.pos.x, y: 1.1, z: this.pos.z,
      count: 26, color: [color, 0xffffff], speed: [3, 11], up: 0.7, size: [0.4, 1.0], life: [0.3, 0.7], gravity: -6, drag: 2.5,
    });
    this.ctx.cam.addTrauma(0.32);
    this.ctx.stage.punch(0.4);
    this.ctx.tempo.gain(8); // shattering a guard fuels your kit, like a heavy finisher
    this.ctx.sfx.shieldBreak();
    this.ctx.floaters.spawn(this.pos.x, 2.0, this.pos.z, word, "shieldbreak");
  }

  freeze(duration: number): void {
    this.frozen = Math.max(this.frozen, duration);
  }

  /** Mark this enemy Vulnerable — it takes `mult`× damage for `seconds`. */
  applyVulnerable(seconds: number, mult: number): void {
    this.vulnMult = Math.max(this.vulnTime > 0 ? this.vulnMult : 1, mult);
    this.vulnTime = Math.max(this.vulnTime, seconds);
  }
  get vulnerableMult(): number {
    return this.vulnTime > 0 ? this.vulnMult : 1;
  }
  get isVulnerable(): boolean {
    return this.vulnTime > 0;
  }

  // ---------------------------------------------------------------- ward / invuln (bosses)
  /** Enter a telegraphed invulnerable window — hits are deflected for `seconds`. */
  protected setInvuln(seconds: number): void {
    this.invulnTime = Math.max(this.invulnTime, seconds);
  }
  get warded(): boolean {
    return this.invulnTime > 0;
  }

  /** Hold an enemy's brain still after materialization without showing freeze/stagger FX. */
  setSpawnGrace(seconds: number): void {
    this.spawnGrace = Math.max(this.spawnGrace, seconds);
    this.spawnGraceUntil = Math.max(this.spawnGraceUntil, performance.now() + seconds * 1000);
  }

  /** Feedback when a hit lands on a warded boss: a clink spark + throttled "WARDED" tag. */
  private deflect(): void {
    this.hitFlash = Math.max(this.hitFlash, 0.5);
    this.hitReaction({ heavy: true }, true);
    if (this.deflectCd > 0) return;
    this.deflectCd = 0.4;
    const p = this.ctx.player;
    const a = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    const bx = this.pos.x + Math.sin(a) * (this.radius + 0.2);
    const bz = this.pos.z + Math.cos(a) * (this.radius + 0.2);
    this.ctx.fx.burst({ x: bx, y: 1.3, z: bz, count: 6, color: [this.wardColor, 0xffffff], speed: [1, 4.5], up: 0.5, size: [0.2, 0.5], life: [0.2, 0.4], gravity: 0, drag: 4 });
    this.ctx.floaters.spawn(this.pos.x, 2.5, this.pos.z, "WARDED", "shieldbreak", hex(this.wardColor));
  }

  /** A glowing ward bubble that follows the boss while it's invulnerable. */
  private updateWard(dt: number): void {
    if (this.invulnTime <= 0 && !this.wardRing) return;
    if (!this.wardRing) {
      const geo = new THREE.TorusGeometry(1, 0.06, 8, 32);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({ color: this.wardColor, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      this.wardRing = new THREE.Mesh(geo, mat);
      this.root.add(this.wardRing);
    }
    const mat = this.wardRing.material as THREE.MeshBasicMaterial;
    if (this.invulnTime > 0) {
      this.wardRing.visible = true;
      const s = this.radius * 1.9;
      this.wardRing.scale.set(s, s, s);
      this.wardRing.position.y = 1.4 + Math.sin(this.t * 5) * 0.15;
      this.wardRing.rotation.y += dt * 2;
      mat.color.setHex(this.wardColor);
      mat.opacity = 0.5 + Math.abs(Math.sin(this.t * 6)) * 0.4;
    } else {
      this.wardRing.visible = false;
    }
  }

  /**
   * A close-range punish shockwave centered on the boss — discourages hugging.
   * Bosses fire this (usually under a ward) when their guard telegraph completes.
   */
  protected wardShock(radius: number, dmg: number, color: number): void {
    this.ctx.fx.ring(this.pos.x, this.pos.z, { radius, color, duration: 0.5 });
    this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: radius * 0.5, color: 0xffffff, duration: 0.32 });
    this.ctx.fx.burst({ x: this.pos.x, y: 0.6, z: this.pos.z, count: 30, color: [color, 0xffffff], speed: [4, 13], up: 0.8, size: [0.4, 1.1], life: [0.3, 0.8], gravity: -4, drag: 2.2 });
    this.ctx.cam.addTrauma(0.4);
    this.ctx.stage.punch(0.3);
    const p = this.ctx.player;
    if (Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) < radius + p.radius) {
      this.ctx.combat.damagePlayer(dmg, this.pos.x, this.pos.z);
    }
  }

  private ensureAffixCrown(color: number): void {
    if (this.affixCrown) return;
    const g = new THREE.Group();
    g.name = "elite-affix-crown";
    this.root.add(g);
    this.affixCrown = g;
    const mat = this.stdMat(0x090912, color, 1.35);
    const r = Math.max(0.55, this.radius * 1.25);
    const ring = this.addMesh(new THREE.TorusGeometry(r, 0.035, 6, 36), mat, 0, this.barHeight() - 0.52, 0, g);
    ring.rotation.x = Math.PI / 2;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + Math.PI / 4;
      const gem = this.addMesh(new THREE.OctahedronGeometry(0.08), mat, Math.cos(a) * r, this.barHeight() - 0.52, Math.sin(a) * r, g);
      gem.rotation.set(a, a * 1.3, 0);
    }
  }

  /** Apply an elite affix (a foe may stack several): static mods + a persistent tint. */
  applyAffix(id: string, color: number): void {
    if (!this.affixes.includes(id)) this.affixes.push(id);
    this.ensureAffixCrown(color);
    // Persistent colored glow so the threat reads at a glance.
    for (const f of this.flashMats) {
      f.baseEmissive.lerp(new THREE.Color(color), 0.55);
      f.baseIntensity = Math.max(f.baseIntensity, 0.5);
    }
  }

  /** Per-frame affix behavior, evaluated across every affix the foe carries. */
  private updateAffix(dt: number): void {
    // Recompute the speed multiplier from all speed-affecting affixes each frame.
    let speed = 1;
    if (this.affixes.includes("hasted")) speed *= 1.45;
    if (this.affixes.includes("frenzied") && this.hp < this.maxHp * 0.4) speed *= 1.7;
    this.affixSpeedMult = speed;

    if (this.affixes.includes("regenerator") && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + 4 * dt);
    }
    if (this.affixes.includes("siphon")) {
      this.affixTimer -= dt;
      if (this.affixTimer <= 0) {
        this.affixTimer = 2;
        for (const o of this.ctx.enemies.living()) {
          if (o === this || o.kind === "boss" || !o.alive) continue;
          if (Math.hypot(o.pos.x - this.pos.x, o.pos.z - this.pos.z) < 5) {
            o.hp = Math.min(o.maxHp, o.hp + 5);
          }
        }
        this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: 5, color: 0xff6ba0, duration: 0.4 });
      }
    }
  }

  /** Volatile affix: a damaging burst when the elite dies. */
  private volatileBurst(): void {
    const R = 3.4;
    this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: R, color: 0xff7a3a, duration: 0.45 });
    this.ctx.fx.burst({
      x: this.pos.x, y: 1, z: this.pos.z,
      count: 30, color: [0xff7a3a, 0xffcc66, 0xffffff], speed: [4, 13], up: 0.7, size: [0.4, 1.0], life: [0.3, 0.7], gravity: -4, drag: 2.5,
    });
    this.ctx.cam.addTrauma(0.22);
    const p = this.ctx.player;
    if (p.alive && Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) < R + p.radius) {
      this.ctx.combat.damagePlayer(12, this.pos.x, this.pos.z);
    }
  }

  /** Damage-free knockback along (x, z) — pulls when pointed inward. Bosses shrug it off. */
  shove(x: number, z: number, strength: number): void {
    if (this.kind === "boss") return;
    const len = Math.hypot(x, z) || 1;
    this.kb.x += (x / len) * strength;
    this.kb.y += (z / len) * strength;
  }

  die(): void {
    if (!this.alive) return;
    this.alive = false;
    if (this.affixes.includes("volatile")) this.volatileBurst();
    this.onDeath();
    this.ctx.events.emit("KILL", { x: this.pos.x, z: this.pos.z, kind: this.kind });
    const c = this.deathColor();
    this.ctx.fx.burst({
      x: this.pos.x, y: 0.8, z: this.pos.z,
      count: 26, color: [c, 0xffffff, c],
      speed: [3, 11], up: 0.7, size: [0.4, 1.0], life: [0.3, 0.8], gravity: -8, drag: 2.5,
    });
    this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: this.radius * 3.2, color: c, duration: 0.4 });
    this.dispose();
  }

  protected onDeath(): void {}

  protected deathColor(): number {
    return 0xff6644;
  }

  dispose(): void {
    this.ctx.stage.scene.remove(this.root);
    if (this.groundGlow) {
      this.ctx.stage.scene.remove(this.groundGlow);
      (this.groundGlow.material as THREE.Material).dispose(); // shared geo/tex are kept
      this.groundGlow = null;
    }
    // Each enemy builds its own geometries/materials — release them or rooms leak GPU memory
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
        const m = o.material as THREE.Material | THREE.Material[];
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    });
  }

  /** Per-type brain. Only called when not frozen. */
  protected abstract tick(dt: number): void;

  update(dt: number): void {
    if (!this.alive) return;
    this.t += dt;
    this.reactT = Math.max(0, this.reactT - dt);
    this.contactCd -= dt;
    if (this.vulnTime > 0) this.vulnTime -= dt;
    if (this.invulnTime > 0) this.invulnTime -= dt;
    if (this.deflectCd > 0) this.deflectCd -= dt;
    if (this.invulnTime > 0 || this.wardRing) this.updateWard(dt);
    if (this.affixes.length) this.updateAffix(dt);
    if (this.affixCrown) {
      this.affixCrown.rotation.y += dt * 1.7;
      this.affixCrown.position.y = Math.sin(this.t * 3) * 0.045;
    }

    this.stagger = Math.max(0, this.stagger - dt);
    if (this.frozen > 0) {
      this.frozen -= dt;
      for (const f of this.flashMats) {
        f.mat.emissive.set(0x5599ff);
        f.mat.emissiveIntensity = 0.9 + Math.sin(this.t * 6) * 0.2;
      }
    } else {
      if (this.spawnGrace > 0) {
        const byDt = Math.max(0, this.spawnGrace - dt);
        const byClock = Math.max(0, (this.spawnGraceUntil - performance.now()) / 1000);
        this.spawnGrace = Math.min(byDt, byClock);
      }
      // Spawn grace/stagger interrupt the brain (no blue tint) but the body still flashes/settles.
      if (this.stagger <= 0 && this.spawnGrace <= 0) this.tick(dt);
      // Hit flash: spike emissive to white, settle back
      this.hitFlash = Math.max(0, this.hitFlash - dt * 7);
      const vulnGlow = this.vulnTime > 0 ? 0.32 + Math.sin(this.t * 9) * 0.1 : 0;
      for (const f of this.flashMats) {
        this.emissiveScratch.copy(f.baseEmissive);
        if (vulnGlow > 0) this.emissiveScratch.lerp(this.vulnColor, vulnGlow);
        f.mat.emissive.copy(this.emissiveScratch).lerp(this.flashWhite, this.hitFlash);
        f.mat.emissiveIntensity = f.baseIntensity + this.hitFlash * 3;
      }
    }

    const intent = this.intentPose;
    for (const r of this.roleSilhouettes) {
      const g = r.group;
      const beat = Math.sin(this.t * 5.2 + this.id * 0.7);
      g.position.y = beat * 0.018 + intent * 0.065;
      g.rotation.x = 0;
      g.rotation.z = 0;
      g.scale.setScalar(1);
      if (r.kind === "charger") {
        g.rotation.x = -intent * 0.36;
        g.position.z = intent * 0.18;
        g.scale.set(1 + intent * 0.06, 1 - intent * 0.08, 1 + intent * 0.18);
      } else if (r.kind === "caster") {
        g.rotation.y += dt * (0.8 + intent * 3.2);
        g.scale.setScalar(1 + intent * 0.16 + Math.max(0, beat) * 0.025);
      } else if (r.kind === "bomber") {
        const swell = 1 + intent * 0.18 + Math.max(0, beat) * intent * 0.05;
        g.scale.set(swell, 1 + intent * 0.1, swell);
      } else if (r.kind === "shield") {
        g.position.z = intent * 0.12;
        g.scale.set(1 + intent * 0.14, 1 + intent * 0.04, 1 + intent * 0.08);
      } else if (r.kind === "flier") {
        g.position.y += Math.sin(this.t * 7 + this.id) * 0.055 + intent * 0.08;
        g.rotation.z = Math.sin(this.t * 4.5) * 0.08;
      } else if (r.kind === "void") {
        g.rotation.y += dt * (0.45 + intent * 1.8);
        g.scale.setScalar(1 + intent * 0.12);
      } else if (r.kind === "swarm") {
        g.rotation.y += dt * 2.4;
        g.scale.setScalar(1 + Math.max(0, beat) * 0.08);
      }
    }
    this.intentPose = Math.max(0, this.intentPose - dt * 5.5);

    // Knockback decay
    this.pos.x += this.kb.x * dt;
    this.pos.z += this.kb.y * dt;
    this.kb.multiplyScalar(Math.exp(-6 * dt));

    // Bounds
    const r = Math.hypot(this.pos.x, this.pos.z);
    const maxR = ARENA_RADIUS - this.radius * 0.5;
    if (r > maxR) {
      this.pos.x *= maxR / r;
      this.pos.z *= maxR / r;
    }
    // Pillars block everything smaller than a boss (airborne leaps excluded)
    if (this.kind !== "boss" && this.pos.y < 1) {
      this.ctx.arena.resolveObstacles(this.pos, this.radius);
    }

    // Dramatic geometry eruption (phase reveals): overshoot scale-in.
    if (this.eruptT > 0) {
      this.eruptT = Math.max(0, this.eruptT - dt);
      const k = 1 - this.eruptT / this.eruptDur;            // 0 → 1
      const c = 1.9;                                        // easeOutBack overshoot
      const ease = Math.max(0.0001, 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2));
      for (const e of this.eruptList) e.o.scale.copy(e.s).multiplyScalar(ease);
      if (this.eruptT === 0) this.eruptList.length = 0;
    }

    const reactK = this.reactDur > 0 ? this.reactT / this.reactDur : 0;
    const reactEase = Math.sin(Math.max(0, Math.min(1, reactK)) * Math.PI);
    this.root.position.set(this.pos.x, this.pos.y + this.reactLift * reactEase + this.poseRise, this.pos.z);
    this.root.rotation.set(
      this.reactPitch * reactEase + this.poseRear - this.poseLunge,
      this.heading + this.reactYaw * reactEase,
      this.reactRoll * reactEase,
    );
    // Boss body scale: ease toward the phase-growth target with a swell pulse on top,
    // plus a subtle always-on "breathing" pulse so a boss never reads as a frozen
    // statue. Scaling from the root origin (at the feet) keeps the base planted.
    if (this.kind === "boss" || this.bossScale !== 1 || this.bossScaleCur !== 1 || this.poseSwell !== 0) {
      this.bossScaleCur += (this.bossScale - this.bossScaleCur) * Math.min(1, dt * 6);
      const breathe = this.kind === "boss" ? Math.sin(this.t * 1.5) * 0.012 : 0;
      this.root.scale.setScalar(this.bossScaleCur * (1 + this.poseSwell + breathe));
    }

    // Ground-contact glow tracks the body on the floor (grounds it, lifts it off the dark).
    this.ensureGroundGlow();
    if (this.groundGlow) {
      const isBoss = this.kind === "boss";
      this.groundGlow.position.set(this.pos.x, 0.03, this.pos.z);
      const gm = this.groundGlow.material as THREE.MeshBasicMaterial;
      const glowBase = isBoss ? 0.42 : 0.26;
      gm.opacity = (this.frozen > 0 ? 0.12 : glowBase) + Math.sin(this.t * 2.6) * (isBoss ? 0.09 : 0.05) + this.hitFlash * 0.3;
    }

    // Ambient boss presence: a slow drift of embers rising off the body, in its
    // own palette — makes a boss feel like it's radiating power even while idle.
    if (this.kind === "boss" && this.alive) {
      this.bossFxAcc -= dt;
      if (this.bossFxAcc <= 0) {
        this.bossFxAcc = 0.11;
        const ang = this.t * 2.3 + this.id;
        this.ctx.fx.burst({
          x: this.pos.x + Math.sin(ang) * this.radius * 1.4,
          y: 0.2 + Math.random() * 0.5,
          z: this.pos.z + Math.cos(ang * 1.3) * this.radius * 1.4,
          count: 1, color: this.wardColor,
          speed: [0.2, 0.9], up: 1.4, vertical: 0.5, size: [0.18, 0.42],
          life: [0.7, 1.4], gravity: 0.25, drag: 1.1, jitter: 0.6,
        });
      }
    }

    // HP bar — bosses use the dedicated top-of-screen bar, so suppress the overhead one.
    const frac = Math.max(0, this.hp / this.maxHp);
    const show = frac < 1 && this.kind !== "boss";
    this.hpBg.visible = this.hpFill.visible = show;
    if (show) {
      const h = this.barHeight();
      this.hpBg.position.set(0, h, 0);
      this.hpFill.position.set(-0.53, h, 0.001);
      this.hpFill.scale.x = 1.06 * frac;
    }

    // Shield bar — sits just above the HP bar, shown only while partially up.
    if (this.shieldMaxHp > 0) {
      const sFrac = this.shieldHp / this.shieldMaxHp;
      const sShow = this.shieldHp > 0.01 && sFrac < 0.999;
      this.ensureShieldBar();
      const bg = this.shieldBg!;
      const fill = this.shieldFill!;
      bg.visible = fill.visible = sShow;
      if (sShow) {
        const h = this.barHeight() + 0.12;
        bg.position.set(0, h, 0);
        fill.position.set(-0.4, h, 0.001);
        fill.scale.x = 0.8 * sFrac;
        (fill.material as THREE.SpriteMaterial).color.set(this.shieldBarColor);
      }
    }
  }

  protected barHeight(): number {
    return 2.0;
  }

  /** Damped walk toward a point; returns distance remaining. */
  protected seek(tx: number, tz: number, dt: number, speedScale = 1): number {
    const dx = tx - this.pos.x;
    const dz = tz - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.05) {
      const sp = this.speed * speedScale * this.affixSpeedMult * (this.kind === "boss" ? 1 : this.ctx.difficulty.enemySpeedMult) * this.ctx.overdrive.enemySpeedMult;
      this.pos.x += (dx / d) * sp * dt;
      this.pos.z += (dz / d) * sp * dt;
      this.heading = dampAngle(this.heading, Math.atan2(dx, dz), 8, dt);
    }
    return d;
  }

  protected facePlayer(dt: number): void {
    const p = this.ctx.player.pos;
    this.heading = dampAngle(this.heading, Math.atan2(p.x - this.pos.x, p.z - this.pos.z), 8, dt);
  }

  protected distToPlayer(): number {
    const p = this.ctx.player.pos;
    return Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
  }

  protected tryContactDamage(range = 0.45): void {
    if (this.contactDmg <= 0 || this.contactCd > 0) return;
    const p = this.ctx.player;
    if (this.distToPlayer() < this.radius + p.radius + range) {
      if (this.ctx.combat.damagePlayer(this.contactDmg, this.pos.x, this.pos.z) !== "dodged") {
        this.contactCd = 0.9;
      }
    }
  }
}

// ---------------------------------------------------------------- Husk
/** Melee chaser. Telegraphed lunge bite. The bread-and-butter threat. */
export class Husk extends Enemy {
  readonly kind: EnemyKind = "husk";
  private state: "chase" | "windup" | "lunge" | "recover" = "chase";
  private timer = 0;
  private lungeDir = new THREE.Vector2();
  private struck = false;
  private eyeMat: THREE.MeshStandardMaterial;

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 30;
    this.speed = 3.4;
    this.radius = 0.55;
    this.addRoleSilhouette("charger", 0xff5533);

    const bodyMat = this.stdMat(0x4a1f24, 0x771111, 0.25);
    const boneMat = this.stdMat(0x8a7766);
    this.eyeMat = this.stdMat(0x000000, 0xff4422, 2.5);

    const torso = this.addMesh(new THREE.BoxGeometry(0.8, 0.7, 0.7), bodyMat, 0, 0.75);
    torso.rotation.x = 0.35;
    this.addMesh(new THREE.BoxGeometry(0.5, 0.4, 0.45), bodyMat, 0, 1.15, 0.35); // head
    this.addMesh(new THREE.BoxGeometry(0.1, 0.08, 0.06), this.eyeMat, -0.12, 1.2, 0.59);
    this.addMesh(new THREE.BoxGeometry(0.1, 0.08, 0.06), this.eyeMat, 0.12, 1.2, 0.59);
    // Gaping bone jaw with a row of teeth
    this.addMesh(new THREE.BoxGeometry(0.42, 0.12, 0.3), boneMat, 0, 1.0, 0.42);
    for (let i = 0; i < 4; i++) {
      const tooth = this.addMesh(new THREE.ConeGeometry(0.035, 0.13, 4), boneMat, (i - 1.5) * 0.1, 1.04, 0.55);
      tooth.rotation.x = Math.PI;
    }
    // Exposed collar-bone ribs across the chest
    this.addMesh(new THREE.BoxGeometry(0.6, 0.07, 0.07), boneMat, 0, 0.92, 0.34);
    this.addMesh(new THREE.BoxGeometry(0.5, 0.07, 0.07), boneMat, 0, 0.78, 0.36);
    // Bone spikes along the back
    for (let i = 0; i < 3; i++) {
      const sp = this.addMesh(new THREE.ConeGeometry(0.09, 0.4 - i * 0.07, 4), boneMat, 0, 1.05 - i * 0.2, -0.25 - i * 0.16);
      sp.rotation.x = -0.5;
    }
    this.addMesh(new THREE.BoxGeometry(0.22, 0.5, 0.25), bodyMat, -0.25, 0.25, 0);
    this.addMesh(new THREE.BoxGeometry(0.22, 0.5, 0.25), bodyMat, 0.25, 0.25, 0);
    // Jagged bone shards bursting from the shoulders
    const shl = this.addMesh(new THREE.ConeGeometry(0.08, 0.32, 4), boneMat, -0.4, 1.05, 0);
    shl.rotation.z = 0.8;
    const shr = this.addMesh(new THREE.ConeGeometry(0.08, 0.32, 4), boneMat, 0.4, 1.05, 0);
    shr.rotation.z = -0.8;
  }

  protected deathColor(): number {
    return 0xff4422;
  }

  protected tick(dt: number): void {
    const p = this.ctx.player;
    this.timer -= dt;
    this.pos.y = Math.abs(Math.sin(this.t * 5)) * 0.07 * (this.state === "chase" ? 1 : 0);

    switch (this.state) {
      case "chase": {
        const d = this.seek(p.pos.x, p.pos.z, dt);
        if (d < 2.4) {
          this.state = "windup";
          this.timer = 0.45;
          this.struck = false;
          const dx = p.pos.x - this.pos.x;
          const dz = p.pos.z - this.pos.z;
          const len = Math.hypot(dx, dz) || 1;
          this.lungeDir.set(dx / len, dz / len);
          // Covers the lunge's moving strike zone (~1.75 around the husk over ~2.2m travel)
          this.ctx.tele.circle(this.pos.x + this.lungeDir.x * 1.5, this.pos.z + this.lungeDir.y * 1.5, 1.7, 0.45);
          this.eyeMat.emissiveIntensity = 5;
        }
        break;
      }
      case "windup":
        this.setIntentPose(1);
        this.root.scale.set(1.08, 0.86, 1.18);
        this.facePlayer(dt);
        if (this.timer <= 0) {
          this.root.scale.set(1, 1, 1);
          this.state = "lunge";
          this.timer = 0.22;
          this.kb.x += this.lungeDir.x * 13;
          this.kb.y += this.lungeDir.y * 13;
          this.ctx.sfx.enemyLunge();
        }
        break;
      case "lunge":
        this.setIntentPose(0.55);
        this.root.scale.set(0.96, 1.04, 1.16);
        if (!this.struck && this.distToPlayer() < this.radius + p.radius + 0.7) {
          this.struck = true;
          this.ctx.combat.damagePlayer(12, this.pos.x, this.pos.z);
        }
        if (this.timer <= 0) {
          this.state = "recover";
          this.timer = 0.75;
          this.eyeMat.emissiveIntensity = 2.5;
        }
        break;
      case "recover":
        this.root.scale.set(1, 1, 1);
        if (this.timer <= 0) this.state = "chase";
        break;
    }
  }
}

// ---------------------------------------------------------------- Spitter
/** Ranged kiter. Keeps distance, lobs glowing bolts on a visible windup. */
export class Spitter extends Enemy {
  readonly kind: EnemyKind = "spitter";
  private fireTimer = 1.6;
  private windup = -1;
  private orb: THREE.Mesh;
  private orbMat: THREE.MeshStandardMaterial;
  private strafeDir = Math.random() < 0.5 ? 1 : -1;

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 22;
    this.speed = 2.6;
    this.radius = 0.5;
    this.addRoleSilhouette("caster", 0x55bbff);

    const robeMat = this.stdMat(0x1c2a4a, 0x223a88, 0.3);
    const trimMat = this.stdMat(0x2e447a, 0x3366cc, 0.7);
    const eyeMat = this.stdMat(0x000000, 0x66ccff, 2.6);
    this.orbMat = this.stdMat(0x113355, 0x44aaff, 2.2);
    this.addMesh(new THREE.ConeGeometry(0.5, 1.5, 6), robeMat, 0, 0.75);
    // Hem ring + a glowing seam up the robe
    const hem = this.addMesh(new THREE.TorusGeometry(0.46, 0.05, 6, 12), trimMat, 0, 0.18);
    hem.rotation.x = Math.PI / 2;
    this.addMesh(new THREE.BoxGeometry(0.07, 1.0, 0.07), trimMat, 0, 0.85, 0.45);
    // Cowl: cone hood with a recessed face and twin socket eyes
    const hood = this.addMesh(new THREE.ConeGeometry(0.3, 0.5, 6), robeMat, 0, 1.65);
    hood.rotation.x = 0.18;
    this.addMesh(new THREE.SphereGeometry(0.2, 8, 6), robeMat, 0, 1.55, 0.04);
    this.addMesh(new THREE.SphereGeometry(0.045, 6, 5), eyeMat, -0.08, 1.58, 0.18);
    this.addMesh(new THREE.SphereGeometry(0.045, 6, 5), eyeMat, 0.08, 1.58, 0.18);
    // Outstretched casting arm cradling the orb
    const arm = this.addMesh(new THREE.CylinderGeometry(0.06, 0.05, 0.55, 5), robeMat, 0.12, 1.3, 0.4);
    arm.rotation.set(Math.PI / 2.4, 0, -0.3);
    this.orb = this.addMesh(new THREE.SphereGeometry(0.16, 10, 8), this.orbMat, 0, 1.25, 0.55);
    // Faint orbiting shard around the orb
    const shard = this.addMesh(new THREE.OctahedronGeometry(0.06), trimMat, 0.22, 1.25, 0.55);
    shard.rotation.set(0.5, 0.5, 0);
  }

  protected deathColor(): number {
    return 0x44aaff;
  }

  protected tick(dt: number): void {
    const p = this.ctx.player;
    const d = this.distToPlayer();
    this.facePlayer(dt);
    this.pos.y = Math.sin(this.t * 2.2) * 0.08;
    this.orb.position.y = 1.25 + Math.sin(this.t * 3.1) * 0.08;

    // Kite band 8–12, strafe inside it
    if (this.windup < 0) {
      if (d < 7.5) this.seek(this.pos.x * 2 - p.pos.x, this.pos.z * 2 - p.pos.z, dt, 0.9);
      else if (d > 12) this.seek(p.pos.x, p.pos.z, dt);
      else {
        const ang = Math.atan2(this.pos.x - p.pos.x, this.pos.z - p.pos.z) + this.strafeDir * 0.5 * dt;
        const tx = p.pos.x + Math.sin(ang) * d;
        const tz = p.pos.z + Math.cos(ang) * d;
        this.seek(tx, tz, dt, 0.55);
        if (Math.random() < dt * 0.2) this.strafeDir *= -1;
      }
      this.fireTimer -= dt;
      if (this.fireTimer <= 0 && d < 16) {
        this.windup = 0.38;
        this.fireTimer = 2.3;
      }
    } else {
      this.setIntentPose(1 - Math.max(0, this.windup) / 0.38);
      this.windup -= dt;
      this.orbMat.emissiveIntensity = 2.2 + (0.38 - this.windup) * 9;
      this.orb.scale.setScalar(1 + (0.38 - this.windup) * 1.6);
      if (this.windup <= 0) {
        this.windup = -1;
        this.orbMat.emissiveIntensity = 2.2;
        this.orb.scale.setScalar(1);
        const ang = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
        this.ctx.hostiles.fire(this.pos.x, this.pos.z, ang, { speed: 9, dmg: 8, color: 0x55bbff, radius: 0.3 });
        this.ctx.sfx.enemyShoot();
      }
    }
  }
}

// ---------------------------------------------------------------- Swarmer
/** Tiny, fast, jittery. Dangerous in packs, dies to anything. */
export class Swarmer extends Enemy {
  readonly kind: EnemyKind = "swarmer";
  private phase = Math.random() * TAU;

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 12;
    this.speed = 5.4;
    this.radius = 0.35;
    this.contactDmg = 6;
    this.addRoleSilhouette("swarm", 0xff7733);

    const bodyMat = this.stdMat(0x3a1410, 0xff5511, 0.8);
    const coreMat = this.stdMat(0x1a0805, 0xff8822, 2.4);
    const spikeMat = this.stdMat(0x221111);
    this.addMesh(new THREE.IcosahedronGeometry(0.32, 0), bodyMat, 0, 0.4);
    // A single furious ember eye glaring forward
    this.addMesh(new THREE.SphereGeometry(0.12, 8, 6), coreMat, 0, 0.42, 0.26);
    // Snapping mandibles below the eye
    const jl = this.addMesh(new THREE.ConeGeometry(0.05, 0.22, 4), spikeMat, -0.08, 0.3, 0.28);
    jl.rotation.set(1.3, 0, 0.3);
    const jr = this.addMesh(new THREE.ConeGeometry(0.05, 0.22, 4), spikeMat, 0.08, 0.3, 0.28);
    jr.rotation.set(1.3, 0, -0.3);
    // Crown of back spikes, spread wider for a bristling silhouette
    for (let i = 0; i < 4; i++) {
      const sp = this.addMesh(new THREE.ConeGeometry(0.05, 0.3, 4), spikeMat, 0, 0.6, -0.05);
      sp.rotation.z = (i - 1.5) * 0.45;
      sp.position.x = (i - 1.5) * 0.13;
    }
  }

  protected deathColor(): number {
    return 0xff7733;
  }

  protected barHeight(): number {
    return 1.1;
  }

  protected tick(dt: number): void {
    const p = this.ctx.player;
    // Perpendicular jitter sells "swarm"
    const dx = p.pos.x - this.pos.x;
    const dz = p.pos.z - this.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const jit = Math.sin(this.t * 6 + this.phase) * 0.8;
    const tx = p.pos.x + (-dz / d) * jit;
    const tz = p.pos.z + (dx / d) * jit;
    this.seek(tx, tz, dt);
    this.pos.y = Math.abs(Math.sin(this.t * 9 + this.phase)) * 0.12;
    this.tryContactDamage();
  }
}

// ---------------------------------------------------------------- Bomber
/** Sprints in, lights a fuse, erases a chunk of arena. Kill it early — it detonates either way. */
export class Bomber extends Enemy {
  readonly kind: EnemyKind = "bomber";
  private fuse = -1;
  private coreMat: THREE.MeshStandardMaterial;
  private exploded = false;

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 18;
    this.speed = 4.3;
    this.radius = 0.5;
    this.addRoleSilhouette("bomber", 0xff8a22);

    const shellMat = this.stdMat(0x33231a, 0x331100, 0.2);
    const ironMat = this.stdMat(0x4a3a2a, 0x442200, 0.3);
    this.coreMat = this.stdMat(0x441100, 0xff6600, 1.6);
    this.addMesh(new THREE.SphereGeometry(0.5, 10, 8), shellMat, 0, 0.55);
    // Riveted iron bands girdling the casing
    const band = this.addMesh(new THREE.TorusGeometry(0.5, 0.06, 6, 14), ironMat, 0, 0.55);
    band.rotation.x = Math.PI / 2;
    const band2 = this.addMesh(new THREE.TorusGeometry(0.4, 0.05, 6, 14), ironMat, 0, 0.55);
    band2.rotation.set(Math.PI / 2, 0, 0);
    band2.rotation.z = Math.PI / 2;
    // Rivets around the equator
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      this.addMesh(new THREE.SphereGeometry(0.05, 5, 4), ironMat, Math.cos(a) * 0.5, 0.55, Math.sin(a) * 0.5);
    }
    // Molten core swelling through a cracked top plate
    this.addMesh(new THREE.SphereGeometry(0.3, 8, 6), this.coreMat, 0, 0.85, 0.15);
    // Fuse: an iron collar + tapering fuse cone capped with a sputtering ember
    this.addMesh(new THREE.CylinderGeometry(0.12, 0.14, 0.12, 6), ironMat, 0, 1.02, 0.15);
    this.addMesh(new THREE.ConeGeometry(0.08, 0.3, 4), this.coreMat, 0, 1.2, 0.15);
    this.addMesh(new THREE.SphereGeometry(0.07, 6, 5), this.coreMat, 0, 1.38, 0.15);
  }

  protected deathColor(): number {
    return 0xff8800;
  }

  protected onDeath(): void {
    // A lit fuse always pays off
    if (this.fuse >= 0) this.explode();
  }

  private explode(): void {
    if (this.exploded) return;
    this.exploded = true;
    const R = 3.6;
    this.ctx.events.emit("EXPLOSION", { x: this.pos.x, z: this.pos.z, radius: R });
    this.ctx.fx.burst({
      x: this.pos.x, y: 0.7, z: this.pos.z,
      count: 45, color: [0xff8800, 0xffcc44, 0xff4400],
      speed: [4, 14], up: 0.8, size: [0.6, 1.4], life: [0.35, 0.9], gravity: -7, drag: 2.2,
    });
    this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: R, color: 0xff8800, duration: 0.5 });
    this.ctx.cam.addTrauma(0.4);
    this.ctx.sfx.explosion();
    if (this.distToPlayer() < R + this.ctx.player.radius) {
      this.ctx.combat.damagePlayer(22, this.pos.x, this.pos.z);
    }
    // Splash hits other enemies too — bait potential
    for (const e of this.ctx.enemies.living()) {
      if (e === (this as Enemy)) continue;
      const dd = Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z);
      if (dd < R) this.ctx.combat.dealDamage(e, 20, { kbX: e.pos.x - this.pos.x, kbZ: e.pos.z - this.pos.z, kb: 6, heavy: true });
    }
  }

  protected tick(dt: number): void {
    const p = this.ctx.player;
    if (this.fuse < 0) {
      const d = this.seek(p.pos.x, p.pos.z, dt);
      this.pos.y = Math.abs(Math.sin(this.t * 7)) * 0.1;
      if (d < 3.0) {
        this.fuse = 0.95;
        this.ctx.tele.circle(this.pos.x, this.pos.z, 3.6, 0.95, 0xff8822);
        this.ctx.sfx.fuse();
      }
    } else {
      this.fuse -= dt;
      this.seek(p.pos.x, p.pos.z, dt, 0.3);
      const k = 1 - Math.max(0, this.fuse) / 0.95;
      this.setIntentPose(k);
      this.coreMat.emissiveIntensity = 1.6 + k * 7 + Math.sin(this.t * (10 + k * 40)) * 1.5;
      this.root.scale.setScalar(1 + k * 0.25);
      if (this.fuse <= 0) {
        this.explode();
        this.die();
      }
    }
  }
}

// ---------------------------------------------------------------- Sentinel
/** Slow armored artillery. Locks a beam line, then fires a hitscan lance. */
export class Sentinel extends Enemy {
  readonly kind: EnemyKind = "sentinel";
  private cycle = 2.2;
  private aiming = -1;
  private lockedAngle = 0;
  private tipMat: THREE.MeshStandardMaterial;
  private beamMesh: THREE.Mesh;
  private beamMat: THREE.MeshBasicMaterial;
  private beamFade = 0;

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 60;
    this.speed = 1.7;
    this.radius = 0.7;
    this.addRoleSilhouette("shield", 0xbb66ff);

    const armorMat = this.stdMat(0x2a2a3a, 0x222244, 0.3);
    const trimMat = this.stdMat(0x55456a, 0x8844ff, 0.7);
    this.tipMat = this.stdMat(0x221133, 0xbb66ff, 2.0);

    this.addMesh(new THREE.CylinderGeometry(0.55, 0.75, 1.5, 6), armorMat, 0, 0.75);
    // Trim must protrude well past the tapered body (r≈0.62 at this height)
    // or the coincident walls shimmer.
    this.addMesh(new THREE.CylinderGeometry(0.72, 0.72, 0.18, 6), trimMat, 0, 1.0);
    // Glowing core slit between the armor bands
    this.addMesh(new THREE.CylinderGeometry(0.64, 0.64, 0.1, 6), this.tipMat, 0, 0.55);
    // Hexagonal sensor head with a recessed eye
    this.addMesh(new THREE.SphereGeometry(0.3, 8, 6), armorMat, 0, 1.75);
    this.addMesh(new THREE.SphereGeometry(0.1, 8, 6), this.tipMat, 0, 1.78, 0.26);
    // Cooling vent fins flanking the chassis
    for (const sx of [-0.62, 0.62]) {
      const fin = this.addMesh(new THREE.BoxGeometry(0.12, 0.7, 0.5), armorMat, sx, 0.75, -0.1);
      fin.rotation.z = sx < 0 ? 0.2 : -0.2;
    }
    // Lance, braced by a glowing collar at the breech
    this.addMesh(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 6), trimMat, 0.55, 1.3, 0).rotation.x = Math.PI / 2;
    this.addMesh(new THREE.CylinderGeometry(0.13, 0.13, 0.18, 6), trimMat, 0.55, 1.3, 0.2).rotation.x = Math.PI / 2;
    this.addMesh(new THREE.ConeGeometry(0.12, 0.4, 6), this.tipMat, 0.55, 1.3, 0.95).rotation.x = Math.PI / 2;

    this.beamMat = new THREE.MeshBasicMaterial({
      color: 0xbb66ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.beamMesh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 1), this.beamMat);
    this.beamMesh.visible = false;
    ctx.stage.scene.add(this.beamMesh);
  }

  protected deathColor(): number {
    return 0xbb66ff;
  }

  protected barHeight(): number {
    return 2.4;
  }

  dispose(): void {
    super.dispose();
    this.ctx.stage.scene.remove(this.beamMesh);
    this.beamMesh.geometry.dispose();
    this.beamMat.dispose();
  }

  freeze(duration: number): void {
    super.freeze(duration);
    // Cancel any in-progress aim — thawing into an instant un-telegraphed
    // beam would read as unfair.
    if (this.aiming >= 0) {
      this.aiming = -1;
      this.tipMat.emissiveIntensity = 2;
      this.cycle = Math.max(this.cycle, 1.5);
    }
  }

  protected tick(dt: number): void {
    const p = this.ctx.player;
    this.beamFade = Math.max(0, this.beamFade - dt * 5);
    this.beamMat.opacity = this.beamFade;
    this.beamMesh.visible = this.beamFade > 0;

    if (this.aiming < 0) {
      this.facePlayer(dt);
      const d = this.distToPlayer();
      if (d > 11) this.seek(p.pos.x, p.pos.z, dt);
      else if (d < 6) this.seek(this.pos.x * 2 - p.pos.x, this.pos.z * 2 - p.pos.z, dt, 0.7);
      this.cycle -= dt;
      if (this.cycle <= 0 && d < 17) {
        this.aiming = 1.25;
        this.cycle = 4.6;
      }
    } else {
      const prev = this.aiming;
      this.aiming -= dt;
      this.setIntentPose(1 - Math.max(0, this.aiming) / 1.25);
      // Track until lock at 0.45s remaining, then the line is committed — dodge it
      if (this.aiming > 0.45) {
        this.facePlayer(dt * 0.6);
        this.lockedAngle = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
      }
      if (prev > 0.45 && this.aiming <= 0.45) {
        // Width matches the real hit window: 0.55 beam half-width + player radius
        this.ctx.tele.line(this.pos.x, this.pos.z, this.lockedAngle, 17, 2.0, 0.45, 0xbb66ff);
        this.ctx.sfx.beamCharge();
      }
      this.tipMat.emissiveIntensity = 2 + (1.25 - this.aiming) * 6;
      if (this.aiming <= 0) {
        this.aiming = -1;
        this.tipMat.emissiveIntensity = 2;
        this.fireBeam();
      }
    }
  }

  private fireBeam(): void {
    const p = this.ctx.player;
    const len = 17;
    const sx = Math.sin(this.lockedAngle);
    const cz = Math.cos(this.lockedAngle);
    // Visual beam — widened so the rendered lance matches the telegraphed lane
    this.beamMesh.scale.set(2.4, 2.4, len);
    this.beamMesh.position.set(this.pos.x + sx * len * 0.5, 1.1, this.pos.z + cz * len * 0.5);
    this.beamMesh.rotation.y = this.lockedAngle;
    this.beamFade = 0.9;
    this.ctx.fx.burst({
      x: this.pos.x + sx * 1.2, y: 1.2, z: this.pos.z + cz * 1.2,
      count: 14, color: 0xbb66ff, speed: [3, 9], up: 0.4, size: [0.3, 0.7], life: [0.2, 0.4], gravity: -3, drag: 3,
    });
    this.ctx.sfx.beamFire();
    this.ctx.cam.addTrauma(0.15);
    // Hitscan: perpendicular distance from player to the beam segment
    const px = p.pos.x - this.pos.x;
    const pz = p.pos.z - this.pos.z;
    const along = px * sx + pz * cz;
    if (along > 0 && along < len) {
      const perp = Math.abs(px * cz - pz * sx);
      if (perp < 0.55 + p.radius) {
        this.ctx.combat.damagePlayer(16, this.pos.x, this.pos.z);
      }
    }
  }
}

// ---------------------------------------------------------------- Manager
interface PendingSpawn {
  kind: EnemyKind;
  x: number;
  z: number;
  timer: number;
  make?: (ctx: Ctx, x: number, z: number) => Enemy;
}

type EnemyCtor = new (ctx: Ctx, x: number, z: number) => Enemy;

/**
 * Mutable registry so additional rosters (enemies2.ts) can register without
 * a circular import — main.ts imports them once for the side effect.
 */
const REGISTRY = new Map<Exclude<EnemyKind, "boss">, EnemyCtor>([
  ["husk", Husk],
  ["spitter", Spitter],
  ["swarmer", Swarmer],
  ["bomber", Bomber],
  ["sentinel", Sentinel],
]);

export function registerEnemy(kind: Exclude<EnemyKind, "boss">, ctor: EnemyCtor): void {
  REGISTRY.set(kind, ctor);
}

export function makeEnemy(kind: Exclude<EnemyKind, "boss">, ctx: Ctx, x: number, z: number): Enemy {
  const ctor = REGISTRY.get(kind);
  if (!ctor) throw new Error(`Enemy kind not registered: ${kind}`);
  return new ctor(ctx, x, z);
}

export class EnemyManager {
  private enemies: Enemy[] = [];
  private pending: PendingSpawn[] = [];
  private streakCount = 0;
  private streakTimer = 0;

  constructor(private ctx: Ctx) {
    ctx.events.on("KILL", () => {
      ctx.stats.kills++;
      this.streakCount++;
      this.streakTimer = 2.6;
      if (this.streakCount >= 3) {
        this.ctx.events.emit("KILL_STREAK", { count: this.streakCount });
        if (this.streakCount > ctx.stats.bestStreak) ctx.stats.bestStreak = this.streakCount;
      }
    });
    // Reactive AI: foes sidestep a lunge aimed down their lane...
    ctx.events.on("CARD_CAST", ({ id }) => {
      if (id === "phase-step" || id === "shield-bash") this.reactToLunge();
    });
    // ...and recoil in fear the moment you hit the Critical zone.
    ctx.events.on("TEMPO_ZONE", ({ zone, prev }) => {
      if (zone === "critical" && prev !== "critical") this.flinchNearby();
    });
  }

  /** A lunge down the player's facing makes foes in the lane scatter sideways. */
  private reactToLunge(): void {
    const p = this.ctx.player;
    const fx = Math.sin(p.facing);
    const fz = Math.cos(p.facing);
    for (const e of this.living()) {
      if (e.kind === "boss") continue;
      const dx = e.pos.x - p.pos.x;
      const dz = e.pos.z - p.pos.z;
      const along = dx * fx + dz * fz;
      if (along < 0.5 || along > 9) continue; // ahead of the player, within lunge reach
      const perp = dx * fz - dz * fx; // signed distance from the lane centerline
      if (Math.abs(perp) > 2.2) continue;
      if (Math.random() < 0.6) {
        const side = perp >= 0 ? 1 : -1;
        e.shove(fz * side, -fx * side, 9); // dive out of the lane
      }
    }
  }

  /** Hitting Critical tempo sends nearby lesser foes recoiling outward in fear. */
  private flinchNearby(): void {
    const p = this.ctx.player;
    let any = false;
    for (const e of this.living()) {
      if (e.kind === "boss") continue;
      const dx = e.pos.x - p.pos.x;
      const dz = e.pos.z - p.pos.z;
      if (Math.hypot(dx, dz) < 7) { e.shove(dx, dz, 6); any = true; }
    }
    if (any) this.ctx.fx.ring(p.pos.x, p.pos.z, { radius: 6, color: 0xff4252, duration: 0.4 });
  }

  /** Telegraphed spawn: warning ring, then the enemy erupts from the floor. */
  spawn(kind: Exclude<EnemyKind, "boss">, x: number, z: number, delay = 0.8): void {
    this.pending.push({ kind, x, z, timer: delay });
    this.ctx.tele.circle(x, z, 1.0, delay, 0xffffff);
  }

  /** Direct spawn for custom enemies (boss adds, etc.). */
  spawnCustom(make: (ctx: Ctx, x: number, z: number) => Enemy, x: number, z: number, delay = 0.8): void {
    this.pending.push({ kind: "boss", x, z, timer: delay, make });
    this.ctx.tele.circle(x, z, 1.4, delay, 0xff5533);
  }

  add(e: Enemy): void {
    this.enemies.push(e);
  }

  /**
   * Boot warm-up: build one of every roster enemy off-screen so the renderer
   * compiles their shader variants NOW (during load) instead of on first spawn
   * mid-fight — a real-GPU first-use compile shows up as a frame hitch. The
   * dummies are added to the scene, compiled via Stage.warmUp(), then disposed.
   */
  precompile(): void {
    const dummies: Enemy[] = [];
    for (const kind of REGISTRY.keys()) {
      try { dummies.push(makeEnemy(kind, this.ctx, 0, -1000)); } catch { /* skip a bad ctor */ }
    }
    for (const e of dummies) e.warmVisuals(); // ground glow into the scene before the compile
    this.ctx.stage.warmUp(); // compiles the whole scene, including the dummies just added
    for (const e of dummies) e.dispose();
  }

  living(): Enemy[] {
    return this.enemies.filter((e) => e.alive);
  }

  get remaining(): number {
    let alive = 0;
    for (const e of this.enemies) if (e.alive) alive++;
    return alive + this.pending.length;
  }

  freezeAll(duration: number): void {
    for (const e of this.living()) e.freeze(duration);
    this.ctx.events.emit("FREEZE", {});
  }

  clear(): void {
    for (const e of this.enemies) if (e.alive) e.dispose();
    this.enemies = [];
    this.pending = [];
    this.streakCount = 0;
  }

  /** Remove all lesser enemies and cancel lesser pending spawns, preserving the boss. */
  clearNonBosses(): void {
    for (const e of this.enemies) {
      if (e.alive && e.kind !== "boss") e.takeDamage(99999);
    }
    this.pending = this.pending.filter((p) => p.kind === "boss");
  }

  update(dt: number): void {
    this.streakTimer -= dt;
    if (this.streakTimer <= 0) this.streakCount = 0;

    for (let i = this.pending.length - 1; i >= 0; i--) {
      const s = this.pending[i];
      s.timer -= dt;
      if (s.timer <= 0) {
        this.pending.splice(i, 1);
        const e = s.make ? s.make(this.ctx, s.x, s.z) : makeEnemy(s.kind as Exclude<EnemyKind, "boss">, this.ctx, s.x, s.z);
        // Ascension: scale max HP at the single materialization choke (covers field, elite, boss).
        const diff = this.ctx.difficulty;
        const hpMult = e.kind === "boss" ? diff.enemyHpMult * diff.bossHpMult : diff.enemyHpMult;
        if (hpMult !== 1) e.hp = e.maxHp = Math.round(e.maxHp * hpMult);
        this.enemies.push(e);
        this.ctx.fx.beam(s.x, s.z, e.kind === "boss" ? 0xff5533 : 0xddddff);
        this.ctx.fx.burst({
          x: s.x, y: 0.4, z: s.z,
          count: 16, color: 0xddddff, speed: [2, 7], up: 1.2, size: [0.3, 0.7], life: [0.25, 0.5], gravity: -6, drag: 3,
        });
        this.ctx.sfx.spawn();
      }
    }

    for (const e of this.enemies) e.update(dt);
    let write = 0;
    for (let read = 0; read < this.enemies.length; read++) {
      const e = this.enemies[read];
      if (e.alive) this.enemies[write++] = e;
    }
    this.enemies.length = write;

    // Soft separation so packs don't merge into one blob
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        const min = a.radius + b.radius;
        if (d > 0.001 && d < min) {
          const push = ((min - d) / d) * 0.5;
          a.pos.x -= dx * push;
          a.pos.z -= dz * push;
          b.pos.x += dx * push;
          b.pos.z += dz * push;
        }
      }
    }
  }
}
