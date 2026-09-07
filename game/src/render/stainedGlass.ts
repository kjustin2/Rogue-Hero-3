import * as THREE from "three";

/** Original leaded glass, painted once into a shared material. Deep jewel panes,
 * uneven lead, a broken sun and accumulated grime replace flat colored windows. */
export function stainedGlass(warm: boolean): THREE.CanvasTexture {
  const canvas=document.createElement("canvas");canvas.width=384;canvas.height=640;
  const g=canvas.getContext("2d")!,w=canvas.width,h=canvas.height;
  let seed=warm?8017:3719;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const colors=warm?["#544d58","#433d51","#76624e","#425568","#5c4c58","#343e54"]:["#235158","#24434d","#516b64","#33445b","#786746","#2f5558"];
  g.fillStyle="#151f28";g.fillRect(0,0,w,h);
  const draw=(points:number[][],fill:string)=>{g.beginPath();points.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));g.closePath();g.fillStyle=fill;g.fill();g.strokeStyle="#18252a";g.lineWidth=3;g.stroke();};
  for(let y=-1;y<9;y++)for(let x=-1;x<6;x++) {
    const ax=x*78+(y%2)*39,ay=y*84;
    const inset=random()*9;
    const points=[[ax,ay],[ax+77,ay+inset],[ax+77,ay+83],[ax,ay+83-inset]];
    draw(points,colors[Math.floor(random()*colors.length)]);
    if((x+y)%3===0) {
      g.beginPath();g.moveTo(ax+4,ay+2);g.lineTo(ax+35,ay+39);g.lineTo(ax+77,ay+81);g.lineWidth=1.5;g.stroke();
    }
  }
  const halo=g.createRadialGradient(w*.5,h*.38,0,w*.5,h*.4,w*.68);
  halo.addColorStop(0,warm?"rgba(214,187,139,.19)":"rgba(173,220,193,.19)");halo.addColorStop(1,"rgba(18,23,33,0)");g.fillStyle=halo;g.fillRect(0,0,w,h);
  // A circular rose of long, narrow facets surrounds a dark center.
  const cx=w/2,cy=h*.36,r=107;
  for(let i=0;i<12;i++) {
    const a=i/12*Math.PI*2,b=(i+1)/12*Math.PI*2;
    draw([[cx+Math.sin(a)*r,cy+Math.cos(a)*r],[cx+Math.sin(b)*r,cy+Math.cos(b)*r],[cx+Math.sin((a+b)/2)*48,cy+Math.cos((a+b)/2)*48]],colors[(i+2)%colors.length]);
  }
  g.strokeStyle="#9b865e";g.lineWidth=3;g.beginPath();g.arc(cx,cy,r+5,0,Math.PI*2);g.stroke();
  g.fillStyle="#182832";g.beginPath();g.arc(cx,cy,42,0,Math.PI*2);g.fill();
  g.strokeStyle="#ab9a72";g.lineWidth=6;g.beginPath();g.arc(cx,cy,30,.17,Math.PI*1.79);g.stroke();
  // The downward blade is interrupted: the wardens' broken covenant.
  draw([[cx-9,cy+137],[cx+9,cy+137],[cx+7,h*.79],[cx,h*.85],[cx-7,h*.79]],"#aa9370");
  draw([[cx-48,h*.63],[cx-9,h*.61],[cx+9,h*.61],[cx+48,h*.63],[cx+42,h*.646],[cx,h*.631],[cx-42,h*.646]],"#8d7653");
  for(let i=0;i<170;i++) {
    const x=random()*w,y=random()*h,rx=4+random()*18;
    g.fillStyle=i%3?"rgba(12,24,29,.09)":"rgba(195,198,167,.035)";g.beginPath();g.ellipse(x,y,rx,rx*1.8,random(),0,Math.PI*2);g.fill();
  }
  const soot=g.createLinearGradient(0,h*.6,0,h);soot.addColorStop(0,"rgba(8,15,23,0)");soot.addColorStop(1,"rgba(8,15,23,.65)");g.fillStyle=soot;g.fillRect(0,0,w,h);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;return texture;
}
