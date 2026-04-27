import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { getQuality } from "../engine/Quality";

/**
 * Static decorative ground decals — moss patches scattered around the arena
 * floor. Built once at construction with frozen world matrices and frozen
 * materials; nothing happens per-frame. Breaks up the flat biome floor without
 * touching the existing biome texture.
 *
 * Quality gates count: 0 on low, 6 on medium, 12 on high. Patches sit just
 * above the floor (Y=0.018) so they layer on top of the floor's grid texture
 * without z-fighting.
 */
export class EnvDecals {
  private patches: { mesh: Mesh; mat: StandardMaterial }[] = [];
  private mossTex: DynamicTexture | null = null;

  constructor(scene: Scene, arenaSize: number, seed = 7331) {
    const q = getQuality();
    if (q.tier === "low") return;
    const count = q.tier === "high" ? 12 : 6;

    this.mossTex = buildMossTexture(scene);
    const tex = this.mossTex;

    let s = seed >>> 0;
    const rng = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    const half = arenaSize / 2 - 2;
    const innerSafe = 4; // keep moss out of the immediate combat ring
    for (let i = 0; i < count; i++) {
      const mesh = MeshBuilder.CreateGround(`mossPatch_${i}`, { width: 1, height: 1, subdivisions: 1 }, scene);
      const angle = rng() * Math.PI * 2;
      const r = innerSafe + rng() * (half - innerSafe);
      mesh.position.set(Math.cos(angle) * r, 0.018, Math.sin(angle) * r);
      mesh.rotation.y = rng() * Math.PI * 2;
      const sc = 1.5 + rng() * 1.6;
      mesh.scaling.set(sc, 1, sc);
      mesh.isPickable = false;
      mesh.doNotSyncBoundingInfo = true;
      const mat = new StandardMaterial(`mossPatch_${i}_mat`, scene);
      mat.diffuseColor = new Color3(0.20, 0.42, 0.18);
      mat.emissiveColor = new Color3(0.05, 0.10, 0.04);
      mat.specularColor = new Color3(0, 0, 0);
      mat.diffuseTexture = tex;
      mat.opacityTexture = tex;
      mesh.material = mat;
      mesh.freezeWorldMatrix();
      mat.freeze();
      this.patches.push({ mesh, mat });
    }
  }

  dispose(): void {
    for (const p of this.patches) { p.mesh.dispose(); p.mat.dispose(); }
    this.patches.length = 0;
    if (this.mossTex) { this.mossTex.dispose(); this.mossTex = null; }
  }
}

function buildMossTexture(scene: Scene): DynamicTexture {
  const size = 128;
  const dt = new DynamicTexture("mossPatchTex", { width: size, height: size }, scene, false);
  const ctx = dt.getContext();
  ctx.clearRect(0, 0, size, size);
  const cx = size / 2;
  const cy = size / 2;
  // Soft green halo — fades from saturated center to transparent edge.
  const halo = ctx.createRadialGradient(cx, cy, 1, cx, cy, size * 0.46);
  halo.addColorStop(0, "rgba(80,160,70,0.85)");
  halo.addColorStop(0.6, "rgba(70,140,55,0.55)");
  halo.addColorStop(1, "rgba(40,80,30,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, size, size);
  // Darker mottle — small clumps suggesting moss texture.
  for (let i = 0; i < 30; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = size * 0.40 * Math.sqrt(Math.random());
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    ctx.fillStyle = `rgba(${30 + Math.round(Math.random() * 40)},${80 + Math.round(Math.random() * 40)},${30 + Math.round(Math.random() * 30)},${0.30 + Math.random() * 0.30})`;
    ctx.beginPath();
    ctx.arc(x, y, 2 + Math.random() * 5, 0, Math.PI * 2);
    ctx.fill();
  }
  // Bright accent flecks — green-yellow highlights.
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = size * 0.35 * Math.sqrt(Math.random());
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    ctx.fillStyle = `rgba(${130 + Math.round(Math.random() * 50)},${200 + Math.round(Math.random() * 35)},${100 + Math.round(Math.random() * 30)},${0.40 + Math.random() * 0.30})`;
    ctx.beginPath();
    ctx.arc(x, y, 0.9 + Math.random() * 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
  dt.hasAlpha = true;
  dt.update();
  return dt;
}
