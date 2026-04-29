import { Color3 } from "@babylonjs/core/Maths/math.color";
import { HeroDef } from "./Hero";

/**
 * Blade — balanced melee hero. The "easy mode" tutorial frame for the tempo
 * system: most starting cards work in melee range so the player learns the
 * Crash + dodge rhythm against close-combat geometry first.
 */
export const BLADE: HeroDef = {
  id: "blade",
  name: "Blade",
  tagline: "Balanced melee. Lives or dies on tempo.",
  hp: 100,
  moveSpeed: 6,
  passives: {
    crashResetValue: 50,
  },
  // 3 distinct cards — a wide-arc melee, an opening dash, and a defensive
  // shield. Together they teach close combat, gap-closing, and survival.
  // New cards are earned per boss; deck capped at 5 so the third boss reward
  // requires swapping out an older card.
  startingDeck: ["cleave", "dashstrike", "aegis"],
  bodyTint: new Color3(0.78, 0.74, 0.70),
  capeTint: new Color3(0.78, 0.18, 0.18),
  swordTint: new Color3(0.85, 0.88, 0.92),
  idleStyle: "stoic",
  weaponShape: "sword",
  unlockedByDefault: true,
};
