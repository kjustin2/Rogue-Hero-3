import * as THREE from "three";

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
// Opaque floor dressing must remain below every gameplay ring/telegraph. The
// prior 4.5cm boxes rose to y≈0.08 and visibly sliced through the hero's cyan
// aura in the title composition.
const DECOR_FLOOR_THICKNESS = 0.008;
const DECOR_FLOOR_CENTER_Y = 0.03;

/** Act I authored set: an irregular ruined basilica wrapped around the unchanged
 * circular collision arena. Repeated stone, rubble and chain links are instanced. */
export class RiftBasilica {
  readonly root = new THREE.Group();
  private readonly nave = new THREE.Group();
  private readonly reliquary = new THREE.Group();
  private readonly courtyard = new THREE.Group();
  private readonly emberMat: THREE.MeshBasicMaterial;
  private readonly runeMat: THREE.MeshBasicMaterial;
  private t = 0;

  constructor(scene: THREE.Scene) {
    this.root.name = "Rift Basilica";
    this.root.userData.solidity = "nonsolid";

    const stone = new THREE.MeshStandardMaterial({
      color: 0x25212d, emissive: 0x32171c, emissiveIntensity: 0.25,
      roughness: 0.92, metalness: 0.04, flatShading: true,
    });
    const carved = new THREE.MeshStandardMaterial({
      color: 0x332d39, emissive: 0x431d1b, emissiveIntensity: 0.26,
      roughness: 0.86, metalness: 0.08, flatShading: true,
    });
    const metal = new THREE.MeshStandardMaterial({
      color: 0x15151a, emissive: 0x2c110b, emissiveIntensity: 0.16,
      roughness: 0.48, metalness: 0.72, flatShading: true,
    });
    this.emberMat = new THREE.MeshBasicMaterial({
      color: 0xff5a24, transparent: true, opacity: 0.28,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.runeMat = new THREE.MeshBasicMaterial({
      color: 0xffb35c, transparent: true, opacity: 0.42,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.nave.name = "Combat Nave";
    this.reliquary.name = "Elite Reliquary";
    this.courtyard.name = "Warden Gate Courtyard";
    for (const g of [this.nave, this.reliquary, this.courtyard]) {
      g.userData.solidity = "nonsolid";
      this.root.add(g);
    }

    // Irregular stone apron overlays the old perfect disc and creates a broken,
    // authored silhouette without changing collision or reachability.
    const outline = [
      [-17.8, -8.5], [-14.2, -15.1], [-6.2, -18.1], [2.2, -17.5],
      [10.8, -16.4], [17.9, -8.3], [18.3, 1.8], [15.8, 10.2],
      [8.4, 17.6], [-0.8, 18.2], [-10.5, 15.7], [-17.4, 8.6], [-18.4, -0.8],
    ];
    const shape = new THREE.Shape();
    shape.moveTo(outline[0][0], outline[0][1]);
    for (let i = 1; i < outline.length; i++) shape.lineTo(outline[i][0], outline[i][1]);
    shape.closePath();
    const floorGeo = new THREE.ShapeGeometry(shape);
    floorGeo.rotateX(-Math.PI / 2);
    const apron = new THREE.Mesh(floorGeo, stone);
    apron.position.y = 0.025;
    apron.receiveShadow = true;
    apron.userData.solidity = "ground";
    this.root.add(apron);

    const chasm = new THREE.Mesh(new THREE.RingGeometry(18.3, 24.5, 48), this.emberMat);
    chasm.rotation.x = -Math.PI / 2;
    chasm.position.y = -0.45;
    this.root.add(chasm);

    // Radial cracked slabs: one instanced draw, asymmetrically missing around the rim.
    const slabGeo = new THREE.BoxGeometry(2.8, DECOR_FLOOR_THICKNESS, 1.45);
    const slabs = new THREE.InstancedMesh(slabGeo, carved, 18);
    slabs.receiveShadow = true;
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + 0.17;
      // Edge-only: these never bridge a gameplay chasm or cover a telegraph.
      const r = 15.1 + (i % 3) * 0.75;
      _p.set(Math.sin(a) * r, DECOR_FLOOR_CENTER_Y + (i % 2) * 0.002, Math.cos(a) * r);
      _e.set(0, a + (i % 2 ? 0.18 : -0.12), (i % 4 - 1.5) * 0.008);
      _q.setFromEuler(_e);
      _s.set(0.72 + (i % 5) * 0.05, 1, 0.72 + (i % 3) * 0.08);
      _m.compose(_p, _q, _s);
      slabs.setMatrixAt(i, _m);
    }
    slabs.userData.floorLayer = "decor";
    slabs.userData.solidity = "ground";
    this.root.add(slabs);

    // Broken processional aisle: quiet value variation through the center gives
    // the nave perspective and scale while remaining flat, non-solid, and darker
    // than every gameplay telegraph.
    const aisleMat = new THREE.MeshStandardMaterial({
      color: 0x302b37, emissive: 0x2d1519, emissiveIntensity: 0.18,
      roughness: 0.96, metalness: 0.02, flatShading: true,
    });
    const aisle = new THREE.InstancedMesh(new THREE.BoxGeometry(5.8, DECOR_FLOOR_THICKNESS, 1.65), aisleMat, 10);
    aisle.receiveShadow = true;
    for (let i = 0; i < 10; i++) {
      _p.set((i % 3 - 1) * 0.18, DECOR_FLOOR_CENTER_Y + 0.002, -12.8 + i * 2.65);
      _e.set(0, (i % 2 ? 1 : -1) * (0.018 + i * 0.002), 0);
      _q.setFromEuler(_e);
      _s.set(0.9 - (i % 4) * 0.035, 1, 1);
      _m.compose(_p, _q, _s);
      aisle.setMatrixAt(i, _m);
    }
    aisle.userData.floorLayer = "decor";
    aisle.userData.solidity = "ground";
    this.nave.add(aisle);

    // Broken columns frame the rear half of the arena but sit beyond the playable rim.
    const columnGeo = new THREE.CylinderGeometry(0.62, 0.82, 5.8, 7);
    const columns = new THREE.InstancedMesh(columnGeo, stone, 12);
    columns.castShadow = true;
    columns.receiveShadow = true;
    for (let i = 0; i < 12; i++) {
      const a = -1.2 + i * 0.22;
      const r = 21.5 + (i % 2) * 1.2;
      _p.set(Math.sin(a) * r, 2.1 - (i % 4) * 0.45, Math.cos(a) * r);
      _e.set((i % 3 - 1) * 0.06, a, (i % 2 ? 1 : -1) * 0.08);
      _q.setFromEuler(_e);
      _s.set(1, 0.7 + (i % 4) * 0.09, 1);
      _m.compose(_p, _q, _s);
      columns.setMatrixAt(i, _m);
    }
    columns.userData.solidity = "nonsolid";
    this.root.add(columns);

    // Enormous broken gate at the far edge: the landmark visible in calm and boss shots.
    const gate = new THREE.Group();
    gate.position.set(0, 0, -21.5);
    const pillarGeo = new THREE.BoxGeometry(2.2, 9.5, 2.2);
    for (const x of [-5.1, 5.1]) {
      const p = new THREE.Mesh(pillarGeo, carved);
      p.position.set(x, 4.3, 0);
      p.rotation.z = x < 0 ? -0.07 : 0.07;
      p.castShadow = true;
      gate.add(p);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(11.5, 1.6, 2.3), carved);
    lintel.position.set(0, 8.2, 0);
    lintel.rotation.z = -0.035;
    gate.add(lintel);
    const seal = new THREE.Mesh(new THREE.RingGeometry(2.15, 2.28, 16), this.runeMat);
    seal.position.set(0, 4.4, 1.2);
    gate.add(seal);
    gate.userData.solidity = "nonsolid";
    this.root.add(gate);

    // Three safe node compositions outside the unchanged gameplay footprint.
    const pews = new THREE.InstancedMesh(new THREE.BoxGeometry(3.4, 0.38, 0.7), carved, 10);
    for (let i = 0; i < 10; i++) {
      const side = i < 5 ? -1 : 1;
      const row = i % 5;
      _p.set(side * (10.8 + (row % 2) * 0.35), 0.22, -7.5 + row * 3.5);
      _e.set(0, side * -0.2, side * (row - 2) * 0.018);
      _q.setFromEuler(_e); _s.set(1, 1, 1); _m.compose(_p, _q, _s); pews.setMatrixAt(i, _m);
    }
    pews.userData.solidity = "nonsolid";
    this.nave.add(pews);

    const shrineMat = new THREE.MeshStandardMaterial({ color: 0x21172b, emissive: 0x7a35b5, emissiveIntensity: 0.8, roughness: 0.5, metalness: 0.12, flatShading: true });
    const plinths = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.9, 1.25, 1.05, 7), carved, 6);
    const relics = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.42), shrineMat, 6);
    for (let i = 0; i < 6; i++) {
      const a = -1.15 + i * 0.46;
      _p.set(Math.sin(a) * 14.7, 0.53, Math.cos(a) * 14.7 - 1.5);
      _e.set(0, a, 0); _q.setFromEuler(_e); _s.set(1, 1, 1); _m.compose(_p, _q, _s); plinths.setMatrixAt(i, _m);
      _p.y = 1.45; _e.set(i * 0.3, a * 1.4, 0.4); _q.setFromEuler(_e); _s.set(1, 1.35, 1); _m.compose(_p, _q, _s); relics.setMatrixAt(i, _m);
    }
    plinths.userData.solidity = relics.userData.solidity = "nonsolid";
    this.reliquary.add(plinths, relics);
    const reliquarySeal = new THREE.Mesh(new THREE.RingGeometry(4.2, 4.32, 48), this.runeMat);
    reliquarySeal.rotation.x = -Math.PI / 2; reliquarySeal.position.set(0, 0.075, -7.5);
    this.reliquary.add(reliquarySeal);

