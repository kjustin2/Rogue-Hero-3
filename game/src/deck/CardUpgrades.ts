import { CardDef } from "./CardDefinitions";

/**
 * Card upgrades + mutators — runtime overlays on top of `CardDefinitions`.
 * `CardCaster` resolves the active def at cast time as
 *   `{ ...CardDefinitions[id], ...upgrades.get(id), ...mutators.get(id) }`.
 *
 * Upgrades are run-permanent (until run reset); mutators are room-scoped and
 * decrement on use, expiring at remaining=0 or on room change.
 */

export interface CardUpgradeDef {
  /** The Plus version's overrides. */
  partial: Partial<CardDef>;
  /** Display label for HUD chips. */
  label: string;
}

export const UPGRADE_TIERS: Record<string, CardUpgradeDef> = {
  cleave:         { label: "Cleave+",          partial: { damage: 22 } },
  crashing_blow:  { label: "Crashing Blow+",   partial: { damage: 38 } },
  mine_field:     { label: "Mine Field+",      partial: { mineCount: 6 } },
  charged_beam:   { label: "Charged Beam+",    partial: { damage: 18, chargeMax: 1.5 } },
  chain_lightning:{ label: "Chain Lightning+", partial: { chainCount: 5 } },
  frost_nova:     { label: "Frost Nova+",      partial: { aoeRadius: 7 } },
  dashstrike:     { label: "Dash Strike+",     partial: { damage: 22 } },
  phase_step:     { label: "Phase Step+",      partial: { range: 8 } },
  meteor_slam:    { label: "Meteor Slam+",     partial: { damage: 44 } },
  aegis:          { label: "Aegis+",           partial: { shieldAmount: 35, shieldDuration: 5, detonateDamage: 22 } },
};

export interface MutatorDef {
  id: string;
  label: string;
  description: string;
  /** How many casts the mutator survives. */
  charges: number;
  /** Override partial applied while charges remain. */
  partial: Partial<CardDef>;
  /** The card id this mutator targets — null = any. */
  targetCardId: string | null;
}

export const MUTATOR_DEFS: MutatorDef[] = [
  { id: "mut_cleave_chain",   label: "Long Cleave",          description: "Next 5 Cleaves reach farther.",              charges: 5, partial: { range: 5.0 }, targetCardId: "cleave" },
  { id: "mut_beam_pierce",    label: "Quick Charge Beam",    description: "Next 3 Charged Beams reach max charge faster.", charges: 3, partial: { chargeMin: 0.25, chargeMax: 0.65 }, targetCardId: "charged_beam" },
  { id: "mut_meteor_free",    label: "Free Meteor",          description: "Next Meteor Slam costs 0 AP.",                charges: 1, partial: { cost: 0 }, targetCardId: "meteor_slam" },
  { id: "mut_aegis_50",       label: "Aegis 50 HP",          description: "Next Aegis grants 50 HP shield instead of 25.", charges: 1, partial: { shieldAmount: 50 }, targetCardId: "aegis" },
  { id: "mut_frost_chill",    label: "Frost Field Chill",    description: "Next 3 Frost Novas freeze for 3s instead of 1.2s.", charges: 3, partial: { freezeDuration: 3 }, targetCardId: "frost_nova" },
  { id: "mut_dash_double",    label: "Dash Double Strike",   description: "Next 3 Dash Strikes hit twice.",              charges: 3, partial: { damage: 32 }, targetCardId: "dashstrike" },
  { id: "mut_phase_far",      label: "Long Phase",           description: "Next 5 Phase Steps go 50% farther.",          charges: 5, partial: { range: 9 }, targetCardId: "phase_step" },
  { id: "mut_crash_shockwave",label: "Crashing Shockwave",   description: "Next Crashing Blow's arc widens to 120°.",    charges: 1, partial: { arcDegrees: 120 }, targetCardId: "crashing_blow" },
];

/**
 * Run-scoped manager. Lives outside CardCaster so the system that *applies*
 * overrides (ItemManager, ShrinePicker effects, ShopPicker purchases) doesn't
 * have to reach into the cast pipeline directly.
 */
export class CardUpgrades {
  private upgrades = new Set<string>();
  /** Active mutator entries — keyed by card id. Each entry holds remaining charges. */
  private mutators: Array<{ def: MutatorDef; charges: number }> = [];

  reset(): void {
    this.upgrades.clear();
    this.mutators.length = 0;
  }

  /** Permanently upgrade a card to its + tier. Idempotent. */
  upgrade(cardId: string): void {
    if (UPGRADE_TIERS[cardId]) this.upgrades.add(cardId);
  }

  isUpgraded(cardId: string): boolean {
    return this.upgrades.has(cardId);
  }

  /** Attach a mutator to its target card. Charges decrement on cast. */
  attachMutator(def: MutatorDef): void {
    this.mutators.push({ def, charges: def.charges });
  }

  /** Resolve the live override for a card cast. Decrements mutator charges. */
  resolveOverride(cardId: string, consume: boolean): Partial<CardDef> {
    let override: Partial<CardDef> = {};
    if (this.upgrades.has(cardId)) {
      override = { ...override, ...UPGRADE_TIERS[cardId].partial };
    }
    for (let i = this.mutators.length - 1; i >= 0; i--) {
      const m = this.mutators[i];
      if (m.def.targetCardId !== null && m.def.targetCardId !== cardId) continue;
      override = { ...override, ...m.def.partial };
      if (consume) {
        m.charges--;
        if (m.charges <= 0) this.mutators.splice(i, 1);
      }
    }
    return override;
  }

  /** Drop room-scoped state — currently a no-op since upgrades are run-permanent
   *  and mutators decrement on cast not on room change. Provided for future
   *  room-only effects (e.g. anomaly_scroll-style mutators). */
  onRoomChange(): void {
    // intentional no-op; mutators tied to charges, not room boundaries
  }
}
