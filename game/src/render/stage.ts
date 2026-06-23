import * as THREE from "three";
import {
  BloomEffect,
  BrightnessContrastEffect,
  ChromaticAberrationEffect,
  EffectComposer,
  EffectPass,
  HueSaturationEffect,
  NoiseEffect,
  RenderPass,
  SMAAEffect,
  VignetteEffect,
  type Effect,
} from "postprocessing";
import { clamp01, damp } from "../core/math";

export type Quality = "low" | "medium" | "high";

/**
 * Owns renderer, scene, post-processing chain and screen-level feedback
 * (hurt vignette pulse, aberration kick). The post chain is rebuilt per
 * quality preset:
 *  - high:   full res (≤2× dpr), 2048 PCF shadows, bloom + CA + grade + noise + SMAA
 *  - medium: ≤1.5× dpr, 1024 shadows, bloom + grade + SMAA
 *  - low:    1× dpr, no shadows, vignette + grade only
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly keyLight: THREE.DirectionalLight;
  readonly hemiLight: THREE.HemisphereLight;
  readonly fog: THREE.FogExp2;
  quality: Quality = "high";

  /** Full chain used in combat/cutscenes (bloom, CA, grade, grain, SMAA per preset). */
  private composer!: EffectComposer;
  /** Lean chain used behind menus/overlays: render + vignette + grade only. Built
   *  fresh (not the full chain with passes disabled) — a disabled trailing pass in
   *  `postprocessing` leaves the output unrouted and the screen crushes to black. */
  private menuComposer!: EffectComposer;
  private vignette!: VignetteEffect;
  private aberration: ChromaticAberrationEffect | null = null;
  private bloom: BloomEffect | null = null;
  /** True while a menu/overlay is up: render the lean chain and drop shadows. */
  private lowCost = false;

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

    this.buildPost();
    window.addEventListener("resize", () => this.onResize());
  }

  /** (Re)build both post chains for the current quality preset. */
  private buildPost(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;

    // --- Full combat chain ---
    this.composer?.dispose();
    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType });
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    const effects: Effect[] = [];
    this.bloom = null;
    this.aberration = null;

    if (this.quality !== "low") {
      this.bloom = new BloomEffect({
        intensity: 1.05,
        luminanceThreshold: 0.32,
        luminanceSmoothing: 0.25,
        mipmapBlur: true,
        radius: 0.7,
      });
      effects.push(this.bloom);
    }
    if (this.quality === "high") {
      this.aberration = new ChromaticAberrationEffect({
        offset: new THREE.Vector2(this.baseAberration, this.baseAberration),
        radialModulation: true,
        modulationOffset: 0.35,
      });
      effects.push(this.aberration);
    }
    this.vignette = new VignetteEffect({ darkness: this.baseVignette, offset: 0.32 });
    effects.push(this.vignette);
    // Subtle grade: a touch more saturation + contrast sells "finished"
    effects.push(new HueSaturationEffect({ saturation: 0.12 }));
    effects.push(new BrightnessContrastEffect({ contrast: 0.07 }));
    if (this.quality === "high") {
      const noise = new NoiseEffect({ premultiply: true });
      noise.blendMode.opacity.value = 0.45;
      effects.push(noise);
    }
    this.composer.addPass(new EffectPass(this.camera, ...effects));
    if (this.quality !== "low") {
      this.composer.addPass(new EffectPass(this.camera, new SMAAEffect()));
    }
    this.composer.setSize(w, h);

    // --- Lean menu chain ---
    // Just render + vignette + grade. No bloom (its mipmap blur crushes the menu's
    // subtle starfield/aurora to near-black — dropping it makes the rift backdrop
    // read *richer*), no grain, no SMAA. Combined with shadows-off in menu mode this
    // is both the look we want behind the menus and a big perf win. Built as its own
    // chain so the final pass actually routes to screen (see menuComposer doc).
    this.menuComposer?.dispose();
    this.menuComposer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType });
    this.menuComposer.addPass(new RenderPass(this.scene, this.camera));
    this.menuComposer.addPass(new EffectPass(
      this.camera,
      new VignetteEffect({ darkness: this.baseVignette, offset: 0.32 }),
      new HueSaturationEffect({ saturation: 0.12 }),
      new BrightnessContrastEffect({ contrast: 0.07 }),
    ));
    this.menuComposer.setSize(w, h);
  }

  applyQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    const dpr = window.devicePixelRatio;
    this.renderer.setPixelRatio(q === "high" ? Math.min(dpr, 2) : q === "medium" ? Math.min(dpr, 1.5) : 1);
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    // Shadows: high 2048, medium 1024, low off — but never while a menu is up
    // (the low-cost path keeps them off there; see setLowCost).
    this.keyLight.castShadow = !this.lowCost && q !== "low";
    const size = q === "high" ? 2048 : 1024;
    if (this.keyLight.shadow.mapSize.x !== size) {
      this.keyLight.shadow.mapSize.set(size, size);
      this.keyLight.shadow.map?.dispose();
      this.keyLight.shadow.map = null;
    }
    this.buildPost();
  }

  /**
   * Switch to the lean menu chain while a menu/overlay is up, and back to the full
   * chain for combat/cutscenes. Menu mode also drops the key light's shadow — pure
   * perf there (no shadow-map render), and gameplay restores it. The lean chain is
   * what makes the rift backdrop read rich behind the menus while staying cheap.
   */
  setLowCost(on: boolean): void {
    if (on === this.lowCost) return;
    this.lowCost = on;
    this.keyLight.castShadow = on ? false : this.quality !== "low";
  }

  /** Brightness/gamma: `mult` scales the base ACES exposure (1.0 = default). */
  setExposure(mult: number): void {
    this.renderer.toneMappingExposure = 1.32 * mult;
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.menuComposer.setSize(w, h);
  }

  /** Punch the screen — hurt, crash, big impacts. amount 0..1. */
  punch(amount: number): void {
    this.stress = clamp01(this.stress + amount);
  }

  update(dt: number): void {
    this.stress = damp(this.stress, 0, 6, dt);
    const s = this.stress;
    this.vignette.darkness = this.baseVignette + s * 0.45;
    if (this.aberration) {
      const ab = this.baseAberration + s * 0.011;
      this.aberration.offset.set(ab, ab);
    }
  }

  render(dt: number): void {
    (this.lowCost ? this.menuComposer : this.composer).render(dt);
  }

  /**
   * Pre-compile shaders for everything already in the scene (pooled telegraphs,
   * projectiles, slash arcs, particles, the hero — plus any dummies a caller has
   * staged) so the first time any of them appears there's no synchronous shader
   * compile stall. Three's compile() warms in-scene materials regardless of their
   * `visible` flag.
   *
   * Critically this warms BOTH shadow states and BOTH post chains. In Three a
   * directional light's `castShadow` flag is baked into every lit material's
   * program cache key, so toggling it (menu ↔ combat, via setLowCost) forces a
   * synchronous relink of every MeshStandardMaterial in the scene on the very next
   * render. Warming the shadows-ON (combat) and shadows-OFF (menu/death) variants
   * up front means those transitions — including the death → "dead" screen flip in
   * a material-dense boss room — never compile on a live frame. That flip was the
   * "~3-second freeze when a boss killed me" hitch. On the low preset combat has no
   * shadows, so both passes stay shadows-off (and the second compile is a cache hit).
   */
  warmUp(): void {
    const prevCast = this.keyLight.castShadow;
    try {
      // Combat path: shadows in the state gameplay actually uses + the full chain.
      this.keyLight.castShadow = this.quality !== "low";
      this.renderer.compile(this.scene, this.camera);
      this.composer.render(0.016);
      // Menu / death path: shadows off + the lean chain.
      this.keyLight.castShadow = false;
      this.renderer.compile(this.scene, this.camera);
      this.menuComposer.render(0.016);
    } catch { /* headless / lost ctx */ } finally {
      this.keyLight.castShadow = prevCast;
    }
  }

  /**
   * Warm only the menu render path: in-scene materials (shadows off) plus the lean
   * menuComposer's fused EffectPass, which is a *distinct* GL program from the full
   * chain and so isn't covered by rendering `composer`. Cheap enough to run at boot
   * under the loading screen so the first menu frame doesn't pay a synchronous GLSL
   * compile — the "menus lag a little right after startup" hitch.
   */
  warmMenu(): void {
    const prevCast = this.keyLight.castShadow;
    try {
      this.keyLight.castShadow = false; // the menu always draws with shadows off
      this.renderer.compile(this.scene, this.camera);
      this.menuComposer.render(0.016);
    } catch { /* headless / lost ctx */ } finally {
      this.keyLight.castShadow = prevCast;
    }
  }
}
