import { Scene } from "@babylonjs/core/scene";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Mesh } from "@babylonjs/core/Meshes/mesh";

/**
 * Hot-orange particle vortex around the sword at CRITICAL tempo. The single
 * ParticleSystem is parented to the sword mesh so it tracks the swing for
 * free; intensity is driven by setIntensity(0..1) which scales emit rate
 * + alpha so we can fade in/out smoothly at zone transitions.
 *
 * Off entirely below CRITICAL — costs nothing during normal play.
 */
export class SwordAura {
  private ps: ParticleSystem;
  private tex: Texture;
  private intensity = 0;
  private targetIntensity = 0;
  private readonly MAX_EMIT = 80;

  constructor(scene: Scene, swordMesh: Mesh) {
    const dt = new DynamicTexture("swordAuraTex", { width: 32, height: 32 }, scene, false);
    const ctx = dt.getContext();
    const grad = ctx.createRadialGradient(16, 16, 1, 16, 16, 14);
    grad.addColorStop(0, "rgba(255,255,235,1)");
    grad.addColorStop(0.5, "rgba(255,180,80,0.7)");
    grad.addColorStop(1, "rgba(255,100,30,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);
    dt.update();
    this.tex = dt;

    this.ps = new ParticleSystem("swordAura", 120, scene);
    this.ps.particleTexture = this.tex;
    // Emit from along the sword's length — local-space box matching the blade
    // which extends -Y from the hand. The sword box is 1.35m tall with origin
    // at the hand and `position.y = -1.55`, so the local emit volume covers it.
    this.ps.emitter = swordMesh;
    this.ps.minEmitBox = new Vector3(-0.06, -2.2, -0.03);
    this.ps.maxEmitBox = new Vector3(0.06, -0.4, 0.03);
    this.ps.color1 = new Color4(1.0, 0.85, 0.4, 0.9);
    this.ps.color2 = new Color4(1.0, 0.45, 0.15, 0.9);
    this.ps.colorDead = new Color4(0.6, 0.15, 0.05, 0);
    this.ps.minSize = 0.06;
    this.ps.maxSize = 0.18;
    this.ps.minLifeTime = 0.18;
    this.ps.maxLifeTime = 0.42;
    this.ps.emitRate = 0; // gated by setIntensity
    this.ps.minEmitPower = 0.2;
    this.ps.maxEmitPower = 0.6;
    this.ps.gravity = new Vector3(0, 0.5, 0); // slight upward drift — embers rise
    this.ps.direction1 = new Vector3(-0.4, 0.6, -0.4);
    this.ps.direction2 = new Vector3(0.4, 1.2, 0.4);
    this.ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    this.ps.updateSpeed = 0.016;
    this.ps.start();
  }

  /** Target intensity 0..1. The actual emit rate lerps toward target each tick. */
  setTargetIntensity(t: number): void {
    this.targetIntensity = Math.max(0, Math.min(1, t));
  }

  /**
   * Per-frame tick — eases intensity toward target so zone enter/exit fades
   * the aura smoothly instead of snapping it on/off.
   */
  tick(dt: number): void {
    const k = 1 - Math.exp(-6 * dt);
    this.intensity += (this.targetIntensity - this.intensity) * k;
    this.ps.emitRate = this.MAX_EMIT * this.intensity;
  }

  reset(): void {
    this.intensity = 0;
    this.targetIntensity = 0;
    this.ps.emitRate = 0;
    this.ps.reset();
  }

  dispose(): void {
    this.ps.stop();
    this.ps.dispose();
    this.tex.dispose();
  }
}
