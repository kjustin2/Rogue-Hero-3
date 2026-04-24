import { Scene } from "@babylonjs/core/scene";
import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture";
import { Rectangle } from "@babylonjs/gui/2D/controls/rectangle";
import { TextBlock } from "@babylonjs/gui/2D/controls/textBlock";
import { Control } from "@babylonjs/gui/2D/controls/control";
import { Player } from "../player/Player";
import { EnemyManager } from "../enemies/EnemyManager";
import { TempoSystem } from "../tempo/TempoSystem";
import { DeckManager } from "../deck/DeckManager";
import { CardType } from "../deck/CardDefinitions";
import { events } from "../engine/EventBus";
import { dampCoeff } from "../util/Smoothing";

interface Bar {
  bg: Rectangle;
  fill: Rectangle;
  caption: TextBlock;
  width: number;
}

interface HandSlot {
  bg: Rectangle;
  hotkey: TextBlock;
  name: TextBlock;
  cost: TextBlock;
  costLabel: TextBlock;
  type: TextBlock;
  desc: TextBlock;
  chevron: TextBlock;
  flashTimer: number;
  /** >0 while the slot pops bigger from the play animation. */
  popTimer: number;
  /** Fixed home position we scale around — baseline leftInPixels. */
  homeLeft: number;
  /** Smoothed scale driven by selection — lerps toward 1.15 while selected, 1 while not. */
  selScale: number;
  /** Smoothed background alpha — lerps toward full on select, dimmer when unselected. */
  selAlpha: number;
}

const TYPE_COLOR: Record<CardType, string> = {
  melee: "#ffaa44",
  projectile: "#44aaff",
  dash: "#cc66ff",
};

const TYPE_LABEL: Record<CardType, string> = {
  melee: "MELEE",
  projectile: "BOLT",
  dash: "DASH",
};

export class Hud {
  ui: AdvancedDynamicTexture;
  private hpBar: Bar;
  private apBar: Bar;
  private tempoBar: Bar;
  private tempoZoneLabel: TextBlock;
  private crashBadge: TextBlock;
  private crashBadgePulse = 0;
  private enemyCounter: TextBlock;
  private roomLabel: TextBlock;
  private hand: HandSlot[] = [];
  private banner: TextBlock;
  /** Home Y position of the banner (pixels). Slide-in animates from home-30 to home. */
  private bannerHomeTop = -120;
  /** Counts up from 0 to BANNER_ANIM_DUR during slide-in; 0 = not animating. */
  private bannerAnimT = 0;
  private readonly BANNER_ANIM_DUR = 0.22;
  private bossBar: Bar;
  private bossLabel: TextBlock;
  /** 50% phase tick rendered inside the boss bar. */
  private bossPhaseTick: Rectangle;
  /** >0 while the boss bar pulses yellow after crossing the phase threshold. */
  private bossFlashTimer = 0;
  private controlHint: TextBlock;
  private targetBtn!: Rectangle;
  private targetBtnLabel!: TextBlock;
  private targetBtnName!: TextBlock;
  private selectedSlot = 0;
  private selectedPulse = 0;
  private onCycleTarget: (() => void) | null = null;

  // Room transition wipe — a fullscreen black rectangle whose alpha animates during setWipe calls.
  private wipe: Rectangle;
  private wipeLabel: TextBlock;
  private wipeAlpha = 0;
  private wipeTargetAlpha = 0;
  private wipeAlphaSpeed = 0;

  // Relic-equip feedback: expanding ring + banner + persistent badge stack.
  private relicBadges: { bg: Rectangle; label: TextBlock; popT: number }[] = [];
  private relicRing: Rectangle;
  private relicRingTtl = 0;
  private relicBanner: TextBlock;
  private relicBannerTtl = 0;

  // Kill-combo counter: transient "×N CHAIN" text top-center.
  private comboLabel: TextBlock;
  private comboCount = 0;
  private comboTtl = 0;
  private lastKillTime = 0;
  /** Displayed AP value — lags behind actual `player.ap` so drains animate smoothly. */
  private apDisplay = -1;
  /** Counts down from 0.45s on CARD_FAIL — drives a red AP-bar flash + wiggle. */
  private apFailFlashTimer = 0;
  /** Displayed HP value — lags behind actual `player.hp` so damage animates smoothly. */
  private hpDisplay = -1;
  /** Displayed tempo value — lags behind the tempo system's own value for a second layer of smoothing. */
  private tempoDisplay = -1;
  /** Metronome relic indicator — visible only when equipped; pulses with the decay beat. */
  private metronomeDot!: Rectangle;
  private metronomeClock = 0;

