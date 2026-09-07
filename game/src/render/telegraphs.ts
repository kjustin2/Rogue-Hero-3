import * as THREE from "three";

/** The attack clock advances only while its owner's brain advances. */
export interface TelegraphClock {
  readonly time: number;
  readonly revision: number;
  readonly alive: boolean;
}

interface Telegraph {
  clock?: TelegraphClock;
  clockStart: number;
  clockRevision: number;
  group: THREE.Group;
  outline: THREE.Mesh;
  fill: THREE.Mesh;
  impact: THREE.Mesh;
  zone: THREE.Mesh;
  sweep: THREE.Mesh;
  /** Annulus mesh, built per use (inner/outer ratio varies), disposed on release. */
  annulus: THREE.Mesh | null;
  outlineMat: THREE.MeshBasicMaterial;
  fillMat: THREE.MeshBasicMaterial;
  impactMat: THREE.MeshBasicMaterial;
  zoneMat: THREE.MeshBasicMaterial;
  sweepMat: THREE.MeshBasicMaterial;
  t: number;
  dur: number;
  radius: number;
  length: number;
  shape: "circle" | "line" | "ring";
  active: boolean;
}

/**
 * Pooled attack telegraphs. Two shapes:
 * - circle: an outline marks the danger area immediately, an inner disc grows
 *   to meet it — when they touch, the hit lands.
 * - line: a translucent strip marks the full attack path immediately, and a
 *   brighter sweep advances from the attacker toward the far end on the same
 *   clock. The strip points exactly where the attack will travel.
 * Readable threat windows are the contract that makes hard hits fair.
 */
export class Telegraphs {
  private pool: Telegraph[] = [];

  constructor(private scene: THREE.Scene) {
    const outlineGeo = new THREE.RingGeometry(0.975, 1.0, 64);
    outlineGeo.rotateX(-Math.PI / 2);
    const fillGeo = new THREE.CircleGeometry(1, 48);
    fillGeo.rotateX(-Math.PI / 2);
    // Unit strip: x ∈ [-0.5, 0.5] (width), z ∈ [0, 1] (extends forward).
    // group.rotation.y = attack yaw maps local +Z onto (sin yaw, 0, cos yaw) —
    // the same forward convention the rest of the game uses.
    const stripGeo = new THREE.PlaneGeometry(1, 1);
    stripGeo.rotateX(-Math.PI / 2);
    stripGeo.translate(0, 0, 0.5);
    const border = new THREE.Shape();
    border.moveTo(-0.5,0); border.lineTo(0.5,0); border.lineTo(0.5,1); border.lineTo(-0.5,1); border.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-0.47,0.012); hole.lineTo(-0.47,0.988); hole.lineTo(0.47,0.988); hole.lineTo(0.47,0.012); hole.closePath();
    border.holes.push(hole);
    const laneOutline = new THREE.ShapeGeometry(border); laneOutline.rotateX(Math.PI/2);

