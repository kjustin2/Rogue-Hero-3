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
  const joint = (x: number, y: number, z: number, parent: THREE.Object3D = root) => {
    const group = new THREE.Group(); group.position.set(x, y, z); parent.add(group); return group;
  };
  return { put, oval, joint };
}

/** A lean bone hound: long muzzle, high haunches and four articulated clawed legs. */
export function forgeLeaper(root: THREE.Group, material: MaterialFactory) {
  const { put, oval, joint } = workshop(root);
  const hide = material(0x554858); hide.roughness = 0.9; hide.metalness = 0;
  const belly = material(0x292630); belly.roughness = 0.97; belly.metalness = 0;
  const bone = material(0xc2b49d); bone.roughness = 0.82; bone.metalness = 0;
  const eyes = material(0x20141d, 0xf3a2d7, 1.2);
  const body = joint(0, 0.77, 0);
  oval(0.32, 0.3, 0.62, hide, 0, 0.02, -0.07, body);
  oval(0.36, 0.36, 0.29, hide, 0, 0.03, 0.32, body);
  oval(0.24, 0.22, 0.42, belly, 0, -0.17, -0.04, body);
  for (const sign of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      put(tube([[sign * 0.06, 0.29, 0.3 - i * 0.18], [sign * 0.31, 0.13, 0.32 - i * 0.18], [sign * 0.29, -0.17, 0.34 - i * 0.18]], 0.033, 12), bone, 0, 0, 0, body);
    }
  }
  for (let i = 0; i < 5; i++) put(horn([[0, 0.29, 0.36 - i * 0.2], [0, 0.43, 0.32 - i * 0.2], [0, 0.51 - i * 0.035, 0.13 - i * 0.2]], 0.064, 12), bone, 0, 0, 0, body);
  put(horn([[0, -0.03, -0.52], [0.14, -0.06, -0.93], [0.22, 0.13, -1.23], [0.1, 0.35, -1.38]], 0.09, 24), hide, 0, 0, 0, body);
  const head = joint(0, 0.11, 0.53, body);
  oval(0.225, 0.225, 0.31, bone, 0, 0.04, 0.06, head);
  put(loft([{ y: -0.12, x: 0.13, z: 0.23 }, { y: 0.03, x: 0.16, z: 0.27 }, { y: 0.12, x: 0.11, z: 0.2 }], 16, 0.67), bone, 0, -0.07, 0.27, head);
  oval(0.12, 0.046, 0.1, belly, 0, -0.055, 0.5, head);
  oval(0.14, 0.035, 0.21, belly, 0, -0.155, 0.28, head);
  oval(0.125, 0.045, 0.2, bone, 0, -0.22, 0.26, head);
  for (const sign of [-1, 1]) {
    oval(0.028, 0.055, 0.105, belly, sign * 0.2, 0.065, 0.16, head).rotation.z = sign * -0.25;
    oval(0.03, 0.024, 0.057, eyes, sign * 0.222, 0.063, 0.18, head);
    put(horn([[sign * 0.15, 0.16, -0.03], [sign * 0.26, 0.42, -0.1], [sign * 0.21, 0.49, -0.29]], 0.085, 18), bone, 0, 0, 0, head);
    for (let i = 0; i < 3; i++) put(horn([[sign * 0.13, -0.1, 0.18 + i * 0.1], [sign * 0.12, -0.22, 0.2 + i * 0.1]], 0.022, 8), bone, 0, 0, 0, head);
  }
  const legs: THREE.Group[] = [];
  for (const rear of [false, true]) for (const sign of [-1, 1]) {
    const leg = joint(sign * 0.3, 0.72, rear ? -0.47 : 0.37); legs.push(leg);
    const bend = rear ? 0.12 : -0.06;
    oval(rear ? 0.19 : 0.12, 0.24, rear ? 0.24 : 0.15, hide, sign * 0.015, -0.13, 0, leg);
    put(tube([[0, -0.09, 0], [sign * 0.055, -0.34, bend], [sign * 0.02, -0.64, 0.06]], 0.059, 14), bone, 0, 0, 0, leg);
    oval(0.07, 0.078, 0.075, belly, sign * 0.055, -0.34, bend, leg);
    oval(0.11, 0.058, 0.16, hide, 0, -0.65, 0.12, leg);
    for (let toe = -1; toe <= 1; toe++) put(horn([[toe * 0.065, -0.63, 0.2], [toe * 0.065, -0.68, 0.32]], 0.029, 8), bone, 0, 0, 0, leg);
  }
  batchSculpt(root); return { body, head, legs, eyes };
}

