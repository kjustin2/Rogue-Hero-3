import * as THREE from "three";
import { batchSculpt, horn, loft, relief, sculptPigment, tube } from "./sculpt";

export interface WardenRig {
  core: THREE.Mesh; coreMat: THREE.MeshStandardMaterial; eyeMat: THREE.MeshStandardMaterial;
  hide: THREE.MeshStandardMaterial; plate: THREE.MeshStandardMaterial;
  arms: THREE.Group[]; legs: THREE.Group[]; ankles: THREE.Group[];
  chains: THREE.Mesh[]; vents: THREE.Object3D[]; flares: THREE.Object3D[];
}

/** A chained furnace beast: weight in the shoulders, exposed ribs, curved horns and iron fists. */
export function forgeWarden(root: THREE.Group, material: (color: number, emissive?: number, intensity?: number) => THREE.MeshStandardMaterial): WardenRig {
  const hide = material(0x41363c); hide.roughness = 0.96; hide.metalness = 0;
  const plate = material(0x36434a); plate.roughness = 0.8; plate.metalness = 0.32;
  const bone = material(0x938674); bone.roughness = 0.86; bone.metalness = 0;
  const iron = material(0x78664f); iron.metalness = 0.8; iron.roughness = 0.43;
  const coreMat = material(0x39180f, 0xf45c1e, 0.82);
  const eyeMat = material(0x241609, 0xffa950, 1.4);
  const ash = material(0x18191c); ash.metalness = 0.1; ash.roughness = 0.92;
  const put = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = root) => {
    const mesh = new THREE.Mesh(g,m); mesh.position.set(x,y+(parent===root?0.22:0),z); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  const oval = (rx: number, ry: number, rz: number, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = root) => {
    const g = new THREE.SphereGeometry(1,20,14); g.scale(rx,ry,rz); return put(g,mat,x,y,z,parent);
  };
  const joint = (parent: THREE.Object3D,x: number,y: number,z: number) => {
    const g = new THREE.Group(); g.position.set(x,y,z); parent.add(g); return g;
  };
  const chains: THREE.Mesh[] = [], vents: THREE.Object3D[] = [], flares: THREE.Object3D[] = [];
  const arms: THREE.Group[] = [], legs: THREE.Group[] = [], ankles: THREE.Group[] = [];
  // Bent spine and trapezius establish the hunch without rotating the entire creature.
  put(loft([{y:0.62,x:0.48,z:0.38},{y:0.92,x:0.67,z:0.5},{y:1.35,x:0.84,z:0.6},{y:1.93,x:0.89,z:0.65,offsetZ:-0.05},{y:2.36,x:0.87,z:0.6,offsetZ:-0.12},{y:2.62,x:0.49,z:0.4,offsetZ:-0.17}],28),hide,0,0,0);
  oval(0.72,0.75,0.24,plate,0,1.92,-0.61);
  const core = oval(0.19,0.43,0.16,coreMat,0,1.73,0.615);
  for (const sign of [-1,1]) {
    put(loft([{y:-.31,x:.27,z:.17},{y:-.14,x:.42,z:.28},{y:.09,x:.44,z:.29},{y:.26,x:.25,z:.14}],12,.74),hide,sign*.49,2.13,.35).rotation.z=sign*.16;
    for (let i=0;i<4;i++) {
      const y=1.23+i*0.25, width=0.52+i*0.07;
      const rib=put(tube([[sign*0.04,y+0.02,0.79],[sign*0.37,y-0.02,0.78],[sign*width,y+0.1,0.55],[sign*(width+0.09),y+0.18,0.18]],0.065),bone,0,0,0);
      vents.push(rib);
    }
    // Curved shoulder shell and torn rim, followed by a separate heavy arm.
    const arm=joint(root,sign*1.04,2.35,0.02); arms.push(arm);
    oval(0.43,0.4,0.46,hide,sign*0.08,-0.03,0,arm);
    const shoulder=put(loft([{y:-0.13,x:0.46,z:0.46},{y:0.12,x:0.52,z:0.51},{y:0.28,x:0.34,z:0.35},{y:0.36,x:0.09,z:0.1}],8,.66),plate,sign*0.06,0.12,-0.015,arm);
    shoulder.rotation.z=sign*-0.2;
    put(tube([[-0.39,-0.04,0.31],[0,0.02,0.51],[0.39,-0.04,0.31]],0.035),iron,sign*0.06,0.12,0,arm);
    put(loft([{y:-.53,x:.22,z:.23},{y:-.3,x:.32,z:.34},{y:.05,x:.29,z:.3},{y:.36,x:.2,z:.22}],12,.76),hide,sign*.11,-.5,.03,arm).rotation.z=sign*.08;
    oval(0.35,0.29,0.34,plate,sign*0.08,-0.91,0.04,arm);
    put(loft([{y:-1.55,x:0.35,z:0.37},{y:-1.39,x:0.42,z:0.43},{y:-1.02,x:0.31,z:0.33},{y:-0.87,x:0.27,z:0.28}],20),plate,sign*0.07,0,0.08,arm);
    for(const y of [-1.04,-1.4]) {
      const cuff=put(new THREE.TorusGeometry(0.355,0.065,8,24),iron,sign*0.07,y,0.08,arm);cuff.rotation.x=Math.PI/2;
    }
    // One surviving pauldron has a raised crest; the other is split and spiked.
    if(sign<0) {
      const crest=put(relief([[-.22,.18],[0,.38],[.22,.18],[.18,-.12],[0,-.28],[-.18,-.12]],.07,.025),iron,sign*.08,.04,.52,arm);
      crest.rotation.x=-.24;
      put(relief([[-.036,.17],[.036,.17],[.036,-.14],[0,-.22],[-.036,-.14]],.022,.006),bone,sign*.08,.04,.6,arm);
    } else for(let i=0;i<3;i++) {
      put(horn([[.19+i*.13,.23,-.28],[.32+i*.17,.46,-.34],[.47+i*.2,.6-i*.12,-.4]],.08,16),bone,0,0,0,arm);
    }
    for(let i=0;i<3;i++) {
      const y=-1.1-i*.1;
      put(tube([[-.13,y,.42],[.04,y-.055,.45],[.2,y-.14,.4]],.012,10),ash,0,0,0,arm);
    }
    put(loft([{y:-1.88,x:0.29,z:0.24},{y:-1.68,x:0.38,z:0.31},{y:-1.43,x:0.31,z:0.26}],8,0.65),plate,sign*0.08,0,0.16,arm);
    for(let f=0;f<4;f++) {
      const x=(f-1.5)*0.185+sign*0.08;
      put(loft([{y:-1.99,x:0.062,z:0.09},{y:-1.78,x:0.095,z:0.12},{y:-1.64,x:0.077,z:0.1}],8),plate,x,0,0.39,arm);
      put(horn([[x,-1.9,0.47],[x,-2.12,0.53],[x,-2.21,0.36]],0.064,12),bone,0,0,0,arm);
    }
    // Heavy, digitigrade legs plant below the creature's center of mass.
    const leg=joint(root,sign*0.54,0.92,-0.14); legs.push(leg);
    oval(0.34,0.43,0.37,hide,0,-0.09,-0.04,leg);
    oval(0.3,0.24,0.29,plate,0,-0.29,0.14,leg);
    put(loft([{y:-.78,x:.16,z:.19},{y:-.6,x:.2,z:.21,offsetZ:-.05},{y:-.3,x:.24,z:.23,offsetZ:.02}],12,.72),hide,0,0,0,leg);
    put(relief([[-.18,.12],[.19,.12],[.16,-.15],[0,-.24],[-.15,-.15]],.08,.015),plate,0,-.49,.2,leg);
    const ankle=joint(leg,0,-0.80,0.05);ankles.push(ankle);
    oval(0.32,0.145,0.41,ash,0,0,0.18,ankle);
    for(let toe=0;toe<3;toe++) {
      oval(0.11,0.105,0.22,plate,(toe-1)*0.21,-0.008,0.43,ankle);
      put(tube([[(toe-1)*0.21,0.015,0.51],[(toe-1)*0.21,-0.035,0.72]],0.041),bone,0,0,0,ankle);
    }
  }
  // A scorched keeper's apron bridges the belly to the planted legs.
  put(relief([[-.48,.18],[.48,.18],[.37,-.22],[.39,-.49],[.19,-.41],[.02,-.64],[-.16,-.52],[-.35,-.59],[-.4,-.18]],.045,.008),ash,0,.84,.47);
  put(tube([[-.45,1.01,.48],[0,.95,.63],[.45,1.01,.48]],.052,20),iron,0,0,0);
  put(relief([[-.14,.1],[.14,.1],[.17,-.08],[0,-.2],[-.17,-.08]],.065,.02),plate,0,.9,.66);
  // Old claw scores follow the pectoral planes, keeping the beast's hide readable.
  for(let i=0;i<3;i++) put(tube([[.3+i*.08,2.42,.6],[.24+i*.08,2.26,.66],[.19+i*.08,2.14,.65]],.011,10),ash,0,0,0);
  // Skull buried between the shoulders. Brow, nasal cavity and teeth keep a face at gameplay scale.
  put(loft([{y:-.34,x:.2,z:.2},{y:-.12,x:.36,z:.32},{y:.13,x:.4,z:.34},{y:.35,x:.24,z:.24},{y:.42,x:.05,z:.09}],16,.78),hide,0,2.46,.46);
  put(loft([{y:-.36,x:.16,z:.12},{y:-.22,x:.27,z:.22},{y:.08,x:.35,z:.18},{y:.29,x:.24,z:.14},{y:.35,x:.1,z:.09}],12,.7),bone,0,2.45,.75);
  put(relief([[-.24,.07],[-.22,-.1],[0,-.27],[.22,-.1],[.24,.07],[0,-.02]],.055,.01),ash,0,2.27,.98);
  for (const sign of [-1,1]) {
    put(relief([[sign*0.03,0.18],[sign*0.35,0.14],[sign*0.33,-0.04],[sign*0.18,-0.19],[sign*0.08,-0.1]],0.08,0.025),plate,0,2.44,0.88);
  }
  for(const sign of [-1,1]) {
    put(relief([[sign*0.04,0.04],[sign*0.3,0.11],[sign*0.28,0],[sign*0.055,-0.03]],0.045,0.008),ash,0,2.54,0.94);
    put(relief([[sign*0.07,0.025],[sign*0.26,0.07],[sign*0.22,0.015]],0.018,0.003),eyeMat,0,2.54,0.954);
    const hornTip = sign<0 ? 3.72 : 3.38;
    put(horn([[sign*.34,2.67,.43],[sign*.68,2.95,.21],[sign*.91,3.32,.02],[sign*.77,hornTip,.22]],.2,32),bone,0,0,0);
    put(horn([[sign*.185,2.34,1.01],[sign*.22,2.12,1.03],[sign*.13,2.01,1.06]],.068,18),bone,0,0,0);
    put(relief([[sign*.17,-.04],[sign*.4,.05],[sign*.35,-.12],[sign*.22,-.26]],.055,.012),bone,0,2.39,.92);
    // Scored brow and muzzle give the mask planes, not a painted grin.
    put(tube([[sign*.03,2.71,.95],[sign*.19,2.68,.97],[sign*.35,2.63,.91]],.032),bone,0,0,0);
  }
  put(relief([[-.048,.09],[.048,.09],[.08,-.09],[0,-.05],[-.08,-.09]],.025,.003),ash,0,2.43,1.002);
  for(let i=0;i<3;i++) put(tube([[-.28+i*.06,2.64,.975],[-.24+i*.06,2.54,.983]],.008,8),ash,0,0,0);
  // Open, interlocked chain links rather than a row of painted boxes.
  for(let i=0;i<17;i++) {
    const x=(i-8)*0.112,y=2.17-Math.sin(i/16*Math.PI)*0.7,z=0.83-Math.abs(x)*0.18;
    const link=put(new THREE.TorusGeometry(0.096,0.027,6,12),iron,x,y,z);
    link.scale.y=1.35;link.rotation.y=(i%2)*1.05;link.rotation.z=-Math.cos(i/16*Math.PI)*0.8;chains.push(link);
  }
  for(let i=0;i<5;i++) {
    const x=(i-2)*0.3;
    flares.push(put(horn([[x,2.12,-0.62],[x*1.15,2.53,-0.82],[x*1.3,2.8,-1.08]],0.1),bone,0,0,0));
  }
  sculptPigment(root,[hide,plate,bone,iron,ash]);
  batchSculpt(root,[core,...chains,...vents,...flares]);
  return {core,coreMat,eyeMat,hide,plate,arms,legs,ankles,chains,vents,flares};
}