  constructor(
    scene: Scene,
    private player: Player,
    private enemies: EnemyManager,
    private tempo: TempoSystem,
    private deck: DeckManager,
  ) {
    this.ui = AdvancedDynamicTexture.CreateFullscreenUI("hudUI", true, scene);
    this.ui.idealWidth = 1920;

    // ---- Top-left vitals: HP, AP, Tempo (labels ABOVE each bar) ----
    this.hpBar = this.makeBar("hp", 24, 38, 320, 18, "#222a", "#cc3344");
    this.apBar = this.makeBar("ap", 24, 84, 200, 12, "#222a", "#3399ff");
    this.tempoBar = this.makeBar("tempo", 24, 130, 320, 22, "#222a", "#22aa55");

    // Tempo zone label below the tempo bar (own line — no overlap)
    this.tempoZoneLabel = this.makeText("FLOWING", 24, 156, "#44ff88", 16, "left", "top");
    this.tempoZoneLabel.fontWeight = "bold";

    // Crash-ready badge — its own row below the zone label so wide labels (CRITICAL) don't crowd it
    this.crashBadge = this.makeText("[F] CRASH READY", 24, 178, "#ffe066", 16, "left", "top");
    this.crashBadge.fontWeight = "bold";
    this.crashBadge.isVisible = false;

    // ---- Top-right enemy counter ----
    this.enemyCounter = this.makeText("Enemies: 0", -24, 24, "#fff", 22, "right", "top");

    // ---- Top-center room indicator ----
    this.roomLabel = this.makeText("", 0, 24, "#ffe066", 22, "center", "top");
    this.roomLabel.fontWeight = "bold";

    // ---- Boss HP bar (top-center, below room label) ----
    this.bossBar = this.makeBar("boss", 0, 64, 520, 22, "#3a0a0aef", "#cc2200", "center");
    this.bossLabel = this.makeText("", 0, 60, "#ffeecc", 16, "center", "top");
    this.bossLabel.fontWeight = "bold";
    // Phase tick — a short vertical bar at the 50% mark inside the boss bar.
    this.bossPhaseTick = new Rectangle("bossPhaseTick");
    this.bossPhaseTick.widthInPixels = 3;
    this.bossPhaseTick.heightInPixels = 18;
    this.bossPhaseTick.background = "#ffd060";
    this.bossPhaseTick.color = "#000000";
    this.bossPhaseTick.thickness = 1;
    this.bossPhaseTick.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    this.bossPhaseTick.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    // Positioned inside the boss bar background (centered bar → half-width offset).
    this.bossPhaseTick.leftInPixels = this.bossBar.width / 2 - 1.5;
    this.bossBar.bg.addControl(this.bossPhaseTick);
    this.setBossVisible(false);

    // ---- Center banner (room cleared / defeat / victory) ----
    this.banner = new TextBlock("banner");
    this.banner.text = "";
    this.banner.color = "#ffe066";
    this.banner.fontSize = 56;
    this.banner.fontFamily = "monospace";
    this.banner.fontWeight = "bold";
    this.banner.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    this.banner.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    this.banner.topInPixels = -120;
    this.banner.shadowColor = "#000";
    this.banner.shadowOffsetX = 2;
    this.banner.shadowOffsetY = 2;
    this.banner.isVisible = false;
    this.ui.addControl(this.banner);

    // ---- Hand: 4 slots along the bottom ----
    // Taller slots + wider so every chunk of text has a guaranteed y-band
    // that can't collide with its neighbors.
    const slotW = 230;
    const slotH = 148;
    const spacing = 16;
    const totalW = slotW * 4 + spacing * 3;
    const startX = -totalW / 2 + slotW / 2;
    for (let i = 0; i < 4; i++) {
      const slot = this.makeHandSlot(i, startX + i * (slotW + spacing), slotW, slotH);
      this.hand.push(slot);
    }

    // Control hint row — sits ABOVE the hand tray (cards now span y=[-176,-28]
    // from the bottom, so anything at -150 would bake into them). Placed at
    // -190 with its own explicit height so the text has a guaranteed band.
    this.controlHint = this.makeText(
      "LMB: use   RMB: next card   1–4: pick slot   Q/Tab: switch target",
      0,
      -192,
      "#bbbbbb",
      14,
      "center",
      "bottom",
    );
    this.controlHint.fontWeight = "bold";

    // Switch-target pill: clickable alternative to Q/Tab. Sits above the
    // right-edge cards at the same vertical level as the control hint. Taller
    // now so the label + enemy name each get their own clear row.
    this.targetBtn = new Rectangle("targetBtn");
    this.targetBtn.widthInPixels = 260;
    this.targetBtn.heightInPixels = 56;
    this.targetBtn.background = "#0b1a22ee";
    this.targetBtn.color = "#33ddff";
    this.targetBtn.thickness = 2;
    this.targetBtn.cornerRadius = 10;
    this.targetBtn.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
    this.targetBtn.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
    this.targetBtn.leftInPixels = -28;
    this.targetBtn.topInPixels = -200;
    this.targetBtn.isPointerBlocker = true;
    this.targetBtn.hoverCursor = "pointer";
    this.ui.addControl(this.targetBtn);

    // Label + name get explicit heights so even long enemy names like
    // "BOSS_BRAWLER  220/220" land in their own row instead of sliding under
    // the "SWITCH TARGET" heading.
    this.targetBtnLabel = new TextBlock("targetBtnLabel");
    this.targetBtnLabel.text = "◎ SWITCH TARGET  [Q]";
    this.targetBtnLabel.color = "#aaf0ff";
    this.targetBtnLabel.fontSize = 13;
    this.targetBtnLabel.fontFamily = "monospace";
    this.targetBtnLabel.fontWeight = "bold";
    this.targetBtnLabel.widthInPixels = 256;
    this.targetBtnLabel.heightInPixels = 22;
    this.targetBtnLabel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    this.targetBtnLabel.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    this.targetBtnLabel.topInPixels = 4;
    this.targetBtnLabel.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    this.targetBtnLabel.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    this.targetBtn.addControl(this.targetBtnLabel);

    this.targetBtnName = new TextBlock("targetBtnName");
    this.targetBtnName.text = "— no target —";
    this.targetBtnName.color = "#ffffff";
    this.targetBtnName.fontSize = 13;
    this.targetBtnName.fontFamily = "monospace";
    this.targetBtnName.widthInPixels = 256;
    this.targetBtnName.heightInPixels = 22;
    this.targetBtnName.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    this.targetBtnName.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
    this.targetBtnName.topInPixels = -4;
    this.targetBtnName.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    this.targetBtnName.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    this.targetBtn.addControl(this.targetBtnName);

    this.targetBtn.onPointerEnterObservable.add(() => {
      this.targetBtn.background = "#133243ee";
    });
    this.targetBtn.onPointerOutObservable.add(() => {
      this.targetBtn.background = "#0b1a22ee";
    });
    this.targetBtn.onPointerClickObservable.add(() => {
      if (this.onCycleTarget) this.onCycleTarget();
    });

    // Card play flash: when main.ts emits CARD_PLAYED_SLOT, briefly pulse that slot's bg.
    events.on<{ slot: number }>("CARD_PLAYED_SLOT", ({ slot }) => {
      if (slot >= 0 && slot < this.hand.length) {
        this.hand[slot].flashTimer = 0.32;
        this.hand[slot].popTimer = 0.22;
      }
    });

    // Kill combo — each KILL extends a 3-second window; counter appears at >=2 kills.
    events.on("KILL", () => this.registerKill());

    // Relic equipped: banner "RELIC ACQUIRED: {name}" + expanding gold ring + persistent badge.
    events.on<{ id: string; name: string; color: string }>("RELIC_EQUIPPED", ({ name, color }) => {
      this.flashRelicPickup(name, color);
    });

    // CARD_FAIL — player tried to cast something they couldn't afford. Flash
    // the AP bar red and trigger a small horizontal wiggle so the AP cost
    // becomes visually obvious.
    events.on<{ reason: string }>("CARD_FAIL", () => {
      this.apFailFlashTimer = 0.45;
    });

    // ---- Room transition wipe (full-screen black) ----
    this.wipe = new Rectangle("wipe");
    this.wipe.width = "100%";
    this.wipe.height = "100%";
    this.wipe.background = "#000000";
    this.wipe.thickness = 0;
    this.wipe.alpha = 0;
    this.wipe.isHitTestVisible = false;
    this.wipe.isPointerBlocker = false;
    this.ui.addControl(this.wipe);

    this.wipeLabel = new TextBlock("wipeLabel");
    this.wipeLabel.text = "";
    this.wipeLabel.color = "#ffe066";
    this.wipeLabel.fontSize = 52;
    this.wipeLabel.fontFamily = "monospace";
    this.wipeLabel.fontWeight = "bold";
    this.wipeLabel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    this.wipeLabel.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    this.wipeLabel.shadowColor = "#000";
    this.wipeLabel.shadowOffsetX = 3;
    this.wipeLabel.shadowOffsetY = 3;
    this.wipe.addControl(this.wipeLabel);

    // ---- Relic acquisition banner (transient; sits above the room banner) ----
    this.relicBanner = new TextBlock("relicBanner");
    this.relicBanner.text = "";
    this.relicBanner.color = "#ffd060";
    this.relicBanner.fontSize = 38;
    this.relicBanner.fontFamily = "monospace";
    this.relicBanner.fontWeight = "bold";
    this.relicBanner.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    this.relicBanner.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    this.relicBanner.topInPixels = -40;
    this.relicBanner.shadowColor = "#000";
    this.relicBanner.shadowOffsetX = 2;
    this.relicBanner.shadowOffsetY = 2;
    this.relicBanner.isVisible = false;
    this.ui.addControl(this.relicBanner);

    // Expanding gold ring at screen center for the relic-pickup moment.
    this.relicRing = new Rectangle("relicRing");
    this.relicRing.widthInPixels = 120;
    this.relicRing.heightInPixels = 120;
    this.relicRing.cornerRadius = 60;
    this.relicRing.thickness = 6;
    this.relicRing.color = "#ffd060";
    this.relicRing.background = "transparent";
    this.relicRing.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    this.relicRing.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    this.relicRing.isHitTestVisible = false;
    this.relicRing.isVisible = false;
    this.ui.addControl(this.relicRing);

    // Metronome relic indicator — small pulsing dot next to the Tempo bar.
    // Hidden by default; main.ts toggles it on when the relic is equipped.
    this.metronomeDot = new Rectangle("metronomeDot");
    this.metronomeDot.widthInPixels = 14;
    this.metronomeDot.heightInPixels = 14;
    this.metronomeDot.cornerRadius = 7;
    this.metronomeDot.background = "#ffdd44";
    this.metronomeDot.thickness = 0;
    this.metronomeDot.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    this.metronomeDot.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    this.metronomeDot.leftInPixels = 24 + 320 + 10; // to the right of the tempo bar
    this.metronomeDot.topInPixels = 133;
    this.metronomeDot.isVisible = false;
    this.metronomeDot.isHitTestVisible = false;
    this.ui.addControl(this.metronomeDot);

    // Kill-combo counter — appears briefly at top-center below the room label.
    this.comboLabel = new TextBlock("comboLabel");
    this.comboLabel.text = "";
    this.comboLabel.color = "#ffd060";
    this.comboLabel.fontSize = 28;
    this.comboLabel.fontFamily = "monospace";
    this.comboLabel.fontWeight = "bold";
    this.comboLabel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    this.comboLabel.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    this.comboLabel.topInPixels = 98;
    this.comboLabel.shadowColor = "#000";
    this.comboLabel.shadowOffsetX = 2;
    this.comboLabel.shadowOffsetY = 2;
    this.comboLabel.outlineColor = "#2a1a00";
    this.comboLabel.outlineWidth = 2;
    this.comboLabel.isVisible = false;
    this.ui.addControl(this.comboLabel);
  }

