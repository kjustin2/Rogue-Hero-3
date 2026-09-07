import type { Ctx } from "../game/ctx";

/** Optional F8 display for manual play. No recording, scanning, or benchmark work. */
export class PerfMonitor {
  private visible = false;
  private panel: HTMLDivElement | null = null;
  private elapsed = 0;
  private frames = 0;
  private lastNow = 0;
  private interval = 0;
  constructor(private ctx: Ctx, private getState: () => string) {
    window.addEventListener("keydown", event => {
      if (event.code === "F8" && !event.repeat) { event.preventDefault(); this.toggle(); }
    });
    if (new URLSearchParams(location.search).has("perf")) this.toggle();
  }
  toggle(): void {
    this.visible = !this.visible;
    this.ctx.stage.renderer.info.autoReset = !this.visible;
    this.lastNow = 0;
    this.elapsed = this.frames = 0;
    if (!this.panel && this.visible) {
      this.panel = document.createElement("div");
      this.panel.style.cssText = "position:fixed;left:16px;bottom:70px;z-index:2000;padding:10px 14px;background:#090e18ed;color:#c6e2ec;font:12px/1.6 monospace;pointer-events:none;white-space:pre";
      document.body.append(this.panel);
    }
    if (this.panel) this.panel.hidden = !this.visible;
  }
  begin(now: number): void {
    if (!this.visible) return;
    this.interval = this.lastNow ? now - this.lastNow : 0;
    this.lastNow = now;
    this.ctx.stage.renderer.info.reset();
  }
  end(_dt: number): void {
    if (!this.visible || !this.panel) return;
    this.elapsed += this.interval;
    this.frames++;
    if (this.elapsed < 500) return;
    const info = this.ctx.stage.renderer.info;
    this.panel.textContent = Math.round(this.frames * 1000 / this.elapsed) + " FPS · " + this.getState() + "\n" + info.render.calls + " draws · " + Math.round(info.render.triangles / 1000) + "k triangles · " + this.ctx.enemies.remaining + " enemies";
    this.elapsed = this.frames = 0;
  }
}
