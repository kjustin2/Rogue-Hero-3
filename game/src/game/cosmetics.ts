/**
 * Shard-bought cosmetics. Two slots: cape cloth color and blade energy
 * color (also tints the sword trail and slash arcs). Prices in rift shards.
 */
export interface CosmeticDef {
  id: string;
  name: string;
  slot: "cape" | "blade";
  color: number;
  price: number;
  /** Earned (never bought) — the hint tells the player how. Granted by milestones. */
  earned?: string;
}

export const COSMETICS: CosmeticDef[] = [
  // Capes
  { id: "cape-crimson", name: "Crimson Cloak", slot: "cape", color: 0x3a1020, price: 0 },
  { id: "cape-emerald", name: "Emerald Mantle", slot: "cape", color: 0x0d3a22, price: 150 },
  { id: "cape-void", name: "Void Shroud", slot: "cape", color: 0x2a1048, price: 150 },
  { id: "cape-gold", name: "Gilded Drape", slot: "cape", color: 0x6a4a10, price: 250 },
  { id: "cape-frost", name: "Frostweave", slot: "cape", color: 0x39505e, price: 250 },
  { id: "cape-ash", name: "Ashen Shroud", slot: "cape", color: 0x2b2b30, price: 200 },
  { id: "cape-royal", name: "Royal Indigo", slot: "cape", color: 0x1a2466, price: 300 },
  { id: "cape-jade", name: "Jade Sovereign", slot: "cape", color: 0x0a4a40, price: 300 },
  { id: "cape-magma", name: "Magmaweave", slot: "cape", color: 0x5a1208, price: 350 },
  { id: "cape-storm", name: "Stormcaller", slot: "cape", color: 0x14384e, price: 400 },
  // Blade energy
  { id: "blade-cyan", name: "Rift Cyan", slot: "blade", color: 0x44ccff, price: 0 },
  { id: "blade-magenta", name: "Phase Magenta", slot: "blade", color: 0xff44dd, price: 150 },
  { id: "blade-emerald", name: "Verdant Edge", slot: "blade", color: 0x44ff99, price: 200 },
  { id: "blade-gold", name: "Solar Brand", slot: "blade", color: 0xffcc44, price: 200 },
  { id: "blade-blood", name: "Blood Oath", slot: "blade", color: 0xff4452, price: 250 },
  { id: "blade-violet", name: "Void Arc", slot: "blade", color: 0x9a5cff, price: 300 },
  { id: "blade-ember", name: "Ember Brand", slot: "blade", color: 0xff7a2a, price: 300 },
  { id: "blade-frost", name: "Glacial Edge", slot: "blade", color: 0x8fe8ff, price: 350 },
  { id: "blade-toxic", name: "Venom Glow", slot: "blade", color: 0x9aff44, price: 350 },
  { id: "blade-prism", name: "Prism Light", slot: "blade", color: 0xffffff, price: 450 },
  // --- Hero mastery (earned, never sold): first win → a blade; a depth-5 win → a cape.
  { id: "blade-sig-blade", name: "Edgemaster's Light", slot: "blade", color: 0x7ff0ff, price: 0, earned: "Seal the Rift as the Blade" },
  { id: "blade-sig-bulwark", name: "Bastion Flame", slot: "blade", color: 0xffb066, price: 0, earned: "Seal the Rift as the Bulwark" },
  { id: "blade-sig-sparkmage", name: "Arcanist's Gleam", slot: "blade", color: 0xd8a8ff, price: 0, earned: "Seal the Rift as the Sparkmage" },
  { id: "blade-sig-reaver", name: "Reaver's Grudge", slot: "blade", color: 0xff6a52, price: 0, earned: "Seal the Rift as the Reaver" },
  { id: "blade-sig-tempest", name: "Stormsurf", slot: "blade", color: 0x7df3d0, price: 0, earned: "Seal the Rift as the Tempest" },
  { id: "blade-sig-revenant", name: "Grave-light", slot: "blade", color: 0x6affb0, price: 0, earned: "Seal the Rift as the Revenant" },
  { id: "cape-sig-blade", name: "Blade's Standard", slot: "cape", color: 0x0e4652, price: 0, earned: "Seal the Rift at Depth 5+ as the Blade" },
  { id: "cape-sig-bulwark", name: "Bastion Wall", slot: "cape", color: 0x5a3a10, price: 0, earned: "Seal the Rift at Depth 5+ as the Bulwark" },
  { id: "cape-sig-sparkmage", name: "Arcane Vestment", slot: "cape", color: 0x3a1a58, price: 0, earned: "Seal the Rift at Depth 5+ as the Sparkmage" },
  { id: "cape-sig-reaver", name: "Butcher's Drape", slot: "cape", color: 0x581212, price: 0, earned: "Seal the Rift at Depth 5+ as the Reaver" },
  { id: "cape-sig-tempest", name: "Storm Mantle", slot: "cape", color: 0x0e4a42, price: 0, earned: "Seal the Rift at Depth 5+ as the Tempest" },
  { id: "cape-sig-revenant", name: "Shroud of Return", slot: "cape", color: 0x0e4a28, price: 0, earned: "Seal the Rift at Depth 5+ as the Revenant" },
  // --- The Ascension summit
  { id: "blade-riftgold", name: "Riftgold", slot: "blade", color: 0xffd24a, price: 0, earned: "Seal the Rift at Depth 15" },
  { id: "blade-woundbreaker", name: "Woundbreaker", slot: "blade", color: 0xff2a4a, price: 0, earned: "Slay the Wound Beneath (Depth 3+)" },
];

export function cosmeticById(id: string): CosmeticDef {
  const c = COSMETICS.find((c) => c.id === id);
  if (!c) throw new Error(`Unknown cosmetic: ${id}`);
  return c;
}

export const DEFAULT_COSMETICS = { cape: "cape-crimson", blade: "blade-cyan" };
