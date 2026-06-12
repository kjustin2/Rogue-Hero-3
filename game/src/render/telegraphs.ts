import * as THREE from "three";

interface Telegraph {
  group: THREE.Group;
  outline: THREE.Mesh;
  fill: THREE.Mesh;
  outlineMat: THREE.MeshBasicMaterial;
  fillMat: THREE.MeshBasicMaterial;
  t: number;
  dur: number;
  radius: number;
  shape: "circle" | "line";
  active: boolean;
}

export interface TelegraphHandle {
  cancel(): void;
}

/**
 * Pooled attack telegraphs: an outline marks the danger area immediately,
 * an inner fill grows to meet it — when they touch, the hit lands.
 * Readable threat windows are the contract that makes hard hits fair.
 */
export class Telegraphs {
  private pool: Telegraph[] = [];

  constructor(private scene: THREE.Scene) {
    const outlineGeo = new THREE.RingGeometry(0.93, 1.0, 48);
    outlineGeo.rotateX(-Math.PI / 2);
    const fillGeo = new THREE.CircleGeometry(1, 48);
    fillGeo.rotateX(-Math.PI / 2);

    for (let i = 0; i < 24; i++) {
      const group = new THREE.Group();
      const outlineMat = new THREE.MeshBasicMaterial({
        color: 0xff3344,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const fillMat = outlineMat.clone();
      const outline = new THREE.Mesh(outlineGeo, outlineMat);
      const fill = new THREE.Mesh(fillGeo, fillMat);
      fill.position.y = 0.01;
      group.add(outline, fill);
      group.visible = false;
      this.scene.add(group);
      this.pool.push({ group, outline, fill, outlineMat, fillMat, t: 0, dur: 1, radius: 1, shape: "circle", active: false });
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
    t.outline.scale.set(radius, 1, radius);
    t.outline.position.set(0, 0, 0);
    t.fill.scale.setScalar(0.001);
    t.fill.position.set(0, 0.01, 0);
    t.outlineMat.color.set(color);
    t.fillMat.color.set(color);
    t.outlineMat.opacity = 0.85;
    t.fillMat.opacity = 0.22;
    return { cancel: () => this.release(t) };
  }

  /** Rectangular strip from (x,z) along `angle` for `length`, width `width`. */
  line(x: number, z: number, angle: number, length: number, width: number, duration: number, color = 0xff3344): TelegraphHandle {
    const t = this.pool.find((p) => !p.active);
    if (!t) return { cancel() {} };
    t.active = true;
    t.shape = "line";
    t.t = 0;
    t.dur = duration;
    t.radius = 1;
    t.group.visible = true;
    t.group.position.set(x, 0.05, z);
    t.group.rotation.y = -angle;
    // Outline ring abused as thin caps; fill is the strip
    t.outline.scale.set(width * 0.5, 1, width * 0.5);
    t.outline.position.set(length, 0, 0);
    t.fill.scale.set(0.001, 1, width * 0.5);
    t.fill.position.set(0, 0.01, 0);
    t.outlineMat.color.set(color);
    t.fillMat.color.set(color);
    t.outlineMat.opacity = 0.7;
    t.fillMat.opacity = 0.3;
    return { cancel: () => this.release(t) };
  }

  private release(t: Telegraph): void {
    t.active = false;
    t.group.visible = false;
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
      } else {
        // Strip grows along its length; geometry is a unit circle so scale.x stretches it
        // (drawn as a squashed ellipse — reads fine as a beam path)
        const len = t.outline.position.x;
        t.fill.scale.x = Math.max(0.001, len * k);
        t.fill.position.x = (len * k) * 0.5;
        t.fillMat.opacity = 0.18 + k * 0.32;
        t.outlineMat.opacity = 0.7 * pulse;
      }
      if (k >= 1) this.release(t);
    }
  }
}
