import * as THREE from "three";

export type FloaterKind = "dmg" | "crit" | "heal" | "tempo" | "label" | "playerdmg" | "shieldbreak";

/**
 * DOM-based floating combat text. Projected to screen once at spawn;
 * CSS animation handles the rise/fade so per-frame cost is zero.
 */
export class Floaters {
  private root: HTMLElement;
  private pool: HTMLDivElement[] = [];
  private v = new THREE.Vector3();

  constructor(private camera: THREE.Camera) {
    this.root = document.getElementById("floaters")!;
    for (let i = 0; i < 48; i++) {
      const el = document.createElement("div");
      el.className = "floater";
      el.style.display = "none";
      this.root.appendChild(el);
      this.pool.push(el);
    }
  }

  spawn(x: number, y: number, z: number, text: string, kind: FloaterKind = "dmg", color?: string): void {
    this.v.set(x, y, z).project(this.camera);
    if (this.v.z > 1) return;
    const margin = kind === "shieldbreak" ? 190 : 42;
    const sx = Math.min(window.innerWidth - margin, Math.max(margin, (this.v.x * 0.5 + 0.5) * window.innerWidth));
    const sy = Math.min(window.innerHeight - margin, Math.max(margin, (-this.v.y * 0.5 + 0.5) * window.innerHeight));

    // Dense multihits read as one accumulated result instead of a cloud of equal
    // numbers. Criticals stay separate so their authored emphasis is preserved.
    const numeric = kind === "dmg" && /^\d+$/.test(text);
    const now = performance.now();
    if (numeric) {
      for (const active of this.pool) {
        if (active.style.display === "none" || active.dataset.kind !== kind) continue;
        const age = now - Number(active.dataset.at ?? 0);
        const dx = sx - Number(active.dataset.x ?? sx);
        const dy = sy - Number(active.dataset.y ?? sy);
        if (age > 180 || dx * dx + dy * dy > 72 * 72) continue;
        const sum = Number(active.dataset.sum ?? 0) + Number(text);
        active.dataset.sum = String(sum);
        active.dataset.at = String(now);
        active.textContent = String(sum);
        return;
      }
    }

    const el = this.pool.find((e) => e.style.display === "none");
    if (!el) return;
    el.textContent = text;
    el.className = `floater floater--${kind}`;
    // Optional per-call tint (shield-chip numbers). Cleared on pooled reuse.
    el.style.color = color ?? "";
    const drift = (Math.random() - 0.5) * 36;
    el.style.setProperty("--drift", `${drift.toFixed(0)}px`);
    el.style.left = `${sx.toFixed(0)}px`;
    el.style.top = `${sy.toFixed(0)}px`;
    el.dataset.kind = kind;
    el.dataset.at = String(now);
    el.dataset.x = String(sx);
    el.dataset.y = String(sy);
    el.dataset.sum = numeric ? text : "0";
    // The element was display:none (committed 950ms ago), so none→block restarts
    // floater-rise on its own — no per-spawn offsetWidth reflow (which, on a
    // multi-hit frame, forced one synchronous layout flush per number spawned).
    el.style.display = "block";
    window.setTimeout(() => (el.style.display = "none"), 950);
  }
}
