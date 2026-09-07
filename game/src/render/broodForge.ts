import * as THREE from "three";
import { batchSculpt, horn, loft, relief, tube } from "./sculpt";

type MaterialFactory = (color: number, emissive?: number, intensity?: number) => THREE.MeshStandardMaterial;

function workshop(root: THREE.Group) {
  const put = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = root) => {
    const mesh = new THREE.Mesh(geo, mat); mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  const oval = (rx: number, ry: number, rz: number, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = root) => {
    const geo = new THREE.SphereGeometry(1, 20, 14); geo.scale(rx, ry, rz); return put(geo, mat, x, y, z, parent);
  };
  return { put, oval };
}

/** A plated brood carrier: two sealed egg cases foreshadow the two offspring. */
export function forgeSplitter(root: THREE.Group, material: MaterialFactory) {
  const { put, oval } = workshop(root);
  const shell = material(0x69745b); shell.roughness = 0.87; shell.metalness = 0.12;
  const rim = material(0xaaa383); rim.roughness = 0.76; rim.metalness = 0.15;
  const dark = material(0x303a35); dark.roughness = 0.94; dark.metalness = 0;
  const seam = material(0x283325, 0x97bd7d, 0.85);
  const sacs: THREE.Group[] = [], legs: THREE.Group[] = [];
  oval(0.51, 0.21, 0.52, dark, 0, 0.42, -0.02);
  for (const sign of [-1, 1]) {
    const sac = new THREE.Group(); sac.position.set(sign * 0.27, 0.56, -0.1); root.add(sac); sacs.push(sac);
    oval(0.25, 0.43, 0.4, shell, 0, 0.02, 0, sac).rotation.z = sign * -0.14;
    // Raised ridges divide each case into overlapping protective plates.
    for (let i = 0; i < 4; i++) {
      const z = -0.29 + i * 0.18, extent = Math.sqrt(Math.max(0.1, 1 - (z / 0.45) ** 2));
      put(tube([[-0.21 * extent, 0.05, z], [-0.15 * extent, 0.34, z], [0, 0.445, z], [0.15 * extent, 0.34, z], [0.21 * extent, 0.05, z]], 0.018, 10), rim, 0, 0, 0, sac);
    }
    put(tube([[0, 0.28, -0.26], [0, 0.435, -0.09], [0, 0.4, 0.13], [0, 0.22, 0.32]], 0.018), seam, 0, 0, 0, sac);
    for (let i = 0; i < 3; i++) {
      const leg = new THREE.Group(); leg.position.set(sign * 0.4, 0.4, (i - 1) * 0.25); root.add(leg); legs.push(leg);
      put(tube([[0, 0, 0], [sign * 0.19, 0.01, (i - 1) * 0.07], [sign * 0.33, -0.3, (i - 1) * 0.15], [sign * 0.39, -0.35, (i - 1) * 0.16]], 0.042, 12), dark, 0, 0, 0, leg);
      oval(0.06, 0.055, 0.075, rim, sign * 0.19, 0.01, (i - 1) * 0.07, leg);
    }
    put(horn([[sign * 0.13, 0.38, 0.46], [sign * 0.24, 0.29, 0.65], [sign * 0.1, 0.32, 0.77]], 0.055, 16), rim, 0, 0, 0);
    oval(0.052, 0.04, 0.033, seam, sign * 0.13, 0.53, 0.6);
  }
  put(loft([{ y: -0.12, x: 0.17, z: 0.13 }, { y: 0, x: 0.26, z: 0.18 }, { y: 0.15, x: 0.2, z: 0.14 }], 24), shell, 0, 0.45, 0.46);
  put(relief([[-0.1, 0.13], [0, 0.18], [0.1, 0.13], [0.06, -0.08], [0, -0.15], [-0.06, -0.08]], 0.025, 0.006), rim, 0, 0.47, 0.625);
  batchSculpt(root); return { sacs, legs };
}

/** An eyeless ivory maw with hinged jaws and three attached, curled tendrils. */
export function forgeVoidling(root: THREE.Group, material: MaterialFactory) {
  const { put, oval } = workshop(root);
  const bone = material(0xb2b4be); bone.roughness = 0.82; bone.metalness = 0.06;
  const dark = material(0x3b354c); dark.roughness = 0.94; dark.metalness = 0;
  const inner = material(0x332841, 0xba9bdc, 1.05);
  oval(0.22, 0.19, 0.27, dark, 0, 0.22, -0.06);
  oval(0.09, 0.1, 0.05, inner, 0, 0.24, 0.12);
  const jaws: THREE.Group[] = [], tails: THREE.Group[] = [];
  for (const sign of [-1, 1]) {
    const jaw = new THREE.Group(); jaw.position.set(0, 0.22, -0.09); root.add(jaw); jaws.push(jaw);
    oval(0.26, 0.1, 0.29, bone, 0, sign * 0.135, 0.1, jaw);
    for (let i = -2; i <= 2; i++) {
      const x = i * 0.087, z = 0.35 - Math.abs(i) * 0.03;
      put(horn([[x, sign * 0.15, z], [x * 0.95, sign * 0.065, z + 0.035], [x * 0.85, sign * 0.015, z]], 0.025, 12), bone, 0, 0, 0, jaw);
    }
    for (const side of [-1, 1]) put(tube([[side * 0.075, sign * 0.22, -0.08], [side * 0.17, sign * 0.23, 0.11], [side * 0.2, sign * 0.16, 0.26]], 0.012), dark, 0, 0, 0, jaw);
  }
  for (let i = -1; i <= 1; i++) {
    const tail = new THREE.Group(); tail.position.set(i * 0.14, 0.25, -0.24); root.add(tail); tails.push(tail);
    put(horn([[0, 0, 0], [i * 0.1, -0.04, -0.22], [i * 0.15, 0.06, -0.48], [i * 0.1, 0.2, -0.67], [i * 0.04, 0.25, -0.7]], 0.057, 20), dark, 0, 0, 0, tail);
    oval(0.064, 0.05, 0.072, bone, 0, 0, -0.01, tail);
  }
  batchSculpt(root); return { jaws, tails, coreMat: inner };
}
