import { RngFn, mulberry32 } from "../engine/Rng";
import { CardDef, CardDefinitions } from "./CardDefinitions";

export class DeckManager {
  draw: string[] = [];   // top of pile = end of array (pop)
  /**
   * Fixed 4-slot hand — cards are NOT consumed on play. Whatever lands in each
   * slot when the run starts stays there for the entire run. AP is the cost the
   * player pays per cast, not the card itself.
   *
   * This replaces the earlier "discard-on-play → refill when empty" flow which
   * caused the four visible cards to rotate every few attacks and confused
   * muscle memory. The starting deck still has >4 cards so the 4 shown are
   * drawn at boot, but no replacement ever happens mid-run.
   */
  hand: (string | null)[] = [];
  handSize = 4;
  rng: RngFn;
  private startingDeck: string[];

  constructor(startingDeck: string[], seed = Date.now() & 0xffffffff) {
    this.startingDeck = startingDeck.slice();
    this.rng = mulberry32(seed);
    this.draw = this.startingDeck.slice();
    this.shuffle(this.draw);
    this.hand = new Array(this.handSize).fill(null);
    this.refillHand();
  }

  /** Reset to fresh starting deck — for in-place run restart. */
  reset(): void {
    for (let i = 0; i < this.handSize; i++) this.hand[i] = null;
    this.draw = this.startingDeck.slice();
    this.shuffle(this.draw);
    this.refillHand();
  }

  shuffle(arr: string[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  /** Returns the card def at the given hand slot (0-based), or null if empty. */
  peek(slot: number): CardDef | null {
    const id = this.hand[slot];
    if (!id) return null;
    return CardDefinitions[id] ?? null;
  }

  /**
   * "Playing" the card. It is NOT removed from the slot — the player keeps it
   * for the rest of the run. Returns the played card so the caller can resolve
   * its effects. AP gating lives in CardCaster, not here.
   */
  play(slot: number): CardDef | null {
    const id = this.hand[slot];
    if (!id) return null;
    return CardDefinitions[id] ?? null;
  }

  /** True if every hand slot is empty (only happens if starting deck was < 4 cards). */
  handEmpty(): boolean {
    for (let i = 0; i < this.handSize; i++) {
      if (this.hand[i] != null) return false;
    }
    return true;
  }

  /**
   * Fill empty slots from the draw pile. Called once at boot / reset to seed
   * the fixed hand. Kept as a method (not inlined) so future card pickups
   * (beyond the MVP's static hand) can re-use it without the no-op check.
   */
  refillHand(): void {
    for (let i = 0; i < this.handSize; i++) {
      if (this.hand[i] != null) continue;
      if (this.draw.length === 0) break;
      const next = this.draw.pop();
      if (next) this.hand[i] = next;
    }
  }
}
