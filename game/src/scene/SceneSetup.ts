import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import { SSAO2RenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline";
import { VolumetricLightScatteringPostProcess } from "@babylonjs/core/PostProcesses/volumetricLightScatteringPostProcess";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { ColorCurves } from "@babylonjs/core/Materials/colorCurves";
import { getQuality } from "../engine/Quality";

export type GradingPreset = "verdant" | "pit" | "neutral";

export interface SceneBundle {
  engine: Engine;
  scene: Scene;
  shadow: ShadowGenerator;
  sun: DirectionalLight;
  hemi: HemisphericLight;
  /** Created lazily after the camera exists. Call attachPostFx(camera) once. */
  attachPostFx(camera: Camera): DefaultRenderingPipeline;
  /**
   * Enable/disable the heavy quality-gated post-processes (SSAO + god rays).
   * Called at boot based on quality settings, and when the user cycles tiers.
   * Pipelines are attached/detached rather than re-created to keep the cost low.
   */
  setHeavyPostFx(camera: Camera, opts: { ssao: boolean; godRays: boolean }): void;
}

export function createSceneBundle(canvas: HTMLCanvasElement): SceneBundle {
  const engine = new Engine(canvas, true, {
    preserveDrawingBuffer: false,
    stencil: true,
    antialias: true,
    powerPreference: "high-performance",
  });

  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.045, 0.065, 0.055, 1);
  scene.ambientColor = new Color3(0.25, 0.27, 0.24);
  // Scene collision engine — needed for the ArcRotateCamera to slide along walls instead of
  // clipping through them. Per-mesh checkCollisions flags (set on arena walls) are the opt-in.
  scene.collisionsEnabled = true;

  // Soft atmospheric fog — only engages past the far wall so close combat stays crisp.
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.012;
  scene.fogColor = new Color3(0.08, 0.10, 0.085);

  // Ambient hemispheric fill — sky-ish. Slightly stronger so capsule bodies aren't crushed into silhouette.
  const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.55;
  hemi.diffuse = new Color3(0.78, 0.88, 0.82);
  hemi.groundColor = new Color3(0.20, 0.23, 0.18);

  // Directional sun for shadows — warmer + a touch stronger, giving more form on capsule bodies.
  const sun = new DirectionalLight("sun", new Vector3(-0.4, -1, -0.3).normalize(), scene);
  sun.position = new Vector3(40, 60, 40);
  sun.intensity = 1.25;
  sun.diffuse = new Color3(1.0, 0.93, 0.78);

  // Shadow map resolution + blur kernel scale with the chosen quality tier so
  // players on integrated GPUs don't pay the full 2048+32 cost.
  const q = getQuality();
  const shadow = new ShadowGenerator(q.shadowMapSize, sun);
  shadow.useBlurExponentialShadowMap = true;
  shadow.blurKernel = q.shadowBlurKernel;
  shadow.darkness = 0.35;
  // Throttle the shadow map re-render — the single most expensive per-frame
  // cost at these settings. At q.shadowRefreshRate=2 the map updates every
  // other frame, which is imperceptible at the game's camera distance and
  // enemy pace.
  const shadowMap = shadow.getShadowMap();
  if (shadowMap) shadowMap.refreshRate = q.shadowRefreshRate;

  window.addEventListener("resize", () => engine.resize());

  function attachPostFx(camera: Camera): DefaultRenderingPipeline {
    const pipeline = new DefaultRenderingPipeline("default", true, scene, [camera]);
    pipeline.bloomEnabled = q.bloomEnabled;
    pipeline.bloomThreshold = 0.85;
    pipeline.bloomWeight = 0.4;
    pipeline.bloomKernel = q.bloomKernel;
    pipeline.bloomScale = 0.5;
    pipeline.fxaaEnabled = true;
    pipeline.imageProcessing.contrast = 1.05;
    pipeline.imageProcessing.exposure = 1.0;
    pipeline.imageProcessing.vignetteEnabled = true;
    pipeline.imageProcessing.vignetteWeight = 1.5;
    pipeline.imageProcessing.vignetteColor = new Color4(0, 0, 0, 0);
    // Enable color grading via ColorCurves — cheap, GPU-side lookup per fragment.
    pipeline.imageProcessing.colorCurvesEnabled = true;
    const curves = new ColorCurves();
    pipeline.imageProcessing.colorCurves = curves;
    return pipeline;
  }

  // Heavy post-processes — created lazily and tracked so setHeavyPostFx can
  // tear them down cleanly when quality drops.
  let ssaoPipeline: SSAO2RenderingPipeline | null = null;
  let godRaysMesh: Mesh | null = null;
  let godRaysFx: VolumetricLightScatteringPostProcess | null = null;

  function setHeavyPostFx(camera: Camera, opts: { ssao: boolean; godRays: boolean }): void {
    // --- SSAO2 ---
    if (opts.ssao && !ssaoPipeline) {
      // Ratio lowered to 0.5 — the SSAO pass reads the depth buffer at half
      // resolution to keep the cost down. Works well for a top-down view.
      ssaoPipeline = new SSAO2RenderingPipeline("ssao", scene, {
        ssaoRatio: 0.5,
        blurRatio: 0.5,
      }, [camera]);
      ssaoPipeline.radius = 1.2;
      ssaoPipeline.totalStrength = 1.0;
      ssaoPipeline.expensiveBlur = false;
      ssaoPipeline.samples = 8;
      ssaoPipeline.maxZ = 100;
    } else if (!opts.ssao && ssaoPipeline) {
      ssaoPipeline.dispose();
      ssaoPipeline = null;
    }

    // --- Volumetric light scattering (god rays) on the sun ---
    if (opts.godRays && !godRaysFx) {
      // VLS needs a small bright "emitter" mesh it targets. A tiny billboarded
      // disc stuck at the sun's far-field position works — it's invisible in
      // gameplay but acts as the ray origin in screen space.
      godRaysMesh = MeshBuilder.CreatePlane("godRaysEmitter", { size: 40 }, scene);
      godRaysMesh.position.set(80, 120, 80);
      godRaysMesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
      const m = new StandardMaterial("godRaysEmitterMat", scene);
      m.emissiveColor = new Color3(1.0, 0.95, 0.8);
      m.disableLighting = true;
      m.backFaceCulling = false;
      godRaysMesh.material = m;
      godRaysMesh.isPickable = false;
      godRaysMesh.applyFog = false;
      godRaysFx = new VolumetricLightScatteringPostProcess(
        "godRays",
        { postProcessRatio: 0.5, passRatio: 0.5 },
        camera,
        godRaysMesh,
        60,           // samples — lower is cheaper, still sells the effect
        undefined,
        scene.getEngine(),
      );
      godRaysFx.exposure = 0.14;
      godRaysFx.decay = 0.96;
      godRaysFx.weight = 0.5;
      godRaysFx.density = 0.9;
    } else if (!opts.godRays && godRaysFx) {
      // VolumetricLightScatteringPostProcess.dispose requires the camera it was attached to.
      godRaysFx.dispose(camera);
      godRaysFx = null;
      if (godRaysMesh) { godRaysMesh.dispose(); godRaysMesh = null; }
    }
  }

  return { engine, scene, shadow, sun, hemi, attachPostFx, setHeavyPostFx };
}

