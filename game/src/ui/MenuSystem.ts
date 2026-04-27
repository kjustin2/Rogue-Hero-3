import { Scene } from "@babylonjs/core/scene";
import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture";
import { Rectangle } from "@babylonjs/gui/2D/controls/rectangle";
import { TextBlock } from "@babylonjs/gui/2D/controls/textBlock";
import { Control } from "@babylonjs/gui/2D/controls/control";

export type StartChoice = "start" | "quit";
export type PauseChoice = "resume" | "mainMenu" | "quit";

interface MenuButton {
  bg: Rectangle;
  label: TextBlock;
}

/**
 * Layout constants — every panel + button is sized in absolute pixels so text
 * has a guaranteed band that can't be pushed out by the renderer's auto-fit.
 * idealWidth=1920 keeps these stable across window sizes.
 */
const PANEL_W = 520;
const PANEL_PAD = 32;
const TITLE_H = 64;
const SUBTITLE_H = 28;
const BTN_W = PANEL_W - PANEL_PAD * 2;
const BTN_H = 56;
const BTN_GAP = 14;

const CONTROLS_PANEL_W = 640;
const CONTROLS_PANEL_H = 520;

/**
 * Start menu + pause menu + shared controls overlay. One AdvancedDynamicTexture
 * shared across all three so we only pay one fullscreen texture cost. Panels are
 * built once and toggled via isVisible — no per-show allocation.
 */
export class MenuSystem {
  private ui: AdvancedDynamicTexture;
  private dim: Rectangle;

  private startPanel: Rectangle;
  private pausePanel: Rectangle;
  private controlsPanel: Rectangle;

  /** Resolves the active showStartMenu / showPauseMenu Promise. Cleared after fire. */
  private startResolve: ((c: StartChoice) => void) | null = null;
  private pauseResolve: ((c: PauseChoice) => void) | null = null;

  /** True while the controls panel is the active modal. ESC closes it back to its parent menu. */
  private controlsParent: "start" | "pause" | null = null;

  /** True once the player clicks START — used to show "RESUME" pulse on the pause menu. */

  constructor(scene: Scene) {
    this.ui = AdvancedDynamicTexture.CreateFullscreenUI("menuUI", true, scene);
    this.ui.idealWidth = 1920;

    // Heavy dim — gameplay still renders behind so the player has visual
    // context, but text needs to be readable so we go almost-opaque.
    this.dim = new Rectangle("menuDim");
    this.dim.background = "#000000ee";
    this.dim.thickness = 0;
    this.dim.width = "100%";
    this.dim.height = "100%";
    this.dim.isPointerBlocker = true;
    this.dim.isVisible = false;
    this.ui.addControl(this.dim);

    this.startPanel = this.buildStartPanel();
    this.pausePanel = this.buildPausePanel();
    this.controlsPanel = this.buildControlsPanel();

    this.dim.addControl(this.startPanel);
    this.dim.addControl(this.pausePanel);
    this.dim.addControl(this.controlsPanel);

    this.startPanel.isVisible = false;
    this.pausePanel.isVisible = false;
    this.controlsPanel.isVisible = false;
  }

  /** True when any menu UI is currently presented. Used to gate Esc handling. */
  get isAnyOpen(): boolean {
    return this.startPanel.isVisible || this.pausePanel.isVisible || this.controlsPanel.isVisible;
  }

  /** True when the start menu (or its controls overlay) is showing. */
  get isStartOpen(): boolean {
    return this.startPanel.isVisible || (this.controlsPanel.isVisible && this.controlsParent === "start");
  }

  /** True when the pause menu (or its controls overlay) is showing. */
  get isPauseOpen(): boolean {
    return this.pausePanel.isVisible || (this.controlsPanel.isVisible && this.controlsParent === "pause");
  }

  showStartMenu(): Promise<StartChoice> {
    this.dim.isVisible = true;
    this.startPanel.isVisible = true;
    this.pausePanel.isVisible = false;
    this.controlsPanel.isVisible = false;
    this.controlsParent = null;
    return new Promise<StartChoice>((res) => {
      this.startResolve = res;
    });
  }

