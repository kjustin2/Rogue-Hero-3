import * as THREE from "three";
import {
  BloomEffect,
  ChromaticAberrationEffect,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  RenderPass,
  SMAAEffect,
  VignetteEffect,
} from "postprocessing";
import { clamp01, damp } from "../core/math";

/**
 * Owns renderer, scene, post-processing chain and screen-level feedback
 * (hurt vignette pulse, aberration kick). Everything visual hangs off `scene`.
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly keyLight: THREE.DirectionalLight;
  readonly hemiLight: THREE.HemisphereLight;
  readonly fog: THREE.FogExp2;

  private composer: EffectComposer;
  private vignette: VignetteEffect;
  private aberration: ChromaticAberrationEffect;
  private bloom: BloomEffect;

  /** 0..1 transient screen stress — pushed up by hits/crashes, decays fast. */
  private stress = 0;
  private baseVignette = 0.42;
  private baseAberration = 0.0012;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      powerPreference: "high-performance",
      antialias: false,
      stencil: false,
      depth: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.32;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07070f);
    this.fog = new THREE.FogExp2(0x0a0a16, 0.016);
    this.scene.fog = this.fog;

    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 220);
    this.camera.position.set(0, 16, 11);
    this.camera.lookAt(0, 0, 0);

    this.hemiLight = new THREE.HemisphereLight(0x8899ff, 0x140a18, 0.95);
    this.scene.add(this.hemiLight);

    this.keyLight = new THREE.DirectionalLight(0xfff2e0, 1.6);
    this.keyLight.position.set(14, 26, 8);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.camera.left = -30;
    this.keyLight.shadow.camera.right = 30;
    this.keyLight.shadow.camera.top = 30;
    this.keyLight.shadow.camera.bottom = -30;
    this.keyLight.shadow.camera.far = 80;
    this.keyLight.shadow.bias = -0.0008;
    this.scene.add(this.keyLight);
    this.scene.add(this.keyLight.target);

    this.composer = new EffectComposer(this.renderer, {
      frameBufferType: THREE.HalfFloatType,
    });
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloom = new BloomEffect({
      intensity: 1.05,
      luminanceThreshold: 0.32,
      luminanceSmoothing: 0.25,
      mipmapBlur: true,
      radius: 0.7,
    });
    this.aberration = new ChromaticAberrationEffect({
      offset: new THREE.Vector2(this.baseAberration, this.baseAberration),
      radialModulation: true,
      modulationOffset: 0.35,
    });
    this.vignette = new VignetteEffect({ darkness: this.baseVignette, offset: 0.32 });
    const noise = new NoiseEffect({ premultiply: true });
    noise.blendMode.opacity.value = 0.45;

    this.composer.addPass(new EffectPass(this.camera, this.bloom, this.aberration, this.vignette, noise));
    this.composer.addPass(new EffectPass(this.camera, new SMAAEffect()));

    window.addEventListener("resize", () => this.onResize());
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  /** Punch the screen — hurt, crash, big impacts. amount 0..1. */
  punch(amount: number): void {
    this.stress = clamp01(this.stress + amount);
  }

  setBloomIntensity(v: number): void {
    this.bloom.intensity = v;
  }

  update(dt: number): void {
    this.stress = damp(this.stress, 0, 6, dt);
    const s = this.stress;
    this.vignette.darkness = this.baseVignette + s * 0.45;
    const ab = this.baseAberration + s * 0.011;
    this.aberration.offset.set(ab, ab);
  }

  render(dt: number): void {
    this.composer.render(dt);
  }
}
