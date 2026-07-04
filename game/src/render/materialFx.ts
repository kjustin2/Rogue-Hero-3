import * as THREE from "three";

const RIM_KEY = "rh3-rim-";

/**
 * Fresnel rim shell (IDEAS-GRAPHICS #2). Injects `pow(1-dot(n,v),power)*rimColor`
 * into a MeshStandardMaterial's emissive term so every unit gets a defining
 * edge-light against the dark floor — the "a key light or rim cap must define form"
 * bar, which one directional key can't hit off-axis.
 *
 * The cache key is PINNED to (power) so the dozens of enemy/hero materials that call
 * this all share ONE compiled program — the rim colour is a uniform, not a define —
 * which protects the programs.length perf gate. Warmed via the hero (in scene at
 * boot) and the combat warm-dummies (main.ts warmCombatShaders).
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
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform vec3 uRimColor;\nuniform float uRimPow;\nuniform float uRimInt;",
      )
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\n\tfloat rh3Rim = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), uRimPow);\n\ttotalEmissiveRadiance += uRimColor * (rh3Rim * uRimInt);",
      );
  };
  mat.customProgramCacheKey = () => RIM_KEY + power;
}
