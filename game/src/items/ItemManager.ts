import { ItemDefinitions, ItemDef } from "./ItemDefinitions";
import { TempoSystem } from "../tempo/TempoSystem";

/**
 * Tracks equipped relics and exposes the hooks tempo + combat read each frame.
 * Mirrors rogue-hero-2/src/Items.js ItemManager.
 */
export class ItemManager {
  equipped: Set<string> = new Set();

  constructor(private tempo: TempoSystem) {}

  has(id: string): boolean {
    return this.equipped.has(id);
  }

  equip(id: string): ItemDef | null {
    if (!ItemDefinitions[id]) return null;
    if (this.equipped.has(id)) return ItemDefinitions[id];
    this.equipped.add(id);
    this.recomputeTempoMods();
    return ItemDefinitions[id];
  }

  /** Drop all relics — for in-place run restart. */
  reset(): void {
    this.equipped.clear();
    this.recomputeTempoMods();
  }

  /** Recompute persistent stat modifiers driven by relics. Call after every equip. */
  recomputeTempoMods(): void {
    const t = this.tempo;
    t.modifiers.decayRate = this.has("metronome") ? 3.0 : (t.classPassives?.dampedDecay ?? 1.0);
  }

  /** Tempo decay gate. Returns false to skip natural decay this frame. */
  shouldDecay(tempoValue: number): boolean {
    if (this.has("runaway") && tempoValue >= 70) return false;
    return true;
  }

  damageMultiplier(_tempoValue: number): number {
    return 1.0;
  }

  dodgeTempoShift(tempoValue: number): number {
    return tempoValue < 30 ? 0 : -5;
  }

  /** Override for crash reset value (Berserker Heart). Returns null if no override. */
  crashResetOverride(): number | null {
    return this.has("berserker_heart") ? 80 : null;
  }
}
