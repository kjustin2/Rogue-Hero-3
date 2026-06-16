/**
 * Run-start blessings — an optional gift chosen after the hero, before the
 * descent. Locked on a fresh profile; each is earned through play via a
 * milestone in `profile.ts` (`blessing:<id>` unlock keys). Shared here so both
 * the hero-select UI and the profile/milestone resolver read one definition.
 */
export interface BlessingDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
  color: string;
}

export const BLESSINGS: BlessingDef[] = [
  { id: "vigor", name: "Warrior's Vigor", desc: "+25 maximum HP, mended in full.", icon: "♥", color: "#ff8a8a" },
  { id: "fortune", name: "Scavenger's Fortune", desc: "Begin with ◆ 120 rift shards.", icon: "◆", color: "#ffd27a" },
  { id: "arsenal", name: "Warden's Arsenal", desc: "Begin the run already holding a relic.", icon: "⛨", color: "#7fc8ff" },
];

export function blessingById(id: string): BlessingDef | undefined {
  return BLESSINGS.find((b) => b.id === id);
}