    const braziers = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.45, 0.7, 1.4, 6), metal, 4);
    const flames = new THREE.InstancedMesh(new THREE.ConeGeometry(0.32, 1.5, 5), this.emberMat, 4);
    const points = [[-8.5, -14.7], [8.5, -14.7], [-12.5, -9.8], [12.5, -9.8]];
    points.forEach(([x, z], i) => {
      _p.set(x, 0.7, z); _e.set(0, 0, 0); _q.setFromEuler(_e); _s.set(1, 1, 1); _m.compose(_p, _q, _s); braziers.setMatrixAt(i, _m);
      _p.y = 1.95; _e.set(0, i * 0.8, 0.08); _q.setFromEuler(_e); _m.compose(_p, _q, _s); flames.setMatrixAt(i, _m);
    });
    braziers.userData.solidity = flames.userData.solidity = "nonsolid";
    this.courtyard.add(braziers, flames);

    // Giant hanging chains, instanced as dark iron torus links.
    const linkGeo = new THREE.TorusGeometry(0.7, 0.13, 6, 12);
    const links = new THREE.InstancedMesh(linkGeo, metal, 30);
    links.castShadow = true;
    for (let i = 0; i < 30; i++) {
      const chain = i < 15 ? -1 : 1;
      const j = i % 15;
      _p.set(chain * (13.4 - j * 0.08), 9.8 - j * 0.64, -19.2 + j * 0.08);
      _e.set(0, chain * 0.35, (j % 2) * Math.PI / 2);
      _q.setFromEuler(_e);
      _s.setScalar(1);
      _m.compose(_p, _q, _s);
      links.setMatrixAt(i, _m);
    }
    links.userData.solidity = "nonsolid";
    this.root.add(links);

    // Rubble tells the ruin story without becoming gameplay collision.
    const rubbleGeo = new THREE.DodecahedronGeometry(0.45, 0);
    const rubble = new THREE.InstancedMesh(rubbleGeo, stone, 32);
    for (let i = 0; i < 32; i++) {
      const a = i * 2.399963;
      const r = 16.8 + (i % 5) * 0.55;
      _p.set(Math.sin(a) * r, 0.22, Math.cos(a) * r);
      _e.set(i * 0.7, a, i * 0.31);
      _q.setFromEuler(_e);
      const z = 0.55 + (i % 4) * 0.18;
      _s.set(z * 1.3, z, z * 0.8);
      _m.compose(_p, _q, _s);
      rubble.setMatrixAt(i, _m);
    }
    rubble.userData.solidity = "nonsolid";
    this.root.add(rubble);

    scene.add(this.root);
    this.setComposition("nave");
  }

  setVisible(on: boolean): void { this.root.visible = on; }

  setComposition(kind: "nave" | "reliquary" | "courtyard"): void {
    this.nave.visible = kind === "nave";
    this.reliquary.visible = kind === "reliquary";
    this.courtyard.visible = kind === "courtyard";
  }

  update(dt: number, dim: number): void {
    if (!this.root.visible) return;
    this.t += dt;
    this.emberMat.opacity = 0.245 * (1 - dim * 0.45);
    this.runeMat.opacity = 0.4 * (1 - dim * 0.5);
  }
}
