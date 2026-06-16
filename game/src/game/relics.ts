import type { Ctx } from "./ctx";
import type { CardDef } from "./cards";
import type { Enemy } from "./enemies";

export interface RelicDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
  color: string;
  rarity: "common" | "rare" | "legendary";
  /** Cursed relics are powerful but carry a drawback (shown with a warning tint). */
  cursed?: boolean;
  /** Warden boons are auto-granted on boss kills, not drafted — hidden from the draft pool + grid. */
  boon?: boolean;
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
  // Expansion II
  { id: "glass-cannon", name: "Glass Cannon", desc: "Deal 25% more damage. Take 25% more damage.", icon: "◇", color: "#ffd8e8", rarity: "rare" },
  { id: "second-wind", name: "Second Wind", desc: "Once per run, survive a lethal hit at 1 HP.", icon: "♥", color: "#7dffb0", rarity: "rare" },
  { id: "lucky-coin", name: "Lucky Coin", desc: "Earn 50% more rift shards.", icon: "◆", color: "#ffc266", rarity: "common" },
  { id: "resonant-bell", name: "Resonant Bell", desc: "Crashing also resets every card cooldown.", icon: "♪", color: "#c9a8ff", rarity: "rare" },
  { id: "thorn-plate", name: "Thorn Plate", desc: "Enemies that hurt you up close take 6 damage back.", icon: "✶", color: "#ff9a5f", rarity: "common" },
  // Expansion III
  { id: "siphon-sigil", name: "Siphon Sigil", desc: "Every kill shaves 0.6s off all card cooldowns.", icon: "⌛", color: "#9fd8ff", rarity: "rare" },
  { id: "molten-heart", name: "Molten Heart", desc: "Deal 18% more damage while Hot or Critical.", icon: "♨", color: "#ff8a4d", rarity: "rare" },
  { id: "tempo-capacitor", name: "Tempo Capacitor", desc: "Perfect dodges surge an extra 8 tempo.", icon: "↯", color: "#66ffee", rarity: "common" },
  { id: "executioner", name: "Executioner", desc: "Deal 30% more damage to enemies below 35% HP.", icon: "☠", color: "#d0d0d8", rarity: "rare" },
  { id: "rampart", name: "Rampart", desc: "While you hold a shield, take 30% less damage.", icon: "⊞", color: "#7fc8ff", rarity: "common" },
  // --- Expansion V: status combos, tiers, curses
  { id: "shatterglass", name: "Shatterglass", desc: "Striking a frozen enemy shatters it for a frost burst.", icon: "✦", color: "#bfeaff", rarity: "rare" },
  { id: "hex-brand", name: "Hex Brand", desc: "Crashing marks every enemy caught Vulnerable — +35% damage taken for 4s.", icon: "ʘ", color: "#ff8adf", rarity: "rare" },
  { id: "ember-codex", name: "Ember Codex", desc: "Bleeds and burns tick 60% harder.", icon: "♨", color: "#ff8a4d", rarity: "rare" },
  { id: "overcharger", name: "Overcharger", desc: "Every 3rd card you cast costs no cooldown.", icon: "⚛", color: "#9fffe0", rarity: "legendary" },
  { id: "tempo-engine", name: "Tempo Engine", desc: "Begin every chamber already Hot — tempo starts at 70.", icon: "♔", color: "#ffd24a", rarity: "legendary" },
  { id: "featherbone", name: "Featherbone", desc: "Deal 30% more damage — but take 50% more. A glass dagger.", icon: "⩙", color: "#ff6b7a", rarity: "rare", cursed: true },
  // --- Warden boons (auto-granted when you break a warden — you carry them in their memory)
  { id: "warden-heart", name: "Warden's Heart", desc: "The Pit Warden's gift: +16 max HP, mended in full.", icon: "♥", color: "#ff9a6a", rarity: "legendary", boon: true },
  { id: "spire-spark", name: "Spire's Spark", desc: "The Spire Caster's gift: perfect dodges surge +6 tempo.", icon: "ϟ", color: "#aaffee", rarity: "legendary", boon: true },
  { id: "colossus-might", name: "Colossus' Might", desc: "The Colossus' gift: deal 10% more damage.", icon: "⛰", color: "#ffaa44", rarity: "legendary", boon: true },
  { id: "tyrant-ward", name: "Tyrant's Ward", desc: "The Rift Tyrant's gift: begin each chamber with an 8-point shield.", icon: "♛", color: "#cbb6ff", rarity: "legendary", boon: true },
];

