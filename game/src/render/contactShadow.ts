import * as THREE from "three";

export interface FootContact { node: THREE.Object3D; offset: THREE.Vector3; radius: number; }
export interface ShadowActor { x: number; z: number; radius: number; y?: number; feet?: readonly FootContact[]; }

/**
 * Universal blob contact-shadows (IDEAS-GRAPHICS #3). A pool of soft radial-gradient
 * quads laid flat under every actor so nothing floats — the #1 amateur tell, and on
 * the low tier (real shadow map off) the ONLY grounding cue. NORMAL-blended (darkens
 * the floor, never washes it additive-white).
 *
 * Shared geometry/texture and fixed pooled planes. Articulated actors also place
 * small contact patches at their feet; airborne feet soften and fade naturally.
 */
export class ContactShadows {
  private group = new THREE.Group();
  private pool: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  private geo = new THREE.PlaneGeometry(1, 1);
  private point = new THREE.Vector3();
  private worldScale = new THREE.Vector3();

  constructor(scene: THREE.Scene, max = 64) {
    const tex = makeBlobTexture();
    const material = new THREE.MeshBasicMaterial({
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
      const m = new THREE.Mesh(this.geo, material.clone());
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = -2; // stable stack: decals(-3) < contact(-2) < enemy glow(-1) — no flicker
      m.visible = false;
      this.group.add(m);
      this.pool.push(m);
    }
    material.dispose();
    this.group.matrixAutoUpdate = false;
    this.group.userData.solidity = "fx";
    scene.add(this.group);
  }

  update(actors: readonly ShadowActor[]): void {
    let index=0;
    for (const a of actors) {
      const height=Math.max(0,a.y??0), s=Math.max(.6,a.radius*2.6)+height*.12;
      this.place(index++,a.x,a.z,s,a.feet?.length ? .28 : .55/(1+height*.18));
      for (const foot of a.feet??[]) {
        foot.node.updateWorldMatrix(true,false);
        this.point.copy(foot.offset).applyMatrix4(foot.node.matrixWorld);
        foot.node.getWorldScale(this.worldScale);
        const elevation=Math.max(0,this.point.y), size=foot.radius*this.worldScale.x*3+elevation*.18;
        this.place(index++,this.point.x,this.point.z,size,.78/(1+elevation*5));
      }
    }
    for(let i=index;i<this.pool.length;i++)this.pool[i].visible=false;
  }

  private place(index:number,x:number,z:number,size:number,opacity:number):void {
    const mesh=this.pool[index];if(!mesh)return;
    mesh.visible=true;mesh.position.set(x,.031,z);mesh.scale.set(size,size,1);
    mesh.material.opacity=opacity;mesh.updateMatrix();
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
