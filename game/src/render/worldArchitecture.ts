import * as THREE from "three";
import { batchSculpt, horn, loft, relief, sculptPigment, tube } from "./sculpt";
import { beveledBox, stoneTexture } from "./surfaces";
import { pointedArch } from "./cathedral";
import type { ActComposition, ActSetProfile } from "../presentation/types";
import { stainedGlass } from "./stainedGlass";

export interface WorldArchitecture {
  root: THREE.Group;
  compositions: Record<ActComposition, THREE.Group>;
  glow: THREE.MeshBasicMaterial;
  accent: THREE.MeshStandardMaterial;
  movers: { object: THREE.Object3D; speed: number; phase: number; axis?: "x" | "y" | "z" }[];
}

/** Architecture has a footing, construction and purpose. The playable floor stays at y=0. */
export function buildWorldArchitecture(profile: ActSetProfile): WorldArchitecture {
  const root = new THREE.Group(); root.name = profile.name; root.userData.solidity = "nonsolid";
  const compositions = { combat: new THREE.Group(), elite: new THREE.Group(), boss: new THREE.Group(), noncombat: new THREE.Group() };
  for(const [name,g] of Object.entries(compositions)) {g.name=name;g.visible=name==="combat";root.add(g);}
  const grain = stoneTexture();
  const stone = new THREE.MeshStandardMaterial({color:profile.id==="forge"?0x4b4642:profile.id==="wound"?0x534748:0x515861,map:grain,bumpMap:grain,bumpScale:0.025,roughness:0.86});
  const trim = new THREE.MeshStandardMaterial({color:profile.id==="spire"?0xa4a69c:0x8c8170,map:grain,bumpMap:grain,bumpScale:0.018,roughness:0.72});
  const dark = new THREE.MeshStandardMaterial({color:0x242a30,roughness:0.94});
  const iron = new THREE.MeshStandardMaterial({color:0x42494d,metalness:0.82,roughness:0.43});
  const brass = new THREE.MeshStandardMaterial({color:0x9d8156,metalness:0.82,roughness:0.38});
  const accent = new THREE.MeshStandardMaterial({color:new THREE.Color(profile.accent).lerp(new THREE.Color(0x6b7379),0.56),emissive:profile.accent,emissiveIntensity:0.1,metalness:0.25,roughness:0.42});
  const glow = new THREE.MeshBasicMaterial({color:profile.emissive,transparent:true,opacity:0.3,depthWrite:false,side:THREE.DoubleSide});
  const glassMap=profile.id==="spire"||profile.id==="hollow"?stainedGlass(profile.id==="hollow"):null;
  const glass=glassMap?new THREE.MeshStandardMaterial({map:glassMap,emissiveMap:glassMap,emissive:0xffffff,emissiveIntensity:.32,roughness:.52,metalness:.08}):accent;
  const movers: WorldArchitecture["movers"] = [];
  const put = (geo:THREE.BufferGeometry,mat:THREE.Material,x:number,y:number,z:number,parent:THREE.Object3D=root) => {
    const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;parent.add(m);return m;
  };
  const group = (x:number,y:number,z:number,yaw=0,parent:THREE.Object3D=root) => {
    const g=new THREE.Group();g.position.set(x,y,z);g.rotation.y=yaw;parent.add(g);return g;
  };
  const ring = (radius:number,width:number,mat:THREE.Material,x:number,y:number,z:number,parent:THREE.Object3D=root) => put(new THREE.TorusGeometry(radius,width,8,64),mat,x,y,z,parent);
  const column = (x:number,z:number,h:number,parent:THREE.Object3D=root,mat:THREE.Material=stone) => {
    put(loft([{y:0,x:0.67,z:0.67},{y:0.2,x:0.67,z:0.67},{y:0.32,x:0.47,z:0.47},{y:h-0.32,x:0.38,z:0.38},{y:h-0.19,x:0.57,z:0.57},{y:h,x:0.57,z:0.57}],24,0.75),mat,x,0,z,parent);
    for(const y of [0.3,h-0.32]) {const r=ring(0.47,0.035,brass,x,y,z,parent);r.rotation.x=Math.PI/2;}
  };
  const arc = (half:number,spring:number,rise:number,x:number,z:number,parent:THREE.Object3D=root) => {
    put(pointedArch(half,spring,rise,0.32,0.65),stone,x,0,z,parent);
    put(pointedArch(half-0.08,spring,rise-0.08,0.075,0.78),trim,x,0,z+0.03,parent);
  };
  const pane = (half:number,height:number,mat:THREE.Material,x:number,y:number,z:number,parent:THREE.Object3D=root) => {
    return put(relief([[-half,0],[half,0],[half,height*0.66],[half*0.72,height*0.84],[0,height],[-half*0.72,height*0.84],[-half,height*0.66]],0.04,0.01),mat,x,y,z,parent);
  };
  const window = (x:number,z:number,w:number,h:number,parent:THREE.Object3D=root) => {
    pane(w/2,h,dark,x,0.5,z,parent);
    const paneHalf=w/2-.14,paneHeight=h-.28;
    const leaded=pane(paneHalf,paneHeight,glass,x,.65,z+.035,parent);
    const positions=leaded.geometry.getAttribute("position"),uv=leaded.geometry.getAttribute("uv");
    for(let i=0;i<positions.count;i++)uv.setXY(i,(positions.getX(i)+paneHalf)/(paneHalf*2),positions.getY(i)/paneHeight);
    for(const sign of [-1,1]) put(tube([[sign*w*0.29,0.67,0],[sign*w*0.29,h*0.62,0],[0,h*0.84,0]],0.035),brass,x,0,z+0.11,parent);
    put(beveledBox(w-0.17,0.07,0.07),brass,x,h*0.42,z+0.11,parent);
    ring(w*0.18,0.04,brass,x,h*0.64,z+0.11,parent);
  };

  // Broad foundations and fine bevels make the arena part of a building.
  put(new THREE.CylinderGeometry(21.3,22,1.8,96),stone,0,-1.05,0);
  // The architectural bays sit on a connected terrace, with depth behind the arcade.
  put(beveledBox(53,2.2,18),stone,0,-1.16,-25);
  put(beveledBox(52,0.2,17.8),trim,0,-0.14,-25);
  const rearMasonry=new THREE.InstancedMesh(beveledBox(2.12,0.68,0.8),stone,24*8);
  const wallMatrix=new THREE.Matrix4();
  for(let row=0;row<8;row++)for(let col=0;col<24;col++) {wallMatrix.makeTranslation((col-11.5)*2.16+(row%2)*0.36,0.34+row*0.7,-28.4);rearMasonry.setMatrixAt(row*24+col,wallMatrix);}
  rearMasonry.castShadow=rearMasonry.receiveShadow=true;root.add(rearMasonry);
  put(beveledBox(53,0.23,1.1),trim,0,5.67,-28.4);
  for(const sign of [-1,1]) {put(beveledBox(0.8,2.3,17),stone,sign*26,1.15,-25);put(beveledBox(1,0.2,17),trim,sign*26,2.35,-25);}
  const coping=new THREE.InstancedMesh(beveledBox(1.74,0.15,0.56),trim,68);
  const matrix=new THREE.Matrix4(),q=new THREE.Quaternion(),v=new THREE.Vector3(),scale=new THREE.Vector3(1,1,1);
  for(let i=0;i<68;i++) {const a=i/68*Math.PI*2;q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP,a);matrix.compose(v.set(Math.sin(a)*19.35,0.025,Math.cos(a)*19.35),q,scale);coping.setMatrixAt(i,matrix);}
  coping.receiveShadow=true;root.add(coping);
  const pavingMat=stone.clone();pavingMat.color.set(profile.id==="forge"?0x464341:profile.id==="spire"?0x55616a:0x414952);pavingMat.bumpScale=0.009;
  const pavers: [number,number][]=[];
  for(let row=-21;row<=21;row++)for(let col=-14;col<=14;col++){const x=col*1.44+(row%2)*0.72,z=row*0.96;if(Math.hypot(x,z)<19.1)pavers.push([x,z]);}
  const paving=new THREE.InstancedMesh(beveledBox(1.413,0.058,0.933),pavingMat,pavers.length);
  const tint=new THREE.Color();q.identity();
  pavers.forEach(([x,z],i)=>{matrix.compose(v.set(x,-0.025,z),q,scale);paving.setMatrixAt(i,matrix);const n=Math.sin(i*37.7+profile.seed)*0.035;tint.setRGB(0.94+n,0.96+n,0.97+n);paving.setColorAt(i,tint);});
  paving.receiveShadow=true;root.add(paving);
  for(const radius of [5.8,12.6,18.7]) {const r=put(new THREE.RingGeometry(radius-0.018,radius+0.018,112),brass,0,0.008,0);r.rotation.x=-Math.PI/2;r.castShadow=false;}

  if(profile.id==="spire") {
    // A tall glass arcade, with flying buttresses anchored behind its columns.
    for(let i=-4;i<=4;i++) {
      const bay=group(i*4.65,0,-23.2+Math.abs(i)*0.5);
      arc(2.15,3.3,2.6,0,0,bay);window(0,-0.2,3.7,5.45,bay);
      for(const sign of [-1,1]) {
        column(sign*2.16,0,7.2,bay,trim);
        put(horn([[sign*2.16,7.15,0],[sign*2.16,8.05,-0.05],[sign*2.16,8.6,-0.12]],0.28,20),trim,0,0,0,bay);
        put(tube([[sign*2.16,4.9,-0.2],[sign*2.16,4.6,-1.5],[sign*2.16,2.2,-3.6],[sign*2.16,0.4,-4.1]],0.23),stone,0,0,0,bay);
      }
    }
    const clock=group(0,7.1,-23.5,0,compositions.boss);
    for(const r of [1.3,1.65,2])ring(r,0.048,brass,0,0,0,clock);
    for(let i=0;i<12;i++){const a=i/12*Math.PI*2;const tick=put(beveledBox(0.055,0.28,0.08),trim,Math.sin(a)*1.82,Math.cos(a)*1.82,0,clock);tick.rotation.z=-a;}
    const hand=group(0,0,0,0,clock);put(beveledBox(0.045,2.8,0.07),brass,0,0.52,0.02,hand);movers.push({object:hand,speed:0.012,phase:0,axis:"z"});
    for(const sign of [-1,1]) {const pedestal=group(sign*17.1,0,-12.1,0,compositions.elite);column(0,0,2.5,pedestal);pane(0.55,1.5,accent,0,2.55,0,pedestal);}
  } else if(profile.id==="forge") {
    // Recessed kiln mouths, brick barrels and riveted chimney bands.
    for(let i=-3;i<=3;i++) {
      const kiln=group(i*5.55,0,-23.8+Math.abs(i)*0.45);
      put(loft([{y:0,x:2.42,z:1.85},{y:0.45,x:2.42,z:1.85},{y:0.6,x:2.16,z:1.63},{y:4.5,x:2.05,z:1.55},{y:4.85,x:1.42,z:1.18},{y:7.4,x:1.16,z:0.98},{y:7.6,x:1.31,z:1.12}],32,0.68),stone,0,0,-0.9,kiln);
      pane(1.32,3.35,dark,0,0.16,0.94,kiln);pane(1.08,2.93,accent,0,0.27,0.99,kiln);
      put(pointedArch(1.52,1.88,1.75,0.23,0.29),iron,0,0,1.06,kiln);
      for(let bar=-3;bar<=3;bar++)put(beveledBox(0.09,2.65,0.13),iron,bar*0.3,1.61,1.16,kiln);
      for(const y of [1.25,2.25])put(beveledBox(2.22,0.075,0.1),brass,0,y,1.23,kiln);
      for(const y of [5.12,6.45,7.37]) {
        const band=ring(1.23,0.09,iron,0,y,-0.9,kiln);band.rotation.x=Math.PI/2;band.scale.z=0.84;
        for(let b=0;b<8;b++){const a=b/8*Math.PI*2;put(new THREE.SphereGeometry(0.055,8,6),brass,Math.sin(a)*1.29,y,Math.cos(a)*1.04-0.9,kiln);}
      }
      for(let course=0;course<5;course++)for(let brick=0;brick<6;brick++) {
        const a=(brick/5-0.5)*Math.PI,rad=2.12;
        if(Math.abs(Math.sin(a)*rad)<1.5&&Math.cos(a)>0.6)continue;
        const b=put(beveledBox(0.88,0.46,0.2),trim,Math.sin(a)*rad,0.8+course*0.66,Math.cos(a)*1.61-0.9,kiln);b.rotation.y=a;
      }
    }
    // A service gantry connects the chimneys; open rails preserve the background silhouette.
    put(beveledBox(38,0.22,1.6),iron,0,5.1,-21.8);
    for(const z of [-21.06,-22.54]) {
      put(beveledBox(38,0.065,0.065),brass,0,6.03,z);
      for(let x=-18;x<=18;x+=2)put(beveledBox(0.065,0.9,0.065),iron,x,5.57,z);
    }
    for(const sign of [-1,1]) {
      column(sign*18,-19.1,6.4,root,iron);
      for(let link=0;link<15;link++){const r=ring(0.19,0.05,iron,sign*8.4,8.2-link*0.3,-21,compositions.boss);r.scale.y=1.3;r.rotation.y=(link%2)*Math.PI/2;}
      const bell=put(loft([{y:0,x:0.98,z:0.98},{y:0.17,x:0.98,z:0.98},{y:0.58,x:0.59,z:0.59},{y:1.3,x:0.37,z:0.37}],32),brass,sign*8.4,2.9,-21,compositions.boss);
      bell.rotation.z=sign*0.06;
    }
  } else if(profile.id==="abyss"||profile.id==="echo") {
    // Ruptured cloister: cut stone, missing bays and fractured reflective panels.
    const mirror=new THREE.MeshStandardMaterial({color:0x8498a8,metalness:0.92,roughness:0.15});
    for(let i=-4;i<=4;i++) {
      const h=4.5+(i%3===0?1.7:0),bay=group(i*4.6,0,-23.3+Math.abs(i)*0.3,(i%2)*0.028);
      column(-1.95,0,h,bay);column(1.95,0,h,bay);
      if(i%3!==1)put(pointedArch(2.15,h-0.22,2,0.35,0.7),stone,0,0,-0.08,bay);
      if(i%2===0) {
        const shard=pane(1.65,h+0.7,profile.id==="echo"?mirror:dark,0,0.15,-0.3,bay);shard.rotation.z=(i<0?-1:1)*0.06;
        put(tube([[-1.35,0.3,-0.2],[-0.5,2.1,-0.17],[0.35,2.7,-0.15],[0.2,4.1,-0.16],[0.68,5.4,-0.2]],0.027),accent,0,0,0,bay);
      }
      for(let rubble=0;rubble<3;rubble++){const m=put(beveledBox(0.9,0.7,1),stone,(rubble-1)*1.3,0.35,1.1,bay);m.rotation.set(rubble*0.1,0.3+rubble,0.12);}
    }
    const gate=group(0,0,-25,0,compositions.boss);arc(3.4,5.7,3.2,0,0,gate);
    pane(3.05,8.25,dark,0,0.15,-0.45,gate);
    for(let i=0;i<7;i++) {const crack=put(tube([[0,0,0],[Math.sin(i*1.7)*0.38,2.1,0.03],[Math.sin(i*2.1)*0.62,4,0],[0,6.4,0]],0.018),glow,(i-3)*0.48,0.5,0,gate);crack.rotation.z=(i-3)*0.045;}
  } else if(profile.id==="hollow") {
    // The observatory supports its instruments on masonry instead of floating rings.
    for(let i=-4;i<=4;i++) {const bay=group(i*4.8,0,-23.7+Math.abs(i)*0.5);arc(2.18,3.6,2.3,0,0,bay);column(-2.17,0,6.2,bay);column(2.17,0,6.2,bay);window(0,-0.4,3.4,5.2,bay);}
    const mount=group(0,0,-23.8,0,compositions.boss);
    put(loft([{y:0,x:3,z:2.1},{y:0.35,x:3,z:2.1},{y:0.65,x:2.35,z:1.6},{y:1.4,x:1.1,z:0.9},{y:2.4,x:0.72,z:0.7}],40),stone,0,0,0,mount);
    const instrument=group(0,5.2,0,0,mount);
    for(let i=0;i<4;i++){const r=ring(2.25+i*0.4,0.065,brass,0,0,0,instrument);r.rotation.set(i*0.57,0,i*0.71);}
    const globe=put(new THREE.SphereGeometry(1.35,40,28),dark,0,0,0,instrument);
    for(let i=0;i<7;i++){const r=ring(1.38,0.018,trim,0,0,0,globe);r.rotation.y=i/7*Math.PI;}
    movers.push({object:instrument,speed:0.023,phase:0});
    for(const sign of [-1,1]) {const device=group(sign*18,0,-12,sign*0.22,compositions.combat);column(0,0,2.1,device);const r=ring(1.1,0.08,brass,0,3.3,0,device);r.rotation.x=0.35;}
  } else {
    const bone=new THREE.MeshStandardMaterial({color:0xb8a58e,map:grain,bumpMap:grain,bumpScale:0.025,roughness:0.81});
    // Monumental rib cages rise from the perimeter; their inward tips stay beyond the playable disc.
    for(let i=-5;i<=5;i++) {
      const a=i*0.25,r=23.3,bay=group(Math.sin(a)*r,0,-Math.cos(a)*r,-a);
      for(const sign of [-1,1])put(horn([[sign*1.9,0,-0.6],[sign*2.4,2.7,-0.3],[sign*1.8,5.5,-0.1],[sign*0.6,7.1,0],[0,7.25,0]],0.36,40),bone,0,0,0,bay);
      for(let vertebra=0;vertebra<5;vertebra++)put(loft([{y:-0.19,x:0.39,z:0.35},{y:0,x:0.48,z:0.41},{y:0.19,x:0.35,z:0.31}],16),bone,0,0.25+vertebra*0.42,-0.8,bay);
    }
    const altar=group(0,0,-22.3,0,compositions.boss);
    put(loft([{y:0,x:2.6,z:1.5},{y:0.4,x:2.6,z:1.5},{y:0.62,x:2.1,z:1.2},{y:1.25,x:2.25,z:1.3}],24,0.7),stone,0,0,0,altar);
    for(let i=0;i<9;i++) {
      const a=i/9*Math.PI*2,r=5+i%3*3.5;
      const scar=put(tube([[Math.sin(a)*r,0.006,Math.cos(a)*r],[Math.sin(a+0.1)*(r+2),0.007,Math.cos(a+0.1)*(r+2)],[Math.sin(a-0.04)*(r+4),0.006,Math.cos(a-0.04)*(r+4)]],0.028),accent,0,0,0,compositions.boss);scar.castShadow=false;
    }
  }
  // Only rigid meshes are merged; instanced paving and animated instruments remain intact.
  sculptPigment(root,[stone,trim,iron,brass]);
  batchSculpt(root,movers.map(m=>m.object));
  return {root,compositions,glow,accent,movers};
}
