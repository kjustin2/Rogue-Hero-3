import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { clamp, clamp01, damp, dampAngle, ease, TAU } from "../core/math";
import { forgeHero, type HeroRig } from "../render/heroForge";

import { heroById, type HeroDef } from "./heroes";
import { DEFAULT_COSMETICS, cosmeticById } from "./cosmetics";
import type { Ctx } from "./ctx";
import { crashRadius, PERFECT_CRASH_THRESHOLD } from "./tempo";
import type { FootContact } from "../render/contactShadow";

import { sampleBladeMotion } from "../render/bladeMotion";

const HERO_VISUAL_SCALE = 1.2;

const GAIT = { stride: 1.0, bob: 0.04, arm: 0.44, lean: 0.08, rate: 1.0, plant: 1.0 };

/**
 * The hero: stats and a sculpted procedural rig fitted to its equipment palette.
 * Combat/controller drive the
 * animation inputs (move amount, swing phase, dodge phase); this class turns
 * them into pose.
 */
export class Player {
  private readonly attackPose = new Float32Array(14);
  readonly footContacts: FootContact[] = [];
  hp = 100;
  maxHp = 100;
  shield = 0;
  alive = true;
  readonly pos = new THREE.Vector3(0, 0, 0);
  /** Radians, world yaw the hero faces (toward aim). */
  facing = 0;
  radius = 0.5;
  hero: HeroDef = heroById("blade");
  /** Blade energy color — also tints trails, ghosts, and light slash arcs. */
  bladeColor = 0x44ccff;

  readonly root: THREE.Group;
  private body!: THREE.Group;
  private rollGroup!: THREE.Group;
  private armR!: THREE.Group;
  private armL!: THREE.Group;
  private legR!: THREE.Group;
  private legL!: THREE.Group;
  private cape!: THREE.Mesh;
  private rig!: HeroRig;
  /**
   * One low-poly silhouette owns the hero's dynamic shadow. The visible rig is
   * intentionally detailed, but submitting every armor rivet and trim strip to
   * the shadow map cost almost one hundred extra draws in the 22-enemy stress
   * scene. This proxy preserves a moving hero shadow without coupling the
   * simulation or the visible rig to the renderer's shadow budget.
   */
  private shadowProxy!: THREE.Mesh;
  private torso!: THREE.Group;
  private sword!: THREE.Group;
  private bladeTipMarker!: THREE.Object3D;
  private bladeBaseMarker!: THREE.Object3D;
  private visorMat!: THREE.MeshStandardMaterial;
  private auraMat!: THREE.MeshBasicMaterial;
  private auraRing!: THREE.Mesh;
  private auraPhase = 0; // accumulated pulse phase (frequency varies with tempo)
  private auraLight!: THREE.PointLight;
  private armorMats: THREE.MeshStandardMaterial[] = [];
  private armorBase: { mat: THREE.MeshStandardMaterial; emissive: THREE.Color; intensity: number }[] = [];
  private shieldBubble!: THREE.Mesh;
  private shieldMat!: THREE.MeshBasicMaterial;
  private crashRing!: THREE.Group;
  private crashRingMat!: THREE.MeshBasicMaterial;
  private crashFillMat!: THREE.MeshBasicMaterial;
  private wasCrashReady = false;
  /** True while the armor emissive holds a non-zero flash, so we know to run one final reset frame. */
  private armorFlashLit = false;
  /** Last tempo-zone color pushed to the aura/visor materials — skip the per-frame re-set when unchanged. */
  private lastZoneColor = -1;
  private visualHeroId = "";
  private visualCapeId = "";
  private visualBladeId = "";

  // Animation inputs (set by controller/combat each frame)
  animMoveAmount = 0;
  animMoveX = 0;
  animMoveZ = 0;
  animSwing: { phase: number; heavy: boolean; stage?: number } | null = null;
  animDodge: { phase: number; dirX: number; dirZ: number } | null = null;
  animCharge = 0;

