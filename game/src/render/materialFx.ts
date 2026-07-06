import * as THREE from "three";

/** Shared global uniform so the effect-bisection panel can toggle the rim on EVERY material
 *  at once (all rim shaders point at this one object; flipping `.value` affects them all). */
const RIM_ON = { value: 1 };
export function setRimEnabled(on: boolean): void { RIM_ON.value = on ? 1 : 0; }

/**
 * Fresnel rim shell (IDEAS-GRAPHICS #2). Injects `pow(1-dot(n,v),power)*rimColor`
 * into a MeshStandardMaterial's emissive term so every unit gets a defining
 * edge-light against the dark floor — the "a key light or rim cap must define form"
 * bar, which one directional key can't hit off-axis.
 *
 * DO NOT pin customProgramCacheKey. An earlier version pinned it to just `power` to share
 * ONE program across every rim material "for the programs.length gate" — that was a real
 * bug (three.js #19377): it forced materials with DIFFERENT configs (map / emissiveMap /
 * vertexColors / envMap / light count) to reuse a program compiled for a DIFFERENT
 * material, so materials sampled UNBOUND textures → undefined behaviour on real GPUs
 * (SwiftShader + tolerant drivers returned deterministic black, hiding it from headless
 * tests) → objects/edges BLINKING as the camera moved and draw order changed which material
 * owned the shared program. Three's DEFAULT cache key already hashes the onBeforeCompile
 * source AND every program-affecting material feature, so rim materials share correctly
 * WITHIN a config and split correctly ACROSS configs. Warm-up must cover the real programs.
 */
export function applyRim(
  mat: THREE.MeshStandardMaterial,
  color?: THREE.ColorRepresentation,
  power = 2.4,
  intensity = 0.5,
): void {
  // Default tint: the unit's own glow colour, or a cool grey for unlit bodies.
  const rim = new THREE.Color(color ?? (mat.emissive.getHex() || 0x8496b0));
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = { value: rim };
    shader.uniforms.uRimPow = { value: power };
    shader.uniforms.uRimInt = { value: intensity };
    shader.uniforms.uRimOn = RIM_ON; // SHARED object → one global bisection toggle
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform vec3 uRimColor;\nuniform float uRimPow;\nuniform float uRimInt;\nuniform float uRimOn;",
      )
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\n\tfloat rh3Rim = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), uRimPow);\n\ttotalEmissiveRadiance += uRimColor * (rh3Rim * uRimInt * uRimOn);",
      );
  };
}
