import { Scene } from "@babylonjs/core/scene";
import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture";
import { Rectangle } from "@babylonjs/gui/2D/controls/rectangle";
import { TextBlock } from "@babylonjs/gui/2D/controls/textBlock";
import { Control } from "@babylonjs/gui/2D/controls/control";

export class IntroScreen {
  private ui: AdvancedDynamicTexture;
  private overlay: Rectangle;
  private dismissed = false;
  private resolveFn: (() => void) | null = null;

  constructor(scene: Scene) {
    this.ui = AdvancedDynamicTexture.CreateFullscreenUI("introUI", true, scene);
    this.ui.idealWidth = 1920;

    this.overlay = new Rectangle("introOverlay");
    this.overlay.background = "#000c";
    this.overlay.thickness = 0;
    this.overlay.width = "100%";
    this.overlay.height = "100%";
    this.ui.addControl(this.overlay);

    const title = new TextBlock("introTitle");
    title.text = "ROGUE HERO 3";
    title.color = "#ffcc44";
    title.fontSize = 96;
    title.fontFamily = "monospace";
    title.fontWeight = "bold";
    title.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    title.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    title.topInPixels = -120;
    title.shadowColor = "#000";
    title.shadowOffsetX = 4;
    title.shadowOffsetY = 4;
    this.overlay.addControl(title);

    const subtitle = new TextBlock("introSubtitle");
    subtitle.text = "Vertical slice MVP — Blade vs Brawler";
    subtitle.color = "#aaa";
    subtitle.fontSize = 22;
    subtitle.fontFamily = "monospace";
    subtitle.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    subtitle.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    subtitle.topInPixels = -50;
    this.overlay.addControl(subtitle);

    const controls = new TextBlock("introControls");
    controls.text =
      "WASD move   |   Mouse aims (gold ring on floor)   |   LMB swing\n" +
      "Hold RMB to orbit camera   |   Mouse wheel zoom\n" +
      "Space / Shift dodge (i-frames)\n" +
      "1 / 2 / 3 / 4  play card   |   F  manual crash (Tempo ≥ 85)\n" +
      "R restart on Defeat or Victory";
    controls.color = "#ddd";
    controls.fontSize = 20;
    controls.fontFamily = "monospace";
    controls.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    controls.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    controls.topInPixels = 60;
    this.overlay.addControl(controls);

    const press = new TextBlock("introPress");
    press.text = "[ click or press any key to begin ]";
    press.color = "#ffe066";
    press.fontSize = 22;
    press.fontFamily = "monospace";
    press.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    press.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    press.topInPixels = 200;
    this.overlay.addControl(press);

    // Pulse the press text
    let t = 0;
    scene.onBeforeRenderObservable.add(() => {
      t += scene.getEngine().getDeltaTime() / 1000;
      press.alpha = 0.5 + 0.5 * Math.sin(t * 4);
    });

    const dismiss = () => this.dismiss();
    window.addEventListener("keydown", dismiss, { once: true });
    this.overlay.onPointerClickObservable.add(dismiss);
  }

  /** Resolves once the user dismisses the intro. */
  wait(): Promise<void> {
    if (this.dismissed) return Promise.resolve();
    return new Promise((res) => {
      this.resolveFn = res;
    });
  }

  private dismiss(): void {
    if (this.dismissed) return;
    this.dismissed = true;
    this.overlay.isVisible = false;
    this.ui.dispose();
    if (this.resolveFn) this.resolveFn();
  }
}
