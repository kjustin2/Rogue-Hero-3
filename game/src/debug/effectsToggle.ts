/**
 * Live effect-bisection panel. Toggle any render feature ON/OFF at runtime so a player can
 * strip everything and add effects back one-by-one to pinpoint a GPU-specific glitch on
 * REAL hardware (which headless/software-rendered tests can't reproduce). Opened with the
 * backtick ` key (also surfaced from the Settings menu). Decoupled: main.ts supplies the
 * apply functions so this module stays render-agnostic.
 */
export interface FxToggle {
  id: string;
  label: string;
  hint?: string;
  /** Called with the new state. */
  apply: (on: boolean) => void;
  /** Initial state (default true). */
  on?: boolean;
}

export class EffectsPanel {
  private root: HTMLDivElement;
  private toggles: FxToggle[];
  private state = new Map<string, boolean>();
  private open = false;

  constructor(toggles: FxToggle[]) {
    this.toggles = toggles;
    for (const t of toggles) this.state.set(t.id, t.on ?? true);
    this.root = document.createElement("div");
    this.root.className = "fxpanel";
    this.root.style.display = "none";
    this.render();
    document.body.appendChild(this.root);
  }

  isOpen(): boolean { return this.open; }
  toggleOpen(): void { this.open = !this.open; this.root.style.display = this.open ? "block" : "none"; }

  private setAll(on: boolean): void {
    for (const t of this.toggles) { this.state.set(t.id, on); t.apply(on); }
    this.render();
  }

  private setOne(id: string, on: boolean): void {
    const t = this.toggles.find((x) => x.id === id);
    if (!t) return;
    this.state.set(id, on);
    t.apply(on);
    this.render();
  }

  private render(): void {
    const rows = this.toggles.map((t) => {
      const on = this.state.get(t.id) ?? true;
      return `<label class="fxpanel__row${on ? "" : " fxpanel__row--off"}">
        <input type="checkbox" data-fx="${t.id}"${on ? " checked" : ""}>
        <span class="fxpanel__label">${t.label}</span>
        ${t.hint ? `<span class="fxpanel__hint">${t.hint}</span>` : ""}
      </label>`;
    }).join("");
    this.root.innerHTML = `
      <div class="fxpanel__title">EFFECT BISECTION <span class="fxpanel__key">\`</span></div>
      <div class="fxpanel__how">Strip All → then re-check ONE at a time. The effect that brings the glitch back is the culprit — tell me its name.</div>
      <div class="fxpanel__btns">
        <button data-fx-all="off">STRIP ALL</button>
        <button data-fx-all="on">RESTORE ALL</button>
      </div>
      <div class="fxpanel__rows">${rows}</div>`;
    this.root.querySelectorAll<HTMLInputElement>("input[data-fx]").forEach((el) => {
      el.addEventListener("change", () => this.setOne(el.dataset.fx!, el.checked));
    });
    this.root.querySelectorAll<HTMLButtonElement>("button[data-fx-all]").forEach((el) => {
      el.addEventListener("click", () => this.setAll(el.dataset.fxAll === "on"));
    });
  }
}
