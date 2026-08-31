import * as THREE from "three";
import { ACT_SET_PROFILES } from "../presentation/profiles";
import type { ActComposition, ActSetId, ActSetProfile } from "../presentation/types";

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

interface SetRecord {
  root: THREE.Group;
  compositions: Record<ActComposition, THREE.Group>;
  glow: THREE.MeshBasicMaterial;
  accent: THREE.MeshStandardMaterial;
  movers: { object: THREE.Object3D; speed: number; phase: number }[];
}

function noise(seed: number, index: number): number {
  let x = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); x ^= x >>> 16;
  return (x >>> 0) / 0xffffffff;
}

function compose(x: number, y: number, z: number, ry = 0, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  _p.set(x, y, z); _e.set(0, ry, 0); _q.setFromEuler(_e); _s.set(sx, sy, sz); return _m.compose(_p, _q, _s);
}

/** Seeded, decorative architecture outside the unchanged combat footprint.
 * One instanced kit per act hides the exposed disc and gives combat, elite and
 * boss rooms distinct silhouettes without becoming collision authority. */
export class WorldSetDirector {
  private readonly sets = new Map<ActSetId, SetRecord>();
  private active: SetRecord | null = null;
  private t = 0;
  private motionScale = 1;
  private quality: "low" | "medium" | "high" = "high";

  constructor(scene: THREE.Scene) {
    for (const [index, id] of (["spire", "forge", "abyss", "hollow", "echo", "wound"] as const).entries()) {
      const set = this.buildSet(ACT_SET_PROFILES[id]);
      set.root.visible = false;
      set.root.position.y = -1000 * (index + 1);
      scene.add(set.root);
      this.sets.set(id, set);
    }
  }

  setPresentationQuality(quality: "low" | "medium" | "high", reduceMotion: boolean): void {
    this.quality = quality;
    this.motionScale = reduceMotion ? 0.08 : quality === "low" ? 0.35 : quality === "medium" ? 0.7 : 1;
  }

  set(id: ActSetId, composition: ActComposition): void {
    this.active = null;
    let parked = 1;
    for (const [key, set] of this.sets) {
      const on = key === id;
      set.root.visible = on;
      set.root.position.y = on ? 0 : -1000 * parked++;
      if (!on) continue;
      this.active = set;
      for (const [name, group] of Object.entries(set.compositions)) group.visible = name === composition;
    }
  }

  update(dt: number, dim: number): void {
    const set = this.active;
    if (!set) return;
    this.t += dt * this.motionScale;
    set.glow.opacity = 0.18 * (1 - dim * 0.58);
    set.accent.emissiveIntensity = 0.38 * (1 - dim * 0.42);
    const moverCount = this.quality === "low" ? Math.min(2, set.movers.length) : set.movers.length;
    for (let i = 0; i < moverCount; i++) {
      const mover = set.movers[i];
      mover.object.rotation.y = mover.phase + this.t * mover.speed;
    }
  }

