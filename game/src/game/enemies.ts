import { pursuitTarget } from "./navigation";
import { Unravel } from "./unravel";
import { forgeBomber, forgeSpitter, forgeSwarmer } from "../render/fieldForge";
import { forgeHusk } from "../render/huskForge";
import * as THREE from "three";
import { forgeGuardian } from "../render/guardianForge";
import { beveledBox } from "../render/surfaces";
import { ARENA_RADIUS } from "../render/arena";
import { applyRim } from "../render/materialFx";
import { ParticleShape } from "../render/particles";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { dampAngle, TAU } from "../core/math";
import type { Ctx } from "./ctx";
import type { AttackFamily, CinematicBeat, ImpactElement } from "../presentation/types";
import type { FootContact } from "../render/contactShadow";

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

export interface DamageOpts {
  kbX?: number;
  kbZ?: number;
  kb?: number;
  heavy?: boolean;
  allowShieldStagger?: boolean;
  /** Guards detonator relics (Shatterglass) from recursing on their own AoE. */
  noDetonate?: boolean;
  /** Presentation identity only; never changes damage or collision. */
  attackFamily?: AttackFamily;
  element?: ImpactElement;
  impactColor?: number;
  /** Repeated ticks keep local feedback without repeatedly kicking the camera. */
  sustained?: boolean;
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
  readonly footContacts: FootContact[] = [];
  readonly id = NEXT_ID++;
  abstract readonly kind: EnemyKind;
  readonly pos = new THREE.Vector3();
  radius = 0.5;
  hp = 30;
  maxHp = 30;
  speed = 3;
  alive = true;
  readonly unravel = new Unravel();
  private seam: THREE.Group | null = null;
  frozen = 0;
  /** Vulnerable status: takes extra damage while >0 (status-combo enabler). */
  vulnTime = 0;
  private vulnMult = 1;
  /** Elite affix ids (hasted/volatile/regenerator/frenzied/siphon) — may carry several. */
  affixes: string[] = [];
  protected affixSpeedMult = 1;
  private affixTimer = 0;
  /** Planted attacks and bosses hold their ground when crowds press into them. */
  get anchored(): boolean { return this.kind === "boss"; }
  private readonly warningClock = { time: 0, revision: 0, alive: true };
  private meleeUntil = 0;
  private meleeRevision = 0;
  private wallSlamWindow = 0;

  get committingMelee(): boolean {
    return this.alive&&this.meleeRevision===this.warningClock.revision&&this.warningClock.time<this.meleeUntil;
  }

  /** Frontline attacks share two openings. Their leases use the attack clock,
   * so freezing an attacker cannot admit a replacement into the same warning. */
  protected commitMelee(duration: number): boolean {
    if(!this.ctx.enemies.claimMeleeStart())return false;
    this.meleeUntil=this.warningClock.time+duration;this.meleeRevision=this.warningClock.revision;return true;
  }

  protected warnCircle(x: number, z: number, radius: number, duration: number, color = 0xff3344): void {
    this.ctx.tele.circle(x, z, radius, duration, color, this.warningClock);
  }

  protected warnLine(x: number, z: number, angle: number, length: number, width: number, duration: number, color = 0xff3344): void {
    this.ctx.tele.line(x, z, angle, length, width, duration, color, this.warningClock);
  }

  protected warnRing(x: number, z: number, inner: number, outer: number, duration: number, color = 0xff3344): void {
    this.ctx.tele.ring(x, z, inner, outer, duration, color, this.warningClock);
  }

  /** An interrupted attack must release its warning, even if the pool is reused. */
  protected cancelWarnings(): void { this.warningClock.revision++; }

  // --- Breakable shields (Bastion front-wall, Mirror bubble). Shield HP lives in
  // the SAME final-damage units as body HP, so every player multiplier already
  // applied in dealDamage accelerates the break for free.
  protected shieldHp = 0;
  protected shieldMaxHp = 0;
  protected shieldBarColor = 0xffffff;
  /** Brief post-break exposure that interrupts any in-progress attack (not freeze — no blue tint). */
  protected stagger = 0;
  private spawnGrace = 0;
  /** Read by combat.dealDamage for honest floaters/stats: how much of the last hit reached the body, and whether a shield ate it. */
  lastBodyDamage = 0;
  lastHitShielded = false;
  private shieldBg: THREE.Sprite | null = null;
  private shieldFill: THREE.Sprite | null = null;
  private affixCrown: THREE.Group | null = null;
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
  private impactHold = 0;
  private deathDuration = 0.58;
  private deathT = this.deathDuration;
  private readonly deathScale = new THREE.Vector3(1, 1, 1);
  private reactPitch = 0;
  private reactRoll = 0;
  private reactYaw = 0;
  private reactLift = 0;
  private cinematicYOffset = 0;
  private cinematicTargetY = 0;
  private readonly flashWhite = new THREE.Color(0xffffff);
  private readonly vulnColor = new THREE.Color(0xffd86b);
  private readonly emissiveScratch = new THREE.Color();

