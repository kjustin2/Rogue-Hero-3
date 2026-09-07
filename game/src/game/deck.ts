import { cardSchool, specialtyFor, type Specialty } from "./specialties";
import type { Ctx } from "./ctx";
import { CARDS, cardById, type CardDef } from "./cards";

/**
 * The hand: three slots on keys 1/2/3, cooldown-gated. After each cleared
 * room the player drafts one of three cards — filling an empty slot or
 * swapping over an equipped one.
 */
export class Deck {
  slots: (CardDef | null)[] = [null, null, null];
  cooldowns = [0, 0, 0];
  cooldownTotals = [0, 0, 0];
  private specialtyKey = "";
  private specialtyCache: Specialty | null = null;
  get specialty(): Specialty | null {
    const key = this.slots.map(card => card?.id ?? "").join("|");
    if (key !== this.specialtyKey) { this.specialtyKey = key; this.specialtyCache = specialtyFor(this.slots); }
    return this.specialtyCache;
  }
  /** "Honed" cards — faster, hotter, harder-hitting. One per slot. */
  upgraded = [false, false, false];
  /** Slots swallowed by The Wound — unusable until the phase is broken. */
  stolen = [false, false, false];
  /** Lifetime successful casts this run (drives Overcharger's free-3rd-cast). */
  private castCount = 0;
  get totalCasts(): number { return this.castCount; }
  restoreCastCount(count = 0): void { this.castCount = Number.isInteger(count) ? Math.max(0, count) : 0; }

  constructor(private ctx: Ctx) {}

  resetForRun(): void {
    this.slots = [null, null, null];
    this.cooldowns = [0, 0, 0];
    this.cooldownTotals = [0, 0, 0];
    this.upgraded = [false, false, false];
    this.stolen = [false, false, false];
    this.castCount = 0;
    this.ctx.player.hero.startingHand.forEach((id, i) => (this.slots[i] = cardById(id)));
  }

  /** The Wound swallows a slot — the card is unusable until restore(). */
  steal(slot: number): void {
    this.stolen[slot] = true;
    this.ctx.events.emit("CARD_STOLEN", { slot });
  }

  restore(slot: number): void {
    if (!this.stolen[slot]) return;
    this.stolen[slot] = false;
    this.cooldowns[slot] = 0; // returned ready — a phase break should feel like a gift
    this.ctx.events.emit("CARD_RESTORED", { slot });
  }

  get hasEmptySlot(): boolean {
    return this.slots.some((s) => s === null);
  }

  equip(card: CardDef, slot: number): void {
    this.slots[slot] = card;
    this.cooldowns[slot] = 0;
    this.cooldownTotals[slot] = 0;
    this.upgraded[slot] = false;
    this.stolen[slot] = false;
  }

  /** Slots holding a not-yet-honed card. */
  upgradableSlots(): number[] {
    return this.slots.map((c, i) => (c && !this.upgraded[i] ? i : -1)).filter((i) => i >= 0);
  }

  upgrade(slot: number): void {
    if (this.slots[slot]) this.upgraded[slot] = true;
  }

  /** Three draft options the player does not hold. */
  draftChoices(exclude: readonly string[] = []): CardDef[] {
    const pool = CARDS.filter(
      (c) =>
        !exclude.includes(c.id) && !this.slots.some((s) => s?.id === c.id) &&
        this.ctx.profile.isUnlocked(`card:${c.id}`)
    );
    const shuffled = this.ctx.rng.shuffle([...pool]);
    const heldSchools = new Set(this.slots.filter((c): c is CardDef => !!c).map(cardSchool));
    // Always offer a way to deepen the current build, alongside two alternatives.
    const pair = shuffled.find(c => heldSchools.has(cardSchool(c)));
    const choices = pair ? [pair] : [];
    for (const card of shuffled) {
      if (choices.length === 3) break;
      if (!choices.some(c => cardSchool(c) === cardSchool(card))) choices.push(card);
    }
    for (const card of shuffled) {
      if (choices.length === 3) break;
      if (!choices.includes(card)) choices.push(card);
    }
    return choices;
  }

  /** Cards the shop/treasure can offer for purchase (same eligibility as drafting). */
  buyableChoices(count: number): CardDef[] {
    const pool = CARDS.filter(
      (c) =>
        !this.slots.some((s) => s?.id === c.id) &&
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

  /** One source for the actual recovery shown by the arsenal and applied on cast. */
  effectiveCooldown(card: CardDef, honed = false): number {
    return card.cooldown * (honed ? 0.7 : 1) * (this.specialty?.id === cardSchool(card) ? 0.85 : 1)
      * this.ctx.relics.cooldownMult(card) * this.ctx.player.hero.cooldownMult * this.ctx.difficulty.cardCooldownMult;
  }

  tryCast(slot: number): void {
    const card = this.slots[slot];
    if (!card) return;
    if (this.stolen[slot]) {
      this.ctx.events.emit("CARD_FAIL", { slot });
      this.ctx.sfx.deny();
      return;
    }
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
    if (this.ctx.caster.travelActive) return;
    this.ctx.events.emit("CARD_PRIME", { slot, id: card.id, color: card.color });
    if (this.ctx.caster.cast(card, this.upgraded[slot])) {
      this.castCount++;
      const free = this.ctx.relics.freeCastReady(this.castCount);
      this.cooldownTotals[slot] = this.cooldowns[slot] = free
        ? 0
        : this.effectiveCooldown(card, this.upgraded[slot]);
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
