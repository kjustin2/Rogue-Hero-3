/**
 * Single source of truth for graphics quality.
 *
 * Three tiers (low/medium/high) gate the heavier visual features so players on
 * integrated GPUs don't pay for SSAO + volumetric beams + 300 grass instances.
 * Default is "medium" — auto-detect bumps to "high" on WebGL2-capable
 * desktop-class GPUs and drops to "low" on the roughest hardware, but the user
 * can cycle manually at runtime via the G key.
 *
 * The settings object is a plain POJO, not reactive. Code that reads it either
 * does so at boot (arena builders, post-fx pipeline) or per-frame (render loop
 * opts) — so "apply new quality" means rebuilding the affected subsystems,
 * which we do on arena reload after a cycle.
 */
export type QualityTier = "low" | "medium" | "high";

export interface QualitySettings {
  tier: QualityTier;
  /** Shadow map resolution. 1024 low, 2048 medium, 4096 high. */
  shadowMapSize: number;
  /** Blur kernel radius on shadows; bigger = softer but slower. */
  shadowBlurKernel: number;
  /** Whether to run the Screen-Space Ambient Occlusion pass. */
  ssaoEnabled: boolean;
  /** Whether to run the volumetric light scattering post-process. */
  godRaysEnabled: boolean;
  /** Cap on simultaneous procedural decals on the floor. */
  decalCap: number;
  /** Multiplier applied to env prop counts (grass/rocks/mushrooms). */
  envDensity: number;
  /** Multiplier applied to the ambient motes capacity / emit rate. */
  moteDensity: number;
  /** Whether post-processing bloom is enabled (disabled on low for mobile-ish). */
  bloomEnabled: boolean;
  /** Radius of the bloom kernel — smaller on lower tiers. */
  bloomKernel: number;
}

const STORAGE_KEY = "rh3.quality";

function tierDefaults(tier: QualityTier): QualitySettings {
  switch (tier) {
    case "low":
      return {
        tier: "low",
        shadowMapSize: 1024,
        shadowBlurKernel: 16,
        ssaoEnabled: false,
        godRaysEnabled: false,
        decalCap: 0,
        envDensity: 0.5,
        moteDensity: 0.4,
        bloomEnabled: false,
        bloomKernel: 32,
      };
    case "high":
      return {
        tier: "high",
        shadowMapSize: 4096,
        shadowBlurKernel: 48,
        ssaoEnabled: true,
        godRaysEnabled: true,
        decalCap: 28,
        envDensity: 1.0,
        moteDensity: 1.0,
        bloomEnabled: true,
        bloomKernel: 96,
      };
    case "medium":
    default:
      return {
        tier: "medium",
        shadowMapSize: 2048,
        shadowBlurKernel: 32,
        ssaoEnabled: false,
        godRaysEnabled: false,
        decalCap: 16,
        envDensity: 0.85,
        moteDensity: 0.8,
        bloomEnabled: true,
        bloomKernel: 64,
      };
  }
}

/**
 * Heuristic guess at device capability. Runs once at boot.
 *
 * Policy: default to "medium". Only drop to "low" when we can positively
 * identify a software renderer or a sub-4K max texture. We never auto-promote
 * to "high" — high turns on SSAO + god rays, which are real perf hits, so we
 * make the user opt in explicitly via the G-key cycle. That also means a bad
 * Babylon side-effect import for SSAO / god rays can't brick the default boot.
 */
function detectTier(): QualityTier {
  // No DOM in tests — fall back to medium.
  if (typeof window === "undefined" || typeof document === "undefined") return "medium";
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") as WebGL2RenderingContext | null)
      ?? (canvas.getContext("webgl") as WebGLRenderingContext | null);
    if (!gl) return "low";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    let renderer = "";
    if (ext) {
      renderer = String(gl.getParameter((ext as { UNMASKED_RENDERER_WEBGL: number }).UNMASKED_RENDERER_WEBGL) ?? "");
    }
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    // Explicit low signals: software renderer, tiny max texture.
    const r = renderer.toLowerCase();
    if (r.includes("swiftshader") || r.includes("llvmpipe") || r.includes("software")) return "low";
    if (maxTex < 4096) return "low";
    return "medium";
  } catch {
    return "medium";
  }
}

let cached: QualitySettings | null = null;

function load(): QualitySettings {
  if (typeof localStorage === "undefined") return tierDefaults(detectTier());
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "low" || raw === "medium" || raw === "high") return tierDefaults(raw);
  } catch {
    // ignore storage failures (privacy mode etc)
  }
  return tierDefaults(detectTier());
}

function save(tier: QualityTier): void {
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(STORAGE_KEY, tier); } catch { /* noop */ }
}

/** Read-only handle to the current settings. Mutating this won't change state — use setQuality. */
export function getQuality(): QualitySettings {
  if (!cached) cached = load();
  return cached;
}

/** Explicitly change the tier. Returns the new settings. Caller is responsible for
 *  triggering subsystem rebuilds (arena reload etc) when settings need to re-apply. */
export function setQuality(tier: QualityTier): QualitySettings {
  cached = tierDefaults(tier);
  save(tier);
  return cached;
}

/** Cycle to the next tier — low → medium → high → low. Used by the G keybind. */
export function cycleQuality(): QualitySettings {
  const cur = getQuality().tier;
  const next: QualityTier = cur === "low" ? "medium" : cur === "medium" ? "high" : "low";
  return setQuality(next);
}