  showPauseMenu(): Promise<PauseChoice> {
    this.dim.isVisible = true;
    this.pausePanel.isVisible = true;
    this.startPanel.isVisible = false;
    this.controlsPanel.isVisible = false;
    this.controlsParent = null;
    return new Promise<PauseChoice>((res) => {
      this.pauseResolve = res;
    });
  }

  hide(): void {
    this.dim.isVisible = false;
    this.startPanel.isVisible = false;
    this.pausePanel.isVisible = false;
    this.controlsPanel.isVisible = false;
    this.controlsParent = null;
  }

  /**
   * Used by main.ts's window keydown handler — Escape closes the controls
   * overlay (back to its parent menu), or in the pause menu it resolves
   * "resume". Returns true if the key was consumed.
   */
  handleEscape(): boolean {
    if (this.controlsPanel.isVisible) {
      this.closeControls();
      return true;
    }
    if (this.pausePanel.isVisible) {
      this.resolvePause("resume");
      return true;
    }
    // Start menu doesn't react to Escape — there's nowhere to go back to.
    return false;
  }

  private buildStartPanel(): Rectangle {
    const panel = this.makePanel("startPanel", PANEL_W, 540);

    // Title
    const title = this.makeText("ROGUE HERO 3", "#ffcc44", 56, "bold");
    title.heightInPixels = TITLE_H;
    title.widthInPixels = PANEL_W - PANEL_PAD * 2;
    title.topInPixels = 36;
    title.outlineColor = "#000";
    title.outlineWidth = 6;
    title.shadowOffsetX = 3;
    title.shadowOffsetY = 3;
    title.shadowColor = "#000";
    title.shadowBlur = 0;
    title.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    title.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    panel.addControl(title);

    const subtitle = this.makeText("Vertical Slice — Blade vs Brawler", "#aaaaaa", 18);
    subtitle.heightInPixels = SUBTITLE_H;
    subtitle.widthInPixels = PANEL_W - PANEL_PAD * 2;
    subtitle.topInPixels = 36 + TITLE_H + 4;
    subtitle.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    subtitle.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    panel.addControl(subtitle);

    // Buttons stacked below subtitle.
    const buttonsTop = 36 + TITLE_H + 4 + SUBTITLE_H + 28;
    const startBtn = this.makeButton("START", "#ffcc44", "#1a1208");
    this.placeButton(panel, startBtn, buttonsTop);
    startBtn.bg.onPointerClickObservable.add(() => this.resolveStart("start"));

    const controlsBtn = this.makeButton("CONTROLS", "#88ccff", "#0c1620");
    this.placeButton(panel, controlsBtn, buttonsTop + (BTN_H + BTN_GAP));
    controlsBtn.bg.onPointerClickObservable.add(() => this.openControls("start"));

    const quitBtn = this.makeButton("QUIT", "#ff7766", "#1a0c0a");
    this.placeButton(panel, quitBtn, buttonsTop + (BTN_H + BTN_GAP) * 2);
    quitBtn.bg.onPointerClickObservable.add(() => this.resolveStart("quit"));

    // Hint at the bottom of the panel — ensures players know they can use the
    // mouse OR a keyboard click to confirm.
    const hint = this.makeText("Click a button to begin", "#666666", 13);
    hint.widthInPixels = PANEL_W - PANEL_PAD * 2;
    hint.heightInPixels = 18;
    hint.topInPixels = -PANEL_PAD;
    hint.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    hint.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
    panel.addControl(hint);

    return panel;
  }