  /**
   * Trigger a room wipe — fade to black over fadeInSec showing `label`,
   * hold, then fade back out over fadeOutSec. Call once per transition.
   */
  playWipe(label: string, fadeInSec = 0.4, holdSec = 0.35, fadeOutSec = 0.4): Promise<void> {
    this.wipeLabel.text = label;
    this.wipeTargetAlpha = 1;
    this.wipeAlphaSpeed = 1 / Math.max(0.01, fadeInSec);
    return new Promise((resolve) => {
      // Fade in -> hold -> fade out. Chained via setTimeout since we drive alpha
      // in the tick and just need coarse ms-scale timers for the phase changes.
      const toInMs = fadeInSec * 1000;
      const toHoldMs = holdSec * 1000;
      setTimeout(() => {
        // Hold the label at full-black for `holdSec`.
        setTimeout(() => {
          this.wipeTargetAlpha = 0;
          this.wipeAlphaSpeed = 1 / Math.max(0.01, fadeOutSec);
          setTimeout(() => {
            this.wipeLabel.text = "";
            resolve();
          }, fadeOutSec * 1000);
        }, toHoldMs);
      }, toInMs);
    });
  }

  /** Flash the boss HP bar yellow — called via BOSS_PHASE event hookup in main.ts. */
  flashBossPhase(): void {
    this.bossFlashTimer = 0.6;
  }

