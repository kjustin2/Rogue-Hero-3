import { Scene } from "@babylonjs/core/scene";
import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture";
import { Rectangle } from "@babylonjs/gui/2D/controls/rectangle";
import { TextBlock } from "@babylonjs/gui/2D/controls/textBlock";
import { Control } from "@babylonjs/gui/2D/controls/control";
import { CardDef } from "../deck/CardDefinitions";

const TYPE_COLOR: Record<string, string> = {
  melee: "#ffaa44",
  projectile: "#44aaff",
  dash: "#cc66ff",
  aoe: "#66e0ff",
  aerial: "#ff7733",
  utility: "#a8ffd2",
};

const HAND_SIZE = 3;

/**
 * Inter-room hand picker — surface the player's full collection in a wrap
 * grid, let them toggle up to 3 cards. Confirm enabled only when exactly 3
 * cards are selected. Returns the picked id list (length === HAND_SIZE).
 *
 * Differs from CardRewardPicker (single-pick reward) in that the user
 * actively builds a list and confirms via a button. Existing hand cards are
 * pre-selected so a quick "looks good" confirm is one click away.
 */
export class HandPicker {
  ui: AdvancedDynamicTexture;
  private container: Rectangle;
  private gridHost: Rectangle;
  private confirmBtn: Rectangle;
  private confirmLabel: TextBlock;
  private titleText: TextBlock;
  private isOpen = false;
  private selected: string[] = [];
  private cardRefs: { id: string; card: Rectangle; orderText: TextBlock }[] = [];
  private resolve: ((picks: string[]) => void) | null = null;

  constructor(scene: Scene) {
    this.ui = AdvancedDynamicTexture.CreateFullscreenUI("handPickerUI", true, scene);
    this.ui.idealWidth = 1920;
    this.container = new Rectangle("handPickerOverlay");
    this.container.background = "#000000d8";
    this.container.thickness = 0;
    this.container.width = "100%";
    this.container.height = "100%";
    this.container.isVisible = false;
    this.container.isPointerBlocker = true;
    this.ui.addControl(this.container);

    this.titleText = new TextBlock("handPickerTitle");
    this.titleText.text = "BUILD YOUR HAND — 0/3";
    this.titleText.color = "#ffe066";
    this.titleText.fontSize = 40;
    this.titleText.fontFamily = "monospace";
    this.titleText.fontWeight = "bold";
    this.titleText.heightInPixels = 56;
    this.titleText.topInPixels = 60;
    this.titleText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    this.titleText.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    this.titleText.outlineColor = "#000";
    this.titleText.outlineWidth = 4;
    this.container.addControl(this.titleText);

    const subtitle = new TextBlock("handPickerSubtitle");
    subtitle.text = "Pick 3 cards from your deck. Click to toggle. Slots map to keys 1, 2, 3 in pick order.";
    subtitle.color = "#aaaaaa";
    subtitle.fontSize = 16;
    subtitle.fontFamily = "monospace";
    subtitle.heightInPixels = 22;
    subtitle.topInPixels = 122;
    subtitle.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    subtitle.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    this.container.addControl(subtitle);

    this.gridHost = new Rectangle("handPickerGridHost");
    this.gridHost.thickness = 0;
    this.gridHost.background = "transparent";
    this.gridHost.widthInPixels = 1280;
    this.gridHost.heightInPixels = 540;
    this.gridHost.topInPixels = 158;
    this.gridHost.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    this.gridHost.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    this.container.addControl(this.gridHost);

    this.confirmBtn = new Rectangle("handPickerConfirm");
    this.confirmBtn.widthInPixels = 280;
    this.confirmBtn.heightInPixels = 64;
    this.confirmBtn.cornerRadius = 10;
    this.confirmBtn.thickness = 3;
    this.confirmBtn.color = "#88ffaa";
    this.confirmBtn.background = "#0c1a14";
    this.confirmBtn.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    this.confirmBtn.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
    this.confirmBtn.topInPixels = -60;
    this.confirmBtn.isPointerBlocker = true;
    this.confirmBtn.hoverCursor = "not-allowed";
    this.confirmBtn.alpha = 0.5;
    this.container.addControl(this.confirmBtn);

    this.confirmLabel = new TextBlock("handPickerConfirmLabel");
    this.confirmLabel.text = "CONFIRM";
    this.confirmLabel.color = "#88ffaa";
    this.confirmLabel.fontSize = 26;
    this.confirmLabel.fontFamily = "monospace";
    this.confirmLabel.fontWeight = "bold";
    this.confirmLabel.outlineColor = "#000";
    this.confirmLabel.outlineWidth = 3;
    this.confirmBtn.addControl(this.confirmLabel);

    this.confirmBtn.onPointerClickObservable.add(() => {
      if (this.selected.length === HAND_SIZE) this.close(this.selected.slice());
    });
  }

