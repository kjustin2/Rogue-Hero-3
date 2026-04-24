import { Scene } from "@babylonjs/core/scene";
import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture";
import { Rectangle } from "@babylonjs/gui/2D/controls/rectangle";
import { TextBlock } from "@babylonjs/gui/2D/controls/textBlock";
import { Control } from "@babylonjs/gui/2D/controls/control";
import { ItemDef } from "../items/ItemDefinitions";

export class RewardPicker {
  ui: AdvancedDynamicTexture;
  private container: Rectangle;
  private cards: Rectangle[] = [];
  private isOpen = false;
  private resolve: ((picked: ItemDef | null) => void) | null = null;

  constructor(scene: Scene) {
    this.ui = AdvancedDynamicTexture.CreateFullscreenUI("rewardUI", true, scene);
    this.ui.idealWidth = 1920;

    this.container = new Rectangle("rewardOverlay");
    this.container.background = "#000a";
    this.container.thickness = 0;
    this.container.width = "100%";
    this.container.height = "100%";
    this.container.isVisible = false;
    // Block all clicks so they don't pass through to the canvas (no stray attacks
    // / aim updates while the picker is up).
    this.container.isPointerBlocker = true;
    this.ui.addControl(this.container);

    const title = new TextBlock("rewardTitle");
    title.text = "Choose a Relic";
    title.color = "#ffe066";
    title.fontSize = 44;
    title.fontFamily = "monospace";
    title.fontWeight = "bold";
    title.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    title.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    title.topInPixels = 80;
    title.shadowColor = "#000";
    title.shadowOffsetX = 2;
    title.shadowOffsetY = 2;
    this.container.addControl(title);
  }

  /** Open the picker with three options. Returns a Promise resolved with the picked def (or null if dismissed). */
  open(options: ItemDef[]): Promise<ItemDef | null> {
    if (this.isOpen) return Promise.resolve(null);
    this.isOpen = true;

    // Clear old cards
    for (const c of this.cards) c.dispose();
    this.cards.length = 0;

    // Larger cards with explicit-height sections so name / rarity / desc can
    // never overlap. The old layout had every TextBlock auto-fill the card,
    // which stacked name on top of desc once Babylon's vertical alignment
    // rules placed both near the center.
    const cardW = 380;
    const cardH = 300;
    const spacing = 36;
    const totalW = options.length * cardW + (options.length - 1) * spacing;
    const startX = -totalW / 2 + cardW / 2;

    // Layout bands (all top-anchored so they don't compete with center-align math):
    //   y  14– 34: rarity badge (14px)
    //   y  44– 82: card name (28px)
    //   y  90– 94: thin divider line
    //   y 102–252: description (wrapped, 16px, up to ~9 lines of vertical room)
    //   y 260–284: "Click to take" hint
    const RARITY_Y = 14, RARITY_H = 20;
    const NAME_Y = 44, NAME_H = 40;
    const DIV_Y = 90;
    const DESC_Y = 102, DESC_H = cardH - DESC_Y - 40;
    const HINT_FROM_BOTTOM = 16;

    options.forEach((opt, i) => {
      const card = new Rectangle(`reward_${i}`);
      card.widthInPixels = cardW;
      card.heightInPixels = cardH;
      card.background = "#181820";
      card.color = opt.color;
      card.thickness = 3;
      card.cornerRadius = 10;
      card.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
      card.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
      card.leftInPixels = startX + i * (cardW + spacing);
      card.isPointerBlocker = true;
      card.hoverCursor = "pointer";
      this.container.addControl(card);

      const rarity = new TextBlock(`reward_${i}_rarity`);
      rarity.text = opt.rarity.toUpperCase();
      rarity.color = "#bbbbbb";
      rarity.fontSize = 13;
      rarity.fontFamily = "monospace";
      rarity.fontWeight = "bold";
      rarity.widthInPixels = cardW - 24;
      rarity.heightInPixels = RARITY_H;
      rarity.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
      rarity.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
      rarity.topInPixels = RARITY_Y;
      rarity.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
      rarity.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
      card.addControl(rarity);

      const name = new TextBlock(`reward_${i}_name`);
      name.text = opt.name;
      name.color = opt.color;
      name.fontSize = 28;
      name.fontFamily = "monospace";
      name.fontWeight = "bold";
      name.widthInPixels = cardW - 24;
      name.heightInPixels = NAME_H;
      name.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
      name.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
      name.topInPixels = NAME_Y;
      name.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
      name.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
      name.shadowColor = "#000";
      name.shadowOffsetX = 2;
      name.shadowOffsetY = 2;
      card.addControl(name);

      // Thin divider — separates the heading block from the description.
      const divider = new Rectangle(`reward_${i}_div`);
      divider.widthInPixels = cardW - 80;
      divider.heightInPixels = 2;
      divider.background = opt.color;
      divider.thickness = 0;
      divider.alpha = 0.4;
      divider.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
      divider.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
      divider.topInPixels = DIV_Y;
      card.addControl(divider);

      const desc = new TextBlock(`reward_${i}_desc`);
      desc.text = opt.desc;
      desc.color = "#eeeeee";
      desc.fontSize = 15;
      desc.fontFamily = "monospace";
      desc.textWrapping = true;
      desc.lineSpacing = "4px";
      desc.widthInPixels = cardW - 44;
      desc.heightInPixels = DESC_H;
      desc.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
      desc.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
      desc.topInPixels = DESC_Y;
      desc.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
      desc.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
      card.addControl(desc);

      const hint = new TextBlock(`reward_${i}_hint`);
      hint.text = "[ Click to take ]";
      hint.color = "#888";
      hint.fontSize = 13;
      hint.fontFamily = "monospace";
      hint.widthInPixels = cardW;
      hint.heightInPixels = 20;
      hint.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
      hint.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
      hint.topInPixels = -HINT_FROM_BOTTOM;
      hint.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
      hint.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
      card.addControl(hint);

      card.onPointerEnterObservable.add(() => {
        card.background = "#222230";
      });
      card.onPointerOutObservable.add(() => {
        card.background = "#181820";
      });
      card.onPointerClickObservable.add(() => {
        this.close(opt);
      });

      this.cards.push(card);
    });

    this.container.isVisible = true;

    return new Promise((res) => {
      this.resolve = res;
    });
  }

  private close(picked: ItemDef | null): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.container.isVisible = false;
    const r = this.resolve;
    this.resolve = null;
    if (r) r(picked);
  }

  isVisible(): boolean {
    return this.isOpen;
  }
}
