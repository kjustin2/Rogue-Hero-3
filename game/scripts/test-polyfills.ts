// Minimal OffscreenCanvas / 2D-canvas polyfill for Node-side tests.
//
// Babylon's NullEngine still instantiates `OffscreenCanvas` when asked to build
// a DynamicTexture, and it calls a handful of 2D-context methods on it for
// whatever texture its client draws into. Under Node there is no real canvas,
// and we don't want to add `node-canvas` (native build + PNG deps) just to run
// smoke tests — so we stub out enough of the API for the texture calls we use.
//
// The stub returns valid shapes for method chains (gradient → addColorStop)
// but doesn't render anything — that's fine because NullEngine never reads
// the texture bitmap. Import this file once before the Babylon imports in any
// Node-side script that instantiates scenes.

interface MockGradient { addColorStop(offset: number, color: string): void }

class MockContext2D {
  canvas: { width: number; height: number };
  fillStyle: string | MockGradient = "#000";
  strokeStyle: string | MockGradient = "#000";
  lineWidth = 1;
  globalAlpha = 1;
  font = "";
  textAlign = "";
  textBaseline = "";
  constructor(w: number, h: number) { this.canvas = { width: w, height: h }; }
  createRadialGradient(): MockGradient { return { addColorStop() { /* noop */ } }; }
  createLinearGradient(): MockGradient { return { addColorStop() { /* noop */ } }; }
  createPattern(): null { return null; }
  fillRect(): void { /* noop */ }
  clearRect(): void { /* noop */ }
  strokeRect(): void { /* noop */ }
  fill(): void { /* noop */ }
  stroke(): void { /* noop */ }
  beginPath(): void { /* noop */ }
  closePath(): void { /* noop */ }
  arc(): void { /* noop */ }
  moveTo(): void { /* noop */ }
  lineTo(): void { /* noop */ }
  rect(): void { /* noop */ }
  save(): void { /* noop */ }
  restore(): void { /* noop */ }
  translate(): void { /* noop */ }
  rotate(): void { /* noop */ }
  scale(): void { /* noop */ }
  setTransform(): void { /* noop */ }
  resetTransform(): void { /* noop */ }
  fillText(): void { /* noop */ }
  strokeText(): void { /* noop */ }
  measureText(): { width: number } { return { width: 0 }; }
  drawImage(): void { /* noop */ }
  getImageData(): { data: Uint8ClampedArray; width: number; height: number } {
    return { data: new Uint8ClampedArray(this.canvas.width * this.canvas.height * 4), width: this.canvas.width, height: this.canvas.height };
  }
  putImageData(): void { /* noop */ }
  createImageData(w: number, h: number): { data: Uint8ClampedArray; width: number; height: number } {
    return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
  }
}

class MockOffscreenCanvas {
  width: number;
  height: number;
  constructor(w: number, h: number) { this.width = w; this.height = h; }
  getContext(type: string): MockContext2D | null {
    if (type === "2d") return new MockContext2D(this.width, this.height);
    return null;
  }
}

const g = globalThis as unknown as { OffscreenCanvas?: unknown };
if (typeof g.OffscreenCanvas === "undefined") {
  g.OffscreenCanvas = MockOffscreenCanvas;
}
