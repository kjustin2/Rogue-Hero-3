import { Scene } from "@babylonjs/core/scene";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { GPUParticleSystem } from "@babylonjs/core/Particles/gpuParticleSystem";
import { SSAO2RenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline";
import { VolumetricLightScatteringPostProcess } from "@babylonjs/core/PostProcesses/volumetricLightScatteringPostProcess";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { GetClass } from "@babylonjs/core/Misc/typeStore";

/**
 * Runtime smoke test for Babylon.js side-effect imports.
 *
 * Babylon.js 9.x is heavily tree-shaken: methods like Camera.getForwardRay,
 * Scene.pick, ParticleSystem startup, and the collision coordinator are added
 * by side-effect modules (e.g. `@babylonjs/core/Culling/ray`). If you forget
 * the import, the method throws on first call with a message like:
 *   "Ray needs to be imported before as it contains a side-effect required by your code."
 *
 * That's a runtime crash that survives `tsc --noEmit` and `vite build`. To
 * catch it at boot — or better, in `npm run verify` before you ever hit the
 * browser — this module exercises the side-effect-dependent APIs we rely on.
 *
 * When you start using a new Babylon API that requires a side-effect import,
 * register it in `babylonSideEffects.ts` AND add a probe here so a missing
 * registration surfaces with a clear fix hint.
 */

// Babylon's side-effect warnings identify the missing class (e.g. "DefaultCollisionCoordinator"),
// not the import path. This map converts the class name into the import devs actually need.
// Add an entry whenever you discover a new side-effect dep.
const CLASS_TO_IMPORT: Record<string, string> = {
  Ray: "@babylonjs/core/Culling/ray",
  DefaultCollisionCoordinator: "@babylonjs/core/Collisions/collisionCoordinator",
  ParticleSystem: "@babylonjs/core/Particles/particleSystemComponent",
  GPUParticleSystem: "@babylonjs/core/Particles/gpuParticles",
  WebGL2ParticleSystem: "@babylonjs/core/Particles/webgl2ParticleSystem",
  ShadowGenerator: "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent",
  DefaultRenderingPipeline:
    "@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent",
  PrePassRenderer: "@babylonjs/core/Rendering/prePassRendererSceneComponent",
  GeometryBufferRenderer: "@babylonjs/core/Rendering/geometryBufferRendererSceneComponent",
  DepthRenderer: "@babylonjs/core/Rendering/depthRendererSceneComponent",
};

function importHintFromError(message: string): string | null {
  // Matches Babylon's _WarnImport output: "X needs to be imported before as it contains..."
  const match = /^(\w+) needs to be imported before/.exec(message);
  if (!match) return null;
  return CLASS_TO_IMPORT[match[1]] ?? null;
}

export function validateBabylonRuntime(scene: Scene, camera: Camera): void {
  const failures: string[] = [];

  function probe(label: string, fn: () => unknown, fallbackHint: string): void {
    try {
      fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const parsedHint = importHintFromError(msg);
      const hint = parsedHint ?? fallbackHint;
      const hintNote =
        parsedHint && parsedHint !== fallbackHint
          ? ` (probe suspected ${fallbackHint})`
          : "";
      failures.push(`  • ${label} failed: ${msg}\n    Fix: import "${hint}";${hintNote}`);
    }
  }

  probe(
    "camera.getForwardRay()",
    () => camera.getForwardRay(),
    "@babylonjs/core/Culling/ray",
  );

  probe(
    "scene.pick()",
    () => scene.pick(0, 0, () => false),
    "@babylonjs/core/Culling/ray",
  );

  probe(
    "scene.createPickingRay()",
    () => scene.createPickingRay(0, 0, null, camera),
    "@babylonjs/core/Culling/ray",
  );

  // ArcRotateCamera.checkCollisions = true makes getWorldMatrix hit this getter.
  // Probing it directly surfaces the missing import regardless of camera subclass.
  probe(
    "scene.collisionCoordinator",
    () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      (scene as unknown as { collisionCoordinator: unknown }).collisionCoordinator;
    },
    "@babylonjs/core/Collisions/collisionCoordinator",
  );

  probe(
    "ParticleSystem instantiation + start",
    () => {
      const ps = new ParticleSystem("__probeParticles", 1, scene);
      ps.start();
      ps.stop();
      ps.dispose();
    },
    "@babylonjs/core/Particles/particleSystemComponent",
  );

  // GPU particles use the WebGL2 backend, which is side-effect-registered
  // via `@babylonjs/core/Particles/webgl2ParticleSystem`. `GPUParticleSystem`
  // constructor throws "The WebGL2ParticleSystem class is not available!" if
  // that import is missing. We can't construct it under NullEngine (where
  // IsSupported is false), so we check the class registry instead — which
  // runs deterministically on any runtime.
  probe(
    "WebGL2ParticleSystem class registration",
    () => {
      const cls = GetClass("BABYLON.WebGL2ParticleSystem");
      if (!cls) {
        throw new Error("WebGL2ParticleSystem needs to be imported before as it contains a side-effect required by your code.");
      }
    },
    "@babylonjs/core/Particles/webgl2ParticleSystem",
  );
  // Optional live construction probe when WebGL2 is actually available.
  if (GPUParticleSystem.IsSupported) {
    probe(
      "GPUParticleSystem instantiation",
      () => {
        const ps = new GPUParticleSystem("__probeGpuParticles", { capacity: 1 }, scene);
        ps.dispose();
      },
      "@babylonjs/core/Particles/webgl2ParticleSystem",
    );
  }

  // SSAO2 is quality-gated but auto-detect may turn it on — if the pre-pass
  // side-effect isn't registered, `new SSAO2RenderingPipeline()` throws at
  // construction with "scene.enablePrePassRenderer is not a function". Probe
  // it so that the failure surfaces in `npm run verify` instead of on boot.
  probe(
    "SSAO2RenderingPipeline construction",
    () => {
      const ssao = new SSAO2RenderingPipeline("__probeSsao", scene, {
        ssaoRatio: 0.5,
        blurRatio: 0.5,
      }, [camera]);
      ssao.dispose();
    },
    "@babylonjs/core/Rendering/prePassRendererSceneComponent",
  );

  // Volumetric light scattering (god rays) likewise has side-effect deps —
  // if any of them are missing, the constructor throws.
  probe(
    "VolumetricLightScatteringPostProcess construction",
    () => {
      const emitter = MeshBuilder.CreatePlane("__probeGodRaysEmitter", { size: 1 }, scene);
      const fx = new VolumetricLightScatteringPostProcess(
        "__probeGodRays",
        { postProcessRatio: 0.5, passRatio: 0.5 },
        camera,
        emitter,
        10,
        undefined,
        scene.getEngine(),
      );
      fx.dispose(camera);
      emitter.dispose();
    },
    "@babylonjs/core/PostProcesses/volumetricLightScatteringPostProcess",
  );

  if (failures.length > 0) {
    const detail = failures.join("\n");
    const msg =
      `[BabylonRuntimeCheck] ${failures.length} side-effect probe(s) failed:\n${detail}\n` +
      `Add the missing import(s) to src/engine/babylonSideEffects.ts.`;
    // eslint-disable-next-line no-console
    console.error(msg);
    throw new Error(msg);
  }
}
