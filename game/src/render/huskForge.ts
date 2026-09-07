import * as THREE from "three";
import { batchSculpt, loft, relief, tube } from "./sculpt";

/** Emaciated scavenger: bent spine, exposed rib cage and a reaching, predatory silhouette. */
export function forgeHusk(root: THREE.Group, material: (color: number, emissive?: number, intensity?: number) => THREE.MeshStandardMaterial) {
  const skin=material(0x6b544b); skin.roughness=0.9;skin.metalness=0;
  const bone=material(0xbcb096);bone.roughness=0.82;bone.metalness=0;
  const leather=material(0x302c29);leather.roughness=0.95;leather.metalness=0;
  const eyeMat=material(0x24170f,0xff9d51,1.4);
  const put=(g: THREE.BufferGeometry,m: THREE.Material,x: number,y: number,z: number,parent: THREE.Object3D=root)=>{
    const mesh=new THREE.Mesh(g,m);mesh.position.set(x,y,z);mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);return mesh;
  };
  const oval=(rx:number,ry:number,rz:number,m:THREE.Material,x:number,y:number,z:number,parent:THREE.Object3D=root)=>{
    const g=new THREE.SphereGeometry(1,16,10);g.scale(rx,ry,rz);return put(g,m,x,y,z,parent);
  };
  put(loft([{y:0.42,x:0.18,z:0.12},{y:0.62,x:0.2,z:0.13},{y:0.82,x:0.31,z:0.22,offsetZ:-0.04},{y:1.07,x:0.29,z:0.24,offsetZ:-0.1},{y:1.19,x:0.15,z:0.12,offsetZ:-0.04}],20),skin,0,0,0);
  oval(0.18,0.24,0.13,leather,0,0.77,0.16);
  for(const sign of [-1,1]) {
    for(let i=0;i<4;i++) {
      const y=0.66+i*0.11,w=0.19+Math.sin(i/4*Math.PI)*0.085;
      put(tube([[sign*0.014,y,0.27],[sign*w,y+0.04,0.22],[sign*(w+0.02),y+0.08,0.01]],0.028,12),bone,0,0,0);
    }
    put(tube([[sign*0.03,1.03,0.16],[sign*0.22,1.11,0.11],[sign*0.36,1.06,0.015]],0.04,12),bone,0,0,0);
  }
  put(tube([[0,0.57,-0.13],[0,0.88,-0.29],[0,1.14,-0.25],[0,1.28,0.08]],0.036,18),bone,0,0,0);
  for(let i=0;i<5;i++) oval(0.055,0.045,0.06,bone,0,0.69+i*0.11,-0.18-Math.sin(i/5*Math.PI)*0.1);
  // Hollow skull with cheekbones, split jaw and uneven teeth.
  oval(0.2,0.2,0.24,bone,0,1.2,0.24);
  oval(0.12,0.085,0.15,leather,0,1.12,0.405);
  for(const sign of [-1,1]) {
    oval(0.078,0.065,0.035,leather,sign*0.096,1.25,0.448);
    put(relief([[0,0.018],[sign*0.08,0.043],[sign*0.067,-0.002]],0.01,0.002),eyeMat,sign*0.05,1.246,0.481);
    put(tube([[sign*0.17,1.19,0.33],[sign*0.17,1.07,0.47],[sign*0.06,1.01,0.47]],0.035,12),bone,0,0,0);
    for(let i=0;i<3;i++) {
      const tooth=put(new THREE.ConeGeometry(0.021,0.07+(i%2)*0.035,6),bone,sign*(0.032+i*0.039),1.115,0.509);
      tooth.rotation.x=Math.PI;
    }
    const arm=new THREE.Group();arm.position.set(sign*0.32,1.02,0.03);root.add(arm);
    oval(0.13,0.12,0.14,skin,0,0,0,arm);
    put(tube([[0,0,0],[sign*0.12,-0.23,0.23],[sign*0.16,-0.2,0.53]],0.065,16),skin,0,0,0,arm);
    put(tube([[sign*0.05,-0.06,0.08],[sign*0.13,-0.23,0.24],[sign*0.19,-0.22,0.48]],0.026,16),bone,0,0,0,arm);
    oval(0.1,0.048,0.13,skin,sign*0.17,-0.23,0.57,arm);
    for(let f=0;f<3;f++) {
      const x=sign*0.17+(f-1)*0.068;
      put(tube([[x,-0.22,0.6],[x,-0.23,0.76],[x,-0.32,0.82]],0.019,12),bone,0,0,0,arm);
    }
    arm.rotation.x=sign*0.14;
  }
  const legs:THREE.Group[]=[];
  for(const sign of [-1,1]) {
    const leg=new THREE.Group();leg.position.set(sign*0.2,0.5,0);root.add(leg);legs.push(leg);
    put(tube([[0,0,0],[sign*0.04,-0.2,0.055],[sign*0.07,-0.43,-0.02]],0.074,16),skin,0,0,0,leg);
    put(tube([[0,-0.05,0.075],[sign*0.04,-0.22,0.12],[sign*0.065,-0.43,0.055]],0.026,12),bone,0,0,0,leg);
    oval(0.1,0.049,0.18,leather,sign*0.07,-0.45,0.08,leg);
    for(let toe=0;toe<3;toe++)put(tube([[(toe-1)*0.052+sign*0.07,-0.45,0.15],[(toe-1)*0.052+sign*0.07,-0.47,0.26]],0.018,8),bone,0,0,0,leg);
    put(relief([[-0.12,0.1],[0.1,0.1],[0.13,-0.14],[0.025,-0.11],[-0.05,-0.19],[-0.1,-0.12]],0.02,0.005),leather,sign*0.15,0.48,0.12);
  }
  batchSculpt(root);
  return {eyeMat,legL:legs[0],legR:legs[1]};
}
