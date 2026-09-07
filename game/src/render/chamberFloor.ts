import * as THREE from "three";
import { ENCOUNTERS, type EncounterKind } from "../game/encounters";

/** Broad cut-stone fields, brass inlay and a room-specific processional plan.
 * One opaque floor decal keeps the combat plane quiet and costs one draw call. */
export function chamberFloor(kind: EncounterKind | null, act: number, obstacles: readonly { x:number; z:number; r:number }[], boss?: string): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1024;
  const g = canvas.getContext("2d")!;
  const heightCanvas = document.createElement("canvas"); heightCanvas.width = heightCanvas.height = 1024;
  const height = heightCanvas.getContext("2d")!;
  const unit = 1024 / 38;
  g.translate(512, 512); g.scale(unit, unit);
  height.translate(512,512); height.scale(unit,unit);
  height.fillStyle = "#484848"; height.fillRect(-19,-19,38,38);
  const boundary=kind?ENCOUNTERS[kind].boundary:Array.from({length:80},(_,i)=>[Math.sin(i/80*Math.PI*2)*18.95,Math.cos(i/80*Math.PI*2)*18.95] as const);
  const outline=(scale=1)=>{g.beginPath();boundary.forEach(([x,z],i)=>i?g.lineTo(x*scale,z*scale):g.moveTo(x*scale,z*scale));g.closePath();};
  outline(); g.clip();
  const palette = ["#2d3c44", "#2a4245", "#433b36", "#323647", "#303b45"];
  g.fillStyle = palette[(act - 1) % palette.length]; g.fillRect(-19, -19, 38, 38);
  // Large, irregularly weathered slabs avoid the former busy brick-grid floor.
  for (let row = -9; row <= 9; row++) for (let col = -6; col <= 6; col++) {
    const x = col * 3.8 + (row % 2) * 1.9, y = row * 2.25;
    const n = (Math.sin(row * 127.1 + col * 311.7) * 43758.5453) % 1;
    g.fillStyle = n > 0 ? `rgba(185,191,187,${0.02 + n * 0.035})` : `rgba(4,10,18,${0.02 - n * 0.04})`;
    g.fillRect(x + 0.018, y + 0.018, 3.764, 2.214);
    g.strokeStyle = "rgba(13,18,24,.32)"; g.lineWidth = 0.018; g.strokeRect(x, y, 3.8, 2.25);
    height.fillStyle = "#949494"; height.fillRect(x+.018,y+.018,3.764,2.214);
    height.fillStyle = "#b0b0b0"; height.fillRect(x+.07,y+.07,3.66,2.11);
    g.strokeStyle = "rgba(204,199,172,.09)"; g.lineWidth = .027;
    g.beginPath();g.moveTo(x+.05,y+2.19);g.lineTo(x+.05,y+.05);g.lineTo(x+3.74,y+.05);g.stroke();
  }
  const polygon = (points: number[][], fill: string, border = "#857861", width = 0.055) => {
    g.beginPath(); points.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath();
    g.fillStyle = fill; g.fill(); g.strokeStyle = border; g.lineWidth = width; g.stroke();
  };
  const field = (x: number, z: number, w: number, h: number) => {
    const c = 0.8;
    polygon([[x-w/2+c,z-h/2],[x+w/2-c,z-h/2],[x+w/2,z-h/2+c],[x+w/2,z+h/2-c],[x+w/2-c,z+h/2],[x-w/2+c,z+h/2],[x-w/2,z+h/2-c],[x-w/2,z-h/2+c]], "rgba(17,29,36,.44)");
    g.strokeStyle = "rgba(161,145,109,.4)"; g.lineWidth = 0.025;
    g.strokeRect(x-w/2+0.27,z-h/2+0.4,w-0.54,h-0.8);
  };
  if (boss) {
    // Broad radial stones and a broken covenant seal identify the boss court.
    // The motif stays below the warning plane and uses no emissive material.
    for(let i=0;i<16;i++) {
      const a=i/16*Math.PI*2,b=(i+1)/16*Math.PI*2;
      polygon([[Math.sin(a)*6.4,Math.cos(a)*6.4],[Math.sin(a)*17.7,Math.cos(a)*17.7],[Math.sin(b)*17.7,Math.cos(b)*17.7],[Math.sin(b)*6.4,Math.cos(b)*6.4]],i%2?"rgba(15,23,31,.11)":"rgba(140,141,130,.045)","rgba(8,17,24,.3)",.026);
    }
    for(const r of [6.25,6.5,12.2,12.32]){g.beginPath();g.arc(0,0,r,0,Math.PI*2);g.lineWidth=.04;g.strokeStyle="#817359";g.stroke();}
    if(boss==="spire"||boss==="colossus") {
      const points:number[][]=[],sides=boss==="spire"?16:48;
      for(let i=0;i<sides;i++){const a=i/sides*Math.PI*2,r=boss==="spire"?(i%2?3:5.9):(i%4<2?5.7:5.15);points.push([Math.sin(a)*r,Math.cos(a)*r]);}
      polygon(points,"#25363d","#84765d",.065);
    } else if(boss==="tyrant") {
      polygon([[-6,0],[-3.2,-2.9],[0,-3.7],[3.2,-2.9],[6,0],[3.2,2.9],[0,3.7],[-3.2,2.9]],"#263039","#8e7a60",.075);
    } else if(boss==="unmaker") {
      g.fillStyle="#192630";g.beginPath();g.arc(0,0,5.25,0,Math.PI*2);g.fill();
      g.strokeStyle="#ab9a79";g.lineWidth=.16;g.beginPath();g.arc(0,0,4.55,.28,Math.PI*1.89);g.stroke();
    }
  } else if (kind === "crossfire") { field(-7, 0, 7, 23); field(7, 0, 7, 23); }
  else if (kind === "bastion") { field(0, -4, 14, 13); field(0, 8, 6, 9); }
  else if (kind === "pursuit") {
    g.save(); g.rotate(-0.28); field(0, 0, 8, 29); g.restore();
  } else if (kind === "breach") {
    polygon([[-10,0],[-6,-10],[6,-10],[10,0],[6,10],[-6,10]], "rgba(17,29,36,.4)");
  } else field(0, 0, 9, 31);

  // Narrow porphyry borders carry the abbey's color without making the attack
  // surface noisy. Small stone keys and repeating knots break the ruled lines.
  const runnerEdges = kind === "crossfire" ? [-10.5,-3.5,3.5,10.5] : kind === "procession" ? [-4.5,4.5] : [];
  for(const x of runnerEdges) {
    g.fillStyle = "#513b3e";g.fillRect(x-.18,-14,.36,28);
    for(let z=-13;z<=13;z+=2) {
      polygon([[x,z-.22],[x+.15,z],[x,z+.22],[x-.15,z]],"#9a876a","#706753",.015);
    }
  }

  // A heraldic broken sword, inset in a lozenge. Nothing on the floor glows.
  const seals = boss&&boss!=="warden"&&boss!=="echo"?[]:kind === "crossfire" ? [-7, 7] : [0];
  for (const x of seals) {
    g.save(); g.translate(x, kind === "bastion" ? -4 : -1);
    const s = kind === "crossfire" ? 0.75 : 1;
    g.scale(s, s);
    polygon([[0,-4.6],[3.1,0],[0,4.6],[-3.1,0]], "#354046", "#80735e", 0.09);
    polygon([[-0.16,-2.95],[0.16,-2.95],[0.19,0.8],[0,1.4],[-0.19,0.8]], "#b1a385", "#77755f", 0.025);
    polygon([[-1.2,0.65],[-0.2,0.45],[0.2,0.45],[1.2,0.65],[1.1,0.88],[0.2,0.67],[-0.2,0.67],[-1.1,0.88]], "#8e7c5a");
    g.fillStyle = "#9f8967"; g.fillRect(-0.13,1.65,0.26,0.8);
    polygon([[0,2.4],[0.26,2.65],[0,2.9],[-0.26,2.65]], "#ac9770");
    for (const sign of [-1, 1]) for (let i = 0; i < 5; i++) {
      const y = -1.8+i*0.65, bx = sign*(1.15+Math.sin(i/4*Math.PI)*0.6);
      polygon([[bx,y],[bx+sign*0.6,y-0.35],[bx+sign*0.45,y+0.18]], "#7d806c", "#7d806c", 0.01);
    }
    g.restore();
  }
  // Water stains, settling cracks and fine grit accumulate around the actual
  // furniture, so the floor and the collision layout describe the same room.
  for (let i=0;i<obstacles.length;i++) {
    const o=obstacles[i], halo=g.createRadialGradient(o.x,o.z,o.r*.6,o.x,o.z,o.r+1.0);
    halo.addColorStop(0,"rgba(5,14,18,.65)");halo.addColorStop(.6,"rgba(12,23,26,.22)");halo.addColorStop(1,"rgba(12,23,26,0)");
    g.fillStyle=halo;g.beginPath();g.arc(o.x,o.z,o.r+1,0,Math.PI*2);g.fill();
    for(let j=0;j<5;j++) {
      const a=j*1.37+i*.57, start=o.r*.7, end=o.r+1.1+(j%2)*.4;
      const x=o.x+Math.sin(a)*start,z=o.z+Math.cos(a)*start;
      g.strokeStyle="rgba(8,17,23,.36)";g.lineWidth=.023;
      g.beginPath();g.moveTo(x,z);g.lineTo(o.x+Math.sin(a)*end*.77,o.z+Math.cos(a)*end*.79);
      g.lineTo(o.x+Math.sin(a+.12)*end,o.z+Math.cos(a+.12)*end);g.stroke();
      for(let chip=0;chip<5;chip++) {
        const t=start+(end-start)*chip/5;
        g.fillStyle=chip%2?"rgba(170,153,118,.25)":"rgba(99,108,101,.35)";
        g.fillRect(o.x+Math.sin(a)*t+.04*(chip%2),o.z+Math.cos(a)*t,.035+(chip%3)*.02,.026);
      }
    }
  }
  // Masonry shade and broad window light relate the paving to the actual walls.
  for(let i=0;i<boundary.length;i++) {
    const [ax,az]=boundary[i],[bx,bz]=boundary[(i+1)%boundary.length];
    const length=Math.hypot(bx-ax,bz-az),nx=-(bz-az)/length,nz=(bx-ax)/length;
    g.save();g.translate(ax,az);g.rotate(Math.atan2(bz-az,bx-ax));
    const shade=g.createLinearGradient(0,0,0,1.3);shade.addColorStop(0,"rgba(3,10,15,.64)");shade.addColorStop(1,"rgba(3,10,15,0)");
    g.fillStyle=shade;g.fillRect(0,0,length,1.3);g.restore();
    if(kind && nx*.6+nz*.8>.12) {
      const bays=Math.max(1,Math.round(length/3.3)),tx=(bx-ax)/length,tz=(bz-az)/length;
      const warm=act===1||act===3||act===5;
      for(let bay=0;bay<bays;bay++) {
        if((i+bay)%3!==1)continue;
        const cx=ax+(bx-ax)*(bay+.5)/bays,cz=az+(bz-az)*(bay+.5)/bays;
        g.save();g.translate(cx,cz);g.transform(tx,tz,nx,nz,0,0);
        const light=g.createLinearGradient(0,0,0,7.2);
        light.addColorStop(0,warm?"rgba(211,169,109,.04)":"rgba(123,194,186,.04)");
        light.addColorStop(.25,warm?"rgba(211,169,109,.16)":"rgba(123,194,186,.16)");
        light.addColorStop(1,"rgba(138,161,172,0)");
        g.fillStyle=light;g.beginPath();g.moveTo(-.72,.65);g.lineTo(.72,.65);g.lineTo(2.25,7.2);g.lineTo(-.1,7.2);g.closePath();g.fill();
        // Quiet lead shadows split the light; these are painted beneath actors
        // and telegraphs, never translucent planes crossing a character.
        g.strokeStyle="rgba(13,23,31,.15)";g.lineWidth=.065;
        g.beginPath();g.moveTo(0,.7);g.lineTo(1.08,6.8);g.moveTo(-.37,3.25);g.lineTo(1.31,3.25);g.stroke();
        g.restore();
      }
    }
  }
  // Inset bands follow the room's real outline, rather than an unrelated circle.
  g.strokeStyle = "#8d8067"; g.lineWidth = 0.07;
  outline(.96);g.stroke();
  g.strokeStyle="rgba(151,135,103,.35)";g.lineWidth=.024;outline(.947);g.stroke();
  // Chips interrupt even the inlay; their low contrast preserves attack readability.
  for (let i = 0; i < 280; i++) {
    const x = Math.sin(i*127.1)*18.8, y = Math.sin(i*311.7+4)*18.8;
    g.fillStyle = i % 3 ? "rgba(9,15,22,.13)" : "rgba(191,183,158,.07)";
    g.fillRect(x,y,0.035+(i%4)*0.027,0.02+(i%3)*0.018);
  }
  // Mineral grain and brush wear live in the material, not floating particles.
  const pixels = g.getImageData(0,0,1024,1024);
  let seed = 3719 + act;
  for (let y=0;y<1024;y++) for (let x=0;x<1024;x++) {
    seed = (Math.imul(seed,1664525)+1013904223) >>> 0;
    const p=(y*1024+x)*4;
    if (!pixels.data[p+3]) continue;
    const grain = ((seed>>>24)/255-.5)*5 + Math.sin(x*.038+y*.016)*1.2;
    for (let c=0;c<3;c++) pixels.data[p+c] += grain;
  }
  g.putImageData(pixels,0,0);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
  const bump = new THREE.CanvasTexture(heightCanvas); bump.anisotropy = 8;
  const material = new THREE.MeshStandardMaterial({ map: texture, bumpMap: bump, bumpScale: .05, transparent: true, roughness: 0.93, metalness: 0.08, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(38,38),material);
  mesh.name = `Stone inlay: ${boss??kind}`; mesh.rotation.x = -Math.PI/2; mesh.position.y = 0.016;
  mesh.receiveShadow = true; mesh.renderOrder = -8; mesh.userData.solidity = "ground";
  return mesh;
}
