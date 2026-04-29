import { RngFn, mulberry32 } from "../engine/Rng";
import { CardDef, CardDefinitions } from "./CardDefinitions";

/**
 * Owns the player's persistent card collection (the deck) and the active
 * 3-card battle hand. Cards are NOT consumed when played — AP is the cost the
 * player pays per cast. The collection grows when the player picks new cards
 * after boss rooms; the hand is rebuilt from the collection between rooms via
 * the HandPicker UI.
 */
/** Hard cap on the persistent collection. New picks past this limit replace
 *  the oldest card (FIFO). Tuned to keep deckbuilding decisions punchy:
 *  start with 3, earn 1 per boss reward, hit the cap on the third boss and
 *  trade. */
export const MAX_COLLECTION_SIZE = 5;

export class DeckManager {
  /** Permanent pool of card ids the player owns. Boss rewards append here. */
  collection: string[] = [];
  /** Active hand — slots 0/1/2 mapped to keys 1/2/3. */
  hand: (string | null)[] = [];
  handSize = 3;
  rng: RngFn;
  private startingDeck: string[];

  constructor(startingDeck: string[], seed = Date.now() & 0xffffffff) {
    this.startingDeck = startingDeck.slice();
    this.rng = mulberry32(seed);
    this.collection = this.startingDeck.slice();
    this.shuffle(this.collection);
    this.hand = new Array(this.handSize).fill(null);
    this.autoFillHand();
  }

  /** Reset to fresh starting deck — for in-place run restart. */
  reset(): void {
    for (let i = 0; i < this.handSize; i++) this.hand[i] = null;
    this.collection = this.startingDeck.slice();
    this.shuffle(this.collection);
    this.autoFillHand();
  }

  /** Replace the starting-deck reference and reset to it (used by hero swap). */
  setStartingDeck(ids: string[]): void {
    this.startingDeck = ids.slice();
    this.reset();
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
   * for the rest of the run. AP gating lives in CardCaster, not here.
   */
  play(slot: number): CardDef | null {
    const id = this.hand[slot];
    if (!id) return null;
    return CardDefinitions[id] ?? null;
  }

  handEmpty(): boolean {
    for (let i = 0; i < this.handSize; i++) {
      if (this.hand[i] != null) return false;
    }
    return true;
  }

  /** True when the collection has reached MAX_COLLECTION_SIZE. UI uses this
   *  to relabel the next card-reward picker as a "swap" instead of an "add". */
  isFull(): boolean {
    return this.collection.length >= MAX_COLLECTION_SIZE;
  }

  /**
   * Append a new card id to the persistent collection (boss reward path).
   * If the collection is already at MAX_COLLECTION_SIZE, the oldest card is
   * removed first so we never exceed the cap. Returns the displaced card id
   * (or null if no swap was needed) so the UI can show "X swapped for Y".
   */
  addToCollection(cardId: string): string | null {
    if (!CardDefinitions[cardId]) return null;
    let displaced: string | null = null;
    if (this.collection.length >= MAX_COLLECTION_SIZE) {
      displaced = this.collection.shift() ?? null;
    }
    this.collection.push(cardId);
    return displaced;
  }

  /**
   * Set the hand explicitly from the hand-picker UI. Accepts up to handSize
   * card ids; remaining slots are nulled. Ids must exist in the collection
   * (this method does not validate ownership — caller's responsibility).
   */
  setHand(ids: (string | null)[]): void {
    for (let i = 0; i < this.handSize; i++) {
      const id = ids[i] ?? null;
      this.hand[i] = id && CardDefinitions[id] ? id : null;
    }
  }

  /**
   * Pick the first handSize cards from the (shuffled) collection. Used at
   * boot so the player has a default hand before they ever see the picker.
   */
  autoFillHand(): void {
    let written = 0;
    for (const id of this.collection) {
      if (written >= this.handSize) break;
      this.hand[written++] = id;
    }
    while (written < this.handSize) this.hand[written++] = null;
  }
}
