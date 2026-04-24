import { Scene } from "@babylonjs/core/scene";
import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture";
import { Rectangle } from "@babylonjs/gui/2D/controls/rectangle";
import { Control } from "@babylonjs/gui/2D/controls/control";
import { Enemy } from "../enemies/Enemy";

interface PipBar {
  bg: Rectangle;
  fill: Rectangle;
  ownerId: string;
}

/**
 * Small world-space HP bar anchored above each alive mob. Hidden when HP is full
 * and skipped entirely for bosses (which use the top-center boss bar in Hud).
 *
 * Perf: one AdvancedDynamicTexture shared across all pips. Pool of PipBar records
 * reused when enemies die/respawn — no GUI control churn per frame.
 */
export class EnemyHealthPips {
  private ui: AdvancedDynamicTexture;
  private pool: PipBar[] = [];
  private active = new Map<string, PipBar>();

  constructor(scene: Scene) {
    this.ui = AdvancedDynamicTexture.CreateFullscreenUI("enemyHpUI", true, scene);
    this.ui.idealWidth = 1920;
    // Pip controls live on a separate ADT so their invalidation doesn't thrash
    // the main HUD texture.
  }

  /** Called each frame with the current enemy list. */
  update(enemies: Enemy[]): void {
    // Mark all as stale, then re-adopt any enemy still alive + not full HP + not boss.
    const seen = new Set<string>();
    for (const e of enemies) {
      if (!e.alive) continue;
      if (e.def.name.startsWith("boss_")) continue;
      const ratio = e.hp / e.def.hp;
      if (ratio >= 0.999) continue; // hide at full HP so the world stays clean pre-combat
      seen.add(e.id);
      let rec = this.active.get(e.id);
      if (!rec) {
        rec = this.take(e.id);
        this.active.set(e.id, rec);
        rec.bg.linkWithMesh(e.root as unknown as import("@babylonjs/core/Meshes/abstractMesh").AbstractMesh);
        rec.bg.linkOffsetY = -70;
      }
      // Fill width shrinks as HP falls. 80px full; 4px edge padding matches the bg.
      const clamped = Math.max(0, Math.min(1, ratio));
      rec.fill.widthInPixels = 76 * clamped;
      // Color shifts from green → amber → red as HP drops.
      if (ratio > 0.6) rec.fill.background = "#66dd55";
      else if (ratio > 0.3) rec.fill.background = "#ffb03a";
      else rec.fill.background = "#ff3b3b";
    }
    // Retire any pips whose enemy is gone or full-HP this frame.
    for (const [id, rec] of this.active) {
      if (!seen.has(id)) {
        rec.bg.linkWithMesh(null);
        rec.bg.isVisible = false;
        this.pool.push(rec);
        this.active.delete(id);
      } else {
        rec.bg.isVisible = true;
      }
    }
  }

  private take(id: string): PipBar {
    const pooled = this.pool.pop();
    if (pooled) {
      pooled.ownerId = id;
      return pooled;
    }
    const bg = new Rectangle(`pip_${id}_bg`);
    bg.widthInPixels = 80;
    bg.heightInPixels = 6;
    bg.background = "#1a0606cc";
    bg.color = "#00000088";
    bg.thickness = 1;
    bg.cornerRadius = 2;
    bg.isPointerBlocker = false;
    bg.isHitTestVisible = false;
    this.ui.addControl(bg);

    const fill = new Rectangle(`pip_${id}_fill`);
    fill.widthInPixels = 76;
    fill.heightInPixels = 3;
    fill.background = "#66dd55";
    fill.thickness = 0;
    fill.cornerRadius = 1;
    fill.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    fill.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    fill.leftInPixels = 2;
    bg.addControl(fill);

    return { bg, fill, ownerId: id };
  }

  /** Drop everything — for in-place run restart. */
  reset(): void {
    for (const rec of this.active.values()) {
      rec.bg.linkWithMesh(null);
      rec.bg.isVisible = false;
      this.pool.push(rec);
    }
    this.active.clear();
  }

  dispose(): void {
    this.active.clear();
    this.pool.length = 0;
    this.ui.dispose();
  }
}