  readonly root = new THREE.Group();
  protected heading = 0;
  protected kb = new THREE.Vector2();
  protected hitFlash = 0;
  protected flashMats: FlashMat[] = [];
  // Stepping legs (IDEAS-GRAPHICS #37): bipedal foes register a left/right hip-pivot
  // group and the base gait driver swings them to actual ground speed — no sliding feet.
  protected legL: THREE.Object3D | null = null;
  protected legR: THREE.Object3D | null = null;
  private gaitPhase = 0;
  private gaitAmt = 0;
  private gaitPrevX = NaN;
  private gaitPrevZ = NaN;
  protected t = 0; // seeded AI sine-timer phase — set in the ctor (a base-class field
  // initializer runs before `ctx` is assigned, so ctx.rng isn't available here yet)
  private combatGuard = false;
  private cinematicProtection = false;
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
    this.root.userData.solidity = "mover"; // collision-truth audit: movers are exempt
    this.t = ctx.rng.next() * 10; // seeded AI phase (see field decl)
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
    // Pale, whitish accents (wisp, warper, echo…) wash out into a dirty gray pool —
    // clamp a minimum saturation so the glow stays in the unit's color family.
    const hsl = { h: 0, s: 0, l: 0 };
    color.getHSL(hsl);
    if (hsl.s < 0.55) color.setHSL(hsl.h, 0.55, Math.min(hsl.l, 0.6));
    const { tex, geo } = groundGlowAssets();
    const mat = new THREE.MeshBasicMaterial({
      map: tex, color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const m = new THREE.Mesh(geo, mat);
    // Bosses get a wider, more menacing pool than rank-and-file enemies.
    const s = this.kind === "boss" ? Math.max(3.8, this.radius * 3.1) : Math.max(1.2, this.radius * 2.6);
    m.scale.set(s, s, s);
    m.renderOrder = -1;
    m.userData.solidity = "fx";
    this.ctx.stage.scene.add(m);
    this.groundGlow = m;
  }

  /** Dynamic shadow maps are reserved for the boss and a tiny foreground cast.
   * Every other enemy retains its inexpensive contact shadow. */
  setShadowCasting(on: boolean): void {
    this.root.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = on && o.userData.castShadow !== false; });
  }

  protected registerFlash(mat: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
    this.flashMats.push({ mat, baseEmissive: mat.emissive.clone(), baseIntensity: mat.emissiveIntensity });
    return mat;
  }

  protected stdMat(color: number, emissive = 0x000000, intensity = 0): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      color, emissive, emissiveIntensity: intensity * 0.8, roughness: 0.48, metalness: 0.3,
    });
    applyRim(mat, undefined, 2.8, 0.16);
    return this.registerFlash(mat);
  }

  protected addMesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = this.root): THREE.Mesh {
    if (geo instanceof THREE.BoxGeometry) {
      const { width, height, depth } = geo.parameters;
      if (Math.min(width, height, depth) >= 0.09) {
        const rounded = beveledBox(width, height, depth);
        geo.dispose();
        geo = rounded;
      }
    }
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  /** Bake direct, non-animated body pieces that share a material into one mesh.
   * Animated limbs/cores are either nested under their own pivots or explicitly excluded. */
  protected mergeStaticRootMeshes(exclude: readonly THREE.Object3D[] = []): void {
    this.mergeStaticGroupMeshes(this.root, exclude);
  }

  private mergeStaticGroupMeshes(parent: THREE.Object3D, exclude: readonly THREE.Object3D[] = []): void {
    const byMaterial = new Map<THREE.Material, THREE.Mesh[]>();
    for (const child of parent.children) {
      if (!(child instanceof THREE.Mesh) || child instanceof THREE.InstancedMesh || child.children.length > 0 || exclude.includes(child) || Array.isArray(child.material)) continue;
      const list = byMaterial.get(child.material) ?? [];
      list.push(child);
      byMaterial.set(child.material, list);
    }
    for (const [material, meshes] of byMaterial) {
      if (meshes.length < 2) continue;
      const baked: THREE.BufferGeometry[] = [];
      for (const mesh of meshes) {
        mesh.updateMatrix();
        // Primitive geometry is a mix of indexed and non-indexed buffers. Normalize
        // before merging so a decorative cone cannot invalidate the whole batch.
        const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
        geo.applyMatrix4(mesh.matrix);
        baked.push(geo);
      }
      const merged = mergeGeometries(baked, false);
      for (const geo of baked) geo.dispose();
      if (!merged) continue;
      const body = new THREE.Mesh(merged, material);
      body.castShadow = true;
      parent.add(body);
      for (const mesh of meshes) {
        parent.remove(mesh);
        mesh.geometry.dispose();
      }
    }
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

  /** Cutscene arrival: land with an overshoot that settles back to base scale. */
  arrivalPop(): void { this.bossScaleCur = this.bossScale * 1.35; }

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
    this.impactHold = heavy ? 0.045 : 0.025;
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
    // A committed combat guard can be shattered. Cinematic protection cannot.
    if (this.guardBreakable && (opts.attackFamily === "charged-heavy" || opts.attackFamily === "crash")) {
      this.interruptAttack();
      this.onGuardBroken();
      this.applyVulnerable(1.35, 1.35);
      this.ctx.tempo.gain(8);
      this.ctx.floaters.spawn(this.pos.x, this.barHeight(), this.pos.z, "GUARD BREAK", "shieldbreak");
      this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: this.radius + 1.4, color: 0xe8c68e, duration: 0.28 });
      this.ctx.fx.burst({ x: this.pos.x, y: 1.4, z: this.pos.z, count: 14, color: [0xe8c68e, this.wardColor], speed: [3, 8], up: 0.5, size: [0.07, 0.22], life: [0.2, 0.45], gravity: -6, drag: 3, shape: ParticleShape.shard });
      this.ctx.cam.addTrauma(0.2);
      this.ctx.sfx.shieldHit();
    }
    if (this.warded) {
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
    if (this.kind !== "boss" && opts.heavy && kbStrength >= 8) this.wallSlamWindow = 0.45;
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
    this.frozen = Math.max(this.frozen, this.kind === "boss" ? Math.min(0.7, duration * 0.25) : duration);
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
  /** Combat protection belongs to the attack, so freeze cannot outlast its ward. */
  protected raiseGuard(): void { this.combatGuard = true; }
  get guardBreakable(): boolean { return this.combatGuard && !this.cinematicProtection; }
  get warded(): boolean {
    return this.combatGuard || this.cinematicProtection;
  }
  holdCinematic(): void { this.cinematicProtection = true; }

  /** Boss subclasses clear their queued attacks here when a phase or guard breaks. */
  interruptAttack(): void {
    this.cancelWarnings();
    this.combatGuard = false;
  }
  protected onGuardBroken(): void {}

  /** Hold an enemy's brain still after materialization without showing freeze/stagger FX. */
  setSpawnGrace(seconds: number): void {
    this.spawnGrace = Math.max(this.spawnGrace, seconds);
  }

  /** Cinematic handoff: the reveal itself has already supplied the safety window. */
  releaseSpawnGrace(): void {
    this.spawnGrace = 0;
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
    if (!this.warded && !this.wardRing) return;
    if (!this.wardRing) {
      const geo = new THREE.TorusGeometry(1, 0.06, 8, 32);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({ color: this.wardColor, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      this.wardRing = new THREE.Mesh(geo, mat);
      this.wardRing.userData.solidity = "fx";
      this.root.add(this.wardRing);
    }
    const mat = this.wardRing.material as THREE.MeshBasicMaterial;
    if (this.warded) {
      this.wardRing.visible = true;
      const s = this.radius * 1.9;
      this.wardRing.scale.set(s, s, s);
      this.wardRing.position.y = 1.4 + Math.sin(this.t * 5) * 0.15;
      this.wardRing.rotation.y += dt * 2;
      mat.color.setHex(this.guardBreakable ? 0xe8c68e : this.wardColor);
      mat.opacity = 0.55;
    } else {
      this.wardRing.visible = false;
    }
  }

  /**
   * A close-range punish shockwave centered on the boss — discourages hugging.
   * Bosses fire this (usually under a ward) when their guard telegraph completes.
   */
  protected wardShock(radius: number, dmg: number, color: number): void {
    this.combatGuard = false;
    this.ctx.fx.ring(this.pos.x, this.pos.z, { radius, color, duration: 0.5 });
    this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: radius * 0.5, color: 0xffffff, duration: 0.32 });
    this.ctx.fx.burst({ x: this.pos.x, y: 0.6, z: this.pos.z, count: 16, color: [color, 0xe8dcc5], speed: [4, 11], up: 0.7, size: [0.08, 0.25], life: [0.2, 0.55], gravity: -5, drag: 2.2, shape: ParticleShape.shard });
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

  /** The remains keep a full warning window; killing an elite never causes an instant hit. */
  private volatileBurst(): void {
    this.ctx.enemies.warnDeathBurst(this.pos.x, this.pos.z, `enemy:${this.id}`, this.kind);
  }

  /** Damage-free knockback along (x, z) — pulls when pointed inward. Bosses shrug it off. */
  shove(x: number, z: number, strength: number): void {
    if (this.kind === "boss") return;
    const len = Math.hypot(x, z) || 1;
    this.kb.x += (x / len) * strength;
    this.kb.y += (z / len) * strength;
  }

  die(): void {
    if (this.seam) this.seam.visible = false;
    if (!this.alive) return;
    this.deathDuration = this.kind === "boss" ? 2.6 : 0.58;
    this.deathT = this.deathDuration;
    this.deathScale.copy(this.root.scale);
    this.alive = false;
    this.warningClock.alive = false;
    if (this.wardRing) this.wardRing.visible = false;
    if (this.affixes.includes("volatile")) this.volatileBurst();
    this.onDeath();
    this.ctx.events.emit("KILL", { x: this.pos.x, z: this.pos.z, kind: this.kind });
    const c = this.deathColor();
    this.ctx.fx.directionalBurst({
      x: this.pos.x, y: 0.55, z: this.pos.z, count: this.kind === "boss" ? 12 : 18,
      color: [c, 0xffffff, 0x241116], dirX: Math.sin(this.heading), dirY: 0.45, dirZ: Math.cos(this.heading),
      spread: 1.35, speed: [2.5, 9], size: [0.18, 0.58], life: [0.35, 0.9], gravity: -7, drag: 3,
      shape: [ParticleShape.shard, ParticleShape.streak],
    });
    this.ctx.decals.crack(this.pos.x, this.pos.z, Math.max(0.65, this.radius * 1.2));
    this.ctx.enemies.addDying(this);
  }

  /** Fracture aftermath. The collider and AI are already gone; only the authored
   * body collapse remains for a few frames before resources are reclaimed. */
  updateDeath(dt: number): boolean {
    this.deathT = Math.max(0, this.deathT - dt);
    const k = 1 - this.deathT / this.deathDuration;
    const fall = Math.min(1, k / 0.72);
    const settle = fall * fall * (3 - 2 * fall);
    const dissolve = Math.max(0, (k - 0.72) / 0.28);
    this.root.position.set(this.pos.x, this.pos.y - dissolve * 0.2, this.pos.z);
    // Dead actors no longer run the normal flash update. Clear frozen/white hit
    // materials here, then let their actual joints perform the final action.
    for (const f of this.flashMats) {
      f.mat.emissive.copy(f.baseEmissive);
      f.mat.emissiveIntensity = f.baseIntensity * (1 - k) ** 2;
    }
    if (!this.animateDeath(dt, k)) {
      this.root.rotation.x = -settle * 1.48;
      this.root.rotation.z = Math.sin(this.id * 2.17) * settle * 0.2;
    }
    this.root.scale.copy(this.deathScale).multiplyScalar(Math.max(0.02, 1 - dissolve));
    if (this.groundGlow) (this.groundGlow.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.24;
    if (this.deathT > 0) return false;
    this.dispose();
    return true;
  }

  protected onDeath(): void {}

  /** Override for rig-specific collapse; the base owns lifetime and disposal. */
  protected animateDeath(_dt: number, _progress: number): boolean { return false; }

  protected settleDeathPart(part: THREE.Object3D, dt: number, x: number, y: number, z: number): void {
    const k = 1 - Math.exp(-dt * 7);
    part.rotation.x += (x - part.rotation.x) * k;
    part.rotation.y += (y - part.rotation.y) * k;
    part.rotation.z += (z - part.rotation.z) * k;
  }

  protected deathColor(): number {
    return 0xff6644;
  }

  dispose(): void {
    this.warningClock.alive = false;
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

  /** Presentation/QA identity for authored boss actions; field enemies return null. */
  debugMove(): string | null {
    return null;
  }

  debugForceMove(move: string): boolean {
    void move;
    return false;
  }

  private cinematicParts: { node: THREE.Object3D; rest: THREE.Euler }[] = [];
  private cinematicStyle: "arms" | "orbit" | "mantle" = "arms";
  private cinematicAction = "";
  private cinematicTime = 0;
  private cinematicRest: { node: THREE.Object3D; position: THREE.Vector3; rotation: THREE.Euler; scale: THREE.Vector3 }[] = [];

  /** A boss can author its own performance using its actual joints. */
  protected animateCinematic(_action: string, _time: number, _dt: number): boolean { return false; }
  protected restoreCinematicPose(): void {}

  protected bindCinematicParts(parts: THREE.Object3D[], style: "arms" | "orbit" | "mantle" = "arms"): void {
    this.cinematicParts = parts.map(node => ({ node, rest: node.rotation.clone() }));
    this.cinematicStyle = style;
  }

  /** Pose the actual articulated rig, independently of the frozen combat brain. */
  performCinematic(action: Exclude<Extract<CinematicBeat,{type:"boss-action"}>["action"],"gate">): void {
    if (!this.cinematicAction) this.cinematicRest = this.cinematicParts.map(({node})=>({node,position:node.position.clone(),rotation:node.rotation.clone(),scale:node.scale.clone()}));
    this.root.visible = true;
    this.cinematicAction = action;
    this.cinematicTime = 0;
    if (action === "drop") {
      this.cinematicYOffset = 7;
      this.cinematicTargetY = 0;
    } else if (action === "land") {
      this.cinematicYOffset = this.cinematicTargetY = 0;
      this.arrivalPop();
    }
  }

  private updateCinematicPose(dt: number): void {
    if (!this.cinematicAction) return;
    this.cinematicTime += dt;
    if (this.animateCinematic(this.cinematicAction, this.cinematicTime, dt)) return;
    const k = Math.min(1, this.cinematicTime / 0.7);
    const ease = k * k * (3 - 2 * k);
    const landing = this.cinematicAction === "land";
    const drag = this.cinematicAction === "drag";
    const falling = this.cinematicAction === "drop";
    const open = landing ? 0.25 * (1 - ease) : falling ? 0.35 : drag ? 0.35 + 0.25 * ease : ease;
    this.poseRear = landing ? 0.2 * (1 - ease) : -0.06 * open;
    this.poseLunge = drag ? 0.12 : 0;
    this.poseRise = 0;
    this.poseSwell = 0;
    this.cinematicParts.forEach(({ node, rest }, i) => {
      const side = i % 2 ? 1 : -1;
      if (this.cinematicStyle === "arms") {
        const roar = this.cinematicAction === "roar" || this.cinematicAction === "last-stand";
        node.rotation.set(rest.x - open * (drag && i % 2 ? 0.3 : roar ? 1.15 : 2.05), rest.y + side * open * 0.18, rest.z + side * open * (roar ? 0.9 : 0.38));
      } else if (this.cinematicStyle === "orbit") {
        node.rotation.set(rest.x + side * open * 0.38, rest.y + this.cinematicTime * (0.18 + i * 0.035), rest.z + open * 0.22);
      } else {
        node.rotation.set(rest.x - open * 0.24, rest.y, rest.z + side * open * 0.26);
      }
    });
  }

  finishCinematic(): void {
    this.cinematicProtection = false;
    this.root.visible = true;
    this.cinematicAction = "";
    for (const pose of this.cinematicRest) {
      pose.node.position.copy(pose.position);pose.node.rotation.copy(pose.rotation);pose.node.scale.copy(pose.scale);
    }
    this.cinematicRest.length=0;
    this.restoreCinematicPose();
    this.cinematicYOffset = this.cinematicTargetY = 0;
    this.poseRear = this.poseLunge = this.poseRise = this.poseSwell = 0;
    this.releaseSpawnGrace();
  }

  update(dt: number, simulate = true): void {
    if (!this.alive) return;
    if (simulate) this.t += dt;
    this.cinematicYOffset += (this.cinematicTargetY - this.cinematicYOffset) * Math.min(1, dt * (this.cinematicTargetY === 0 ? 13 : 8));
    if (simulate) {
      this.unravel.update(dt);
      if (this.impactHold > 0) this.impactHold = Math.max(0, this.impactHold - dt);
      else this.reactT = Math.max(0, this.reactT - dt);
      if (this.vulnTime > 0) this.vulnTime -= dt;
      if (this.deflectCd > 0) this.deflectCd -= dt;
      if (this.warded || this.wardRing) this.updateWard(dt);
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
          f.mat.emissiveIntensity = 1.0;
        }
      } else {
        // Let each enemy author its charge glow before adding the hit reaction.
        // Restoring the resting palette after tick erased the visible wind-up.
        for (const f of this.flashMats) {
          f.mat.emissive.copy(f.baseEmissive);
          f.mat.emissiveIntensity = f.baseIntensity;
        }
        // Arrival grace follows game time, including pauses.
        if (this.spawnGrace > 0) this.spawnGrace = Math.max(0, this.spawnGrace - dt);
        // Spawn grace/stagger interrupt the brain (no blue tint) but the body still flashes/settles.
        if (this.stagger <= 0 && this.spawnGrace <= 0) {
          this.warningClock.time += dt;
          this.tick(dt);
        }
        // Hit flash: spike emissive to white, settle back
        this.hitFlash = Math.max(0, this.hitFlash - dt * 7);
        const vulnGlow = this.vulnTime > 0 ? 0.36 : 0;
        for (const f of this.flashMats) {
          this.emissiveScratch.copy(f.mat.emissive);
          if (vulnGlow > 0) this.emissiveScratch.lerp(this.vulnColor, vulnGlow);
          // Keep the actor's material identity through a hit. The pooled ImpactCue
          // already owns the tiny white contact core; whitening every enemy material
          // at once turned readable directional reactions into a featureless cutout.
          const localFlash = this.hitFlash * 0.58;
          f.mat.emissive.copy(this.emissiveScratch).lerp(this.flashWhite, localFlash);
          f.mat.emissiveIntensity = Math.min(2.4, f.mat.emissiveIntensity + this.hitFlash * 0.9);
        }
      }

      // Knockback decay
      this.wallSlamWindow = Math.max(0, this.wallSlamWindow - dt);
      const impactSpeed = this.kb.length();
      this.pos.x += this.kb.x * dt;
      this.pos.z += this.kb.y * dt;
      this.kb.multiplyScalar(Math.exp(-6 * dt));
      const unblockedX = this.pos.x, unblockedZ = this.pos.z;

      // Bounds
      const r = Math.hypot(this.pos.x, this.pos.z);
      const maxR = ARENA_RADIUS - this.radius;
      if (r > maxR) {
        this.pos.x *= maxR / r;
        this.pos.z *= maxR / r;
      }
      // Pillars block everything smaller than a boss (airborne leaps excluded)
      if (this.kind !== "boss" && this.pos.y < 1) {
        this.ctx.arena.resolveObstacles(this.pos, this.radius);
      }
      if (this.wallSlamWindow > 0 && impactSpeed > 3 && Math.hypot(this.pos.x-unblockedX,this.pos.z-unblockedZ) > 0.015) {
        this.wallSlamWindow = 0;
        this.kb.set(0,0);
        this.stagger = Math.max(this.stagger,0.45);
        this.ctx.combat.dealDamage(this,10,{noDetonate:true});
        this.ctx.floaters.spawn(this.pos.x,2.1,this.pos.z,"WALL BREAK","crit");
        this.ctx.fx.burst({x:this.pos.x,y:0.75,z:this.pos.z,count:9,color:[0xc3b08c,0x827c70],speed:[2,6],up:0.6,size:[0.07,0.2],life:[0.18,0.4],gravity:-7,drag:3,shape:ParticleShape.shard});
        this.ctx.cam.addTrauma(0.12);
        if (!this.alive) return;
      }

    }

    // Stepping gait: advance the walk phase by ACTUAL ground distance moved so the
    // registered legs swing in lockstep with displacement — feet never slide. The
    // amplitude eases in with speed so a standing foe's legs settle straight.
    if (this.legL && this.legR) {
      const moved = Number.isNaN(this.gaitPrevX) ? 0 : Math.hypot(this.pos.x - this.gaitPrevX, this.pos.z - this.gaitPrevZ);
      const spd = Math.min(dt > 0 ? moved / dt : 0, this.speed * 2);
      this.gaitAmt += (Math.min(1, spd / Math.max(0.5, this.speed)) - this.gaitAmt) * Math.min(1, dt * 10);
      this.gaitPhase += moved * 3.0; // one stride per ~2 units — locked to the ground
      const sw = Math.sin(this.gaitPhase) * 0.62 * this.gaitAmt;
      this.legL.rotation.x = sw;
      this.legR.rotation.x = -sw;
    }
    this.gaitPrevX = this.pos.x;
    this.gaitPrevZ = this.pos.z;

    // Dramatic geometry eruption (phase reveals): overshoot scale-in.
    if (this.eruptT > 0) {
      this.eruptT = Math.max(0, this.eruptT - dt);
      const k = 1 - this.eruptT / this.eruptDur;            // 0 → 1
      const c = 1.9;                                        // easeOutBack overshoot
      const ease = Math.max(0.0001, 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2));
      for (const e of this.eruptList) e.o.scale.copy(e.s).multiplyScalar(ease);
      if (this.eruptT === 0) this.eruptList.length = 0;
    }

    this.updateCinematicPose(dt);
    const reactK = this.impactHold > 0 ? 0.5 : this.reactDur > 0 ? this.reactT / this.reactDur : 0;
    const reactEase = Math.sin(Math.max(0, Math.min(1, reactK)) * Math.PI);
    this.root.position.set(this.pos.x, this.pos.y + this.cinematicYOffset + this.reactLift * reactEase + this.poseRise, this.pos.z);
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
      this.groundGlow.position.set(this.pos.x, 0.03, this.pos.z);
      const gm = this.groundGlow.material as THREE.MeshBasicMaterial;
      const glowBase = 0.045;
      gm.opacity = (this.frozen > 0 ? 0.06 : glowBase) + this.hitFlash * 0.14;
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
          y: 0.2 + Math.random() * 0.5, // cosmetic: fx/jitter — NOT sim state (must stay off ctx.rng)
          z: this.pos.z + Math.cos(ang * 1.3) * this.radius * 1.4,
          count: 1, color: this.wardColor,
          speed: [0.2, 0.9], up: 1.4, vertical: 0.5, size: [0.18, 0.42],
          life: [0.7, 1.4], gravity: 0.25, drag: 1.1, jitter: 0.6,
        });
      }
    }

    // A split ivory diamond is a gameplay opening, distinct from red attack warnings.
    if (this.unravel.exposed > 0 && !this.seam) {
      this.seam = new THREE.Group();
      for (const side of [-1, 1]) {
        const mat = new THREE.MeshBasicMaterial({ color: 0xffe0a3, transparent: true, depthWrite: false, depthTest: false });
        const slash = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.48, 0.045), mat);
        slash.position.x = side * 0.13;
        slash.rotation.z = side * -0.42;
        slash.renderOrder = 40;
        this.seam.add(slash);
      }
      this.root.add(this.seam);
    }
    if (this.seam) {
      this.seam.visible = this.unravel.exposed > 0;
      this.seam.position.set(0, this.barHeight() + 0.48, 0);
      this.seam.quaternion.copy(this.root.quaternion).invert().multiply(this.ctx.stage.camera.quaternion);
      this.seam.scale.setScalar(0.8 + Math.min(1, this.unravel.exposed) * 0.2);
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
      const sp = this.speed * speedScale * this.affixSpeedMult * (this.kind === "boss" ? 1 : this.ctx.difficulty.enemySpeedMult);
      const target = pursuitTarget(this.pos.x, this.pos.z, tx, tz, this.radius, this.ctx.arena.obstacles, this.id % 2 ? 1 : -1);
      this.ctx.arena.boundary?.resolve(target,this.radius+.1);
      const sx = target.x - this.pos.x, sz = target.z - this.pos.z;
      const steerDistance = Math.hypot(sx, sz) || 1;
      const step = Math.min(d, sp * dt);
      this.pos.x += (sx / steerDistance) * step;
      this.pos.z += (sz / steerDistance) * step;
      this.heading = dampAngle(this.heading, Math.atan2(sx, sz), 8, dt);
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

}