  private buildPausePanel(): Rectangle {
    const panel = this.makePanel("pausePanel", PANEL_W, 460);

    const title = this.makeText("PAUSED", "#ffcc44", 56, "bold");
    title.heightInPixels = TITLE_H;
    title.widthInPixels = PANEL_W - PANEL_PAD * 2;
    title.topInPixels = 36;
    title.outlineColor = "#000";
    title.outlineWidth = 6;
    title.shadowOffsetX = 3;
    title.shadowOffsetY = 3;
    title.shadowColor = "#000";
    title.shadowBlur = 0;
    title.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    title.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    panel.addControl(title);

    const subtitle = this.makeText("Press Esc to resume", "#aaaaaa", 16);
    subtitle.heightInPixels = SUBTITLE_H;
    subtitle.widthInPixels = PANEL_W - PANEL_PAD * 2;
    subtitle.topInPixels = 36 + TITLE_H + 6;
    subtitle.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    subtitle.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    panel.addControl(subtitle);

    const buttonsTop = 36 + TITLE_H + 6 + SUBTITLE_H + 22;
    const resumeBtn = this.makeButton("RESUME", "#ffcc44", "#1a1208");
    this.placeButton(panel, resumeBtn, buttonsTop);
    resumeBtn.bg.onPointerClickObservable.add(() => this.resolvePause("resume"));

    const controlsBtn = this.makeButton("CONTROLS", "#88ccff", "#0c1620");
    this.placeButton(panel, controlsBtn, buttonsTop + (BTN_H + BTN_GAP));
    controlsBtn.bg.onPointerClickObservable.add(() => this.openControls("pause"));

    const menuBtn = this.makeButton("MAIN MENU", "#ff9966", "#1a0e08");
    this.placeButton(panel, menuBtn, buttonsTop + (BTN_H + BTN_GAP) * 2);
    menuBtn.bg.onPointerClickObservable.add(() => this.resolvePause("mainMenu"));

    return panel;
  }

  private buildControlsPanel(): Rectangle {
    const panel = this.makePanel("controlsPanel", CONTROLS_PANEL_W, CONTROLS_PANEL_H);

    const title = this.makeText("CONTROLS", "#ffcc44", 38, "bold");
    title.heightInPixels = 48;
    title.widthInPixels = CONTROLS_PANEL_W - PANEL_PAD * 2;
    title.topInPixels = 28;
    title.outlineColor = "#000";
    title.outlineWidth = 4;
    title.shadowOffsetX = 2;
    title.shadowOffsetY = 2;
    title.shadowColor = "#000";
    title.shadowBlur = 0;
    title.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    title.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    panel.addControl(title);

    // Two-column key/action list. A single TextBlock with explicit lines and a
    // monospace font keeps alignment trivial — no need for a grid layout.
    const lines = [
      "WASD / Arrows         Move",
      "Mouse                 Aim",
      "Left Mouse            Use selected card",
      "Right Mouse           Cycle selected card",
      "1 / 2 / 3 / 4         Select card slot",
      "Space / Shift         Dodge (i-frames)",
      "F                     Crash (Tempo ≥ 85)",
      "Q / Tab               Switch target",
      "Hold RMB              Orbit camera",
      "Mouse Wheel           Zoom",
      "G                     Cycle graphics tier",
      "R                     Restart on Defeat / Victory",
      "Esc                   Pause menu",
    ];
    const list = new TextBlock("controlsList");
    list.text = lines.join("\n");
    list.color = "#e6e6e6";
    list.fontSize = 17;
    list.fontFamily = "monospace";
    list.lineSpacing = "6px";
    list.shadowColor = "#000";
    list.shadowOffsetX = 1;
    list.shadowOffsetY = 1;
    list.shadowBlur = 0;
    list.outlineColor = "#000";
    list.outlineWidth = 2;
    list.widthInPixels = CONTROLS_PANEL_W - PANEL_PAD * 2;
    list.heightInPixels = CONTROLS_PANEL_H - 48 - 28 - 80; // title + bottom button band
    list.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    list.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    list.topInPixels = 28 + 48 + 16;
    list.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    list.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    list.paddingLeftInPixels = 24;
    panel.addControl(list);

    // Back button — anchored to the panel's bottom so the body region between
    // it and the title can host any number of lines without colliding.
    const backBtn = this.makeButton("BACK", "#88ccff", "#0c1620");
    backBtn.bg.heightInPixels = 48;
    backBtn.bg.widthInPixels = 220;
    backBtn.label.fontSize = 22;
    backBtn.bg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    backBtn.bg.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
    backBtn.bg.topInPixels = -PANEL_PAD;
    backBtn.bg.onPointerClickObservable.add(() => this.closeControls());
    panel.addControl(backBtn.bg);

    const hint = this.makeText("Esc closes this panel", "#666666", 12);
    hint.heightInPixels = 16;
    hint.widthInPixels = CONTROLS_PANEL_W - PANEL_PAD * 2;
    hint.topInPixels = -PANEL_PAD - 48 - 6;
    hint.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    hint.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
    panel.addControl(hint);

    return panel;
  }

