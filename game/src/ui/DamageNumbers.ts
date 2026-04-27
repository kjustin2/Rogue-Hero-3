import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture";
import { TextBlock } from "@babylonjs/gui/2D/controls/textBlock";

interface PooledNumber {
  text: TextBlock;
  anchor: TransformNode;
  ttl: number;
  initialTtl: number;
  totalRise: number;
  startY: number;
  active: boolean;
  /** Whether this is a crit/kill popup — drives the per-frame X-wobble in update. */
  crit: boolean;
  /** Resting X offset from the spawn jitter — wobble composes around this. */
  baseOffsetX: number;
}

/**
 * Pooled world-space damage popups. Pre-allocates 16 anchor + TextBlock pairs
 * at boot — spawn() acquires the oldest free slot and re-skins it. When all
 * slots are busy, the oldest active one is recycled (so a flurry of hits
 * never stalls; the earliest popup just disappears a bit early).
 *
 * Previously each hit allocated a fresh TransformNode + TextBlock and disposed
 * them on expire — at 5–50 hits per phase that was a steady GC churn source.
 */
export class DamageNumbers {
  private ui: AdvancedDynamicTexture;
  private readonly POOL_SIZE = 16;
  private pool: PooledNumber[] = [];

  constructor(private scene: Scene) {
    this.ui = AdvancedDynamicTexture.CreateFullscreenUI("damageUI", true, scene);
    this.ui.idealWidth = 1920;
    for (let i = 0; i < this.POOL_SIZE; i++) this.pool.push(this.allocate(i));
  }

  private allocate(idx: number): PooledNumber {
    const anchor = new TransformNode(`dmgAnchor_${idx}`, this.scene);
    const text = new TextBlock(`dmg_${idx}`);
    text.fontFamily = "monospace";
    text.fontWeight = "bold";
    text.shadowColor = "#000";
    text.outlineColor = "#000000";
    text.resizeToFit = true;
    text.isVisible = false;
    this.ui.addControl(text);
    text.linkWithMesh(anchor);
    return {
      text,
      anchor,
      ttl: 0,
      initialTtl: 0,
      totalRise: 0,
      startY: 0,
      active: false,
      crit: false,
      baseOffsetX: 0,
    };
  }

  private acquire(): PooledNumber {
    // Prefer a free slot.
    for (const n of this.pool) if (!n.active) return n;
    // All slots active — recycle the one with the least time left.
    let oldest = this.pool[0];
    for (const n of this.pool) if (n.ttl < oldest.ttl) oldest = n;
    return oldest;
  }

  spawn(worldPos: Vector3, amount: number, color = "#ffe066", crit = false): void {
    const n = this.acquire();
    n.anchor.position.copyFrom(worldPos);
    n.anchor.position.y += 1.6;
    // Small XZ jitter so multiple hits on one enemy don't stack on top of each other.
    const jitter = 0.6;
    n.anchor.position.x += (Math.random() * 2 - 1) * jitter;
    n.anchor.position.z += (Math.random() * 2 - 1) * jitter;

    // Crits (currently == kill hits) get the number PLUS a "KILL!" tag stacked
    // beneath. The \n line break + lineSpacing keeps both in the same control so
    // they rise and fade together.
    n.text.text = crit
      ? `${Math.round(amount)}\nKILL!`
      : Math.round(amount).toString();
    n.text.color = color;
    // Scale font with damage amount — small hits stay readable, big hits
    // dominate the screen briefly. Capped so a 200dmg crit doesn't take up
    // the whole field. crit baseline is bigger than non-crit baseline.
    const baseSize = crit ? 48 : 32;
    const dmgBoost = Math.min(crit ? 28 : 20, Math.max(0, (amount - 10) * 0.6));
    n.text.fontSize = baseSize + dmgBoost;
    n.text.shadowOffsetX = crit ? 4 : 3;
    n.text.shadowOffsetY = crit ? 4 : 3;
    n.text.shadowBlur = crit ? 6 : 4;
    n.text.outlineWidth = crit ? 5 : 4;
    n.text.lineSpacing = crit ? "-8px" : "0px";
    n.baseOffsetX = (Math.random() * 2 - 1) * 24;
    n.text.linkOffsetXInPixels = n.baseOffsetX;
    n.text.linkOffsetY = -10;
    n.text.alpha = 1;
    n.text.isVisible = true;

    // Crits get a sharper, faster ride: bigger rise, slightly longer life
    // already tuned via font size above. Scaling pop is applied in update via
    // resizeToFit fontSize ease — handled there so it's frame-rate independent.
    const life = crit ? 1.1 : 0.9;
    n.totalRise = (crit ? 2.0 : 1.6) * life;
    n.ttl = life;
    n.initialTtl = life;
    n.startY = n.anchor.position.y;
    n.active = true;
    n.crit = crit;
  }

  /**
   * Convenience overload for player-damage-taken popups: red-tinted.
   */
  spawnPlayerHit(worldPos: Vector3, amount: number): void {
    this.spawn(worldPos, amount, "#ff5555", false);
  }

  update(dt: number): void {
    for (const n of this.pool) {
      if (!n.active) continue;
      n.ttl -= dt;
      if (n.ttl <= 0) {
        n.active = false;
        n.text.isVisible = false;
        continue;
      }
      // Ease-out rise: y = startY + maxRise * (1 - (1-u)^2). Kept identical
      // to the previous tween — pooling is invisible in the visual.
      const u = 1 - n.ttl / n.initialTtl;
      const easedU = 1 - (1 - u) * (1 - u);
      n.anchor.position.y = n.startY + n.totalRise * easedU;
      const t = n.ttl / n.initialTtl;
      n.text.alpha = Math.min(1, t * 1.4);
      // Crit pop — horizontal wobble that decays with the popup so the read is
      // a sharp shake on impact, then a clean rise. Composes around the resting
      // baseOffsetX so the random spawn jitter is preserved.
      if (n.crit) {
        const decay = t * t; // fade the shake in the tail
        const wobble = Math.sin((n.initialTtl - n.ttl) * 38) * 6 * decay;
        n.text.linkOffsetXInPixels = n.baseOffsetX + wobble;
      }
    }
  }

  /** Drop all floating numbers — for in-place run restart. */
  reset(): void {
    for (const n of this.pool) {
      n.active = false;
      n.text.isVisible = false;
    }
  }

  dispose(): void {
    for (const n of this.pool) {
      n.text.dispose();
      n.anchor.dispose();
    }
    this.pool.length = 0;
    this.ui.dispose();
  }
}
