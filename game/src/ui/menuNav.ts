import type { Input } from "../core/input";

/**
 * Gamepad navigation for the DOM menu overlays. While any `.screen` overlay is
 * open and a controller is the active input, the dpad / left stick move a focus
 * ring (`.nav-focus`) through the focusable elements with geometry-aware
 * up/down/left/right, A activates the focused element, and B clicks a
 * Back / Leave / skip control. Mouse and keyboard are untouched — picking up the
 * mouse simply drops the ring.
 *
 * Focus is tracked manually (not native DOM focus) so it works on the menus'
 * clickable <div>s (cards, hero tiles, map nodes) without retrofitting tabindex.
 */
const NAV_SEL = 'button:not([disabled]), .hero-card, .card, .mapnode, .shop-item, [data-nav]';
const REPEAT_DELAY = 0.4; // first hold-to-repeat delay (s)
const REPEAT_RATE = 0.14; // subsequent repeats (s)

type Dir = "" | "up" | "down" | "left" | "right";

export class MenuNav {
  private root: HTMLElement | null = null;
  private current: HTMLElement | null = null;
  private lastDir: Dir = "";
  private repeatTimer = 0;

  constructor(private input: Input) {}

  /** Called every frame while not in active gameplay. No-op without a controller. */
  update(dt: number): void {
    if (!this.input.gamepadConnected || !this.input.usingGamepad) {
      if (this.current) this.setCurrent(null); // hand control back to the mouse
      return;
    }

    const screen = document.querySelector<HTMLElement>(".screen");
    if (screen !== this.root) {
      this.root = screen;
      this.setCurrent(null);
      this.lastDir = "";
      this.repeatTimer = 0;
    }
    if (!this.root) return;

    // Story cutscenes: A advances to the next line, B skips the whole thing — no ring.
    if (this.root.classList.contains("story")) {
      if (this.current) this.setCurrent(null);
      if (this.input.padEdge(0)) {
        this.input.consumePadEdge(0, 1);
        this.root.click();
      } else if (this.input.padEdge(1)) {
        this.input.consumePadEdge(0, 1);
        this.root.querySelector<HTMLElement>(".story-skip")?.click();
      }
      return;
    }

    // Acquire the ring on first pad use without also firing A that same frame.
    if (!this.current || !this.root.contains(this.current) || !this.visible(this.current)) {
      this.focusFirst();
      this.input.consumePadEdge(0, 1);
      return;
    }

    const dir = this.readDir(dt);
    if (dir) {
      this.move(dir);
      return;
    }
    if (this.input.padEdge(0)) {
      this.input.consumePadEdge(0, 1);
      this.current.click();
      return;
    }
    if (this.input.padEdge(1)) {
      this.input.consumePadEdge(0, 1);
      this.back();
    }
  }

  private items(): HTMLElement[] {
    if (!this.root) return [];
    return Array.from(this.root.querySelectorAll<HTMLElement>(NAV_SEL)).filter((e) => this.visible(e));
  }

  private visible(e: HTMLElement): boolean {
    return e.offsetParent !== null && !(e as HTMLButtonElement).disabled;
  }

  private setCurrent(el: HTMLElement | null): void {
    if (this.current === el) return;
    this.current?.classList.remove("nav-focus");
    this.current = el;
    if (el) {
      el.classList.add("nav-focus");
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  /** Prefer the primary action, else the first card/tile, else the first control. */
  private focusFirst(): void {
    const items = this.items();
    const primary = items.find(
      (e) =>
        e.classList.contains("btn--primary") ||
        e.classList.contains("hero-card") ||
        e.classList.contains("card") ||
        e.classList.contains("mapnode")
    );
    this.setCurrent(primary ?? items[0] ?? null);
  }

  private readDir(dt: number): Dir {
    // Dpad edges step once; the stick uses hold-to-repeat.
    if (this.input.padEdge(12)) return "up";
    if (this.input.padEdge(13)) return "down";
    if (this.input.padEdge(14)) return "left";
    if (this.input.padEdge(15)) return "right";
    const ax = this.input.padAxis(0);
    const ay = this.input.padAxis(1);
    let d: Dir = "";
    if (Math.abs(ax) > 0.5 || Math.abs(ay) > 0.5) {
      if (Math.abs(ay) >= Math.abs(ax)) d = ay < 0 ? "up" : "down";
      else d = ax < 0 ? "left" : "right";
    }
    if (!d) {
      this.lastDir = "";
      this.repeatTimer = 0;
      return "";
    }
    if (d !== this.lastDir) {
      this.lastDir = d;
      this.repeatTimer = REPEAT_DELAY;
      return d;
    }
    this.repeatTimer -= dt;
    if (this.repeatTimer <= 0) {
      this.repeatTimer = REPEAT_RATE;
      return d;
    }
    return "";
  }

  /** Move the ring to the nearest item in `dir` (favouring alignment, then distance). */
  private move(dir: Exclude<Dir, "">): void {
    const items = this.items();
    if (!items.length) return;
    if (!this.current) {
      this.focusFirst();
      return;
    }
    const r = this.current.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const vertical = dir === "up" || dir === "down";
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const e of items) {
      if (e === this.current) continue;
      const b = e.getBoundingClientRect();
      const dx = b.left + b.width / 2 - cx;
      const dy = b.top + b.height / 2 - cy;
      const ok = dir === "up" ? dy < -4 : dir === "down" ? dy > 4 : dir === "left" ? dx < -4 : dx > 4;
      if (!ok) continue;
      const along = vertical ? Math.abs(dy) : Math.abs(dx);
      const across = vertical ? Math.abs(dx) : Math.abs(dy);
      const score = along + across * 2.4; // strongly prefer the aligned row/column
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (best) this.setCurrent(best);
  }

  /** B button: click the screen's Back / Leave / skip control if it has one. */
  private back(): void {
    const b = this.items().find(
      (e) =>
        e.dataset.act === "back" ||
        e.dataset.act === "leave" ||
        /^(back|leave|move on|cancel)/i.test((e.textContent || "").trim())
    );
    if (b) {
      b.click();
      return;
    }
    this.root?.querySelector<HTMLElement>(".draft-skip")?.click();
  }
}
