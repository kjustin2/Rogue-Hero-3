import { Scene } from "@babylonjs/core/scene";
import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture";
import { Rectangle } from "@babylonjs/gui/2D/controls/rectangle";
import { TextBlock } from "@babylonjs/gui/2D/controls/textBlock";
import { Control } from "@babylonjs/gui/2D/controls/control";
import { Vector3, Matrix } from "@babylonjs/core/Maths/math.vector";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { RunNode } from "../run/RunMap";

const KIND_LABELS: Record<RunNode["kind"], string> = {
  start: "START",
  combat: "COMBAT",
  elite: "ELITE",
  shrine: "SHRINE",
  shop: "SHOP",
  boss: "BOSS",
};

const KIND_COLORS: Record<RunNode["kind"], string> = {
  start: "#a8ffd2",
  combat: "#ffaa44",
  elite: "#ff5566",
  shrine: "#aa88ff",
  shop: "#66e0ff",
  boss: "#ffd640",
};

interface DoorLabel {
  bg: Rectangle;
  title: TextBlock;
  subtitle: TextBlock;
  /** World-space anchor: the door's xCenter (XZ plane); we project to 2D each frame. */
  worldX: number;
  worldZ: number;
  /** True while the label should be drawn. */
  visible: boolean;
}

/**
 * Floating overlay above each door previewing the next-room kind. Hidden
 * until the room clears (door unlocked) and the run is in map mode. Uses
 * the same shared GUI ADT as the rest of the HUD if reused; here we own a
 * dedicated layer so the labels project correctly without conflicting with
 * the HUD's screen-space layout.
 */
export class DoorChoiceHud {
  private gui: AdvancedDynamicTexture;
  private labels: DoorLabel[] = [];
  private active = false;

  constructor(private scene: Scene) {
    this.gui = AdvancedDynamicTexture.CreateFullscreenUI("doorChoiceUI", true, scene);
    this.gui.idealWidth = 1920;
    this.gui.useSmallestIdeal = true;
  }

  /**
   * Set up labels for the current door choices. `doorXCenters` and `nodes`
   * must be parallel arrays — one node per door, in left-to-right order.
   */
  setChoices(doorXCenters: number[], nodes: RunNode[], doorZ: number): void {
    this.clear();
    if (doorXCenters.length !== nodes.length) {
      // Mismatch: skip; no labels rather than risk wrong-door routing.
      this.active = false;
      return;
    }
    for (let i = 0; i < doorXCenters.length; i++) {
      this.labels.push(this.makeLabel(nodes[i], doorXCenters[i], doorZ));
    }
    this.active = true;
  }

  private makeLabel(node: RunNode, worldX: number, worldZ: number): DoorLabel {
    const bg = new Rectangle();
    bg.widthInPixels = 200;
    bg.heightInPixels = 60;
    bg.color = KIND_COLORS[node.kind];
    bg.thickness = 2;
    bg.cornerRadius = 6;
    bg.background = "rgba(8,12,16,0.72)";
    bg.alpha = 0; // fades in on show
    bg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    bg.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;

    const title = new TextBlock();
    title.text = KIND_LABELS[node.kind];
    title.color = KIND_COLORS[node.kind];
    title.fontSize = 18;
    title.fontWeight = "bold";
    title.fontFamily = "monospace";
    title.topInPixels = -10;
    title.height = "30px";
    bg.addControl(title);

    const subtitle = new TextBlock();
    subtitle.text = node.riskTier === "elite_dense" ? "RISK · 2× REWARDS" : node.descriptor?.name ?? "";
    subtitle.color = node.riskTier === "elite_dense" ? "#ff5566" : "#dddddd";
    subtitle.fontSize = 12;
    subtitle.fontFamily = "monospace";
    subtitle.topInPixels = 14;
    subtitle.height = "20px";
    bg.addControl(subtitle);

    this.gui.addControl(bg);
    return { bg, title, subtitle, worldX, worldZ, visible: false };
  }

  /** Tick — projects the label to screen space above each door head height. */
  update(_dt: number, camera: Camera): void {
    if (!this.active) return;
    const engine = this.scene.getEngine();
    const sw = engine.getRenderWidth();
    const sh = engine.getRenderHeight();
    const ratio = (sh > 0 && this.gui.idealHeight > 0) ? this.gui.idealHeight / sh : 1.0;
    for (const lbl of this.labels) {
      const w = Vector3.Project(
        new Vector3(lbl.worldX, 5.5, lbl.worldZ),
        Matrix.Identity(),
        this.scene.getTransformMatrix(),
        camera.viewport.toGlobal(sw, sh),
      );
      // Convert to GUI ideal space.
      lbl.bg.leftInPixels = (w.x - sw / 2) * ratio - 100;
      lbl.bg.topInPixels = (w.y - sh / 2) * ratio - 80;
      // Behind camera or off-screen → hide.
      const onScreen = w.z >= 0 && w.z <= 1 && w.x >= 0 && w.x <= sw && w.y >= 0 && w.y <= sh;
      const targetAlpha = onScreen ? 1.0 : 0.0;
      lbl.bg.alpha += (targetAlpha - lbl.bg.alpha) * Math.min(1, _dt * 6);
    }
  }

  /** Hide and dispose all current labels. */
  clear(): void {
    for (const lbl of this.labels) lbl.bg.dispose();
    this.labels = [];
    this.active = false;
  }

  dispose(): void {
    this.clear();
    this.gui.dispose();
  }
}
