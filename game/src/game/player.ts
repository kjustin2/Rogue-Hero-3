import * as THREE from "three";
import { clamp01, damp, ease, TAU } from "../core/math";
import type { Ctx } from "./ctx";

/**
 * The hero: stats + a fully procedural low-poly knight. No asset files —
 * the silhouette is built from flat-shaded boxes with emissive accents so it
 * reads crisply under bloom. Combat/controller drive the animation inputs
 * (moveSpeed, swing phase, dodge phase); this class turns them into pose.
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

  readonly root: THREE.Group;
  private body: THREE.Group;
  private rollGroup: THREE.Group;
  private armR: THREE.Group;
  private armL: THREE.Group;
  private legR: THREE.Group;
  private legL: THREE.Group;
  private cape: THREE.Mesh;
  private torso: THREE.Group;
  private sword: THREE.Group;
  private bladeMat: THREE.MeshStandardMaterial;
  private visorMat: THREE.MeshStandardMaterial;
  private auraMat: THREE.MeshBasicMaterial;
  private auraRing: THREE.Mesh;
  private auraLight: THREE.PointLight;
  private armorMats: THREE.MeshStandardMaterial[] = [];
  private shieldBubble: THREE.Mesh;
  private shieldMat: THREE.MeshBasicMaterial;
  private crashRing: THREE.Group;
  private crashRingMat: THREE.MeshBasicMaterial;
  private crashFillMat: THREE.MeshBasicMaterial;
  private wasCrashReady = false;

  // Animation inputs (set by controller/combat each frame)
  animMoveAmount = 0;
  animSwing: { phase: number; heavy: boolean } | null = null;
  animDodge: { phase: number; dirX: number; dirZ: number } | null = null;

  private locoClock = 0;
  private t = 0;
  private hitFlash = 0;

  constructor(private ctx: Ctx) {
    this.root = new THREE.Group();
    this.rollGroup = new THREE.Group();
    this.rollGroup.position.y = 0.55;
    this.body = new THREE.Group();
    this.body.position.y = -0.55;
    this.root.add(this.rollGroup);
    this.rollGroup.add(this.body);
    // Slight scale-up for readability at gameplay camera distance
    this.root.scale.setScalar(1.12);

    const armor = (color: number, emissive = 0x000000, ei = 0) => {
      const m = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.55,
        metalness: 0.35,
        flatShading: true,
        emissive,
        emissiveIntensity: ei,
      });
      this.armorMats.push(m);
      return m;
    };

    const plate = armor(0x2a3045);
    const plateDark = armor(0x1b2030);
    const gold = armor(0x9a7833, 0xffaa33, 0.35);
    const cloth = armor(0x141824);

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

    // Torso group (twists during swings)
    this.torso = new THREE.Group();
    this.torso.position.y = 1.0;
    this.body.add(this.torso);
    box(0.64, 0.62, 0.42, plate, 0, 0.1, 0, this.torso);
    box(0.52, 0.16, 0.46, gold, 0, -0.26, 0, this.torso); // belt
    box(0.7, 0.1, 0.46, gold, 0, 0.38, 0, this.torso); // collar trim

    // Head + visor
    const head = new THREE.Group();
    head.position.y = 0.66;
    this.torso.add(head);
    box(0.4, 0.38, 0.4, plateDark, 0, 0.08, 0, head);
    this.visorMat = new THREE.MeshStandardMaterial({
      color: 0x111111,
      emissive: 0x55ddff,
      emissiveIntensity: 2.4,
      roughness: 0.3,
    });
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.07, 0.05), this.visorMat);
    visor.position.set(0, 0.1, 0.21);
    head.add(visor);
    box(0.14, 0.3, 0.14, gold, 0, 0.32, -0.08, head); // crest

    // Shoulders
    box(0.26, 0.2, 0.34, gold, -0.46, 0.34, 0, this.torso);
    box(0.26, 0.2, 0.34, gold, 0.46, 0.34, 0, this.torso);

    // Arms (pivot at shoulder)
    this.armR = new THREE.Group();
    this.armR.position.set(0.46, 0.26, 0);
    this.torso.add(this.armR);
    box(0.17, 0.52, 0.17, plate, 0, -0.3, 0, this.armR);

    this.armL = new THREE.Group();
    this.armL.position.set(-0.46, 0.26, 0);
    this.torso.add(this.armL);
    box(0.17, 0.52, 0.17, plate, 0, -0.3, 0, this.armL);

    // Sword in right hand: emissive blade reads as a light source under bloom
    this.sword = new THREE.Group();
    this.sword.position.set(0, -0.56, 0.05);
    this.armR.add(this.sword);
    this.bladeMat = new THREE.MeshStandardMaterial({
      color: 0x99ddff,
      emissive: 0x44ccff,
      emissiveIntensity: 2.0,
      roughness: 0.2,
      metalness: 0.6,
    });
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.04, 1.3), this.bladeMat);
    blade.position.z = 0.78;
    this.sword.add(blade);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.22, 4), this.bladeMat);
    tip.rotation.x = Math.PI / 2;
    tip.position.z = 1.54;
    this.sword.add(tip);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.08), gold);
    guard.position.z = 0.1;
    this.sword.add(guard);

    // Hips + legs
    box(0.5, 0.24, 0.36, plateDark, 0, 0.62, 0);
    this.legR = new THREE.Group();
    this.legR.position.set(0.17, 0.55, 0);
    this.body.add(this.legR);
    box(0.19, 0.52, 0.22, cloth, 0, -0.28, 0, this.legR);
    this.legL = new THREE.Group();
    this.legL.position.set(-0.17, 0.55, 0);
    this.body.add(this.legL);
    box(0.19, 0.52, 0.22, cloth, 0, -0.28, 0, this.legL);

    // Cape
    const capeMat = new THREE.MeshStandardMaterial({
      color: 0x3a1020,
      roughness: 0.9,
      side: THREE.DoubleSide,
    });
    this.cape = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.95), capeMat);
    this.cape.geometry.translate(0, -0.475, 0);
    this.cape.position.set(0, 0.42, -0.24);
    this.cape.castShadow = true;
    this.torso.add(this.cape);

    // Tempo aura ring at the feet
    this.auraMat = new THREE.MeshBasicMaterial({
      color: 0x3df59a,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const auraGeo = new THREE.RingGeometry(0.55, 0.72, 40);
    auraGeo.rotateX(-Math.PI / 2);
    this.auraRing = new THREE.Mesh(auraGeo, this.auraMat);
    this.auraRing.position.y = 0.06;
    this.root.add(this.auraRing);

    this.auraLight = new THREE.PointLight(0x3df59a, 6, 9, 1.6);
    this.auraLight.position.y = 1.4;
    this.root.add(this.auraLight);

    // Shield bubble (hidden unless shielded)
    this.shieldMat = new THREE.MeshBasicMaterial({
      color: 0x66bbff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
    });
    this.shieldBubble = new THREE.Mesh(new THREE.SphereGeometry(1.2, 20, 14), this.shieldMat);
    this.shieldBubble.position.y = 1.0;
    this.root.add(this.shieldBubble);

    // Crash nova range preview — shown only while crash is ready (tempo ≥85)
    // so the 6m blast radius is never a guess. Counter-scaled against root.
    this.crashRing = new THREE.Group();
    this.crashRingMat = new THREE.MeshBasicMaterial({
      color: 0xff4252,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
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
    this.crashRing.scale.setScalar(1 / 1.12);
    this.root.add(this.crashRing);

    ctx.stage.scene.add(this.root);
  }

  flashHit(): void {
    this.hitFlash = 1;
  }

  /** Spawn translucent afterimage of the hero — dodge ghosts. */
  spawnGhost(): void {
    const ghost = this.body.clone(true);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x55ddff,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    ghost.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.material = mat;
        o.castShadow = false;
      }
    });
    ghost.position.copy(this.pos);
    ghost.position.y += 0.55 - 0.55;
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

    // Hit flash → armor emissive spike
    for (const m of this.armorMats) {
      m.emissive.setRGB(this.hitFlash, this.hitFlash * 0.25, this.hitFlash * 0.25);
      if (m.emissiveIntensity < 0.34) m.emissiveIntensity = Math.max(m.emissiveIntensity, this.hitFlash * 2);
    }

    // Tempo aura color + intensity
    const zone = this.ctx.tempo.zone;
    this.auraMat.color.set(zone.color);
    this.auraLight.color.set(zone.color);
    const heat = this.ctx.tempo.value / 100;
    this.auraLight.intensity = 3 + heat * 9;
    this.auraMat.opacity = 0.3 + heat * 0.45;
    const pulse = 1 + Math.sin(this.t * (2 + heat * 7)) * 0.07;
    this.auraRing.scale.setScalar(pulse + heat * 0.25);
    this.visorMat.emissive.set(zone.color);

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
    this.shieldBubble.rotation.y += dt * 0.8;

    // ---- Pose layering: dodge > swing > locomotion
    if (this.animDodge) {
      const d = this.animDodge;
      const rollYaw = Math.atan2(d.dirX, d.dirZ);
      this.root.rotation.y = rollYaw;
      this.rollGroup.rotation.x = ease.outCubic(d.phase) * TAU;
      this.body.rotation.set(0, 0, 0);
      this.torso.rotation.set(0, 0, 0);
      this.cape.rotation.x = 0.9;
      return;
    }
    this.rollGroup.rotation.x = damp(this.rollGroup.rotation.x % TAU, 0, 18, dt);
    this.root.rotation.y = this.facing;

    // Locomotion
    const moving = clamp01(this.animMoveAmount);
    this.locoClock += dt * (6 + moving * 7) * (moving > 0.05 ? 1 : 0);
    const swing = Math.sin(this.locoClock);
    this.legR.rotation.x = swing * 0.7 * moving;
    this.legL.rotation.x = -swing * 0.7 * moving;
    const bob = Math.abs(Math.cos(this.locoClock)) * 0.05 * moving;
    this.body.position.y = -0.55 + bob + Math.sin(this.t * 1.8) * 0.012;
    this.armL.rotation.x = swing * 0.5 * moving;

    // Cape: lean back with speed, gentle flap
    this.cape.rotation.x = 0.12 + moving * 0.42 + Math.sin(this.t * 3.1) * 0.05 + Math.sin(this.locoClock * 0.5) * 0.06 * moving;
    this.cape.rotation.z = Math.sin(this.t * 2.3) * 0.05;

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
      } else {
        // Strike: whip through with follow-through overshoot
        const k = ease.outQuart((phase - 0.22) / 0.78);
        const overshoot = Math.sin(Math.min(1, k) * Math.PI) * 0.21;
        this.armR.rotation.x = -1.8 + k * (heavy ? 3.4 : 2.9) + overshoot;
        this.armR.rotation.z = 0.5 - k * 0.7;
        this.torso.rotation.y = (heavy ? 0.55 : 0.35) - k * (heavy ? 1.0 : 0.7);
        this.torso.rotation.x = k * 0.14;
      }
      this.sword.rotation.x = -0.4;
    } else {
      // Idle/run arm pose, sword low at the side
      this.armR.rotation.x = damp(this.armR.rotation.x, swing * 0.4 * moving - 0.12, 14, dt);
      this.armR.rotation.z = damp(this.armR.rotation.z, 0.06, 14, dt);
      this.torso.rotation.y = damp(this.torso.rotation.y, 0, 12, dt);
      this.torso.rotation.x = damp(this.torso.rotation.x, moving * 0.1, 10, dt);
      this.sword.rotation.x = damp(this.sword.rotation.x, -0.15, 10, dt);
    }
  }
}
