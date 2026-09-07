import * as THREE from "three";

/** Original stone tesserae: a broken processional runner and the abbey's sword seal. */
export function floorMosaic(): THREE.Mesh {
  const design = document.createElement("canvas"); design.width = 512; design.height = 1024;
  const g = design.getContext("2d")!;
  const polygon = (points: number[][], fill: string, stroke?: string, width = 1) => {
    g.beginPath(); points.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath();
    g.fillStyle = fill; g.fill();
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = width; g.stroke(); }
  };
  polygon([[110, 32], [402, 32], [436, 68], [436, 956], [402, 992], [110, 992], [76, 956], [76, 68]], "#38444b", "#99866a", 14);
  polygon([[118, 59], [394, 59], [407, 76], [407, 948], [394, 965], [118, 965], [105, 948], [105, 76]], "#4d4d4b", "#b6a184", 3);
  for (const x of [90, 422]) for (let y = 88; y < 954; y += 42) {
    polygon([[x, y - 10], [x + 7, y], [x, y + 10], [x - 7, y]], "#bdad90");
  }
  for (const y of [190, 834]) {
    g.strokeStyle = "#8c7d66"; g.lineWidth = 8;
    g.strokeRect(119, y - 37, 274, 74);
    for (let x = 142; x < 390; x += 38) polygon([[x, y - 22], [x + 15, y], [x, y + 22], [x - 15, y]], "#6c766f");
  }
  polygon([[256, 268], [400, 512], [256, 756], [112, 512]], "#37454c", "#a38b69", 8);
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2, radius = i % 3 === 0 ? 133 : 111;
    const points = [[0, -radius], [12, -67], [0, -80], [-12, -67]].map(([x, y]) => [256 + x * Math.cos(a) - y * Math.sin(a), 512 + (x * Math.sin(a) + y * Math.cos(a)) * 1.42]);
    polygon(points, i % 2 ? "#8b8b7a" : "#b8a080");
  }
  polygon([[244, 363], [268, 363], [270, 575], [256, 644], [242, 575]], "#c2b398", "#6e776e", 4);
  polygon([[207, 563], [245, 546], [267, 546], [305, 563], [302, 578], [265, 566], [247, 566], [210, 578]], "#a58b66");
  g.fillStyle = "#a58b66"; g.fillRect(248, 646, 16, 49);
  polygon([[256, 688], [270, 700], [256, 713], [242, 700]], "#b6a184");

  // Sample the drawing into individual, subtly irregular stone chips. Missing
  // tesserae expose the actual paving below; this is painted stone, never glow.
  const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 1024;
  const out = canvas.getContext("2d")!, pixels = g.getImageData(0, 0, 512, 1024).data;
  let seed = 12731;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let y = 3; y < 1021; y += 6) for (let x = 3; x < 509; x += 6) {
    const i = (y * 512 + x) * 4;
    if (pixels[i + 3] < 128 || random() < 0.045) continue;
    const crack = Math.abs(x - 263 - Math.sin(y * 0.028) * 16 - Math.sin(y * 0.087) * 5);
    if (y > 645 && crack < 3 + (y - 645) * 0.014) continue;
    const light = 0.83 + random() * 0.24;
    out.fillStyle = `rgb(${Math.round(pixels[i] * light)} ${Math.round(pixels[i + 1] * light)} ${Math.round(pixels[i + 2] * light)})`;
    out.save(); out.translate(x, y); out.rotate((random() - 0.5) * 0.18); out.fillRect(-2.6, -2.6, 5.2, 5.2); out.restore();
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.97, metalness: 0.05, transparent: true, opacity: 0.84, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(12, 24), material);
  mesh.name = "Broken sword-seal mosaic"; mesh.rotation.x = -Math.PI / 2; mesh.position.set(0, 0.012, -1.8);
  mesh.receiveShadow = true; mesh.renderOrder = -10; mesh.userData.solidity = "nonsolid"; mesh.userData.floorLayer = "scenery";
  return mesh;
}
