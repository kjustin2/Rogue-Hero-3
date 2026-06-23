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
  private segs: Seg[] = [];
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

  update(dt: number, tip: THREE.Vector3, base: THREE.Vector3, active: boolean): void {
    // Age out old segments. They age monotonically and are stored oldest-first,
    // so the expired ones are always at the front — shift them off in place
    // instead of allocating a new array via filter() every single frame.
    for (const s of this.segs) s.age += dt;
    while (this.segs.length && this.segs[0].age >= SEG_LIFE) this.segs.shift();

    if (active) {
      this.segs.push({ tip: tip.clone(), base: base.clone(), age: 0 });
      if (this.segs.length > MAX_SEGS) this.segs.shift();
    }

    if (this.segs.length < 2) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;

    let v = 0;
    const put = (p: THREE.Vector3, a: number) => {
      this.positions[v * 3] = p.x;
      this.positions[v * 3 + 1] = p.y;
      this.positions[v * 3 + 2] = p.z;
      this.alphas[v] = a;
      v++;
    };
    for (let i = 0; i < this.segs.length - 1; i++) {
      const s0 = this.segs[i];
      const s1 = this.segs[i + 1];
      const a0 = 1 - s0.age / SEG_LIFE;
      const a1 = 1 - s1.age / SEG_LIFE;
      put(s0.base, a0); put(s0.tip, a0); put(s1.tip, a1);
      put(s0.base, a0); put(s1.tip, a1); put(s1.base, a1);
    }
    this.geometry.setDrawRange(0, v);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
  }
}
