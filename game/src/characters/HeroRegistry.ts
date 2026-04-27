import { HeroDef } from "./Hero";
import { BLADE } from "./Blade";
import { SPARKMAGE } from "./Sparkmage";
import { STALKER } from "./Stalker";
import { BULWARK } from "./Bulwark";

export const HEROES: HeroDef[] = [BLADE, SPARKMAGE, STALKER, BULWARK];

export const HERO_BY_ID: Record<string, HeroDef> = HEROES.reduce(
  (acc, h) => {
    acc[h.id] = h;
    return acc;
  },
  {} as Record<string, HeroDef>,
);

export function getHero(id: string): HeroDef | null {
  return HERO_BY_ID[id] ?? null;
}
