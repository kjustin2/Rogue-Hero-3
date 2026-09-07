import * as THREE from "three";
import { batchSculpt, horn, loft, relief, tube } from "./sculpt";

type MaterialFactory = (color:number,emissive?:number,intensity?:number)=>THREE.MeshStandardMaterial;

function workshop(root:THREE.Group) {
  const put=(g:THREE.BufferGeometry,m:THREE.Material,x:number,y:number,z:number,parent:THREE.Object3D=root)=>{
    const mesh=new THREE.Mesh(g,m);mesh.position.set(x,y,z);mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);return mesh;
  };
  const oval=(rx:number,ry:number,rz:number,m:THREE.Material,x:number,y:number,z:number,parent:THREE.Object3D=root)=>{
    const g=new THREE.SphereGeometry(1,16,12);g.scale(rx,ry,rz);return put(g,m,x,y,z,parent);
  };
  return {put,oval};
}

/** A hooded ash-reader holds the casting focus in an iron reliquary. */
export function forgeSpitter(root:THREE.Group,material:MaterialFactory) {
  const {put,oval}=workshop(root);
  const cloth=material(0x343b49);cloth.roughness=.96;cloth.metalness=0;
  const lining=material(0x211d25);lining.roughness=.94;lining.metalness=0;
  const trim=material(0x9a8766);trim.metalness=.72;trim.roughness=.48;
  const bone=material(0x9a9484);bone.metalness=0;bone.roughness=.8;
  const orbMat=material(0x351816,0xff9369,1.5);
  // Cut folds into the robe's surface instead of wrapping a cone in bright stripes.
  const robe=loft([{y:.06,x:.41,z:.3},{y:.17,x:.46,z:.33},{y:.62,x:.3,z:.24},{y:1.03,x:.27,z:.19},{y:1.33,x:.34,z:.23},{y:1.43,x:.18,z:.15}],48);
  const p=robe.getAttribute("position");
  for(let i=0;i<p.count;i++) {
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i),a=Math.atan2(z,x);
    const fold=1+Math.sin(a*12)*.065*Math.max(.2,1-y/1.6);
    p.setXYZ(i,x*fold,y+Math.pow(Math.max(0,1-y/.2),2)*Math.sin(a*7)*.025,z*fold);
  }
  robe.computeVertexNormals();put(robe,cloth,0,0,0);
  for(const sign of [-1,1]) {
    put(relief([[0,.48],[sign*.13,.4],[sign*.2,-.65],[sign*.1,-.76],[0,-.59]],.02,.006),lining,sign*.04,.88,.25);
    put(tube([[sign*.04,1.36,.2],[sign*.1,.77,.28],[sign*.18,.16,.34]],.012),trim,0,0,0);
    const sleeve=put(loft([{y:-.5,x:.18,z:.16},{y:-.42,x:.19,z:.17},{y:-.16,x:.13,z:.14},{y:.05,x:.14,z:.15}],20),cloth,sign*.31,1.29,.05);
    sleeve.rotation.x=-.65;sleeve.rotation.z=sign*.12;
    oval(.073,.12,.085,bone,sign*.32,.91,.44);
    for(let f=0;f<3;f++)put(tube([[sign*.33+(f-1)*.04,.91,.47],[sign*.28+(f-1)*.035,.88,.56]],.015,8),bone,0,0,0);
  }
  // The opening is framed by a pointed hood; a bone mask is recessed behind its edge.
  put(loft([{y:-.25,x:.26,z:.2},{y:.02,x:.255,z:.21},{y:.24,x:.17,z:.14},{y:.34,x:.025,z:.025}],24),cloth,0,1.61,-.02);
  oval(.17,.2,.025,lining,0,1.62,.198);
  put(relief([[-.105,.1],[0,.15],[.105,.1],[.075,-.13],[0,-.2],[-.075,-.13]],.035,.007),bone,0,1.62,.215);
  for(const sign of [-1,1])put(relief([[sign*.025,.026],[sign*.09,.06],[sign*.079,.008],[sign*.028,-.003]],.01,.002),lining,0,1.63,.226);
  put(tube([[-.2,1.4,.2],[-.21,1.68,.22],[0,1.92,.08],[.21,1.68,.22],[.2,1.4,.2]],.012),trim,0,0,0);
  const orb=oval(.145,.19,.145,orbMat,0,1.25,.62);
  for(const angle of [0,Math.PI/2]) {
    const cage=put(new THREE.TorusGeometry(.21,.024,6,28),trim,0,1.22,.62);cage.rotation.y=angle;
  }
  put(new THREE.CylinderGeometry(.11,.17,.12,12),trim,0,.98,.62);
  batchSculpt(root,[orb]);
  return {orb,orbMat};
}

