import * as THREE from "three";

/** Sewn broken-sword standard, painted directly onto the simulated cloak. */
export function cloakStandard(color: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 512;
  const g = canvas.getContext("2d")!;
  g.fillStyle = new THREE.Color(color).getStyle(); g.fillRect(0, 0, 512, 512);
  const polygon = (points: number[][], fill: string) => {
    g.beginPath(); points.forEach(([x,y],i) => i ? g.lineTo(x,y) : g.moveTo(x,y)); g.closePath(); g.fillStyle=fill; g.fill();
  };
  // Woven edge bands remain part of the cloth as it folds and flares.
  g.strokeStyle = "#a28b60"; g.lineWidth = 6; g.strokeRect(30,16,452,475);
  g.strokeStyle = "#675538"; g.lineWidth = 2; g.strokeRect(39,22,434,460);
  for (let x = 49; x < 468; x+=23) polygon([[x,466],[x+8,475],[x,484],[x-8,475]],"#a28b60");
  const ivory = "#c5b796", gold = "#a9956e";
  polygon([[256,128],[339,249],[256,375],[173,249]],gold);
  polygon([[256,140],[328,249],[256,363],[184,249]],new THREE.Color(color).multiplyScalar(.62).getStyle());
  polygon([[245,174],[267,174],[266,265],[256,287],[246,265]],ivory);
  polygon([[220,266],[248,254],[264,254],[292,266],[289,277],[265,267],[247,267],[223,277]],gold);
  polygon([[248,305],[264,305],[264,335],[256,346],[248,335]],ivory);
  for (const sign of [-1,1]) for(let i=0;i<5;i++) {
    const y=205+i*20,x=256+sign*(62+Math.sin(i/4*Math.PI)*24);
    polygon([[x,y],[x+sign*26,y-17],[x+sign*18,y+8]],gold);
  }
  // Stitching and worn yarn, deterministic and quiet at playing distance.
  for(let i=0;i<140;i++) {
    const x=(i*137)%512,y=(i*311)%512;
    g.fillStyle=i%2?"rgba(0,0,0,.11)":"rgba(236,220,174,.09)";g.fillRect(x,y,1,4+i%5);
  }
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=8;
  return texture;
}
