import { Scene } from "@babylonjs/core/scene";
import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture";
import { Rectangle } from "@babylonjs/gui/2D/controls/rectangle";
import { TextBlock } from "@babylonjs/gui/2D/controls/textBlock";
import { Control } from "@babylonjs/gui/2D/controls/control";
import { CardDef } from "../deck/CardDefinitions";

interface CardAnim {
  card: Rectangle;
  baseTop: number;
  startedAt: number;
  delayMs: number;
  hover: number;
  hoverTarget: number;
}

const TYPE_COLOR: Record<string, string> = {
  melee: "#ffaa44",
  projectile: "#44aaff",
  dash: "#cc66ff",
  aoe: "#66e0ff",
  aerial: "#ff7733",
  utility: "#a8ffd2",
};

/**
 * Mirror of RewardPicker but offers CardDef[] instead of ItemDef[]. Used after
 * boss rooms to award a new card to the persistent collection.
 */
export class CardRewardPicker {
  ui: AdvancedDynamicTexture;
  private container: Rectangle;
  private titleText!: TextBlock;
  private cards: Rectangle[] = [];
  private animations: CardAnim[] = [];
  private animObserver: { remove(): void } | null = null;
  private isOpen = false;
  private resolve: ((picked: CardDef | null) => void) | null = null;
  private scene: Scene;
  private currentOptions: CardDef[] = [];
  private static readonly ENTER_DUR_MS = 320;
  private static readonly ENTER_STAGGER_MS = 90;

  constructor(scene: Scene) {
    this.scene = scene;
    this.ui = AdvancedDynamicTexture.CreateFullscreenUI("cardRewardUI", true, scene);
    this.ui.idealWidth = 1920;

    this.container = new Rectangle("cardRewardOverlay");
    this.container.background = "#000000d8";
    this.container.thickness = 0;
    this.container.width = "100%";
    this.container.height = "100%";
    this.container.isVisible = false;
    this.container.isPointerBlocker = true;
    this.ui.addControl(this.container);

    this.titleText = new TextBlock("cardRewardTitle");
    this.titleText.text = "Add a New Card to your Deck";
    this.titleText.color = "#ffe066";
    this.titleText.fontSize = 44;
    this.titleText.fontFamily = "monospace";
    this.titleText.fontWeight = "bold";
    this.titleText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    this.titleText.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    this.titleText.topInPixels = 80;
    this.titleText.shadowColor = "#000";
    this.titleText.shadowOffsetX = 3;
    this.titleText.shadowOffsetY = 3;
    this.titleText.outlineColor = "#000";
    this.titleText.outlineWidth = 4;
    this.container.addControl(this.titleText);
  }

  /** Update the picker's heading. main.ts uses this to switch to the
   *  "swap" copy once the player's deck has hit MAX_COLLECTION_SIZE. */
  setTitle(text: string, color = "#ffe066"): void {
    if (!this.titleText) return;
    this.titleText.text = text;
    this.titleText.color = color;
  }

