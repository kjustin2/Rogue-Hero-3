import * as THREE from "three";
import { batchSculpt, horn, relief, tube } from "./sculpt";

/** Glass moth and bladed raptor: hinged wings replace orbiting primitive halos. */
export function forgeFlier(root: THREE.Group, material: (color: number, emissive?: number, intensity?: number) => THREE.MeshStandardMaterial, kind: "wisp" | "harrier") {
  const moth = kind === "wisp";
  const shell = material(moth ? 0x74867b : 0x677a8a); shell.metalness = 0.24; shell.roughness = 0.78;
  const bone = material(moth ? 0xbcbca0 : 0xaab7b8); bone.metalness = 0.3; bone.roughness = 0.72;
  const dark = material(0x29363b); dark.roughness = 0.91; dark.metalness = 0;
  const membrane = material(moth ? 0x3e665b : 0x3e5067); membrane.roughness = 0.89; membrane.metalness = 0;
  const focusMat = material(0x162b29, moth ? 0x9be4b8 : 0x80c9ee, 1.1);
  const put = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = root) => {
    const mesh = new THREE.Mesh(geo, mat); mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  const oval = (rx: number, ry: number, rz: number, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = root) => {
    const geo = new THREE.SphereGeometry(1, 20, 12); geo.scale(rx, ry, rz); return put(geo, mat, x, y, z, parent);
  };
  oval(0.16, 0.13, moth ? 0.29 : 0.39, dark, 0, 0, -0.04);
  oval(0.19, 0.14, 0.21, shell, 0, 0.065, 0.12);
  for (let i = 0; i < 4; i++) oval(0.13 - i * 0.017, 0.075, 0.09, shell, 0, 0.035, -0.14 - i * 0.11);
  const wings: THREE.Group[] = [];
  for (const sign of [-1, 1]) {
    const wing = new THREE.Group(); wing.position.set(sign * 0.13, 0.06, 0.07); root.add(wing); wings.push(wing);
    const outline: [number, number][] = moth
      ? [[0, 0], [sign * 0.26, -0.4], [sign * 0.7, -0.56], [sign * 0.9, -0.23], [sign * 0.72, 0.01], [sign * 0.63, 0.41], [sign * 0.35, 0.57], [sign * 0.13, 0.34]]
      : [[0, 0], [sign * 0.35, -0.17], [sign * 1.04, 0.14], [sign * 0.69, 0.25], [sign * 0.89, 0.51], [sign * 0.45, 0.37], [sign * 0.54, 0.69], [sign * 0.1, 0.28]];
    const plate = put(relief(outline, 0.035, 0.009), bone, 0, 0, 0, wing); plate.rotation.x = -Math.PI / 2;
    const inset = outline.map(([x, y]) => [x * 0.81 + sign * 0.05, y * 0.78] as [number, number]);
    const skin = put(relief(inset, 0.008, 0.003), membrane, 0, 0.016, 0, wing); skin.rotation.x = -Math.PI / 2;
    for (const [tipX, tipZ] of [[0.68, 0.34], [0.71, -0.17], [0.36, -0.43]]) put(tube([[sign * 0.05, 0.036, 0], [sign * 0.25, 0.05, tipZ * 0.3], [sign * tipX, 0.035, tipZ]], 0.012, 14), shell, 0, 0, 0, wing);
    if (moth) {
      const spot = oval(0.092, 0.009, 0.14, dark, sign * 0.53, 0.035, 0.22, wing);
      oval(0.036, 0.012, 0.075, shell, 0, 0.012, 0, spot);
      put(horn([[sign * 0.085, 0.12, 0.22], [sign * 0.22, 0.24, 0.38], [sign * 0.25, 0.27, 0.54]], 0.02, 16), bone, 0, 0, 0);
    } else {
      put(horn([[sign * 0.1, -0.07, 0.08], [sign * 0.17, -0.28, 0.24], [sign * 0.1, -0.26, 0.4]], 0.035, 16), bone, 0, 0, 0);
      put(horn([[sign * 0.07, 0.02, -0.3], [sign * 0.16, 0.025, -0.57], [sign * 0.2, 0.035, -0.78]], 0.06, 16), bone, 0, 0, 0);
    }
  }
  oval(0.115, 0.085, 0.09, bone, 0, 0.055, 0.32);
  const focus = oval(0.062, 0.038, 0.035, focusMat, 0, 0.055, 0.405);
  if (!moth) put(horn([[0, -0.005, 0.32], [0, -0.025, 0.5], [0, -0.13, 0.46]], 0.052, 16), dark, 0, 0, 0);
  batchSculpt(root, [focus]); return { wings, focus, focusMat };
}
