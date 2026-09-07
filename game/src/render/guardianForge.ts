import * as THREE from "three";
import { batchSculpt, loft, relief, tube } from "./sculpt";

/** Armored field roles share joints, with their actual equipment defining the silhouette. */
export function forgeGuardian(root:THREE.Group,material:(color:number,emissive?:number,intensity?:number)=>THREE.MeshStandardMaterial,kind:"sentinel"|"mirror"|"bastion") {
  const mirror=kind==="mirror",bastion=kind==="bastion";
  const plate=material(mirror?0x71858e:0x3e424b);plate.metalness=mirror?0.66:0.38;plate.roughness=mirror?0.47:0.74;plate.envMapIntensity=0.55;
  const trim=material(mirror?0xbbcbd0:0x968061);trim.metalness=0.8;trim.roughness=0.42;
  const hide=material(0x332d2b);hide.roughness=0.93;hide.metalness=0;
  const dark=material(0x171d24);dark.roughness=0.76;
  const eyeMat=material(0x17232c,mirror?0x9dd7ea:0xe89965,1.1);
  const shieldMat=bastion?new THREE.MeshStandardMaterial({color:0x927250,emissive:0xff7a2a,emissiveIntensity:0.22,metalness:0.75,roughness:0.5}):trim;
  const plateMat=bastion?new THREE.MeshStandardMaterial({color:0x43454a,emissive:0xff7a2a,emissiveIntensity:0.025,metalness:0.76,roughness:0.58}):plate;
  const put=(geo:THREE.BufferGeometry,mat:THREE.Material,x:number,y:number,z:number,parent:THREE.Object3D=root)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;parent.add(m);return m;};
  const oval=(rx:number,ry:number,rz:number,mat:THREE.Material,x:number,y:number,z:number,parent:THREE.Object3D=root)=>{const g=new THREE.SphereGeometry(1,20,14);g.scale(rx,ry,rz);return put(g,mat,x,y,z,parent);};
  const joint=(x:number,y:number,z:number,parent:THREE.Object3D=root)=>{const g=new THREE.Group();g.position.set(x,y,z);parent.add(g);return g;};
  const torso=joint(0,1.2,0);
  put(loft([{y:-0.49,x:0.3,z:0.23},{y:-0.27,x:0.37,z:0.28},{y:0.19,x:0.48,z:0.32},{y:0.45,x:0.4,z:0.29},{y:0.5,x:0.19,z:0.18}],28,0.74),plate,0,0,0,torso);
  put(relief([[-0.34,0.3],[0.34,0.3],[0.3,-0.12],[0,-0.35],[-0.3,-0.12]],0.08,0.028),trim,0,0.07,0.32,torso);
  put(relief([[-0.27,0.25],[0.27,0.25],[0.23,-0.1],[0,-0.27],[-0.23,-0.1]],0.04,0.012),plate,0,0.07,0.415,torso);
  for(const sign of [-1,1])put(tube([[sign*0.03,-0.16,0.47],[sign*0.16,0.01,0.48],[sign*0.03,0.18,0.47]],0.015),eyeMat,0,0,0,torso);
  put(loft([{y:-0.16,x:0.23,z:0.2},{y:0.02,x:0.3,z:0.24},{y:0.26,x:0.27,z:0.22},{y:0.43,x:0.08,z:0.09}],24,0.72),plate,0,1.89,0);
  put(relief([[-0.25,0.04],[0.25,0.04],[0.21,-0.065],[-0.21,-0.065]],0.03,0.006),dark,0,1.91,0.25);
  put(relief([[-0.19,0.011],[0.19,0.011],[0.17,-0.025],[-0.17,-0.025]],0.01,0.002),eyeMat,0,1.91,0.288);
  put(relief([[-0.027,0.31],[0.027,0.31],[0.044,-0.16],[0,-0.21],[-0.044,-0.16]],0.04,0.005),trim,0,1.93,0.27);
  const legs:THREE.Group[]=[],arms:THREE.Group[]=[];
  for(const sign of [-1,1]) {
    const leg=joint(sign*0.28,0.7,0);legs.push(leg);
    put(loft([{y:-0.44,x:0.14,z:0.16},{y:-0.27,x:0.16,z:0.18},{y:-0.07,x:0.18,z:0.19},{y:0.02,x:0.16,z:0.17}],20,0.7),hide,0,0,0,leg);
    put(loft([{y:-0.58,x:0.14,z:0.15},{y:-0.49,x:0.17,z:0.16},{y:-0.18,x:0.18,z:0.18},{y:-0.09,x:0.12,z:0.14}],20,0.7),plate,0,0,0.065,leg);
    put(relief([[0,0.12],[0.19,0],[0.1,-0.13],[-0.1,-0.13],[-0.19,0]],0.07,0.018),trim,0,-0.15,0.23,leg);
    oval(0.19,0.12,0.3,plate,0,-0.58,0.12,leg);
    const arm=joint(sign*0.51,1.5,0);arms.push(arm);
    oval(0.22,0.26,0.22,hide,0,-0.2,0,arm);
    put(loft([{y:-0.08,x:0.32,z:0.31},{y:0.12,x:0.34,z:0.33},{y:0.28,x:0.2,z:0.22},{y:0.34,x:0.08,z:0.08}],20,0.7),plate,sign*0.07,0.03,0,arm);
    put(tube([[-0.24,0,0.21],[0,0.08,0.34],[0.24,0,0.21]],0.027),trim,sign*0.07,0.03,0,arm);
    put(loft([{y:-0.66,x:0.16,z:0.17},{y:-0.52,x:0.19,z:0.2},{y:-0.26,x:0.14,z:0.16}],20,0.75),plate,0,0,0.06,arm);
    oval(0.17,0.16,0.2,hide,0,-0.7,0.1,arm);
    for(let finger=0;finger<3;finger++)oval(0.043,0.09,0.11,trim,(finger-1)*0.088,-0.71,0.25,arm);
    put(relief([[-0.15,0.18],[0.15,0.18],[0.15,-0.19],[0,-0.29],[-0.15,-0.19]],0.05,0.015),plate,sign*0.22,0.73,0.25);
  }
  if(bastion) {
    // Broad convex shield: the bearer and rear straps remain visible from a flank.
    const wall=joint(0,1.02,0.57);
    const faceGeometry=new THREE.SphereGeometry(0.95,40,24,0,Math.PI*2,0,Math.PI/2);
    faceGeometry.rotateX(Math.PI/2);faceGeometry.scale(1,1,0.14);
    put(faceGeometry,plateMat,0,0,0,wall);
    put(new THREE.TorusGeometry(0.94,0.055,8,48),shieldMat,0,0,0.015,wall);
    oval(0.23,0.23,0.16,shieldMat,0,0,0.14,wall);
    for(let i=0;i<12;i++){const a=i/12*Math.PI*2;oval(0.037,0.037,0.018,trim,Math.sin(a)*0.85,Math.cos(a)*0.85,0.05,wall);}
    for(let i=0;i<4;i++){const a=i/4*Math.PI*2;const inset=put(tube([[0,0.28,0.15],[0.07,0.49,0.12],[0,0.74,0.07]],0.025),shieldMat,0,0,0,wall);inset.rotation.z=a;}
    for(const sign of [-1,1])put(tube([[sign*0.34,0.55,-0.37],[sign*0.42,1.0,-0.4],[sign*0.28,1.47,-0.3]],0.04),hide,0,0,0);
  } else if(mirror) {
    // Faceted mirror vanes and a war hammer identify the warding knight.
    for(const sign of [-1,1]) {
      const shield=put(relief([[-0.2,0.47],[0.2,0.47],[0.27,-0.25],[0,-0.58],[-0.27,-0.25]],0.09,0.025),trim,sign*0.68,1.16,0.21);
      shield.rotation.y=sign*0.25;
      put(relief([[-0.14,0.4],[0.14,0.4],[0.19,-0.23],[0,-0.47],[-0.19,-0.23]],0.04,0.012),plate,0,0,0.1,shield);
    }
    const weapon=joint(0,-0.66,0.1,arms[1]);
    put(tube([[0,-0.4,0],[0,0.71,0]],0.045),hide,0,0,0,weapon);
    put(loft([{y:-0.18,x:0.36,z:0.17},{y:-0.1,x:0.39,z:0.2},{y:0.1,x:0.39,z:0.2},{y:0.18,x:0.36,z:0.17}],20,0.56),trim,0,0.69,0,weapon);
  } else {
    // Braced arc-lance with a dark bore, brass rings, and a discrete charging filament.
    const weapon=joint(0,-0.39,0.1,arms[1]);
    const barrel=put(new THREE.CylinderGeometry(0.13,0.16,1.2,24),plate,0,0,0.48,weapon);barrel.rotation.x=Math.PI/2;
    for(const z of [0.1,0.71,1.04])put(new THREE.TorusGeometry(0.15,0.027,8,24),trim,0,0,z,weapon);
    put(new THREE.CircleGeometry(0.115,24),dark,0,0,1.085,weapon);
    put(new THREE.CircleGeometry(0.065,20),eyeMat,0,0,1.089,weapon);
    for(const sign of [-1,1])put(tube([[sign*0.13,0.01,0.17],[sign*0.15,0.01,0.64]],0.02),eyeMat,0,0,0,weapon);
  }
  batchSculpt(root);
  return {eyeMat,shieldMat,plateMat,torso,armL:arms[0],armR:arms[1],legL:legs[0],legR:legs[1]};
}
