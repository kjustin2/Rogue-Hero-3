import type { Ctx } from "./ctx";
import { CARDS, STARTING_HAND, cardById, type CardDef } from "./cards";

export const HAND_SIZE = 3;

/**
 * The hand: three slots on keys 1/2/3, cooldown-gated. After each cleared
 * room the player drafts one of three cards — filling an empty slot or
 * swapping over an equipped one.
 */
export class Deck {
  slots: (CardDef | null)[] = [null, null, null];
  cooldowns = [0, 0, 0];

  constructor(private ctx: Ctx) {}

  resetForRun(): void {
    this.slots = [null, null, null];
    this.cooldowns = [0, 0, 0];
    STARTING_HAND.forEach((id, i) => (this.slots[i] = cardById(id)));
  }

  get hasEmptySlot(): boolean {
    return this.slots.some((s) => s === null);
  }

  equip(card: CardDef, slot: number): void {
    this.slots[slot] = card;
    this.cooldowns[slot] = 0;
  }

  /** Three draft options the player doesn't hold and HAS unlocked. */
  draftChoices(): CardDef[] {
    const pool = CARDS.filter(
      (c) => !this.slots.some((s) => s?.id === c.id) && this.ctx.profile.isUnlocked(`card:${c.id}`)
    );
    return this.ctx.rng.shuffle([...pool]).slice(0, 3);
  }

  /** Relic hook (Adrenal Surge): shave seconds off every running cooldown. */
  reduceCooldowns(sec: number): void {
    for (let i = 0; i < this.cooldowns.length; i++) {
      if (this.cooldowns[i] > 0) this.cooldowns[i] = Math.max(0.01, this.cooldowns[i] - sec);
    }
  }

  tryCast(slot: number): void {
    const card = this.slots[slot];
    if (!card) return;
    // Aegis re-press detonates even while "on cooldown" conceptually —
    // the detonation is part of the same cast.
    if (card.id === "aegis" && this.ctx.caster.aegisActive) {
      this.ctx.caster.cast(card);
      return;
    }
    if (this.cooldowns[slot] > 0) {
      this.ctx.events.emit("CARD_FAIL", { slot });
      this.ctx.sfx.deny();
      return;
    }
    if (this.ctx.caster.cast(card)) {
      this.cooldowns[slot] = card.cooldown * this.ctx.relics.cooldownMult(card);
    } else {
      this.ctx.events.emit("CARD_FAIL", { slot });
      this.ctx.sfx.deny();
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.cooldowns.length; i++) {
      if (this.cooldowns[i] > 0) {
        this.cooldowns[i] -= dt;
        if (this.cooldowns[i] <= 0) {
          this.cooldowns[i] = 0;
          this.ctx.sfx.cardReady();
        }
      }
    }
    const { input } = this.ctx;
    if (input.pressed("Digit1")) this.tryCast(0);
    if (input.pressed("Digit2")) this.tryCast(1);
    if (input.pressed("Digit3")) this.tryCast(2);
  }
}
