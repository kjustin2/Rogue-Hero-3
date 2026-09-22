import * as T from "three";

// Same geometry kit and projection as combat; only cloned transforms animate.
export class TitleScene {
  readonly scene = new T.Scene();
  readonly camera = new T.OrthographicCamera(-16, 16, 12, -12, 0.1, 100);
  private flames: T.Mesh[] = [];
  private lights: T.PointLight[] = [];
  private dust: T.Points;
  constructor(environment: T.Group) {
    const room = environment.clone(true);
    room.position.x = 4;
    this.scene.add(room);
    room.traverse(object => {
      if (object instanceof T.PointLight) this.lights.push(object);
      if (object instanceof T.Mesh && object.geometry.type === "OctahedronGeometry") this.flames.push(object);
    });
    this.scene.background = new T.Color(0x111416);
    this.scene.fog = new T.Fog(0x111416, 32, 58);
    this.scene.add(new T.HemisphereLight(0xa9afb5, 0x292728, 1.55));
    const moon = new T.DirectionalLight(0xd4d0c3, 2.6);
    moon.position.set(-8, 18, 6);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    Object.assign(moon.shadow.camera, {left: -22, right: 22, top: 20, bottom: -20});
    moon.shadow.bias = -0.0004;
    this.scene.add(moon);
    const fill = new T.DirectionalLight(0x7b8899, 0.6);
    fill.position.set(10, 8, -5);
    this.scene.add(fill);
    const stone = new T.MeshStandardMaterial({color: 0x48453e, roughness: 1, flatShading: true});
    const dark = new T.MeshStandardMaterial({color: 0x242525, roughness: 1, flatShading: true});
    const block = (x: number, y: number, z: number, w: number, h: number, d: number, material = stone) => {
      const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), material);
      mesh.position.set(x, y, z);
      mesh.castShadow = mesh.receiveShadow = true;
      this.scene.add(mesh);
      return mesh;
    };
    // Low burial stones and a displaced lid, with open negative space around them.
    block(5, 0.18, -1, 4.6, 0.4, 6);
    block(5, 0.55, -1, 2.7, 0.55, 4.2, dark);
    block(5, 0.96, -0.8, 2.85, 0.25, 4.45).rotation.y = -0.09;
    block(4.7, 1.12, -0.8, 0.13, 0.04, 2.8, dark).rotation.y = -0.09;
    for (const [x, z, angle] of [[8, 3, -0.1], [0, -5, 0.18], [8, -5, 0.07]]) {
      block(x, 0.13, z, 1.5, 0.28, 2.8).rotation.y = angle;
      block(x, 0.31, z, 0.07, 0.05, 1.5, dark).rotation.y = angle;
    }
    const broken = new T.Mesh(new T.CylinderGeometry(0.55, 0.65, 2.8, 7), dark);
    broken.position.set(1.5, 0.6, 4.8);
    broken.rotation.set(0, -0.35, Math.PI / 2);
    broken.castShadow = broken.receiveShadow = true;
    this.scene.add(broken);
    const positions = new Float32Array(50 * 3);
    for (let i = 0; i < 50; i++) {
      positions[i * 3] = 4 + Math.sin(i * 7.13) * 10;
      positions[i * 3 + 1] = (i % 11) * 0.3;
      positions[i * 3 + 2] = Math.cos(i * 3.77) * 8;
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.BufferAttribute(positions, 3));
    this.dust = new T.Points(geometry, new T.PointsMaterial({
      color: 0xaaa699, size: 0.025, transparent: true, opacity: 0.22, depthWrite: false,
    }));
    this.scene.add(this.dust);
  }
  render(renderer: T.WebGLRenderer, time: number) {
    const aspect = innerWidth / innerHeight;
    const size = Math.max(11.8, 15 / aspect);
    Object.assign(this.camera, {left: -size * aspect, right: size * aspect, top: size, bottom: -size});
    this.camera.updateProjectionMatrix();
    this.camera.position.set(16, 24, 20);
    this.camera.lookAt(0, 0, 0);
    this.flames.forEach((flame, i) => {
      flame.scale.y = 1.8 + Math.sin(time * 7 + i * 2) * 0.09;
      this.lights[i].intensity = 7 + Math.sin(time * 6 + i * 2) * 0.6;
    });
    this.dust.position.y = Math.sin(time * 0.15) * 0.25;
    this.dust.rotation.y = Math.sin(time * 0.05) * 0.025;
    renderer.render(this.scene, this.camera);
  }
}
