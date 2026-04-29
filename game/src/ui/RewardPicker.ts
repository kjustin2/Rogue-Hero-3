import { Scene } from "@babylonjs/core/scene";
import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture";
import { Rectangle } from "@babylonjs/gui/2D/controls/rectangle";
import { TextBlock } from "@babylonjs/gui/2D/controls/textBlock";
import { Control } from "@babylonjs/gui/2D/controls/control";
import { ItemDef } from "../items/ItemDefinitions";

interface CardAnim {
  card: Rectangle;
  baseTop: number;
  startedAt: number;
  delayMs: number;
  hover: number;       // current hover scale, eased toward target
  hoverTarget: number; // 1.0 idle / 1.06 hovered
}

export class RewardPicker {
  ui: AdvancedDynamicTexture;
  private container: Rectangle;
  private cards: Rectangle[] = [];
  private animations: CardAnim[] = [];
  private animObserver: { remove(): void } | null = null;
  private isOpen = false;
  private resolve: ((picked: ItemDef | null) => void) | null = null;
  private scene: Scene;
  private currentOptions: ItemDef[] = [];
  /** Total enter-tween duration per card, ms. */
  private static readonly ENTER_DUR_MS = 320;
  /** Stagger between consecutive cards' enter, ms. */
  private static readonly ENTER_STAGGER_MS = 90;

  constructor(scene: Scene) {
    this.scene = scene;
    this.ui = AdvancedDynamicTexture.CreateFullscreenUI("rewardUI", true, scene);
    this.ui.idealWidth = 1920;

    this.container = new Rectangle("rewardOverlay");
    // Heavier dim than before — at #000a (alpha 0xaa) the busy forest behind
    // bled through enough to make small description text hard to read.
    this.container.background = "#000000d8";
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
    title.fontSize = 48;
    title.fontFamily = "monospace";
    title.fontWeight = "bold";
    title.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    title.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    title.topInPixels = 80;
    title.shadowColor = "#000";
    title.shadowOffsetX = 3;
    title.shadowOffsetY = 3;
    title.shadowBlur = 6;
    title.outlineColor = "#000";
    title.outlineWidth = 4;
    this.container.addControl(title);
  }