// ---------------------------------------------------------------- Husk
/** Melee chaser. Telegraphed lunge bite. The bread-and-butter threat. */
export class Husk extends Enemy {
  readonly kind: EnemyKind = "husk";
  private state: "chase" | "windup" | "lunge" | "recover" = "chase";
  private timer = 0;
  private lungeDir = new THREE.Vector2();
  private struck = false;
  private lungeLeft = 0;
  override get anchored(): boolean { return this.state === "windup" || this.state === "lunge"; }
  private eyeMat: THREE.MeshStandardMaterial;

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 30;
    this.speed = 3.4;
    this.radius = 0.55;
    const rig = forgeHusk(this.root, (color, emissive, intensity) => this.stdMat(color, emissive, intensity));
    this.eyeMat = rig.eyeMat; this.legL = rig.legL; this.legR = rig.legR;
  }

  protected deathColor(): number {
    return 0xff4422;
  }

  protected tick(dt: number): void {
    const p = this.ctx.player;
    this.timer -= dt;
    this.pos.y = 0;
    this.drivePose(dt,
      this.state === "windup" ? { rear: 0.18, rise: -0.04, swell: 0.04 }
        : this.state === "lunge" ? { lunge: 0.31, rise: 0.03 }
          : this.state === "recover" ? { rear: 0.1, rise: -0.03 } : {},
      12);

    switch (this.state) {
      case "chase": {
        const d = this.seek(p.pos.x, p.pos.z, dt);
        if (d < 2.4 && this.commitMelee(.82)) {
          this.state = "windup";
          this.timer = 0.45;
          this.struck = false;
          const dx = p.pos.x - this.pos.x;
          const dz = p.pos.z - this.pos.z;
          const len = Math.hypot(dx, dz) || 1;
          this.lungeDir.set(dx / len, dz / len);
          this.warnLine(this.pos.x, this.pos.z, Math.atan2(this.lungeDir.x, this.lungeDir.y), 3.25, 2, 0.45);
          this.eyeMat.emissiveIntensity = 1.7;
        }
        break;
      }
      case "windup":
        this.kb.set(0, 0);
        this.heading = Math.atan2(this.lungeDir.x, this.lungeDir.y);
        if (this.timer <= 0) {
          this.state = "lunge";
          this.timer = 0.22;
          this.lungeLeft = 2.25;
          this.ctx.sfx.enemyLunge();
        }
        break;
      case "lunge": {
        this.kb.set(0, 0);
        const distance = Math.min(this.lungeLeft, dt * 12);
        const steps = Math.max(1, Math.ceil(distance / 0.2)), step = distance / steps;
        for (let i = 0; i < steps; i++) {
          const oldX = this.pos.x, oldZ = this.pos.z;
          this.pos.x += this.lungeDir.x * step; this.pos.z += this.lungeDir.y * step;
          const radius = Math.hypot(this.pos.x, this.pos.z), limit = ARENA_RADIUS - this.radius;
          if (radius > limit) { this.pos.x *= limit / radius; this.pos.z *= limit / radius; }
          this.ctx.arena.resolveObstacles(this.pos, this.radius);
          const dx = this.pos.x - oldX, dz = this.pos.z - oldZ, lengthSq = dx * dx + dz * dz;
          const along = lengthSq > 0 ? Math.max(0, Math.min(1, ((p.pos.x - oldX) * dx + (p.pos.z - oldZ) * dz) / lengthSq)) : 0;
          const hitDistance = Math.hypot(p.pos.x - oldX - dx * along, p.pos.z - oldZ - dz * along);
          if (!this.struck && hitDistance < this.radius + p.radius + 0.45
            && !this.ctx.arena.blocksSegment(this.pos.x, this.pos.z, p.pos.x, p.pos.z)) {
            this.struck = true;
            this.ctx.combat.damagePlayer(12, this.pos.x, this.pos.z, {
              sourceId: `enemy:${this.id}`, sourceKind: this.kind, attackFamily: "husk-lunge",
            });
          }
          this.lungeLeft -= step;
          if (dx * this.lungeDir.x + dz * this.lungeDir.y < step * 0.8) { this.lungeLeft = 0; break; }
        }
        if (this.timer <= 0 || this.lungeLeft <= 0.001) {
          this.state = "recover";
          this.timer = 0.75;
          this.eyeMat.emissiveIntensity = 1.1;
        }
        break;
      }
      case "recover":
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
  private lockedAngle = 0; // aim locked + telegraphed at windup start, fired along it
  private orb: THREE.Mesh;
  private orbMat: THREE.MeshStandardMaterial;
  private strafeDir = this.ctx.rng.next() < 0.5 ? 1 : -1;
  private recoil = 0;

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 22;
    this.speed = 2.6;
    this.radius = 0.5;
    const rig = forgeSpitter(this.root, (color, emissive, intensity) => this.stdMat(color, emissive, intensity));
    this.orb = rig.orb; this.orbMat = rig.orbMat;
  }

  protected deathColor(): number {
    return 0xff6a54;
  }

  protected tick(dt: number): void {
    const p = this.ctx.player;
    const d = this.distToPlayer();
    this.facePlayer(dt);
    this.recoil = Math.max(0, this.recoil - dt);
    this.drivePose(dt, this.recoil > 0 ? { rear: 0.24, rise: 0.04 } : this.windup >= 0 ? { rear: 0.11, swell: 0.07 } : {}, 14);
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
        if (this.ctx.rng.next() < dt * 0.2) this.strafeDir *= -1;
      }
      this.fireTimer -= dt;
      if (this.fireTimer <= 0 && d < 16) {
        this.windup = 0.38;
        this.fireTimer = 2.3;
        // Lock the shot angle NOW and draw the lane so the player can read + dodge it
        // (fairness contract — every enemy attack telegraphs), like Wisp/Tether do.
        this.lockedAngle = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
        this.warnLine(this.pos.x, this.pos.z, this.lockedAngle, 16, 0.5, 0.38, 0xff6a54);
      }
    } else {
      this.windup -= dt;
      this.orbMat.emissiveIntensity = 2.2 + (0.38 - this.windup) * 9;
      this.orb.scale.setScalar(1 + (0.38 - this.windup) * 1.6);
      if (this.windup <= 0) {
        this.windup = -1;
        this.orbMat.emissiveIntensity = 2.2;
        this.orb.scale.setScalar(1);
        // Fire along the LOCKED angle (matches the telegraphed lane), not a fresh recompute.
        this.ctx.hostiles.fire(this.pos.x, this.pos.z, this.lockedAngle, {
          speed: 9, dmg: 8, color: 0xff6a54, radius: 0.3,
          sourceId: `enemy:${this.id}`, sourceKind: this.kind, attackFamily: "spitter-bolt",
        });
        this.recoil = 0.18;
        this.ctx.sfx.enemyShoot();
      }
    }
  }
}