  open(options: CardDef[]): Promise<CardDef | null> {
    if (this.isOpen) return Promise.resolve(null);
    this.isOpen = true;
    this.currentOptions = options;
    for (const c of this.cards) c.dispose();
    this.cards.length = 0;
    this.animations.length = 0;
    this.stopAnimations();

    const cardW = 360;
    const cardH = 320;
    const spacing = 36;
    const totalW = options.length * cardW + (options.length - 1) * spacing;
    const startX = -totalW / 2 + cardW / 2;

    options.forEach((opt, i) => {
      const tColor = TYPE_COLOR[opt.type] ?? "#ffe066";
      const card = new Rectangle(`cardReward_${i}`);
      card.widthInPixels = cardW;
      card.heightInPixels = cardH;
      card.background = "#0a0a10f0";
      card.color = tColor;
      card.thickness = 4;
      card.cornerRadius = 10;
      card.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
      card.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
      card.leftInPixels = startX + i * (cardW + spacing);
      card.isPointerBlocker = true;
      card.hoverCursor = "pointer";
      this.container.addControl(card);

      const glyph = new TextBlock(`cardReward_${i}_glyph`);
      glyph.text = opt.glyph;
      glyph.color = tColor;
      glyph.fontSize = 80;
      glyph.fontFamily = "monospace";
      glyph.widthInPixels = cardW - 24;
      glyph.heightInPixels = 96;
      glyph.topInPixels = 14;
      glyph.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
      glyph.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
      card.addControl(glyph);

      const name = new TextBlock(`cardReward_${i}_name`);
      name.text = opt.name;
      name.color = tColor;
      name.fontSize = 28;
      name.fontFamily = "monospace";
      name.fontWeight = "bold";
      name.widthInPixels = cardW - 24;
      name.heightInPixels = 36;
      name.topInPixels = 116;
      name.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
      name.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
      name.outlineColor = "#000";
      name.outlineWidth = 4;
      card.addControl(name);

      const tag = new TextBlock(`cardReward_${i}_tag`);
      tag.text = `${opt.type.toUpperCase()}    AP ${opt.cost}    DMG ${opt.damage}`;
      tag.color = "#aaaaaa";
      tag.fontSize = 13;
      tag.fontFamily = "monospace";
      tag.widthInPixels = cardW - 24;
      tag.heightInPixels = 20;
      tag.topInPixels = 156;
      tag.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
      tag.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
      card.addControl(tag);

      const desc = new TextBlock(`cardReward_${i}_desc`);
      desc.text = opt.desc;
      desc.color = "#ffffff";
      desc.fontSize = 16;
      desc.fontFamily = "monospace";
      desc.fontWeight = "bold";
      desc.textWrapping = true;
      desc.lineSpacing = "5px";
      desc.outlineColor = "#000";
      desc.outlineWidth = 2;
      desc.widthInPixels = cardW - 44;
      desc.heightInPixels = cardH - 196;
      desc.topInPixels = 188;
      desc.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
      desc.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
      desc.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
      desc.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
      card.addControl(desc);

      const hint = new TextBlock(`cardReward_${i}_hint`);
      hint.text = "[ Click to add to deck ]";
      hint.color = "#bbbbbb";
      hint.fontSize = 13;
      hint.fontFamily = "monospace";
      hint.fontWeight = "bold";
      hint.widthInPixels = cardW;
      hint.heightInPixels = 18;
      hint.topInPixels = -16;
      hint.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
      hint.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
      card.addControl(hint);

      const anim: CardAnim = {
        card,
        baseTop: 0,
        startedAt: performance.now(),
        delayMs: i * CardRewardPicker.ENTER_STAGGER_MS,
        hover: 1.0,
        hoverTarget: 1.0,
      };
      this.animations.push(anim);

      card.onPointerEnterObservable.add(() => {
        card.background = "#222230";
        anim.hoverTarget = 1.06;
      });
      card.onPointerOutObservable.add(() => {
        card.background = "#0a0a10f0";
        anim.hoverTarget = 1.0;
      });
      card.onPointerClickObservable.add(() => this.close(opt));

      card.topInPixels = 90;
      card.scaleX = 0.7; card.scaleY = 0.7; card.alpha = 0;
      this.cards.push(card);
    });

    this.container.isVisible = true;
    this.startAnimations();
    return new Promise((res) => { this.resolve = res; });
  }

  private startAnimations(): void {
    this.stopAnimations();
    const observer = this.scene.onBeforeRenderObservable.add(() => {
      const now = performance.now();
      for (const a of this.animations) {
        const elapsed = now - a.startedAt - a.delayMs;
        if (elapsed < 0) continue;
        if (elapsed < CardRewardPicker.ENTER_DUR_MS) {
          const t = elapsed / CardRewardPicker.ENTER_DUR_MS;
          const e = 1 - (1 - t) * (1 - t) * (1 - t);
          a.card.topInPixels = a.baseTop + 90 * (1 - e);
          const scale = 0.7 + 0.3 * e;
          a.card.scaleX = scale * a.hover;
          a.card.scaleY = scale * a.hover;
          a.card.alpha = e;
        } else {
          a.card.topInPixels = a.baseTop;
          a.card.alpha = 1;
        }
        const dt = this.scene.getEngine().getDeltaTime() / 1000;
        const k = 1 - Math.exp(-18 * dt);
        a.hover += (a.hoverTarget - a.hover) * k;
        if (elapsed >= CardRewardPicker.ENTER_DUR_MS) {
          a.card.scaleX = a.hover;
          a.card.scaleY = a.hover;
        }
      }
    });
    this.animObserver = { remove: () => this.scene.onBeforeRenderObservable.remove(observer) };
  }

  private stopAnimations(): void {
    if (this.animObserver) {
      this.animObserver.remove();
      this.animObserver = null;
    }
  }

  private close(picked: CardDef | null): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.container.isVisible = false;
    this.stopAnimations();
    const r = this.resolve;
    this.resolve = null;
    if (r) r(picked);
  }

  isVisible(): boolean { return this.isOpen; }

  /** Test-only: drive the picker as if the i-th card had been clicked. */
  pickIndexForTest(i: number): void {
    if (!this.isOpen) return;
    this.close(this.currentOptions[i] ?? null);
  }
}
