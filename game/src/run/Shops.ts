/**
 * Shop offerings — between-room currency-light system. Each offer has a
 * shard price; player buys one or skips. Currency = SHARDS earned from
 * perfect-clear bonuses + elite kills.
 */

export type ShopOfferKind =
  | "card_upgrade"
  | "mutator"
  | "heal_partial"
  | "relic_uncommon"
  | "anomaly_scroll";

export interface ShopOffer {
  kind: ShopOfferKind;
  name: string;
  description: string;
  cost: number;
  glyph: string;
}

export const SHOP_TEMPLATES: Record<ShopOfferKind, Omit<ShopOffer, "cost"> & { baseCost: number }> = {
  card_upgrade: {
    kind: "card_upgrade",
    name: "Etching Stone",
    description: "Upgrade one card in your deck to its + version.",
    glyph: "✦",
    baseCost: 4,
  },
  mutator: {
    kind: "mutator",
    name: "Mutator Sigil",
    description: "Attach a random Mutator to one of your cards (room-scoped).",
    glyph: "⚙",
    baseCost: 2,
  },
  heal_partial: {
    kind: "heal_partial",
    name: "Healing Draught",
    description: "Restore 30% of your max HP.",
    glyph: "♥",
    baseCost: 3,
  },
  relic_uncommon: {
    kind: "relic_uncommon",
    name: "Sealed Relic",
    description: "An Uncommon-tier relic of unknown form.",
    glyph: "◆",
    baseCost: 5,
  },
  anomaly_scroll: {
    kind: "anomaly_scroll",
    name: "Anomaly Scroll",
    description: "Cancel the next room's anomaly (if any).",
    glyph: "✶",
    baseCost: 3,
  },
};

/** Roll 3 distinct offers with deterministic prices (slight variance). */
export function rollShopOffers(rng: () => number, count = 3): ShopOffer[] {
  const kinds = Object.keys(SHOP_TEMPLATES) as ShopOfferKind[];
  const pool = [...kinds];
  const out: ShopOffer[] = [];
  while (out.length < count && pool.length > 0) {
    const idx = Math.floor(rng() * pool.length);
    const kind = pool.splice(idx, 1)[0];
    const tmpl = SHOP_TEMPLATES[kind];
    // Variance: ±20% on base cost.
    const cost = Math.max(1, Math.round(tmpl.baseCost * (0.8 + rng() * 0.4)));
    out.push({ kind: tmpl.kind, name: tmpl.name, description: tmpl.description, glyph: tmpl.glyph, cost });
  }
  return out;
}