  open(collection: CardDef[], current: (string | null)[]): Promise<string[]> {
    if (this.isOpen) return Promise.resolve(this.selected.slice());
    this.isOpen = true;
    // Pre-fill selected from current hand (truncated to existing entries).
    this.selected = current.filter((id): id is string => id !== null).slice(0, HAND_SIZE);
    this.layoutGrid(collection);
    this.refreshUi();
    this.container.isVisible = true;

    return new Promise<string[]>((res) => {
      this.resolve = res;
    });
  }

  private layoutGrid(collection: CardDef[]): void {
    // Clear old cards
    for (const ref of this.cardRefs) ref.card.dispose();
    this.cardRefs.length = 0;

    const cardW = 200;
    const cardH = 230;
    const cardGap = 18;
    const PER_ROW = 5;
    const rows = Math.ceil(collection.length / PER_ROW);
    const totalRowW = PER_ROW * cardW + (PER_ROW - 1) * cardGap;
    const startLeft = -totalRowW / 2 + cardW / 2;
    const totalH = rows * cardH + (rows - 1) * cardGap;
    const startTop = -totalH / 2 + cardH / 2;

    collection.forEach((opt, i) => {
      const row = Math.floor(i / PER_ROW);
      const col = i % PER_ROW;
      const tColor = TYPE_COLOR[opt.type] ?? "#ffe066";

      const card = new Rectangle(`handPickCard_${i}_${opt.id}`);
      card.widthInPixels = cardW;
      card.heightInPixels = cardH;
      card.background = "#0a0a10f0";
      card.color = tColor;
      card.thickness = 3;
      card.cornerRadius = 10;
      card.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
      card.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
      card.leftInPixels = startLeft + col * (cardW + cardGap);
      card.topInPixels = startTop + row * (cardH + cardGap);
      card.isPointerBlocker = true;
      card.hoverCursor = "pointer";
      this.gridHost.addControl(card);

      const glyph = new TextBlock();
      glyph.text = opt.glyph;
      glyph.color = tColor;
      glyph.fontSize = 56;
      glyph.fontFamily = "monospace";
      glyph.heightInPixels = 64;
      glyph.widthInPixels = cardW - 8;
      glyph.topInPixels = 14;
      glyph.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
      glyph.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
      card.addControl(glyph);

      const name = new TextBlock();
      name.text = opt.name;
      name.color = tColor;
      name.fontSize = 18;
      name.fontFamily = "monospace";
      name.fontWeight = "bold";
      name.widthInPixels = cardW - 8;
      name.heightInPixels = 24;
      name.topInPixels = 84;
      name.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
      name.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
      name.outlineColor = "#000";
      name.outlineWidth = 3;
      card.addControl(name);

      const tag = new TextBlock();
      tag.text = `${opt.type.toUpperCase()} · AP ${opt.cost} · ${opt.damage} DMG`;
      tag.color = "#aaaaaa";
      tag.fontSize = 11;
      tag.fontFamily = "monospace";
      tag.widthInPixels = cardW - 8;
      tag.heightInPixels = 16;
      tag.topInPixels = 112;
      tag.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
      tag.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
      card.addControl(tag);

      const desc = new TextBlock();
      desc.text = opt.desc;
      desc.color = "#dddddd";
      desc.fontSize = 12;
      desc.fontFamily = "monospace";
      desc.textWrapping = true;
      desc.lineSpacing = "3px";
      desc.widthInPixels = cardW - 16;
      desc.heightInPixels = cardH - 132 - 24;
      desc.topInPixels = 132;
      desc.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
      desc.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
      desc.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
      desc.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
      card.addControl(desc);

      // Pick-order chip in the corner — empty until card is part of the active selection.
      const orderText = new TextBlock();
      orderText.text = "";
      orderText.color = "#ffe066";
      orderText.fontSize = 22;
      orderText.fontFamily = "monospace";
      orderText.fontWeight = "bold";
      orderText.widthInPixels = 36;
      orderText.heightInPixels = 28;
      orderText.topInPixels = 6;
      orderText.leftInPixels = -8;
      orderText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
      orderText.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
      orderText.outlineColor = "#000";
      orderText.outlineWidth = 4;
      card.addControl(orderText);

      card.onPointerEnterObservable.add(() => {
        card.scaleX = 1.04; card.scaleY = 1.04;
      });
      card.onPointerOutObservable.add(() => {
        card.scaleX = 1; card.scaleY = 1;
      });
      // Distinct cards in the collection share an id (e.g., 3× cleave). Each
      // grid card maps to a SLOT (the i'th copy), so toggle by the index, not
      // the id alone — otherwise clicking the second cleave would toggle the
      // first one's selection state.
      const slotId = `${opt.id}#${i}`;
      card.onPointerClickObservable.add(() => this.toggle(slotId));

      this.cardRefs.push({ id: slotId, card, orderText });
    });

    // Convert any pre-fill from `current` into slot ids — match each id to the
    // first available slotId that uses the same card and isn't already assigned.
    const used = new Set<string>();
    const slotIds: string[] = [];
    for (const id of this.selected) {
      const ref = this.cardRefs.find((r) => r.id.startsWith(`${id}#`) && !used.has(r.id));
      if (ref) { slotIds.push(ref.id); used.add(ref.id); }
    }
    this.selected = slotIds;
  }

