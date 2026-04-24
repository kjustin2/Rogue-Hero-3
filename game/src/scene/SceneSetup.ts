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

  return { engine, scene, shadow, sun, attachPostFx, setHeavyPostFx };
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
