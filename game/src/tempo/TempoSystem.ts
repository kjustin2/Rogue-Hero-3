import { events } from "../engine/EventBus";

export type TempoZone = "COLD" | "FLOWING" | "HOT" | "CRITICAL";

export interface TempoModifiers {
  decayRate: number;
  gainMult: number;
  crashRadiusBonus: number;
}

export interface ClassPassives {
  tempoGainMult?: number;
  crashResetValue?: number;
  dampedDecay?: number;
  fortifiedDodge?: boolean;
  zonePingOnPerfectDodge?: boolean;
  perfectDodgeTempoGain?: number;
  damageTempoBuild?: number;
}

/**
 * Ported from rogue-hero-2/src/tempo.js — single-player only.
 * Group resonance and Players-array logic dropped.
 * Class-passive crashResetValue + crash double-reset (value + targetValue) preserved.
 */
export class TempoSystem {
  value = 50;
  targetValue = 50;
  prevValue = 50;
  readonly REST = 50;
  readonly DECAY_RATE = 7;
  isCrashed = false;
  crashRecoverTimer = 0;
  sustainedTimer = 0;
  modifiers: TempoModifiers = { decayRate: 1, gainMult: 1, crashRadiusBonus: 1 };
  classPassives: ClassPassives | null = null;
  crashResetValue = 50;
  /** Optional hook (set by main.ts) for relic-driven gating + overrides. */
  itemHooks: {
    shouldDecay(value: number): boolean;
    crashResetOverride(): number | null;
  } | null = null;

  constructor() {
    events.on<{ hitNum: number }>("COMBO_HIT", ({ hitNum }) => this.onComboHit(hitNum));
    events.on("KILL", () => this.onKill());
    events.on("DODGE", () => this.onDodge());
    events.on("PERFECT_DODGE", () => this.onPerfectDodge());
    events.on("HEAVY_HIT", () => this.onHeavyHit());
    events.on("HEAVY_MISS", () => this.onHeavyMiss());
    events.on("DAMAGE_TAKEN", () => this.onDamageTaken());
    events.on("DRAIN", () => this.onDrained());
  }

  setClassPassives(passives: ClassPassives | null): void {
    this.classPassives = passives;
    if (passives) {
      this.modifiers.gainMult = passives.tempoGainMult ?? 1;
      this.crashResetValue = passives.crashResetValue ?? 50;
      if (passives.dampedDecay) this.modifiers.decayRate = passives.dampedDecay;
    }
  }

  /** Restore baseline state for in-place run restart. Re-applies class passives. */
  reset(): void {
    this.value = 50;
    this.targetValue = 50;
    this.prevValue = 50;
    this.isCrashed = false;
    this.crashRecoverTimer = 0;
    this.sustainedTimer = 0;
    this.modifiers = { decayRate: 1, gainMult: 1, crashRadiusBonus: 1 };
    this.crashResetValue = 50;
    if (this.classPassives) this.setClassPassives(this.classPassives);
  }

  update(dt: number): void {
    this.prevValue = this.value;

    if (this.isCrashed) {
      this.crashRecoverTimer -= dt;
      if (this.crashRecoverTimer <= 0) this.isCrashed = false;
      return;
    }

    // Item-driven decay gate (e.g. Runaway: no decay while >= 70)
    if (this.itemHooks && !this.itemHooks.shouldDecay(this.value)) return;

    if (this.sustainedTimer > 0) {
      this.sustainedTimer = Math.max(0, this.sustainedTimer - dt);
    } else {
      const dir = this.REST - this.targetValue;
      if (Math.abs(dir) > 0.1) {
        this.targetValue += Math.sign(dir) * this.DECAY_RATE * this.modifiers.decayRate * dt;
        this.targetValue = Math.max(0, Math.min(100, this.targetValue));
      }
    }

    const diff = this.targetValue - this.value;
    if (Math.abs(diff) > 0.1) {
      const moveSpeed = 55 * dt;
      if (Math.abs(diff) <= moveSpeed) {
        this.setValue(this.targetValue, true);
      } else {
        this.setValue(this.value + Math.sign(diff) * moveSpeed, true);
      }
    } else if (Math.abs(diff) > 0) {
      this.value = this.targetValue;
    }
  }

