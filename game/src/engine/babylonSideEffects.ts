// Central registry of Babylon.js side-effect imports for Rogue Hero 3.
//
// Babylon 9.x is heavily tree-shaken: features like camera ray extensions,
// collision coordination, particle startup, shadow generation, and post-process
// pipelines are bolted onto the relevant prototypes by *importing* their
// side-effect module. Skip the import and calls silently compile, then throw
// "X needs to be imported before as it contains a side-effect required by your
// code." at runtime.
//
// All Babylon side-effect imports the game depends on live here and nowhere
// else. main.ts imports this file first so the prototype patching completes
// before any other Babylon code runs, and scripts/verify-babylon-runtime.ts
// imports it so the offline probe exercises the same registration set.
//
// When you start using a new Babylon API that requires a side-effect import,
// add it here AND add a matching probe to BabylonRuntimeCheck.ts so missing
// registrations surface at boot (and in CI) rather than mid-gameplay.

// Camera.getForwardRay + scene.pick + scene.createPickingRay
import "@babylonjs/core/Culling/ray";

// Scene.collisionCoordinator (triggered by ArcRotateCamera.checkCollisions = true)
import "@babylonjs/core/Collisions/collisionCoordinator";

// ParticleSystem.start / emit lifecycle
import "@babylonjs/core/Particles/particleSystemComponent";

// GPUParticleSystem — registers the WebGL2 backend class that GPU particles
// construct at runtime. Missing this throws "The WebGL2ParticleSystem class is
// not available!" from `new GPUParticleSystem(...)`.
import "@babylonjs/core/Particles/webgl2ParticleSystem";

// Mesh.edgesRenderer (used by outlined arena props)
import "@babylonjs/core/Rendering/edgesRenderer";

// ShadowGenerator pickup in scene components
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";

// ArcRotateCamera input handlers — attachControl pulls these via name.
import "@babylonjs/core/Cameras/Inputs/arcRotateCameraPointersInput";
import "@babylonjs/core/Cameras/Inputs/arcRotateCameraKeyboardMoveInput";
import "@babylonjs/core/Cameras/Inputs/arcRotateCameraMouseWheelInput";

// DefaultRenderingPipeline + post-process manager registration
import "@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent";

// Scene.enablePrePassRenderer — required by SSAO2RenderingPipeline and any
// other post-process that needs a pre-pass (normals / depth) texture.
import "@babylonjs/core/Rendering/prePassRendererSceneComponent";

// GeometryBufferRenderer — SSAO2 requests geometry-buffer data through
// scene.enableGeometryBufferRenderer() which is only present after this.
import "@babylonjs/core/Rendering/geometryBufferRendererSceneComponent";

// DepthRenderer — some SSAO fallback paths (and several other post-processes)
// request scene.enableDepthRenderer() which attaches via this component.
import "@babylonjs/core/Rendering/depthRendererSceneComponent";
