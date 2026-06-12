import * as THREE from "three";

const MAX_PARTICLES = 4096;

export interface BurstOpts {
  x: number;
  y: number;
  z: number;
  count: number;
  /** One color or a palette to pick from per particle. */
  color: number | number[];
  speed?: [number, number];
  /** Upward bias added to the random direction (0 = full sphere). */
  up?: number;
  /** Flatten vertical spread (1 = sphere, 0 = disc). */
  vertical?: number;
  size?: [number, number];
  life?: [number, number];
  gravity?: number;
  drag?: number;
  /** Random spawn offset radius. */
  jitter?: number;
}

/**
 * Single pooled GPU point cloud for every spark/ember/burst in the game,
 * plus a pool of expanding ring meshes for shockwaves. Additive, bloom-friendly.
 */
export class Particles {
  private geometry: THREE.BufferGeometry;
  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;
  private fades: Float32Array;
  private velocities: Float32Array;
  private life: Float32Array;
  private lifeTotal: Float32Array;
  private gravity: Float32Array;
  private drag: Float32Array;
  private cursor = 0;
  private points: THREE.Points;

  // Ambient ember emitter
  ambientRate = 0;
  ambientColor = 0xff8844;
  ambientRadius = 20;
  private ambientAcc = 0;

  private rings: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; t: number; dur: number; from: number; to: number }[] = [];

  constructor(private scene: THREE.Scene) {
    this.positions = new Float32Array(MAX_PARTICLES * 3);
    this.colors = new Float32Array(MAX_PARTICLES * 3);
    this.sizes = new Float32Array(MAX_PARTICLES);
    this.fades = new Float32Array(MAX_PARTICLES);
    this.velocities = new Float32Array(MAX_PARTICLES * 3);
    this.life = new Float32Array(MAX_PARTICLES);
    this.lifeTotal = new Float32Array(MAX_PARTICLES);
    this.gravity = new Float32Array(MAX_PARTICLES);
    this.drag = new Float32Array(MAX_PARTICLES);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("aColor", new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute("aSize", new THREE.BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute("aFade", new THREE.BufferAttribute(this.fades, 1));

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aFade;
        varying vec3 vColor;
        varying float vFade;
        void main() {
          vColor = aColor;
          vFade = aFade;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * aFade * (240.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vFade;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv) * 2.0;
          float a = smoothstep(1.0, 0.15, d) * vFade;
          gl_FragColor = vec4(vColor * (1.0 + (1.0 - d) * 1.4), a);
        }
      `,
    });

    this.points = new THREE.Points(this.geometry, material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    // Pre-build ring pool
    const ringGeo = new THREE.RingGeometry(0.88, 1.0, 48);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 28; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.rings.push({ mesh, mat, t: 0, dur: 0, from: 0, to: 0 });
    }
  }

  burst(opts: BurstOpts): void {
    const speed = opts.speed ?? [3, 8];
    const size = opts.size ?? [0.5, 1.1];
    const life = opts.life ?? [0.3, 0.7];
    const up = opts.up ?? 0.35;
    const vertical = opts.vertical ?? 1;
    const gravity = opts.gravity ?? -9;
    const drag = opts.drag ?? 2.5;
    const jitter = opts.jitter ?? 0.15;
    const palette = Array.isArray(opts.color) ? opts.color : [opts.color];
    const tmp = new THREE.Color();

    for (let n = 0; n < opts.count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_PARTICLES;
      const i3 = i * 3;

      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      let dx = Math.sin(phi) * Math.cos(theta);
      let dy = Math.cos(phi) * vertical + up;
      let dz = Math.sin(phi) * Math.sin(theta);
      const inv = 1 / Math.max(0.001, Math.sqrt(dx * dx + dy * dy + dz * dz));
      const spd = speed[0] + Math.random() * (speed[1] - speed[0]);
      dx *= inv * spd;
      dy *= inv * spd;
      dz *= inv * spd;

      this.positions[i3] = opts.x + (Math.random() - 0.5) * jitter * 2;
      this.positions[i3 + 1] = opts.y + (Math.random() - 0.5) * jitter;
      this.positions[i3 + 2] = opts.z + (Math.random() - 0.5) * jitter * 2;
      this.velocities[i3] = dx;
      this.velocities[i3 + 1] = dy;
      this.velocities[i3 + 2] = dz;

      tmp.set(palette[Math.floor(Math.random() * palette.length)]);
      this.colors[i3] = tmp.r;
      this.colors[i3 + 1] = tmp.g;
      this.colors[i3 + 2] = tmp.b;

      this.sizes[i] = size[0] + Math.random() * (size[1] - size[0]);
      const lf = life[0] + Math.random() * (life[1] - life[0]);
      this.life[i] = lf;
      this.lifeTotal[i] = lf;
      this.fades[i] = 1;
      this.gravity[i] = gravity;
      this.drag[i] = drag;
    }
  }

  /** Expanding ground shockwave ring. */
  ring(x: number, z: number, opts: { radius: number; color: number; duration?: number; y?: number; startRadius?: number }): void {
    const slot = this.rings.find((r) => !r.mesh.visible);
    if (!slot) return;
    slot.mesh.visible = true;
    slot.mesh.position.set(x, opts.y ?? 0.06, z);
    slot.t = 0;
    slot.dur = opts.duration ?? 0.45;
    slot.from = opts.startRadius ?? opts.radius * 0.15;
    slot.to = opts.radius;
    slot.mat.color.set(opts.color);
    slot.mat.opacity = 0.9;
    slot.mesh.scale.setScalar(slot.from);
  }

  update(dt: number): void {
    // Ambient embers
    if (this.ambientRate > 0) {
      this.ambientAcc += dt * this.ambientRate;
      while (this.ambientAcc >= 1) {
        this.ambientAcc -= 1;
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * this.ambientRadius;
        this.burst({
          x: Math.cos(a) * r,
          y: 0.2 + Math.random() * 1.5,
          z: Math.sin(a) * r,
          count: 1,
          color: this.ambientColor,
          speed: [0.2, 0.7],
          up: 1.6,
          vertical: 0.3,
          size: [0.25, 0.55],
          life: [2.2, 4.5],
          gravity: 0.35,
          drag: 0.4,
          jitter: 0.1,
        });
      }
    }

    let anyAlive = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i] <= 0) continue;
      anyAlive = true;
      this.life[i] -= dt;
      const i3 = i * 3;
      if (this.life[i] <= 0) {
        this.fades[i] = 0;
        this.positions[i3 + 1] = -999;
        continue;
      }
      const dragF = Math.exp(-this.drag[i] * dt);
      this.velocities[i3] *= dragF;
      this.velocities[i3 + 1] = this.velocities[i3 + 1] * dragF + this.gravity[i] * dt;
      this.velocities[i3 + 2] *= dragF;
      this.positions[i3] += this.velocities[i3] * dt;
      this.positions[i3 + 1] += this.velocities[i3 + 1] * dt;
      this.positions[i3 + 2] += this.velocities[i3 + 2] * dt;
      if (this.positions[i3 + 1] < 0.02) {
        this.positions[i3 + 1] = 0.02;
        this.velocities[i3 + 1] *= -0.35;
      }
      this.fades[i] = Math.min(1, this.life[i] / (this.lifeTotal[i] * 0.55));
    }
    // Skip the (large) buffer re-uploads on quiet frames
    if (anyAlive) {
      this.geometry.attributes.position.needsUpdate = true;
      this.geometry.attributes.aColor.needsUpdate = true;
      this.geometry.attributes.aSize.needsUpdate = true;
      this.geometry.attributes.aFade.needsUpdate = true;
    }

    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.t += dt;
      const k = Math.min(1, r.t / r.dur);
      const eased = 1 - Math.pow(1 - k, 3);
      r.mesh.scale.setScalar(r.from + (r.to - r.from) * eased);
      r.mat.opacity = 0.9 * (1 - k);
      if (k >= 1) r.mesh.visible = false;
    }
  }
}