/** Six-legged iron scarab. Every leg rotates at a real hip beneath the carapace. */
export function forgeSwarmer(root:THREE.Group,material:MaterialFactory) {
  const {put,oval}=workshop(root);
  const shell=material(0x503e35);shell.metalness=.55;shell.roughness=.48;
  const under=material(0x252b2b);under.metalness=.3;under.roughness=.75;
  const eye=material(0x321b0b,0xffa755,1.5);
  oval(.26,.13,.35,under,0,.26,-.06);
  for(const sign of [-1,1]) {
    oval(.147,.16,.29,shell,sign*.12,.31,-.075).rotation.z=sign*-.18;
    oval(.04,.035,.045,eye,sign*.1,.3,.288);
    put(horn([[sign*.11,.2,.29],[sign*.2,.19,.43],[sign*.08,.24,.49]],.046,16),under,0,0,0);
  }
  oval(.17,.09,.15,under,0,.25,.24);
  const legs:THREE.Group[]=[];
  for(const sign of [-1,1])for(let i=0;i<3;i++) {
    const leg=new THREE.Group();leg.position.set(sign*.21,.25,(i-1)*.2);root.add(leg);legs.push(leg);
    put(tube([[0,0,0],[sign*.17,.035,(i-1)*.06],[sign*.27,-.22,(i-1)*.12]],.025,12),under,0,0,0,leg);
    oval(.034,.034,.034,shell,sign*.17,.035,(i-1)*.06,leg);
  }
  batchSculpt(root);return legs;
}

/** A copper pressure vessel carried on folded claw feet, with a visible burning wick. */
export function forgeBomber(root:THREE.Group,material:MaterialFactory) {
  const {put,oval}=workshop(root);
  const shell=material(0x80513a);shell.metalness=.7;shell.roughness=.58;
  const iron=material(0x2c3439);iron.metalness=.73;iron.roughness=.43;
  const coreMat=material(0x512016,0xff792e,1.4);
  oval(.43,.4,.43,shell,0,.61,0);
  put(loft([{y:0,x:.22,z:.22},{y:.1,x:.28,z:.28},{y:.17,x:.22,z:.22}],20),iron,0,.89,0);
  for(const y of [.39,.77]) {const ring=put(new THREE.TorusGeometry(.365,.038,6,28),iron,0,y,0);ring.rotation.x=Math.PI/2;}
  for(let i=0;i<8;i++) {
    const a=i/8*Math.PI*2;
    oval(.034,.034,.034,iron,Math.sin(a)*.425,.61,Math.cos(a)*.425);
  }
  oval(.13,.19,.13,coreMat,0,.99,0);
  put(tube([[0,1.07,0],[.09,1.17,.025],[.04,1.31,.08]],.032,14),iron,0,0,0);
  oval(.055,.08,.055,coreMat,.04,1.33,.08);
  const legs:THREE.Group[]=[];
  for(const sign of [-1,1]) {
    const leg=new THREE.Group();leg.position.set(sign*.27,.31,0);root.add(leg);legs.push(leg);
    put(tube([[0,0,0],[sign*.08,-.16,-.04],[sign*.04,-.25,.08]],.063,14),iron,0,0,0,leg);
    oval(.11,.06,.18,iron,sign*.04,-.25,.16,leg);
  }
  batchSculpt(root);return {coreMat,legL:legs[0],legR:legs[1]};
}
