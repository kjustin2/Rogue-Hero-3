import * as THREE from "three";
import { beveledBox, stoneTexture } from "./surfaces";
import { loft, tube } from "./sculpt";
import { floorMosaic } from "./floorMosaic";

/** Pointed, open arch. Its underside and bevel are real geometry at every viewing angle. */
export function pointedArch(half: number, spring: number, rise: number, width: number, depth: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-half, 0); s.lineTo(-half, spring);
  s.quadraticCurveTo(-half, spring + rise * 0.54, 0, spring + rise);
  s.quadraticCurveTo(half, spring + rise * 0.54, half, spring);
  s.lineTo(half, 0); s.lineTo(half - width, 0); s.lineTo(half - width, spring);
  s.quadraticCurveTo(half - width, spring + rise * 0.48, 0, spring + rise - width);
  s.quadraticCurveTo(-half + width, spring + rise * 0.48, -half + width, spring);
  s.lineTo(-half + width, 0); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, steps: 1, curveSegments: 14, bevelEnabled: true, bevelSegments: 2, bevelSize: 0.035, bevelThickness: 0.04 });
  g.translate(0, 0, -depth / 2); return g;
}

interface Instance { x: number; y: number; z: number; yaw?: number; sx?: number; sy?: number; sz?: number; roll?: number; }

