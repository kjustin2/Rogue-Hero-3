import { events } from "../engine/EventBus";
import { CardDef, CardDefinitions } from "../deck/CardDefinitions";
import { DeckManager } from "../deck/DeckManager";

/**
 * Archetype synergy passives — read the player's deck composition each frame
 * (cheap; pure tags) and emit `ARCHETYPE_TIER_CHANGED` when a 3+ tag tier
 * activates / deactivates. Other systems read `currentTier(arch)` to apply
 * the passive without subscribing to the event directly.
 */

export type Archetype = "fire" | "frost" | "storm";

export class ArchetypeSynergy {
  private active: Record<Archetype, boolean> = { fire: false, frost: false, storm: false };

  constructor(private deck: DeckManager) {}

  /** Recount tags in the current collection; emit on tier flips. */
  recompute(): void {
    const counts: Record<Archetype, number> = { fire: 0, frost: 0, storm: 0 };
    for (const id of this.deck.collection) {
      const def: CardDef | undefined = CardDefinitions[id];
      if (def?.archetype) counts[def.archetype]++;
    }
    for (const a of ["fire", "frost", "storm"] as Archetype[]) {
      const newActive = counts[a] >= 3;
      if (newActive !== this.active[a]) {
        this.active[a] = newActive;
        events.emit("ARCHETYPE_TIER_CHANGED", { archetype: a, active: newActive });
      }
    }
  }

  isActive(a: Archetype): boolean {
    return this.active[a];
  }
}
