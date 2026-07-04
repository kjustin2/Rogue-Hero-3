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
    // The element was display:none (committed 950ms ago), so none→block restarts
    // floater-rise on its own — no per-spawn offsetWidth reflow (which, on a
    // multi-hit frame, forced one synchronous layout flush per number spawned).
    el.style.display = "block";
    window.setTimeout(() => (el.style.display = "none"), 950);
  }
}
