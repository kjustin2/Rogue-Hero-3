import { Scene } from "@babylonjs/core/scene";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { GPUParticleSystem } from "@babylonjs/core/Particles/gpuParticleSystem";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { getQuality } from "../engine/Quality";

/**
 * Drifting leaf/petal particles for the verdant biome — slow horizontal drift
 * plus a gentle fall. Continuous emit; never paused. One particle system,
 * sized by quality tier; off entirely on low.
 *
 * Sprite is a procedural elongated oval ("leaf"). Standard alpha blend (NOT
 * additive) so leaves read as physical objects against the floor, not glow.
 * Cap: 24 on high, 14 on medium, 0 on low.
 */
export class AmbientWind {
  private ps: ParticleSystem | GPUParticleSystem | null = null;
  private tex: Texture | null = null;

  constructor(scene: Scene, arenaSize: number) {
    if (getQuality().tier === "low") return;
    this.tex = buildLeafTexture(scene);

    const cap = getQuality().tier === "high" ? 24 : 14;
    const supportsGpu = GPUParticleSystem.IsSupported;
    const ps: ParticleSystem | GPUParticleSystem = supportsGpu
      ? new GPUParticleSystem("ambientWind", { capacity: cap }, scene)
      : new ParticleSystem("ambientWind", cap, scene);
    ps.particleTexture = this.tex;
    // Emit from a high invisible plane covering the arena footprint plus a
    // small margin, so leaves drift in from "off the screen" too.
    const half = arenaSize / 2 + 2;
    ps.emitter = new Vector3(0, 9, 0);
    ps.minEmitBox = new Vector3(-half, 0, -half);
    ps.maxEmitBox = new Vector3(half, 1, half);
    // Two-tone palette — dominant verdant greens with a rare warm-yellow accent.
    ps.color1 = new Color4(0.55, 0.78, 0.30, 0.85);
    ps.color2 = new Color4(0.92, 0.78, 0.32, 0.75);
    ps.colorDead = new Color4(0.40, 0.55, 0.18, 0);
    ps.minSize = 0.10;
    ps.maxSize = 0.20;
    ps.minLifeTime = 4.5;
    ps.maxLifeTime = 8.0;
    ps.emitRate = Math.max(2, Math.floor(cap / 5));
    ps.minEmitPower = 0.15;
    ps.maxEmitPower = 0.45;
    // Diagonal "wind" gravity — leaves drift sideways more than they fall.
    ps.gravity = new Vector3(0.65, -0.55, 0.30);
    ps.direction1 = new Vector3(-0.25, -0.05, -0.25);
    ps.direction2 = new Vector3(0.25, 0.10, 0.25);
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.updateSpeed = 0.02;
    ps.start();
    this.ps = ps;
  }

  dispose(): void {
    if (this.ps) { this.ps.stop(); this.ps.dispose(); this.ps = null; }
    if (this.tex) { this.tex.dispose(); this.tex = null; }
  }
}

function buildLeafTexture(scene: Scene): Texture {
  const size = 32;
  const dt = new DynamicTexture("ambientWindLeafTex", { width: size, height: size }, scene, false);
  const ctx = dt.getContext();
  ctx.clearRect(0, 0, size, size);
  // Soft elongated oval — emissive bright center fading at the edges. Drawn
  // by scaling a unit-circle arc on Y so we don't depend on `ellipse()`,
  // which is missing from Babylon's ICanvasRenderingContext typing.
  const grad = ctx.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size * 0.42);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.55, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.save();
  ctx.translate(size / 2, size / 2);
  // Squash the Y axis so a circular arc draws as a horizontal ellipse — gives
  // a leaf-shaped sprite with the same falloff as the gradient.
  ctx.scale(1, 0.55);
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.36, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  dt.hasAlpha = true;
  dt.update();
  return dt;
}
