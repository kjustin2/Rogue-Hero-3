import * as THREE from "three";

interface Telegraph {
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
  /** Scrolling chevron-flow materials — line's zone/sweep strips + the ring band. */
  zoneMat: THREE.ShaderMaterial;
  sweepMat: THREE.ShaderMaterial;
  bandMat: THREE.ShaderMaterial;
  t: number;
  dur: number;
  radius: number;
  length: number;
  shape: "circle" | "line" | "ring";
  active: boolean;
}

// IDEAS #36 — scrolling directional telegraph shading. The line/ring warnings
// sample a baked chevron-stripe mask through a scrolling UV so the threat
// visibly FLOWS toward the impact point, instead of sitting as a flat tint.
// Circle telegraphs stay flat MeshBasicMaterial (a radial fill has no single
// "direction" to flow in, and it's already a clear read).

const FLOW_SPEED = 2.0; // chevron-tile scroll speed, tiles/second

const FLOW_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FLOW_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uScroll;
  uniform vec2 uRepeat;
  varying vec2 vUv;
  void main() {
    vec2 uv = vUv * uRepeat;
    uv.y -= uScroll; // subtracting time from the sample coords makes the
                      // pattern itself appear to travel toward +v
    float mask = texture2D(uMap, uv).a;
    gl_FragColor = vec4(uColor, mask * uOpacity);
    // Match MeshBasicMaterial's own shader tail so these tint identically to
    // every other additive telegraph/FX material under the renderer's ACES
    // tone mapping + output colour-space conversion (a custom ShaderMaterial
    // gets the prefix functions for free but must still call them itself).
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

let flowTexture: THREE.CanvasTexture | null = null;

/**
 * Chevron-stripe mask baked ONCE at boot: two soft '>' wedges pointing toward
 * +v, tiled via RepeatWrapping. Alpha carries the shape; colour comes from
 * each material's `uColor` uniform, so one texture serves every tint.
 */
function getFlowTexture(): THREE.CanvasTexture {
  if (flowTexture) return flowTexture;
  const size = 64;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const g = cv.getContext("2d")!;
  const wedge = (cy: number) => {
    const grad = g.createLinearGradient(0, cy - size * 0.24, 0, cy + size * 0.02);
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(1, "rgba(255,255,255,1)");
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, cy + size * 0.02);
    g.lineTo(size * 0.5, cy - size * 0.24);
    g.lineTo(size, cy + size * 0.02);
    g.lineTo(size * 0.5, cy - size * 0.06);
    g.closePath();
    g.fill();
  };
  wedge(size * 0.28);
  wedge(size * 0.78);
  flowTexture = new THREE.CanvasTexture(cv);
  flowTexture.wrapS = THREE.RepeatWrapping;
  flowTexture.wrapT = THREE.RepeatWrapping;
  flowTexture.generateMipmaps = false;
  flowTexture.minFilter = THREE.LinearFilter;
  flowTexture.magFilter = THREE.LinearFilter;
  return flowTexture;
}

/**
 * One shader PROGRAM shared by every flowing telegraph instance: each pool
 * slot gets its own ShaderMaterial (own uniforms, so concurrent telegraphs
 * can differ in colour/opacity/scroll independently), but identical GLSL
 * source plus a pinned `customProgramCacheKey` mean they all compile to a
 * single WebGLProgram — the same "many instances, one program" deal
 * MeshBasicMaterial already gets for free elsewhere in this file.
 */