/**
 * Boss-room dramatic lighting overlay. Dims the hemispheric fill, drops the
 * sun intensity, and shifts the sun toward a hot amber so the boss arena
 * reads as a charged, hostile space — paired with the existing "pit" color
 * grading preset. Pass `on=false` to restore baseline values for normal rooms.
 *
 * Stored baseline as static module-level so a single import owns the saved
 * values; calling with on=false from any context will revert correctly.
 */
let _bossBaseline: {
  hemiI: number;
  hemiDiff: Color3;
  hemiGround: Color3;
  sunI: number;
  sunDiff: Color3;
  clear: Color4;
  fog: Color3;
  fogDensity: number;
} | null = null;

/**
 * Boss-room sun + hemi flicker state. tickBossLighting reads `active` and the
 * captured boss baseline intensities to wobble the lights around them at low
 * amplitude. Reads as firelight breathing in a hot pit — we never let the
 * intensity drift far enough to look like a bug. Off when applyBossLighting
 * is called with `on=false`.
 */
const _bossFlicker = {
  active: false,
  baseSun: 1.45,
  baseHemi: 0.32,
  clock: 0,
};

export function applyBossLighting(bundle: SceneBundle, on: boolean): void {
  const { scene, hemi, sun } = bundle;
  if (on) {
    // Capture baseline lazily — only on the first transition into boss
    // lighting. Subsequent flips just swap between baseline and boss values.
    if (!_bossBaseline) {
      _bossBaseline = {
        hemiI: hemi.intensity,
        hemiDiff: hemi.diffuse.clone(),
        hemiGround: hemi.groundColor.clone(),
        sunI: sun.intensity,
        sunDiff: sun.diffuse.clone(),
        clear: scene.clearColor.clone(),
        fog: scene.fogColor.clone(),
        fogDensity: scene.fogDensity,
      };
    }
    // Crushed ambient + cooler ground + warm hot-coal sun. The room ends up
    // looking like dusk-firelight under a deep amber sky.
    hemi.intensity = 0.32;
    hemi.diffuse.set(0.55, 0.42, 0.38);
    hemi.groundColor.set(0.10, 0.08, 0.07);
    sun.intensity = 1.45;
    sun.diffuse.set(1.0, 0.55, 0.30);
    scene.clearColor.set(0.07, 0.035, 0.04, 1);
    scene.fogColor.set(0.12, 0.06, 0.05);
    scene.fogDensity = 0.018;
    // Activate the firelight flicker — tickBossLighting modulates around
    // baseSun/baseHemi from the render loop. Captured here from the boss
    // values we just set so the flicker tracks any future re-tuning.
    _bossFlicker.active = true;
    _bossFlicker.baseSun = sun.intensity;
    _bossFlicker.baseHemi = hemi.intensity;
    _bossFlicker.clock = 0;
  } else if (_bossBaseline) {
    hemi.intensity = _bossBaseline.hemiI;
    hemi.diffuse.copyFrom(_bossBaseline.hemiDiff);
    hemi.groundColor.copyFrom(_bossBaseline.hemiGround);
    sun.intensity = _bossBaseline.sunI;
    sun.diffuse.copyFrom(_bossBaseline.sunDiff);
    scene.clearColor.copyFrom(_bossBaseline.clear);
    scene.fogColor.copyFrom(_bossBaseline.fog);
    scene.fogDensity = _bossBaseline.fogDensity;
    _bossFlicker.active = false;
  }
}