// ---------------------------------------------------------------- Swarmer
/** Tiny, fast, jittery. Dangerous in packs, dies to anything. */
export class Swarmer extends Enemy {
  readonly kind: EnemyKind = "swarmer";
  private phase = this.ctx.rng.next() * TAU;
  private skitterLegs: THREE.Group[] = [];
  private biteTime = -1;
  private biteCooldown = 0;
  override get anchored(): boolean { return this.biteTime >= 0; }

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 12;
    this.speed = 5.4;
    this.radius = 0.35;
    this.skitterLegs = forgeSwarmer(this.root, (color, emissive, intensity) => this.stdMat(color, emissive, intensity));
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
    this.biteCooldown = Math.max(0, this.biteCooldown - dt);
    if (this.biteTime >= 0) {
      this.kb.set(0, 0);
      this.biteTime -= dt;
      if (this.biteTime <= 0) {
        this.biteTime = -1;
        this.biteCooldown = .95;
        this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: .85, color: 0xd99669, duration: .16 });
        if (this.distToPlayer() < .85 + p.radius && !this.ctx.arena.blocksSegment(this.pos.x, this.pos.z, p.pos.x, p.pos.z)) {
          this.ctx.combat.damagePlayer(6, this.pos.x, this.pos.z, { sourceId: `enemy:${this.id}`, sourceKind: this.kind, attackFamily: "swarmer-bite" });
        }
      }
    } else if (d < 1.3 && this.biteCooldown <= 0 && this.commitMelee(.5)) {
      this.biteTime = .36;
      this.warnCircle(this.pos.x, this.pos.z, .85, .36, 0xff7755);
      this.facePlayer(dt * 4);
    } else if (d > 1.15) this.seek(tx, tz, dt, this.biteCooldown > .65 ? .4 : 1);
    this.pos.y = 0;
    this.drivePose(dt, this.biteTime >= 0 ? { rear: .27, rise: .05 } : this.biteCooldown > .72 ? { lunge: .2 } : {}, 18);
    for (let i=0;i<this.skitterLegs.length;i++) {
      const side=i<3?-1:1,phase=this.t*(this.biteTime>=0?3:18)+(i%3)*2.1+(side>0?Math.PI:0);
      this.skitterLegs[i].rotation.y=Math.sin(phase)*.24;
      this.skitterLegs[i].rotation.z=side*Math.max(0,Math.cos(phase))*.25;
    }
  }
}

