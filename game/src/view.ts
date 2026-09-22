import * as T from "three";
import { TitleScene } from "./title-scene";
import {
  Game,
  PILLARS,
  STRIKES,
  BELL,
  BOSS_SWEEP,
  CROSS_ANGLE,
  ENEMY_IMPACT,
  LUNGE,
  MAX_STEP,
  type Actor,
} from "./sim";
const mat = (color: number) =>
  new T.MeshStandardMaterial({ color, roughness: 1, flatShading: true });
const stone = mat(0x292a29),
  edge = mat(0x48453e),
  iron = mat(0x171e20),
  bone = mat(0xb9ad8e),
  cloth = mat(0x682d2e),
  gold = mat(0x877044);
function mesh(
  g: T.BufferGeometry,
  m: T.Material,
  parent: T.Object3D,
  x = 0,
  y = 0,
  z = 0,
) {
  const o = new T.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = o.receiveShadow = true;
  parent.add(o);
  return o;
}
function box(
  parent: T.Object3D,
  m: T.Material,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
) {
  return mesh(new T.BoxGeometry(w, h, d), m, parent, x, y, z);
}
function taper(
  parent: T.Object3D,
  m: T.Material,
  top: number,
  bottom: number,
  h: number,
  y: number,
  n = 7,
) {
  return mesh(new T.CylinderGeometry(top, bottom, h, n), m, parent, 0, y, 0);
}
interface Rig {
  action: Actor["action"];
  previousPose: number[];
  transitionPose: number[];
  root: T.Group;
  body: T.Group;
  head: T.Group;
  arm: T.Group;
  offArm: T.Group;
  cloak: T.Group;
  weapon: T.Group;
  legs: T.Group[];
  tell: T.Mesh;
  materials: T.MeshStandardMaterial[];
}
export class View {
  scene = new T.Scene();
  camera = new T.OrthographicCamera(-15, 15, 10, -10, 0.1, 100);
  renderer: T.WebGLRenderer;
  private titleScene: TitleScene;
  private actors = new Map<number, Rig>();
  private activeGame: Game | null = null;
  private dashWake = new T.Group();
  private fx = new T.Group();
  private playerRing = new T.Mesh(
    new T.RingGeometry(0.52, 0.57, 32),
    new T.MeshBasicMaterial({
      color: 0xc8b698,
      transparent: true,
      opacity: 0.55,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  private ray = new T.Raycaster();
  private plane = new T.Plane(new T.Vector3(0, 1, 0), 0);
  private point = new T.Vector3();
  private aim = new T.Vector2();
  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new T.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    // Three uneven graphite cuts stay at foot level as the dash passes.
    for (const [side, length] of [[-1, 0.9], [0, 1.15], [1, 0.65]]) {
      const shape = new T.Shape();
      shape.moveTo(0, 0); shape.lineTo(0.11, -0.16);
      shape.lineTo(-0.04, -length); shape.lineTo(-0.065, -0.24);
      shape.closePath();
      const wake = mesh(new T.ShapeGeometry(shape), new T.MeshBasicMaterial({
        color: 0x827a6d, transparent: true, opacity: 0.34,
        depthWrite: false, side: T.DoubleSide,
      }), this.dashWake, side * 0.23, 0.035, 0);
      wake.rotation.x = Math.PI / 2;
      wake.castShadow = wake.receiveShadow = false;
    }
    this.scene.add(this.dashWake);
    this.scene.background = new T.Color(0x111617);
    this.scene.fog = new T.Fog(0x111617, 35, 65);
    this.camera.position.set(16, 24, 20);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(new T.HemisphereLight(0xb1c5ce, 0x344449, 2.2));
    const fill = new T.DirectionalLight(0x769eaf, 1.1);
    fill.position.set(10, 8, -5);
    this.scene.add(fill);
    const sun = new T.DirectionalLight(0xe4cfad, 3.2);
    sun.position.set(-8, 18, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {
      left: -18,
      right: 18,
      top: 18,
      bottom: -18,
    });
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);
    this.scene.add(this.fx);
    this.playerRing.rotation.x = -Math.PI / 2;
    this.playerRing.renderOrder = 5;
    this.scene.add(this.playerRing);
    this.titleScene = new TitleScene(this.environment());
    this.resize();
  }
  resize() {
    const w = innerWidth,
      h = innerHeight;
    this.renderer.setSize(w, h);
    // Keep the arena's projected width visible in square/narrow desktop windows.
    const size = Math.max(12, 16.5 / (w / h));
    this.camera.left = (-size * w) / h;
    this.camera.right = (size * w) / h;
    this.camera.top = size;
    this.camera.bottom = -size;
    this.camera.updateProjectionMatrix();
  }
  private environment() {
    const group = new T.Group();
    this.scene.add(group);
    box(group, stone, 0, -0.65, 0, 70, 1, 65);
    const tiles = [mat(0x373b39), mat(0x303635), mat(0x3b3c37), mat(0x323936)];
    const slab = new T.Shape();
    slab.moveTo(-0.96, -0.83);
    slab.lineTo(-0.83, -0.96);
    slab.lineTo(0.88, -0.96);
    slab.lineTo(0.96, -0.88);
    slab.lineTo(0.96, 0.78);
    slab.lineTo(0.78, 0.96);
    slab.lineTo(-0.96, 0.96);
    slab.closePath();
    const paving = new T.ExtrudeGeometry(slab, {
      depth: 0.12,
      bevelEnabled: true,
      bevelSegments: 1,
      steps: 1,
      bevelSize: 0.025,
      bevelThickness: 0.025,
    });
    paving.rotateX(-Math.PI / 2);
    for (let x = -11; x < 11; x += 2)
      for (let z = -9; z < 9; z += 2) {
        const column = (x + 11) / 2,
          row = (z + 9) / 2;
        let variation =
          Math.imul(column + 1, 73856093) ^ Math.imul(row + 1, 19349663);
        variation = Math.imul(variation ^ (variation >>> 16), 0x45d9f3b);
        variation = (variation ^ (variation >>> 16)) >>> 0;
        const tile = mesh(
          paving,
          tiles[variation % 4],
          group,
          x + 1,
          -0.16,
          z + 1,
        );
        tile.rotation.y = ((variation % 4) * Math.PI) / 2;
      }
    for (const side of [-1, 1]) {
      box(group, edge, side * 11.5, 0.25, 0, 0.8, 0.65, 19);
      box(group, edge, 0, 0.25, side * 9.5, 24, 0.65, 0.8);
    }
    // Tall far walls, low near walls: architecture frames combat rather than hides it.
    for (let x = -12; x <= 12; x += 3) {
      box(group, stone, x, 2, -10, 2.9, 4, 0.8);
      box(group, edge, x, 2.5, -9.65, 0.4, 5, 0.8);
    }
    for (const p of PILLARS) {
      taper(group, stone, p.r * 0.8, p.r, 3.8, 1.9);
      const column = group.children[group.children.length - 1];
      column.position.x = p.x;
      column.position.z = p.z;
      box(group, edge, p.x, 0.15, p.z, p.r * 2.4, 0.3, p.r * 2.4);
    }
    for (const x of [-8.5, 8.5])
      for (const z of [-7, 7]) {
        const base = taper(group, iron, 0.17, 0.3, 0.65, 0.32);
        base.position.set(x, 0.32, z);
        const fire = mesh(
          new T.OctahedronGeometry(0.18),
          new T.MeshBasicMaterial({ color: 0xffb85c }),
          group,
          x,
          0.9,
          z,
        );
        fire.scale.y = 1.8;
        const light = new T.PointLight(0xffa04f, 7, 7, 2);
        light.position.set(x, 1.1, z);
        group.add(light);
      }
    for (let i = 0; i < 55; i++) {
      const a = i * 2.399,
        r = 13 + (i % 7) * 0.7;
      const rubble = mesh(
        new T.DodecahedronGeometry(0.3 + (i % 3) * 0.16, 0),
        stone,
        group,
        Math.sin(a) * r,
        -0.02,
        Math.cos(a) * r,
      );
      rubble.rotation.set(i, 0.2 * i, 0.1 * i);
    }
    return group;
  }
  private rig(a: Actor) {
    const root = new T.Group(),
      body = new T.Group(),
      head = new T.Group(),
      arm = new T.Group(),
      offArm = new T.Group(),
      cloak = new T.Group(),
      weapon = new T.Group();
    root.add(body);
    body.add(head, arm, offArm, cloak);
    arm.add(weapon);
    this.scene.add(root);
    const heroic = a.kind === "blade",
      boss = a.kind === "boss";
    const skin = bone.clone(),
      metal = iron.clone(),
      fabric = heroic
        ? cloth.clone()
        : mat(a.kind === "cantor" ? 0x536269 : 0x45413b);
    const materials = [skin, metal, fabric];
    // The player's boots and stance stay visible below a short, split cloak.
    if (!heroic) taper(body, fabric, 0.28, 0.58, 1.05, 0.74, 9);
    else taper(body, metal, 0.26, 0.3, 0.48, 0.78, 6);
    taper(body, metal, 0.4, 0.26, 0.6, 1.32, 6);
    head.position.y = 1.87;
    // Hood and narrow mask: face detail is deliberately a graphic silhouette.
    taper(head, metal, 0.11, 0.29, 0.48, 0, 6);
    const face = mesh(
      new T.ConeGeometry(0.2, 0.42, 3),
      skin,
      head,
      0,
      -0.01,
      0.18,
    );
    face.rotation.z = Math.PI;
    face.scale.z = 0.35;
    box(head, iron, 0, 0.02, 0.245, 0.25, 0.045, 0.025);
    if (heroic) {
      const shape = new T.Shape();
      shape.moveTo(-0.47, 0);
      shape.lineTo(0.31, 0.04);
      shape.lineTo(0.5, -0.93);
      shape.lineTo(0.19, -1.13);
      shape.lineTo(0.05, -0.64);
      shape.lineTo(-0.09, -1.04);
      shape.lineTo(-0.53, -0.83);
      shape.closePath();
      const drape = new T.ExtrudeGeometry(shape, {
        depth: 0.045,
        bevelEnabled: false,
      });
      const vertices = drape.attributes.position;
      for (let i = 0; i < vertices.count; i++) {
        const x = vertices.getX(i),
          y = vertices.getY(i);
        vertices.setZ(i, vertices.getZ(i) + y * 0.24 + Math.abs(x) * 0.28);
      }
      drape.computeVertexNormals();
      cloak.position.set(0, 1.5, -0.28);
      mesh(drape, fabric, cloak);
      const shoulder = mesh(
        new T.OctahedronGeometry(0.27),
        skin,
        body,
        -0.34,
        1.47,
        0,
      );
      shoulder.scale.set(1.25, 0.48, 1);
    }
    offArm.position.set(-0.35, 1.43, 0);
    taper(offArm, metal, 0.12, 0.09, 0.57, -0.24, 6);
    mesh(new T.DodecahedronGeometry(0.105, 0), metal, offArm, 0, -0.54, 0.1);
    arm.position.set(0.39, 1.48, 0);
    taper(arm, metal, 0.13, 0.095, 0.65, -0.25, 6);
    weapon.position.set(0, -0.54, 0.12);
    if (a.kind === "cantor") {
      taper(weapon, gold, 0.08, 0.08, 1.7, 0.3, 6);
      mesh(new T.TorusGeometry(0.3, 0.06, 5, 12), bone, weapon, 0, 1.05, 0);
    } else if (a.kind === "bearer" || boss) {
      const profile = [
        [0.08, 0.67],
        [0.18, 0.6],
        [0.2, 0.37],
        [0.3, 0.13],
        [0.48, -0.02],
        [0.5, -0.09],
        [0.43, -0.13],
        [0.37, -0.04],
        [0.24, 0.16],
        [0.15, 0.4],
        [0.1, 0.53],
        [0.08, 0.67],
      ].map(([radius, height]) => new T.Vector2(radius, height));
      // Bell hangs below a long grip, with its crown entirely below the hand.
      weapon.position.set(0, -0.4, 0.16);
      const bellHead = new T.Group();
      bellHead.position.y = -0.8;
      bellHead.scale.setScalar(0.8);
      weapon.add(bellHead);
      mesh(new T.LatheGeometry(profile, 12), gold, bellHead);
      // Empty dark mouth: no clapper or other hand-like shape inside the bell.
      const mouth = mesh(new T.CircleGeometry(0.37, 12), new T.MeshStandardMaterial({ color: 0x090a09, roughness: 1, side: T.DoubleSide }), bellHead, 0, -0.03, 0);
      mouth.rotation.x = Math.PI / 2;
      materials.push(mouth.material as T.MeshStandardMaterial);
      box(weapon, metal, 0, -0.15, 0, 0.075, 0.35, 0.075);
      box(weapon, metal, 0, 0, 0, 0.18, 0.13, 0.15);
    } else {
      const shape = new T.Shape();
      shape.moveTo(-0.07, 0);
      shape.lineTo(-0.095, 1.05);
      shape.lineTo(0.04, 1.45);
      shape.lineTo(0.12, 1.05);
      shape.lineTo(0.07, 0);
      shape.closePath();
      mesh(
        new T.ExtrudeGeometry(shape, { depth: 0.025, bevelEnabled: false }),
        skin,
        weapon,
      );
      box(weapon, gold, 0, 0, 0, 0.4, 0.07, 0.08);
      weapon.rotation.x = Math.PI * 0.65;
    }
    const legs: T.Group[] = [];
    for (const sign of [-1, 1]) {
      const leg = new T.Group();
      leg.position.set(sign * 0.22, 0.7, heroic ? sign * 0.08 : 0);
      body.add(leg);
      taper(leg, metal, 0.11, 0.08, 0.6, -0.28, 6);
      box(leg, metal, 0, -0.6, 0.1, 0.18, 0.15, 0.32);
      legs.push(leg);
    }
    if (boss) {
      root.scale.setScalar(1.65);
      for (const sign of [-1, 1]) {
        const horn = mesh(
          new T.ConeGeometry(0.13, 0.65, 5),
          gold,
          head,
          sign * 0.25,
          0.28,
          0,
        );
        horn.rotation.z = -sign * 0.4;
      }
    }
    if (boss) {
      const accents = new Map<T.MeshStandardMaterial, T.MeshStandardMaterial>();
      root.traverse((object) => {
        if (!(object instanceof T.Mesh)) return;
        const source = object.material as T.MeshStandardMaterial;
        if (materials.includes(source)) return;
        let owned = accents.get(source);
        if (!owned) {
          owned = source.clone();
          accents.set(source, owned);
          materials.push(owned);
        }
        object.material = owned;
      });
    }
    if (boss) {
      const solid = new Map<T.MeshStandardMaterial, T.MeshStandardMaterial>();
      weapon.traverse(object => {
        if (!(object instanceof T.Mesh)) return;
        const source = object.material as T.MeshStandardMaterial;
        let material = solid.get(source);
        if (!material) {
          material = source.clone();
          material.userData.solidWeapon = true;
          solid.set(source, material);
          materials.push(material);
        }
        object.material = material;
      });
    }
    const tell = new T.Mesh(
      new T.RingGeometry(1.8, 6.2, 64),
      new T.MeshBasicMaterial({
        color: 0xe18b54,
        transparent: true,
        opacity: 0.22,
        toneMapped: false,
        side: T.DoubleSide,
        depthWrite: false,
      }),
    );
    tell.rotation.x = -Math.PI / 2;
    tell.position.y = 0.025;
    tell.visible = false;
    this.scene.add(tell);
    const rig = {
      action: a.action,
      previousPose: [],
      transitionPose: [],
      root,
      body,
      head,
      arm,
      offArm,
      cloak,
      weapon,
      legs,
      tell,
      materials,
    };
    this.actors.set(a.id, rig);
    return rig;
  }
  aimAngle(x: number, y: number, game: Game) {
    this.aim.set((x / innerWidth) * 2 - 1, (-y / innerHeight) * 2 + 1);
    this.ray.setFromCamera(this.aim, this.camera);
    this.ray.ray.intersectPlane(this.plane, this.point);
    // Clicking a raised silhouette should aim at that actor, not the floor behind it.
    let nearest = Infinity;
    for (const enemy of game.enemies) {
      if (enemy.hp <= 0) continue;
      const rig = this.actors.get(enemy.id);
      if (!rig) continue;
      const hit = this.ray.intersectObject(rig.root, true)[0];
      if (!hit || hit.distance >= nearest) continue;
      nearest = hit.distance;
      this.point.set(enemy.x, 0, enemy.z);
    }
    return Math.atan2(
      this.point.x - game.player.x,
      this.point.z - game.player.z,
    );
  }
  configure(brightness: number, quality: string) {
    this.renderer.toneMappingExposure = 1.1 * brightness;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, quality === "high" ? 1.6 : 1));
    this.renderer.shadowMap.enabled = quality === "high";
    this.resize();
  }
  render(game: Game, moving: boolean, titleTime?: number, introTime?: number) {
    if (titleTime !== undefined) {
      this.titleScene.render(this.renderer, titleTime);
      return;
    }
    const all = [game.player, ...game.enemies],
      ids = new Set(all.map((a) => a.id));
    for (const [id, rig] of this.actors)
      if (this.activeGame !== game || !ids.has(id)) {
        this.scene.remove(rig.root, rig.tell);
        rig.root.traverse((o) => {
          if (o instanceof T.Mesh) o.geometry.dispose();
        });
        rig.tell.geometry.dispose();
        (rig.tell.material as T.Material).dispose();
        rig.materials.forEach((m) => m.dispose());
        this.actors.delete(id);
      }
    this.activeGame = game;
    for (const a of all) {
      const r = this.actors.get(a.id) ?? this.rig(a),
        p = Math.min(1, a.time / a.duration),
        walk =
          a.action === "idle" &&
          Math.hypot(a.x - r.root.position.x, a.z - r.root.position.z) >
            0.001 &&
          (a.kind !== "blade" || moving);
      r.root.position.set(a.x, 0, a.z);
      r.root.scale.setScalar(a.kind === "boss" ? 1.65 : 1);
      r.root.rotation.y = a.angle;
      if (game.phase === "between" && a.kind === "blade") {
        const travel = T.MathUtils.smoothstep(game.transitionProgress, 0.12, 0.8);
        r.root.rotation.y = T.MathUtils.lerp(a.angle, Math.PI, travel);
        r.root.position.z -= travel * 2.5;
      }
      r.body.rotation.set(0, 0, 0);
      r.body.position.y = Math.sin(game.time * 2 + a.id) * 0.014;
      r.head.rotation.set(0, Math.sin(game.time * 0.9 + a.id) * 0.05, 0);
      r.arm.rotation.set(-0.15, 0, 0.08);
      r.offArm.rotation.set(
        walk ? Math.sin(game.time * 13) * 0.3 : -0.28,
        0,
        -0.15,
      );
      r.cloak.rotation.x = walk ? 0.14 + Math.sin(game.time * 13) * 0.035 : 0;
      if (a.kind === "blade" || a.kind === "hook")
        r.weapon.rotation.x = Math.PI * 0.65;
      r.legs.forEach(
        (l, i) =>
          (l.rotation.x = walk
            ? Math.sin(game.time * 13 + i * Math.PI) * 0.45
            : 0),
      );
      if (a.action === "slash" || a.action === "heavy") {
        const strike = STRIKES[a.action],
          contact = strike.impact;
        const smooth = (v: number) => {
          v = T.MathUtils.clamp(v, 0, 1);
          return v * v * (3 - 2 * v);
        };
        const returnToGuard = smooth(
          (a.time - contact - 0.06) / (strike.duration - contact - 0.06),
        );
        if (a.action === "slash") {
          const direction = a.combo === 1 ? -1 : 1;
          const sweep = -1 + 2 * smooth((a.time - contact + 0.045) / 0.09);
          r.body.rotation.y = direction * sweep * 0.85 * (1 - returnToGuard);
          r.arm.rotation.set(
            T.MathUtils.lerp(-1.65, -0.15, returnToGuard),
            direction * sweep * 1.85 * (1 - returnToGuard),
            0.08,
          );
          r.offArm.rotation.x = -0.5 * (1 - returnToGuard);
          r.cloak.rotation.x = -0.25 * (1 - returnToGuard);
          r.head.rotation.y = -direction * sweep * 0.2 * (1 - returnToGuard);
        } else {
          const lift = smooth(a.time / 0.24);
          const drop = smooth((a.time - 0.24) / (contact - 0.24));
          const recover = smooth((a.time - 0.45) / (strike.duration - 0.45));
          const pose = (guard: number, raised: number, landed: number) =>
            T.MathUtils.lerp(T.MathUtils.lerp(T.MathUtils.lerp(guard, raised, lift), landed, drop), guard, recover);
          r.arm.rotation.x = pose(-0.15, -2.35, -0.85);
          r.arm.rotation.y = pose(0, -0.18, 0.12);
          r.weapon.rotation.x = pose(Math.PI * 0.65, 2.75, Math.PI);
          r.body.rotation.x = pose(0, -0.12, 0.38);
          r.body.rotation.y = pose(0, -0.25, 0.2);
          r.body.position.y = pose(0, -0.04, -0.16);
          r.offArm.rotation.x = pose(-0.28, -1.55, -0.8);
          r.head.rotation.x = pose(0, 0.08, -0.12);
          r.legs[0].rotation.x = pose(0, -0.24, -0.3);
          r.legs[1].rotation.x = pose(0, 0.16, 0.22);
          r.cloak.rotation.x = pose(0, 0.05, -0.18);
        }
        if (a.action === "slash") r.weapon.rotation.x = T.MathUtils.lerp(Math.PI, Math.PI * 0.65, returnToGuard);
      }

      if (a.action === "dodge") {
        const drive = Math.sin(Math.PI * p);
        // A planted, low sidestep: the sword stays below the shoulder.
        r.body.rotation.x = 0.34 * drive;
        r.body.rotation.y = -0.22 * drive;
        r.body.position.y = -0.24 * drive;
        r.arm.rotation.x = -0.15 + 0.34 * drive;
        r.arm.rotation.y = -0.62 * drive;
        r.weapon.rotation.x = Math.PI * 0.65 + 0.22 * drive;
        r.offArm.rotation.x = -0.28 - 0.38 * drive;
        r.offArm.rotation.z = -0.28 * drive;
        r.legs[0].rotation.x = -0.7 * drive;
        r.legs[1].rotation.x = 0.55 * drive;
        r.cloak.rotation.x = -0.32 * drive;
        r.head.rotation.x = -0.18 * drive;
      }
      if (a.kind !== "blade" && ["tell", "strike", "recover"].includes(a.action)) {
        const wind = a.action === "tell" ? T.MathUtils.smoothstep(p, 0, 0.85) : 1;
        const contact = a.action === "tell" ? 0 : a.action === "strike" ? T.MathUtils.smoothstep(a.time, 0, ENEMY_IMPACT[a.kind]) : 1;
        const rest = a.action === "recover" ? 1 - T.MathUtils.smoothstep(p, 0, 1) : 1;
        const sweep = a.kind === "boss" && a.combo === 1;
        const pulse = a.kind === "cantor" || (a.kind === "boss" && (a.combo === 2 || a.combo === 3));
        if (sweep) {
          r.body.rotation.y = (-0.7 * wind + 1.4 * contact) * rest;
          r.arm.rotation.set(-1.3 * wind * rest, (-1.4 * wind + 2.8 * contact) * rest, 0.08);
          r.offArm.rotation.x = -0.55 * wind * rest;
        } else if (a.kind === "boss" && a.combo === 4) {
          r.arm.rotation.x = -0.15 + (-2.6 * wind + 1.7 * contact) * rest;
          r.offArm.rotation.x = -0.28 + (-2.2 * wind + 1.3 * contact) * rest;
          r.arm.rotation.z = (0.35 * wind - 0.65 * contact) * rest;
          r.offArm.rotation.z = (-0.35 * wind + 0.65 * contact) * rest;
          r.body.rotation.x = (-0.2 * wind + 0.55 * contact) * rest;
        } else if (pulse) {
          const inner = a.kind === "boss" && a.combo === 3;
          r.arm.rotation.x = -0.15 + (-2.6 * wind + (inner ? 1.6 : 0.55) * contact) * rest;
          r.offArm.rotation.x = -0.28 - (inner ? 1.5 : 1.1) * wind * rest;
          r.body.rotation.x = (-0.2 * wind + (inner ? 0.65 : 0.08) * contact) * rest;
          r.head.rotation.x = -0.2 * wind * rest;
          r.body.position.y -= (inner ? 0.2 : 0.05) * contact * rest;
        } else if (a.kind === "hook") {
          r.arm.rotation.set(-0.15 - (0.7 * wind + 0.8 * contact) * rest, (-0.85 * wind + 1.55 * contact) * rest, 0.08);
          r.body.rotation.y = (-0.4 * wind + 0.8 * contact) * rest;
          r.body.rotation.x = 0.25 * contact * rest;
        } else {
          r.body.rotation.x = (-0.18 * wind + 0.65 * contact) * rest;
          r.arm.rotation.x = -0.15 + (-2.6 * wind + 1.7 * contact) * rest;
          r.offArm.rotation.x = -0.28 - 0.65 * wind * rest;
          r.body.position.y -= 0.13 * contact * rest;
        }
        r.legs[0].rotation.x = -0.18 * wind * rest;
        r.legs[1].rotation.x = 0.18 * wind * rest;
      }
      if (a.action === "awaken") {
        const brace = Math.sin(p * Math.PI);
        r.body.position.y = -0.3 * brace;
        r.body.rotation.x = 0.25 * brace;
        r.arm.rotation.x = -0.15 - 2.3 * brace;
        r.offArm.rotation.x = -0.28 - 1.6 * brace;
        r.head.rotation.x = -0.35 * brace;
      }
      // Blend every animated upper-body axis across interrupts and recoveries.
      const joints = [r.body.rotation, r.arm.rotation, r.offArm.rotation, r.head.rotation];
      const pose = joints.flatMap(joint => [joint.x, joint.y, joint.z]);
      if (r.action !== a.action) {
        r.action = a.action;
        r.transitionPose = [...r.previousPose];
      }
      const blendTime = a.action === "strike" ? Math.min(0.06, ENEMY_IMPACT[a.kind]) : 0.1;
      const blend = T.MathUtils.smoothstep(a.time, 0, blendTime);
      if (a.kind !== "blade" || a.action === "idle") {
        joints.forEach((joint, i) => joint.set(...([0, 1, 2].map(axis => T.MathUtils.lerp(r.transitionPose[i * 3 + axis] ?? pose[i * 3 + axis], pose[i * 3 + axis], blend)) as [number, number, number])));
      }
      r.previousPose = joints.flatMap(joint => [joint.x, joint.y, joint.z]);
      // A small visual recoil confirms contact without interrupting input or time.
      if (a.kind !== "blade" && a.hp > 0) {
        const recoil = T.MathUtils.smoothstep(a.flash, 0, 0.16);
        r.body.rotation.x -= recoil * 0.42;
        r.head.rotation.x += recoil * 0.27;
        r.arm.rotation.x += recoil * 0.28;
        r.offArm.rotation.x += recoil * 0.2;
      } else {
        r.body.rotation.x -= a.flash * 0.8;
        r.head.rotation.x += a.flash * 0.5;
      }
      if (a.hp <= 0) {
        if (a.kind === "boss") {
          const kneel = T.MathUtils.smoothstep(p, 0, 0.35);
          const fall = T.MathUtils.smoothstep(p, 0.35, 0.72);
          const sink = T.MathUtils.smoothstep(p, 0.72, 1);
          r.body.position.y = -0.55 * kneel;
          r.body.rotation.x = 0.35 * kneel + 0.85 * fall;
          r.body.rotation.z = 0.3 * fall;
          r.head.rotation.x = 0.55 * kneel;
          r.arm.rotation.x = -0.9 * kneel + 0.25 * fall;
          r.offArm.rotation.x = -0.8 * fall;
          r.legs[0].rotation.x = -0.8 * kneel;
          r.legs[1].rotation.x = 0.55 * kneel;
          r.root.position.y = -3.6 * sink;
        } else if (a.kind !== "blade") {
          const melt = T.MathUtils.smoothstep(p, 0.12, 1);
          r.body.rotation.x = 0.25 * Math.sin(p * Math.PI);
          r.head.rotation.x = 0.5 * melt;
          r.arm.rotation.x = -0.15 - 0.4 * melt;
          r.root.scale.set(1 + 0.18 * melt, 1 - 0.75 * melt, 1 + 0.18 * melt);
          r.root.position.y = -0.8 * melt;
        } else {
          r.body.rotation.x = 1.2 * T.MathUtils.smoothstep(p, 0, 1);
          r.body.position.y = -0.45 * p;
        }
        r.root.visible = a.kind === "blade" || p < 1;
      } else r.root.visible = true;
      if (introTime !== undefined && a.kind === "blade") {
        const fall = T.MathUtils.clamp(introTime / 0.65, 0, 1);
        const rise = T.MathUtils.smoothstep(introTime, 1.1, 2.4);
        const kneel = fall === 1 ? 1 - rise : 0.35;
        r.root.position.y = 7 * (1 - fall * fall);
        r.body.position.y = -0.5 * kneel;
        r.body.rotation.x = 0.85 * kneel;
        r.head.rotation.x = 0.25 * kneel;
        r.arm.rotation.x = -0.8 * kneel;
        r.offArm.rotation.x = -0.65 * kneel;
        r.legs[0].rotation.x = -0.8 * kneel;
        r.legs[1].rotation.x = 0.6 * kneel;
        r.cloak.rotation.x = -0.8 * (1 - fall);
      }
      if (game.phase === "between" && a.kind === "blade") {
        const stride = Math.sin(game.transitionProgress * 26);
        r.legs[0].rotation.x = stride * 0.35;
        r.legs[1].rotation.x = -stride * 0.35;
        r.arm.rotation.x = -0.35;
      }
      r.materials.forEach((m) => {
        m.emissive.setHex(a.flash > 0 ? 0xb99775 : 0);
        m.emissiveIntensity = a.flash > 0 ? 0.8 : 0;
      });
      const radial =
        a.kind === "boss" && a.combo === 4 ? "cross" :
        a.kind === "boss" && a.combo === 1 ? "sweep" :
        a.kind === "boss" && a.combo === 3
          ? "core"
          : a.kind === "cantor" || (a.kind === "boss" && a.combo === 2)
            ? "ring"
            : "lane";
      r.tell.visible = a.action === "tell" && game.phase === "fight";
      r.tell.position.set(a.x, 0.026, a.z);
      r.tell.rotation.z = a.angle;
      if (r.tell.userData.radial !== radial) {
        r.tell.geometry.dispose();
        if (radial === "core")
          r.tell.geometry = new T.CircleGeometry(BELL.echo, 48);
        else if (radial === "ring")
          r.tell.geometry = new T.RingGeometry(BELL.inner, BELL.outer, 64);
        else if (radial === "cross") {
          const shape = new T.Shape();
          for (const offset of [-CROSS_ANGLE, CROSS_ANGLE]) {
            shape.moveTo(0, 0);
            for (let i = 0; i <= 12; i++) {
              const angle = offset - 0.24 + i / 12 * 0.48;
              shape.lineTo(Math.sin(angle) * 7, -Math.cos(angle) * 7);
            }
            shape.lineTo(0, 0);
          }
          r.tell.geometry = new T.ShapeGeometry(shape);
        }
        else if (radial === "sweep") {
          const shape = new T.Shape(); shape.moveTo(0, 0);
          for (let i = 0; i <= 32; i++) {
            const angle = -BOSS_SWEEP.arc + i / 32 * BOSS_SWEEP.arc * 2;
            shape.lineTo(Math.sin(angle) * BOSS_SWEEP.reach, -Math.cos(angle) * BOSS_SWEEP.reach);
          }
          shape.closePath(); r.tell.geometry = new T.ShapeGeometry(shape);
        }
        else if (a.kind === "hook") {
          // Include one simulation step of forward travel before contact is sampled.
          const origin = LUNGE.speed * LUNGE.impact,
            radius = LUNGE.reach + LUNGE.speed * MAX_STEP;
          const shape = new T.Shape();
          shape.moveTo(0, -origin);
          for (let i = 0; i <= 24; i++) {
            const angle = -LUNGE.arc + (2 * LUNGE.arc * i) / 24;
            shape.lineTo(
              Math.sin(angle) * radius,
              -origin - Math.cos(angle) * radius,
            );
          }
          shape.closePath();
          r.tell.geometry = new T.ShapeGeometry(shape);
        } else {
          const shape = new T.Shape();
          shape.moveTo(-0.6, 0);
          shape.lineTo(0.6, 0);
          shape.lineTo(1.65, -7);
          shape.lineTo(-1.65, -7);
          shape.closePath();
          r.tell.geometry = new T.ShapeGeometry(shape);
        }
        r.tell.userData.radial = radial;
      }
      (r.tell.material as T.MeshBasicMaterial).opacity = 0.22 + p * 0.24;
    }
    for (const child of [...this.fx.children]) {
      this.fx.remove(child);
      if (child instanceof T.Mesh) {
        child.geometry.dispose();
        (child.material as T.Material).dispose();
      }
    }
    if (introTime !== undefined && introTime >= 0.65 && introTime < 1.5) {
      const spread = (introTime - 0.65) / 0.85;
      for (let i = 0; i < 12; i++) {
        const angle = i * 2.4;
        const dust = mesh(new T.TetrahedronGeometry(0.08), new T.MeshBasicMaterial({ color: 0x82796a, transparent: true, opacity: (1 - spread) * 0.6, depthWrite: false }), this.fx,
          game.player.x + Math.sin(angle) * spread * 2, 0.08 + Math.sin(spread * Math.PI) * 0.25, game.player.z + Math.cos(angle) * spread * 2);
        dust.rotation.y = angle;
      }
    }
    for (const f of game.effects) {
      if (f.kind === "dashDust") {
        const p = f.time / f.life;
        for (let i = -2; i <= 2; i++) {
          const sideways = i * 0.18;
          const chip = mesh(
            new T.TetrahedronGeometry(0.06 + (i & 1) * 0.035),
            new T.MeshBasicMaterial({ color: i & 1 ? 0x655e53 : 0x393733, transparent: true, opacity: (1 - p) * 0.72, depthWrite: false }),
            this.fx,
            f.x - Math.sin(f.angle) * p * 0.45 + Math.cos(f.angle) * sideways,
            0.045 + Math.sin(p * Math.PI) * 0.14,
            f.z - Math.cos(f.angle) * p * 0.45 - Math.sin(f.angle) * sideways,
          );
          chip.rotation.y = i + p * 2;
        }
        continue;
      }
      if (f.kind === "impact" || f.kind === "impactHeavy") {
        const p = f.time / f.life;
        const weight = f.kind === "impactHeavy" ? 1.35 : 1;
        const opacity = (1 - p) ** 2;
        for (const sign of [-1, 1]) {
          const scar = mesh(
            new T.BoxGeometry(0.64 * weight, 0.065, 0.025),
            new T.MeshBasicMaterial({ color: sign === 1 ? 0xd5c8a6 : 0x6e2f2b, transparent: true, opacity, depthWrite: false }),
            this.fx, f.x, 1.1 + sign * 0.1, f.z,
          );
          scar.rotation.set(0, f.angle, sign * (0.66 + p * 0.2));
        }
        for (let i = 0; i < 5; i++) {
          const angle = f.angle + (i - 2) * 0.75;
          const chip = mesh(
            new T.TetrahedronGeometry((0.085 + (i % 2) * 0.035) * weight),
            new T.MeshBasicMaterial({ color: i % 2 ? 0xb7aa8e : 0x755d51, transparent: true, opacity, depthWrite: false }),
            this.fx,
            f.x + Math.sin(angle) * p * 0.9 * weight,
            1.1 + Math.cos(i * 2.1) * p * 0.45,
            f.z + Math.cos(angle) * p * 0.9 * weight,
          );
          chip.rotation.set(p * 5, angle, p * 3);
        }
        continue;
      }
      if (f.kind === "death") {
        const p = f.time / f.life;
        const pool = mesh(new T.CircleGeometry(0.7, 9), new T.MeshBasicMaterial({ color: 0x121011, transparent: true, opacity: Math.sin(p * Math.PI) * 0.7, depthWrite: false }), this.fx, f.x, 0.025, f.z);
        pool.rotation.x = -Math.PI / 2;
        pool.scale.setScalar(0.8 + p * 0.5);
        continue;
      }
      const p = f.time / f.life,
        color = f.enemy ? 0xce7545 : f.kind === "hit" ? 0xe9d1a3 : 0xc3b69b;
      const m = new T.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: (1 - p) * 0.8,
        side: T.DoubleSide,
        depthWrite: false,
      });
      const stroke = f.kind === "sweep" ? BOSS_SWEEP : f.enemy
        ? LUNGE
        : STRIKES[f.kind === "cut" ? "slash" : "heavy"];
      let geometry: T.BufferGeometry =
        f.kind === "core"
          ? new T.RingGeometry(0.05, BELL.echo, 48)
          : f.kind === "ring"
            ? new T.RingGeometry(BELL.inner, BELL.outer, 48)
            : f.kind === "heavy"
              ? new T.RingGeometry(1.42, 1.56, 24, 1, 0, Math.PI)
              : (f.kind === "cut" || f.kind === "sweep")
                ? new T.RingGeometry(
                    stroke.reach - 0.3,
                    stroke.reach,
                    24,
                    1,
                    -stroke.arc,
                    stroke.arc * 2,
                  )
                : new T.RingGeometry(0.05 + p * 0.4, 0.14 + p * 0.7, 5);
      if (f.kind === "cut" && !f.enemy) {
        const wake = new T.Shape();
        for (let i = 0; i <= 24; i++) {
          const angle = -stroke.arc + i / 24 * stroke.arc * 2;
          const radius = stroke.reach;
          const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
          if (i === 0) wake.moveTo(x, y); else wake.lineTo(x, y);
        }
        for (let i = 24; i >= 0; i--) {
          const angle = -stroke.arc + i / 24 * stroke.arc * 2;
          const radius = stroke.reach - Math.sin(i / 24 * Math.PI) * 0.36;
          wake.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
        }
        wake.closePath(); geometry.dispose(); geometry = new T.ShapeGeometry(wake);
      }
      if (f.kind === "heavy") {
        const wake = new T.Shape();
        wake.moveTo(-1.5, 0);
        for (let i = 0; i <= 24; i++) {
          const angle = Math.PI - i / 24 * Math.PI;
          wake.lineTo(Math.cos(angle) * 1.6, Math.sin(angle) * 1.8);
        }
        for (let i = 24; i >= 0; i--) {
          const angle = Math.PI - i / 24 * Math.PI;
          const radius = 1.6 - Math.sin(angle) * (i % 4 === 0 ? 0.34 : 0.2);
          wake.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
        }
        wake.closePath(); geometry.dispose(); geometry = new T.ShapeGeometry(wake);
        for (let i = 0; i < 5; i++) {
          const offset = (i - 2) * 0.19;
          const shard = mesh(new T.TetrahedronGeometry(0.055), new T.MeshBasicMaterial({ color: 0xb1a48a, transparent: true, opacity: 1 - p, depthWrite: false }), this.fx,
            f.x + Math.sin(f.angle) * (1.5 + p) + Math.cos(f.angle) * offset,
            0.08 + Math.sin(p * Math.PI) * (0.25 + i * 0.08),
            f.z + Math.cos(f.angle) * (1.5 + p) - Math.sin(f.angle) * offset);
          shard.scale.set(0.6, 2.5, 0.6);
          shard.rotation.z = offset * 3;
        }
      }
      if (f.kind === "slam") {
        const crack = new T.Shape();
        crack.moveTo(0, -0.12);
        crack.lineTo(2, -0.3);
        crack.lineTo(3, 0.02);
        crack.lineTo(5, -0.27);
        crack.lineTo(7, 0);
        crack.lineTo(5, 0.16);
        crack.lineTo(3, 0.26);
        crack.lineTo(2, 0.06);
        crack.lineTo(0, 0.12);
        crack.closePath();
        geometry.dispose();
        geometry = new T.ShapeGeometry(crack);
      }
      const fx = mesh(
        geometry,
        m,
        this.fx,
        f.x,
        f.kind === "hit" || f.kind === "cut" || f.kind === "sweep" ? 0.9 : 0.08,
        f.z,
      );
      fx.castShadow = fx.receiveShadow = false;
      fx.rotation.x = -Math.PI / 2;
      fx.rotation.z = f.angle - Math.PI / 2;
      if (f.kind === "heavy") {
        // A vertical blade wake distinguishes the overhead blow from a flat slash.
        fx.position.set(
          f.x + Math.sin(f.angle) * 1.55,
          0.15,
          f.z + Math.cos(f.angle) * 1.55,
        );
        fx.rotation.set(0, f.angle - Math.PI / 2, 0);
      }

    }
    this.dashWake.visible = game.player.action === "dodge" && game.player.hp > 0;
    this.dashWake.position.set(game.player.x, 0, game.player.z);
    this.dashWake.rotation.y = game.player.angle;
    this.dashWake.scale.z = Math.sin(Math.PI * Math.min(1, game.player.time / game.player.duration));
      // At point-blank range, soften the boss so the player's action stays visible.
    // This changes presentation only; attack positions and damage stay authoritative.
    for (const enemy of game.enemies) {
      if (enemy.kind !== "boss") continue;
      const rig = this.actors.get(enemy.id)!;
      const fade =
        game.phase === "fight" &&
        enemy.hp > 0
          ? 1 - T.MathUtils.smoothstep(Math.hypot(enemy.x - game.player.x, enemy.z - game.player.z), 1.1, 2.1)
          : 0;
      const obscures = fade > 0;
      for (const material of rig.materials) {
        const transparent = obscures && !material.userData.solidWeapon;
        if (material.transparent !== transparent) {
          material.transparent = transparent;
          material.needsUpdate = true;
        }
        material.depthWrite = !transparent;
        material.opacity = transparent ? 1 - fade * 0.7 : 1;
      }
    }
    // A quiet ground marker keeps the player locatable behind large enemies.
    this.playerRing.position.set(game.player.x, 0.04, game.player.z);
    this.playerRing.visible = game.phase === "fight" && game.player.hp > 0;
    this.camera.zoom = introTime === undefined ? 1 : 1 + 0.16 * (1 - T.MathUtils.smoothstep(introTime, 0.7, 2.6));
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  }
}
