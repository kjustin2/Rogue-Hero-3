import { HEROES } from "../characters/HeroRegistry";

const STORAGE_KEY = "rh3.unlocked.v1";

/**
 * Persistent unlocked-hero registry. Heroes that ship as "default unlocked"
 * are always present; act-clear events add the others to localStorage.
 *
 * The localStorage layer is best-effort — sessions with no storage (private
 * mode, file:// without a backing store) fall back to defaults each boot.
 */
export function getUnlockedHeroes(): Set<string> {
  const set = new Set<string>(HEROES.filter((h) => h.unlockedByDefault).map((h) => h.id));
  if (typeof localStorage === "undefined") return set;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return set;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      for (const id of arr) {
        if (typeof id === "string") set.add(id);
      }
    }
  } catch {
    /* corrupted entry — fall back to defaults */
  }
  return set;
}

export function unlockHero(id: string): void {
  if (typeof localStorage === "undefined") return;
  const cur = getUnlockedHeroes();
  if (cur.has(id)) return;
  cur.add(id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...cur]));
  } catch {
    /* storage full / disabled — silent */
  }
}

export function isHeroUnlocked(id: string): boolean {
  return getUnlockedHeroes().has(id);
}