  setValue(newVal: number, isLerpStep = false): void {
    const oldZone = this.stateName();
    const actualVal = Math.max(0, Math.min(100, newVal));

    if (isLerpStep) {
      this.value = actualVal;
    } else {
      this.value = actualVal;
      this.targetValue = actualVal;
    }

    const newZone = this.stateName();
    if (oldZone !== newZone) events.emit("ZONE_TRANSITION", { oldZone, newZone });

    if (!isLerpStep && !this.isCrashed) {
      if (newVal >= 100) this._triggerAccidentalCrash();
      else if (newVal <= 0) this._triggerColdCrash();
    }
  }

  add(amount: number): void {
    if (amount === 0 || this.isCrashed) return;
    let amt = amount;
    if (amt > 0) amt *= this.modifiers.gainMult;
    this.targetValue += amt;
    if (this.targetValue >= 100) {
      this.targetValue = 100;
      this._triggerAccidentalCrash();
    } else if (this.targetValue <= 0) {
      this.targetValue = 0;
      this._triggerColdCrash();
    }
  }

  onComboHit(hitNum: number): void { this.add(hitNum === 3 ? 15 : 4); }
  onKill(): void { this.add(10); }
  onDodge(): void {
    if (this.classPassives?.fortifiedDodge) return;
    this.add(this.value < 30 ? 0 : -5);
  }
  onPerfectDodge(): void {
    if (this.classPassives?.zonePingOnPerfectDodge) {
      this.add(this.value > 50 ? -15 : 15);
      return;
    }
    this.add(this.classPassives?.perfectDodgeTempoGain ?? 10);
  }
  onHeavyHit(): void { this.add(20); }
  onHeavyMiss(): void { this.add(8); }
  onDamageTaken(): void {
    if (this.classPassives?.damageTempoBuild) this.add(this.classPassives.damageTempoBuild);
  }
  onDrained(): void { this.add(-20); }

  private _triggerAccidentalCrash(): void {
    if (this.isCrashed) return;
    const radius = 100 * this.modifiers.crashRadiusBonus;
    const dmg = Math.round(this.damageMultiplier() * 2.5 * 10);
    events.emit("CRASH_ATTACK", { radius, dmg, accidental: true });
    this._doCrash(0.4, 1.0);
  }

  private _triggerColdCrash(): void {
    if (this.isCrashed) return;
    events.emit("COLD_CRASH", { radius: 200, freezeDur: 3.0 });
    this.isCrashed = true;
    // RH2 bug-04 preserved: Berserker Heart overrides cold-crash reset to 80.
    const override = this.itemHooks?.crashResetOverride();
    const reset = override ?? 20;
    this.value = reset;
    this.targetValue = reset;
    this.crashRecoverTimer = 0.6;
    events.emit("PLAY_SOUND", "crash");
  }

  // Both `value` and `targetValue` reset — RH2 bug fix preserved (CLAUDE.md ~161).
  private _doCrash(shakeDur: number, _shakeIntens: number): void {
    this.isCrashed = true;
    const override = this.itemHooks?.crashResetOverride();
    const reset = override ?? this.crashResetValue;
    this.value = reset;
    this.targetValue = reset;
    this.crashRecoverTimer = shakeDur + 0.05;
    events.emit("PLAY_SOUND", "crash");
  }

  damageMultiplier(): number {
    if (this.value < 30) return 0.7;
    if (this.value < 70) return 1.0;
    if (this.value < 90) return 1.3;
    return 1.8;
  }

  speedMultiplier(): number {
    if (this.value >= 90) return 1.0;
    if (this.value >= 70) return 1.2;
    if (this.value < 30) return 0.9;
    return 1.0;
  }

  stateName(): TempoZone {
    if (this.value < 30) return "COLD";
    if (this.value < 70) return "FLOWING";
    if (this.value < 90) return "HOT";
    return "CRITICAL";
  }

  /** CSS hex color for UI tinting */
  zoneColor(): string {
    if (this.value < 30) return "#4488ff";
    if (this.value < 70) return "#44ff88";
    if (this.value < 90) return "#ff8800";
    return "#ff3333";
  }

  zoneFillColor(): string {
    if (this.value < 30) return "#2255cc";
    if (this.value < 70) return "#22aa55";
    if (this.value < 90) return "#cc6600";
    return "#cc1111";
  }
}
