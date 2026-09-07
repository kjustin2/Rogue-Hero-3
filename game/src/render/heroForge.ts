import * as THREE from "three";
import type { HeroDef } from "../game/heroes";
import { beveledBox } from "./surfaces";
import { loft, metalFinish, relief, tube, weaveTexture } from "./sculpt";
import { cloakStandard } from "./heraldry";

export interface HeroRig {
  torso: THREE.Group;
  armR: THREE.Group; armL: THREE.Group;
  elbowR: THREE.Group; elbowL: THREE.Group;
  legR: THREE.Group; legL: THREE.Group;
  kneeR: THREE.Group; kneeL: THREE.Group;
  cape: THREE.Mesh;
  capeRest: Float32Array;
  sword: THREE.Group;
  tip: THREE.Object3D; base: THREE.Object3D;
  eyes: THREE.MeshStandardMaterial;
  flashMaterials: THREE.MeshStandardMaterial[];
  textures: THREE.Texture[];
}

/** Sculpted, articulated equipment. One protagonist, with joints for swordplay, casting and traversal. */
export function forgeHero(body: THREE.Group, hero: HeroDef, capeColor: number, bladeColor: number): HeroRig {
  const weave = weaveTexture();
  const metal = metalFinish();
  const heraldry = cloakStandard(capeColor);
  const steel = new THREE.MeshStandardMaterial({ color: hero.plate, metalness: 0.48, roughness: 0.64, envMapIntensity: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: hero.plateDark, metalness: 0.3, roughness: 0.78, envMapIntensity: 0.5 });
  const edge = new THREE.MeshStandardMaterial({ color: hero.trim, metalness: 0.62, roughness: 0.72, envMapIntensity: 0.65 });
  const ivory = new THREE.MeshStandardMaterial({ color: 0xdac9a2, metalness: 0.18, roughness: 0.78 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x211d1b, roughness: 0.92, bumpMap: weave, bumpScale: 0.012 });
  const fabric = new THREE.MeshStandardMaterial({ map: heraldry, roughness: 0.94, bumpMap: weave, bumpScale: 0.018, side: THREE.DoubleSide });
  const eyes = new THREE.MeshStandardMaterial({ color: 0x111b1e, emissive: bladeColor, emissiveIntensity: 1.4, roughness: 0.5 });
  const rune = new THREE.MeshStandardMaterial({ color: 0xb8d6dd, emissive: bladeColor, emissiveIntensity: 0.48, metalness: 0.6, roughness: 0.3 });
  for(const mat of [steel,dark,edge]) {mat.roughnessMap=metal;mat.bumpMap=metal;mat.bumpScale=.006;}
  const flashMaterials = [steel, dark, edge, leather, ivory];
  const put = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = body): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; parent.add(m); return m;
  };
  const ellipsoid = (x: number, y: number, z: number, mat: THREE.Material, px: number, py: number, pz: number, parent: THREE.Object3D = body) => {
    const geo = new THREE.SphereGeometry(1, 20, 12); geo.scale(x, y, z); return put(geo, mat, px, py, pz, parent);
  };
  const joint = (parent: THREE.Object3D, x: number, y: number, z: number): THREE.Group => {
    const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g;
  };
  const width = 0.315;
  const torso = joint(body, 0, 1.19, 0);
  // The cuirass swells at the ribs, converges at the waist, and has a raised keel.
  put(loft([
    { y: -0.35, x: width * 0.65, z: 0.13 }, { y: -0.31, x: width * 0.73, z: 0.16 },
    { y: -0.1, x: width * 0.91, z: 0.2 }, { y: 0.18, x: width, z: 0.22 },
    { y: 0.3, x: width * 0.88, z: 0.175 }, { y: 0.34, x: width * 0.55, z: 0.13 },
  ], 24, 0.76), steel, 0, 0, 0, torso);

  for (const sign of [-1, 1]) {
    const breast = put(relief([[0, 0.25], [sign * width * 0.83, 0.18], [sign * width * 0.65, -0.12], [0, -0.2]], 0.035, 0.012), steel, 0, 0, 0.205, torso);
    breast.rotation.y = sign * 0.12;
  }
  put(tube([[0, 0.27, 0.23], [0, 0.05, 0.258], [0, -0.22, 0.18]], 0.012), edge, 0, 0, 0, torso);

  // Three overlapping abdominal lames, each fitted to the torso rather than a belt of cubes.
  for (let i = 0; i < 3; i++) {
    const w = width * (0.8 - i * 0.045);
    put(relief([[-w, 0.04], [-w * 0.9, -0.055], [0, -0.085], [w * 0.9, -0.055], [w, 0.04]], 0.045, 0.008), i === 2 ? dark : steel, 0, -0.16 - i * 0.088, 0.165, torso);
  }
  put(loft([{ y: -0.042, x: width * 0.77, z: 0.164 }, { y: 0.042, x: width * 0.78, z: 0.17 }], 20, 0.7), leather, 0, -0.39, 0, torso);
  put(relief([[-0.07, 0.045], [0.07, 0.045], [0.065, -0.045], [-0.065, -0.045]], 0.035, 0.008), edge, 0.025, -0.39, 0.2, torso);
  // High articulated gorget.
  put(loft([{ y: 0, x: 0.22, z: 0.17 }, { y: 0.035, x: 0.215, z: 0.17 }, { y: 0.13, x: 0.15, z: 0.12 }], 24), dark, 0, 0.32, 0, torso);
  put(new THREE.TorusGeometry(0.159, 0.015, 6, 24), edge, 0, 0.435, 0, torso).rotation.x = Math.PI / 2;

  const head = joint(torso, 0, 0.59, 0);
  const helmW = 0.175;

  put(loft([
    { y: -0.22, x: helmW * 0.64, z: 0.13 }, { y: -0.12, x: helmW, z: 0.18 },
    { y: 0.11, x: helmW * 1.08, z: 0.19 }, { y: 0.22, x: helmW * 0.76, z: 0.15 }, { y: 0.27, x: 0.02, z: 0.035 },
  ], 28, 0.85), steel, 0, 0, -0.025, head);
  // Pointed visor, dark eye sockets, central nasal ridge and swept cheek guards.
  put(relief([[-helmW, 0.09], [0, 0.14], [helmW, 0.09], [helmW * 0.8, -0.055], [0, -0.19], [-helmW * 0.8, -0.055]], 0.055, 0.012), dark, 0, 0, 0.19, head);
  for (const sign of [-1, 1]) {
    const socket = put(relief([[0.022 * sign, 0.03], [0.14 * sign, 0.065], [0.133 * sign, 0.029], [0.025 * sign, 0.007]], 0.015, 0.002), eyes, 0, 0, 0.207, head);
    socket.rotation.y = sign * 0.08;
    put(relief([[0.055 * sign, 0.0], [0.165 * sign, 0.012], [0.137 * sign, -0.14], [0.04 * sign, -0.18]], 0.023, 0.008), steel, 0, 0, 0.219, head);
  }
  put(tube([[0, -0.15, 0.234], [0, 0.08, 0.247], [0, 0.2, 0.14], [0, 0.263, 0], [0, 0.13, -0.19]], 0.014), edge, 0, 0, 0, head);

  const arms: THREE.Group[] = [], elbows: THREE.Group[] = [];
  for (const sign of [1, -1]) {
    const sx = width + 0.11;
    const arm = joint(torso, sx * sign, 0.22, 0);
    const elbow = joint(arm, 0, -0.29, 0);
    arms.push(arm); elbows.push(elbow);
    ellipsoid(0.12, 0.16, 0.13, leather, 0, -0.09, 0, arm);
    put(loft([{ y: -0.25, x: 0.079, z: 0.085 }, { y: -0.2, x: 0.1, z: 0.105 }, { y: -0.03, x: 0.125, z: 0.12 }, { y: 0.015, x: 0.11, z: 0.1 }], 16), steel, 0, 0, 0, arm);
    ellipsoid(0.1, 0.09, 0.11, dark, 0, 0, 0, elbow);
    put(loft([{ y: -0.25, x: 0.072, z: 0.075 }, { y: -0.21, x: 0.093, z: 0.085 }, { y: -0.02, x: 0.115, z: 0.11 }, { y: 0.015, x: 0.09, z: 0.095 }], 16, 0.8), steel, 0, 0, 0, elbow);
    put(relief([[-0.074, 0.11], [0, 0.16], [0.074, 0.11], [0.06, -0.14], [0, -0.18], [-0.06, -0.14]], 0.035, 0.01), dark, 0, -0.1, 0.098, elbow);
    ellipsoid(0.086, 0.095, 0.078, leather, 0, -0.3, 0.016, elbow);
    put(beveledBox(0.14, 0.08, 0.1), steel, 0, -0.28, 0.048, elbow);
    for (let i = 0; i < 3; i++) put(beveledBox(0.027, 0.07, 0.064), dark, (i - 1) * 0.037, -0.337, 0.068, elbow);
    // A raised left guard and a light sword shoulder give the silhouette an
    // intentional asymmetry. Faceted overlapping plates replace round shoulder balls.
    const shoulder = joint(torso, sx * sign, 0.29, 0);
    const sw = sign < 0 ? 0.255 : 0.185;
    for (let i = 0; i < 3; i++) {
      const w = sw*(1-i*0.14);
      const shell = put(loft([{y:-.08,x:w*.86,z:.19-i*.018},{y:-.015,x:w,z:.22-i*.016},{y:.085,x:w*.55,z:.13},{y:.11,x:w*.18,z:.035}],8,.7),i===2?dark:steel,sign*i*.045,-i*.075,0,shoulder);
      shell.rotation.z = sign * -0.24;
    }
    put(tube([[-sw*.9,-.015,.13],[0,.075,.19],[sw*.9,-.015,.13]],.014),edge,0,0,0,shoulder);
    if(sign<0) {
      // The Blade carries a broken burial crown: three swept ivory leaves,
      // recognisable from the gameplay camera without a cloud of glow.
      for (let leaf=0;leaf<3;leaf++) {
        const crest=put(relief([[-.12,-.08],[-.19,.12],[-.13,.34+leaf*.065],[-.025,.17],[.09,.015],[.06,-.09]],.065,.012),ivory,-leaf*.07,.06,-.13+leaf*.12,shoulder);
        crest.rotation.x=-.25;crest.rotation.z=.28;
      }
      put(relief([[-.11,.03],[0,.19],[.11,.03],[0,-.09]],.025,.009),edge,0,0,.2,shoulder);
    }
  }

  const sword = joint(elbows[0], 0, -0.33, 0.075);
  const weapon = new THREE.MeshStandardMaterial({ color: 0xc2d5da, roughness: 0.22, metalness: 0.86 });
  const length = 1.45;
  const bladeWidth = 0.105;

  // Diamond cross-section and tapered tip catch a crisp steel highlight.
  const blade = loft([{ y: 0.15, x: bladeWidth * 0.65, z: 0.027 }, { y: 0.25, x: bladeWidth, z: 0.037 }, { y: length - 0.22, x: bladeWidth * 0.7, z: 0.025 }, { y: length, x: 0.001, z: 0.001 }], 4);
  blade.rotateY(Math.PI / 4); blade.rotateX(Math.PI / 2);
  put(blade, weapon, 0, 0, 0, sword);
  put(tube([[-0.22, 0, 0.035], [-0.15, 0, 0.095], [0, 0, 0.13], [0.15, 0, 0.095], [0.22, 0, 0.035]], 0.027), edge, 0, 0, 0, sword);
  put(tube([[0, 0.036, 0.31], [0, 0.032, length - 0.24]], 0.009), rune, 0, 0, 0, sword);

  put(new THREE.CylinderGeometry(0.043, 0.039, 0.29, 12), leather, 0, 0, -0.065, sword).rotation.x = Math.PI / 2;
  for (let i = 0; i < 5; i++) put(new THREE.TorusGeometry(0.042, 0.008, 5, 12), edge, 0, 0, -0.18 + i * 0.045, sword);
  ellipsoid(0.068, 0.05, 0.07, edge, 0, 0, -0.25, sword);
  const tip = joint(sword, 0, 0, length), base = joint(sword, 0, 0, 0.25);

  ellipsoid(width * 0.73, 0.14, 0.155, leather, 0, 0.83, 0);
  const legs: THREE.Group[] = [], knees: THREE.Group[] = [];
  for (const sign of [1, -1]) {
    const leg = joint(body, sign * 0.165, 0.83, 0);
    const knee = joint(leg, 0, -0.38, 0);
    legs.push(leg); knees.push(knee);
    put(loft([{ y: -0.33, x: 0.082, z: 0.09 }, { y: -0.12, x: 0.125, z: 0.13 }, { y: 0, x: 0.125, z: 0.12 }], 16), leather, 0, 0, 0, leg);
    put(relief([[-0.09, 0.12], [0.1, 0.12], [0.088, -0.13], [0, -0.19], [-0.08, -0.13]], 0.045, 0.016), steel, 0, -0.16, 0.12, leg);
    ellipsoid(0.095, 0.08, 0.105, dark, 0, 0, 0, knee);
    put(relief([[0, 0.105], [0.115, 0.025], [0.07, -0.08], [-0.07, -0.08], [-0.115, 0.025]], 0.047, 0.015), steel, 0, 0, 0.102, knee);
    put(loft([{ y: -0.36, x: 0.074, z: 0.077 }, { y: -0.3, x: 0.08, z: 0.092 }, { y: -0.12, x: 0.112, z: 0.105 }, { y: -0.065, x: 0.091, z: 0.09 }], 16), steel, 0, 0, 0, knee);
    put(tube([[0, -0.32, 0.087], [0, -0.18, 0.115], [0, -0.08, 0.11]], 0.012), edge, 0, 0, 0, knee);
    ellipsoid(0.109, 0.068, 0.2, dark, 0, -0.385, 0.075, knee);
    for (let i = 0; i < 3; i++) put(relief([[-0.09, 0.025], [0.09, 0.025], [0.075, -0.025], [-0.075, -0.025]], 0.06, 0.01), steel, 0, -0.345 - i * 0.007, 0.09 + i * 0.05, knee).rotation.x = -0.85;
    // Hanging tassets have shaped lower edges and overlap the upper thigh.
    const tasset = put(relief([[-0.115, 0.14], [0.11, 0.14], [0.135, -0.11], [0.045, -0.22], [-0.12, -0.14]], 0.035, 0.01), dark, sign * 0.195, 0.79, 0.175);
    tasset.rotation.z = sign * -0.12;
  }

  // Tailored cloak with vertical pleats, an uneven hem and a sewn border in vertex color.
  const capeW = 0.86;
  const capeH = 1.24;
  const capeGeo = new THREE.PlaneGeometry(capeW, capeH, 12, 18);
  const cp = capeGeo.getAttribute("position"), colors: number[] = [];
  for (let i = 0; i < cp.count; i++) {
    const u = cp.getX(i) / capeW + 0.5, v = 0.5 - cp.getY(i) / capeH;
    const taper = 0.54 + v * 0.48;
    cp.setXYZ(i, (u - 0.5) * capeW * taper, -v * capeH + Math.pow(v, 10) * (Math.cos(u * Math.PI * 6) * 0.025), -0.035 - v * 0.13 + Math.sin(u * Math.PI * 8) * (0.025 + v * 0.028));
    const hem = u < 0.095 || u > 0.905 || v > 0.935;
    const shade = 0.84 + Math.sin(u * Math.PI * 8 + 0.7) * 0.14;
    colors.push(hem ? 0.7 : shade, hem ? 0.6 : shade, hem ? 0.42 : shade);
  }
  capeGeo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  capeGeo.computeVertexNormals();
  const capeMat = fabric.clone(); capeMat.vertexColors = true;
  const cape = put(capeGeo, capeMat, 0, 0.32, -0.22, torso);
  const capeRest = new Float32Array(cp.array);
  for (const sign of [-1, 1]) {
    ellipsoid(0.045, 0.045, 0.022, edge, sign * 0.2, 0.28, 0.15, torso);
  }
  put(tube([[-0.19, 0.28, 0.17], [0, 0.2, 0.245], [0.19, 0.28, 0.17]], 0.011), edge, 0, 0, 0, torso);
  return { torso, armR: arms[0], armL: arms[1], elbowR: elbows[0], elbowL: elbows[1], legR: legs[0], legL: legs[1], kneeR: knees[0], kneeL: knees[1], cape, capeRest, sword, tip, base, eyes, flashMaterials, textures: [weave,metal,heraldry] };
}