  /** Show/hide the Metronome relic dot next to the Tempo bar. Called by main.ts. */
  setMetronomeActive(active: boolean): void {
    this.metronomeDot.isVisible = active;
  }

  private flashRelicPickup(name: string, color: string): void {
    this.relicBanner.text = `RELIC ACQUIRED — ${name.toUpperCase()}`;
    this.relicBanner.color = color;
    this.relicBanner.isVisible = true;
    this.relicBannerTtl = 1.2;
    this.relicRing.isVisible = true;
    this.relicRingTtl = 0.55;
    // Append a persistent badge in the top-right stack. Clicks are not handled;
    // these are purely a reminder of what's equipped.
    const badgeIdx = this.relicBadges.length;
    const bg = new Rectangle(`relicBadge_${badgeIdx}`);
    bg.widthInPixels = 210;
    bg.heightInPixels = 32;
    bg.background = "#0b0b12d8";
    bg.color = color;
    bg.thickness = 2;
    bg.cornerRadius = 8;
    bg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
    bg.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    bg.leftInPixels = -24;
    bg.topInPixels = 56 + badgeIdx * 36;
    this.ui.addControl(bg);
    const label = new TextBlock(`relicBadgeLabel_${badgeIdx}`);
    label.text = `◈ ${name}`;
    label.color = color;
    label.fontSize = 14;
    label.fontFamily = "monospace";
    label.fontWeight = "bold";
    label.shadowColor = "#000";
    label.shadowOffsetX = 1;
    label.shadowOffsetY = 1;
    bg.addControl(label);
    // Pop-in: start at scale 0.2 / alpha 0, driven toward target over ~0.32s
    // with a light overshoot for the "trophy unlocked" pop.
    bg.scaleX = 0.2;
    bg.scaleY = 0.2;
    bg.alpha = 0;
    this.relicBadges.push({ bg, label, popT: 0 });
  }

  /** Strip all relic badges — for in-place run restart. */
  clearRelicBadges(): void {
    for (const b of this.relicBadges) {
      b.bg.dispose();
      b.label.dispose();
    }
    this.relicBadges.length = 0;
    this.relicBanner.isVisible = false;
    this.relicBannerTtl = 0;
    this.relicRing.isVisible = false;
    this.relicRingTtl = 0;
    this.comboLabel.isVisible = false;
    this.comboCount = 0;
    this.comboTtl = 0;
    this.bossFlashTimer = 0;
    this.apDisplay = -1;
    this.hpDisplay = -1;
    this.tempoDisplay = -1;
  }

  private registerKill(): void {
    const now = performance.now();
    // 3-second chain window: a later kill keeps the counter going; exceeding
    // the window resets to 1 (so the NEXT kill will take us to 2 and re-show).
    if (now - this.lastKillTime < 3000) {
      this.comboCount++;
    } else {
      this.comboCount = 1;
    }
    this.lastKillTime = now;
    if (this.comboCount >= 2) {
      this.comboLabel.text = `×${this.comboCount}  CHAIN`;
      this.comboLabel.isVisible = true;
      this.comboTtl = 1.5;
    }
  }

  private makeBar(
    name: string,
    x: number,
    y: number,
    width: number,
    height: number,
    bgColor: string,
    fillColor: string,
    horiz: "left" | "center" | "right" = "left",
  ): Bar {
    const align = horiz === "center"
      ? Control.HORIZONTAL_ALIGNMENT_CENTER
      : horiz === "right"
        ? Control.HORIZONTAL_ALIGNMENT_RIGHT
        : Control.HORIZONTAL_ALIGNMENT_LEFT;

    const bg = new Rectangle(`${name}_bg`);
    bg.widthInPixels = width;
    bg.heightInPixels = height;
    bg.background = bgColor;
    bg.color = "#fff8";
    bg.thickness = 1;
    bg.cornerRadius = 4;
    bg.horizontalAlignment = align;
    bg.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    bg.leftInPixels = x;
    bg.topInPixels = y;
    this.ui.addControl(bg);

    const fill = new Rectangle(`${name}_fill`);
    fill.widthInPixels = width - 4;
    fill.heightInPixels = height - 4;
    fill.background = fillColor;
    fill.thickness = 0;
    fill.cornerRadius = 3;
    // Anchor the fill to the LEFT inside the bg so it shrinks correctly as value drops.
    fill.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    fill.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    fill.leftInPixels = 2;
    bg.addControl(fill);

    // Caption text ABOVE the bar — no clash with fill.
    const caption = this.makeText(
      name.toUpperCase(),
      horiz === "center" ? 0 : x,
      y - 18,
      "#fff",
      14,
      horiz,
      "top",
    );

    return { bg, fill, caption, width };
  }