/** A broad-backed furnace ram with low-set head and huge battering gauntlets. */
export function forgeBrute(root: THREE.Group, material: MaterialFactory) {
  const { put, oval, joint } = workshop(root);
  const hide = material(0x5b473a); hide.roughness = 0.92; hide.metalness = 0;
  const shadow = material(0x282a2c); shadow.roughness = 0.87; shadow.metalness = 0.1;
  const iron = material(0x555b5b); iron.roughness = 0.64; iron.metalness = 0.55;
  const trim = material(0xa48c61); trim.roughness = 0.56; trim.metalness = 0.65;
  const bone = material(0xb9ab8e); bone.roughness = 0.86; bone.metalness = 0;
  const eyes = material(0x30160c, 0xff9851, 1.2);
  const body = joint(0, 1.31, 0);
  put(loft([{ y: -0.53, x: 0.39, z: 0.33 }, { y: -0.14, x: 0.56, z: 0.45 }, { y: 0.34, x: 0.78, z: 0.48 }, { y: 0.66, x: 0.62, z: 0.41 }, { y: 0.75, x: 0.3, z: 0.28 }], 28, 0.8), hide, 0, 0, -0.04, body);
  for (const sign of [-1, 1]) {
    const breast = put(relief([[sign * 0.03, 0.48], [sign * 0.64, 0.38], [sign * 0.6, -0.05], [sign * 0.18, -0.33], [sign * 0.03, -0.25]], 0.13, 0.025), iron, 0, 0, 0.46, body);
    breast.rotation.y = sign * 0.16;
    put(tube([[sign * 0.09, 0.35, 0.5], [sign * 0.36, 0.31, 0.56], [sign * 0.48, 0.12, 0.52]], 0.03), trim, 0, 0, 0, body);
  }
  const head = joint(0, 0.49, 0.46, body);
  put(loft([{ y: -0.23, x: 0.22, z: 0.21 }, { y: -0.08, x: 0.31, z: 0.26 }, { y: 0.21, x: 0.32, z: 0.27 }, { y: 0.34, x: 0.17, z: 0.14 }], 20, 0.7), iron, 0, 0, 0, head);
  put(relief([[-0.28, 0.09], [0.28, 0.09], [0.21, -0.02], [-0.21, -0.02]], 0.035, 0.008), shadow, 0, 0.025, 0.278, head);
  for (const sign of [-1, 1]) {
    put(relief([[sign * 0.06, 0.015], [sign * 0.24, 0.035], [sign * 0.21, -0.011], [sign * 0.065, -0.02]], 0.012, 0.003), eyes, 0, 0.042, 0.309, head);
    put(horn([[sign * 0.25, 0.18, 0], [sign * 0.48, 0.23, -0.12], [sign * 0.59, 0.02, 0.01], [sign * 0.43, -0.1, 0.27]], 0.13, 24), bone, 0, 0, 0, head);
    put(horn([[sign * 0.18, -0.2, 0.18], [sign * 0.24, -0.09, 0.34], [sign * 0.21, 0.02, 0.36]], 0.054, 14), bone, 0, 0, 0, head);
  }
  for (let i = -2; i <= 2; i++) put(tube([[i * 0.055, -0.08, 0.275], [i * 0.045, -0.21, 0.23]], 0.016, 8), trim, 0, 0, 0, head);
  const arms: THREE.Group[] = [], legs: THREE.Group[] = [];
  for (const sign of [-1, 1]) {
    const arm = joint(sign * 0.68, 0.26, -0.01, body); arms.push(arm);
    oval(0.27, 0.34, 0.31, hide, sign * 0.03, -0.2, 0, arm);
    put(loft([{ y: -0.11, x: 0.34, z: 0.38 }, { y: 0.1, x: 0.39, z: 0.39 }, { y: 0.25, x: 0.29, z: 0.32 }], 16, 0.64), iron, 0, 0.03, 0, arm);
    for (let i = 0; i < 2; i++) put(horn([[sign * 0.13, 0.2, -0.18 + i * 0.27], [sign * 0.27, 0.43, -0.24 + i * 0.25], [sign * 0.35, 0.45, -0.38 + i * 0.23]], 0.08, 14), bone, 0, 0, 0, arm);
    put(loft([{ y: -0.91, x: 0.3, z: 0.29 }, { y: -0.68, x: 0.35, z: 0.35 }, { y: -0.4, x: 0.27, z: 0.27 }], 20, 0.68), iron, 0, 0, 0.04, arm);
    for (let i = -1; i <= 1; i++) oval(0.091, 0.13, 0.11, trim, i * 0.19, -0.77, 0.34, arm);
    const leg = joint(sign * 0.32, 0.69, -0.1); legs.push(leg);
    oval(0.23, 0.28, 0.25, hide, 0, -0.13, 0, leg);
    put(loft([{ y: -0.57, x: 0.2, z: 0.21 }, { y: -0.44, x: 0.23, z: 0.24 }, { y: -0.13, x: 0.19, z: 0.22 }], 16, 0.7), iron, 0, 0, 0.02, leg);
    oval(0.24, 0.11, 0.34, shadow, 0, -0.58, 0.12, leg);
    put(relief([[0, 0.13], [0.2, 0], [0.13, -0.15], [-0.13, -0.15], [-0.2, 0]], 0.05, 0.018), trim, 0, -0.2, 0.24, leg);
  }
  batchSculpt(root); return { body, head, arms, legs, eyes };
}
