import * as THREE from "three";
import { batchSculpt, horn, loft, relief, tube } from "./sculpt";

/** The Rift Tyrant is an open reliquary engine: the living core is visible between its ribs. */
export function forgeTyrant(root: THREE.Group, material: (color:number,emissive?:number,intensity?:number)=>THREE.MeshStandardMaterial) {
  const plate=material(0x424756);plate.metalness=0.78;plate.roughness=0.53;
  const trim=material(0x9b8766);trim.metalness=0.82;trim.roughness=0.4;
  const dark=material(0x171e29);dark.roughness=0.8;
  const coreMat=material(0x224a55,0x91d6dc,0.92);
  const haloMat=material(0x74628b,0x967db4,0.24);
  const put=(geo:THREE.BufferGeometry,mat:THREE.Material,x:number,y:number,z:number,parent:THREE.Object3D=root)=>{
    const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;parent.add(m);return m;
  };
  const group=(x:number,y:number,z:number,parent:THREE.Object3D=root)=>{const g=new THREE.Group();g.position.set(x,y,z);parent.add(g);return g;};
  const ring=(r:number,w:number,mat:THREE.Material,x:number,y:number,z:number,parent:THREE.Object3D=root)=>put(new THREE.TorusGeometry(r,w,8,48),mat,x,y,z,parent);
  const cageStruts:THREE.Object3D[]=[],ventPanels:THREE.Object3D[]=[],stabilizers:THREE.Object3D[]=[],phaseShards:THREE.Object3D[]=[],phaseCrown:THREE.Object3D[]=[];
  // Suspended lower socket. No opaque mesh encloses the core.
  const hull=put(loft([{y:0.15,x:0.15,z:0.15},{y:0.48,x:0.69,z:0.58},{y:0.86,x:0.9,z:0.79},{y:1.01,x:0.91,z:0.8},{y:1.15,x:0.62,z:0.56}],32,0.8),plate,0,0,0);
  for(const y of [0.77,1.02]){const r=ring(y===0.77?0.8:0.73,0.06,trim,0,y,0);r.rotation.x=Math.PI/2;}
  const core=put(new THREE.SphereGeometry(0.64,32,24),coreMat,0,2.05,0);
  // Mechanical iris on the front of the reactor gives the engine a direction of attention.
  ring(0.6,0.085,trim,0,2.05,0.26);
  for(let i=0;i<8;i++) {
    const a=i/8*Math.PI*2;
    const blade=put(relief([[-0.1,-0.16],[0.18,-0.19],[0.21,0.03],[0.02,0.22],[-0.13,0.15]],0.05,0.012),dark,Math.sin(a)*0.48,2.05+Math.cos(a)*0.48,0.44);
    blade.rotation.z=-a+0.2;
  }
  // Four bowed ribs connect the base to the crown while preserving the central opening.
  for(let i=0;i<4;i++) {
    const a=Math.PI/4+i*Math.PI/2,s=Math.sin(a),c=Math.cos(a);
    const rib=put(tube([[s*0.48,1.05,c*0.48],[s*0.95,1.5,c*0.9],[s*1.03,2.55,c*0.9],[s*0.53,3.12,c*0.48]],0.105),trim,0,0,0);
    cageStruts.push(rib);
  }
  put(loft([{y:2.93,x:0.55,z:0.55},{y:3.08,x:0.84,z:0.73},{y:3.32,x:0.6,z:0.52},{y:3.46,x:0.4,z:0.37}],28,0.75),plate,0,0,0);
  for(const sign of [-1,1])put(horn([[sign*0.45,3.28,0],[sign*0.68,3.79,-0.05],[sign*0.42,4.17,0.12],[sign*0.12,4.38,0.15]],0.17,32),trim,0,0,0);
  const shells:THREE.Group[]=[];
  for(const sign of [-1,1]) {
    const shell=group(sign*1.55,2,0);shells.push(shell);
    put(loft([{y:-1.15,x:0.08,z:0.16},{y:-0.8,x:0.28,z:0.39},{y:-0.05,x:0.58,z:0.65},{y:0.78,x:0.5,z:0.56},{y:1.23,x:0.2,z:0.24},{y:1.43,x:0.035,z:0.06}],28,0.73),plate,0,0,0,shell);
    put(tube([[sign*0.1,-0.96,0.24],[sign*0.46,-0.35,0.51],[sign*0.44,0.52,0.57],[sign*0.16,1.18,0.25]],0.04),trim,0,0,0,shell);
    for(let i=0;i<4;i++) {
      const vent=put(relief([[-0.25,0],[0.25,0],[0.21,0.07],[-0.21,0.07]],0.025,0.005),coreMat,0,-0.23+i*0.22,0.655,shell);ventPanels.push(vent);
    }
    put(horn([[sign*0.15,-0.4,0.14],[sign*0.55,-0.89,0.27],[sign*0.46,-1.49,0.43],[sign*-0.04,-1.91,0.49]],0.18,36),trim,0,0,0,shell);
    for(let i=0;i<3;i++) {
      const vane=put(relief([[0,-0.43],[sign*0.22,-0.12],[sign*0.4,0.48],[sign*0.2,0.3]],0.09,0.018),plate,sign*(0.62+i*0.16),0.57-i*0.27,-0.36,shell);stabilizers.push(vane);
    }
  }
  // A segmented brass gyroscope moves around the visible engine.
  const halo=group(0,2.05,0);
  for(let i=0;i<4;i++) {
    const r=put(new THREE.TorusGeometry(2.15,0.045,8,24,Math.PI*0.38),trim,0,0,0,halo);r.rotation.set(Math.PI/2,0,i*Math.PI/2);
    const a=i*Math.PI/2;put(new THREE.SphereGeometry(0.075,12,8),haloMat,Math.sin(a)*2.15,0,Math.cos(a)*2.15,halo);
  }
  const shardRing=group(0,2.05,0);
  for(let i=0;i<6;i++) {
    const a=i/6*Math.PI*2;
    const shard=put(loft([{y:-0.3,x:0.015,z:0.02},{y:0,x:0.14,z:0.1},{y:0.4,x:0.02,z:0.02}],8),haloMat,Math.sin(a)*1.17,Math.sin(a*2)*0.19,Math.cos(a)*1.17,shardRing);
    shard.visible=false;phaseShards.push(shard);
    const crown=put(horn([[Math.sin(a)*0.44,3.3,Math.cos(a)*0.44],[Math.sin(a)*0.89,3.9,Math.cos(a)*0.89],[Math.sin(a)*0.68,4.49,Math.cos(a)*0.68]],0.12,28),haloMat,0,0,0);
    crown.visible=false;phaseCrown.push(crown);
  }
  batchSculpt(root,[hull,core,...cageStruts,...ventPanels,...stabilizers,...phaseShards,...phaseCrown]);
  return {plate,trim,coreMat,haloMat,hull,core,halo,shellL:shells[0],shellR:shells[1],cageStruts,ventPanels,stabilizers,shardRing,phaseShards,phaseCrown};
}
