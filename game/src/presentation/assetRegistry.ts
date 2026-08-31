import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { ActorAssetDescriptor } from "./types";

const SLICE_ASSETS: ActorAssetDescriptor[] = [
  { id: "blade", url: "/assets/actors/blade.glb", fallback: "procedural" },
  { id: "husk", url: "/assets/actors/husk.glb", fallback: "procedural" },
  { id: "spitter", url: "/assets/actors/spitter.glb", fallback: "procedural" },
  { id: "sentinel", url: "/assets/actors/sentinel.glb", fallback: "procedural" },
  { id: "warden", url: "/assets/actors/pit-warden.glb", fallback: "procedural" },
  { id: "rift-basilica", url: "/assets/environments/rift-basilica.glb", fallback: "procedural" },
];

interface AssetManifest { glbs?: string[] }

/** Optional GLB layer with a guaranteed procedural fallback. Missing optional
 * files never fail boot and never alter deterministic gameplay. */
export class AssetRegistry {
  private readonly loader = new GLTFLoader();
  private readonly loaded = new Map<string, GLTF>();
  private readonly fallback = new Set<string>();
  private ready = false;

  async preloadSlice(): Promise<void> {
    // The manifest is part of the shipped procedural build. It lets optional art
    // packs opt in without probing absent URLs (which would leak noisy 404s into
    // Chromium/Electron despite the fallback succeeding).
    let available = new Set<string>();
    try {
      const response = await fetch("/assets/manifest.json", { cache: "no-store" });
      if (response.ok) {
        const manifest = await response.json() as AssetManifest;
        available = new Set(manifest.glbs ?? []);
      }
    } catch { /* malformed/missing manifests simply select procedural art */ }
    await Promise.all(SLICE_ASSETS.map(async (def) => {
      if (!available.has(def.url)) { this.fallback.add(def.id); return; }
      try {
        const gltf = await this.loader.loadAsync(def.url);
        gltf.scene.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return;
          o.castShadow = def.id === "blade" || def.id === "warden";
          o.receiveShadow = def.id === "rift-basilica";
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const mat of mats) {
            if ("map" in mat && mat.map instanceof THREE.Texture) mat.map.colorSpace = THREE.SRGBColorSpace;
            if ("emissiveMap" in mat && mat.emissiveMap instanceof THREE.Texture) mat.emissiveMap.colorSpace = THREE.SRGBColorSpace;
          }
        });
        this.loaded.set(def.id, gltf);
      } catch {
        this.fallback.add(def.id);
      }
    }));
    this.ready = true;
  }

  instantiate(id: string): THREE.Group | null {
    const gltf = this.loaded.get(id);
    if (!gltf) return null;
    return gltf.scene.clone(true);
  }

  animations(id: string): readonly THREE.AnimationClip[] {
    return this.loaded.get(id)?.animations ?? [];
  }

  validate(id: string, requiredClips: readonly string[] = []): { valid: boolean; fallback: boolean; missingClips: string[] } {
    const gltf = this.loaded.get(id);
    if (!gltf) return { valid: false, fallback: true, missingClips: [...requiredClips] };
    const names = new Set(gltf.animations.map((clip) => clip.name));
    const missingClips = requiredClips.filter((name) => !names.has(name));
    return { valid: missingClips.length === 0, fallback: false, missingClips };
  }

  status(): { ready: boolean; loaded: string[]; fallbacks: string[] } {
    return { ready: this.ready, loaded: [...this.loaded.keys()], fallbacks: [...this.fallback] };
  }
}
