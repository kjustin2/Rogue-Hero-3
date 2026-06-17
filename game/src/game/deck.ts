import type { Ctx } from "./ctx";
import { CARDS, cardById, type CardDef } from "./cards";

export const HAND_SIZE = 3;

/**
 * The hand: three slots on keys 1/2/3, cooldown-gated. After each cleared
 * room the player drafts one of three cards — filling an empty slot or
 * swapping over an equipped one.
 */
export class Deck {
  slots: (CardDef | null)[] = [null, null, null];
  cooldowns = [0, 0, 0];
  /** "Honed" cards — faster, hotter, harder-hitting. One per slot. */
  upgraded = [false, false, false];
  /** Lifetime successful casts this run (drives Overcharger's free-3rd-cast). */
  private castCount = 0;

  constructor(private ctx: Ctx) {}

  resetForRun(): void {
    this.slots = [null, null, null];
    this.cooldowns = [0, 0, 0];
    this.upgraded = [false, false, false];
    this.castCount = 0;
    this.ctx.player.hero.startingHand.forEach((id, i) => (this.slots[i] = cardById(id)));
  }

  get hasEmptySlot(): boolean {
    return this.slots.some((s) => s === null);
  }

  equip(card: CardDef, slot: number): void {
    this.slots[slot] = card;
    this.cooldowns[slot] = 0;
    this.upgraded[slot] = false;
  }

  /** Slots holding a not-yet-honed card. */
  upgradableSlots(): number[] {
    return this.slots.map((c, i) => (c && !this.upgraded[i] ? i : -1)).filter((i) => i >= 0);
  }

  upgrade(slot: number): void {
    if (this.slots[slot]) this.upgraded[slot] = true;
  }

  /** Cards eligible for THIS hero: not hero-locked, or locked to the current hero. */
  private heroEligible(c: CardDef): boolean {
    return !c.hero || c.hero === this.ctx.player.hero.id;
  }

  /** Three draft options the player doesn't hold, HAS unlocked, and the hero can take. */
  draftChoices(): CardDef[] {
    const pool = CARDS.filter(
      (c) =>
        !this.slots.some((s) => s?.id === c.id) &&
        this.heroEligible(c) &&
        this.ctx.profile.isUnlocked(`card:${c.id}`)
    );
    return this.ctx.rng.shuffle([...pool]).slice(0, 3);
  }

  /** Cards the shop/treasure can offer for purchase (same eligibility as drafting). */
  buyableChoices(count: number): CardDef[] {
    const pool = CARDS.filter(
      (c) =>
        !this.slots.some((s) => s?.id === c.id) &&
        this.heroEligible(c) &&
        this.ctx.profile.isUnlocked(`card:${c.id}`)
    );
    return this.ctx.rng.shuffle([...pool]).slice(0, count);
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
      this.ctx.events.emit("CARD_PRIME", { slot, id: card.id, color: card.color });
      this.ctx.caster.cast(card, this.upgraded[slot]);
      return;
    }
    if (this.cooldowns[slot] > 0) {
      this.ctx.events.emit("CARD_FAIL", { slot });
      this.ctx.sfx.deny();
      return;
    }
    this.ctx.events.emit("CARD_PRIME", { slot, id: card.id, color: card.color });
    if (this.ctx.caster.cast(card, this.upgraded[slot])) {
      this.castCount++;
      const honed = this.upgraded[slot] ? 0.7 : 1;
      const free = this.ctx.overdrive.freeCasts || this.ctx.relics.freeCastReady(this.castCount);
      this.cooldowns[slot] = free
        ? 0
        : card.cooldown * honed * this.ctx.relics.cooldownMult(card) * this.ctx.player.hero.cooldownMult * this.ctx.difficulty.cardCooldownMult;
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
    if (input.actionPressed("card1")) this.tryCast(0);
    if (input.actionPressed("card2")) this.tryCast(1);
    if (input.actionPressed("card3")) this.tryCast(2);
  }
}
