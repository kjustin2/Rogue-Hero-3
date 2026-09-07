import * as THREE from "three";
import { batchSculpt, loft, relief, sculptPigment, tube } from "./sculpt";

/** The glass sovereign: a suspended mantle, porcelain mask and a fractured astrolabe. */
export function forgeSpire(root:THREE.Group,material:(color:number,emissive?:number,intensity?:number)=>THREE.MeshStandardMaterial) {
  const robeMat=material(0x254449);robeMat.roughness=.92;robeMat.metalness=0;
  const shadow=material(0x192b31);shadow.roughness=.9;shadow.metalness=0;
  const trimMat=material(0x9d8b67);trimMat.metalness=.8;trimMat.roughness=.36;
  const ivory=material(0xb9c6be);ivory.roughness=.48;ivory.metalness=.08;
  const glass=material(0x256e73,0x4aaaa2,.18);glass.metalness=.52;glass.roughness=.19;
  const coreMat=material(0x18403a,0x9cead8,1.2);
  const put=(geo:THREE.BufferGeometry,mat:THREE.Material,x:number,y:number,z:number,parent:THREE.Object3D=root)=>{
    const mesh=new THREE.Mesh(geo,mat);mesh.position.set(x,y,z);mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);return mesh;
  };
  const robeStrips:THREE.Object3D[]=[],finPanels:THREE.Object3D[]=[],haloRings:THREE.Object3D[]=[];
  const robe=loft([{y:.18,x:.72,z:.49},{y:.32,x:.78,z:.52},{y:.96,x:.48,z:.36},{y:1.54,x:.35,z:.26},{y:2.03,x:.5,z:.31},{y:2.22,x:.26,z:.21}],48);
  const positions=robe.getAttribute("position");
  for(let i=0;i<positions.count;i++) {
    const x=positions.getX(i),z=positions.getZ(i),y=positions.getY(i),a=Math.atan2(z,x),fold=1+Math.sin(a*10)*.08;
    positions.setXYZ(i,x*fold,y,z*fold);
  }
  robe.computeVertexNormals();put(robe,robeMat,0,0,0);
  for(const sign of [-1,1]) {
    const strip=put(relief([[0,.62],[sign*.18,.52],[sign*.34,-.95],[sign*.13,-1.17],[0,-.93]],.035,.012),shadow,sign*.07,1.42,.4);
    robeStrips.push(strip);
    put(tube([[sign*.08,2.08,.32],[sign*.18,1.17,.44],[sign*.31,.38,.51]],.018),trimMat,0,0,0);
    // Separated glass shoulder vanes open during the channel tell.
    const vane=put(relief([[0,-.53],[sign*.22,-.32],[sign*.57,.63],[sign*.42,.92],[sign*.06,.49]],.14,.025),glass,sign*.5,1.95,0);
    vane.rotation.y=sign*.3;finPanels.push(vane);
    const arm=put(loft([{y:-.56,x:.16,z:.14},{y:-.42,x:.19,z:.17},{y:.06,x:.18,z:.17}],20),robeMat,sign*.5,1.88,.15);
    arm.rotation.x=-.7;arm.rotation.z=sign*.25;
    for(let i=0;i<3;i++)put(tube([[sign*.54+(i-1)*.055,1.42,.56],[sign*.48+(i-1)*.04,1.38,.74],[sign*.38+(i-1)*.04,1.48,.81]],.024),ivory,0,0,0);
  }
  // A narrow mask and high crown make the head readable between the shoulder vanes.
  put(loft([{y:-.19,x:.19,z:.13},{y:.05,x:.26,z:.19},{y:.26,x:.15,z:.1}],24),shadow,0,2.43,0);
  put(relief([[-.22,.13],[0,.23],[.22,.13],[.19,-.1],[0,-.33],[-.19,-.1]],.07,.02),ivory,0,2.43,.22);
  for(const sign of [-1,1]) {
    put(relief([[sign*.035,.03],[sign*.17,.087],[sign*.15,.022],[sign*.04,-.008]],.02,.003),shadow,0,2.44,.241);
    put(tube([[sign*.075,2.42,.25],[sign*.065,2.26,.26],[sign*.12,2.2,.23]],.009),trimMat,0,0,0);
  }
  for(let i=0;i<7;i++) {
    const a=i/7*Math.PI*2,r=.255;
    const crown=put(relief([[-.07,0],[.07,0],[.055,.24],[0,.55],[-.055,.24]],.04,.006),trimMat,Math.sin(a)*r,2.66,Math.cos(a)*r);
    crown.rotation.y=a;crown.rotation.x=-.15;
  }
  const crownOrb=put(new THREE.OctahedronGeometry(.12,1),coreMat,0,3.1,0);
  const focus=put(new THREE.OctahedronGeometry(.22,1),coreMat,0,1.74,.53);focus.scale.y=1.45;
  put(new THREE.TorusGeometry(.3,.035,8,40),trimMat,0,1.74,.58);
  const orbitHalo=put(new THREE.TorusGeometry(.93,.025,6,64,Math.PI*1.76),trimMat,0,2.59,-.04);
  orbitHalo.rotation.set(.28,0,.19);haloRings.push(orbitHalo);
  const outerHalo=put(new THREE.TorusGeometry(1.08,.017,6,64,Math.PI*1.35),glass,0,2.59,-.07);
  outerHalo.rotation.set(.28,0,-.48);haloRings.push(outerHalo);
  const orbGroup=new THREE.Group();orbGroup.position.y=2.1;root.add(orbGroup);
  for(let i=0;i<3;i++) {
    const a=i/3*Math.PI*2,x=Math.sin(a)*1.13,z=Math.cos(a)*1.13;
    const gem=put(new THREE.OctahedronGeometry(.15),coreMat,x,0,z,orbGroup);gem.scale.y=1.8;
    const setting=put(new THREE.TorusGeometry(.23,.018,6,24),trimMat,x,0,z,orbGroup);setting.rotation.y=a;
  }
  sculptPigment(root,[robeMat,shadow,trimMat,ivory,glass]);
  batchSculpt(root,[crownOrb,...robeStrips,...finPanels,...haloRings]);
  return {robeMat,trimMat,coreMat,crownOrb,robeStrips,finPanels,haloRings,orbGroup};
}
