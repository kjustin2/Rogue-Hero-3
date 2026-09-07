import * as THREE from "three";
import { batchSculpt, horn, loft, tube } from "./sculpt";

/** A crawling, many-limbed maw with a watching eye and an exposed red seam. */
export function forgeWound(root:THREE.Group,material:(color:number,emissive?:number,intensity?:number)=>THREE.MeshStandardMaterial) {
  const flesh=material(0x614548);flesh.roughness=0.88;flesh.metalness=0;
  const carapace=material(0x38333b);carapace.roughness=0.6;carapace.metalness=0.18;
  const bone=material(0xbba38c);bone.roughness=0.76;bone.metalness=0;
  const cavity=material(0x160f15);cavity.roughness=1;
  const coreMat=material(0x682730,0xb94052,0.25);
  const eyeMat=material(0xc7ab91,0xecc4b0,0.65);
  const seamMat=material(0x732b3b,0xaf435a,0.25);
  const put=(geo:THREE.BufferGeometry,mat:THREE.Material,x:number,y:number,z:number,parent:THREE.Object3D=root)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;parent.add(m);return m;};
  const oval=(rx:number,ry:number,rz:number,mat:THREE.Material,x:number,y:number,z:number,parent:THREE.Object3D=root)=>{const geo=new THREE.SphereGeometry(1,28,18);geo.scale(rx,ry,rz);return put(geo,mat,x,y,z,parent);};
  const talons:THREE.Object3D[]=[],phaseSpurs:THREE.Object3D[]=[];
  oval(1.39,0.65,1.18,flesh,0,0.81,-0.04);
  // Five hard overlapping back plates surround a split, living seam.
  const mantle=new THREE.Group();root.add(mantle);
  for(let row=0;row<5;row++) {
    const z=0.4-row*0.34,span=1.07-Math.abs(row-2)*0.12;
    for(const sign of [-1,1]) {
      const plate=put(loft([{y:-0.19,x:span*0.47,z:0.24},{y:0,x:span*0.55,z:0.29},{y:0.22,x:span*0.38,z:0.22},{y:0.28,x:span*0.13,z:0.12}],24),carapace,sign*span*0.6,1.2,z,mantle);
      plate.rotation.z=sign*-0.28;
      put(tube([[sign*0.14,1.4,z+0.18],[sign*0.52,1.46,z+0.14],[sign*0.98,1.26,z]],0.034),bone,0,0,0,mantle);
    }
    oval(0.15,0.11,0.26,coreMat,0,1.38,z);
  }
  // The mouth is a genuine dark opening bordered by gums and two rows of curved teeth.
  oval(0.7,0.49,0.075,cavity,0,0.69,1.06);
  const lips=put(new THREE.TorusGeometry(0.57,0.12,12,48),flesh,0,0.71,1.04);lips.scale.set(1.22,0.83,1);
  for(let i=0;i<14;i++) {
    const a=i/14*Math.PI*2,x=Math.sin(a)*0.57,y=0.71+Math.cos(a)*0.4;
    put(horn([[x,y,1.11],[x*0.87,0.71+(y-0.71)*0.62,1.3],[x*0.73,0.71+(y-0.71)*0.44,1.17]],0.062,18),bone,0,0,0);
  }
  oval(0.51,0.35,0.28,carapace,0,1.38,0.92);
  const eye=oval(0.37,0.19,0.08,eyeMat,0,1.38,1.175);
  const pupil=oval(0.053,0.16,0.02,cavity,0,0,0.08,eye);
  pupil.userData.castShadow=false;
  for(const sign of [-1,1]) {
    put(horn([[sign*0.31,1.35,1.05],[sign*0.53,1.49,1.02],[sign*0.73,1.65,0.9]],0.08,24),bone,0,0,0);
    put(horn([[sign*0.62,0.77,0.9],[sign*0.94,0.5,1.2],[sign*0.86,0.19,1.45],[sign*0.53,0.23,1.5]],0.14,28),bone,0,0,0);
  }
  // Paired, load-bearing claw limbs, with the heel and hooked tip in one joint.
  for(let i=0;i<8;i++) {
    const a=(i/8)*Math.PI*2+Math.PI/8;
    const leg=new THREE.Group();leg.position.set(Math.sin(a)*0.99,0.81,Math.cos(a)*0.87);leg.rotation.y=a;root.add(leg);talons.push(leg);
    oval(0.22,0.27,0.3,flesh,0,0,0,leg);
    put(horn([[0,0,0],[0,0.41,0.37],[0,0.5,0.74],[0,-0.31,1.18],[0,-0.79,1.22]],0.17,36),bone,0,0,0,leg);
    put(tube([[0.03,0.09,0.11],[0.04,0.44,0.41],[0.025,0.28,0.84]],0.04),seamMat,0,0,0,leg);
  }
  for(let i=0;i<6;i++) {
    const a=i/6*Math.PI*2;
    const spur=put(horn([[Math.sin(a)*0.73,1.25,Math.cos(a)*0.67-0.2],[Math.sin(a)*1.1,1.81,Math.cos(a)*0.9-0.25],[Math.sin(a)*0.89,2.39,Math.cos(a)*0.7-0.3]],0.15,30),bone,0,0,0);
    spur.visible=false;phaseSpurs.push(spur);
  }
  batchSculpt(root,[eye,...phaseSpurs]);
  return {coreMat,eyeMat,seamMat,eye,mantle,talons,phaseSpurs};
}