/**
 * Per-frame boss-lighting flicker. Call from the render loop unconditionally;
 * does nothing unless boss lighting is active. Wobbles sun + hemi intensity
 * around their boss baselines at compound frequencies (3 Hz primary, 1.5 Hz
 * secondary on the sun) so the flicker reads as living firelight rather than
 * a single sine wave.
 */
export function tickBossLighting(bundle: SceneBundle, dt: number): void {
  if (!_bossFlicker.active) return;
  _bossFlicker.clock += dt;
  const c = _bossFlicker.clock;
  // ω = 2π * f, so 18.85 ≈ 3 Hz primary, 9.4 ≈ 1.5 Hz secondary, 12.6 ≈ 2 Hz on hemi.
  bundle.sun.intensity = _bossFlicker.baseSun
    + Math.sin(c * 18.85) * 0.06
    + Math.sin(c * 9.4) * 0.03;
  bundle.hemi.intensity = _bossFlicker.baseHemi
    + Math.sin(c * 12.6) * 0.025;
}

/**
 * Apply a color-grading preset to an existing pipeline. Meant to be called on
 * room load so each biome feels distinct. Presets tint midtones, shadows, and
 * highlights separately; the ColorCurves uniform is updated in one call.
 */
export function applyGradingPreset(pipeline: DefaultRenderingPipeline, preset: GradingPreset): void {
  const curves = pipeline.imageProcessing.colorCurves;
  if (!curves) return;
  // Babylon ColorCurves are set in HSD (hue/saturation/density) per band.
  // See https://doc.babylonjs.com/features/featuresDeepDive/postProcesses/usePostProcesses#color-curves
  switch (preset) {
    case "verdant":
      // Slightly green-shifted midtones, warm highlights, cool shadows — a painterly forest.
      curves.globalHue = 95;           // 0-360 degrees — slight green shift
      curves.globalDensity = 12;       // saturation bump
      curves.globalSaturation = 6;
      curves.highlightsHue = 45;
      curves.highlightsDensity = 10;
      curves.shadowsHue = 220;
      curves.shadowsDensity = 18;
      curves.shadowsSaturation = -12;
      break;
    case "pit":
      // Desaturated, red-shifted, deep shadows. Frames the boss arena as hostile.
      curves.globalHue = 0;
      curves.globalDensity = -18;
      curves.globalSaturation = -24;
      curves.highlightsHue = 20;
      curves.highlightsDensity = 14;
      curves.shadowsHue = 0;
      curves.shadowsDensity = 30;
      curves.shadowsSaturation = -30;
      break;
    case "neutral":
    default:
      curves.globalHue = 0;
      curves.globalDensity = 0;
      curves.globalSaturation = 0;
      curves.highlightsHue = 0;
      curves.highlightsDensity = 0;
      curves.shadowsHue = 0;
      curves.shadowsDensity = 0;
      curves.shadowsSaturation = 0;
      break;
  }
}