  private makeText(
    text: string,
    x: number,
    y: number,
    color: string,
    size: number,
    horiz: "left" | "center" | "right",
    vert: "top" | "center" | "bottom",
  ): TextBlock {
    const t = new TextBlock();
    t.text = text;
    t.color = color;
    t.fontSize = size;
    t.fontFamily = "monospace";
    t.shadowColor = "#000";
    t.shadowOffsetX = 1;
    t.shadowOffsetY = 1;
    t.horizontalAlignment = horiz === "center"
      ? Control.HORIZONTAL_ALIGNMENT_CENTER
      : horiz === "right"
        ? Control.HORIZONTAL_ALIGNMENT_RIGHT
        : Control.HORIZONTAL_ALIGNMENT_LEFT;
    t.verticalAlignment = vert === "center"
      ? Control.VERTICAL_ALIGNMENT_CENTER
      : vert === "bottom"
        ? Control.VERTICAL_ALIGNMENT_BOTTOM
        : Control.VERTICAL_ALIGNMENT_TOP;
    t.leftInPixels = x;
    t.topInPixels = y;
    t.resizeToFit = true;
    this.ui.addControl(t);
    return t;
  }

  private makeHandSlot(idx: number, leftPx: number, w: number, h: number): HandSlot {
    const bg = new Rectangle(`hand_${idx}_bg`);
    bg.widthInPixels = w;
    bg.heightInPixels = h;
    bg.background = "#0e0e14e0";
    bg.color = "#666";
    bg.thickness = 3;
    bg.cornerRadius = 8;
    bg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    bg.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
    bg.leftInPixels = leftPx;
    bg.topInPixels = -28;
    this.ui.addControl(bg);

    // Layout bands (top-anchored, explicit y + height per element) so nothing
    // auto-fills the whole card and bleeds into its neighbor's band.
    //   y  0– 22: header row — hotkey (left) + AP cost (right)
    //   y 28– 56: card name (20px)
    //   y 60– 78: type tag (12px)
    //   y 84–140: description area (wrapped, 11px)
    const HEADER_H = 22;
    const NAME_Y = 28, NAME_H = 28;
    const TYPE_Y = 58, TYPE_H = 16;
    const DESC_Y = 82, DESC_H = h - 82 - 10; // leave 10px bottom padding

    // Hotkey — small label in the top-left; fits inside the header band.
    const hotkey = new TextBlock(`hand_${idx}_hot`);
    hotkey.text = String(idx + 1);
    hotkey.color = "#aaaaaa";
    hotkey.fontSize = 13;
    hotkey.fontFamily = "monospace";
    hotkey.fontWeight = "bold";
    hotkey.widthInPixels = 24;
    hotkey.heightInPixels = HEADER_H;
    hotkey.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    hotkey.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    hotkey.leftInPixels = 8;
    hotkey.topInPixels = 4;
    hotkey.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    hotkey.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    bg.addControl(hotkey);

    // AP cost cluster on the right — "AP" label + bold digit.
    const costLabel = new TextBlock(`hand_${idx}_costLabel`);
    costLabel.text = "AP";
    costLabel.color = "#88bbdd";
    costLabel.fontSize = 11;
    costLabel.fontFamily = "monospace";
    costLabel.fontWeight = "bold";
    costLabel.widthInPixels = 24;
    costLabel.heightInPixels = HEADER_H;
    costLabel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
    costLabel.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    costLabel.leftInPixels = -28;
    costLabel.topInPixels = 4;
    costLabel.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
    costLabel.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    bg.addControl(costLabel);

    const cost = new TextBlock(`hand_${idx}_cost`);
    cost.text = "1";
    cost.color = "#3399ff";
    cost.fontSize = 18;
    cost.fontFamily = "monospace";
    cost.fontWeight = "bold";
    cost.widthInPixels = 22;
    cost.heightInPixels = HEADER_H;
    cost.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
    cost.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    cost.leftInPixels = -6;
    cost.topInPixels = 2;
    cost.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
    cost.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    cost.shadowColor = "#000";
    cost.shadowOffsetX = 1;
    cost.shadowOffsetY = 1;
    bg.addControl(cost);

    // Card name — its own band with an explicit height so it can never fall
    // into the description area below it.
    const name = new TextBlock(`hand_${idx}_name`);
    name.text = "—";
    name.color = "#fff";
    name.fontSize = 20;
    name.fontFamily = "monospace";
    name.fontWeight = "bold";
    name.widthInPixels = w - 16;
    name.heightInPixels = NAME_H;
    name.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    name.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    name.topInPixels = NAME_Y;
    name.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    name.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    name.shadowColor = "#000";
    name.shadowOffsetX = 1;
    name.shadowOffsetY = 1;
    bg.addControl(name);

    // Type tag — uppercase mini-label sitting in its own band.
    const type = new TextBlock(`hand_${idx}_type`);
    type.text = "";
    type.color = "#888";
    type.fontSize = 11;
    type.fontFamily = "monospace";
    type.fontWeight = "bold";
    type.widthInPixels = w - 16;
    type.heightInPixels = TYPE_H;
    type.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    type.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    type.topInPixels = TYPE_Y;
    type.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    type.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    bg.addControl(type);

    // Description — wrapped into its own explicit band so it can't drift up
    // into the type-label or name bands even when the text is tall.
    const desc = new TextBlock(`hand_${idx}_desc`);
    desc.text = "";
    desc.color = "#dddddd";
    desc.fontSize = 12;
    desc.fontFamily = "monospace";
    desc.textWrapping = true;
    desc.widthInPixels = w - 18;
    desc.heightInPixels = DESC_H;
    desc.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    desc.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    desc.topInPixels = DESC_Y;
    desc.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    desc.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    desc.lineSpacing = "3px";
    bg.addControl(desc);

    // "▲ SELECTED" chevron that appears above the currently-selected card.
    const chevron = new TextBlock(`hand_${idx}_chevron`);
    chevron.text = "▲ SELECTED";
    chevron.color = "#ffe066";
    chevron.fontSize = 16;
    chevron.fontFamily = "monospace";
    chevron.fontWeight = "bold";
    chevron.widthInPixels = w;
    chevron.heightInPixels = 20;
    chevron.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    chevron.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    chevron.topInPixels = -22;
    chevron.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    chevron.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    chevron.shadowColor = "#000";
    chevron.shadowOffsetX = 1;
    chevron.shadowOffsetY = 1;
    chevron.isVisible = false;
    bg.addControl(chevron);

    return { bg, hotkey, name, cost, costLabel, type, desc, chevron, flashTimer: 0, popTimer: 0, homeLeft: leftPx, selScale: 1, selAlpha: 1 };
  }