/** Ruined abbey: masonry, recessed arcades, a monumental sealed gate and candlelit thresholds. */
export class Cathedral {
  readonly root = new THREE.Group();
  private readonly veil: THREE.ShaderMaterial;
  private readonly flames: THREE.InstancedMesh;
  private readonly flameBases: Instance[];
  private readonly bossOmens = new THREE.Group();
  private readonly reliquary = new THREE.Group();
  private t = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly euler = new THREE.Euler();
  constructor(scene: THREE.Scene) {
    this.root.name = "The Rift Abbey";
    this.root.userData.solidity = "nonsolid";
    const grain = stoneTexture(); grain.repeat.set(2, 2);
    const stone = new THREE.MeshStandardMaterial({ color: 0x57616c, map: grain, bumpMap: grain, bumpScale: 0.025, roughness: 0.88 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x94866f, map: grain, bumpMap: grain, bumpScale: 0.015, roughness: 0.75 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x242b32, map: grain, roughness: 0.94 });
    const bronze = new THREE.MeshStandardMaterial({ color: 0x84745a, metalness: 0.8, roughness: 0.4 });
    const candle = new THREE.MeshStandardMaterial({ color: 0xb9a582, roughness: 0.94 });
    const fire = new THREE.MeshBasicMaterial({ color: 0xffd48b, transparent: true, opacity: 0.92, toneMapped: false });
    const instance = (geo: THREE.BufferGeometry, mat: THREE.Material, records: Instance[], parent = this.root): THREE.InstancedMesh => {
      const mesh = new THREE.InstancedMesh(geo, mat, records.length);
      records.forEach((r, i) => { this.place(r); mesh.setMatrixAt(i, this.matrix); });
      mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
    };
    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat); m.position.set(x,y,z); m.castShadow = m.receiveShadow = true; this.root.add(m); return m;
    };

    // A broad stepped footing replaces the impression of a paper-thin neon arena.
    const foundation = mesh(new THREE.CylinderGeometry(21.7, 22.2, 1.8, 80), stone, 0, -1.05, 0);
    foundation.userData.solidity = "ground";
    const courses: Instance[] = [], coping: Instance[] = [], piers: Instance[] = [];
    for (let i = 0; i < 72; i++) {
      const a = i / 72 * Math.PI * 2;
      courses.push({ x: Math.sin(a)*20.7,y:-0.17,z:Math.cos(a)*20.7,yaw:a,sx:1,sy:1,sz:1 });
      coping.push({ x: Math.sin(a)*19.2,y:0.045,z:Math.cos(a)*19.2,yaw:a });
    }
    instance(beveledBox(1.77, 0.5, 1.1), dark, courses);
    instance(beveledBox(1.63, 0.12, 0.56), trim, coping);
    // Individual bevels catch grazing light; seams sit below the true walking plane.
    const paving: Instance[] = [];
    for(let row=-22;row<=22;row++) for(let col=-15;col<=15;col++) {
      const x=col*1.38+(row%2)*0.69,z=row*0.91;
      if(Math.hypot(x,z)>19.45)continue;
      paving.push({x,y:-0.026,z,yaw:0});
    }
    const pavingMat = new THREE.MeshStandardMaterial({color:0x53606a,map:grain,bumpMap:grain,bumpScale:0.018,roughness:0.94});
    const pavers=instance(beveledBox(1.352,0.06,0.884),pavingMat,paving);
    pavers.castShadow=false;
    const tint=new THREE.Color();
    paving.forEach((p,i)=>{
      const variation=((Math.imul(i+91,1597334677)>>>24)/255)*0.16;
      const edgeWear=Math.max(0,Math.hypot(p.x,p.z)/19-0.7)*0.1;
      tint.setRGB(0.65+variation-edgeWear,0.67+variation-edgeWear,0.68+variation-edgeWear);pavers.setColorAt(i,tint);
    });
    this.root.add(floorMosaic());

    // A rear cloister stands beyond the combat boundary, with deeper walls behind its arches.
    const arches: Instance[] = [], insetArches: Instance[] = [], shafts: Instance[] = [], wall: Instance[] = [];
    for (let i = 0; i < 9; i++) {
      const a = (i-4)*0.29;
      const x = Math.sin(a)*23.6, z = -Math.cos(a)*23.6;
      arches.push({x,y:0,z,yaw:-a});
      insetArches.push({x:x*1.012,y:0.12,z:z*1.012,yaw:-a});
      for (const sign of [-1,1]) {
        const dx = sign*2.67;
        const px = x + Math.cos(a)*dx, pz = z + Math.sin(a)*dx;
        piers.push({x:px,y:2.65,z:pz,yaw:-a});
        shafts.push({x:px,y:0.05,z:pz+0.35,yaw:-a});
      }
      // Broken courses behind the openings add shadowed thickness and irregular roof silhouettes.
      for (let row = 0; row < 4 + (i%3); row++) for (const sign of [-1,1]) {
        wall.push({x:x + Math.cos(a)*sign*2.64, y:row*1.08+0.54, z:z+Math.sin(a)*sign*2.64-0.6,yaw:-a,sx:1,sy:1,sz:1});
      }
    }
    instance(pointedArch(2.72,4.4,3.8,0.38,0.8),stone,arches);
    instance(pointedArch(2.29,4.37,3.23,0.105,0.16),trim,insetArches);
    instance(beveledBox(0.92,5.3,1.25),stone,piers);
    instance(beveledBox(1.5,1.0,1.6),dark,wall);
    instance(loft([{y:0,x:0.24,z:0.24},{y:0.24,x:0.3,z:0.3},{y:0.36,x:0.21,z:0.21},{y:4.18,x:0.18,z:0.18},{y:4.3,x:0.32,z:0.32},{y:4.5,x:0.3,z:0.3}],16),trim,shafts);

    // Recessed masonry closes the lower arcade; high lancets admit a cool, fractured light.
    const rearWalls: Instance[] = [], ledges: Instance[] = [];
    const windowGlass = new THREE.MeshStandardMaterial({color:0x173d4a,emissive:0x28758a,emissiveIntensity:0.32,metalness:0.15,roughness:0.5,side:THREE.DoubleSide});
    for(let i=0;i<9;i++) {
      if(i===4)continue;
      const a=(i-4)*0.29,x=Math.sin(a)*24.45,z=-Math.cos(a)*24.45;
      for(let row=0;row<6;row++)for(let col=0;col<4;col++) {
        const offset=(col-1.5)*1.18;
        rearWalls.push({x:x+Math.cos(a)*offset,y:.35+row*.69,z:z+Math.sin(a)*offset,yaw:-a});
      }
      ledges.push({x:x*.996,y:4.2,z:z*.996,yaw:-a});
      const window = new THREE.Group();window.position.set(x,4.25,z);window.rotation.y=-a;this.root.add(window);
      const glassShape = new THREE.Shape();glassShape.moveTo(-1.55,0);glassShape.lineTo(-1.55,1.16);glassShape.quadraticCurveTo(-1.42,2.15,0,3.18);glassShape.quadraticCurveTo(1.42,2.15,1.55,1.16);glassShape.lineTo(1.55,0);glassShape.closePath();
      const glass=new THREE.Mesh(new THREE.ShapeGeometry(glassShape,16),windowGlass);window.add(glass);
      const mullions: Instance[]=[];
      for(let j=-2;j<=2;j++)mullions.push({x:j*.52,y:1.1,z:0.035,sy:1.0-Math.abs(j)*.16});
      instance(beveledBox(.052,2.25,.08),bronze,mullions,window);
      for(const y of [.58,1.28])instance(beveledBox(2.95,.05,.08),bronze,[{x:0,y,z:.04}],window);
      const halo=new THREE.Mesh(new THREE.TorusGeometry(.57,.032,6,32),bronze);halo.position.set(0,2.05,.04);window.add(halo);
    }
    const backing=instance(beveledBox(1.15,.665,1.0),dark,rearWalls);
    const masonryTint=new THREE.Color();
    rearWalls.forEach((_,i)=>{const tone=.83+((Math.imul(i+31,1103515245)>>>24)/255)*.3;masonryTint.setRGB(tone,tone,tone);backing.setColorAt(i,masonryTint);});
    instance(beveledBox(4.95,.15,1.15),trim,ledges);

    // Rose window at the far end, with a recessed portal and heavy doors beneath it.
    mesh(pointedArch(4.0,5.7,4.8,0.74,1.8),trim,0,0,-25.2);
    mesh(pointedArch(3.15,5.65,3.9,0.16,0.2),bronze,0,0,-24.18);
    const gate = mesh(beveledBox(5.2,6.1,0.32),dark,0,3.0,-25.4);
    gate.userData.solidity = "nonsolid";
    const rails: Instance[] = [];
    for (let i = -6; i <= 6; i++) rails.push({x:i*0.38,y:3.25,z:-25.14});
    instance(beveledBox(0.055,6.5,0.065),bronze,rails);
    for (const y of [1.1,3,5]) mesh(beveledBox(5.12,0.105,0.08),bronze,0,y,-25.09);
    const rose = mesh(new THREE.TorusGeometry(1.55,0.12,8,64),trim,0,8.25,-24.45);
    const tracery: Instance[] = [];
    for (let i = 0; i < 8; i++) {
      const a = i/8*Math.PI*2;
      tracery.push({x:Math.sin(a)*0.81,y:8.25+Math.cos(a)*0.81,z:-24.43,roll:-a,sx:1,sy:1.28,sz:1});
    }
    instance(new THREE.TorusGeometry(0.43,0.047,6,24),trim,tracery);
    mesh(new THREE.TorusGeometry(0.35,0.07,6,24),bronze,0,8.25,-24.4);
    rose.castShadow = false;
    this.root.add(this.bossOmens, this.reliquary);
    const omen = new THREE.MeshStandardMaterial({ color:0x612b1e,emissive:0xff8245,emissiveIntensity:0.75,roughness:0.7 });
    instance(new THREE.CylinderGeometry(0.48,0.64,1.6,16),bronze,[{x:-4.5,y:0.8,z:-21},{x:4.5,y:0.8,z:-21}],this.bossOmens);
    instance(new THREE.SphereGeometry(0.34,12,8),omen,[{x:-4.5,y:1.7,z:-21,sy:1.6},{x:4.5,y:1.7,z:-21,sy:1.6}],this.bossOmens);
    instance(loft([{y:0,x:0.55,z:0.55},{y:0.2,x:0.62,z:0.62},{y:1.1,x:0.35,z:0.35},{y:1.25,x:0.62,z:0.62}],16),trim,[{x:-7,y:0,z:-19},{x:7,y:0,z:-19}],this.reliquary);
    instance(new THREE.OctahedronGeometry(0.3,1),bronze,[{x:-7,y:1.8,z:-19},{x:7,y:1.8,z:-19}],this.reliquary);

    // Opposing buttresses and broken ribs frame the field; every footing is outside radius 18.
    const ribs: Instance[] = [], buttresses: Instance[] = [], rubble: Instance[] = [];
    for (const sign of [-1,1]) for (let i = 0; i < 4; i++) {
      const z = -10+i*6.5, x = sign*(20.5+Math.max(0,z)*0.16);
      buttresses.push({x,y:2.4,z,yaw:sign*0.1,sy:1+(i%2)*0.15});
      ribs.push({x,y:4.6,z,yaw:sign*Math.PI/2,roll:0});
      for (let r = 0; r < 5; r++) rubble.push({x:x+sign*(r%2)*0.4,y:0.25,z:z+(r-2)*0.7,yaw:r*1.3,roll:r*0.1,sx:0.7+(r%3)*0.17,sy:0.3+(r%2)*0.25,sz:0.75});
    }
    instance(beveledBox(1.3,4.8,1.9),stone,buttresses);
    instance(tube([[0,0,0],[0,1.6,-0.8],[0,3.3,-2.2],[0,4.0,-3.6]],0.22),trim,ribs);
    instance(beveledBox(1.15,0.65,0.8),stone,rubble);

    // Small, grounded candle clusters provide a human scale and restrained warm accents.
    const candles: Instance[] = [], flames: Instance[] = [], dishes: Instance[] = [];
    for (const sign of [-1,1]) for (let i=0;i<4;i++) {
      const a = sign*(0.28+i*0.32), x = Math.sin(a)*19.8, z = -Math.cos(a)*19.8;
      dishes.push({x,y:0.08,z});
      for(let j=0;j<5;j++) {
        const px=x+Math.sin(j*2.4)*0.27,pz=z+Math.cos(j*2.4)*0.27,h=0.17+(j%3)*0.09;
        candles.push({x:px,y:h/2+0.12,z:pz,sy:h});
        flames.push({x:px,y:h+0.16,z:pz,sy:1+(j%3)*0.15});
      }
    }
    instance(new THREE.CylinderGeometry(0.54,0.43,0.09,24),bronze,dishes);
    instance(new THREE.CylinderGeometry(0.055,0.06,1,10),candle,candles);
    this.flames = instance(new THREE.SphereGeometry(0.043,8,6),fire,flames);
    this.flames.castShadow=false; this.flameBases=flames;
    this.flames.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // Soft window shafts use a spatial falloff. They never flash or fill the whole screen.
    this.veil = new THREE.ShaderMaterial({
      transparent:true, depthWrite:false, side:THREE.DoubleSide, blending:THREE.AdditiveBlending,
      uniforms:{uTime:{value:0},uOpacity:{value:0.055}},
      vertexShader:`varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader:`varying vec2 vUv;uniform float uTime;uniform float uOpacity;void main(){float edge=pow(max(0.,1.-abs(vUv.x-.5)*2.),2.);float along=smoothstep(0.,.16,vUv.y)*(1.-smoothstep(.66,1.,vUv.y));float dust=.9+.1*sin(vUv.y*18.+uTime*.35);gl_FragColor=vec4(.44,.59,.71,edge*along*dust*uOpacity);}`,
    });
    for(const x of [-12,0,12]) {
      const shaft=mesh(new THREE.PlaneGeometry(3.8,14),this.veil,x+2,6,-13);
      shaft.rotation.set(-0.62,0,0.25); shaft.castShadow=false;
    }
    scene.add(this.root);
    this.setComposition("nave");
  }
  private place(r: Instance): void {
    this.position.set(r.x,r.y,r.z);this.euler.set(0,r.yaw??0,r.roll??0);this.rotation.setFromEuler(this.euler);this.scale.set(r.sx??1,r.sy??1,r.sz??1);this.matrix.compose(this.position,this.rotation,this.scale);
  }
  setVisible(on:boolean):void{this.root.visible=on;}
  setComposition(kind:"nave"|"reliquary"|"courtyard"):void{
    this.bossOmens.visible=kind==="courtyard";
    this.reliquary.visible=kind==="reliquary";
  }
  update(dt:number,dim:number):void{
    if(!this.root.visible||dt<=0)return;
    this.t+=dt;this.veil.uniforms.uTime.value=this.t;this.veil.uniforms.uOpacity.value=0.075*(1-dim*.5);
    for(let i=0;i<this.flameBases.length;i++){
      const r=this.flameBases[i];this.place(r);this.scale.set(.75,2.6+Math.sin(this.t*8+i*1.7)*.24,1);this.matrix.compose(this.position,this.rotation,this.scale);this.flames.setMatrixAt(i,this.matrix);
    }
    this.flames.instanceMatrix.needsUpdate=true;
  }
}
