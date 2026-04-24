import { Scene } from "@babylonjs/core/scene";
import { Engine } from "@babylonjs/core/Engines/engine";
import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture";
import { TextBlock } from "@babylonjs/gui/2D/controls/textBlock";
import { Control } from "@babylonjs/gui/2D/controls/control";
import { Rectangle } from "@babylonjs/gui/2D/controls/rectangle";

/**
 * Minimal F3-toggleable frame-time overlay. Off by default. Shows rolling FPS,
 * frame time (ms), active mesh count, and draw calls if the engine exposes them.
 *
 * The overlay uses its own AdvancedDynamicTexture so it never fights the main
 * HUD for layout, and it samples via a private EMA so the number doesn't jitter
 * wildly frame to frame.
 */
export class DevOverlay {
  private ui: AdvancedDynamicTexture;
  private panel: Rectangle;
  private text: TextBlock;
  private visible = false;
  private fpsEma = 60;
  private frameMsEma = 16.67;
  private sampleCounter = 0;

  constructor(scene: Scene, private engine: Engine) {
    this.ui = AdvancedDynamicTexture.CreateFullscreenUI("devOverlayUI", true, scene);
    this.ui.idealWidth = 1920;

    this.panel = new Rectangle("devOverlayPanel");
    this.panel.widthInPixels = 260;
    this.panel.heightInPixels = 92;
    this.panel.background = "rgba(0, 0, 0, 0.62)";
    this.panel.color = "rgba(120, 240, 180, 0.6)";
    this.panel.thickness = 1;
    this.panel.cornerRadius = 4;
    this.panel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
    this.panel.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    this.panel.topInPixels = 16;
    this.panel.leftInPixels = -16;
    this.panel.isVisible = false;
    this.ui.addControl(this.panel);

    this.text = new TextBlock("devOverlayText");
    this.text.fontFamily = "ui-monospace, Consolas, monospace";
    this.text.fontSize = 14;
    this.text.color = "#aaffcc";
    this.text.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    this.text.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    this.text.paddingLeft = "10px";
    this.text.paddingTop = "6px";
    this.text.text = "";
    this.panel.addControl(this.text);

    // F3 toggle — window-level listener so it works regardless of focus.
    window.addEventListener("keydown", (e) => {
      if (e.key === "F3") {
        e.preventDefault();
        this.toggle();
      }
    });
  }

  toggle(): void {
    this.visible = !this.visible;
    this.panel.isVisible = this.visible;
  }

  /** Call from the render loop. Cheap when hidden. */
  update(realDt: number): void {
    if (!this.visible) return;
    // EMA so the numbers don't jitter wildly. Alpha 0.1 = ~6 frames of memory.
    const instantFps = realDt > 0 ? 1 / realDt : 60;
    this.fpsEma += (instantFps - this.fpsEma) * 0.1;
    this.frameMsEma += (realDt * 1000 - this.frameMsEma) * 0.1;

    // Sample the heavier-to-compute fields less often (every ~6 frames) to keep
    // the overlay from becoming its own perf cost.
    this.sampleCounter++;
    if (this.sampleCounter % 6 !== 0) return;

    const scene = this.engine.scenes[0];
    const activeMeshes = scene ? scene.getActiveMeshes().length : 0;
    // engine.drawCalls isn't a public API on all versions; fall back gracefully.
    const drawCalls = (this.engine as unknown as { drawCalls?: { current?: number } }).drawCalls?.current
      ?? (this.engine as unknown as { _drawCalls?: { current?: number } })._drawCalls?.current
      ?? 0;

    this.text.text =
      `FPS       ${this.fpsEma.toFixed(0).padStart(4)}\n` +
      `frame     ${this.frameMsEma.toFixed(2).padStart(6)} ms\n` +
      `meshes    ${String(activeMeshes).padStart(4)}\n` +
      `drawCalls ${String(drawCalls).padStart(4)}`;
  }

  dispose(): void {
    this.ui.dispose();
  }
}
