// Performance instrumentation + on-screen debug overlay.
//
// Goals it serves:
//  • TEST OPTIMIZATIONS — a single, accurate source of per-frame truth (frame
//    pacing + real GPU load: draw calls / triangles / programs) that every perf
//    script can read through `window.__rh3perf`, instead of each script bolting
//    its own rAF probe onto the page.
//  • SEE VISUALS WITH AI — a toggleable on-screen overlay (FPS, frame ms, draw
//    calls, programs, enemy count + a frame-time sparkline) so a single
//    screenshot tells Claude how the frame is performing, not just how it looks.
//
// Cost when idle is one subtraction + one ring-buffer write per frame, so it is
// safe to construct in production (it is, like __rh3, harmless for an offline
// single-player game and nothing reads it unless a test/overlay asks).
//
// Accurate draw-call counting: the postprocessing EffectComposer renders several
// internal passes per frame, and Three's `info.render` auto-resets at the START
// of every `renderer.render()` — so reading `info.render.calls` after a composer
// render reports only the LAST pass. We turn auto-reset OFF and reset once per
// frame in begin(), then read the accumulated total in end(): true per-frame load.

import type { Ctx } from "../game/ctx";

export interface PerfStats {
  /** Wall-clock span the samples cover (ms). */
  ms: number;
  /** Frame samples in the window. */
  frames: number;
  /** Mean frames-per-second over the window. */
  fps: number;
  /** Frame-interval statistics in milliseconds. */
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  /** Counts of frames slower than common budgets (regression tripwires). */
  long16: number; // missed 60fps
  long33: number; // missed 30fps
  long50: number;
  long100: number;
  /** Big synchronous stalls (shader compile / GC) — the freeze class of bug. */
  over250: number;
}

/** A point-in-time snapshot of GPU load + scene size. */
export interface PerfSnapshot {
  calls: number;
  triangles: number;
  points: number;
  lines: number;
  programs: number;
  geometries: number;
  textures: number;
  /** JS heap used in MB, or 0 where performance.memory is unavailable. */
  heapMB: number;
  /** Live (alive) enemies on the field. */
  enemies: number;
  /** Current top-level UI/game state, for context. */
  state: string;
}

interface MemoryPerf extends Performance {
  memory?: { usedJSHeapSize: number };
}