  private toggle(slotId: string): void {
    const idx = this.selected.indexOf(slotId);
    if (idx >= 0) {
      this.selected.splice(idx, 1);
    } else {
      if (this.selected.length >= HAND_SIZE) {
        // Ring out the oldest pick — simplest UX, the player doesn't have to
        // deselect first to swap a card.
        this.selected.shift();
      }
      this.selected.push(slotId);
    }
    this.refreshUi();
  }

  private refreshUi(): void {
    const n = this.selected.length;
    this.titleText.text = `BUILD YOUR HAND — ${n}/${HAND_SIZE}`;
    for (const ref of this.cardRefs) {
      const idx = this.selected.indexOf(ref.id);
      if (idx >= 0) {
        ref.card.alpha = 1;
        ref.card.thickness = 5;
        ref.card.background = "#1a2a1cf0";
        ref.orderText.text = `${idx + 1}`;
      } else {
        ref.card.alpha = 0.65;
        ref.card.thickness = 3;
        ref.card.background = "#0a0a10f0";
        ref.orderText.text = "";
      }
    }
    if (n === HAND_SIZE) {
      this.confirmBtn.alpha = 1;
      this.confirmBtn.hoverCursor = "pointer";
      this.confirmLabel.color = "#88ffaa";
    } else {
      this.confirmBtn.alpha = 0.5;
      this.confirmBtn.hoverCursor = "not-allowed";
      this.confirmLabel.color = "#557766";
    }
  }

  private close(slotIds: string[]): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.container.isVisible = false;
    // Map slot ids back to bare card ids for DeckManager.
    const ids = slotIds.map((s) => s.split("#")[0]);
    const r = this.resolve;
    this.resolve = null;
    if (r) r(ids);
  }

  isVisible(): boolean { return this.isOpen; }
}
