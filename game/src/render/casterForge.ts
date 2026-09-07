import * as THREE from "three";
import { batchSculpt, loft, relief, tube } from "./sculpt";

type MaterialFactory = (color: number, emissive?: number, intensity?: number) => THREE.MeshStandardMaterial;

/** Two ritualists: a three-pronged glass focus and a soot-stained funeral censer. */
export function forgeCaster(root: THREE.Group, material: MaterialFactory, kind: "tether" | "caster") {
  const tether = kind === "tether";
  const cloth = material(tether ? 0x555a4d : 0x654138); cloth.roughness = 0.97; cloth.metalness = 0;
  const lining = material(tether ? 0x282f2c : 0x342427); lining.roughness = 0.95; lining.metalness = 0;
  const bone = material(0xb5aa90); bone.roughness = 0.83; bone.metalness = 0;
  const bronze = material(0xa28a5e); bronze.roughness = 0.6; bronze.metalness = 0.6; bronze.envMapIntensity = 0.5;
  const focusMat = material(0x3a2417, tether ? 0xffc878 : 0xff9c62, 1.1);
  const put = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = root) => {
    const mesh = new THREE.Mesh(geo, mat); mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  const oval = (rx: number, ry: number, rz: number, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = root) => {
    const geo = new THREE.SphereGeometry(1, 20, 14); geo.scale(rx, ry, rz); return put(geo, mat, x, y, z, parent);
  };
  const robe = loft([{ y: 0.07, x: 0.48, z: 0.32 }, { y: 0.28, x: 0.43, z: 0.32 }, { y: 0.79, x: 0.29, z: 0.21 }, { y: 1.2, x: 0.3, z: 0.23 }, { y: 1.43, x: 0.39, z: 0.24 }, { y: 1.51, x: 0.16, z: 0.16 }], 48);
  const positions = robe.getAttribute("position");
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i), angle = Math.atan2(z, x);
    const fold = 1 + Math.sin(angle * 12 + y * 0.6) * 0.065;
    positions.setXYZ(i, x * fold, y, z * fold);
  }
  robe.computeVertexNormals(); put(robe, cloth, 0, 0, 0);
  for (const sign of [-1, 1]) {
    const stole = put(relief([[0, 0.58], [sign * 0.17, 0.51], [sign * 0.28, -0.53], [sign * 0.14, -0.68], [sign * 0.065, -0.52]], 0.03, 0.008), lining, sign * 0.04, 0.76, 0.29);
    stole.rotation.y = sign * 0.08;
    put(tube([[sign * 0.09, 1.39, 0.29], [sign * 0.13, 0.8, 0.29], [sign * 0.23, 0.17, 0.34]], 0.012), bronze, 0, 0, 0);
    put(relief([[0, 0.12], [sign * 0.34, 0.07], [sign * 0.43, -0.13], [sign * 0.2, -0.17], [0, -0.08]], 0.05, 0.014), bronze, sign * 0.12, 1.38, 0.12);
  }
  if (tether) {
    // Open pointed hood and narrow bone face, framed by a three-pronged crown.
    put(loft([{ y: -0.21, x: 0.23, z: 0.2 }, { y: 0.09, x: 0.23, z: 0.19 }, { y: 0.3, x: 0.1, z: 0.12 }, { y: 0.39, x: 0.018, z: 0.025 }], 24), cloth, 0, 1.72, -0.035);
    oval(0.16, 0.21, 0.03, lining, 0, 1.72, 0.177);
    put(relief([[-0.105, 0.11], [0, 0.16], [0.105, 0.11], [0.07, -0.1], [0, -0.21], [-0.07, -0.1]], 0.025, 0.008), bone, 0, 1.72, 0.208);
    for (let i = -1; i <= 1; i++) put(tube([[i * 0.2, 1.59, -0.09], [i * 0.29, 1.88, -0.06], [i * 0.24, 2.22 - Math.abs(i) * 0.1, 0.01]], 0.019), bronze, 0, 0, 0);
  } else {
    // Tall funeral mitre: an angular silhouette distinct from the glass reader.
    put(loft([{ y: -0.2, x: 0.22, z: 0.18 }, { y: 0.13, x: 0.26, z: 0.2 }, { y: 0.42, x: 0.21, z: 0.16 }, { y: 0.64, x: 0.015, z: 0.04 }], 20, 0.7), lining, 0, 1.72, -0.04);
    put(relief([[-0.2, -0.02], [0, 0.49], [0.2, -0.02], [0.13, -0.2], [-0.13, -0.2]], 0.04, 0.012), bronze, 0, 1.88, 0.15);
    put(relief([[-0.12, 0.16], [0.12, 0.16], [0.1, -0.14], [0, -0.21], [-0.1, -0.14]], 0.025, 0.008), bone, 0, 1.65, 0.235);
  }
  for (const sign of [-1, 1]) put(relief([[sign * 0.028, 0.01], [sign * 0.085, 0.037], [sign * 0.076, -0.02], [sign * 0.027, -0.025]], 0.01, 0.002), lining, 0, 1.74, tether ? 0.225 : 0.257);
  const arms: THREE.Group[] = [];
  for (const sign of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(sign * 0.34, 1.3, 0.08); root.add(arm); arms.push(arm);
    const sleeve = put(loft([{ y: -0.52, x: 0.18, z: 0.16 }, { y: -0.4, x: 0.18, z: 0.15 }, { y: -0.09, x: 0.12, z: 0.13 }, { y: 0.03, x: 0.15, z: 0.15 }], 24), cloth, 0, 0, 0, arm);
    sleeve.rotation.x = -1.08;
    oval(0.07, 0.105, 0.085, bone, 0, -0.21, 0.46, arm).rotation.x = -0.7;
    for (let finger = -1; finger <= 1; finger++) put(tube([[finger * 0.036, -0.16, 0.49], [finger * 0.035, -0.12, 0.57], [finger * 0.03, -0.06, 0.59]], 0.012, 10), bone, 0, 0, 0, arm);
  }
  const fx = tether ? 0.53 : 0.55, fy = tether ? 1.8 : 1.5, fz = 0.48;
  const focus = put(tether ? new THREE.OctahedronGeometry(0.17) : new THREE.SphereGeometry(0.12, 20, 16), focusMat, fx, fy, fz);
  if (tether) {
    focus.geometry.scale(0.74, 1.25, 0.74);
    for (let i = -1; i <= 1; i++) put(tube([[i * 0.12, 1.23, fz], [i * 0.25, 1.5, fz + 0.03], [i * 0.21, 1.91, fz]], 0.022), bronze, fx, 0, 0);
  } else {
    put(loft([{ y: -0.23, x: 0.09, z: 0.09 }, { y: -0.16, x: 0.18, z: 0.18 }, { y: -0.05, x: 0.16, z: 0.16 }], 20), bronze, fx, fy, fz);
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2;
      put(tube([[Math.sin(a) * 0.16, -0.11, Math.cos(a) * 0.16], [Math.sin(a) * 0.19, 0.08, Math.cos(a) * 0.19], [Math.sin(a) * 0.09, 0.2, Math.cos(a) * 0.09]], 0.018), bronze, fx, fy, fz);
    }
    put(tube([[fx, fy - 0.23, fz], [0.39, 0.99, 0.45], [0.34, 1.08, 0.48]], 0.02), bronze, 0, 0, 0);
  }
  batchSculpt(root, [focus]); return { focus, focusMat, arms };
}