  private setBossVisible(v: boolean): void {
    this.bossBar.bg.isVisible = v;
    this.bossLabel.isVisible = v;
  }

  setRoomIndicator(text: string | null): void {
    this.roomLabel.text = text ?? "";
    this.roomLabel.isVisible = !!text;
  }

  setSelectedSlot(idx: number): void {
    this.selectedSlot = idx;
  }

  setCycleTargetHandler(fn: () => void): void {
    this.onCycleTarget = fn;
  }

  setLockedTargetName(name: string | null): void {
    if (name) {
      this.targetBtnName.text = name;
      this.targetBtnName.color = "#ffffff";
      this.targetBtn.alpha = 1.0;
    } else {
      this.targetBtnName.text = "— no target —";
      this.targetBtnName.color = "#888";
      this.targetBtn.alpha = 0.55;
    }
  }

  update(realDt: number = 1 / 60): void {
    const p = this.player;
    // Clamp here too (the caller already clamps, but HUD must be robust against
    // being called standalone from tests).
    const dt = Math.min(realDt, 1 / 30);

    // HP bar — displayed value lerps toward real HP so damage animates smoothly.
    // Damage-taken slides faster than heal so hits still feel punchy; regen is slow.
    if (this.hpDisplay < 0) this.hpDisplay = p.hp;
    {
      const hpDelta = p.hp - this.hpDisplay;
      if (Math.abs(hpDelta) > 0.01) {
        const k = dampCoeff(hpDelta < 0 ? 18 : 10, dt);
        this.hpDisplay += hpDelta * k;
      } else {
        this.hpDisplay = p.hp;
      }
    }
    const hpRatio = Math.max(0, this.hpDisplay / p.stats.maxHp);
    this.hpBar.fill.widthInPixels = (this.hpBar.width - 4) * hpRatio;
    this.hpBar.caption.text = `HP  ${Math.max(0, Math.round(p.hp))} / ${p.stats.maxHp}`;
    // Low-HP color shift uses the TRUE ratio so the pulse kicks in at the
    // actual threshold, not a smoothed-lagging one.
    const trueHpRatio = Math.max(0, p.hp / p.stats.maxHp);
    if (trueHpRatio > 0 && trueHpRatio < 0.15) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.012);
      const r = Math.round(180 + 60 * pulse);
      this.hpBar.fill.background = `rgb(${r},20,20)`;
    } else if (trueHpRatio < 0.33) {
      this.hpBar.fill.background = "#dd4422";
    } else {
      this.hpBar.fill.background = "#cc3344";
    }

    // AP bar — displayed value lerps toward the true AP so cost deductions slide
    // visibly instead of snapping. Regen still reads instantly (it's tiny).
    if (this.apDisplay < 0) this.apDisplay = p.ap;
    const apDelta = p.ap - this.apDisplay;
    if (Math.abs(apDelta) > 0.01) {
      // Drain faster than regen so the slide doesn't feel sluggish.
      const speed = apDelta < 0 ? 10 : 6;
      this.apDisplay += apDelta * dampCoeff(speed, dt);
    } else {
      this.apDisplay = p.ap;
    }
    const apRatio = Math.max(0, this.apDisplay / p.stats.maxAp);
    this.apBar.fill.widthInPixels = (this.apBar.width - 4) * apRatio;
    this.apBar.caption.text = `AP  ${this.apDisplay.toFixed(1)} / ${p.stats.maxAp}`;
    // CARD_FAIL feedback — red flash on the fill + a small horizontal wiggle
    // on the bg so the AP cost is unmistakably the reason the cast failed.
    if (this.apFailFlashTimer > 0) {
      this.apFailFlashTimer = Math.max(0, this.apFailFlashTimer - dt);
      const t = this.apFailFlashTimer / 0.45;
      // Tint the fill toward red, fading back as t → 0.
      this.apBar.fill.background = t > 0.5 ? "#ff3030" : `rgb(${Math.round(60 + 195 * t)}, ${Math.round(150 - 100 * t)}, ${Math.round(255 - 200 * t)})`;
      // Wiggle the bar background horizontally — small amplitude that decays.
      const wiggle = Math.sin(t * Math.PI * 18) * 6 * t;
      this.apBar.bg.leftInPixels = 24 + wiggle;
    } else {
      this.apBar.fill.background = "#3399ff";
      this.apBar.bg.leftInPixels = 24;
    }

    // Tempo bar — lerp the rendered width for a second layer of smoothing on top
    // of the tempo system's internal 55/s approach. The numeric readout uses the
    // true value so it still updates crisply.
    if (this.tempoDisplay < 0) this.tempoDisplay = this.tempo.value;
    {
      const tempoDelta = this.tempo.value - this.tempoDisplay;
      if (Math.abs(tempoDelta) > 0.05) {
        this.tempoDisplay += tempoDelta * dampCoeff(18, dt);
      } else {
        this.tempoDisplay = this.tempo.value;
      }
    }
    const tempoPct = this.tempoDisplay / 100;
    this.tempoBar.fill.widthInPixels = (this.tempoBar.width - 4) * tempoPct;
    this.tempoBar.fill.background = this.tempo.zoneFillColor();
    this.tempoBar.caption.text = `TEMPO  ${Math.round(this.tempo.value)}`;
    const zone = this.tempo.stateName();
    this.tempoZoneLabel.text = zone;
    this.tempoZoneLabel.color = this.tempo.zoneColor();

    // Crash-ready badge: visible when tempo>=85 and not currently crashed
    const crashReady = this.tempo.value >= 85 && !this.tempo.isCrashed;
    this.crashBadge.isVisible = crashReady;
    if (crashReady) {
      this.crashBadgePulse += 0.12;
      this.crashBadge.alpha = 0.55 + 0.45 * Math.abs(Math.sin(this.crashBadgePulse));
    }

    // Enemy counter
    this.enemyCounter.text = `Enemies: ${this.enemies.aliveCount()}`;

    // Boss bar
    let boss = null;
    for (const e of this.enemies.enemies) {
      if (e.alive && e.def.name.startsWith("boss_")) { boss = e; break; }
    }
    const showBoss = !!boss;
    this.setBossVisible(showBoss);
    if (boss) {
      const pct = Math.max(0, boss.hp / boss.def.hp);
      this.bossBar.fill.widthInPixels = (this.bossBar.width - 4) * pct;
      this.bossLabel.text = `${boss.def.name.replace("boss_", "").toUpperCase()}  ${Math.max(0, Math.round(boss.hp))} / ${boss.def.hp}`;
      // Pulse yellow for ~0.6s after BOSS_PHASE fires; desaturate afterward to show "wounded".
      if (this.bossFlashTimer > 0) {
        this.bossFlashTimer = Math.max(0, this.bossFlashTimer - dt);
        const t = this.bossFlashTimer / 0.6;
        const r = Math.round(255);
        const g = Math.round(180 + 50 * t);
        const b = Math.round(80 * t);
        this.bossBar.fill.background = `rgb(${r},${g},${b})`;
      } else if (pct < 0.5) {
        this.bossBar.fill.background = "#a11a00"; // desaturated wounded red
      } else {
        this.bossBar.fill.background = "#cc2200";
      }
    }

    // Hand slots — bigger hotkey, type-colored border, AP-affordability dim, brief play flash.
    // The selected slot gets a thick gold border, "▲ SELECTED" chevron, and a breathing pulse
    // so the player always knows which card LMB will cast.
    this.selectedPulse += 0.12;
    const selectedBreath = 0.55 + 0.45 * Math.abs(Math.sin(this.selectedPulse));
    for (let i = 0; i < 4; i++) {
      const slot = this.hand[i];
      const isSelected = i === this.selectedSlot;
      const card = this.deck.peek(i);
      if (card) {
        const tColor = TYPE_COLOR[card.type];
        slot.name.text = card.name;
        slot.type.text = TYPE_LABEL[card.type];
        slot.type.color = tColor;
        slot.desc.text = card.desc;
        slot.desc.isVisible = true;
        slot.cost.text = String(card.cost);
        slot.costLabel.isVisible = true;
        slot.hotkey.isVisible = true;
        const affordable = p.ap >= card.cost;
        const flashBoost = slot.flashTimer > 0 ? slot.flashTimer / 0.32 : 0;
        slot.bg.alpha = (affordable ? 1.0 : 0.5) * (1 - 0.3 * flashBoost) + 0.3 * flashBoost;
        slot.cost.color = affordable ? "#44ccff" : "#ff5555";
        slot.bg.background = flashBoost > 0
          ? `rgba(${Math.round(40 + 80 * flashBoost)},${Math.round(40 + 80 * flashBoost)},${Math.round(60 + 80 * flashBoost)},0.94)`
          : (isSelected ? "#1f1a0ceb" : "#0e0e14e0");
        if (isSelected) {
          slot.bg.color = "#ffe066";
          slot.bg.thickness = 6;
          slot.chevron.isVisible = true;
          slot.chevron.alpha = selectedBreath;
          slot.bg.alpha = Math.min(1, slot.bg.alpha + 0.15 * selectedBreath);
        } else {
          slot.bg.color = tColor;
          slot.bg.thickness = 3;
          slot.chevron.isVisible = false;
        }
      } else {
        slot.name.text = "";
        slot.type.text = "";
        slot.cost.text = "";
        slot.desc.text = "";
        slot.desc.isVisible = false;
        slot.costLabel.isVisible = false;
        slot.hotkey.isVisible = false;
        slot.bg.color = "#333";
        slot.bg.thickness = 2;
        slot.bg.alpha = 0.25;
        slot.bg.background = "#0a0a0ec0";
        slot.chevron.isVisible = false;
      }
      if (slot.flashTimer > 0) slot.flashTimer = Math.max(0, slot.flashTimer - dt);
      // Smooth selection scale + alpha — replaces the previous instant snap when
      // the selected slot changed. Selected lands at 1.15 / full alpha; unselected
      // settles at 1.0 / 0.9. Composes with the pop animation below.
      const scaleTarget = isSelected ? 1.12 : 1.0;
      const alphaTarget = isSelected ? 1.0 : 0.9;
      slot.selScale += (scaleTarget - slot.selScale) * dampCoeff(20, dt);
      slot.selAlpha += (alphaTarget - slot.selAlpha) * dampCoeff(18, dt);
      // Pop animation — scale 1→1.22→1 via sine. Scaling `scaleX`/`scaleY` on a
      // Babylon GUI control scales around its origin; the slot is anchored to
      // bottom-center so the growth reads as "jumping up" toward the player.
      let popBump = 0;
      if (slot.popTimer > 0) {
        slot.popTimer = Math.max(0, slot.popTimer - dt);
        const tPop = 1 - slot.popTimer / 0.22;
        popBump = Math.sin(tPop * Math.PI) * 0.22;
      }
      const totalScale = slot.selScale + popBump;
      slot.bg.scaleX = totalScale;
      slot.bg.scaleY = totalScale;
      // Multiply the pre-computed bg.alpha (affordability + flash) by the
      // selection-smoothed value so the tween is purely additive.
      slot.bg.alpha = slot.bg.alpha * slot.selAlpha;
    }

    // Relic-badge pop-in — scale 0.2 → 1.15 → 1.0 with overshoot over 0.32s,
    // alpha 0 → 1 in the first half. `popT` is a per-badge timer that only ticks
    // while < 1; once full it stops touching the badge.
    const POP_DUR = 0.32;
    for (const b of this.relicBadges) {
      if (b.popT >= 1) continue;
      b.popT = Math.min(1, b.popT + dt / POP_DUR);
      const t = b.popT;
      // Easing: 0 → 1.15 at t=0.6 → 1.0 at t=1. Piecewise quadratic.
      let s: number;
      if (t < 0.6) {
        const u = t / 0.6;
        s = 0.2 + (1.15 - 0.2) * (1 - (1 - u) * (1 - u));
      } else {
        const u = (t - 0.6) / 0.4;
        s = 1.15 + (1.0 - 1.15) * u * u;
      }
      b.bg.scaleX = s;
      b.bg.scaleY = s;
      b.bg.alpha = Math.min(1, t * 2);
    }

    // Banner slide-in — y-translate from (home - 30) up to home with cubic ease-out,
    // alpha 0 → 1 in the same window. Runs once per setBanner().
    if (this.bannerAnimT > 0 && this.bannerAnimT < this.BANNER_ANIM_DUR) {
      this.bannerAnimT = Math.min(this.BANNER_ANIM_DUR, this.bannerAnimT + dt);
      const u = this.bannerAnimT / this.BANNER_ANIM_DUR; // 0 → 1
      const eased = 1 - Math.pow(1 - u, 3);
      this.banner.topInPixels = this.bannerHomeTop - 30 * (1 - eased);
      this.banner.alpha = eased;
      if (this.bannerAnimT >= this.BANNER_ANIM_DUR) {
        this.banner.topInPixels = this.bannerHomeTop;
        this.banner.alpha = 1;
        this.bannerAnimT = 0;
      }
    }

    // Wipe alpha animation — driven each frame toward wipeTargetAlpha.
    if (this.wipeAlpha !== this.wipeTargetAlpha) {
      const step = this.wipeAlphaSpeed * dt;
      if (this.wipeAlpha < this.wipeTargetAlpha) {
        this.wipeAlpha = Math.min(this.wipeTargetAlpha, this.wipeAlpha + step);
      } else {
        this.wipeAlpha = Math.max(this.wipeTargetAlpha, this.wipeAlpha - step);
      }
      this.wipe.alpha = this.wipeAlpha;
    }

    // Relic banner + ring animation.
    if (this.relicBannerTtl > 0) {
      this.relicBannerTtl = Math.max(0, this.relicBannerTtl - dt);
      const t = this.relicBannerTtl / 1.2;
      this.relicBanner.alpha = Math.min(1, t * 1.5);
      if (this.relicBannerTtl === 0) this.relicBanner.isVisible = false;
    }
    if (this.relicRingTtl > 0) {
      this.relicRingTtl = Math.max(0, this.relicRingTtl - dt);
      const t = 1 - this.relicRingTtl / 0.55;
      const size = 120 + 700 * t;
      this.relicRing.widthInPixels = size;
      this.relicRing.heightInPixels = size;
      this.relicRing.cornerRadius = size / 2;
      this.relicRing.alpha = (1 - t) * 0.9;
      if (this.relicRingTtl === 0) this.relicRing.isVisible = false;
    }

    // Metronome tick — pulses the dot alpha at the Tempo decay cadence. Only
    // animates when visible so we skip the trig work when the relic isn't equipped.
    if (this.metronomeDot.isVisible) {
      this.metronomeClock += dt * 6; // ~1Hz visible beat
      const pulse = 0.4 + 0.6 * Math.abs(Math.sin(this.metronomeClock));
      this.metronomeDot.alpha = pulse;
    }

    // Combo counter — slight scale pulse on recent kills, fade when the window lapses.
    if (this.comboTtl > 0) {
      this.comboTtl = Math.max(0, this.comboTtl - dt);
      const t = this.comboTtl / 1.5;
      this.comboLabel.alpha = Math.min(1, t * 2);
      // Grow with combo size so 8-chain is visually louder than 3-chain.
      const sizeBoost = Math.min(18, (this.comboCount - 2) * 3);
      this.comboLabel.fontSize = 28 + sizeBoost;
      if (this.comboTtl === 0) {
        this.comboLabel.isVisible = false;
        this.comboCount = 0;
      }
    }
  }

  setBanner(text: string | null): void {
    if (text) {
      // Restart the slide-in animation whenever a banner is shown — even if the
      // previous banner was still mid-slide, the new text should get its own
      // entrance moment.
      const wasSame = this.banner.text === text && this.banner.isVisible;
      this.banner.text = text;
      this.banner.isVisible = true;
      if (!wasSame) this.bannerAnimT = 0.0001; // trip the animation timer
    } else {
      this.banner.isVisible = false;
      this.bannerAnimT = 0;
      this.banner.topInPixels = this.bannerHomeTop;
      this.banner.alpha = 1;
    }
  }

  dispose(): void {
    this.ui.dispose();
  }
}
