import type { Ctx } from "./ctx";
import type { CardDef } from "./cards";
import type { Enemy } from "./enemies";

export interface RelicDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
  color: string;
  rarity: "common" | "rare";
  /** Milestone text shown while locked (profile system). */
  unlockHint?: string;
}

export const RELICS: RelicDef[] = [
  // Starter-unlocked five — guarantees full drafts on a fresh profile
  { id: "bloodthirst", name: "Bloodthirst", desc: "Kills restore 2 HP.", icon: "🜁", color: "#ff7a8a", rarity: "common" },
  { id: "runaway-engine", name: "Runaway Engine", desc: "Tempo at 70+ never decays.", icon: "♺", color: "#ffa028", rarity: "rare" },
  { id: "metronome", name: "Metronome", desc: "Tempo drifts toward 50 half again as fast — recover cold quickly, lose heat quickly.", icon: "♩", color: "#9fd8ff", rarity: "common" },
  { id: "kinetic-core", name: "Kinetic Core", desc: "Dash Strike and Phase Step cool down 33% faster.", icon: "➢", color: "#5fe0ff", rarity: "common" },
  { id: "co-aggro-pact", name: "Co-Aggro Pact", desc: "Every 4th kill restores 3 HP and surges 10 tempo.", icon: "⁂", color: "#ffc266", rarity: "common" },
  // Locked behind milestones
  { id: "frost-chord", name: "Frost Chord", desc: "Frozen enemies take 30% more damage.", icon: "❅", color: "#bfe8ff", rarity: "rare" },
  { id: "ironclad", name: "Ironclad", desc: "Below 30% HP you take 25% less damage.", icon: "⛊", color: "#c8d2e0", rarity: "rare" },
  { id: "chain-amulet", name: "Chain Amulet", desc: "Chain Lightning arcs to five targets.", icon: "⌁", color: "#ffe066", rarity: "rare" },
  { id: "berserker-sigil", name: "Berserker Sigil", desc: "Crashing resets tempo to 65 instead of 50.", icon: "𐍈", color: "#ff4252", rarity: "rare" },
  { id: "adrenal-surge", name: "Adrenal Surge", desc: "Perfect dodges refund 1.5s on every card cooldown.", icon: "⚯", color: "#66ffee", rarity: "rare" },
  { id: "bulwark-idol", name: "Bulwark Idol", desc: "Begin each chamber with a 10-point shield.", icon: "⛨", color: "#7fc8ff", rarity: "common" },
];

export function relicById(id: string): RelicDef {
  const r = RELICS.find((r) => r.id === id);
  if (!r) throw new Error(`Unknown relic: ${id}`);
  return r;
}

/**
 * Run-scoped passive items. Systems consult the hook methods at explicit
 * points in their pipelines (dealDamage, damagePlayer, tempo decay, card
 * cooldowns, room start); one-off behaviors are `has()` checks at the single
 * site that cares. Cheap loops — owned never exceeds the pool.
 */
export class Relics {
  owned: RelicDef[] = [];
  private killCounter = 0;

  constructor(private ctx: Ctx) {
    ctx.events.on("KILL", () => {
      if (this.has("bloodthirst")) this.heal(2);
      if (this.has("co-aggro-pact")) {
        this.killCounter++;
        if (this.killCounter % 4 === 0) {
          this.heal(3);
          this.ctx.tempo.gain(10);
          const p = this.ctx.player;
          this.ctx.fx.ring(p.pos.x, p.pos.z, { radius: 1.8, color: 0xffc266, duration: 0.4 });
        }
      }
    });
  }

  private heal(n: number): void {
    const p = this.ctx.player;
    if (!p.alive || p.hp >= p.maxHp) return;
    p.hp = Math.min(p.maxHp, p.hp + n);
    this.ctx.events.emit("HEAL", { amount: n });
  }

  has(id: string): boolean {
    return this.owned.some((r) => r.id === id);
  }

  add(def: RelicDef): void {
    if (this.has(def.id)) return;
    this.owned.push(def);
    this.ctx.events.emit("RELIC_ADDED", { id: def.id });
    this.ctx.sfx.relicPickup();
  }

  resetForRun(): void {
    this.owned = [];
    this.killCounter = 0;
  }

  /** Un-owned (and, once the profile lands, unlocked) relics — up to 3. May be fewer. */
  draftChoices(): RelicDef[] {
    const pool = RELICS.filter((r) => !this.has(r.id) && this.ctx.profile.isUnlocked(`relic:${r.id}`));
    return this.ctx.rng.shuffle([...pool]).slice(0, 3);
  }

  // ------------------------------------------------------------- hooks
  damageDealtMult(e: Enemy): number {
    let m = 1;
    if (e.frozen > 0 && this.has("frost-chord")) m *= 1.3;
    return m;
  }

  damageTakenMult(): number {
    const p = this.ctx.player;
    if (this.has("ironclad") && p.hp < p.maxHp * 0.3) return 0.75;
    return 1;
  }

  tempoDecayMult(value: number): number {
    let m = 1;
    if (this.has("runaway-engine") && value >= 70) return 0;
    if (this.has("metronome")) m *= 1.5;
    return m;
  }

  cooldownMult(card: CardDef): number {
    if (this.has("kinetic-core") && (card.id === "dash-strike" || card.id === "phase-step")) return 0.67;
    return 1;
  }

  /** Override for the post-crash tempo value, or null for the default. */
  crashResetValue(): number | null {
    return this.has("berserker-sigil") ? 65 : null;
  }

  onPerfectDodge(): void {
    if (this.has("adrenal-surge")) {
      this.ctx.deck.reduceCooldowns(1.5);
    }
  }

  onRoomStart(): void {
    if (this.has("bulwark-idol")) {
      const p = this.ctx.player;
      p.shield = Math.max(p.shield, 10);
      this.ctx.events.emit("SHIELD_GAINED", { amount: 10 });
    }
  }
}