  private makePanel(name: string, w: number, h: number): Rectangle {
    const r = new Rectangle(name);
    r.widthInPixels = w;
    r.heightInPixels = h;
    r.background = "#0a0a14f4";
    r.color = "#ffcc44";
    r.thickness = 3;
    r.cornerRadius = 12;
    r.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    r.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    r.isPointerBlocker = true;
    return r;
  }

  private makeText(text: string, color: string, size: number, weight = "normal"): TextBlock {
    const t = new TextBlock();
    t.text = text;
    t.color = color;
    t.fontSize = size;
    t.fontFamily = "monospace";
    t.fontWeight = weight;
    t.shadowColor = "#000";
    t.shadowOffsetX = 1;
    t.shadowOffsetY = 1;
    t.shadowBlur = 0;
    t.outlineColor = "#000";
    t.outlineWidth = size <= 14 ? 1 : 2;
    t.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    t.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    return t;
  }

  private makeButton(text: string, accent: string, bgColor: string): MenuButton {
    const bg = new Rectangle(`btn_${text}`);
    bg.widthInPixels = BTN_W;
    bg.heightInPixels = BTN_H;
    bg.background = bgColor;
    bg.color = accent;
    bg.thickness = 2;
    bg.cornerRadius = 8;
    bg.isPointerBlocker = true;
    bg.hoverCursor = "pointer";
    bg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    bg.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;

    const label = new TextBlock(`btnLabel_${text}`);
    label.text = text;
    label.color = accent;
    label.fontSize = 26;
    label.fontFamily = "monospace";
    label.fontWeight = "bold";
    label.shadowColor = "#000";
    label.shadowOffsetX = 2;
    label.shadowOffsetY = 2;
    label.shadowBlur = 0;
    label.outlineColor = "#000";
    label.outlineWidth = 3;
    label.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    label.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    label.widthInPixels = BTN_W - 16;
    label.heightInPixels = BTN_H - 8;
    bg.addControl(label);

    // Hover/press feedback — brighter background, subtle scale pop.
    bg.onPointerEnterObservable.add(() => {
      bg.background = lighten(bgColor);
      bg.scaleX = 1.03;
      bg.scaleY = 1.03;
    });
    bg.onPointerOutObservable.add(() => {
      bg.background = bgColor;
      bg.scaleX = 1;
      bg.scaleY = 1;
    });

    return { bg, label };
  }

  private placeButton(panel: Rectangle, btn: MenuButton, top: number): void {
    btn.bg.topInPixels = top;
    panel.addControl(btn.bg);
  }

  private openControls(parent: "start" | "pause"): void {
    this.controlsParent = parent;
    this.startPanel.isVisible = false;
    this.pausePanel.isVisible = false;
    this.controlsPanel.isVisible = true;
  }

  private closeControls(): void {
    this.controlsPanel.isVisible = false;
    if (this.controlsParent === "start") this.startPanel.isVisible = true;
    else if (this.controlsParent === "pause") this.pausePanel.isVisible = true;
    this.controlsParent = null;
  }

  private resolveStart(c: StartChoice): void {
    const fn = this.startResolve;
    this.startResolve = null;
    if (fn) fn(c);
  }

  private resolvePause(c: PauseChoice): void {
    const fn = this.pauseResolve;
    this.pauseResolve = null;
    if (fn) fn(c);
  }
}

/** Lighten a hex color (#rrggbb or #rrggbbaa) by a small amount for hover feedback. */
function lighten(hex: string): string {
  // Accept #rgb or #rrggbb[aa]. Falls back to the input on parse failure.
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex);
  if (!m) return hex;
  const r = Math.min(255, parseInt(m[1].slice(0, 2), 16) + 28);
  const g = Math.min(255, parseInt(m[1].slice(2, 4), 16) + 28);
  const b = Math.min(255, parseInt(m[1].slice(4, 6), 16) + 28);
  const a = m[2] ?? "ff";
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}${a}`;
}
