import { Scene } from "@babylonjs/core/scene";
import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture";
import { Rectangle } from "@babylonjs/gui/2D/controls/rectangle";
import { TextBlock } from "@babylonjs/gui/2D/controls/textBlock";
import { Control } from "@babylonjs/gui/2D/controls/control";

/**
 * Generic 3-card option picker — used by ShrinePicker, ShopPicker, and
 * BossCursePicker. Each option is a simple data row; the picker handles
 * layout, hover, click, and the async resolve.
 */
export interface PickerOption<T> {
  /** The data carried by the option; returned via the picker promise. */
  data: T;
  title: string;
  glyph: string;
  description: string;
  /** Optional secondary line (price, HP cost, etc.) */
  costLabel?: string;
  /** Title color override; default gold. */
  color?: string;
}

export class OptionPicker<T> {
  private ui: AdvancedDynamicTexture;
  private container: Rectangle;
  private cards: Rectangle[] = [];
  private isOpen = false;
  private resolve: ((picked: T | null) => void) | null = null;

  constructor(
    scene: Scene,
    private titleText: string,
    private uiId: string,
  ) {
    this.ui = AdvancedDynamicTexture.CreateFullscreenUI(uiId, true, scene);
    this.ui.idealWidth = 1920;

    this.container = new Rectangle(`${uiId}_overlay`);
    this.container.background = "#000000d8";
    this.container.thickness = 0;
    this.container.width = "100%";
    this.container.height = "100%";
    this.container.isVisible = false;
    this.container.isPointerBlocker = true;
    this.ui.addControl(this.container);

    const title = new TextBlock(`${uiId}_title`);
    title.text = titleText;
    title.color = "#ffe066";
    title.fontSize = 44;
    title.fontFamily = "monospace";
    title.fontWeight = "bold";
    title.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    title.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    title.topInPixels = 80;
    title.outlineColor = "#000";
    title.outlineWidth = 4;
    this.container.addControl(title);
  }

  setTitle(text: string): void {
    this.titleText = text;
    // Title is the second-added control (index 1 after the BG); update via index lookup.
    const t = this.container.children[1] as TextBlock | undefined;
    if (t) t.text = text;
  }

  open(options: PickerOption<T>[]): Promise<T | null> {
    if (this.isOpen) return Promise.resolve(null);
    this.isOpen = true;
    this.setTitle(this.titleText);
    for (const c of this.cards) c.dispose();
    this.cards.length = 0;

    const cardW = 320;
    const cardH = 460;
    const gap = 32;
    const totalW = options.length * cardW + (options.length - 1) * gap;

    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      const card = new Rectangle(`${this.uiId}_card_${i}`);
      card.widthInPixels = cardW;
      card.heightInPixels = cardH;
      card.cornerRadius = 12;
      card.thickness = 2;
      card.color = opt.color ?? "#ffe066";
      card.background = "#0a0e14";
      card.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
      card.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
      card.leftInPixels = -totalW / 2 + cardW / 2 + i * (cardW + gap);
      card.isPointerBlocker = true;

      const glyph = new TextBlock();
      glyph.text = opt.glyph;
      glyph.color = opt.color ?? "#ffe066";
      glyph.fontSize = 96;
      glyph.fontFamily = "monospace";
      glyph.topInPixels = -100;
      glyph.height = "120px";
      card.addControl(glyph);

      const titleTxt = new TextBlock();
      titleTxt.text = opt.title;
      titleTxt.color = opt.color ?? "#ffe066";
      titleTxt.fontSize = 26;
      titleTxt.fontFamily = "monospace";
      titleTxt.fontWeight = "bold";
      titleTxt.topInPixels = 30;
      titleTxt.height = "32px";
      card.addControl(titleTxt);

      const desc = new TextBlock();
      desc.text = opt.description;
      desc.color = "#dddddd";
      desc.fontSize = 14;
      desc.fontFamily = "monospace";
      desc.textWrapping = true;
      desc.lineSpacing = "3px";
      desc.widthInPixels = cardW - 28;
      desc.heightInPixels = 130;
      desc.topInPixels = 88;
      desc.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
      card.addControl(desc);

      if (opt.costLabel) {
        const cost = new TextBlock();
        cost.text = opt.costLabel;
        cost.color = "#ff7777";
        cost.fontSize = 18;
        cost.fontFamily = "monospace";
        cost.fontWeight = "bold";
        cost.topInPixels = 200;
        cost.height = "26px";
        card.addControl(cost);
      }

      card.onPointerEnterObservable.add(() => {
        card.background = "#152030";
      });
      card.onPointerOutObservable.add(() => {
        card.background = "#0a0e14";
      });
      card.onPointerClickObservable.add(() => {
        this.close(opt.data);
      });
      this.container.addControl(card);
      this.cards.push(card);
    }

    // Optional skip button — small grey row at the bottom.
    const skip = new Rectangle(`${this.uiId}_skip`);
    skip.widthInPixels = 200;
    skip.heightInPixels = 40;
    skip.cornerRadius = 6;
    skip.thickness = 1;
    skip.color = "#666";
    skip.background = "#000";
    skip.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    skip.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
    skip.topInPixels = -60;
    skip.isPointerBlocker = true;
    const skipText = new TextBlock();
    skipText.text = "Skip";
    skipText.color = "#aaa";
    skipText.fontSize = 18;
    skipText.fontFamily = "monospace";
    skip.addControl(skipText);
    skip.onPointerClickObservable.add(() => this.close(null));
    this.container.addControl(skip);
    this.cards.push(skip);

    this.container.isVisible = true;
    return new Promise((resolve) => { this.resolve = resolve; });
  }

  close(picked: T | null): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.container.isVisible = false;
    for (const c of this.cards) c.dispose();
    this.cards.length = 0;
    const r = this.resolve;
    this.resolve = null;
    if (r) r(picked);
  }

}