  /** Open the picker with three options. Returns a Promise resolved with the picked def (or null if dismissed). */
  open(options: ItemDef[]): Promise<ItemDef | null> {
    if (this.isOpen) return Promise.resolve(null);
    this.isOpen = true;
    this.currentOptions = options;

    // Clear old cards
    for (const c of this.cards) c.dispose();
    this.cards.length = 0;
    this.animations.length = 0;
    this.stopAnimations();

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
      // Solid near-black background — the previous "#181820" let the busy
      // forest / floor decals leak through, killing readability of small
      // description text.
      card.background = "#0a0a10f0";
      card.color = opt.color;
      card.thickness = 4;
      card.cornerRadius = 10;
      card.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
      card.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
      card.leftInPixels = startX + i * (cardW + spacing);
      card.isPointerBlocker = true;
      card.hoverCursor = "pointer";
      this.container.addControl(card);

      const rarity = new TextBlock(`reward_${i}_rarity`);
      rarity.text = opt.rarity.toUpperCase();
      // Brighter rarity tag with a subtle outline so it doesn't blend with
      // the dark card background.
      rarity.color = "#dddddd";
      rarity.fontSize = 14;
      rarity.fontFamily = "monospace";
      rarity.fontWeight = "bold";
      rarity.outlineColor = "#000";
      rarity.outlineWidth = 2;
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
      name.fontSize = 30;
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
      name.shadowOffsetX = 3;
      name.shadowOffsetY = 3;
      name.shadowBlur = 4;
      name.outlineColor = "#000000";
      name.outlineWidth = 4;
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
      desc.color = "#ffffff";
      desc.fontSize = 17;
      desc.fontFamily = "monospace";
      desc.fontWeight = "bold";
      desc.textWrapping = true;
      desc.lineSpacing = "5px";
      desc.shadowColor = "#000";
      desc.shadowOffsetX = 2;
      desc.shadowOffsetY = 2;
      desc.outlineColor = "#000000";
      desc.outlineWidth = 2;
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
      hint.color = "#bbbbbb";
      hint.fontSize = 14;
      hint.fontFamily = "monospace";
      hint.fontWeight = "bold";
      hint.outlineColor = "#000";
      hint.outlineWidth = 2;
      hint.widthInPixels = cardW;
      hint.heightInPixels = 20;
      hint.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
      hint.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
      hint.topInPixels = -HINT_FROM_BOTTOM;
      hint.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
      hint.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
      card.addControl(hint);

      // Cache the animation state before attaching hover handlers — they read
      // `hoverTarget` to drive the per-frame scale tween.
      const anim: CardAnim = {
        card,
        baseTop: 0,
        startedAt: performance.now(),
        delayMs: i * RewardPicker.ENTER_STAGGER_MS,
        hover: 1.0,
        hoverTarget: 1.0,
      };
      this.animations.push(anim);

      card.onPointerEnterObservable.add(() => {
        card.background = "#222230";
        anim.hoverTarget = 1.06;
      });
      card.onPointerOutObservable.add(() => {
        card.background = "#181820";
        anim.hoverTarget = 1.0;
      });
      card.onPointerClickObservable.add(() => {
        this.close(opt);
      });

      // Initial pre-tween pose: drop the card 90px below its rest spot, scale
      // it down, fully transparent. The tick will ease it into place over
      // ENTER_DUR_MS starting after `delayMs`.
      card.topInPixels = 90;
      card.scaleX = 0.7;
      card.scaleY = 0.7;
      card.alpha = 0;

      this.cards.push(card);
    });

    this.container.isVisible = true;
    this.startAnimations();

    return new Promise((res) => {
      this.resolve = res;
    });
  }

  /**
   * Per-frame tween driver. Two layers compose:
   *   1. Enter animation: cubic ease-out from below + scale-up + fade-in,
   *      staggered per card. Runs once per open().
   *   2. Hover scale: simple exponential damping toward 1.06 / 1.0.
   * The observer auto-removes when no card still has work to do.
   */
  private startAnimations(): void {
    this.stopAnimations();
    const observer = this.scene.onBeforeRenderObservable.add(() => {
      const now = performance.now();
      let anyEntering = false;
      for (const a of this.animations) {
        const elapsed = now - a.startedAt - a.delayMs;
        if (elapsed < 0) {
          anyEntering = true;
          continue;
        }
        if (elapsed < RewardPicker.ENTER_DUR_MS) {
          anyEntering = true;
          const t = elapsed / RewardPicker.ENTER_DUR_MS;
          // Cubic ease-out: 1 - (1-t)^3.
          const e = 1 - (1 - t) * (1 - t) * (1 - t);
          a.card.topInPixels = a.baseTop + 90 * (1 - e);
          const scale = 0.7 + 0.3 * e;
          // Hover scale composes on top of the enter scale.
          a.card.scaleX = scale * a.hover;
          a.card.scaleY = scale * a.hover;
          a.card.alpha = e;
        } else {
          // Past the enter — only the hover tween still needs work.
          a.card.topInPixels = a.baseTop;
          a.card.alpha = 1;
        }
        // Hover damping (frame-rate independent enough for ~60fps GUI use).
        const dt = this.scene.getEngine().getDeltaTime() / 1000;
        const k = 1 - Math.exp(-18 * dt);
        a.hover += (a.hoverTarget - a.hover) * k;
        if (elapsed >= RewardPicker.ENTER_DUR_MS) {
          a.card.scaleX = a.hover;
          a.card.scaleY = a.hover;
        }
      }
      // Observer runs continuously while the picker is up so hover tweens are
      // always responsive — cost is negligible (3 cards, simple math).
      void anyEntering;
    });
    this.animObserver = {
      remove: () => this.scene.onBeforeRenderObservable.remove(observer),
    };
  }

  private stopAnimations(): void {
    if (this.animObserver) {
      this.animObserver.remove();
      this.animObserver = null;
    }
  }

  private close(picked: ItemDef | null): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.container.isVisible = false;
    this.stopAnimations();
    const r = this.resolve;
    this.resolve = null;
    if (r) r(picked);
  }

  isVisible(): boolean {
    return this.isOpen;
  }

  /** Test-only: drive the picker as if the i-th card had been clicked. */
  pickIndexForTest(i: number): void {
    if (!this.isOpen) return;
    this.close(this.currentOptions[i] ?? null);
  }
}
