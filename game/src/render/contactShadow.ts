import * as THREE from "three";

/**
 * Universal blob contact-shadows (IDEAS-GRAPHICS #3). A pool of soft radial-gradient
 * quads laid flat under every actor so nothing floats — the #1 amateur tell, and on
 * the low tier (real shadow map off) the ONLY grounding cue. NORMAL-blended (darkens
 * the floor, never washes it additive-white).
 *
 * One shared texture + material; the manager repositions pooled planes under the hero
 * and living enemies each frame (no per-entity wiring, no per-frame allocation).
 */
export class ContactShadows {
  private group = new THREE.Group();
  private pool: THREE.Mesh[] = [];
  private mat: THREE.MeshBasicMaterial;
  private geo = new THREE.PlaneGeometry(1, 1);
  private disabled = false;

  /** Debug bisection toggle (effectsToggle panel). */
  setVisible(on: boolean): void { this.disabled = !on; this.group.visible = on; }

  constructor(scene: THREE.Scene, max = 48) {
    const tex = makeBlobTexture();
    this.mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      color: 0x000000,
      blending: THREE.NormalBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    for (let i = 0; i < max; i++) {
      const m = new THREE.Mesh(this.geo, this.mat);
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = -2; // stable stack: decals(-3) < contact(-2) < enemy glow(-1) — no flicker
      m.visible = false;
      this.group.add(m);
      this.pool.push(m);
    }
    this.group.matrixAutoUpdate = false;
    scene.add(this.group);
  }

  /** Place one blob per actor: {x,z,radius}. Extra pool entries hide. */
  update(actors: { x: number; z: number; radius: number; y?: number }[]): void {
    if (this.disabled) return;
    for (let i = 0; i < this.pool.length; i++) {
      const m = this.pool[i];
      const a = actors[i];
      if (!a) { if (m.visible) m.visible = false; continue; }
      m.visible = true;
      const s = Math.max(0.6, a.radius * 2.6);
      m.position.set(a.x, (a.y ?? 0) + 0.03, a.z);
      m.scale.set(s, s, 1);
      m.updateMatrix();
    }
  }
}

function makeBlobTexture(): THREE.CanvasTexture {
  const size = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const g = cv.getContext("2d")!;
  const c = size / 2;
  const grad = g.createRadialGradient(c, c, 0, c, c, c);
  grad.addColorStop(0, "rgba(0,0,0,0.9)");
  grad.addColorStop(0.55, "rgba(0,0,0,0.45)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