function makeFlowMaterial(): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: getFlowTexture() },
      uColor: { value: new THREE.Color(0xff3344) },
      uOpacity: { value: 0 },
      uScroll: { value: 0 },
      uRepeat: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader: FLOW_VERT,
    fragmentShader: FLOW_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  m.customProgramCacheKey = () => "rh3-telegraph-flow";
  return m;
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
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
      const outlineMat = mat();
      const fillMat = mat();
      const impactMat = mat();
      const zoneMat = makeFlowMaterial();
      const sweepMat = makeFlowMaterial();
      const bandMat = makeFlowMaterial();
      const outline = new THREE.Mesh(outlineGeo, outlineMat);
      const fill = new THREE.Mesh(fillGeo, fillMat);
      const impact = new THREE.Mesh(outlineGeo, impactMat);
      const zone = new THREE.Mesh(stripGeo, zoneMat);
      const sweep = new THREE.Mesh(stripGeo, sweepMat);
      fill.position.y = 0.01;
      impact.position.y = 0.025;
      sweep.position.y = 0.01;
      group.add(outline, fill, impact, zone, sweep);
      group.visible = false;
      this.scene.add(group);
      this.pool.push({
        group, outline, fill, impact, zone, sweep, annulus: null,
        outlineMat, fillMat, impactMat, zoneMat, sweepMat, bandMat,
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
    t.outline.visible = t.fill.visible = t.impact.visible = true;
    t.zone.visible = t.sweep.visible = false;
    t.outline.scale.set(radius, 1, radius);
    t.fill.scale.setScalar(0.001);
    t.impact.scale.set(radius * 0.9, 1, radius * 0.9);
    t.outlineMat.color.set(color);
    t.fillMat.color.set(color);
    t.impactMat.color.set(0xffffff);
    t.outlineMat.opacity = 0.85;
    t.fillMat.opacity = 0.22;
    t.impactMat.opacity = 0;
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
    t.outline.visible = t.fill.visible = t.impact.visible = false;
    t.zone.visible = t.sweep.visible = true;
    t.zone.scale.set(width, 1, length);
    t.sweep.scale.set(width, 1, 0.001);
    t.zoneMat.uniforms.uColor.value.set(color);
    t.sweepMat.uniforms.uColor.value.set(color);
    t.zoneMat.uniforms.uOpacity.value = 0.18;
    t.sweepMat.uniforms.uOpacity.value = 0.4;
    // Chevrons tile along the strip's length toward the far (impact) end at a
    // roughly constant world pitch; a single motif spans the width untiled.
    const tiles = Math.max(1, length / 1.6);
    t.zoneMat.uniforms.uRepeat.value.set(1, tiles);
    t.sweepMat.uniforms.uRepeat.value.set(1, tiles);
    t.zoneMat.uniforms.uScroll.value = 0;
    t.sweepMat.uniforms.uScroll.value = 0;
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
    t.impact.visible = false;
    t.fill.visible = t.zone.visible = t.sweep.visible = false;
    t.outline.scale.set(outerR, 1, outerR);
    t.outlineMat.color.set(color);
    t.outlineMat.opacity = 0.85;
    const geo = new THREE.RingGeometry(innerR, outerR, 64);
    // RingGeometry's default UV is a bounding-box projection, not radial —
    // remap it so v runs 0 (inner edge) -> 1 (outer edge) and u wraps once
    // around, which is what lets the chevrons flow radially inward toward
    // the impact band instead of smearing across the ring at odd angles.
    const pos = geo.attributes.position;
    const span = Math.max(0.0001, outerR - innerR);
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      uv[i * 2] = Math.atan2(py, px) / (Math.PI * 2) + 0.5;
      uv[i * 2 + 1] = (Math.sqrt(px * px + py * py) - innerR) / span;
    }
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.rotateX(-Math.PI / 2);
    t.annulus = new THREE.Mesh(geo, t.bandMat);
    t.annulus.position.y = 0.01;
    t.bandMat.uniforms.uColor.value.set(color);
    t.bandMat.uniforms.uOpacity.value = 0.18;
    const circumference = outerR * Math.PI * 2;
    t.bandMat.uniforms.uRepeat.value.set(
      Math.max(6, Math.round(circumference / 1.4)),
      Math.max(1, Math.round(span / 0.5)),
    );
    t.bandMat.uniforms.uScroll.value = 0;
    t.group.add(t.annulus);
    return { cancel: () => this.release(t) };
  }

  private release(t: Telegraph): void {
    t.active = false;
    t.group.visible = false;
    t.impact.visible = false;
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
      const late = Math.max(0, (k - 0.72) / 0.28);
      if (t.shape === "circle") {
        t.fill.scale.setScalar(Math.max(0.001, t.radius * k));
        const impactScale = t.radius * (0.9 + late * 0.18);
        t.impact.scale.set(impactScale, 1, impactScale);
        t.fillMat.opacity = 0.14 + k * 0.24 + late * 0.18;
        t.outlineMat.opacity = Math.min(1, 0.72 * pulse + late * 0.38);
        t.impactMat.opacity = late > 0 ? Math.min(0.95, (0.24 + late * 0.7) * pulse) : 0;
      } else if (t.shape === "ring") {
        t.bandMat.uniforms.uOpacity.value = 0.14 + k * 0.34;
        t.outlineMat.opacity = Math.min(1, 0.78 * pulse + late * 0.28);
        t.bandMat.uniforms.uScroll.value = (t.bandMat.uniforms.uScroll.value + dt * FLOW_SPEED) % 1;
      } else {
        const endPulse = Math.max(0, (k - 0.78) / 0.22);
        t.sweep.scale.z = Math.max(0.001, t.length * k);
        t.sweepMat.uniforms.uOpacity.value = Math.min(0.95, 0.28 + k * 0.32 + endPulse * 0.35);
        t.zoneMat.uniforms.uOpacity.value = Math.min(0.42, 0.16 * pulse + k * 0.06 + endPulse * 0.12);
        t.zoneMat.uniforms.uScroll.value = (t.zoneMat.uniforms.uScroll.value + dt * FLOW_SPEED) % 1;
        t.sweepMat.uniforms.uScroll.value = (t.sweepMat.uniforms.uScroll.value + dt * FLOW_SPEED) % 1;
      }
      if (k >= 1) this.release(t);
    }
  }
}
