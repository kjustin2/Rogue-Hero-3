import * as THREE from "three";
import { batchSculpt, horn, loft, relief, tube } from "./sculpt";

export interface ColossusRig {
  core: THREE.Mesh;
  coreMat: THREE.MeshStandardMaterial;
  veinMat: THREE.MeshStandardMaterial;
  slagMat: THREE.MeshStandardMaterial;
  shoulders: THREE.Group[];
  elbows: THREE.Group[];
  crownBand: THREE.Mesh;
  heatVents: THREE.Object3D[];
  armorBands: THREE.Object3D[];
  phasePlates: THREE.Object3D[];
  phaseHorns: THREE.Object3D[];
}

/** A walking crucible, cast in overlapping iron with a furnace behind a real grille. */
export function forgeColossus(root: THREE.Group, material: (color: number, emissive?: number, intensity?: number) => THREE.MeshStandardMaterial): ColossusRig {
  const slagMat = material(0x50453d); slagMat.roughness = 0.84; slagMat.metalness = 0.14;
  const iron = material(0x353b3d); iron.roughness = 0.48; iron.metalness = 0.76;
  const bronze = material(0x8e6e46); bronze.roughness = 0.52; bronze.metalness = 0.8;
  const dark = material(0x17191a); dark.roughness = 0.94;
  const coreMat = material(0x8d3214, 0xff8e32, 1.05);
  const veinMat = material(0x7c3416, 0xffab58, 0.72);
  const eye = material(0x442611, 0xffd392, 1.6);
  const put = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = root) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x,y,z); m.castShadow = m.receiveShadow = true; parent.add(m); return m;
  };
  const oval = (x: number,y: number,z: number, rx: number,ry: number,rz: number,mat: THREE.Material,parent: THREE.Object3D = root) => {
    const g = new THREE.SphereGeometry(1,24,16); g.scale(rx,ry,rz); return put(g,mat,x,y,z,parent);
  };
  const joint = (parent: THREE.Object3D,x: number,y: number,z: number) => {
    const g = new THREE.Group(); g.position.set(x,y,z); parent.add(g); return g;
  };
  const shoulders: THREE.Group[] = [], elbows: THREE.Group[] = [], heatVents: THREE.Object3D[] = [], armorBands: THREE.Object3D[] = [];
  const phasePlates: THREE.Object3D[] = [], phaseHorns: THREE.Object3D[] = [];

  put(loft([{y:0.4,x:1.42,z:0.93},{y:0.9,x:1.74,z:1.05},{y:1.8,x:1.73,z:1.13},{y:2.7,x:1.54,z:1.04},{y:3.28,x:1.38,z:0.91},{y:3.53,x:0.88,z:0.7}],36,0.8),slagMat,0,0,0);
  // Broad tapered feet support the mass; the abdomen hangs between them.
  for(const sign of [-1,1]) {
    put(loft([{y:0.05,x:0.72,z:0.91,offsetZ:0.27},{y:0.23,x:0.75,z:0.91,offsetZ:0.27},{y:0.55,x:0.62,z:0.66,offsetZ:0.1},{y:0.86,x:0.53,z:0.49}],24,0.68),iron,sign*0.92,0,0);
    for(let toe=0;toe<3;toe++) put(loft([{y:0.04,x:0.18,z:0.43},{y:0.16,x:0.2,z:0.46},{y:0.29,x:0.15,z:0.28}],16,0.65),bronze,sign*0.92+(toe-1)*0.42,0,0.94);
    // An overlapping curved cuirass leaves the central furnace exposed.
    for(let row=0;row<4;row++) {
      const y=0.97+row*0.52;
      const plate=put(relief([[0,0.31],[sign*0.72,0.35],[sign*1.14,0.13],[sign*1.06,-0.22],[sign*0.35,-0.28],[0,-0.13]],0.13,0.045),iron,sign*0.58,y,1.06-row*0.035);
      plate.rotation.y=sign*0.2;
      for(let r=0;r<2;r++) oval(sign*(0.92+r*0.5),y+0.15,1.18-row*0.035,0.06,0.06,0.035,bronze);
    }
  }
  // The glowing recess is framed and barred, rather than a sphere stuck on the chest.
  oval(0,2.12,1.095,0.73,0.95,0.11,dark);
  const core=oval(0,2.12,1.15,0.58,0.8,0.08,coreMat);
  const furnaceRim=put(new THREE.TorusGeometry(0.69,0.09,10,48),bronze,0,2.12,1.2); furnaceRim.scale.y=1.3;
  for(let i=-2;i<=2;i++) {
    const x=i*0.205,h=Math.sqrt(1-(x/0.64)**2)*0.78;
    put(tube([[x,2.12-h,1.23],[x,2.12,1.31],[x,2.12+h,1.23]],0.047),iron,0,0,0);
  }
  put(tube([[-0.62,2.05,1.25],[0,2.05,1.34],[0.62,2.05,1.25]],0.035),bronze,0,0,0);
  // A severe foundry mask sits low beneath the smoke stacks.
  put(loft([{y:3.12,x:0.62,z:0.62},{y:3.53,x:0.91,z:0.64},{y:4.02,x:0.88,z:0.58},{y:4.3,x:0.57,z:0.43}],28,0.62),iron,0,0,0.14);
  for(const sign of [-1,1]) {
    put(relief([[sign*0.07,0.11],[sign*0.76,0.19],[sign*0.61,-0.03],[sign*0.11,-0.05]],0.06,0.02),bronze,0,3.86,0.79);
    put(relief([[sign*0.14,0.035],[sign*0.6,0.09],[sign*0.49,-0.015],[sign*0.17,-0.025]],0.02,0.005),eye,0,3.85,0.85);
    const stack=put(loft([{y:0,x:0.3,z:0.33},{y:0.7,x:0.24,z:0.28},{y:1.18,x:0.35,z:0.36},{y:1.3,x:0.35,z:0.36}],20,0.7),iron,sign*0.98,3.3,-0.48);
    stack.rotation.z=sign*-0.11;
    oval(sign*1.08,4.61,-0.48,0.23,0.018,0.26,dark);
    for(let i=0;i<3;i++) {
      const vent=put(relief([[-0.21,-0.035],[0.21,-0.035],[0.21,0.035],[-0.21,0.035]],0.02,0.01),veinMat,sign*1.03,3.86+i*0.18,-0.14);
      heatVents.push(vent);
    }
    put(tube([[sign*0.43,3.6,0.78],[sign*0.48,3.3,0.79],[sign*0.17,3.16,0.85]],0.075),bronze,0,0,0);
  }
  put(relief([[-0.11,0.31],[0.11,0.31],[0.18,-0.15],[0,-0.26],[-0.18,-0.15]],0.17,0.02),iron,0,3.65,0.84);
  const crownBand=put(new THREE.TorusGeometry(0.69,0.035,8,40),bronze,0,4.17,0.14); crownBand.rotation.x=Math.PI/2;

  for(const sign of [-1,1]) {
    const arm=joint(root,sign*1.72,3.05,-0.08); shoulders.push(arm);
    oval(sign*0.3,0,0,0.69,0.67,0.71,slagMat,arm);
    const pauldron=put(loft([{y:-0.19,x:0.73,z:0.7},{y:0.1,x:0.76,z:0.74},{y:0.46,x:0.52,z:0.56},{y:0.61,x:0.2,z:0.24}],24,0.72),iron,sign*0.3,0.17,0,arm);
    armorBands.push(pauldron);
    put(loft([{y:-1.22,x:0.36,z:0.42},{y:-0.85,x:0.42,z:0.47},{y:-0.3,x:0.47,z:0.5}],24,0.7),slagMat,sign*0.58,0,0,arm);
    const elbow=joint(arm,sign*0.57,-1.12,0.03); elbows.push(elbow);
    oval(0,0,0,0.44,0.38,0.43,bronze,elbow);
    put(loft([{y:-1.14,x:0.61,z:0.6},{y:-0.99,x:0.64,z:0.62},{y:-0.43,x:0.49,z:0.49},{y:-0.12,x:0.39,z:0.4}],24,0.65),iron,0,0,0.04,elbow);
    for(const y of [-0.4,-0.93]) { const cuff=put(new THREE.TorusGeometry(y===-0.4?0.49:0.6,0.07,8,28),bronze,0,y,0.04,elbow);cuff.rotation.x=Math.PI/2; }
    oval(0,-1.24,0.16,0.71,0.43,0.65,slagMat,elbow);
    for(let finger=0;finger<4;finger++) {
      const x=(finger-1.5)*0.32;
      put(loft([{y:-0.31,x:0.145,z:0.23},{y:-0.1,x:0.175,z:0.28},{y:0.16,x:0.145,z:0.25}],16,0.65),iron,x,-1.23,0.59,elbow);
      oval(x,-1.05,0.67,0.12,0.09,0.08,bronze,elbow);
    }
    oval(sign*-0.6,-1.28,0.21,0.2,0.31,0.32,iron,elbow).rotation.z=sign*-0.3;
    // Back-mounted fins erupt when the furnace overheats. Every piece follows its joint.
    for(let i=0;i<3;i++) {
      const plate=put(relief([[-0.26,0],[0.26,0],[0.21,0.67],[-0.03,1.01],[-0.3,0.54]],0.2,0.035),slagMat,sign*(0.05+i*0.3),0.41,-0.17-i*0.1,arm);
      plate.rotation.z=sign*(-0.1-i*0.18);plate.visible=false;phasePlates.push(plate);
    }
    for(let i=0;i<2;i++) {
      const h=put(horn([[sign*(0.45+i*0.36),4.03,-0.19],[sign*(0.7+i*0.46),4.48,-0.34],[sign*(0.6+i*0.52),4.93,-0.14]],0.16,26),bronze,0,0,0);
      h.visible=false;phaseHorns.push(h);
    }
  }
  batchSculpt(root,[core,crownBand,...heatVents,...armorBands,...phasePlates,...phaseHorns]);
  return {core,coreMat,veinMat,slagMat,shoulders,elbows,crownBand,heatVents,armorBands,phasePlates,phaseHorns};
}
