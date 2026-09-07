import * as THREE from "three";
import type { ChamberBounds, BoundaryEdge } from "../game/chamberBounds";
import { pointedArch } from "./cathedral";
import { batchSculpt, relief, sculptPigment } from "./sculpt";
import { beveledBox } from "./surfaces";
import { stainedGlass } from "./stainedGlass";

// Two shared paintings live for the renderer's lifetime; room geometry and
// materials are still reclaimed on every transition.
const glassPaintings: (THREE.Texture | undefined)[] = [];

/** A real enclosed chamber: tall rear cloisters, low foreground parapets and a
 * sealed processional gate. Every inner face rests on the collision boundary. */
export function chamberArchitecture(bounds: ChamberBounds, act: number, masonry: THREE.Texture): THREE.Group {
  const root = new THREE.Group(); root.name = "Chamber walls and threshold";
  root.userData.solidity = "solid";
  const palette = [0x57616a,0x456361,0x61574e,0x505466,0x5d5b57];
  const stone = new THREE.MeshStandardMaterial({ color:palette[(act-1)%5],map:masonry,bumpMap:masonry,bumpScale:.035,roughness:.94 });
  const coping = new THREE.MeshStandardMaterial({ color:0x958c77,map:masonry,bumpMap:masonry,bumpScale:.017,roughness:.86 });
  const dark = new THREE.MeshStandardMaterial({ color:0x262e35,map:masonry,roughness:.96 });
  const brass = new THREE.MeshStandardMaterial({ color:0x9c8359,metalness:.65,roughness:.6 });
  const cloth = new THREE.MeshStandardMaterial({ color:[0x62383d,0x294d50,0x754327,0x453653,0x65533e][(act-1)%5],roughness:.98,side:THREE.DoubleSide });
  const ember = new THREE.MeshBasicMaterial({ color:0xffcb87,toneMapped:false });
  const warm = act === 1 || act === 3 || act === 5, glassIndex = warm ? 1 : 0;
  const glassMap = glassPaintings[glassIndex] ??= stainedGlass(warm);
  const glass = new THREE.MeshStandardMaterial({ map:glassMap,emissiveMap:glassMap,emissive:0xffffff,emissiveIntensity:.68,roughness:.62 });
  const put = (geometry: THREE.BufferGeometry, material: THREE.Material, e: BoundaryEdge, along: number, y: number, inward: number) => {
    const mesh = new THREE.Mesh(geometry,material);
    mesh.position.set(e.ax+(e.bx-e.ax)*along+e.nx*inward,y,e.az+(e.bz-e.az)*along+e.nz*inward);
    mesh.rotation.y = Math.atan2(e.nx,e.nz); mesh.castShadow=mesh.receiveShadow=true; root.add(mesh);return mesh;
  };

  // Raised outer masonry buries the old circular paving beyond the new walls.
  const terrace = new THREE.Shape(); terrace.absarc(0,0,22.1,0,Math.PI*2,false);
  const well = new THREE.Path(); bounds.points.forEach(([x,z],i)=>i?well.lineTo(x,-z):well.moveTo(x,-z));well.closePath();terrace.holes.push(well);
  const base = new THREE.ExtrudeGeometry(terrace,{depth:.44,bevelEnabled:false,curveSegments:64,steps:1});base.rotateX(-Math.PI/2);
  const footing=new THREE.Mesh(base,dark);footing.receiveShadow=true;root.add(footing);

  for (let i=0;i<bounds.edges.length;i++) {
    const e=bounds.edges[i], rear=e.nx*.6+e.nz*.8>.12;
    const bays=Math.max(1,Math.round(e.length/3.3)), width=e.length/bays;
    put(beveledBox(e.length+.04,.62,.85),stone,e,.5,.31,-.425);
    put(beveledBox(e.length+.06,.12,.92),coping,e,.5,.66,-.48);
    put(new THREE.BoxGeometry(e.length,.035,.04),brass,e,.5,.53,-.008);
    for(let b=0;b<bays;b++) {
      const along=(b+.5)/bays;
      if(rear) {
        const h=3.5+(i%3)*.18;
        put(beveledBox(width-.025,h,.6),stone,e,along,h/2+.43,-1.07);
        put(beveledBox(width+.03,.16,1.05),coping,e,along,h+.48,-.9);
        put(beveledBox(.34,h+.25,.96),coping,e,b/bays,(h+.25)/2+.43,-.65);
        put(pointedArch(Math.min(1.18,width*.39),1.7,1.0,.09,.13),coping,e,along,.79,-.70);
        const panel=relief([[-.83,0],[-.83,1.73],[0,2.55],[.83,1.73],[.83,0]],.025,.004);
        put(panel,dark,e,along,.8,-.755);
        if((i+b)%3===0) {
          put(relief([[-.42,1.95],[-.42,.32],[0,.1],[.42,.32],[.42,1.95]],.02,.002),cloth,e,along,1.1,-.70);
          put(relief([[0,1.55],[.06,1.28],[.045,.78],[.25,.76],[.25,.70],[.045,.72],[.045,.44],[-.045,.44],[-.045,.72],[-.25,.70],[-.25,.76],[-.045,.78],[-.06,1.28]],.02,.003),brass,e,along,1.1,-.66);
        } else if ((i+b)%3===1) {
          const pane=relief([[-.75,0],[-.75,1.72],[0,2.46],[.75,1.72],[.75,0]],.024,.004);
          const positions=pane.getAttribute("position"),uv=pane.getAttribute("uv");
          for(let v=0;v<positions.count;v++)uv.setXY(v,(positions.getX(v)+.75)/1.5,positions.getY(v)/2.46);
          put(pane,glass,e,along,.83,-.688);
          put(beveledBox(.055,1.8,.06),brass,e,along,1.74,-.63);
          put(beveledBox(1.48,.055,.06),brass,e,along,1.81,-.63);
        } else {
          // The cloister's empty tombs have a narrow carved blade and deep shade.
          put(relief([[0,1.82],[.12,1.52],[.10,.42],[0,.24],[-.10,.42],[-.12,1.52]],.08,.016),stone,e,along,1.0,-.68);
          put(beveledBox(.6,.12,.27),coping,e,along,1.65,-.70);
        }
      } else {
        // A low continuous front edge remains legible without hiding the hero.
        put(beveledBox(.46,.87,1.0),stone,e,b/bays,.435,-.54);
        put(beveledBox(.58,.12,1.06),coping,e,b/bays,.93,-.55);
        put(relief([[-.13,.12],[0,.3],[.13,.12],[0,-.12]],.02,.005),brass,e,along,.32,-.014);
      }
    }
  }

  // The north gate is a strong destination landmark in every room. The door is
  // visibly shut during the fight; route selection carries the Blade onward.
  const gate=bounds.edges[0];
  put(pointedArch(2.5,2.9,2.0,.34,.65),coping,gate,.5,.43,-.51);
  put(pointedArch(2.08,2.9,1.55,.085,.12),brass,gate,.5,.43,-.12);
  put(relief([[-2.05,0],[-2.05,2.8],[0,4.42],[2.05,2.8],[2.05,0]],.12,.03),dark,gate,.5,.43,-.45);
  for(let rail=-5;rail<=5;rail++) {
    const x=rail*.36,h=3.6-Math.abs(rail)*.12;
    put(beveledBox(.055,h,.07),brass,gate,.5+x/gate.length,.5+h/2,-.26);
  }
  for(const h of [1.15,2.85])put(beveledBox(3.7,.11,.10),brass,gate,.5,h,-.22);
  put(relief([[0,.7],[.34,.28],[.26,-.30],[0,-.65],[-.26,-.30],[-.34,.28]],.08,.025),coping,gate,.5,2.1,-.12);
  for(const side of [-1,1]) {
    const along=.5+side*3.12/gate.length;
    put(beveledBox(.84,.3,1.05),coping,gate,along,.57,-.7);
    put(new THREE.CylinderGeometry(.23,.4,.45,8),brass,gate,along,.9,-.7);
    for(let c=-1;c<=1;c++) {
      put(new THREE.CylinderGeometry(.055,.065,.3,7),coping,gate,along+c*.14/gate.length,1.19+Math.abs(c)*.1,-.7);
      const flame=put(new THREE.SphereGeometry(.08,7,5),ember,gate,along+c*.14/gate.length,1.4+Math.abs(c)*.1,-.7);flame.scale.y=1.8;flame.castShadow=false;
    }
  }
  sculptPigment(root,[stone,coping,dark,brass]);
  batchSculpt(root);
  return root;
}
