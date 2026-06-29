import * as THREE from "three";
import { clamp, clamp01, damp, dampAngle, ease, TAU } from "../core/math";
import { heroById, type HeroDef } from "./heroes";
import { DEFAULT_COSMETICS, cosmeticById } from "./cosmetics";
import type { Ctx } from "./ctx";

const HERO_VISUAL_SCALE = 1.2;

/**
 * The hero: stats + a fully procedural low-poly knight, rebuilt from any
 * HeroDef palette + cosmetic colors. No asset files — flat-shaded boxes with
 * emissive accents that read crisply under bloom. Combat/controller drive the
 * animation inputs (move amount, swing phase, dodge phase); this class turns
 * them into pose.
 */
export class Player {
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
  animSwing: { phase: number; heavy: boolean } | null = null;
  animDodge: { phase: number; dirX: number; dirZ: number } | null = null;

  private locoClock = 0;
  private moveBlend = 0;
  private moveSide = 0;
  private moveForward = 0;
  private accelPose = 0;
  private stopPose = 0;
  private lastMoveBlend = 0;
  private visualFacing = 0;
  private t = 0;
  private hitFlash = 0;

  constructor(private ctx: Ctx) {
    this.root = new THREE.Group();
    this.root.scale.setScalar(HERO_VISUAL_SCALE);
    ctx.stage.scene.add(this.root);
    this.applyHero(this.hero, DEFAULT_COSMETICS.cape, DEFAULT_COSMETICS.blade);
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

    const armor = (color: number, emissive = 0x000000, ei = 0) => {
      const m = new THREE.MeshStandardMaterial({
        color, roughness: 0.55, metalness: 0.35, flatShading: true, emissive, emissiveIntensity: ei,
      });
      this.armorMats.push(m);
      return m;
    };

    const plate = armor(hero.plate);
    const plateDark = armor(hero.plateDark);
    const gold = armor(hero.trim, hero.trimEmissive, 0.35);
    const cloth = armor(0x141824);
    const heroGlow = new THREE.MeshStandardMaterial({
      color: 0xeefaff,
      emissive: this.bladeColor,
      emissiveIntensity: 2.1,
      roughness: 0.24,
      metalness: 0.45,
      flatShading: true,
    });
    const capeTrim = new THREE.MeshStandardMaterial({
      color: hero.trim,
      emissive: this.bladeColor,
      emissiveIntensity: 0.7,
      roughness: 0.45,
      metalness: 0.35,
      flatShading: true,
    });

    const box = (
      w: number, h: number, d: number,
      mat: THREE.MeshStandardMaterial,
      x = 0, y = 0, z = 0,
      parent: THREE.Object3D = this.body
    ) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const spike = (
      r: number, h: number, seg: number,
      mat: THREE.MeshStandardMaterial,
      x = 0, y = 0, z = 0,
      parent: THREE.Object3D = this.body
    ) => {
      const mesh = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };

    // --- Per-hero silhouette profile: proportions the rig is built around.
    const id = hero.id;
    const P = {
      torsoW: 0.64, torsoH: 0.62, torsoD: 0.42,
      shoulderX: 0.46, shoulderW: 0.26, shoulderH: 0.2, shoulderD: 0.34,
      armX: 0.46, armW: 0.17, armH: 0.52,
      legX: 0.17, legW: 0.19, legH: 0.52,
      headW: 0.4, headH: 0.38, headD: 0.4,
    };
    if (id === "bulwark") {
      // Broad, heavy, blocky — a walking wall.
      P.torsoW = 0.86; P.torsoH = 0.7; P.torsoD = 0.52;
      P.shoulderX = 0.6; P.shoulderW = 0.4; P.shoulderH = 0.3; P.shoulderD = 0.46;
      P.armX = 0.6; P.armW = 0.24; P.armH = 0.5;
      P.legX = 0.22; P.legW = 0.26; P.legH = 0.46;
      P.headW = 0.46; P.headH = 0.4; P.headD = 0.46;
    } else if (id === "sparkmage") {
      // Slender, robed, small frame.
      P.torsoW = 0.5; P.torsoH = 0.56; P.torsoD = 0.34;
      P.shoulderX = 0.36; P.shoulderW = 0.18; P.shoulderH = 0.14; P.shoulderD = 0.26;
      P.armX = 0.38; P.armW = 0.13; P.armH = 0.52;
      P.legX = 0.13; P.legW = 0.15; P.legH = 0.54;
      P.headW = 0.34; P.headH = 0.36; P.headD = 0.34;
    } else if (id === "reaver") {
      // Hulking, brutish, asymmetric (heavier right side).
      P.torsoW = 0.78; P.torsoH = 0.66; P.torsoD = 0.48;
      P.shoulderX = 0.56; P.shoulderW = 0.34; P.shoulderH = 0.26; P.shoulderD = 0.42;
      P.armX = 0.56; P.armW = 0.22; P.armH = 0.56;
      P.legX = 0.2; P.legW = 0.24; P.legH = 0.48;
      P.headW = 0.38; P.headH = 0.34; P.headD = 0.38;
    } else if (id === "tempest") {
      // Thin, tall, streamlined.
      P.torsoW = 0.48; P.torsoH = 0.6; P.torsoD = 0.32;
      P.shoulderX = 0.34; P.shoulderW = 0.16; P.shoulderH = 0.12; P.shoulderD = 0.26;
      P.armX = 0.36; P.armW = 0.12; P.armH = 0.56;
      P.legX = 0.13; P.legW = 0.14; P.legH = 0.58;
      P.headW = 0.32; P.headH = 0.36; P.headD = 0.32;
    } else if (id === "revenant") {
      // Gaunt and tall — a hollow, hooded thing with long reaching arms.
      P.torsoW = 0.5; P.torsoH = 0.66; P.torsoD = 0.34;
      P.shoulderX = 0.42; P.shoulderW = 0.22; P.shoulderH = 0.16; P.shoulderD = 0.3;
      P.armX = 0.42; P.armW = 0.13; P.armH = 0.62;
      P.legX = 0.14; P.legW = 0.15; P.legH = 0.6;
      P.headW = 0.34; P.headH = 0.38; P.headD = 0.34;
    }

    // Torso group (twists during swings)
    this.torso = new THREE.Group();
    this.torso.position.y = 1.0;
    this.body.add(this.torso);
    box(P.torsoW, P.torsoH, P.torsoD, plate, 0, 0.1, 0, this.torso);
    box(P.torsoW * 0.81, 0.16, P.torsoD * 1.1, gold, 0, -0.26, 0, this.torso); // belt
    box(P.torsoW * 1.09, 0.1, P.torsoD * 1.1, gold, 0, 0.38, 0, this.torso); // collar trim
    const chestZ = P.torsoD * 0.5 + 0.04;
    const chestCore = box(P.torsoW * 0.22, 0.24, 0.055, heroGlow, 0, 0.15, chestZ, this.torso);
    chestCore.rotation.z = Math.PI / 4;
    const sashA = box(P.torsoW * 0.72, 0.055, 0.055, gold, -P.torsoW * 0.08, 0.1, chestZ + 0.01, this.torso);
    sashA.rotation.z = 0.58;
    const sashB = box(P.torsoW * 0.72, 0.045, 0.052, plateDark, P.torsoW * 0.08, -0.02, chestZ + 0.012, this.torso);
    sashB.rotation.z = -0.5;
    for (const x of [-0.3, -0.1, 0.1, 0.3]) {
      box(P.torsoW * 0.045, 0.04, 0.05, gold, x * P.torsoW, -0.255, chestZ + 0.022, this.torso);
    }
    for (const sx of [-1, 1]) {
      box(P.torsoW * 0.08, 0.05, 0.055, heroGlow, sx * P.torsoW * 0.43, 0.38, chestZ + 0.02, this.torso);
    }
    for (const sx of [-1, 1]) {
      const rib = box(0.045, P.torsoH * 0.58, 0.055, gold, sx * P.torsoW * 0.34, 0.08, chestZ + 0.006, this.torso);
      rib.rotation.z = sx * -0.12;
    }
    for (let i = 0; i < 3; i++) {
      const y = 0.02 - i * 0.115;
      const plateW = P.torsoW * (0.48 - i * 0.055);
      box(plateW, 0.045, 0.052, i === 1 ? gold : plateDark, 0, y, chestZ + 0.018, this.torso);
    }
    for (const sx of [-1, 1]) {
      box(0.055, 0.055, 0.055, heroGlow, sx * P.torsoW * 0.22, 0.31, chestZ + 0.026, this.torso);
      const sidePlate = box(P.torsoW * 0.18, 0.28, 0.055, plateDark, sx * P.torsoW * 0.48, 0.0, chestZ - 0.004, this.torso);
      sidePlate.rotation.z = sx * -0.16;
      box(P.torsoW * 0.12, 0.045, 0.05, gold, sx * P.torsoW * 0.45, -0.16, chestZ + 0.016, this.torso);
    }
    const backZ = -P.torsoD * 0.55;
    box(P.torsoW * 0.58, 0.075, 0.055, plateDark, 0, 0.28, backZ, this.torso);
    box(P.torsoW * 0.42, 0.055, 0.052, gold, 0, 0.1, backZ - 0.01, this.torso);
    box(P.torsoW * 0.08, 0.46, 0.045, heroGlow, 0, 0.06, backZ - 0.018, this.torso);
    for (const sx of [-1, 1]) {
      const backRib = box(0.04, P.torsoH * 0.45, 0.045, plateDark, sx * P.torsoW * 0.3, 0.04, backZ, this.torso);
      backRib.rotation.z = sx * 0.15;
    }

    // Bulwark: a heavy chest plate + central rivet for mass.
    if (id === "bulwark") {
      box(P.torsoW * 0.7, 0.5, 0.1, plateDark, 0, 0.16, P.torsoD * 0.5 + 0.02, this.torso);
      box(0.12, 0.12, 0.08, gold, 0, 0.22, P.torsoD * 0.5 + 0.06, this.torso);
    }
    // Reaver: ragged plates strapped across an exposed torso.
    if (id === "reaver") {
      box(P.torsoW * 0.85, 0.14, P.torsoD * 1.06, plateDark, -0.04, 0.24, 0, this.torso).rotation.z = 0.22;
      box(P.torsoW * 0.6, 0.12, P.torsoD * 1.06, plateDark, 0.06, -0.04, 0, this.torso).rotation.z = -0.18;
    }
    // Sparkmage: long robe skirt below the torso.
    if (id === "sparkmage") {
      box(P.torsoW * 1.05, 0.62, P.torsoD * 1.15, cloth, 0, -0.5, 0, this.torso);
    }
    // Revenant: a tattered, hanging shroud + a sunken dark chest.
    if (id === "revenant") {
      box(P.torsoW * 1.0, 0.7, P.torsoD * 1.1, cloth, 0, -0.56, 0, this.torso);
      box(P.torsoW * 0.55, 0.36, 0.06, plateDark, 0, 0.12, P.torsoD * 0.5 + 0.02, this.torso);
    }

    // Head + visor
    const head = new THREE.Group();
    head.position.y = 0.66;
    this.torso.add(head);
    box(P.headW, P.headH, P.headD, plateDark, 0, 0.08, 0, head);
    this.visorMat = new THREE.MeshStandardMaterial({
      color: 0x111111, emissive: 0x55ddff, emissiveIntensity: 2.4, roughness: 0.3,
    });
    const visor = new THREE.Mesh(new THREE.BoxGeometry(P.headW * 0.75, 0.07, 0.05), this.visorMat);
    visor.position.set(0, 0.1, P.headD * 0.52);
    head.add(visor);
    box(P.headW * 0.9, 0.045, 0.07, gold, 0, 0.22, P.headD * 0.5, head); // brow trim
    for (const sx of [-1, 1]) {
      const cheek = box(P.headW * 0.18, P.headH * 0.5, 0.055, plate, sx * P.headW * 0.34, -0.02, P.headD * 0.5, head);
      cheek.rotation.z = sx * -0.08;
      const jaw = box(P.headW * 0.28, 0.06, 0.065, gold, sx * P.headW * 0.18, -0.16, P.headD * 0.49, head);
      jaw.rotation.z = sx * -0.15;
    }
    // Per-hero headgear shape.
    if (id === "bulwark") {
      // Blocky great-helm with a wide horizontal brow and short stubby crest.
      box(P.headW * 1.12, 0.12, P.headD * 1.05, plateDark, 0, 0.26, 0, head);
      box(0.14, 0.18, 0.14, gold, 0, 0.36, -0.04, head);
    } else if (id === "sparkmage") {
      // Pointed hood + a hovering arcane orb above the head.
      spike(P.headW * 0.62, 0.42, 4, cloth, 0, 0.36, -0.04, head);
      const orbMat = new THREE.MeshStandardMaterial({
        color: 0xffffff, emissive: this.bladeColor, emissiveIntensity: 2.6, roughness: 0.2,
      });
      this.armorMats.push(orbMat);
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), orbMat);
      orb.position.set(0.34, 0.5, 0.1);
      head.add(orb);
    } else if (id === "reaver") {
      // Asymmetric brute helm: one jagged horn off the right side.
      box(P.headW, 0.1, P.headD, plateDark, 0, 0.24, 0, head);
      const horn = spike(0.09, 0.34, 4, gold, 0.2, 0.42, -0.02, head);
      horn.rotation.z = -0.5;
    } else if (id === "tempest") {
      // Swept-back twin fins for a streamlined, fast read.
      const finL = box(0.06, 0.16, 0.34, gold, -0.13, 0.26, -0.1, head);
      finL.rotation.x = 0.6;
      const finR = box(0.06, 0.16, 0.34, gold, 0.13, 0.26, -0.1, head);
      finR.rotation.x = 0.6;
    } else if (id === "revenant") {
      // A deep cowl that overhangs the brow — the face lost in shadow.
      const cowl = spike(P.headW * 0.78, 0.5, 4, cloth, 0, 0.34, -0.06, head);
      cowl.rotation.x = 0.18;
      box(P.headW * 1.04, 0.1, P.headD * 0.5, cloth, 0, 0.16, P.headD * 0.36, head).rotation.x = 0.5; // brim
    } else {
      // Blade: the classic vertical crest.
      box(0.14, 0.3, 0.14, gold, 0, 0.32, -0.08, head);
    }

    // Shoulders (pauldrons) — size scales with the silhouette.
    box(P.shoulderW, P.shoulderH, P.shoulderD, gold, -P.shoulderX, 0.34, 0, this.torso);
    box(P.shoulderW, P.shoulderH, P.shoulderD, gold, P.shoulderX, 0.34, 0, this.torso);
    for (const sx of [-1, 1]) {
      const lip = box(P.shoulderW * 1.15, 0.055, P.shoulderD * 1.18, plateDark, sx * P.shoulderX, 0.49, 0.02, this.torso);
      lip.rotation.z = sx * -0.08;
      const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), heroGlow);
      rivet.position.set(sx * P.shoulderX, 0.53, P.shoulderD * 0.42);
      this.torso.add(rivet);
      if (id !== "sparkmage" && id !== "tempest") {
        const crest = spike(0.045, 0.18, 4, heroGlow, sx * P.shoulderX, 0.62, -0.02, this.torso);
        crest.rotation.z = sx * -0.2;
      }
    }
    if (id === "bulwark") {
      // Oversized angular pauldrons capped with spikes.
      const capL = spike(0.2, 0.26, 4, plateDark, -P.shoulderX - 0.02, 0.5, 0, this.torso);
      capL.rotation.z = 0.3;
      const capR = spike(0.2, 0.26, 4, plateDark, P.shoulderX + 0.02, 0.5, 0, this.torso);
      capR.rotation.z = -0.3;
    } else if (id === "reaver") {
      // One huge spiked pauldron on the right — asymmetric brute.
      box(0.34, 0.34, 0.5, plateDark, P.shoulderX + 0.04, 0.4, 0, this.torso);
      const s1 = spike(0.07, 0.26, 4, gold, P.shoulderX + 0.04, 0.6, 0.12, this.torso);
      s1.rotation.x = -0.4;
      const s2 = spike(0.07, 0.24, 4, gold, P.shoulderX + 0.18, 0.5, 0, this.torso);
      s2.rotation.z = -0.7;
    }

    // Arms (pivot at shoulder) — KEEP armR/armL groups; they drive the rig.
    this.armR = new THREE.Group();
    this.armR.position.set(P.armX, 0.26, 0);
    this.torso.add(this.armR);
    box(P.armW, P.armH, P.armW, plate, 0, -P.armH * 0.58, 0, this.armR);
    box(P.armW * 1.28, 0.12, P.armW * 1.28, gold, 0, -P.armH * 0.98, 0, this.armR);
    box(P.armW * 1.05, 0.055, P.armW * 1.35, heroGlow, 0, -P.armH * 0.78, P.armW * 0.2, this.armR);
    box(P.armW * 1.22, 0.16, P.armW * 1.32, plateDark, 0, -P.armH * 0.42, P.armW * 0.04, this.armR);
    box(P.armW * 1.36, 0.08, P.armW * 1.42, plateDark, 0, -P.armH * 1.11, P.armW * 0.06, this.armR);
    for (const sx of [-0.32, 0.32]) box(P.armW * 0.28, 0.035, P.armW * 0.3, gold, sx * P.armW, -P.armH * 1.17, P.armW * 0.52, this.armR);

    this.armL = new THREE.Group();
    this.armL.position.set(-P.armX, 0.26, 0);
    this.torso.add(this.armL);
    box(P.armW, P.armH, P.armW, plate, 0, -P.armH * 0.58, 0, this.armL);
    box(P.armW * 1.28, 0.12, P.armW * 1.28, gold, 0, -P.armH * 0.98, 0, this.armL);
    box(P.armW * 1.05, 0.055, P.armW * 1.35, heroGlow, 0, -P.armH * 0.78, P.armW * 0.2, this.armL);
    box(P.armW * 1.22, 0.16, P.armW * 1.32, plateDark, 0, -P.armH * 0.42, P.armW * 0.04, this.armL);
    box(P.armW * 1.36, 0.08, P.armW * 1.42, plateDark, 0, -P.armH * 1.11, P.armW * 0.06, this.armL);
    for (const sx of [-0.32, 0.32]) box(P.armW * 0.28, 0.035, P.armW * 0.3, gold, sx * P.armW, -P.armH * 1.17, P.armW * 0.52, this.armL);

    // Sword: emissive blade reads as a light source under bloom.
    // Per-hero weapon profile, but the sword GROUP + tip/base markers are
    // invariant so getBladePoints and the swing rig keep working.
    this.sword = new THREE.Group();
    this.sword.position.set(0, -0.56, 0.05);
    this.armR.add(this.sword);
    const bladeMat = new THREE.MeshStandardMaterial({
      color: 0x99ddff, emissive: this.bladeColor, emissiveIntensity: 2.0, roughness: 0.2, metalness: 0.6,
    });
    if (id === "reaver") {
      // Heavy, broad cleaver-blade.
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 1.3), bladeMat);
      blade.position.z = 0.78;
      this.sword.add(blade);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.26, 4), bladeMat);
      tip.rotation.x = Math.PI / 2;
      tip.position.z = 1.56;
      this.sword.add(tip);
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.07, 0.1), gold);
      guard.position.z = 0.1;
      this.sword.add(guard);
    } else if (id === "bulwark") {
      // Stout broadsword + a tower-shield strapped to the left arm.
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 1.1), bladeMat);
      blade.position.z = 0.68;
      this.sword.add(blade);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.24, 4), bladeMat);
      tip.rotation.x = Math.PI / 2;
      tip.position.z = 1.35;
      this.sword.add(tip);
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.07, 0.1), gold);
      guard.position.z = 0.1;
      this.sword.add(guard);
      box(0.06, 0.7, 0.5, plateDark, 0.04, -0.3, 0.12, this.armL);
      box(0.04, 0.5, 0.12, gold, 0.06, -0.3, 0.12, this.armL);
    } else if (id === "sparkmage") {
      // The "sword is a wand": thin staff with a glowing emissive core + crystal tip.
      const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6), gold);
      staff.rotation.x = Math.PI / 2;
      staff.position.z = 0.7;
      this.sword.add(staff);
      const core = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 1.0), bladeMat);
      core.position.z = 0.7;
      this.sword.add(core);
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.13), bladeMat);
      crystal.position.z = 1.5;
      this.sword.add(crystal);
    } else if (id === "tempest") {
      // Long, whip-thin rapier.
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 1.5), bladeMat);
      blade.position.z = 0.88;
      this.sword.add(blade);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.24, 4), bladeMat);
      tip.rotation.x = Math.PI / 2;
      tip.position.z = 1.74;
      this.sword.add(tip);
      const guard = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 6, 12), gold);
      guard.position.z = 0.14;
      this.sword.add(guard);
    } else {
      // Blade: the classic balanced longsword.
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.04, 1.3), bladeMat);
      blade.position.z = 0.78;
      this.sword.add(blade);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.22, 4), bladeMat);
      tip.rotation.x = Math.PI / 2;
      tip.position.z = 1.54;
      this.sword.add(tip);
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.08), gold);
      guard.position.z = 0.1;
      this.sword.add(guard);
    }
    // Invisible markers for the trail ribbon — invariant anchors.
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.075, 0.34), plateDark);
    grip.position.z = -0.02;
    this.sword.add(grip);
    const pommel = new THREE.Mesh(new THREE.OctahedronGeometry(0.08), heroGlow);
    pommel.position.z = -0.23;
    this.sword.add(pommel);
    const bladeRune = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.022, 0.72), heroGlow);
    bladeRune.position.set(0, 0.04, 0.9);
    this.sword.add(bladeRune);
    this.bladeTipMarker = new THREE.Object3D();
    this.bladeTipMarker.position.z = 1.6;
    this.bladeBaseMarker = new THREE.Object3D();
    this.bladeBaseMarker.position.z = 0.35;
    this.sword.add(this.bladeTipMarker, this.bladeBaseMarker);

    // Hips + legs
    box(P.torsoW * 0.78, 0.24, P.torsoD * 0.86, plateDark, 0, 0.62, 0);
    for (const sx of [-1, 1]) {
      const hipGuard = box(P.torsoW * 0.22, 0.24, P.torsoD * 0.38, gold, sx * P.torsoW * 0.36, 0.52, 0.02);
      hipGuard.rotation.z = sx * -0.18;
    }
    for (const sx of [-1, 1]) {
      const skirt = box(P.torsoW * 0.18, 0.28, P.torsoD * 0.12, plateDark, sx * P.torsoW * 0.18, 0.43, P.torsoD * 0.36);
      skirt.rotation.x = sx * 0.03;
      const trim = box(P.torsoW * 0.16, 0.04, P.torsoD * 0.14, gold, sx * P.torsoW * 0.18, 0.29, P.torsoD * 0.38);
      trim.rotation.x = sx * 0.03;
    }
    this.legR = new THREE.Group();
    this.legR.position.set(P.legX, 0.55, 0);
    this.body.add(this.legR);
    box(P.legW, P.legH, P.legW * 1.16, cloth, 0, -P.legH * 0.54, 0, this.legR);
    box(P.legW * 1.22, 0.12, P.legW * 1.34, gold, 0, -P.legH * 0.48, P.legW * 0.16, this.legR);
    box(P.legW * 1.32, 0.14, P.legW * 1.5, plateDark, 0, -P.legH * 0.66, P.legW * 0.28, this.legR);
    box(P.legW * 1.12, 0.11, P.legW * 1.25, plateDark, 0, -P.legH * 0.96, 0, this.legR);
    box(P.legW * 0.9, 0.055, P.legW * 1.36, gold, 0, -P.legH * 1.04, P.legW * 0.28, this.legR);
    box(P.legW * 1.45, 0.12, P.legW * 1.65, plateDark, 0, -P.legH * 1.16, P.legW * 0.16, this.legR);
    this.legL = new THREE.Group();
    this.legL.position.set(-P.legX, 0.55, 0);
    this.body.add(this.legL);
    box(P.legW, P.legH, P.legW * 1.16, cloth, 0, -P.legH * 0.54, 0, this.legL);
    box(P.legW * 1.22, 0.12, P.legW * 1.34, gold, 0, -P.legH * 0.48, P.legW * 0.16, this.legL);
    box(P.legW * 1.32, 0.14, P.legW * 1.5, plateDark, 0, -P.legH * 0.66, P.legW * 0.28, this.legL);
    box(P.legW * 1.12, 0.11, P.legW * 1.25, plateDark, 0, -P.legH * 0.96, 0, this.legL);
    box(P.legW * 0.9, 0.055, P.legW * 1.36, gold, 0, -P.legH * 1.04, P.legW * 0.28, this.legL);
    box(P.legW * 1.45, 0.12, P.legW * 1.65, plateDark, 0, -P.legH * 1.16, P.legW * 0.16, this.legL);

    // Cape (cosmetic color) — robe-like for the mage, streamer-thin for tempest.
    let capeW = 0.66, capeH = 0.95;
    if (id === "bulwark") { capeW = 0.82; capeH = 1.05; }
    else if (id === "sparkmage") { capeW = 0.58; capeH = 1.25; }
    else if (id === "tempest") { capeW = 0.4; capeH = 1.15; }
    else if (id === "reaver") { capeW = 0.7; capeH = 0.78; }
    const capeMat = new THREE.MeshStandardMaterial({ color: capeColor, roughness: 0.9, side: THREE.DoubleSide });
    const capeGeo = new THREE.PlaneGeometry(capeW, capeH);
    capeGeo.translate(0, -capeH * 0.5, 0);
    this.cape = new THREE.Mesh(capeGeo, capeMat);
    this.cape.position.set(0, 0.42, -P.torsoD * 0.57);
    this.cape.castShadow = true;
    this.torso.add(this.cape);
    box(capeW * 0.3, 0.07, 0.04, capeTrim, 0, 0.35, -P.torsoD * 0.58, this.torso);
    box(0.07, 0.11, 0.05, heroGlow, 0, 0.35, -P.torsoD * 0.61, this.torso);
    box(0.035, capeH * 0.82, 0.025, capeTrim, -capeW * 0.43, 0.02 - capeH * 0.45, -P.torsoD * 0.6, this.torso);
    box(0.035, capeH * 0.82, 0.025, capeTrim, capeW * 0.43, 0.02 - capeH * 0.45, -P.torsoD * 0.6, this.torso);
    box(capeW * 0.62, 0.035, 0.025, capeTrim, 0, 0.36 - capeH * 0.86, -P.torsoD * 0.6, this.torso);
    box(0.026, capeH * 0.68, 0.018, capeTrim, -capeW * 0.18, 0.0 - capeH * 0.43, -P.torsoD * 0.61, this.torso);
    box(0.026, capeH * 0.68, 0.018, capeTrim, capeW * 0.18, 0.0 - capeH * 0.43, -P.torsoD * 0.61, this.torso);
    box(0.02, capeH * 0.58, 0.016, capeTrim, 0, -0.02 - capeH * 0.46, -P.torsoD * 0.615, this.torso);

    // Tempo aura ring at the feet
    this.auraMat = new THREE.MeshBasicMaterial({
      color: 0x3df59a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const auraGeo = new THREE.RingGeometry(0.55, 0.72, 96);
    auraGeo.rotateX(-Math.PI / 2);
    this.auraRing = new THREE.Mesh(auraGeo, this.auraMat);
    this.auraRing.position.y = 0.06;
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
    this.crashRing.position.y = 0.04;
    this.crashRing.visible = false;
    this.crashRing.scale.setScalar(1 / HERO_VISUAL_SCALE);
    this.root.add(this.crashRing);
    this.visualHeroId = hero.id;
    this.visualCapeId = capeId;
    this.visualBladeId = bladeId;
  }

  flashHit(): void {
    this.hitFlash = 1;
  }

  /** World-space blade ribbon anchor points (tip, base) for the trail. */
  getBladePoints(tip: THREE.Vector3, base: THREE.Vector3): void {
    this.bladeTipMarker.getWorldPosition(tip);
    this.bladeBaseMarker.getWorldPosition(base);
  }

  /** Spawn translucent afterimage of the hero — dodge ghosts. */
  spawnGhost(): void {
    const ghost = this.body.clone(true);
    const mat = new THREE.MeshBasicMaterial({
      color: this.bladeColor, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    ghost.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.material = mat;
        o.castShadow = false;
      }
    });
    ghost.position.copy(this.pos);
    ghost.scale.multiplyScalar(HERO_VISUAL_SCALE);
    ghost.rotation.y = this.root.rotation.y;
    this.ctx.stage.scene.add(ghost);
    const start = performance.now();
    const fade = () => {
      const k = (performance.now() - start) / 240;
      if (k >= 1) {
        this.ctx.stage.scene.remove(ghost);
        mat.dispose();
        return;
      }
      mat.opacity = 0.35 * (1 - k);
      requestAnimationFrame(fade);
    };
    requestAnimationFrame(fade);
  }

  update(dt: number): void {
    this.t += dt;
    this.root.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 6);

    // Hit flash → armor emissive spike. Skip the per-material writes on the common
    // frames where there's no flash and the last write already zeroed them — running
    // it then just re-dirties ~8 material uniforms for setRGB(0,0,0).
    if (this.hitFlash > 0 || this.armorFlashLit) {
      for (const m of this.armorMats) {
        m.emissive.setRGB(this.hitFlash, this.hitFlash * 0.25, this.hitFlash * 0.25);
        if (m.emissiveIntensity < 0.34) m.emissiveIntensity = Math.max(m.emissiveIntensity, this.hitFlash * 2);
      }
      this.armorFlashLit = this.hitFlash > 0;
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
    this.auraLight.intensity = 3 + heat * 9;
    this.auraMat.opacity = 0.3 + heat * 0.45;
    // Accumulate the pulse PHASE rather than computing sin(t * freq): the frequency
    // rises with tempo, and multiplying a large `t` by a fast-changing frequency makes
    // the phase jump frame-to-frame when tempo swings (e.g. a crash) — which is the
    // "circle wiggles then settles" glitch. Integrating dt*freq keeps it continuous.
    this.auraPhase += dt * (2 + heat * 7);
    const pulse = 1 + Math.sin(this.auraPhase) * 0.07;
    this.auraRing.scale.setScalar(pulse + heat * 0.25);

    // Crash readiness: announce the rising edge, then keep the blast radius visible
    const crashReady = this.ctx.tempo.crashReady && this.alive;
    if (crashReady && !this.wasCrashReady) {
      this.ctx.floaters.spawn(this.pos.x, 2.2, this.pos.z, "CRASH READY [F]", "tempo");
      this.ctx.fx.ring(this.pos.x, this.pos.z, { radius: 6, color: 0xff4252, duration: 0.6 });
      this.ctx.sfx.cardReady();
    }
    this.wasCrashReady = crashReady;
    this.crashRing.visible = crashReady;
    if (crashReady) {
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

    // ---- Pose layering: dodge > swing > locomotion
    if (this.animDodge) {
      const d = this.animDodge;
      const rollYaw = Math.atan2(d.dirX, d.dirZ);
      this.visualFacing = rollYaw;
      this.root.rotation.y = rollYaw;
      this.rollGroup.rotation.x = ease.outCubic(d.phase) * TAU;
      const tuck = Math.sin(d.phase * Math.PI);
      this.body.position.y = damp(this.body.position.y, -0.6 + tuck * 0.12, 18, dt);
      this.body.rotation.set(-0.24 * tuck, 0, 0.18 * Math.sin(d.phase * TAU));
      this.torso.rotation.set(-0.18 * tuck, 0, -0.18 * tuck);
      this.armR.rotation.x = -1.25 + tuck * 0.5;
      this.armR.rotation.z = 0.45;
      this.armL.rotation.x = -0.95;
      this.armL.rotation.z = -0.38;
      this.legR.rotation.x = 0.62 * tuck;
      this.legL.rotation.x = -0.62 * tuck;
      this.cape.rotation.x = 0.95 + tuck * 0.28;
      return;
    }
    this.rollGroup.rotation.x = damp(this.rollGroup.rotation.x % TAU, 0, 18, dt);
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

    const started = Math.max(0, moving - prevMove);
    const stopped = Math.max(0, prevMove - moving);
    this.accelPose = damp(this.accelPose, Math.min(1, started * 8), 8, dt);
    this.stopPose = damp(this.stopPose, Math.min(1, stopped * 12), 10, dt);

    const h = this.hero.id;
    const gait =
      h === "bulwark" ? { stride: 0.72, bob: 0.032, arm: 0.34, lean: 0.075, rate: 0.78, plant: 1.35 } :
      h === "tempest" ? { stride: 1.16, bob: 0.034, arm: 0.52, lean: 0.095, rate: 1.28, plant: 0.88 } :
      h === "sparkmage" ? { stride: 0.86, bob: 0.052, arm: 0.32, lean: 0.06, rate: 0.96, plant: 0.95 } :
      h === "reaver" ? { stride: 0.98, bob: 0.05, arm: 0.56, lean: 0.12, rate: 1.02, plant: 1.12 } :
      h === "revenant" ? { stride: 0.82, bob: 0.045, arm: 0.42, lean: 0.085, rate: 0.9, plant: 1.18 } :
      { stride: 1.0, bob: 0.04, arm: 0.44, lean: 0.08, rate: 1.0, plant: 1.0 };

    if (moving > 0.035) this.locoClock += dt * (5.6 + moving * 8.7) * gait.rate;
    const reversing = forward < -0.2 && Math.abs(forward) > Math.abs(side) * 0.75;
    const strideDir = reversing ? -1 : 1;
    const cycle = this.locoClock;
    const swingRaw = Math.sin(cycle) * strideDir;
    const swing = Math.tanh(swingRaw * gait.plant);
    const liftR = Math.pow(Math.max(0, -Math.sin(cycle)), 1.8) * moving;
    const liftL = Math.pow(Math.max(0, Math.sin(cycle)), 1.8) * moving;
    const footPlant = Math.pow(Math.abs(Math.cos(cycle)), 6) * moving;
    const stepSnap = Math.max(liftR, liftL) * 0.6 + footPlant * 0.35;
    const bob = stepSnap * gait.bob * moving;
    const idleBreath = Math.sin(this.t * (h === "revenant" ? 1.25 : 1.8)) * 0.012 * (1 - moving * 0.55);
    const runLean = Math.max(0, forward) * gait.lean * moving + this.accelPose * 0.05 - this.stopPose * 0.04;
    const backLean = Math.max(0, -forward) * 0.04 * moving;
    const strafeLean = clamp(side, -1, 1) * 0.04 * moving;

    this.body.position.y = damp(this.body.position.y, -0.55 + bob + idleBreath, 18, dt);
    this.body.rotation.x = damp(this.body.rotation.x, -runLean + backLean, 11, dt);
    this.body.rotation.z = damp(this.body.rotation.z, -strafeLean, 13, dt);
    this.legR.rotation.x = damp(this.legR.rotation.x, swing * 0.92 * moving * gait.stride - liftR * 0.22, 20, dt);
    this.legL.rotation.x = damp(this.legL.rotation.x, -swing * 0.92 * moving * gait.stride - liftL * 0.22, 20, dt);
    this.legR.rotation.z = damp(this.legR.rotation.z, -liftR * 0.07 - side * 0.08 * moving, 16, dt);
    this.legL.rotation.z = damp(this.legL.rotation.z, liftL * 0.07 - side * 0.08 * moving, 16, dt);
    this.legR.position.y = damp(this.legR.position.y, 0.55 + liftR * 0.075 - footPlant * 0.012, 20, dt);
    this.legL.position.y = damp(this.legL.position.y, 0.55 + liftL * 0.075 - footPlant * 0.012, 20, dt);
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
    if (this.animSwing) {
      const { phase, heavy } = this.animSwing;
      if (phase < 0.22) {
        // Windup: raise and coil back
        const k = ease.outCubic(phase / 0.22);
        this.armR.rotation.x = -0.3 - k * 1.5;
        this.armR.rotation.z = k * 0.5;
        this.torso.rotation.y = k * (heavy ? 0.55 : 0.35);
        this.torso.rotation.x = -k * 0.08;
        this.body.rotation.x = damp(this.body.rotation.x, -0.12 - (heavy ? 0.08 : 0), 16, dt);
        this.armL.rotation.x = damp(this.armL.rotation.x, -0.45 - k * 0.3, 16, dt);
        this.armL.rotation.z = damp(this.armL.rotation.z, -0.35, 16, dt);
      } else {
        // Strike: whip through with follow-through overshoot
        const k = ease.outQuart((phase - 0.22) / 0.78);
        const overshoot = Math.sin(Math.min(1, k) * Math.PI) * 0.21;
        this.armR.rotation.x = -1.8 + k * (heavy ? 3.4 : 2.9) + overshoot;
        this.armR.rotation.z = 0.5 - k * 0.7;
        this.torso.rotation.y = (heavy ? 0.55 : 0.35) - k * (heavy ? 1.0 : 0.7);
        this.torso.rotation.x = k * 0.14;
        this.body.rotation.x = damp(this.body.rotation.x, heavy ? -0.18 + k * 0.12 : -0.1 + k * 0.08, 16, dt);
        this.armL.rotation.x = damp(this.armL.rotation.x, -0.35 + k * 0.25, 16, dt);
        this.armL.rotation.z = damp(this.armL.rotation.z, -0.28 + k * 0.18, 16, dt);
      }
      this.torso.rotation.z = damp(this.torso.rotation.z, 0, 12, dt);
      this.sword.rotation.x = -0.4;
    } else {
      // Idle/run arm pose, sword low at the side
      this.armR.rotation.x = damp(this.armR.rotation.x, swing * gait.arm * 0.8 * moving - 0.16 - this.stopPose * 0.1, 14, dt);
      this.armR.rotation.z = damp(this.armR.rotation.z, 0.09 + side * 0.05 * moving, 14, dt);
      this.armR.rotation.y = damp(this.armR.rotation.y, -side * 0.035 * moving, 12, dt);
      this.torso.rotation.y = damp(this.torso.rotation.y, 0, 14, dt);
      this.torso.rotation.x = damp(this.torso.rotation.x, 0.035 + Math.max(0, forward) * 0.07 * moving + this.accelPose * 0.04 - this.stopPose * 0.03, 10, dt);
      this.torso.rotation.z = damp(this.torso.rotation.z, -side * 0.035 * moving, 14, dt);
      this.sword.rotation.x = damp(this.sword.rotation.x, -0.15, 10, dt);
    }
  }
}
