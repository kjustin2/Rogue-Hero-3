import * as THREE from "three";

interface Telegraph {
  group: THREE.Group;
  outline: THREE.Mesh;
  fill: THREE.Mesh;
  zone: THREE.Mesh;
  sweep: THREE.Mesh;
  /** Annulus mesh, built per use (inner/outer ratio varies), disposed on release. */
  annulus: THREE.Mesh | null;
  outlineMat: THREE.MeshBasicMaterial;
  fillMat: THREE.MeshBasicMaterial;
  zoneMat: THREE.MeshBasicMaterial;
  sweepMat: THREE.MeshBasicMaterial;
  t: number;
  dur: number;
  radius: number;
  length: number;
  shape: "circle" | "line" | "ring";
  active: boolean;
}

export interface TelegraphHandle {
  cancel(): void;
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
    const outlineGeo = new THREE.RingGeometry(0.93, 1.0, 48);
    outlineGeo.rotateX(-Math.PI / 2);
    const fillGeo = new THREE.CircleGeometry(1, 48);
    fillGeo.rotateX(-Math.PI / 2);
    // Unit strip: x ∈ [-0.5, 0.5] (width), z ∈ [0, 1] (extends forward).
    // group.rotation.y = attack yaw maps local +Z onto (sin yaw, 0, cos yaw) —
    // the same forward convention the rest of the game uses.
    const stripGeo = new THREE.PlaneGeometry(1, 1);
    stripGeo.rotateX(-Math.PI / 2);
    stripGeo.translate(0, 0, 0.5);

    for (let i = 0; i < 32; i++) {
      const group = new THREE.Group();
      const mat = () =>
        new THREE.MeshBasicMaterial({
          color: 0xff3344,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
      const outlineMat = mat();
      const fillMat = mat();
      const zoneMat = mat();
      const sweepMat = mat();
      const outline = new THREE.Mesh(outlineGeo, outlineMat);
      const fill = new THREE.Mesh(fillGeo, fillMat);
      const zone = new THREE.Mesh(stripGeo, zoneMat);
      const sweep = new THREE.Mesh(stripGeo, sweepMat);
      fill.position.y = 0.01;
      sweep.position.y = 0.01;
      group.add(outline, fill, zone, sweep);
      group.visible = false;
      this.scene.add(group);
      this.pool.push({
        group, outline, fill, zone, sweep, annulus: null,
        outlineMat, fillMat, zoneMat, sweepMat,
        t: 0, dur: 1, radius: 1, length: 1, shape: "circle", active: false,
      });
    }
  }

  circle(x: number, z: number, radius: number, duration: number, color = 0xff3344): TelegraphHandle {
    const t = this.pool.find((p) => !p.active);
    if (!t) return { cancel() {} };
    t.active = true;
    t.shape = "circle";
    t.t = 0;
    t.dur = duration;
    t.radius = radius;
    t.group.visible = true;
    t.group.position.set(x, 0.05, z);
    t.group.rotation.y = 0;
    t.outline.visible = t.fill.visible = true;
    t.zone.visible = t.sweep.visible = false;
    t.outline.scale.set(radius, 1, radius);
    t.fill.scale.setScalar(0.001);
    t.outlineMat.color.set(color);
    t.fillMat.color.set(color);
    t.outlineMat.opacity = 0.85;
    t.fillMat.opacity = 0.22;
    return { cancel: () => this.release(t) };
  }

  /** Strip from (x,z) along world yaw `angle` for `length`, `width` across. */
  line(x: number, z: number, angle: number, length: number, width: number, duration: number, color = 0xff3344): TelegraphHandle {
    const t = this.pool.find((p) => !p.active);
    if (!t) return { cancel() {} };
    t.active = true;
    t.shape = "line";
    t.t = 0;
    t.dur = duration;
    t.length = length;
    t.group.visible = true;
    t.group.position.set(x, 0.05, z);
    t.group.rotation.y = angle;
    t.outline.visible = t.fill.visible = false;
    t.zone.visible = t.sweep.visible = true;
    t.zone.scale.set(width, 1, length);
    t.sweep.scale.set(width, 1, 0.001);
    t.zoneMat.color.set(color);
    t.sweepMat.color.set(color);
    t.zoneMat.opacity = 0.18;
    t.sweepMat.opacity = 0.4;
    return { cancel: () => this.release(t) };
  }

  /**
   * Annulus danger band — the area between innerR and outerR is the threat,
   * inside and outside are safe lanes (a filled disc here would lie).
   */
  ring(x: number, z: number, innerR: number, outerR: number, duration: number, color = 0xff3344): TelegraphHandle {
    const t = this.pool.find((p) => !p.active);
    if (!t) return { cancel() {} };
    t.active = true;
    t.shape = "ring";
    t.t = 0;
    t.dur = duration;
    t.group.visible = true;
    t.group.position.set(x, 0.05, z);
    t.group.rotation.y = 0;
    t.outline.visible = true;
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
    return { cancel: () => this.release(t) };
  }

  private release(t: Telegraph): void {
    t.active = false;
    t.group.visible = false;
    if (t.annulus) {
      t.group.remove(t.annulus);
      t.annulus.geometry.dispose();
      t.annulus = null;
    }
  }

  update(dt: number): void {
    for (const t of this.pool) {
      if (!t.active) continue;
      t.t += dt;
      const k = Math.min(1, t.t / t.dur);
      const pulse = 0.75 + Math.sin(t.t * 18) * 0.25;
      if (t.shape === "circle") {
        t.fill.scale.setScalar(Math.max(0.001, t.radius * k));
        t.fillMat.opacity = 0.16 + k * 0.3;
        t.outlineMat.opacity = 0.85 * pulse;
      } else if (t.shape === "ring") {
        t.fillMat.opacity = 0.14 + k * 0.34;
        t.outlineMat.opacity = 0.85 * pulse;
      } else {
        t.sweep.scale.z = Math.max(0.001, t.length * k);
        t.sweepMat.opacity = 0.3 + k * 0.3;
        t.zoneMat.opacity = 0.18 * pulse + k * 0.08;
      }
      if (k >= 1) this.release(t);
    }
  }
}
