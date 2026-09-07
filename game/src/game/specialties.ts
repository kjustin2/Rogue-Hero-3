import type { CardDef } from "./cards";
import type { ImpactElement } from "../presentation/types";

export type School = "steel" | "storm" | "rime" | "ember" | "veil" | "blood" | "guard";
const SCHOOL_ELEMENTS: Record<School, ImpactElement> = { steel: "steel", storm: "lightning", rime: "frost", ember: "fire", veil: "rift", blood: "blood", guard: "steel" };
export function schoolElement(school: School): ImpactElement { return SCHOOL_ELEMENTS[school]; }
export interface Specialty { id: School; name: string; color: string; benefit: string; crashName: string; crashBenefit: string; }
export const SPECIALTIES: readonly Specialty[] = [
  { id: "steel", name: "Sword Saint", color: "#e6bf79", benefit: "Combo finishers and charged blows deal 25% more damage.", crashName: "Sovereign Cut", crashBenefit: "Crash launches three piercing sword waves ahead of you." },
  { id: "storm", name: "Stormbound", color: "#e4d982", benefit: "Sword hits refund 0.15s on equipped storm abilities.", crashName: "Thunder Reprise", crashBenefit: "Crash chains lightning through up to six nearby enemies." },
  { id: "rime", name: "Frostbreaker", color: "#a7d8ef", benefit: "Sword blows deal 35% more damage to frozen enemies.", crashName: "Winter’s Verdict", crashBenefit: "Crash freezes its survivors and leaves them vulnerable." },
  { id: "ember", name: "Ashbringer", color: "#ed9d68", benefit: "Burns deal 35% more damage.", crashName: "Funeral Pyre", crashBenefit: "Crash ignites its survivors. A meteor strikes the blast center a moment later." },
  { id: "veil", name: "Riftwalker", color: "#b0a1df", benefit: "Casting a veil ability grants 0.2s of invulnerability.", crashName: "Eventide", crashBenefit: "Crash pulls its survivors to you and gives you a longer invulnerability window." },
  { id: "blood", name: "Blood Reaver", color: "#e48a91", benefit: "Kills restore 3 HP.", crashName: "Crimson Reckoning", crashBenefit: "Crash consumes nearby wounds and burns for burst damage, restoring up to 12 HP." },
  { id: "guard", name: "Oathkeeper", color: "#a1c8e4", benefit: "Casting a guard ability adds 6 barrier, up to 60.", crashName: "Last Bastion", crashBenefit: "Crash reflects nearby projectiles and grants a fresh barrier." },
];
const SCHOOLS: Record<string, School> = {
  "dash-strike": "steel", "cleave": "steel", "mine-field": "steel", "sunder": "steel", "blade-cyclone": "steel", "hammer-drop": "steel",
  "arc-bolt": "veil", "phase-step": "veil", "gravity-well": "veil", "seeker-swarm": "veil", "rift-hook": "veil", "blade-spirit": "veil",
  "frost-nova": "rime", "glacial-lance": "rime",
  "meteor-call": "ember", "flame-channel": "ember",
  "chain-lightning": "storm", "storm-conduit": "storm", "tempest-storm": "storm",
  "bleeding-edge": "blood", "rend-boomerang": "blood", "hemorrhage": "blood", "soul-drain": "blood",
  "aegis": "guard", "riposte": "guard", "warcry": "guard", "shield-bash": "guard", "decoy-totem": "guard",
};
export function cardSchool(card: CardDef): School { return SCHOOLS[card.id]; }
export function specialtyFor(cards: readonly (CardDef | null)[]): Specialty | null {
  for (const specialty of SPECIALTIES) {
    if (cards.filter(card => card && cardSchool(card) === specialty.id).length >= 2) return specialty;
  }
  return null;
}
export function schoolLabel(card: CardDef): string { return cardSchool(card).toUpperCase(); }
