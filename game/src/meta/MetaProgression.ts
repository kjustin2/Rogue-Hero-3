/**
 * Persistent stat shards + flawless boss flags + discovered SFX. Cross-run
 * meta-progression backed by `localStorage` (extends the same pattern
 * `HeroUnlocks.ts` uses).
 *
 * Storage keys are versioned (".v1") so a future schema change can detect
 * legacy saves and migrate or wipe gracefully.
 */

const SHARDS_KEY = "rh3.statShards.v1";
const SHARDS_SPENT_KEY = "rh3.statShards.spent.v1";
const FLAWLESS_KEY = "rh3.flawless.v1";
const SFX_DISCOVERED_KEY = "rh3.sfxDiscovered.v1";

export type ShardSlot = "max_hp" | "max_ap" | "iframes";
const SLOT_COSTS: Record<ShardSlot, number[]> = {
  max_hp:  [1, 2, 4],
  max_ap:  [1, 2, 4],
  iframes: [1, 2, 4],
};

export const SHARD_BUFFS: Record<ShardSlot, { label: string; perRank: number; description: string }> = {
  max_hp:  { label: "+5 max HP",         perRank: 5,    description: "Each rank adds 5 max HP." },
  max_ap:  { label: "+1 max AP",         perRank: 1,    description: "Each rank adds 1 max AP." },
  iframes: { label: "+0.05s i-frames",   perRank: 0.05, description: "Each rank lengthens dodge i-frames." },
};

interface ShardSpent {
  blade?: Partial<Record<ShardSlot, number>>;
  sparkmage?: Partial<Record<ShardSlot, number>>;
  stalker?: Partial<Record<ShardSlot, number>>;
  bulwark?: Partial<Record<ShardSlot, number>>;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage === "undefined") return fallback;
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota / mode errors; meta progression degrades gracefully.
  }
}

export function getShards(): number {
  return readJson<number>(SHARDS_KEY, 0);
}

export function addShards(amount: number): void {
  if (amount <= 0) return;
  writeJson(SHARDS_KEY, getShards() + amount);
}

export function getShardSpend(): ShardSpent {
  return readJson<ShardSpent>(SHARDS_SPENT_KEY, {});
}

export function getRank(heroId: string, slot: ShardSlot): number {
  const sp = getShardSpend();
  const h = sp[heroId as keyof ShardSpent];
  return h?.[slot] ?? 0;
}

export function nextCost(heroId: string, slot: ShardSlot): number | null {
  const rank = getRank(heroId, slot);
  const costs = SLOT_COSTS[slot];
  return rank >= costs.length ? null : costs[rank];
}

export function spendShard(heroId: string, slot: ShardSlot): boolean {
  const cost = nextCost(heroId, slot);
  if (cost === null) return false;
  const have = getShards();
  if (have < cost) return false;
  writeJson(SHARDS_KEY, have - cost);
  const sp = getShardSpend();
  const h = (sp[heroId as keyof ShardSpent] ??= {});
  h[slot] = (h[slot] ?? 0) + 1;
  writeJson(SHARDS_SPENT_KEY, sp);
  return true;
}

/** Apply a hero's shard buffs to base stats. Caller mutates max HP / AP / iframes. */
export function shardBuffsFor(heroId: string): { hp: number; ap: number; iframes: number } {
  return {
    hp: getRank(heroId, "max_hp") * SHARD_BUFFS.max_hp.perRank,
    ap: getRank(heroId, "max_ap") * SHARD_BUFFS.max_ap.perRank,
    iframes: getRank(heroId, "iframes") * SHARD_BUFFS.iframes.perRank,
  };
}

// ---- Flawless boss flags ----

export function getFlawlessBosses(): Set<string> {
  return new Set(readJson<string[]>(FLAWLESS_KEY, []));
}

export function markFlawless(bossId: string): void {
  const set = getFlawlessBosses();
  if (set.has(bossId)) return;
  set.add(bossId);
  writeJson(FLAWLESS_KEY, [...set]);
}

// ---- Discovered SFX ----

export function getDiscoveredSfx(): Set<string> {
  return new Set(readJson<string[]>(SFX_DISCOVERED_KEY, []));
}

export function markSfxDiscovered(id: string): void {
  const set = getDiscoveredSfx();
  if (set.has(id)) return;
  set.add(id);
  writeJson(SFX_DISCOVERED_KEY, [...set]);
}
