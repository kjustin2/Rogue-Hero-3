import { defineConfig } from "vite";

// Every Babylon side-effect module we depend on — MUST match the import list
// in `src/engine/babylonSideEffects.ts`. Listing them here forces Vite's
// optimizer to include them in the pre-bundled dep, which avoids the trap
// where adding a new side-effect import leaves the cached `@babylonjs/core`
// bundle missing it (causing "X is not a function" at boot).
//
// When you add an import to babylonSideEffects.ts, add the same specifier here.
const BABYLON_SIDE_EFFECTS = [
  "@babylonjs/core/Culling/ray",
  "@babylonjs/core/Collisions/collisionCoordinator",
  "@babylonjs/core/Particles/particleSystemComponent",
  "@babylonjs/core/Particles/webgl2ParticleSystem",
  "@babylonjs/core/Rendering/edgesRenderer",
  "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent",
  "@babylonjs/core/Cameras/Inputs/arcRotateCameraPointersInput",
  "@babylonjs/core/Cameras/Inputs/arcRotateCameraKeyboardMoveInput",
  "@babylonjs/core/Cameras/Inputs/arcRotateCameraMouseWheelInput",
  "@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent",
  "@babylonjs/core/Rendering/prePassRendererSceneComponent",
  "@babylonjs/core/Rendering/geometryBufferRendererSceneComponent",
  "@babylonjs/core/Rendering/depthRendererSceneComponent",
];

export default defineConfig({
  server: {
    port: 5173,
    open: true,
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
  optimizeDeps: {
    // Force-include Babylon side-effect modules so they're part of the
    // pre-bundled `@babylonjs/core` chunk even when Vite's source scan misses
    // them (it sometimes does for bare `import "..."` side-effect-only modules).
    include: BABYLON_SIDE_EFFECTS,
  },
});
