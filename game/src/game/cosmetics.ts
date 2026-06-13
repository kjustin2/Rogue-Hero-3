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
  // Blade energy
  { id: "blade-cyan", name: "Rift Cyan", slot: "blade", color: 0x44ccff, price: 0 },
  { id: "blade-magenta", name: "Phase Magenta", slot: "blade", color: 0xff44dd, price: 150 },
  { id: "blade-emerald", name: "Verdant Edge", slot: "blade", color: 0x44ff99, price: 200 },
  { id: "blade-gold", name: "Solar Brand", slot: "blade", color: 0xffcc44, price: 200 },
  { id: "blade-blood", name: "Blood Oath", slot: "blade", color: 0xff4452, price: 250 },
];

export function cosmeticById(id: string): CosmeticDef {
  const c = COSMETICS.find((c) => c.id === id);
  if (!c) throw new Error(`Unknown cosmetic: ${id}`);
  return c;
}

export const DEFAULT_COSMETICS = { cape: "cape-crimson", blade: "blade-cyan" };
