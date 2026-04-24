import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture";
import { TextBlock } from "@babylonjs/gui/2D/controls/textBlock";

interface FloatingNumber {
  text: TextBlock;
  anchor: TransformNode;
  ttl: number;
  initialTtl: number;
  rise: number;
}

/** World-space damage popups using @babylonjs/gui linkWithMesh to follow a transient anchor node. */
export class DamageNumbers {
  private ui: AdvancedDynamicTexture;
  private active: FloatingNumber[] = [];

  constructor(private scene: Scene) {
    this.ui = AdvancedDynamicTexture.CreateFullscreenUI("damageUI", true, scene);
    this.ui.idealWidth = 1920;
  }

  spawn(worldPos: Vector3, amount: number, color = "#ffe066", crit = false): void {
    const anchor = new TransformNode(`dmgAnchor_${Date.now()}_${Math.random()}`, this.scene);
    anchor.position.copyFrom(worldPos);
    anchor.position.y += 1.6;
    // Small XZ jitter so multiple hits on one enemy don't stack on top of each other.
    const jitter = 0.6;
    anchor.position.x += (Math.random() * 2 - 1) * jitter;
    anchor.position.z += (Math.random() * 2 - 1) * jitter;

    const text = new TextBlock(`dmg_${Math.random()}`);
    // Crits (currently == kill hits) get the number PLUS a "KILL!" tag stacked
    // beneath. The \n line break + lineSpacing keeps both in the same control so
    // they rise and fade together.
    text.text = crit
      ? `${Math.round(amount)}\nKILL!`
      : Math.round(amount).toString();
    text.color = color;
    // Bigger numbers across the board so fights are always legible at any
    // camera distance — 32px base, 48px for kills.
    text.fontSize = crit ? 48 : 32;
    text.fontFamily = "monospace";
    text.fontWeight = "bold";
    text.shadowColor = "#000";
    text.shadowOffsetX = crit ? 4 : 3;
    text.shadowOffsetY = crit ? 4 : 3;
    text.shadowBlur = crit ? 6 : 4;
    // Thick black outline on every number — cuts through grass, walls, enemies.
    text.outlineColor = "#000000";
    text.outlineWidth = crit ? 5 : 4;
    text.lineSpacing = crit ? "-8px" : "0px";
    text.resizeToFit = true;
    this.ui.addControl(text);
    text.linkWithMesh(anchor);
    text.linkOffsetXInPixels = (Math.random() * 2 - 1) * 24;
    text.linkOffsetY = -10;

    this.active.push({
      text, anchor,
      ttl: crit ? 1.1 : 0.9,
      initialTtl: crit ? 1.1 : 0.9,
      rise: crit ? 2.0 : 1.6,
    });
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const n = this.active[i];
      n.ttl -= dt;
      if (n.ttl <= 0) {
        n.text.dispose();
        n.anchor.dispose();
        this.active.splice(i, 1);
        continue;
      }
      n.anchor.position.y += n.rise * dt;
      const t = n.ttl / n.initialTtl;
      n.text.alpha = Math.min(1, t * 1.4);
    }
  }

  /** Drop all floating numbers — for in-place run restart. */
  reset(): void {
    for (const n of this.active) {
      n.text.dispose();
      n.anchor.dispose();
    }
    this.active.length = 0;
  }

  dispose(): void {
    for (const n of this.active) {
      n.text.dispose();
      n.anchor.dispose();
    }
    this.active.length = 0;
    this.ui.dispose();
  }
}
