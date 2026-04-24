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
    n.text.fontSize = crit ? 48 : 32;
    n.text.shadowOffsetX = crit ? 4 : 3;
    n.text.shadowOffsetY = crit ? 4 : 3;
    n.text.shadowBlur = crit ? 6 : 4;
    n.text.outlineWidth = crit ? 5 : 4;
    n.text.lineSpacing = crit ? "-8px" : "0px";
    n.text.linkOffsetXInPixels = (Math.random() * 2 - 1) * 24;
    n.text.linkOffsetY = -10;
    n.text.alpha = 1;
    n.text.isVisible = true;

    const life = crit ? 1.1 : 0.9;
    n.totalRise = (crit ? 2.0 : 1.6) * life;
    n.ttl = life;
    n.initialTtl = life;
    n.startY = n.anchor.position.y;
    n.active = true;
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
