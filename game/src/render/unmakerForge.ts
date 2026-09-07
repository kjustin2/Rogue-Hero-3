import * as THREE from "three";
import { batchSculpt, horn, loft, relief, tube } from "./sculpt";

/** A hollow star held in the hands of a broken celestial instrument. */
export function forgeUnmaker(root:THREE.Group,material:(color:number,emissive?:number,intensity?:number)=>THREE.MeshStandardMaterial) {
  const cageMat=material(0x57515f);cageMat.metalness=0.62;cageMat.roughness=0.6;
  const ringMat=material(0x9c8c72,0x766b83,0.08);ringMat.metalness=0.82;ringMat.roughness=0.42;
  const debrisMat=material(0x777184);debrisMat.roughness=0.77;debrisMat.metalness=0.16;
  const coreMat=material(0xaea4b4,0xd7cbe2,0.7);
  const dark=material(0x090b12);dark.roughness=0.24;dark.metalness=0.48;
  const pale=material(0xc5b7a4);pale.roughness=0.72;pale.metalness=0.05;
  const put=(geo:THREE.BufferGeometry,mat:THREE.Material,x:number,y:number,z:number,parent:THREE.Object3D=root)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;parent.add(m);return m;};
  const group=(x:number,y:number,z:number)=>{const g=new THREE.Group();g.position.set(x,y,z);root.add(g);return g;};
  const ring=(r:number,w:number,mat:THREE.Material,x:number,y:number,z:number,parent:THREE.Object3D=root)=>put(new THREE.TorusGeometry(r,w,10,64),mat,x,y,z,parent);
  const cageStruts:THREE.Object3D[]=[],shroudShards:THREE.Object3D[]=[],quietHalo:THREE.Object3D[]=[],phaseShards:THREE.Object3D[]=[],phaseSpikes:THREE.Object3D[]=[];
  // The dark heart remains legible inside a narrow luminous corona, even when charging.
  const innerCore=put(new THREE.SphereGeometry(0.67,40,28),dark,0,2.2,0.03);
  const core=ring(0.84,0.095,coreMat,0,2.2,0.1);
  core.castShadow=false;core.userData.castShadow=false;
  const corona=ring(0.99,0.035,pale,0,2.2,0.07);quietHalo.push(corona);
  for(let i=0;i<12;i++) {
    const a=i/12*Math.PI*2;
    const ray=put(relief([[-0.025,0],[0.025,0],[0,0.24+(i%3===0?0.25:0)]],0.016,0.004),coreMat,Math.sin(a)*0.98,2.2+Math.cos(a)*0.98,0.1);
    ray.rotation.z=-a;
  }
  // A suspended, fractured socket. Its fluted pieces terminate below the star.
  put(loft([{y:0.17,x:0.09,z:0.09},{y:0.5,x:0.48,z:0.4},{y:0.91,x:0.8,z:0.62},{y:1.18,x:0.68,z:0.56},{y:1.3,x:0.41,z:0.34}],32,0.72),cageMat,0,0,-0.1);
  for(const sign of [-1,1]) {
    for(let finger=0;finger<3;finger++) {
      const offset=finger*0.16;
      // Long skeletal fingers reach around the corona without covering its center.
      const hand=put(horn([[sign*(0.49+offset),0.72,-0.12],[sign*(1.33+offset),1.27,-0.05],[sign*(1.39+offset),2.63,0.01],[sign*(0.92+offset),3.3,-0.02],[sign*0.78,3.39,0.06]],0.095-finger*0.012,40),pale,0,0,0);
      cageStruts.push(hand);
    }
    put(tube([[sign*0.38,0.61,0.3],[sign*0.7,1.01,0.44],[sign*0.61,1.37,0.49]],0.045),ringMat,0,0,0);
  }
  const rings=group(0,2.2,-0.3);
  // Broken astrolabe rim, with etched ticks and leaf-shaped vanes instead of neon hoops.
  for(let i=0;i<4;i++) {
    const arc=put(new THREE.TorusGeometry(2.02,0.08,10,28,Math.PI*0.37),ringMat,0,0,0,rings);arc.rotation.z=i*Math.PI/2+0.13;
  }
  for(let i=0;i<24;i++) {
    const a=i/24*Math.PI*2;
    const tick=put(relief([[-0.018,-0.05],[0.018,-0.05],[0.018,0.12],[-0.018,0.12]],0.04,0.003),pale,Math.sin(a)*2.04,Math.cos(a)*2.04,0.035,rings);tick.rotation.z=-a;
  }
  for(let i=0;i<8;i++) {
    const a=i/8*Math.PI*2;
    const leaf=put(relief([[-0.13,-0.32],[0.17,-0.34],[0.23,0.06],[0,0.71],[-0.24,0.1]],0.16,0.025),cageMat,Math.sin(a)*2.16,Math.cos(a)*2.16,-0.04,rings);leaf.rotation.z=-a;shroudShards.push(leaf);
    const inset=put(tube([[0,-0.26,0.16],[0.02,0.16,0.17],[0,0.56,0.13]],0.018),ringMat,Math.sin(a)*2.16,Math.cos(a)*2.16,-0.04,rings);inset.rotation.z=-a;
  }
  const debris=group(0,2.2,0);
  for(let i=0;i<7;i++) {
    const a=i/7*Math.PI*2,r=2.75+(i%3)*0.16;
    const shard=put(loft([{y:-0.26,x:0.12,z:0.1},{y:-0.08,x:0.22,z:0.15},{y:0.2,x:0.14,z:0.13},{y:0.42,x:0.04,z:0.02}],7,0.67),debrisMat,Math.sin(a)*r,Math.cos(a*2)*0.34,Math.cos(a)*r,debris);shard.rotation.set(a*0.13,a,0.18);
  }
  for(let i=0;i<6;i++) {
    const a=i/6*Math.PI*2;
    const feather=put(relief([[-0.13,-0.25],[0.16,-0.19],[0.25,0.22],[0,0.98],[-0.23,0.25]],0.12,0.025),pale,Math.sin(a)*2.38,Math.cos(a)*2.38,0.01,rings);feather.rotation.z=-a;feather.visible=false;phaseShards.push(feather);
    const spike=put(horn([[Math.sin(a)*1.1,2.2+Math.cos(a)*1.1,0.09],[Math.sin(a+0.11)*1.53,2.2+Math.cos(a+0.11)*1.53,0.14],[Math.sin(a)*1.79,2.2+Math.cos(a)*1.79,0.03]],0.065,26),coreMat,0,0,0);
    spike.visible=false;phaseSpikes.push(spike);
  }
  batchSculpt(root,[core,innerCore,...cageStruts,...shroudShards,...quietHalo,...phaseShards,...phaseSpikes]);
  return {coreMat,ringMat,debrisMat,cageMat,core,innerCore,rings,debris,cageStruts,shroudShards,quietHalo,phaseShards,phaseSpikes};
}
