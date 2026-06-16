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
];

export function cosmeticById(id: string): CosmeticDef {
  const c = COSMETICS.find((c) => c.id === id);
  if (!c) throw new Error(`Unknown cosmetic: ${id}`);
  return c;
}

export const DEFAULT_COSMETICS = { cape: "cape-crimson", blade: "blade-cyan" };
