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

// Default zone palette (cyan→green→orange→red) is hard for red-green colorblindness;
// the alternate ramp (blue→ice→amber→magenta) keeps hue AND brightness distinct.
const ZONE_PALETTE = {
  default: [
    { color: 0x4488ff, css: "#4f8dff" },
    { color: 0x44ff88, css: "#3df59a" },
    { color: 0xff8822, css: "#ffa028" },
    { color: 0xff3344, css: "#ff4252" },
  ],
  colorblind: [
    { color: 0x2f7dff, css: "#3a8dff" },
    { color: 0x9fd8ff, css: "#a6dcff" },
    { color: 0xffd23a, css: "#ffd23a" },
    { color: 0xff5ce0, css: "#ff5ce0" },
  ],
};

/** Swap the tempo-zone palette for the colorblind-safe ramp (mutates ZONES in place). */
export function setTempoPalette(colorblind: boolean): void {
  const pal = colorblind ? ZONE_PALETTE.colorblind : ZONE_PALETTE.default;
  ZONES.forEach((z, i) => { z.color = pal[i].color; z.css = pal[i].css; });
}

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
  /** Ascension: >1 makes tempo bleed back toward rest faster (harder to hold heat). */
  drainMult = 1;
  /** Hero identity: <1 holds heat longer (e.g. Tempest surfs the rhythm). Set at run start. */
  heroDecayMult = 1;

  // Crescendo: sustaining the Critical zone stacks a damage bonus (max 3), reset on cooling.
  private crescendoStacks = 0;
  private crescendoTimer = 0;
  private static CRESCENDO_STEP = 2.6;

  constructor(private events: EventBus) {}

  /** 0–3 — how long Critical has been held. */
  get crescendo(): number {
    return this.crescendoStacks;
  }

  /** Damage multiplier from the current Crescendo (1.0 → 1.36 at 3 stacks). */
  get crescendoMult(): number {
    return 1 + this.crescendoStacks * 0.12;
  }

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
    this.updateCrescendo(dt);
    if (this.sustainTimer > 0) {
      this.sustainTimer -= dt;
      return;
    }
    if (Math.abs(this.value - this.resting) < 0.01) return;
    const dir = this.value > this.resting ? -1 : 1;
    // Ascension's drainMult + the hero's identity both scale the cool-DOWN from heat (not cold recovery).
    const rate = this.decayRate * this.decayScale(this.value) * (dir === -1 ? this.drainMult * this.heroDecayMult : 1);
    if (rate <= 0) return;
    this.value = clamp(this.value + dir * rate * dt, 0, 100);
    // Don't overshoot the resting point
    if (dir === -1 && this.value < this.resting) this.value = this.resting;
    if (dir === 1 && this.value > this.resting) this.value = this.resting;
    this.refreshZone();
  }

  /** Build Crescendo while held at Critical; drop it the moment heat cools. */
  private updateCrescendo(dt: number): void {
    if (this.zone.zone === "critical") {
      this.crescendoTimer += dt;
      if (this.crescendoStacks < 3 && this.crescendoTimer >= Tempo.CRESCENDO_STEP) {
        this.crescendoTimer = 0;
        this.crescendoStacks++;
        this.events.emit("CRESCENDO", { stacks: this.crescendoStacks });
      }
    } else if (this.crescendoStacks > 0 || this.crescendoTimer > 0) {
      this.crescendoStacks = 0;
      this.crescendoTimer = 0;
      this.events.emit("CRESCENDO", { stacks: 0 });
    }
  }
}