function computeStats(samples: readonly number[]): PerfStats {
  const n = samples.length;
  if (n === 0) {
    return { ms: 0, frames: 0, fps: 0, mean: 0, p50: 0, p95: 0, p99: 0, min: 0, max: 0, long16: 0, long33: 0, long50: 0, long100: 0, over250: 0 };
  }
  let sum = 0, min = Infinity, max = 0;
  let long16 = 0, long33 = 0, long50 = 0, long100 = 0, over250 = 0;
  for (const d of samples) {
    sum += d;
    if (d < min) min = d;
    if (d > max) max = d;
    if (d > 16.7) long16++;
    if (d > 33.4) long33++;
    if (d > 50) long50++;
    if (d > 100) long100++;
    if (d > 250) over250++;
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const pct = (p: number): number => sorted[Math.min(n - 1, Math.floor(n * p))];
  const mean = sum / n;
  return {
    ms: Math.round(sum),
    frames: n,
    fps: mean > 0 ? Math.round((1000 / mean) * 10) / 10 : 0,
    mean: Math.round(mean * 100) / 100,
    p50: Math.round(pct(0.5) * 100) / 100,
    p95: Math.round(pct(0.95) * 100) / 100,
    p99: Math.round(pct(0.99) * 100) / 100,
    min: Math.round(min * 100) / 100,
    max: Math.round(max * 100) / 100,
    long16, long33, long50, long100, over250,
  };
}

const RING = 240; // ~4s of rolling history at 60fps — enough for report() + sparkline

export class PerfMonitor {
  /** Rolling ring of recent frame intervals (ms) — always recording, cheap. */
  private ring = new Float64Array(RING);
  private ringIdx = 0;
  private ringLen = 0;
  private lastNow = 0;

  /** Explicit recording window (start/stop), unbounded so a long scenario keeps
   *  every sample for an accurate p99/over250. */
  private recording = false;
  private recStart = 0;
  private rec: number[] = [];
  private marks: { label: string; t: number }[] = [];

  private snap: PerfSnapshot = {
    calls: 0, triangles: 0, points: 0, lines: 0, programs: 0,
    geometries: 0, textures: 0, heapMB: 0, enemies: 0, state: "?",
  };

  private hudEl: HTMLDivElement | null = null;
  private hudGraph: HTMLCanvasElement | null = null;
  private hudText: HTMLDivElement | null = null;
  private hudOn = false;
  private hudAcc = 0;

  constructor(private ctx: Ctx, private getState: () => string) {
    // Take ownership of the render-info counters so we report true per-frame load.
    this.ctx.stage.renderer.info.autoReset = false;
  }

  /** Top of the frame loop: record the interval and zero the per-frame counters. */
  begin(now: number): void {
    if (this.lastNow) {
      const dt = now - this.lastNow;
      this.ring[this.ringIdx] = dt;
      this.ringIdx = (this.ringIdx + 1) % RING;
      if (this.ringLen < RING) this.ringLen++;
      if (this.recording) this.rec.push(dt);
    }
    this.lastNow = now;
    this.ctx.stage.renderer.info.reset();
  }

  /** End of the frame loop (after render): snapshot GPU load + refresh overlay. */
  end(dt: number): void {
    const info = this.ctx.stage.renderer.info;
    // Per-render counters are only valid on frames that actually rendered — menu
    // mode caps rendering to ~40fps while the loop runs every rAF, so on a skipped
    // frame `calls` is still 0 from begin()'s reset. Keep the last real values then.
    if (info.render.calls > 0) {
      this.snap.calls = info.render.calls;
      this.snap.triangles = info.render.triangles;
      this.snap.points = info.render.points;
      this.snap.lines = info.render.lines;
    }
    this.snap.programs = info.programs?.length ?? 0;
    this.snap.geometries = info.memory.geometries;
    this.snap.textures = info.memory.textures;
    const mem = (performance as MemoryPerf).memory;
    this.snap.heapMB = mem ? Math.round(mem.usedJSHeapSize / 1048576) : 0;
    this.snap.enemies = this.ctx.enemies.living().length;
    this.snap.state = this.getState();

    if (this.hudOn) {
      this.hudAcc += dt;
      if (this.hudAcc >= 0.2) { this.hudAcc = 0; this.refreshHud(); }
    }
  }

  // ───────────────────────────────────────────── scripting / query surface ──

  /** Stats over the recent rolling window (no start/stop needed). */
  report(): PerfStats & { snap: PerfSnapshot } {
    const out: number[] = [];
    const start = this.ringLen < RING ? 0 : this.ringIdx;
    for (let i = 0; i < this.ringLen; i++) out.push(this.ring[(start + i) % RING]);
    return { ...computeStats(out), snap: { ...this.snap } };
  }

  /** Begin an explicit recording window; clears prior samples + marks. */
  start(label = ""): void {
    this.recording = true;
    this.recStart = this.lastNow || performance.now();
    this.rec = [];
    this.marks = label ? [{ label, t: 0 }] : [];
  }

  /** End the recording window; returns its stats + correlated event marks. */
  stop(): PerfStats & { snap: PerfSnapshot; marks: { label: string; t: number }[] } {
    this.recording = false;
    // Drop the first couple of warm-up frames the way the legacy probes did.
    const samples = this.rec.length > 4 ? this.rec.slice(2) : this.rec;
    return { ...computeStats(samples), snap: { ...this.snap }, marks: this.marks.slice() };
  }

  /** Tag the current moment with a label (relative to the recording start) so a
   *  later frame spike can be attributed to the game event that caused it. */
  mark(label: string): void {
    if (this.recording) this.marks.push({ label, t: Math.round((performance.now() - this.recStart)) });
  }

  /** Just the GPU-load / scene snapshot (latest frame). */
  snapshot(): PerfSnapshot { return { ...this.snap }; }

  // ─────────────────────────────────────────────────────────── overlay HUD ──

  /** Toggle (no arg) or set the on-screen overlay. Returns the new state. */
  hud(on?: boolean): boolean {
    this.hudOn = on === undefined ? !this.hudOn : on;
    if (this.hudOn) { this.ensureHud(); this.refreshHud(); if (this.hudEl) this.hudEl.style.display = "block"; }
    else if (this.hudEl) this.hudEl.style.display = "none";
    return this.hudOn;
  }

  private ensureHud(): void {
    if (this.hudEl) return;
    const el = document.createElement("div");
    el.id = "rh3-perf-hud";
    // Sized for legibility in a FULL-FRAME screenshot (AI vision downscales large
    // images, so tiny text becomes unreadable) — large, bold, near-opaque panel.
    el.style.cssText =
      "position:fixed;top:10px;left:10px;z-index:99999;pointer-events:none;" +
      "font:14px/1.4 ui-monospace,Consolas,monospace;color:#dff;font-weight:600;" +
      "background:rgba(4,6,14,.92);border:2px solid rgba(120,170,255,.55);" +
      "border-radius:8px;padding:9px 12px;min-width:236px;letter-spacing:.3px;" +
      "text-shadow:0 1px 2px #000";
    const text = document.createElement("div");
    const graph = document.createElement("canvas");
    graph.width = 232; graph.height = 40;
    graph.style.cssText = "display:block;margin-top:7px;width:232px;height:40px;border-radius:4px;background:rgba(0,0,0,.45)";
    el.appendChild(text);
    el.appendChild(graph);
    document.body.appendChild(el);
    this.hudEl = el; this.hudText = text; this.hudGraph = graph;
  }

  private refreshHud(): void {
    if (!this.hudText || !this.hudGraph) return;
    const r = this.report();
    const fps = r.fps;
    const col = fps >= 55 ? "#7df09b" : fps >= 30 ? "#ffd66b" : "#ff6b6b";
    const s = r.snap;
    this.hudText.innerHTML =
      `<div style="font-size:19px;line-height:1.15"><b style="color:${col}">${fps.toFixed(0)} FPS</b>` +
      ` <span style="color:#9bf;font-size:14px">${r.mean.toFixed(1)}ms</span>` +
      ` <span style="opacity:.75;font-size:13px">p95 ${r.p95.toFixed(0)}</span></div>` +
      `draws <b>${s.calls}</b>  tris ${(s.triangles / 1000).toFixed(0)}k  prog ${s.programs}` +
      `<br>geo ${s.geometries}  tex ${s.textures}` + (s.heapMB ? `  heap ${s.heapMB}mb` : "") +
      `<br><span style="opacity:.85">state ${s.state}  enemies ${s.enemies}</span>`;
    this.drawGraph();
  }

  /** Frame-time sparkline: green ≤16ms, amber ≤33ms, red beyond — so a hitch is
   *  unmistakable in a screenshot. */
  private drawGraph(): void {
    const c = this.hudGraph;
    if (!c) return;
    const g = c.getContext("2d");
    if (!g) return;
    const W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    const start = this.ringLen < RING ? 0 : this.ringIdx;
    const n = this.ringLen;
    if (!n) return;
    // Show the most recent W samples.
    const show = Math.min(n, W);
    const cap = 50; // ms mapped to full height
    for (let i = 0; i < show; i++) {
      const d = this.ring[(start + n - show + i) % RING];
      const h = Math.max(1, Math.min(H, (d / cap) * H));
      g.fillStyle = d <= 16.7 ? "#3fae62" : d <= 33.4 ? "#d8a93c" : "#d84545";
      g.fillRect(i, H - h, 1, h);
    }
    // 60fps + 30fps reference lines.
    g.fillStyle = "rgba(255,255,255,.18)";
    g.fillRect(0, H - (16.7 / cap) * H, W, 1);
    g.fillRect(0, H - (33.4 / cap) * H, W, 1);
  }
}
