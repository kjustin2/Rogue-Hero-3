import * as THREE from "three";
import {
  BrightnessContrastEffect,
  EffectComposer,
  EffectPass,
  FXAAEffect,
  HueSaturationEffect,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
  type Effect,
} from "postprocessing";
import { clamp01, damp } from "../core/math";
import { EnvironmentBaker } from "./environment";
import { GradeEffect } from "./gradeEffect";

export type Quality = "low" | "medium" | "high";

/**
 * Owns renderer, scene, post-processing chain and screen-level feedback
 * (hurt vignette pulse). The post chain is rebuilt per
 * quality preset:
 *  - high:   full res (≤2× dpr), 2048 PCF shadows, grade + FXAA
 *  - medium: ≤1.5× dpr, 1024 shadows, grade + FXAA
 *  - low:    1× dpr, no shadows, vignette + grade only
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly keyLight: THREE.DirectionalLight;
  /** Dim, non-shadow kicker opposite the key (IDEAS-GRAPHICS #6) — defines the far
   *  edge of every silhouette; color driven per-act by arena.ts. */
  readonly rimLight: THREE.DirectionalLight;
  readonly hemiLight: THREE.HemisphereLight;
  readonly fog: THREE.FogExp2;
  private envBaker!: EnvironmentBaker;
  private envTex: THREE.Texture | null = null;
  quality: Quality = "high";
  /**
   * Resolution scale (render-target multiplier on the quality-capped device pixel
   * ratio). 1 = native; <1 renders fewer pixels and upscales (perf); >1 supersamples
   * (sharper, heavier). This is the "Resolution Scale" Display setting and is the
   * meaningful render-resolution lever for a full-window canvas game.
   */
  private renderScale = 1;

  /** Full chain used in combat/cutscenes (stable grade; optional debug FXAA). */
  private composer!: EffectComposer;
  /** Lean chain used behind menus/overlays: render + vignette + grade only. Built
   *  fresh (not the full chain with passes disabled) — a disabled trailing pass in
   *  `postprocessing` leaves the output unrouted and the screen crushes to black. */
  private menuComposer!: EffectComposer;
  private vignette!: VignetteEffect;
  /** Combined split-tone / tempo-tint / mood / dither grade (full chain only). */
  private grade!: GradeEffect;
  private tintColor = new THREE.Color(1, 1, 1);
  private tintTarget = new THREE.Color(1, 1, 1);
  private tintAmt = 0;
  private tintAmtTarget = 0;
  private satTarget = 0;
  /** True while a menu/overlay is up: render the lean color chain. */
  private lowCost = false;

  /** 0..1 transient screen stress — pushed up by hits/crashes, decays fast. */
  private stress = 0;
  private baseVignette = 0.3;
  private toneMode = ToneMappingMode.ACES_FILMIC;

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
    // Tone-map bake-off (IDEAS-GRAPHICS #22): ACES by default; `?tonemap=agx` opts
    // into AgX (better hue retention at high exposure) for a screenshot comparison.
    // Read once here so every material compiles + warms with the chosen curve — never
    // hot-swapped mid-scene (tone mapping is in every program's cache key).
    const agx = new URLSearchParams(location.search).get("tonemap") === "agx";
    this.toneMode=agx?ToneMappingMode.AGX:ToneMappingMode.ACES_FILMIC;
    this.renderer.toneMapping = agx ? THREE.AgXToneMapping : THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = agx ? 1.15 : 1.16;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07070f);
    this.fog = new THREE.FogExp2(0x0a0a16, 0.016);
    this.scene.fog = this.fog;

    // Near plane raised from 0.5 → 2: with a top-down camera ~16-19 units from the action,
    // a 0.5 near wasted almost all depth-buffer precision, so coplanar opaque surfaces
    // Z-FOUGHT (surfaces "blink on/off when moving") on real GPUs — worse because the scene
    // renders through an EffectComposer render target. Nothing is ever within 2 units of the
    // camera, so this only tightens the near/far ratio (4× the precision) with zero clipping.
    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 2, 220);
    this.camera.position.set(0, 16, 11);
    this.camera.lookAt(0, 0, 0);

    this.hemiLight = new THREE.HemisphereLight(0x8899ff, 0x140a18, 0.95);
    this.scene.add(this.hemiLight);
    // A dim ambient FLOOR so no surface — especially away-facing faces on the dark
    // void debris/dressing — can ever bottom out to pure black as the camera moves
    // ("objects fill with black when moving"). Subtle enough not to flatten the key.
    this.scene.add(new THREE.AmbientLight(0x2b3446, 0.28));

    this.keyLight = new THREE.DirectionalLight(0xfff2e0, 1.6);
    this.keyLight.position.set(-7, 18, 11);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    // A LOOSE frustum (±30) with the original bias. The earlier "tighten to ±23 +
    // normalBias" optimization caused hard self-shadow gashes on the flat-shaded
    // low-poly set-dressing (crystals/rocks) and black-fill on rim objects that fell
    // outside the tight box as the camera moved — the owner's "objects fill with
    // black when moving" bug. Correctness over a few texels of density.
    this.keyLight.shadow.camera.left = -30;
    this.keyLight.shadow.camera.right = 30;
    this.keyLight.shadow.camera.top = 30;
    this.keyLight.shadow.camera.bottom = -30;
    this.keyLight.shadow.camera.far = 80;
    this.keyLight.shadow.bias = -0.0008;
    // Soften the PCF kernel so the pillar/crystal shadow edges aren't hard, stair-stepped
    // blobs that crawl as the camera moves (a baked artifact the film grain used to hide).
    // Softness only — NOT a frustum tighten (that caused the black-fill glitch; see CLAUDE.md).
    this.keyLight.shadow.radius = 4;
    this.scene.add(this.keyLight);
    this.scene.add(this.keyLight.target);

    // Rim/kicker light opposite the key — present from construction so the 2-dir-light
    // program variant is what every material compiles + warms (no later relink).
    this.rimLight = new THREE.DirectionalLight(0x8fc5e0, 1.05);
    this.rimLight.position.set(-13, 9, -11);
    this.scene.add(this.rimLight);
    this.scene.add(this.rimLight.target);

    // Image-based lighting: bake a theme-tinted env map BEFORE any scene material
    // exists so they all compile with the envMap variant (arena.ts rebakes per act —
    // a texture swap, never null↔texture, so it never triggers a whole-scene relink).
    this.envBaker = new EnvironmentBaker(this.renderer);
    this.envTex = this.envBaker.bake(0x58667c, 0x29232c, 0xffeed1, 0x88b7d6, 0xad7653);
    this.scene.environment = this.envTex;
    this.scene.environmentIntensity = .55;

    this.buildPost();
    window.addEventListener("resize", () => this.onResize());
  }

  /** (Re)build both post chains for the current quality preset. */
  private buildPost(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;

    // MSAA on the RenderPass target: true sub-pixel geometry AA. The high-contrast cyan
    // edges on near-black were only 1px-jagged and crawled as the camera followed
    // the player. Hardware MSAA remains available only for diagnosis; the shipped
    // path uses stable single-pass FXAA below. Scaled by preset.
    const msaa = 0;

    // --- Full combat chain ---
    this.composer?.dispose();
    // Lighting stays linear and HDR until the explicit display transform below.
    // WebGLRenderer does not apply its tone map when drawing into a render target;
    // an 8-bit target here clipped metal and emissive colors before the final pass.
    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType, multisampling: msaa });
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    const effects: Effect[] = [new ToneMappingEffect({mode:this.toneMode})];
    // No framebuffer bloom in the shipping chain. Repeated frozen-frame
    // bisections on the real NVIDIA/ANGLE path named BloomEffect as the owner of
    // broad pixel shimmer. Authored emissive materials and local impact sprites
    // carry the glow language without a temporally unstable screen-space blur.
    // NO ChromaticAberrationEffect: its red/cyan edge fringing crawled on every silhouette
    // as the camera moved and read as a "glitch" (worst toward the screen edges via radial
    // modulation). Removed entirely — the neon look holds without RGB-splitting the edges.
    this.vignette = new VignetteEffect({ darkness: this.baseVignette, offset: 0.32 });
    effects.push(this.vignette);
    // Subtle grade: a touch more saturation + contrast sells "finished"
    effects.push(new HueSaturationEffect({ saturation: -0.035 }));
    effects.push(new BrightnessContrastEffect({ contrast: 0.025 }));
    // Split-tone + tempo/mood tint + dither (IDEAS-GRAPHICS #5/#17/#18/#21). Rebuilt
    // per preset; uniforms re-seeded from the current damped tint state so a quality
    // change mid-run doesn't reset an active tempo/mood grade.
    this.grade = new GradeEffect();
    this.grade.setTint(this.tintColor, this.tintAmt);
    this.grade.saturation = this.satTarget;
    effects.push(this.grade);
    // NO film-grain NoiseEffect here: the pmndrs NoiseEffect shader is `rand(uv*(1.0+time))`
    // with `time` incremented every frame, so it re-randomized the ENTIRE framebuffer each
    // frame — a constant screen-wide shimmer in combat + cutscenes (the full chain), absent
    // from the lean menu chain. That WAS the "flickering" bug. If a film-texture look is ever
    // wanted, it must be a STATIC (uv-only, no time) grain — never the animated NoiseEffect.
    this.composer.addPass(new EffectPass(this.camera, ...effects));
    if (this.quality !== "low") {
      // SMAA's multi-pass lookup path showed a measurable frozen-frame shimmer
      // on the shipping NVIDIA/ANGLE path. FXAA is a single deterministic pass;
      // DPR scaling retains the fine procedural detail without temporal crawling.
      this.composer.addPass(new EffectPass(this.camera, new FXAAEffect()));
    }
    this.composer.setSize(w, h);

    // --- Lean menu chain ---
    // Just render + vignette + grade. No bloom (its mipmap blur crushes the menu's
    // subtle starfield/aurora to near-black — dropping it makes the rift backdrop
    // read *richer*), no grain. Combined with shadows-off in menu mode this
    // is both the look we want behind the menus and a big perf win. Built as its own
    // chain so the final pass actually routes to screen (see menuComposer doc).
    this.menuComposer?.dispose();
    this.menuComposer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType, multisampling: msaa });
    this.menuComposer.addPass(new RenderPass(this.scene, this.camera));
    this.menuComposer.addPass(new EffectPass(
      this.camera,
      new ToneMappingEffect({mode:this.toneMode}),
      new VignetteEffect({ darkness: this.baseVignette, offset: 0.32 }),
      new HueSaturationEffect({ saturation: -0.035 }),
      new BrightnessContrastEffect({ contrast: 0.025 }),
    ));
    if (this.quality !== "low") this.menuComposer.addPass(new EffectPass(this.camera, new FXAAEffect()));
    this.menuComposer.setSize(w, h);
  }

  /**
   * Effective device pixel ratio: the quality preset caps it (high ≤2, medium ≤1.5,
   * low 1) and the resolution-scale setting multiplies it. This is the single source
   * of truth for render-target resolution — both applyQuality and setRenderScale
   * route through it.
   */
  private effectiveDpr(): number {
    const dpr = window.devicePixelRatio || 1;
    const cap = this.quality === "high" ? 2 : this.quality === "medium" ? 1.5 : 1;
    return Math.max(0.1, Math.min(dpr, cap) * this.renderScale);
  }

  applyQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    this.renderer.setPixelRatio(this.effectiveDpr());
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    // Shadows stay consistent between the hero showcase and gameplay.
    this.keyLight.castShadow = q !== "low";
    const size = q === "high" ? 2048 : 1024;
    if (this.keyLight.shadow.mapSize.x !== size) {
      this.keyLight.shadow.mapSize.set(size, size);
      this.keyLight.shadow.map?.dispose();
      this.keyLight.shadow.map = null;
    }
    this.buildPost();
  }

  /**
   * Resolution-scale Display setting. Re-applies the effective pixel ratio and
   * resizes the renderer + both composers (postprocessing's setSize reads the
   * renderer's drawing-buffer size, so the new ratio propagates to every pass).
   */
  setRenderScale(scale: number): void {
    const s = Math.max(0.5, Math.min(2, scale || 1));
    if (s === this.renderScale) return;
    this.renderScale = s;
    this.renderer.setPixelRatio(this.effectiveDpr());
    this.onResize();
  }

  /**
   * Switch to the lean menu chain while a menu/overlay is up, and back to the full
   * chain for combat/cutscenes. Both retain the selected shadow quality so the
   * hero stays grounded and menu transitions don't change material variants.
   */
  setLowCost(on: boolean): void {
    if (on === this.lowCost) return;
    this.lowCost = on;
    this.keyLight.castShadow = this.quality !== "low";
  }

  /** Brightness/gamma: `mult` scales the base ACES exposure (1.0 = default). */
  setExposure(mult: number): void {
    this.renderer.toneMappingExposure = 1.16 * mult;
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

  /** Tempo-zone frame tint (IDEAS-GRAPHICS #17): a gentle pull toward `hex` by `amt`. */
  setTempoTint(hex: number, amt: number): void {
    this.tintTarget.set(hex);
    this.tintAmtTarget = amt;
  }

  /** Whole-frame mood (IDEAS-GRAPHICS #18): death drains + cools, victory warms + blooms. */
  setMood(mood: "neutral" | "dead" | "victory"): void {
    if (mood === "dead") { this.tintTarget.set(0x5a6a88); this.tintAmtTarget = 0.5; this.satTarget = -0.32; }
    else if (mood === "victory") { this.tintTarget.set(0xffe6b0); this.tintAmtTarget = 0.35; this.satTarget = 0.18; }
    else { this.tintAmtTarget = 0; this.satTarget = 0; }
  }

  update(dt: number): void {
    this.stress = damp(this.stress, 0, 6, dt);
    const s = this.stress;
    this.vignette.darkness = this.baseVignette + s * 0.45;
    // Damp the grade toward its target tint / mood and push to the effect.
    this.tintColor.lerp(this.tintTarget, clamp01(dt * 4));
    this.tintAmt = damp(this.tintAmt, this.tintAmtTarget, 4, dt);
    this.grade.setTint(this.tintColor, this.tintAmt);
    this.grade.saturation = damp(this.grade.saturation, this.satTarget, 3, dt);
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

  async warmMenuAsync(): Promise<void> {
    const prevCast = this.keyLight.castShadow;
    try {
      this.keyLight.castShadow = false;
      await this.renderer.compileAsync(this.scene, this.camera);
      for (let i = 0; i < 2; i++) {
        this.menuComposer.render(0.016);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
    } catch {
      this.warmMenu();
    } finally {
      this.keyLight.castShadow = prevCast;
    }
  }
}