  private locoClock = 0;
  private moveBlend = 0;
  private moveSide = 0;
  private moveForward = 0;
  private accelPose = 0;
  private stopPose = 0;
  private lastMoveBlend = 0;
  private visualFacing = 0;
  private pivotPose = 0;
  private t = 0;
  private hitFlash = 0;
  // Footfall impact (IDEAS-GRAPHICS #39): rising-edge of the footPlant contact signal.
  private prevFootPlant = 0;
  // Hit flinch (IDEAS-GRAPHICS #38): a short directional body recoil when struck.
  private flinchT = 0;
  private flinchDur = 0.18;
  private flinchHold = 0;
  private flinchPitch = 0;
  private flinchRoll = 0;
  private executionT = 0;
  private victoryPose = false;
  private readonly ghostPool: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; t: number; active: boolean }[] = [];

  constructor(private ctx: Ctx) {
    this.root = new THREE.Group();
    this.root.userData.solidity = "mover"; // collision-truth audit: movers are exempt
    this.root.scale.setScalar(HERO_VISUAL_SCALE);
    ctx.stage.scene.add(this.root);
    // Fixed-cost ground echoes. Cloning the complete articulated hero used to
    // submit dozens of extra meshes and allocate a material on every dodge; the
    // replacement capsule read like a second, featureless actor. A thin ground
    // ring supports the restored body roll without competing with its silhouette.
    const ghostGeometry = new THREE.TorusGeometry(0.48, 0.035, 4, 18);
    ghostGeometry.rotateX(Math.PI / 2);
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x55ddff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const mesh = new THREE.Mesh(ghostGeometry, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.userData.solidity = "fx";
      mesh.userData.dodgeEcho = true;
      ctx.stage.scene.add(mesh);
      this.ghostPool.push({ mesh, mat, t: 1, active: false });
    }
    this.applyHero(this.hero, DEFAULT_COSMETICS.cape, DEFAULT_COSMETICS.blade);
  }

  /** Merge ornament meshes inside each animated pivot. The torso, limbs, head
   * and weapon remain independently poseable while shared-material details no
   * longer cost one draw submission apiece. */
  private batchVisualPivots(parent: THREE.Object3D): void {
    for (const child of [...parent.children]) {
      if (!(child instanceof THREE.Mesh)) this.batchVisualPivots(child);
    }
    const byMaterial = new Map<THREE.Material, THREE.Mesh[]>();
    for (const child of parent.children) {
      if (!(child instanceof THREE.Mesh) || Array.isArray(child.material)) continue;
      const list = byMaterial.get(child.material) ?? [];
      list.push(child);
      byMaterial.set(child.material, list);
    }
    for (const [material, meshes] of byMaterial) {
      if (meshes.length < 2) continue;
      const pieces: THREE.BufferGeometry[] = [];
      for (const mesh of meshes) {
        mesh.updateMatrix();
        const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
        geometry.applyMatrix4(mesh.matrix);
        pieces.push(geometry);
      }
      const merged = mergeGeometries(pieces, false);
      for (const geometry of pieces) geometry.dispose();
      if (!merged) continue;
      const baked = new THREE.Mesh(merged, material);
      baked.castShadow = true;
      baked.receiveShadow = true;
      parent.add(baked);
      for (const mesh of meshes) {
        parent.remove(mesh);
        mesh.geometry.dispose();
      }
    }
  }

  /** Tear down and rebuild the whole mesh for a hero + cosmetic loadout. */
  applyHero(hero: HeroDef, capeId: string, bladeId: string): void {
    this.hero = hero;
    this.maxHp = hero.maxHp;
    const capeColor = cosmeticById(capeId).color;
    this.bladeColor = cosmeticById(bladeId).color;
    if (
      this.visualHeroId === hero.id &&
      this.visualCapeId === capeId &&
      this.visualBladeId === bladeId &&
      this.root.children.length > 0
    ) {
      return;
    }

    // Dispose previous build
    for (const texture of this.rig?.textures ?? []) texture.dispose();
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material as THREE.Material | THREE.Material[];
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    });
    this.root.clear();
    this.armorMats = [];

    this.rollGroup = new THREE.Group();
    this.rollGroup.position.y = 0.55;
    this.body = new THREE.Group();
    this.body.position.y = -0.55;
    this.body.scale.set(hero.bulk, 1, hero.bulk);
    this.root.add(this.rollGroup);
    this.rollGroup.add(this.body);

    this.rig = forgeHero(this.body, hero, capeColor, this.bladeColor);
    this.footContacts.length = 0;
    for (const node of [this.rig.kneeR,this.rig.kneeL]) this.footContacts.push({node,offset:new THREE.Vector3(0,-.445,.075),radius:.14});
    this.torso = this.rig.torso;
    this.armR = this.rig.armR;
    this.armL = this.rig.armL;
    this.legR = this.rig.legR;
    this.legL = this.rig.legL;
    this.cape = this.rig.cape;
    this.sword = this.rig.sword;
    this.bladeTipMarker = this.rig.tip;
    this.bladeBaseMarker = this.rig.base;
    this.visorMat = this.rig.eyes;
    this.armorMats = this.rig.flashMaterials;
    this.batchVisualPivots(this.body);

    // Tempo aura ring at the feet
    this.auraMat = new THREE.MeshBasicMaterial({
      color: 0x55ddff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const auraGeo = new THREE.RingGeometry(0.68, 0.72, 96);
    auraGeo.rotateX(-Math.PI / 2);
    this.auraRing = new THREE.Mesh(auraGeo, this.auraMat);
    this.auraRing.position.y = 0.06;
    this.auraRing.userData.floorLayer = "gameplay";
    this.root.add(this.auraRing);

    this.auraLight = new THREE.PointLight(0x3df59a, 6, 9, 1.6);
    this.auraLight.position.y = 1.4;
    this.root.add(this.auraLight);

    // Shield bubble (hidden unless shielded)
    this.shieldMat = new THREE.MeshBasicMaterial({
      color: 0x66bbff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
    });
    this.shieldBubble = new THREE.Mesh(new THREE.SphereGeometry(1.2, 20, 14), this.shieldMat);
    this.shieldBubble.position.y = 1.0;
    this.root.add(this.shieldBubble);

    // Crash nova range preview — counter-scaled against root
    this.crashRing = new THREE.Group();
    this.crashRingMat = new THREE.MeshBasicMaterial({
      color: 0xff4252, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.crashFillMat = this.crashRingMat.clone();
    const crashOutlineGeo = new THREE.RingGeometry(5.82, 6.0, 72);
    crashOutlineGeo.rotateX(-Math.PI / 2);
    const crashFillGeo = new THREE.RingGeometry(0.8, 5.82, 72);
    crashFillGeo.rotateX(-Math.PI / 2);
    this.crashRing.add(new THREE.Mesh(crashOutlineGeo, this.crashRingMat));
    this.crashRing.add(new THREE.Mesh(crashFillGeo, this.crashFillMat));
    this.crashRing.position.y = 0.06;
    this.crashRing.userData.floorLayer = "gameplay";
    this.crashRing.visible = false;
    this.crashRing.scale.setScalar(1 / HERO_VISUAL_SCALE);
    this.root.add(this.crashRing);

    // Keep the authored visible silhouette in the color pass, but collapse its
    // shadow submission to one stable capsule. colorWrite=false makes the proxy
    // invisible in the main pass while Three's shadow depth material still
    // renders it into the directional-light map.
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = false;
    });
    const shadowMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
    shadowMaterial.colorWrite = false;
    shadowMaterial.depthWrite = false;
    this.shadowProxy = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.4, 1.15, 3, 8),
      shadowMaterial,
    );
    this.shadowProxy.name = "hero-shadow-proxy";
    this.shadowProxy.position.y = 0.98;
    this.shadowProxy.castShadow = true;
    this.shadowProxy.receiveShadow = false;
    this.shadowProxy.userData.solidity = "fx";
    this.root.add(this.shadowProxy);

    this.visualHeroId = hero.id;
    this.visualCapeId = capeId;
    this.visualBladeId = bladeId;
    this.armorBase = this.armorMats.map(mat => ({ mat, emissive: mat.emissive.clone(), intensity: mat.emissiveIntensity }));
  }

  flashHit(): void {
    this.hitFlash = 1;
  }

  /** Directional body flinch when struck (IDEAS-GRAPHICS #38). (dirX,dirZ) points
   *  from the attacker toward the hero, so the body recoils along it. */
  hitReaction(dirX: number, dirZ: number): void {
    const len = Math.hypot(dirX, dirZ) || 1;
    // Convert world push dir into the hero's local frame so pitch/roll read right.
    const local = Math.atan2(dirX / len, dirZ / len) - this.visualFacing;
    this.flinchT = this.flinchDur;
    this.flinchHold = 0.035;
    this.flinchPitch = Math.cos(local) * 0.16;
    this.flinchRoll = -Math.sin(local) * 0.16;
  }

  playExecution(): void { this.executionT = Math.max(this.executionT, 0.72); }
  setVictoryPose(on: boolean): void { this.victoryPose = on; }

  /** A step lands: a small ground-tinted dust puff + a micro cam kick by bulk. */
  private emitFootfall(): void {
    this.ctx.sfx.footstep(this.hero.bulk);
    this.ctx.fx.burst({
      x: this.pos.x, y: 0.12, z: this.pos.z,
      count: 5, color: 0x8a8496,
      speed: [0.6, 2.2], up: 0.25, size: [0.18, 0.42], life: [0.18, 0.4], gravity: -1.5, drag: 4,
    });
    this.ctx.cam.addTrauma(0.02 * this.hero.bulk);
  }

  /** World-space blade ribbon anchor points (tip, base) for the trail. */
  getBladePoints(tip: THREE.Vector3, base: THREE.Vector3): void {
    this.bladeTipMarker.getWorldPosition(tip);
    this.bladeBaseMarker.getWorldPosition(base);
  }

  /** Spawn a restrained, pooled ground echo behind the dodge. */
  spawnGhost(): void {
    let ghost = this.ghostPool.find((entry) => !entry.active);
    if (!ghost) ghost = this.ghostPool.reduce((oldest, entry) => entry.t > oldest.t ? entry : oldest);
    ghost.active = true;
    ghost.t = 0;
    ghost.mat.color.set(this.bladeColor);
    ghost.mat.opacity = 0.2;
    ghost.mesh.position.set(this.pos.x, this.pos.y + 0.065, this.pos.z);
    ghost.mesh.rotation.set(0, this.root.rotation.y, 0);
    ghost.mesh.scale.set(0.72 * HERO_VISUAL_SCALE, 1, 1.28 * HERO_VISUAL_SCALE);
    ghost.mesh.visible = true;
    // dt-driven fade (advanced in update()) — a private rAF + wall-clock loop
    // here defeated freezeForTest/frames(n,dt) and made captures nondeterministic
    // (the temporal gate caught it as intermittent frozen-scene shimmer).
  }

  /** One baked mesh for Phase Step's stationary echo, using the actual cast pose. */
  echoGeometry(): THREE.BufferGeometry {
    this.body.updateWorldMatrix(true, true);
    const origin = new THREE.Vector3();
    this.root.getWorldPosition(origin);
    const local = new THREE.Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z);
    const pieces: THREE.BufferGeometry[] = [];
    this.body.traverseVisible(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
      for (const attribute of Object.keys(geometry.attributes)) if (attribute !== "position") geometry.deleteAttribute(attribute);
      geometry.applyMatrix4(object.matrixWorld).applyMatrix4(local);
      pieces.push(geometry);
    });
    const geometry = mergeGeometries(pieces, false)!;
    for (const piece of pieces) piece.dispose();
    return geometry;
  }

  /** Live dodge-ghost fades — advanced by update(dt) on the threaded clock. */
  private updateGhostFades(dt: number): void {
    for (const g of this.ghostPool) {
      if (!g.active) continue;
      g.t += dt;
      const k = g.t / 0.18;
      if (k >= 1) {
        g.active = false;
        g.mat.opacity = 0;
        g.mesh.visible = false;
      } else {
        g.mat.opacity = 0.2 * (1 - k) * (1 - k);
        g.mesh.scale.x += dt * 0.7;
        g.mesh.scale.z += dt * 1.1;
      }
    }
  }

  private updateSecondaryMotion(dt: number): void {
    const move = this.moveBlend;
    const tuck = this.animDodge ? Math.sin(this.animDodge.phase * Math.PI) : 0;
    this.rig.kneeR.rotation.x = damp(this.rig.kneeR.rotation.x, 0.08 + Math.max(0, -Math.sin(this.locoClock)) * move * 1.05 + tuck * 1.2, 22, dt);
    this.rig.kneeL.rotation.x = damp(this.rig.kneeL.rotation.x, 0.08 + Math.max(0, Math.sin(this.locoClock)) * move * 1.05 + tuck * 1.2, 22, dt);
    const attack = this.animSwing ? Math.sin(this.animSwing.phase * Math.PI) : 0;
    this.rig.elbowR.rotation.x = damp(this.rig.elbowR.rotation.x, -0.17 - move * 0.12 - attack * 0.45 - tuck * 0.8, 20, dt);
    this.rig.elbowL.rotation.x = damp(this.rig.elbowL.rotation.x, -0.18 - move * 0.36 - this.animCharge * 0.5 - tuck * 0.75, 20, dt);
    if (dt <= 0) return;
    const vertices = this.cape.geometry.getAttribute("position"), rest = this.rig.capeRest;
    for (let i = 0; i < vertices.count; i++) {
      const x = rest[i * 3], y = rest[i * 3 + 1], z = rest[i * 3 + 2];
      const free = Math.min(1, -y / 1.25);
      const wave = Math.sin(this.t * 4.1 + y * 6.2 + x * 3) * (0.016 + move * 0.045);
      vertices.setXYZ(i, x + free * free * Math.sin(this.t * 2.3 + y * 3) * (0.008 + move * 0.02), y, z + wave * free * free - move * free * free * 0.09);
    }
    vertices.needsUpdate = true;
    this.cape.geometry.computeVertexNormals();
  }

  cinematicGuard = false;
  abilityLeap: number | null = null;
  abilitySpin: number | null = null;
  castGesture: { kind: "project" | "invoke" | "guard"; time: number; duration: number } | null = null;

  update(dt: number): void {
    this.t += dt;
    this.updateSecondaryMotion(dt);
    this.executionT = Math.max(0, this.executionT - dt);
    this.updateGhostFades(dt);
    this.root.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 6);

    // Hit flash → armor emissive spike. Skip the per-material writes on the common
    // frames where there's no flash and the last write already zeroed them — running
    // it then just re-dirties ~8 material uniforms for setRGB(0,0,0).
    if (this.hitFlash > 0 || this.armorFlashLit) {
      for (const base of this.armorBase) {
        base.mat.emissive.copy(base.emissive);
        base.mat.emissive.r += this.hitFlash;
        base.mat.emissive.g += this.hitFlash * 0.25;
        base.mat.emissive.b += this.hitFlash * 0.25;
        base.mat.emissiveIntensity = Math.max(base.intensity, this.hitFlash * 2);
      }
      this.armorFlashLit = this.hitFlash > 0;
    }

    // Authored procedural death settle: keep the silhouette in the aftermath
    // instead of popping the entire caster/shadow hierarchy out of the renderer.
    if (!this.alive) {
      this.animMoveAmount = 0;
      const deathSide = -1.28;
      this.body.position.y = damp(this.body.position.y, -0.92, 6, dt);
      this.body.rotation.x = damp(this.body.rotation.x, -0.18, 7, dt);
      this.body.rotation.z = damp(this.body.rotation.z, deathSide, 6, dt);
      this.torso.rotation.x = damp(this.torso.rotation.x, 0.22, 7, dt);
      this.armR.rotation.x = damp(this.armR.rotation.x, 0.55, 7, dt);
      this.armL.rotation.x = damp(this.armL.rotation.x, -0.35, 7, dt);
      this.cape.rotation.x = damp(this.cape.rotation.x, 0.72, 5, dt);
      return;
    }

    // Tempo aura/visor color — only re-set the three materials when the zone color
    // actually changes (a handful of times per run), not every frame.
    const zone = this.ctx.tempo.zone;
    if (zone.color !== this.lastZoneColor) {
      this.lastZoneColor = zone.color;
      this.auraMat.color.set(zone.color);
      this.auraLight.color.set(zone.color);
      this.visorMat.emissive.set(zone.color);
    }
    const heat = this.ctx.tempo.value / 100;
    this.auraLight.intensity = heat * 0.22;
    this.auraMat.opacity = 0.08 + heat * 0.12;
    // Accumulate the pulse PHASE rather than computing sin(t * freq): the frequency
    // rises with tempo, and multiplying a large `t` by a fast-changing frequency makes
    // the phase jump frame-to-frame when tempo swings (e.g. a crash) — which is the
    // "circle wiggles then settles" glitch. Integrating dt*freq keeps it continuous.
    this.auraPhase += dt * (2 + heat * 7);
    const pulse = 1 + Math.sin(this.auraPhase) * 0.07;
    this.auraRing.scale.setScalar(pulse + heat * 0.25);

    // Crash readiness: announce the rising edge, then keep the blast radius visible
    const crashReady = this.ctx.tempo.crashReady && this.alive;
    if (crashReady && !this.wasCrashReady && this.ctx.playing) {
      this.ctx.floaters.spawn(this.pos.x, 2.2, this.pos.z, `CRASH READY [${this.ctx.input.label("crash")}]`, "tempo");
      this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: crashRadius(this.ctx.tempo.value), color: 0xff4252, duration: 0.6 });
      this.ctx.sfx.cardReady();
    }
    this.wasCrashReady = crashReady;
    this.crashRing.visible = crashReady && this.ctx.playing;
    if (this.crashRing.visible) {
      this.crashRing.scale.setScalar(crashRadius(this.ctx.tempo.value) / (6 * HERO_VISUAL_SCALE));
      this.crashRingMat.color.setHex(this.ctx.tempo.value >= PERFECT_CRASH_THRESHOLD ? 0xefca8c : 0xdc7276);
      this.crashFillMat.color.copy(this.crashRingMat.color);
      const beat = Math.sin(this.t * 5);
      this.crashRingMat.opacity = 0.5 + beat * 0.25;
      this.crashFillMat.opacity = 0.05 + Math.max(0, beat) * 0.04;
      this.crashRing.rotation.y += dt * 0.4;
    }

    // Shield bubble
    const shieldTarget = this.shield > 0 ? 0.16 : 0;
    this.shieldMat.opacity = damp(this.shieldMat.opacity, shieldTarget, 10, dt);
    this.shieldBubble.visible = this.shieldMat.opacity > 0.01;
    this.shieldBubble.rotation.y += dt * 0.8;

    if (this.abilityLeap !== null) {
      const phase = this.abilityLeap;
      this.root.position.y += Math.sin(phase * Math.PI) * 1.9;
      this.root.rotation.y = this.facing;
      this.body.rotation.set(-0.15 + phase * 0.35, 0, 0);
      this.armR.rotation.set(-2.2, -0.15, 0.45);
      this.armL.rotation.set(-1.8, 0.2, -0.3);
      this.legR.rotation.x = 0.75;
      this.legL.rotation.x = -0.5;
      this.rig.kneeR.rotation.x = 1.2;
      this.rig.kneeL.rotation.x = 1.05;
      this.sword.rotation.x = -0.45;
      this.cape.rotation.x = 0.7;
      return;
    }
    // ---- Pose layering: dodge > swing > locomotion
    if (this.animDodge) {
      const d = this.animDodge;
      const dashYaw = Math.atan2(d.dirX, d.dirZ);
      this.visualFacing = dashYaw;
      this.root.rotation.y = dashYaw;
      const tuck = Math.sin(d.phase * Math.PI);
      // A low, committed skating stride preserves the readable weapon/torso
      // silhouette at combat speed. The cape trails behind the direction of travel.
      this.rollGroup.rotation.x = 0;
      this.body.position.y = -0.62 - tuck * 0.08;
      this.body.rotation.set(0.24 + tuck * 0.12, -0.14, -0.08);
      this.torso.rotation.set(0.08, -0.16, 0.03);
      this.armR.rotation.set(-1.05, -0.18, 0.25);
      this.armL.rotation.set(0.65, 0.12, -0.3);
      this.sword.rotation.set(0.9, 0, -0.12);
      this.legR.rotation.x = -0.6 + d.phase * 0.7;
      this.legL.rotation.x = 0.68 - d.phase * 0.4;
      this.cape.rotation.x = 0.8 + tuck * 0.35;
      return;
    }
    this.rollGroup.rotation.x = damp(this.rollGroup.rotation.x % TAU, 0, 18, dt);
    if (this.abilitySpin !== null) {
      this.visualFacing = this.facing;
      this.root.rotation.y = this.facing - this.abilitySpin;
      this.body.position.y = -0.55;
      this.body.rotation.set(0.08, 0, -0.08);
      this.torso.rotation.set(0, -0.15, 0);
      this.armR.rotation.set(-0.45, -0.1, -1.3);
      this.armL.rotation.set(-0.4, 0.15, 0.8);
      this.rig.elbowR.rotation.x = -0.1;
      this.sword.rotation.set(0, 0, -0.2);
      this.legR.rotation.x = 0.3;
      this.legL.rotation.x = -0.3;
      this.cape.rotation.x = 0.6;
      return;
    }
    const facingDelta = Math.atan2(Math.sin(this.facing - this.visualFacing), Math.cos(this.facing - this.visualFacing));
    this.visualFacing = dampAngle(this.visualFacing, this.facing, 18, dt);
    this.root.rotation.y = this.visualFacing;

    // Locomotion
    const prevMove = this.lastMoveBlend;
    this.moveBlend = damp(this.moveBlend, clamp01(this.animMoveAmount), 12, dt);
    this.lastMoveBlend = this.moveBlend;
    this.moveSide = damp(this.moveSide, clamp(this.animMoveX, -1, 1), 10, dt);
    this.moveForward = damp(this.moveForward, clamp(this.animMoveZ, -1, 1), 10, dt);
    const moving = this.moveBlend;
    const side = this.moveSide;
    const forward = this.moveForward;
    this.pivotPose = damp(this.pivotPose, Math.min(1, Math.abs(facingDelta) * 1.6) * moving, 13, dt);

    const started = Math.max(0, moving - prevMove);
    const stopped = Math.max(0, prevMove - moving);
    this.accelPose = damp(this.accelPose, Math.min(1, started * 8), 8, dt);
    this.stopPose = damp(this.stopPose, Math.min(1, stopped * 12), 10, dt);

    const gait = GAIT;

    if (moving > 0.035) this.locoClock += dt * (5.6 + moving * 8.7) * gait.rate;
    const reversing = forward < -0.2 && Math.abs(forward) > Math.abs(side) * 0.75;
    const strideDir = reversing ? -1 : 1;
    const cycle = this.locoClock;
    const swingRaw = Math.sin(cycle) * strideDir;
    const swing = Math.tanh(swingRaw * gait.plant);
    const liftR = Math.pow(Math.max(0, -Math.sin(cycle)), 1.8) * moving;
    const liftL = Math.pow(Math.max(0, Math.sin(cycle)), 1.8) * moving;
    const footPlant = Math.pow(Math.abs(Math.cos(cycle)), 6) * moving;
    // Footfall impact: on each rising step-contact, a small ground-tinted dust puff +
    // a micro camera kick scaled by hero bulk (IDEAS-GRAPHICS #39).
    if (footPlant > 0.55 && this.prevFootPlant <= 0.55 && moving > 0.25) this.emitFootfall();
    this.prevFootPlant = footPlant;
    const stepSnap = Math.max(liftR, liftL) * 0.6 + footPlant * 0.35;
    const bob = stepSnap * gait.bob * moving;
    const idleBreath = Math.sin(this.t * 1.8) * 0.012 * (1 - moving * 0.55);
    const runLean = Math.max(0, forward) * gait.lean * moving + this.accelPose * 0.05 - this.stopPose * 0.04;
    const backLean = Math.max(0, -forward) * 0.04 * moving;
    const strafeLean = clamp(side, -1, 1) * 0.04 * moving + Math.sign(facingDelta) * this.pivotPose * 0.035;

    this.body.position.y = damp(this.body.position.y, -0.55 + bob + idleBreath, 18, dt);
    this.body.rotation.x = damp(this.body.rotation.x, -runLean + backLean, 11, dt);
    this.body.rotation.z = damp(this.body.rotation.z, -strafeLean, 13, dt);
    // Hit flinch: a crisp additive recoil over the locomotion pose (IDEAS-GRAPHICS #38).
    if (this.flinchT > 0) {
      if (this.flinchHold > 0) this.flinchHold = Math.max(0, this.flinchHold - dt);
      else this.flinchT = Math.max(0, this.flinchT - dt);
      const fl = this.flinchHold > 0 ? 1 : ease.outCubic(this.flinchT / this.flinchDur);
      this.body.rotation.x += this.flinchPitch * fl;
      this.body.rotation.z += this.flinchRoll * fl;
    }
    this.legR.rotation.x = damp(this.legR.rotation.x, swing * 0.92 * moving * gait.stride - liftR * 0.22, 20, dt);
    this.legL.rotation.x = damp(this.legL.rotation.x, -swing * 0.92 * moving * gait.stride - liftL * 0.22, 20, dt);
    this.legR.rotation.z = damp(this.legR.rotation.z, -liftR * 0.07 - side * 0.08 * moving, 16, dt);
    this.legL.rotation.z = damp(this.legL.rotation.z, liftL * 0.07 - side * 0.08 * moving, 16, dt);
    this.legR.position.y = damp(this.legR.position.y, 0.83 + liftR * 0.055 - footPlant * 0.01, 20, dt);
    this.legL.position.y = damp(this.legL.position.y, 0.83 + liftL * 0.055 - footPlant * 0.01, 20, dt);
    this.legR.position.z = damp(this.legR.position.z, swing * 0.09 * moving * gait.stride + side * 0.028 * moving, 18, dt);
    this.legL.position.z = damp(this.legL.position.z, -swing * 0.09 * moving * gait.stride + side * 0.028 * moving, 18, dt);
    this.armL.rotation.x = damp(this.armL.rotation.x, -swing * gait.arm * moving - 0.08 - this.stopPose * 0.18, 14, dt);
    this.armL.rotation.z = damp(this.armL.rotation.z, -0.11 - side * 0.08 * moving, 12, dt);
    this.armL.rotation.y = damp(this.armL.rotation.y, side * 0.035 * moving, 12, dt);

    // Cape: speed lift and restrained side response so it reads as cloth, not noise.
    const flap = Math.sin(this.t * 3.1) * 0.012 + Math.sin(this.locoClock * 0.5) * 0.02 * moving;
    this.cape.rotation.x = damp(this.cape.rotation.x, 0.12 + moving * 0.24 + Math.max(0, -forward) * 0.08 + this.accelPose * 0.12 + flap, 9, dt);
    this.cape.rotation.z = damp(this.cape.rotation.z, -side * 0.045 * moving, 10, dt);
    this.cape.rotation.y = damp(this.cape.rotation.y, side * 0.035 * moving, 10, dt);

    // Sword arm: swing animation overrides idle/run pose
    if (this.cinematicGuard || this.castGesture) {
      const gesture = this.castGesture;
      if (gesture) { gesture.time += dt; if (gesture.time >= gesture.duration) this.castGesture = null; }
      const k = gesture ? Math.sin(Math.min(1, gesture.time / gesture.duration) * Math.PI) : 1;
      const kind = gesture?.kind ?? "guard";
      this.armL.rotation.set(kind === "invoke" ? -2.25 * k : kind === "project" ? -1.5 * k : -0.75, 0.15, -0.3);
      this.armR.rotation.set(kind === "guard" ? -1.18 : -0.38, -0.2, 0.38);
      this.rig.elbowL.rotation.x = -0.3;
      this.rig.elbowR.rotation.x = -0.65;
      this.sword.rotation.set(-0.35, 0, -0.2);
      this.torso.rotation.set(0.04, 0.18 * k, 0);
    } else if (this.animCharge > 0 && !this.animSwing) {
      const charge = ease.outCubic(this.animCharge);
      this.armR.rotation.set(-1.8 - charge * 0.4, -0.45, 0.65);
      this.armL.rotation.set(-1.3, 0.28, -0.3);
      this.torso.rotation.set(-0.09, 0.45 * charge, -0.08);
      this.body.position.y = -0.55 + bob + idleBreath - 0.07 * charge;
      this.sword.rotation.x = -0.55;
    } else if (this.victoryPose) {
      const breathe = Math.sin(this.t * 1.8) * 0.025;
      this.armR.rotation.set(-1.62 + breathe, -0.08, 0.28);
      this.armL.rotation.set(-0.42, 0, -0.42);
      this.torso.rotation.set(-0.03, 0.14, -0.03);
      this.body.rotation.set(0.02, 0, -0.025);
      this.sword.rotation.x = -0.28;
    } else if (this.executionT > 0 && !this.animSwing) {
      const k = 1 - this.executionT / 0.72;
      this.armR.rotation.set(-0.65 + k * 0.42, 0.06, -0.42 + k * 0.2);
      this.armL.rotation.set(-0.42, 0, -0.26);
      this.torso.rotation.set(0.1 - k * 0.06, -0.24 + k * 0.2, 0);
      this.body.rotation.x = damp(this.body.rotation.x, 0.08, 16, dt);
      this.sword.rotation.x = -0.4;
    } else if (this.animSwing) {
      const { phase, stage = 0 } = this.animSwing;
      const p = this.attackPose;
      sampleBladeMotion(stage, phase, p);
      this.armR.rotation.set(p[0], p[1], p[2]);
      this.torso.rotation.set(p[3], p[4], p[5]);
      this.armL.rotation.set(p[6], p[7], p[8]);
      this.rig.elbowR.rotation.x = p[9];
      this.rig.elbowL.rotation.x = stage === 3 ? p[9] * 0.8 : -0.3;
      this.rig.kneeR.rotation.x = p[10];
      this.rig.kneeL.rotation.x = p[11];
      this.body.rotation.x = p[12];
      this.body.position.y = -0.55 + bob + idleBreath + p[13];
      this.body.rotation.z = -p[5] * 0.5;
      this.legR.rotation.z = stage >= 2 ? -0.12 : -0.04;
      this.legL.rotation.z = stage >= 2 ? 0.12 : 0.04;
      this.sword.rotation.set(stage === 3 ? -0.15 : -0.4, 0, 0);
    } else {
      // Idle/run arm pose, sword low at the side
      this.armR.rotation.x = damp(this.armR.rotation.x, swing * gait.arm * 0.8 * moving - 0.16 - this.stopPose * 0.1, 14, dt);
      this.armR.rotation.z = damp(this.armR.rotation.z, 0.09 + side * 0.05 * moving, 14, dt);
      this.armR.rotation.y = damp(this.armR.rotation.y, -side * 0.035 * moving, 12, dt);
      this.torso.rotation.y = damp(this.torso.rotation.y, 0, 14, dt);
      this.torso.rotation.x = damp(this.torso.rotation.x, 0.035 + Math.max(0, forward) * 0.07 * moving + this.accelPose * 0.04 - this.stopPose * 0.03, 10, dt);
      this.torso.rotation.z = damp(this.torso.rotation.z, -side * 0.035 * moving, 14, dt);
      this.sword.rotation.x = damp(this.sword.rotation.x, 0.85, 10, dt);
      this.sword.rotation.y = damp(this.sword.rotation.y, 0, 12, dt);
      this.sword.rotation.z = damp(this.sword.rotation.z, 0, 12, dt);
    }
  }

}