  private buildSet(profile: ActSetProfile): SetRecord {
    const root = new THREE.Group();
    root.name = `${profile.name} Set`;
    root.userData.solidity = "nonsolid";
    const stone = new THREE.MeshStandardMaterial({
      color: profile.stone, emissive: profile.secondary, emissiveIntensity: 0.11,
      roughness: 0.92, metalness: profile.id === "forge" ? 0.32 : 0.08, flatShading: true,
    });
    const carved = new THREE.MeshStandardMaterial({
      color: new THREE.Color(profile.stone).multiplyScalar(1.32), emissive: profile.secondary,
      emissiveIntensity: 0.16, roughness: 0.78, metalness: profile.id === "forge" ? 0.48 : 0.12, flatShading: true,
    });
    const accent = new THREE.MeshStandardMaterial({
      color: new THREE.Color(profile.accent).multiplyScalar(0.25), emissive: profile.accent,
      emissiveIntensity: 0.42, roughness: 0.34, metalness: 0.24, flatShading: true,
    });
    const glow = new THREE.MeshBasicMaterial({
      color: profile.emissive, transparent: true, opacity: 0.2,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const compositions = {
      combat: new THREE.Group(), elite: new THREE.Group(), boss: new THREE.Group(), noncombat: new THREE.Group(),
    };
    for (const [name, group] of Object.entries(compositions)) {
      group.name = `${profile.name} ${name}`;
      group.userData.solidity = "nonsolid";
      root.add(group);
    }
    const movers: SetRecord["movers"] = [];

    // A different irregular footprint for every set obscures the original top cap.
    const shape = new THREE.Shape();
    const points = 18;
    for (let i = 0; i < points; i++) {
      const a = (i / points) * Math.PI * 2;
      const r = 18.45 + (noise(profile.seed, i) - 0.5) * 1.75;
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      if (i === 0) shape.moveTo(x, z); else shape.lineTo(x, z);
    }
    shape.closePath();
    const floorGeo = new THREE.ShapeGeometry(shape);
    floorGeo.rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(floorGeo, stone);
    floor.position.y = 0.028;
    floor.receiveShadow = true;
    floor.userData.solidity = "ground";
    root.add(floor);

    // Broken tangent slabs replace the uninterrupted neon circle with a readable boundary.
    const edge = new THREE.InstancedMesh(new THREE.BoxGeometry(3.15, 0.16, 0.72), carved, 15);
    for (let i = 0; i < 15; i++) {
      const a = (i / 15) * Math.PI * 2 + noise(profile.seed, 30 + i) * 0.09;
      const r = 19.05 + noise(profile.seed, 50 + i) * 0.72;
      edge.setMatrixAt(i, compose(Math.sin(a) * r, 0.08, Math.cos(a) * r, a, 0.7 + noise(profile.seed, 70 + i) * 0.4, 1, 1));
    }
    edge.receiveShadow = true;
    edge.userData.solidity = "ground";
    root.add(edge);

    const seam = new THREE.InstancedMesh(new THREE.BoxGeometry(1.85, 0.025, 0.075), glow, 18);
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + noise(profile.seed, 100 + i) * 0.28;
      const r = 15.8 + noise(profile.seed, 120 + i) * 2.1;
      seam.setMatrixAt(i, compose(Math.sin(a) * r, 0.071, Math.cos(a) * r, a + (noise(profile.seed, 140 + i) - 0.5) * 0.8, 0.5 + noise(profile.seed, 160 + i), 1, 1));
    }
    seam.userData.solidity = "fx";
    root.add(seam);

    if (profile.id === "spire") this.buildSpire(profile, root, compositions, stone, carved, accent, glow, movers);
    else if (profile.id === "forge") this.buildForge(profile, root, compositions, stone, carved, accent, glow, movers);
    else if (profile.id === "abyss") this.buildAbyss(profile, root, compositions, stone, carved, accent, glow, movers);
    else if (profile.id === "hollow") this.buildHollow(profile, root, compositions, stone, carved, accent, glow, movers);
    else if (profile.id === "echo") this.buildEcho(profile, root, compositions, stone, carved, accent, glow, movers);
    else this.buildWound(profile, root, compositions, stone, carved, accent, glow, movers);

    compositions.combat.visible = true;
    compositions.elite.visible = compositions.boss.visible = compositions.noncombat.visible = false;
    return { root, compositions, glow, accent, movers };
  }

  private buildSpire(p: ActSetProfile, root: THREE.Group, c: Record<ActComposition, THREE.Group>, stone: THREE.Material, carved: THREE.Material, accent: THREE.Material, glow: THREE.Material, movers: SetRecord["movers"]): void {
    const towers = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.78, 1, 6), stone, 14);
    const caps = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.62), accent, 14);
    for (let i = 0; i < 14; i++) {
      const a = -1.42 + i * 0.22, h = 5.2 + noise(p.seed, 200 + i) * 5.5, r = 22 + (i % 3) * 1.4;
      towers.setMatrixAt(i, compose(Math.sin(a) * r, h * 0.5 - 0.2, Math.cos(a) * r, a, 1, h, 1));
      caps.setMatrixAt(i, compose(Math.sin(a) * r, h + 0.15, Math.cos(a) * r, a + i * 0.3, 0.7, 1.2, 0.7));
    }
    towers.castShadow = true; towers.userData.solidity = caps.userData.solidity = "nonsolid"; root.add(towers, caps);
    const bridge = new THREE.InstancedMesh(new THREE.BoxGeometry(3.1, 0.32, 1.1), carved, 8);
    for (let i = 0; i < 8; i++) bridge.setMatrixAt(i, compose((i - 3.5) * 3.3, 5.1 + (i % 2) * 0.3, -24.2, (i % 2 ? 0.05 : -0.07), 0.92, 1, 1));
    bridge.userData.solidity = "nonsolid"; c.combat.add(bridge);
    const mirrors = new THREE.InstancedMesh(new THREE.RingGeometry(1.2, 1.34, 6), glow, 5);
    for (let i = 0; i < 5; i++) mirrors.setMatrixAt(i, compose((i - 2) * 5.1, 2.5 + (i % 2), -20.5, 0, 1, 1.4, 1));
    mirrors.userData.solidity = "fx"; c.elite.add(mirrors);
    const crown = new THREE.Group(); crown.position.set(0, 7.2, -23);
    for (let i = 0; i < 3; i++) { const ring = new THREE.Mesh(new THREE.TorusGeometry(3.2 + i * 1.45, 0.09, 8, 36), glow); ring.rotation.x = 0.55 + i * 0.46; ring.rotation.z = i * 0.75; crown.add(ring); }
    crown.userData.solidity = "fx"; c.boss.add(crown); movers.push({ object: crown, speed: 0.14, phase: 0 });
  }

  private buildForge(_p: ActSetProfile, root: THREE.Group, c: Record<ActComposition, THREE.Group>, stone: THREE.Material, carved: THREE.Material, accent: THREE.Material, glow: THREE.Material, movers: SetRecord["movers"]): void {
    const stacks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.8, 1.2, 1, 8), stone, 10);
    const mouths = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 1.6, 0.18), glow, 10);
    for (let i = 0; i < 10; i++) {
      const a = -1.35 + i * 0.3, h = 3.4 + (i % 4) * 1.15, r = 22.2 + (i % 2) * 1.4;
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      stacks.setMatrixAt(i, compose(x, h * 0.5, z, a, 1, h, 1));
      mouths.setMatrixAt(i, compose(x, 1.25, z + 0.9, a, 1, 1, 1));
    }
    stacks.castShadow = true; stacks.userData.solidity = mouths.userData.solidity = "nonsolid"; root.add(stacks, mouths);
    const gantry = new THREE.InstancedMesh(new THREE.BoxGeometry(4.4, 0.32, 0.55), carved, 9);
    for (let i = 0; i < 9; i++) gantry.setMatrixAt(i, compose((i - 4) * 3.7, 6.3, -22.5 + (i % 2) * 0.5, 0, 0.92, 1, 1));
    gantry.userData.solidity = "nonsolid"; c.combat.add(gantry);
    const chains = new THREE.InstancedMesh(new THREE.TorusGeometry(0.52, 0.11, 6, 10), carved, 24);
    for (let i = 0; i < 24; i++) chains.setMatrixAt(i, compose((i < 12 ? -1 : 1) * 11.5, 8.5 - (i % 12) * 0.65, -20.7, 0, 1, 1, 1));
    chains.userData.solidity = "nonsolid"; c.elite.add(chains);
    const core = new THREE.Group(); core.position.set(0, 4.5, -23.5);
    const coreMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(2.2, 1), accent); core.add(coreMesh);
    const coreRing = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.13, 8, 32), glow); coreRing.rotation.x = 1.1; core.add(coreRing);
    core.userData.solidity = "fx"; c.boss.add(core); movers.push({ object: coreRing, speed: 0.22, phase: 0 });
  }

  private buildAbyss(p: ActSetProfile, root: THREE.Group, c: Record<ActComposition, THREE.Group>, stone: THREE.Material, carved: THREE.Material, accent: THREE.Material, glow: THREE.Material, movers: SetRecord["movers"]): void {
    const obelisks = new THREE.InstancedMesh(new THREE.BoxGeometry(1.1, 1, 1.1), stone, 13);
    const shards = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.54), accent, 18);
    for (let i = 0; i < 13; i++) {
      const a = -1.5 + i * 0.25, h = 4 + noise(p.seed, 250 + i) * 6, r = 22 + (i % 3) * 1.2;
      obelisks.setMatrixAt(i, compose(Math.sin(a) * r, h * 0.5 - 0.4, Math.cos(a) * r, a + (i % 2 ? 0.08 : -0.1), 1, h, 1));
    }
    for (let i = 0; i < 18; i++) { const a = i * 2.399, r = 20.4 + (i % 4) * 1.25; shards.setMatrixAt(i, compose(Math.sin(a) * r, 3 + (i % 5), Math.cos(a) * r, a, 0.6, 1.3, 0.6)); }
    obelisks.castShadow = true; obelisks.userData.solidity = shards.userData.solidity = "nonsolid"; root.add(obelisks, shards);
    const causeway = new THREE.InstancedMesh(new THREE.BoxGeometry(4.3, 0.42, 2.3), carved, 7);
    for (let i = 0; i < 7; i++) causeway.setMatrixAt(i, compose((i - 3) * 4.15, 0.24 + (i % 2) * 0.08, -15.5, (i % 2 ? 0.05 : -0.09), 0.92, 1, 1));
    causeway.userData.solidity = "ground"; c.combat.add(causeway);
    const tribunal = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.75, 1.1, 2.1, 7), carved, 7);
    for (let i = 0; i < 7; i++) { const a = -1.2 + i * 0.4; tribunal.setMatrixAt(i, compose(Math.sin(a) * 15.7, 1.05, Math.cos(a) * 15.7 - 1.5, a)); }
    tribunal.userData.solidity = "nonsolid"; c.elite.add(tribunal);
    const tear = new THREE.Mesh(new THREE.PlaneGeometry(7, 10), glow); tear.position.set(0, 5.2, -23.8); tear.rotation.y = Math.PI; tear.userData.solidity = "fx"; c.boss.add(tear);
    movers.push({ object: tear, speed: 0.06, phase: Math.PI });
  }

  private buildHollow(_p: ActSetProfile, root: THREE.Group, c: Record<ActComposition, THREE.Group>, stone: THREE.Material, carved: THREE.Material, accent: THREE.Material, glow: THREE.Material, movers: SetRecord["movers"]): void {
    const arches = new THREE.InstancedMesh(new THREE.TorusGeometry(2.1, 0.28, 7, 18, Math.PI), stone, 9);
    for (let i = 0; i < 9; i++) { const a = -1.28 + i * 0.32, r = 22.5; arches.setMatrixAt(i, compose(Math.sin(a) * r, 2.2, Math.cos(a) * r, -a, 1, 1.7 + (i % 3) * 0.3, 1)); }
    arches.castShadow = true; arches.userData.solidity = "nonsolid"; root.add(arches);
    const instruments = new THREE.InstancedMesh(new THREE.TorusGeometry(1.1, 0.08, 6, 20), carved, 10);
    for (let i = 0; i < 10; i++) { const a = i * 0.63; instruments.setMatrixAt(i, compose(Math.sin(a) * 17, 0.8 + (i % 3) * 0.5, Math.cos(a) * 17, a, 0.7 + (i % 2) * 0.4, 1, 1)); }
    instruments.userData.solidity = "nonsolid"; c.combat.add(instruments);
    const archive = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 4.2, 0.7), carved, 8);
    for (let i = 0; i < 8; i++) archive.setMatrixAt(i, compose((i - 3.5) * 3.4, 2.1, -21.7 + (i % 2) * 0.6, 0, 1, 1, 1));
    archive.userData.solidity = "nonsolid"; c.elite.add(archive);
    const orrery = new THREE.Group(); orrery.position.set(0, 5.5, -23.2);
    for (let i = 0; i < 4; i++) { const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2 + i * 0.8, 0.07, 7, 32), i === 3 ? accent : glow); ring.rotation.set(i * 0.43, i * 0.67, i * 0.31); orrery.add(ring); }
    orrery.userData.solidity = "fx"; c.boss.add(orrery); movers.push({ object: orrery, speed: 0.08, phase: 0 });
  }

  private buildEcho(_p: ActSetProfile, root: THREE.Group, c: Record<ActComposition, THREE.Group>, _stone: THREE.Material, carved: THREE.Material, accent: THREE.Material, glow: THREE.Material, movers: SetRecord["movers"]): void {
    const shards = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(1.1), accent, 26);
    for (let i = 0; i < 26; i++) { const a = i * 2.399, r = 18.8 + (i % 5) * 1.15; shards.setMatrixAt(i, compose(Math.sin(a) * r, 1.2 + (i % 7) * 0.85, Math.cos(a) * r, -a, 0.45 + (i % 3) * 0.22, 1.2, 0.45)); }
    shards.userData.solidity = "nonsolid"; root.add(shards);
    const split = new THREE.InstancedMesh(new THREE.BoxGeometry(2.8, 0.22, 1.3), carved, 12);
    for (let i = 0; i < 6; i++) {
      const x = 7 + i * 2.2, z = -13 + i * 4.2;
      split.setMatrixAt(i * 2, compose(x, 0.16, z, 0.25)); split.setMatrixAt(i * 2 + 1, compose(-x, 0.16, z, -0.25));
    }
    split.userData.solidity = "ground"; c.boss.add(split);
    const mirror = new THREE.Mesh(new THREE.PlaneGeometry(8.5, 8.5), glow); mirror.position.set(0, 4.4, -23); mirror.rotation.y = Math.PI; mirror.userData.solidity = "fx"; c.boss.add(mirror); movers.push({ object: mirror, speed: -0.04, phase: Math.PI });
  }

  private buildWound(_p: ActSetProfile, root: THREE.Group, c: Record<ActComposition, THREE.Group>, stone: THREE.Material, carved: THREE.Material, accent: THREE.Material, glow: THREE.Material, movers: SetRecord["movers"]): void {
    const ribs = new THREE.InstancedMesh(new THREE.TorusGeometry(3.2, 0.36, 6, 18, Math.PI), carved, 10);
    for (let i = 0; i < 10; i++) { const a = -1.35 + i * 0.3, r = 22.2; ribs.setMatrixAt(i, compose(Math.sin(a) * r, 2.3 + (i % 2) * 0.7, Math.cos(a) * r, -a, 1, 1.2, 1)); }
    ribs.castShadow = true; ribs.userData.solidity = "nonsolid"; root.add(ribs);
    const fissures = new THREE.InstancedMesh(new THREE.BoxGeometry(4.1, 0.026, 0.11), glow, 15);
    for (let i = 0; i < 15; i++) { const a = i * 2.399, r = 3.6 + (i % 5) * 2.9; fissures.setMatrixAt(i, compose(Math.sin(a) * r, 0.076, Math.cos(a) * r, a + 0.7, 0.7 + (i % 3) * 0.2, 1, 1)); }
    fissures.userData.solidity = "fx"; c.boss.add(fissures);
    const altar = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3.1, 1.1, 9), stone); altar.position.set(0, 0.55, -8); altar.userData.solidity = "nonsolid"; c.boss.add(altar);
    const scar = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 12), accent); scar.position.set(0, 0.085, -5); scar.rotation.x = -Math.PI / 2; scar.userData.solidity = "fx"; c.boss.add(scar); movers.push({ object: scar, speed: 0.02, phase: 0 });
  }
}
