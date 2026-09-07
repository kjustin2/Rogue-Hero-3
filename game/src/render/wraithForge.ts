import * as THREE from "three";
import { batchSculpt, horn, loft, relief, tube } from "./sculpt";

/** Ragged veil, recessed mask and visible hands; knives and a portal key define the roles. */
export function forgeWraith(root: THREE.Group, material: (color: number, emissive?: number, intensity?: number) => THREE.MeshStandardMaterial, kind: "shade" | "warper") {
  const shade = kind === "shade";
  const cloth = material(shade ? 0x524354 : 0x57516c); cloth.roughness = 0.96; cloth.metalness = 0;
  const dark = material(0x222530); dark.roughness = 0.92; dark.metalness = 0;
  const bone = material(shade ? 0xb3aaa0 : 0xb7b9c2); bone.roughness = 0.8; bone.metalness = 0.15;
  const silver = material(0x859297); silver.roughness = 0.53; silver.metalness = 0.55;
  const magic = material(0x251f34, shade ? 0xe99cc0 : 0xd0b5ed, 1.1);
  const put = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = root) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; parent.add(m); return m;
  };
  const oval = (rx: number, ry: number, rz: number, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = root) => {
    const geo = new THREE.SphereGeometry(1, 20, 14); geo.scale(rx, ry, rz); return put(geo, mat, x, y, z, parent);
  };
  const body = new THREE.Group(); body.position.y = 1.1; root.add(body);
  put(loft([{ y: -0.71, x: 0.19, z: 0.15 }, { y: -0.42, x: 0.24, z: 0.18 }, { y: 0.03, x: 0.22, z: 0.17 }, { y: 0.31, x: 0.32, z: 0.2 }, { y: 0.4, x: 0.13, z: 0.12 }], 24), dark, 0, 0, 0, body);
  const veil = loft([{ y: -0.88, x: 0.47, z: 0.23, offsetZ: -0.12 }, { y: -0.49, x: 0.31, z: 0.22, offsetZ: -0.08 }, { y: 0.15, x: 0.36, z: 0.25 }, { y: 0.37, x: 0.3, z: 0.2 }], 48);
  const vertices = veil.getAttribute("position");
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i), y = vertices.getY(i), z = vertices.getZ(i), a = Math.atan2(z, x);
    const fold = 1 + Math.sin(a * 9) * 0.09;
    vertices.setXYZ(i, x * fold, y < -0.75 ? y + Math.max(0, Math.sin(a * 7)) * 0.19 : y, z * fold);
  }
  veil.computeVertexNormals(); put(veil, cloth, 0, 0, 0, body);
  for (const sign of [-1, 1]) put(tube([[sign * 0.08, 0.34, 0.23], [sign * 0.2, -0.16, 0.25], [sign * 0.35, -0.67, 0.2]], 0.013), silver, 0, 0, 0, body);
  put(loft([{ y: -0.24, x: 0.24, z: 0.2 }, { y: 0.09, x: 0.23, z: 0.2 }, { y: 0.28, x: 0.1, z: 0.12 }, { y: 0.36, x: 0.012, z: 0.04 }], 28), cloth, 0, 0.6, -0.04, body);
  oval(0.158, 0.207, 0.034, dark, 0, 0.57, 0.175, body);
  put(relief([[-0.115, 0.11], [0, 0.16], [0.115, 0.11], [0.08, -0.08], [0, -0.23], [-0.08, -0.08]], 0.032, 0.009), bone, 0, 0.57, 0.218, body);
  for (const sign of [-1, 1]) put(relief([[sign * 0.025, 0.014], [sign * 0.091, 0.046], [sign * 0.07, -0.026], [sign * 0.028, -0.032]], 0.013, 0.002), magic, 0, 0.59, 0.23, body);
  if (!shade) for (const sign of [-1, 1]) put(horn([[sign * 0.2, 0.5, -0.07], [sign * 0.37, 0.76, -0.15], [sign * 0.27, 1.07, -0.2]], 0.055, 18), silver, 0, 0, 0, body);
  const arms: THREE.Group[] = [];
  for (const sign of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(sign * 0.33, 0.22, 0.02); body.add(arm); arms.push(arm);
    put(loft([{ y: -0.55, x: 0.1, z: 0.1 }, { y: -0.3, x: 0.12, z: 0.11 }, { y: -0.1, x: 0.14, z: 0.14 }, { y: 0.03, x: 0.12, z: 0.11 }], 20), cloth, 0, 0, 0, arm);
    oval(0.071, 0.095, 0.085, bone, 0, -0.6, 0.045, arm);
    for (let i = -1; i <= 1; i++) put(horn([[i * 0.035, -0.61, 0.09], [i * 0.036, -0.69, 0.15], [i * 0.032, -0.67, 0.21]], 0.014, 10), bone, 0, 0, 0, arm);
    if (shade) {
      const knife = put(relief([[0, -0.17], [0.06, 0.02], [0.15, 0.4], [0.07, 0.64], [-0.075, 0.38], [-0.035, 0]], 0.026, 0.007), silver, 0, -0.61, 0.12, arm);
      knife.rotation.x = Math.PI / 2;
      put(tube([[-0.12, -0.59, 0.13], [0, -0.59, 0.19], [0.12, -0.59, 0.13]], 0.021), dark, 0, 0, 0, arm);
    }
  }
  const focus = shade ? null : oval(0.07, 0.1, 0.055, magic, 0.45, 1.45, 0.38);
  if (!shade) {
    // A hollow pronged key makes the blink caster readable from its profile.
    put(tube([[0.45, 0.71, 0.38], [0.45, 1.37, 0.38]], 0.028), silver, 0, 0, 0);
    for (const sign of [-1, 1]) put(tube([[0.45, 1.24, 0.38], [0.45 + sign * 0.18, 1.43, 0.38], [0.45 + sign * 0.15, 1.71, 0.38], [0.45 + sign * 0.04, 1.8, 0.38]], 0.022), silver, 0, 0, 0);
    for (let i = 0; i < 3; i++) put(relief([[-0.05, 0.1], [0.05, 0.1], [0.04, -0.11], [0, -0.16], [-0.04, -0.11]], 0.016, 0.004), bone, (i - 1) * 0.11, 1.1, 0.28);
  }
  batchSculpt(root, focus ? [focus] : []); return { body, arms, focus, focusMat: magic };
}
