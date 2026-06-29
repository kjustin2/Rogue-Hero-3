import * as THREE from "three";

const MAX_SEGS = 14;
const SEG_LIFE = 0.16;

interface Seg {
  tip: THREE.Vector3;
  base: THREE.Vector3;
  age: number;
}

/**
 * Ribbon trail behind the sword blade — a strip of quads between recent
 * (tip, base) sample pairs, fading by age. Rebuilt on the CPU each frame
 * (≈80 verts, trivial) into a single additive mesh.
 */
export class SwordTrail {
  // Fixed ring of pre-allocated segments (oldest-first via head/count). An active
  // blade allocates nothing per frame: tip/base are copied into pooled Vector3s
  // rather than cloned, and the strip is built through a method, not a fresh closure.
  private pool: Seg[] = Array.from({ length: MAX_SEGS }, () => ({ tip: new THREE.Vector3(), base: new THREE.Vector3(), age: 0 }));
  private head = 0;
  private count = 0;
  private mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private positions: Float32Array;
  private alphas: Float32Array;
  private geometry: THREE.BufferGeometry;

  constructor(scene: THREE.Scene) {
    const maxVerts = (MAX_SEGS - 1) * 6;
    this.positions = new Float32Array(maxVerts * 3);
    this.alphas = new Float32Array(maxVerts);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("aAlpha", new THREE.BufferAttribute(this.alphas, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(0x44ccff) } },
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          gl_FragColor = vec4(uColor * (1.0 + vAlpha), vAlpha * 0.55);
        }
      `,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  setColor(c: number): void {
    (this.mat.uniforms.uColor.value as THREE.Color).set(c);
  }

  /** The i-th live segment, oldest-first (i in 0..count-1). */
  private segAt(i: number): Seg { return this.pool[(this.head + i) % MAX_SEGS]; }

  private writeVert(v: number, p: THREE.Vector3, a: number): void {
    this.positions[v * 3] = p.x;
    this.positions[v * 3 + 1] = p.y;
    this.positions[v * 3 + 2] = p.z;
    this.alphas[v] = a;
  }

  update(dt: number, tip: THREE.Vector3, base: THREE.Vector3, active: boolean): void {
    // Age out old segments. They age monotonically and are stored oldest-first, so
    // the expired ones are always at the front — drop them by advancing the ring head.
    for (let i = 0; i < this.count; i++) this.segAt(i).age += dt;
    while (this.count > 0 && this.segAt(0).age >= SEG_LIFE) { this.head = (this.head + 1) % MAX_SEGS; this.count--; }

    if (active) {
      // Reuse a pooled slot at the back; if the ring is full, overwrite the oldest.
      let slot: Seg;
      if (this.count < MAX_SEGS) { slot = this.pool[(this.head + this.count) % MAX_SEGS]; this.count++; }
      else { slot = this.pool[this.head]; this.head = (this.head + 1) % MAX_SEGS; }
      slot.tip.copy(tip); slot.base.copy(base); slot.age = 0;
    }

    if (this.count < 2) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;

    let v = 0;
    for (let i = 0; i < this.count - 1; i++) {
      const s0 = this.segAt(i);
      const s1 = this.segAt(i + 1);
      const a0 = 1 - s0.age / SEG_LIFE;
      const a1 = 1 - s1.age / SEG_LIFE;
      this.writeVert(v++, s0.base, a0); this.writeVert(v++, s0.tip, a0); this.writeVert(v++, s1.tip, a1);
      this.writeVert(v++, s0.base, a0); this.writeVert(v++, s1.tip, a1); this.writeVert(v++, s1.base, a1);
    }
    this.geometry.setDrawRange(0, v);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
  }
}