// ---------------------------------------------------------------- Bomber
/** Sprints in, plants a charge, then detonates. Kill it during the fuse to disarm it. */
export class Bomber extends Enemy {
  readonly kind: EnemyKind = "bomber";
  private fuse = -1;
  private coreMat: THREE.MeshStandardMaterial;
  private exploded = false;
  override get anchored(): boolean { return this.fuse >= 0; }

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 18;
    this.speed = 4.3;
    this.radius = 0.5;
    const rig = forgeBomber(this.root, (color, emissive, intensity) => this.stdMat(color, emissive, intensity));
    this.coreMat = rig.coreMat; this.legL = rig.legL; this.legR = rig.legR;
  }

  protected deathColor(): number {
    return 0xff8800;
  }

  protected onDeath(): void {
    if (this.fuse >= 0 && !this.exploded) {
      this.ctx.floaters.spawn(this.pos.x, 1.4, this.pos.z, "DISARMED", "tempo");
      this.ctx.tempo.gain(4);
    }
  }

  private explode(): void {
    if (this.exploded) return;
    this.exploded = true;
    const R = 3.6;
    this.ctx.events.emit("EXPLOSION", { x: this.pos.x, z: this.pos.z, radius: R });
    this.ctx.fx.burst({
      x: this.pos.x, y: 0.7, z: this.pos.z,
      count: 26, color: [0xff9a55, 0xdfb175, 0x80634c],
      speed: [4, 12], up: 0.8, size: [0.15, 0.5], life: [0.22, 0.6], gravity: -7, drag: 2.2,
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
      this.pos.y = 0;
      if (d < 3.0 && this.commitMelee(1.05)) {
        this.fuse = 0.95;
        this.warnCircle(this.pos.x, this.pos.z, 3.6, 0.95, 0xff8822);
        this.ctx.sfx.fuse();
      }
    } else {
      this.fuse -= dt;
      // Plant the lit charge: its explosion must match the warning drawn at ignition.
      this.kb.set(0, 0);
      const k = 1 - Math.max(0, this.fuse) / 0.95;
      // Charge brightness climbs monotonically. The former frequency ramp reached
      // strobe territory and made this actor appear to share the world's flicker.
      this.coreMat.emissiveIntensity = 1.3 + k;
      this.drivePose(dt, { rear: 0.08 * k, rise: -0.035 * k }, 12);
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
  private recoil = 0;

  constructor(ctx: Ctx, x: number, z: number) {
    super(ctx, x, z);
    this.hp = this.maxHp = 60;
    this.speed = 1.7;
    this.radius = 0.7;
    const rig = forgeGuardian(this.root, (color, emissive, intensity) => this.stdMat(color, emissive, intensity), "sentinel");
    this.tipMat = rig.eyeMat;
    this.legL = rig.legL;
    this.legR = rig.legR;

    this.beamMat = new THREE.MeshBasicMaterial({
      color: 0xff5f48, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.beamMesh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 1), this.beamMat);
    this.beamMesh.visible = false;
    this.beamMesh.userData.solidity = "fx";
    ctx.stage.scene.add(this.beamMesh);
    this.mergeStaticRootMeshes();
  }

  protected deathColor(): number {
    return 0xff5f48;
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
      this.cancelWarnings();
      this.aiming = -1;
      this.tipMat.emissiveIntensity = 1.1;
      this.cycle = Math.max(this.cycle, 1.5);
    }
  }

  protected tick(dt: number): void {
    const p = this.ctx.player;
    this.beamFade = Math.max(0, this.beamFade - dt * 5);
    this.beamMat.opacity = this.beamFade;
    this.beamMesh.visible = this.beamFade > 0;
    this.recoil = Math.max(0, this.recoil - dt);
    this.drivePose(dt, this.recoil > 0 ? { rear: 0.22, rise: 0.03 } : this.aiming >= 0 ? { rear: 0.08, swell: 0.045 } : {}, 12);

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
      // Track until lock at 0.45s remaining, then the line is committed — dodge it
      if (this.aiming > 0.45) {
        this.facePlayer(dt * 0.6);
        this.lockedAngle = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
      }
      if (prev > 0.45 && this.aiming <= 0.45) {
        // Width matches the real hit window: 0.55 beam half-width + player radius
        this.warnLine(this.pos.x, this.pos.z, this.lockedAngle, 17, 2.0, 0.45, 0xff5f48);
        this.ctx.sfx.beamCharge();
      }
      this.tipMat.emissiveIntensity = 1.1 + (1.25 - this.aiming) * 1.2;
      if (this.aiming <= 0) {
        this.aiming = -1;
        this.tipMat.emissiveIntensity = 1.1;
        this.fireBeam();
        this.recoil = 0.2;
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
        this.ctx.combat.damagePlayer(16, this.pos.x, this.pos.z, {
          sourceId: `enemy:${this.id}`, sourceKind: this.kind, attackFamily: "sentinel-lance",
        });
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
  private meleeGap = 0;

  claimMeleeStart(): boolean {
    if(this.meleeGap>0)return false;
    let active=0;for(const e of this.living())if(e.committingMelee&&++active>=2)return false;
    this.meleeGap=.14;return true;
  }
  private enemies: Enemy[] = [];
  private dying: Enemy[] = [];
  private pending: PendingSpawn[] = [];
  private deathBursts: { x: number; z: number; sourceId: string; sourceKind: string; time: number; revision: number; alive: boolean }[] = [];
  private streakCount = 0;
  private streakTimer = 0;
  // living() is called many times per frame (combat sweeps, ~40 card loops, boss
  // AI, HUD) and used to allocate a fresh filtered array every call — a top GC
  // source in heavy combat. Cache it, rebuilt only when the roster structurally
  // changes (spawn/add/clear) or at each frame boundary. An enemy that dies
  // mid-frame lingers in the cache for the rest of that frame, which is safe:
  // dealDamage no-ops on !alive and shove/steer toward a corpse is harmless.
  private livingCache: Enemy[] = [];
  private livingDirty = true;

  /** Resolution scenes advance corpses without running AI or new attacks. */
  updateRemains(dt: number): void {
    let write = 0;
    for (const enemy of this.dying) {
      if (!enemy.updateDeath(dt)) this.dying[write++] = enemy;
    }
    this.dying.length = write;
  }

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

  /** Separate from the dying actor: its geometry may be reclaimed before detonation. */
  warnDeathBurst(x: number, z: number, sourceId: string, sourceKind: string): void {
    const burst = { x, z, sourceId, sourceKind, time: 0, revision: 0, alive: true };
    this.deathBursts.push(burst);
    this.ctx.tele.circle(x, z, 3.4, .65, 0xff8e59, burst);
    this.ctx.sfx.fuse();
  }

  get lingeringDanger(): boolean { return this.deathBursts.length > 0; }

  private clearDeathBursts(): void {
    for (const burst of this.deathBursts) burst.alive = false;
    this.deathBursts.length = 0;
  }

  private updateDeathBursts(dt: number): void {
    for (let i = this.deathBursts.length - 1; i >= 0; i--) {
      const burst = this.deathBursts[i];
      burst.time += dt;
      if (burst.time < .65) continue;
      burst.alive = false;
      this.deathBursts.splice(i, 1);
      const { x, z } = burst;
      this.ctx.fx.ring(x, z, { radius: 3.4, color: 0xff8e59, duration: .3 });
      this.ctx.fx.burst({ x, y: .5, z, count: 18, color: [0xff8e59, 0xb29472], speed: [3, 9], up: .8, size: [.09, .28], life: [.2, .5], gravity: -7, drag: 3, shape: ParticleShape.shard });
      this.ctx.cam.addTrauma(.16);
      this.ctx.sfx.explosion();
      const p = this.ctx.player;
      if (p.alive && Math.hypot(p.pos.x - x, p.pos.z - z) < 3.4 + p.radius && !this.ctx.arena.blocksSegment(x, z, p.pos.x, p.pos.z)) {
        this.ctx.combat.damagePlayer(12, x, z, { sourceId: burst.sourceId, sourceKind: burst.sourceKind });
      }
    }
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
      if (this.ctx.rng.next() < 0.6) {
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
    this.livingDirty = true;
  }

  living(): Enemy[] {
    if (this.livingDirty) {
      // Refill in place (no new array, no per-call closure) — living() is the hottest
      // accessor in the game (combat/AI/projectiles/HUD/contact-shadows all call it) and
      // update() marks it dirty every frame, so `.filter()` here was the single biggest
      // per-frame allocation source in heavy combat.
      this.livingCache.length = 0;
      for (const e of this.enemies) if (e.alive) this.livingCache.push(e);
      this.livingDirty = false;
    }
    return this.livingCache;
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

  /** Debug/presentation seam: includes short-lived authored death bodies. */
  presenting(): Enemy[] { return [...this.living(), ...this.dying]; }

  addDying(enemy: Enemy): void {
    if (!this.dying.includes(enemy)) this.dying.push(enemy);
  }

  clear(): void {
    this.meleeGap=0;
    this.clearDeathBursts();
    for (const e of this.enemies) if (e.alive) e.dispose();
    for (const e of this.dying) e.dispose();
    this.enemies = [];
    this.dying = [];
    this.pending = [];
    this.ctx.tele.clear();
    this.streakCount = 0;
    this.livingCache.length = 0;
    this.livingDirty = false;
  }

  /** Remove all lesser enemies and cancel lesser pending spawns, preserving the boss. */
  clearNonBosses(): void {
    for (const e of this.enemies) {
      if (e.alive && e.kind !== "boss") e.die();
    }
    // "boss" is also the queue's placeholder for custom elites/champions.
    // Real bosses are added directly; no pending spawn survives a boss defeat.
    this.pending.length = 0;
    this.clearDeathBursts();
    this.livingDirty = true;
  }

  update(dt: number): void {
    this.meleeGap=Math.max(0,this.meleeGap-dt);
    this.updateDeathBursts(dt);
    this.livingDirty = true; // refresh once/frame — clears out last frame's dead
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
        let shadowCasters = 0;
        for (const other of this.enemies) {
          if (other !== e && other.alive && other.kind !== "boss") shadowCasters++;
        }
        e.setShadowCasting(e.kind === "boss" || shadowCasters < 2);
        this.livingDirty = true;
        this.ctx.fx.beam(s.x, s.z, e.kind === "boss" ? 0xff5533 : 0xddddff);
        this.ctx.fx.burst({
          x: s.x, y: 0.4, z: s.z,
          count: 16, color: 0xddddff, speed: [2, 7], up: 1.2, size: [0.3, 0.7], life: [0.25, 0.5], gravity: -6, drag: 3,
        });
        this.ctx.sfx.spawn();
      }
    }

    for (const e of this.enemies) e.update(dt);
    this.updateRemains(dt);
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
        let dx = b.pos.x - a.pos.x;
        let dz = b.pos.z - a.pos.z;
        const min = a.radius + b.radius;
        // Squared-distance early-out: most pairs don't overlap, so skip the sqrt
        // entirely and only take it on the rare actual-overlap case below.
        let d2 = dx * dx + dz * dz;
        if (d2 >= min * min || (a.anchored && b.anchored)) continue;
        if (d2 <= 1e-6) {
          const angle = ((a.id * 31 + b.id * 17) % 360) * Math.PI / 180;
          dx = Math.sin(angle) * 0.001; dz = Math.cos(angle) * 0.001; d2 = 0.000001;
        }
        const d = Math.sqrt(d2);
        const push = (min - d) / d;
        const aShare = a.anchored ? 0 : b.anchored ? 1 : 0.5;
        const bShare = b.anchored ? 0 : a.anchored ? 1 : 0.5;
        a.pos.x -= dx * push * aShare;
        a.pos.z -= dz * push * aShare;
        b.pos.x += dx * push * bShare;
        b.pos.z += dz * push * bShare;
      }
    }
    // Separation happens after each brain: finish within the same physical bounds.
    for (const e of list) {
      if (e.kind !== "boss" && e.pos.y < 1) this.ctx.arena.resolveObstacles(e.pos, e.radius);
      const distance = Math.hypot(e.pos.x, e.pos.z), limit = ARENA_RADIUS - e.radius;
      if (distance > limit) { e.pos.x *= limit / distance; e.pos.z *= limit / distance; }
      e.root.position.x = e.pos.x; e.root.position.z = e.pos.z;
    }
  }
}