/** Boss kind → the boon relic you carry away from it. */
export const WARDEN_BOONS: Record<string, string> = {
  warden: "warden-heart", spire: "spire-spark", colossus: "colossus-might", tyrant: "tyrant-ward",
};

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
  private secondWindUsed = false;

  constructor(private ctx: Ctx) {
    ctx.events.on("KILL", () => {
      if (this.has("bloodthirst")) this.heal(2);
      if (this.has("siphon-sigil")) this.ctx.deck.reduceCooldowns(0.6);
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
    this.secondWindUsed = false;
  }

  /** Quietly restore a saved loadout (no pickup events/chimes). */
  restore(ids: string[]): void {
    this.owned = ids.map(relicById);
    this.killCounter = 0;
    this.secondWindUsed = false;
  }

  /** Second Wind: true exactly once per run, when held. */
  consumeSecondWind(): boolean {
    if (this.secondWindUsed || !this.has("second-wind")) return false;
    this.secondWindUsed = true;
    return true;
  }

  /** Un-owned (and, once the profile lands, unlocked) relics — up to 3. May be fewer. */
  draftChoices(): RelicDef[] {
    const pool = RELICS.filter((r) => !r.boon && !this.has(r.id) && this.ctx.profile.isUnlocked(`relic:${r.id}`));
    return this.ctx.rng.shuffle([...pool]).slice(0, 3);
  }

  /** Carry away a fallen warden's boon (auto-granted, with its one-time effect). */
  grantBoon(bossKind: string): void {
    const id = WARDEN_BOONS[bossKind];
    if (!id || this.has(id)) return;
    this.add(relicById(id));
    if (id === "warden-heart") {
      this.ctx.player.maxHp += 16;
      this.ctx.player.hp = Math.min(this.ctx.player.maxHp, this.ctx.player.hp + 16);
    }
    this.ctx.floaters.spawn(this.ctx.player.pos.x, 2.6, this.ctx.player.pos.z, "BOON CARRIED", "label");
  }

  // ------------------------------------------------------------- hooks
  damageDealtMult(e: Enemy): number {
    let m = 1;
    if (e.frozen > 0 && this.has("frost-chord")) m *= 1.3;
    if (this.has("glass-cannon")) m *= 1.25;
    if (this.has("featherbone")) m *= 1.3;
    if (this.has("colossus-might")) m *= 1.1;
    if (this.has("executioner") && e.hp <= e.maxHp * 0.35) m *= 1.3;
    if (this.has("molten-heart")) {
      const z = this.ctx.tempo.zone.zone;
      if (z === "hot" || z === "critical") m *= 1.18;
    }
    return m;
  }

  damageTakenMult(): number {
    const p = this.ctx.player;
    let m = 1;
    if (this.has("ironclad") && p.hp < p.maxHp * 0.3) m *= 0.75;
    if (this.has("glass-cannon")) m *= 1.25;
    if (this.has("featherbone")) m *= 1.5;
    if (this.has("rampart") && p.shield > 0) m *= 0.7;
    return m;
  }

  /** After the player takes a real hit: Thorn Plate bites back at close attackers. */
  onDamageTaken(srcX: number, srcZ: number): void {
    if (!this.has("thorn-plate")) return;
    const p = this.ctx.player;
    if (Math.hypot(srcX - p.pos.x, srcZ - p.pos.z) > 3.2) return;
    let best: Enemy | null = null;
    let bestD = 3.2;
    for (const e of this.ctx.enemies.living()) {
      const d = Math.hypot(e.pos.x - srcX, e.pos.z - srcZ);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    if (best) {
      this.ctx.combat.dealDamage(best, 6, { kbX: best.pos.x - p.pos.x, kbZ: best.pos.z - p.pos.z, kb: 2 });
    }
  }

  /** After a crash nova fires. */
  onCrash(): void {
    if (this.has("resonant-bell")) {
      this.ctx.deck.reduceCooldowns(99);
      this.ctx.floaters.spawn(this.ctx.player.pos.x, 2.4, this.ctx.player.pos.z, "RESONANCE", "tempo");
    }
    if (this.has("hex-brand")) {
      const p = this.ctx.player;
      for (const e of this.ctx.enemies.living()) {
        if (Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z) < 7 + e.radius) e.applyVulnerable(4, 1.35);
      }
    }
  }

  /** Extra DoT scaling for bleed/burn ticks (Ember Codex). */
  dotMult(): number {
    return this.has("ember-codex") ? 1.6 : 1;
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
    if (this.has("tempo-capacitor")) {
      this.ctx.tempo.gain(8);
    }
    if (this.has("spire-spark")) {
      this.ctx.tempo.gain(6);
    }
  }

  onRoomStart(): void {
    if (this.has("bulwark-idol")) {
      const p = this.ctx.player;
      p.shield = Math.max(p.shield, 10);
      this.ctx.events.emit("SHIELD_GAINED", { amount: 10 });
    }
    if (this.has("tempo-engine")) this.ctx.tempo.gain(70 - this.ctx.tempo.value);
    if (this.has("tyrant-ward")) {
      const p = this.ctx.player;
      p.shield = Math.max(p.shield, 8);
      this.ctx.events.emit("SHIELD_GAINED", { amount: 8 });
    }
  }

  /** Overcharger (legendary): every 3rd cast is free. Counted in deck.tryCast. */
  freeCastReady(castCount: number): boolean {
    return this.has("overcharger") && castCount % 3 === 0;
  }
}
