import * as THREE from "three";

export type FloaterKind = "dmg" | "crit" | "heal" | "tempo" | "label" | "playerdmg" | "shieldbreak";
interface Floater {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  active: boolean;
  age: number;
  duration: number;
  kind: FloaterKind;
  amount: number;
  numeric: boolean;
  drift: number;
}

/** Small, pooled world-space labels. Their clock pauses and clears with the fight. */
export class Floaters {
  private pool: Floater[] = [];
  private projected = new THREE.Vector3();

  constructor(private camera: THREE.Camera) {
    const root = document.getElementById("floaters")!;
    for (let i = 0; i < 40; i++) {
      const el = document.createElement("div");
      el.className = "floater";
      el.style.display = "none";
      root.appendChild(el);
      this.pool.push({ el, pos: new THREE.Vector3(), active: false, age: 0, duration: 1, kind: "dmg", amount: 0, numeric: false, drift: 0 });
    }
  }

  spawn(x: number, y: number, z: number, text: string, kind: FloaterKind = "dmg", color?: string): void {
    const numeric = (kind === "dmg" || kind === "crit") && /^\d+$/.test(text);
    for (const f of this.pool) {
      if (!f.active || f.age > 0.18 || (f.pos.x-x)**2 + (f.pos.z-z)**2 > 0.85**2) continue;
      if (numeric && f.numeric && f.kind === kind) {
        f.amount += Number(text);
        f.el.textContent = String(f.amount);
        return;
      }
      if (!numeric && !f.numeric && f.el.textContent === text && f.kind === kind) return;
    }
    const f = this.pool.find(f => !f.active);
    if (!f) return;
    f.pos.set(x,y,z);
    f.active = true;
    f.age = 0;
    f.duration = numeric ? 0.72 : 0.95;
    f.numeric = numeric;
    f.amount = numeric ? Number(text) : 0;
    f.kind = kind;
    f.drift = (Math.random()-0.5)*18;
    f.el.textContent = text;
    f.el.className = `floater floater--${kind}`;
    f.el.style.color = color ?? "";
    f.el.style.display = "block";
    this.draw(f);
  }

  clear(): void {
    for (const f of this.pool) {
      f.active = false;
      f.el.style.display = "none";
    }
  }

  update(dt: number): void {
    for (const f of this.pool) {
      if (!f.active) continue;
      f.age += dt;
      if (f.age >= f.duration) {
        f.active = false;
        f.el.style.display = "none";
      } else this.draw(f);
    }
  }

  private draw(f: Floater): void {
    const p = this.projected.copy(f.pos).project(this.camera);
    const k = f.age / f.duration;
    const x = (p.x*0.5+0.5)*window.innerWidth + f.drift*k;
    const y = (-p.y*0.5+0.5)*window.innerHeight - 25*k;
    const visible = p.z >= -1 && p.z <= 1 && x > 24 && x < window.innerWidth-24 && y > 85 && y < window.innerHeight-80;
    f.el.style.opacity = visible ? String(Math.min(1, f.age/0.045, (1-k)/0.35)) : "0";
    f.el.style.left = `${x.toFixed(1)}px`;
    f.el.style.top = `${y.toFixed(1)}px`;
    const pop = 1 + (f.kind === "crit" || f.kind === "shieldbreak" ? 0.1 : 0.04)*Math.sin(Math.min(1,k*4)*Math.PI);
    f.el.style.transform = `translate(-50%, -50%) scale(${pop.toFixed(3)})`;
  }
}
