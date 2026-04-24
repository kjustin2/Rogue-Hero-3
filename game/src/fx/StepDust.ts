import { Scene } from "@babylonjs/core/scene";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { getQuality } from "../engine/Quality";

/**
 * Step-triggered foot-dust puffs.
 *
 * Pools four ParticleSystems — cycling through them handles overlapping steps
 * without allocating. Emits a short 5-particle burst per step beat, color'd to
 * the floor (muted tan) so it reads as kicked-up grit rather than magic fx.
 *
 * Gated off on low quality — dust is pure polish, not combat feedback.
 */
export class StepDust {
  private readonly POOL_SIZE = 4;
  private pool: { ps: ParticleSystem; emitterPos: Vector3 }[] = [];
  private cursor = 0;
  private enabled: boolean;
  private tex: Texture;

  constructor(scene: Scene) {
    this.enabled = getQuality().tier !== "low";

    // Soft circular sprite.
    const dt = new DynamicTexture("stepDustTex", { width: 32, height: 32 }, scene, false);
    const ctx = dt.getContext();
    const grad = ctx.createRadialGradient(16, 16, 2, 16, 16, 14);
    grad.addColorStop(0, "rgba(255,244,228,0.85)");
    grad.addColorStop(0.5, "rgba(220,200,170,0.45)");
    grad.addColorStop(1, "rgba(160,140,110,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);
    dt.update();
    this.tex = dt;

    if (!this.enabled) return;

    for (let i = 0; i < this.POOL_SIZE; i++) {
      const ps = new ParticleSystem(`stepDust_${i}`, 12, scene);
      ps.particleTexture = this.tex;
      // Each pool slot gets its own Vector3 emitter — Babylon accepts either a
      // mesh or a Vector3. Vector3 lets us move per-puff without a TransformNode.
      const emitterPos = new Vector3(0, 0.05, 0);
      ps.emitter = emitterPos;
      ps.minEmitBox = new Vector3(-0.12, 0, -0.12);
      ps.maxEmitBox = new Vector3(0.12, 0.05, 0.12);
      ps.color1 = new Color4(0.85, 0.78, 0.62, 0.55);
      ps.color2 = new Color4(0.7, 0.62, 0.48, 0.4);
      ps.colorDead = new Color4(0.55, 0.48, 0.38, 0);
      ps.minSize = 0.08;
      ps.maxSize = 0.22;
      ps.minLifeTime = 0.35;
      ps.maxLifeTime = 0.65;
      // Manual — we emit a fixed small count per step. A high default emit rate
      // + start/stop would constantly emit; instead we call manualEmitCount.
      ps.emitRate = 0;
      ps.minEmitPower = 0.25;
      ps.maxEmitPower = 0.9;
      ps.gravity = new Vector3(0, -0.4, 0); // fall back after a moment
      ps.direction1 = new Vector3(-0.6, 1.0, -0.6);
      ps.direction2 = new Vector3(0.6, 1.6, 0.6);
      ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
      ps.updateSpeed = 0.016;
      ps.start();
      this.pool.push({ ps, emitterPos });
    }
  }

  /**
   * Reset the round-robin cursor and clear any in-flight particles. Called
   * by main.ts resetRun so a fresh run starts with the pool at slot 0 and
   * no leftover particles from the previous run still fading.
   */
  reset(): void {
    this.cursor = 0;
    for (const slot of this.pool) {
      slot.ps.reset();
    }
  }

  /**
   * Emit a puff at the given foot position (world XZ; Y is fixed at ground).
   */
  puff(x: number, z: number): void {
    if (!this.enabled) return;
    const slot = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.POOL_SIZE;
    slot.emitterPos.set(x, 0.05, z);
    slot.ps.manualEmitCount = 5;
  }

  dispose(): void {
    for (const slot of this.pool) { slot.ps.stop(); slot.ps.dispose(); }
    this.pool.length = 0;
    this.tex.dispose();
  }
}
