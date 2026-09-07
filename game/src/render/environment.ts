import * as THREE from "three";

/**
 * Procedural image-based lighting (IDEAS-GRAPHICS #1). Bakes a tiny theme-tinted
 * emissive "room" through a PMREMGenerator into an environment map assigned to
 * `scene.environment`, so every MeshStandard/Physical material with metalness>0
 * finally has believable colored specular + ambient to reflect instead of reading
 * as matte plastic.
 *
 * The stage bakes this once at boot. Stable reflections avoid a lighting jump
 * while moving between a menu, a chamber and its cinematic camera.
 * The env scene is six large inward-facing emissive planes — a sky-tinted ceiling,
 * a dark ground, a warm key wall, a cool rim wall, and two ember side walls — which
 * PMREM turns into soft directional ambient with a couple of bright specular lobes.
 */
export class EnvironmentBaker {
  private pmrem: THREE.PMREMGenerator;
  private scene = new THREE.Scene();
  private mats: THREE.MeshBasicMaterial[] = [];
  private rt: THREE.WebGLRenderTarget | null = null;
  private cTop = new THREE.Color();
  private cBottom = new THREE.Color();
  private cKey = new THREE.Color();
  private cRim = new THREE.Color();
  private cEmber = new THREE.Color();

  constructor(renderer: THREE.WebGLRenderer) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileCubemapShader();
    const geo = new THREE.PlaneGeometry(1, 1);
    // 6 inward-facing panels of a 20-unit box; index maps to a semantic role below.
    const faces: [THREE.Euler, THREE.Vector3][] = [
      [new THREE.Euler(Math.PI / 2, 0, 0), new THREE.Vector3(0, 10, 0)],    // ceiling faces inward
      [new THREE.Euler(-Math.PI / 2, 0, 0), new THREE.Vector3(0, -10, 0)], // floor faces inward
      [new THREE.Euler(0, Math.PI, 0), new THREE.Vector3(0, 0, 10)],        // 2 key wall (warm)
      [new THREE.Euler(0, 0, 0), new THREE.Vector3(0, 0, -10)],             // 3 rim wall (cool)
      [new THREE.Euler(0, -Math.PI / 2, 0), new THREE.Vector3(10, 0, 0)],   // 4 ember side
      [new THREE.Euler(0, Math.PI / 2, 0), new THREE.Vector3(-10, 0, 0)],   // 5 ember side
    ];
    for (const [rot, pos] of faces) {
      const m = new THREE.MeshBasicMaterial({ side: THREE.FrontSide, fog: false });
      const mesh = new THREE.Mesh(geo, m);
      mesh.rotation.copy(rot);
      mesh.position.copy(pos);
      mesh.scale.setScalar(20);
      this.scene.add(mesh);
      this.mats.push(m);
    }
  }

  /** (Re)bake from a theme palette and return the env texture (owned by this baker). */
  bake(topHex: number, bottomHex: number, keyHex: number, rimHex: number, emberHex: number): THREE.Texture {
    this.cTop.set(topHex);
    this.cBottom.set(bottomHex);
    this.cKey.set(keyHex);
    this.cRim.set(rimHex);
    this.cEmber.set(emberHex);
    // Ceiling carries most of the ambient sky; walls are dimmer accents so the bake
    // reads as "lit from above + kicked from the sides", never a flat grey box.
    this.mats[0].color.copy(this.cTop).multiplyScalar(1.4);
    this.mats[1].color.copy(this.cBottom).multiplyScalar(0.35);
    this.mats[2].color.copy(this.cKey).multiplyScalar(0.55);
    this.mats[3].color.copy(this.cRim).multiplyScalar(0.5);
    this.mats[4].color.copy(this.cEmber).multiplyScalar(0.3);
    this.mats[5].color.copy(this.cEmber).multiplyScalar(0.22);
    const prev = this.rt;
    // Broad, soft highlights distinguish metal from stone as the camera moves.
    this.rt = this.pmrem.fromScene(this.scene, 0.35);
    prev?.dispose();
    return this.rt.texture;
  }

  dispose(): void {
    this.rt?.dispose();
    this.rt = null;
    this.pmrem.dispose();
    for (const m of this.mats) m.dispose();
  }
}
