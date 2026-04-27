import { Scene } from "@babylonjs/core/scene";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Player } from "../player/Player";
import { ItemManager } from "../items/ItemManager";
import { TempoSystem } from "../tempo/TempoSystem";

/**
 * Visual tells for the three slice relics.
 *
 *  - **Runaway**: cyan motion trail behind the player while moving AND tempo
 *    ≥ 70 (i.e. while the relic's no-decay clause is active). Quick visual
 *    confirmation of the "free zone" state.
 *
 *  - **Berserker Heart**: player body emissive ramps toward red as HP drops.
 *    Mechanics-wise the relic changes crash reset to 80 (RH2 bug-04), so
 *    pairing it with a visible "enraged when hurt" tell teaches the concept.
 *
 *  - **Metronome**: small HUD tick added by Hud.ts — NOT handled here because
 *    it's a UI-only change. This module owns the 3D-space tells.
 *
 * Perf: the trail is a single particle system attached to the player root.
 * Emit rate drops to zero when the relic isn't active or the player isn't
 * moving, so the particle cost is only paid when visible.
 */
export class RelicAuras {
  private runawayTrail: ParticleSystem;
  private tex: Texture;
  private wasRunawayActive = false;

  constructor(scene: Scene, private player: Player) {
    // Shared soft-glow sprite — reused by the trail; created once per session.
    const dt = new DynamicTexture("relicTrailTex", { width: 32, height: 32 }, scene, false);
    const ctx = dt.getContext();
    const grad = ctx.createRadialGradient(16, 16, 1, 16, 16, 14);
    grad.addColorStop(0, "rgba(180,240,255,1)");
    grad.addColorStop(0.5, "rgba(120,200,255,0.55)");
    grad.addColorStop(1, "rgba(40,120,220,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);
    dt.update();
    this.tex = dt;

    this.runawayTrail = new ParticleSystem("runawayTrail", 90, scene);
    this.runawayTrail.particleTexture = this.tex;
    this.runawayTrail.emitter = player.root as unknown as import("@babylonjs/core/Meshes/abstractMesh").AbstractMesh;
    this.runawayTrail.minEmitBox = new Vector3(-0.3, 0.2, -0.3);
    this.runawayTrail.maxEmitBox = new Vector3(0.3, 1.2, 0.3);
    this.runawayTrail.color1 = new Color4(0.5, 0.9, 1.0, 0.9);
    this.runawayTrail.color2 = new Color4(0.2, 0.6, 1.0, 0.6);
    this.runawayTrail.colorDead = new Color4(0.1, 0.3, 0.8, 0);
    this.runawayTrail.minSize = 0.08;
    this.runawayTrail.maxSize = 0.24;
    this.runawayTrail.minLifeTime = 0.25;
    this.runawayTrail.maxLifeTime = 0.55;
    this.runawayTrail.emitRate = 0; // driven by update()
    this.runawayTrail.minEmitPower = 0;
    this.runawayTrail.maxEmitPower = 0.3;
    this.runawayTrail.gravity = new Vector3(0, 0.2, 0);
    this.runawayTrail.blendMode = ParticleSystem.BLENDMODE_ADD;
    this.runawayTrail.updateSpeed = 0.016;
    this.runawayTrail.start();
  }

  /**
   * Called each frame with whichever relics are equipped + current tempo value.
   * `movingSpeed` is the magnitude of the player's movement vector this frame
   * (not per-second — just "is moving").
   */
  tick(_dt: number, items: ItemManager, tempo: TempoSystem, movingSpeed: number): void {
    // Runaway trail — only while equipped, moving, and in the "no-decay" zone.
    const runawayActive = items.has("runaway") && tempo.value >= 70 && movingSpeed > 0.05 && !this.player.isDodging;
    this.runawayTrail.emitRate = runawayActive ? 120 : 0;
    if (runawayActive !== this.wasRunawayActive) {
      this.wasRunawayActive = runawayActive;
      // Nothing extra — the emit rate flip handles it — but having this branch
      // makes it cheap to add an intro/outro effect later.
    }

    // Berserker Heart — ramp body emissive toward red as HP falls. The base
    // emissive is near-black; we interpolate toward a hot red at 0 HP.
    if (items.has("berserker_heart")) {
      const hpRatio = Math.max(0, this.player.hp / this.player.stats.maxHp);
      const inverted = 1 - hpRatio; // 0 at full, 1 at death
      this.player.bodyMat.emissiveColor.set(
        0.05 + 0.85 * inverted,
        0.05 + 0.05 * inverted,
        0.02,
      );
    } else {
      // No Berserker — drive emissive from tempo so the body still visibly
      // powers up at HOT/CRITICAL even without the relic. Quadratic ramp from
      // tempo 70 to 100 means COLD/FLOWING stay subtle, then the hero starts
      // glowing as they enter the zone. Pairs with the existing sword
      // emissive ramp (main.ts) so the whole rig warms together.
      const tEm = Math.max(0, Math.min(1, (tempo.value - 70) / 30));
      const punch = 0.05 + 0.15 * tEm * tEm;
      this.player.bodyMat.emissiveColor.set(punch, punch * 0.85, 0.02 + punch * 0.10);
    }
  }

  reset(): void {
    this.runawayTrail.emitRate = 0;
    this.wasRunawayActive = false;
    this.player.bodyMat.emissiveColor.set(0.05, 0.05, 0.02);
  }

  dispose(): void {
    this.runawayTrail.stop();
    this.runawayTrail.dispose();
    this.tex.dispose();
  }
}
