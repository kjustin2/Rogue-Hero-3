import { events } from "../engine/EventBus";

/**
 * Named combo chains — pairs of cards cast within 1.5 s trigger a special
 * `CARD_COMBO` event. Each combo entry is bidirectional? No — first card
 * must be `from`, second must be `to`. Order matters so e.g. Cleave then
 * Crashing Blow triggers Hemorrhage Burst, but the reverse is its own combo.
 */

export interface ComboDef {
  id: string;
  name: string;
  from: string;
  to: string;
  description: string;
}

export const COMBO_DEFS: ComboDef[] = [
  {
    id: "hemorrhage_burst",
    name: "Hemorrhage Burst",
    from: "cleave",
    to: "crashing_blow",
    description: "Consume bleed stacks for lump damage.",
  },
  {
    id: "frostlance",
    name: "Frostlance",
    from: "frost_nova",
    to: "charged_beam",
    description: "Beam tier auto-promotes one tier.",
  },
  {
    id: "static_loop",
    name: "Static Loop",
    from: "chain_lightning",
    to: "chain_lightning",
    description: "Free re-arc through Conduits.",
  },
  {
    id: "sundered_anvil",
    name: "Sundered Anvil",
    from: "dashstrike",
    to: "crashing_blow",
    description: "Crashing Blow ignores boss hyperarmor.",
  },
  {
    id: "glacial_crater",
    name: "Glacial Crater",
    from: "meteor_slam",
    to: "frost_nova",
    description: "Pillars apply chill on entry.",
  },
  {
    id: "reactive_trap",
    name: "Reactive Trap",
    from: "aegis",
    to: "mine_field",
    description: "Mines also detonate when shield is hit.",
  },
];

const COMBO_WINDOW_MS = 1500;

export class ComboChains {
  private lastCardId: string | null = null;
  private lastCardAt = 0;

  constructor() {
    events.on<{ id: string }>("CARD_PLAYED", ({ id }) => this.onCardPlayed(id));
  }

  private onCardPlayed(id: string): void {
    const now = performance.now();
    if (this.lastCardId !== null && now - this.lastCardAt <= COMBO_WINDOW_MS) {
      const match = COMBO_DEFS.find((c) => c.from === this.lastCardId && c.to === id);
      if (match) {
        events.emit("CARD_COMBO", { id: match.id, name: match.name });
      }
    }
    this.lastCardId = id;
    this.lastCardAt = now;
  }

  reset(): void {
    this.lastCardId = null;
    this.lastCardAt = 0;
  }
}