    // 48, not 32: at high Ascension depth a pack + champion + affixed elites can
    // have many attacks telegraphing at once, and a pool miss drops a telegraph —
    // an un-warned hit, which breaks the "every attack telegraphs" fairness contract.
    for (let i = 0; i < 48; i++) {
      const group = new THREE.Group();
      const mat = () =>
        new THREE.MeshBasicMaterial({
          color: 0xff3344,
          transparent: true,
          opacity: 0,
          blending: THREE.NormalBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
      const outlineMat = mat();
      const fillMat = mat();
      const impactMat = mat();
      const zoneMat = mat();
      const sweepMat = mat();
      const outline = new THREE.Mesh(outlineGeo, outlineMat);
      outline.userData.circleGeometry = outlineGeo;
      outline.userData.laneGeometry = laneOutline;
      const fill = new THREE.Mesh(fillGeo, fillMat);
      const impact = new THREE.Mesh(outlineGeo, impactMat);
      const zone = new THREE.Mesh(stripGeo, zoneMat);
      const sweep = new THREE.Mesh(stripGeo, sweepMat);
      for (const mesh of [outline, fill, impact, zone, sweep]) mesh.userData.floorLayer = "gameplay";
      fill.position.y = 0.01;
      impact.position.y = 0.025;
      sweep.position.y = 0.01;
      group.add(outline, fill, impact, zone, sweep);
      group.visible = false;
      group.userData.solidity = "fx";
      this.scene.add(group);
      this.pool.push({
        group, outline, fill, impact, zone, sweep, annulus: null,
        outlineMat, fillMat, impactMat, zoneMat, sweepMat,
        t: 0, dur: 1, radius: 1, length: 1, shape: "circle", active: false, clockStart: 0, clockRevision: 0,
      });
    }
  }

  circle(x: number, z: number, radius: number, duration: number, color = 0xff3344, clock?: TelegraphClock): void {
    const t = this.pool.find((p) => !p.active);
    if (!t) return;
    t.active = true;
    t.clock = clock;
    t.clockStart = clock?.time ?? 0;
    t.clockRevision = clock?.revision ?? 0;
    t.shape = "circle";
    t.t = 0;
    t.dur = duration;
    t.radius = radius;
    t.group.visible = true;
    t.group.position.set(x, 0.05, z);
    t.group.rotation.y = 0;
    t.outline.visible = t.fill.visible = t.impact.visible = true;
    t.outline.geometry = t.outline.userData.circleGeometry;
    t.zone.visible = t.sweep.visible = false;
    t.outline.scale.set(radius, 1, radius);
    t.fill.scale.setScalar(0.001);
    t.impact.scale.set(radius * 0.9, 1, radius * 0.9);
    t.outlineMat.color.set(color);
    t.fillMat.color.set(color);
    t.impactMat.color.set(0xffddbe);
    t.outlineMat.opacity = 0.85;
    t.fillMat.opacity = 0.22;
    t.impactMat.opacity = 0;
  }

  /** Strip from (x,z) along world yaw `angle` for `length`, `width` across. */
  line(x: number, z: number, angle: number, length: number, width: number, duration: number, color = 0xff3344, clock?: TelegraphClock): void {
    const t = this.pool.find((p) => !p.active);
    if (!t) return;
    t.active = true;
    t.clock = clock;
    t.clockStart = clock?.time ?? 0;
    t.clockRevision = clock?.revision ?? 0;
    t.shape = "line";
    t.t = 0;
    t.dur = duration;
    t.length = length;
    t.group.visible = true;
    t.group.position.set(x, 0.05, z);
    t.group.rotation.y = angle;
    t.fill.visible = t.impact.visible = false;
    t.outline.visible = true;
    t.outline.geometry = t.outline.userData.laneGeometry;
    t.outline.scale.set(width,1,length);
    t.outlineMat.color.set(color);
    t.outlineMat.opacity = 0.85;
    t.zone.visible = t.sweep.visible = true;
    t.zone.scale.set(width, 1, length);
    t.sweep.scale.set(width, 1, 0.001);
    t.zoneMat.color.set(color);
    t.sweepMat.color.set(color);
    t.zoneMat.opacity = 0.18;
    t.sweepMat.opacity = 0.4;
  }

  /**
   * Annulus danger band — the area between innerR and outerR is the threat,
   * inside and outside are safe lanes (a filled disc here would lie).
   */
  ring(x: number, z: number, innerR: number, outerR: number, duration: number, color = 0xff3344, clock?: TelegraphClock): void {
    const t = this.pool.find((p) => !p.active);
    if (!t) return;
    t.active = true;
    t.clock = clock;
    t.clockStart = clock?.time ?? 0;
    t.clockRevision = clock?.revision ?? 0;
    t.shape = "ring";
    t.t = 0;
    t.dur = duration;
    t.group.visible = true;
    t.group.position.set(x, 0.05, z);
    t.group.rotation.y = 0;
    t.outline.visible = true;
    t.outline.geometry = t.outline.userData.circleGeometry;
    t.impact.visible = false;
    t.fill.visible = t.zone.visible = t.sweep.visible = false;
    t.outline.scale.set(outerR, 1, outerR);
    t.outlineMat.color.set(color);
    t.outlineMat.opacity = 0.85;
    const geo = new THREE.RingGeometry(innerR, outerR, 64);
    geo.rotateX(-Math.PI / 2);
    t.annulus = new THREE.Mesh(geo, t.fillMat);
    t.annulus.position.y = 0.01;
    t.fillMat.color.set(color);
    t.fillMat.opacity = 0.18;
    t.group.add(t.annulus);
  }

  private release(t: Telegraph): void {
    t.active = false;
    t.clock = undefined;
    t.group.visible = false;
    t.impact.visible = false;
    if (t.annulus) {
      t.group.remove(t.annulus);
      t.annulus.geometry.dispose();
      t.annulus = null;
    }
  }

  /** Cancel every active warning. Room/enemy cleanup must not leave orphaned
   * spawn or attack telegraphs in the next presentation frame. */
  clear(): void {
    for (const t of this.pool) {
      if (t.active || t.group.visible || t.annulus) this.release(t);
      else t.group.visible = false;
    }
  }

  stats(): { active: number; visible: number } {
    return {
      active: this.pool.reduce((count, telegraph) => count + (telegraph.active ? 1 : 0), 0),
      visible: this.pool.reduce((count, telegraph) => count + (telegraph.group.visible ? 1 : 0), 0),
    };
  }

  update(dt: number): void {
    for (const t of this.pool) {
      if (!t.active) continue;
      if (t.clock) {
        if (!t.clock.alive || t.clock.revision !== t.clockRevision) { this.release(t); continue; }
        t.t = t.clock.time - t.clockStart;
      } else t.t += dt;
      const k = Math.min(1, t.t / t.dur);
      const late = Math.max(0, (k - 0.72) / 0.28);
      if (t.shape === "circle") {
        t.fill.scale.setScalar(Math.max(0.001, t.radius * k));
        const impactScale = t.radius * Math.max(0.001,k);
        t.impact.scale.set(impactScale, 1, impactScale);
        t.fillMat.opacity = 0.1 + k * 0.12 + late * 0.08;
        t.outlineMat.opacity = 0.76 + late * 0.2;
        t.impactMat.opacity = 0.45 + k * 0.4;
      } else if (t.shape === "ring") {
        t.fillMat.opacity = 0.12 + k * 0.18;
        t.outlineMat.opacity = 0.78 + late * 0.2;
      } else {
        const endPulse = Math.max(0, (k - 0.78) / 0.22);
        t.sweep.scale.z = Math.max(0.001, t.length * k);
        t.sweepMat.opacity = 0.16 + k * 0.16 + endPulse * 0.1;
        t.zoneMat.opacity = 0.12;
        t.outlineMat.opacity = 0.76 + endPulse * 0.2;
      }
      if (k >= 1) this.release(t);
    }
  }
}
