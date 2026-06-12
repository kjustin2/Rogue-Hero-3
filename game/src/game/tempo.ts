import type { EventBus, TempoZone } from "../core/events";
import { clamp } from "../core/math";

export interface ZoneDef {
  zone: TempoZone;
  min: number;
  damageMult: number;
  speedMult: number;
  color: number;
  css: string;
}

/** Ordered low → high. */
export const ZONES: ZoneDef[] = [
  { zone: "cold", min: 0, damageMult: 0.75, speedMult: 0.82, color: 0x4488ff, css: "#4f8dff" },
  { zone: "flowing", min: 30, damageMult: 1.0, speedMult: 1.0, color: 0x44ff88, css: "#3df59a" },
  { zone: "hot", min: 70, damageMult: 1.35, speedMult: 1.14, color: 0xff8822, css: "#ffa028" },
  { zone: "critical", min: 90, damageMult: 1.8, speedMult: 1.26, color: 0xff3344, css: "#ff4252" },
];

export const CRASH_THRESHOLD = 85;

/**
 * The signature mechanic: a 0–100 flow meter that drifts back toward its
 * resting point. Aggression pushes it hot (more damage, more speed); passivity
 * and mistakes bleed it cold. At ≥85 the player may CRASH it — cash the heat
 * out as a nova — resetting to the resting point.
 */
export class Tempo {
  value = 50;
  readonly resting = 50;
  private decayRate = 4.5;
  /** After any gain, tempo holds for this long before drifting again. */
  private sustainTimer = 0;
  private zoneIdx = 1;
  /** Injected by main.ts — relics scale (or zero out) the drift rate. */
  decayScale: (value: number) => number = () => 1;

  constructor(private events: EventBus) {}

  get zone(): ZoneDef {
    return ZONES[this.zoneIdx];
  }

  get crashReady(): boolean {
    return this.value >= CRASH_THRESHOLD;
  }

  gain(amount: number): void {
    this.value = clamp(this.value + amount, 0, 100);
    if (amount > 0) this.sustainTimer = 1.5;
    this.refreshZone();
  }

  drain(amount: number): void {
    this.value = clamp(this.value - amount, 0, 100);
    this.refreshZone();
  }

  /** Crash: reset to `resetTo` (relics can raise it). Caller owns the nova + FX. */
  crash(resetTo = this.resting): void {
    this.value = clamp(resetTo, 0, 100);
    this.sustainTimer = 2.0;
    this.refreshZone();
  }

  reset(): void {
    this.value = this.resting;
    this.sustainTimer = 0;
    this.refreshZone();
  }

  private refreshZone(): void {
    let idx = 0;
    for (let i = ZONES.length - 1; i >= 0; i--) {
      if (this.value >= ZONES[i].min) {
        idx = i;
        break;
      }
    }
    if (idx !== this.zoneIdx) {
      const prev = ZONES[this.zoneIdx].zone;
      this.zoneIdx = idx;
      this.events.emit("TEMPO_ZONE", { zone: ZONES[idx].zone, prev });
    }
  }

  update(dt: number): void {
    if (this.sustainTimer > 0) {
      this.sustainTimer -= dt;
      return;
    }
    if (Math.abs(this.value - this.resting) < 0.01) return;
    const rate = this.decayRate * this.decayScale(this.value);
    if (rate <= 0) return;
    const dir = this.value > this.resting ? -1 : 1;
    this.value = clamp(this.value + dir * rate * dt, 0, 100);
    // Don't overshoot the resting point
    if (dir === -1 && this.value < this.resting) this.value = this.resting;
    if (dir === 1 && this.value > this.resting) this.value = this.resting;
    this.refreshZone();
  }
}
