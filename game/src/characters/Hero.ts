import { Color3 } from "@babylonjs/core/Maths/math.color";
import { ClassPassives } from "../tempo/TempoSystem";

/**
 * Per-hero design data. Selected at run start; drives the Player's stats,
 * starting deck, and visual presentation. New heroes are added by writing a
 * HeroDef constant and registering it in HeroRegistry.
 */
export interface HeroDef {
  id: string;
  name: string;
  /** Short tagline shown on the hero-select card. */
  tagline: string;
  /** Starting HP (also caps maxHp for the run). */
  hp: number;
  /** Move speed in m/s. Defaults around 6. */
  moveSpeed: number;
  /** Tempo passives bound at run start. */
  passives: ClassPassives;
  /** Card ids to seed the deck collection with. */
  startingDeck: string[];
  /** Body / cape / weapon tints applied to the player mesh. */
  bodyTint: Color3;
  capeTint: Color3;
  swordTint: Color3;
  /** Sway profile — drives idle bob amplitude/frequency. */
  idleStyle: "stoic" | "floaty";
  /** Visual silhouette of the held weapon. */
  weaponShape: "sword" | "staff";
  /** Locked heroes appear in the picker but cannot be selected until unlocked. */
  unlockedByDefault: boolean;
  /** Tooltip string shown on locked cards (e.g. "Clear Act II"). */
  lockedDesc?: string;
}
