import { Color3 } from "@babylonjs/core/Maths/math.color";
import { HeroDef } from "./Hero";

/**
 * Bulwark — slow, heavy melee tank. Locked at run start; unlocked by clearing
 * Act III. Highest HP in the roster, lowest move speed.
 */
export const BULWARK: HeroDef = {
  id: "bulwark",
  name: "Bulwark",
  tagline: "Slow tank. Drinks damage.",
  hp: 140,
  moveSpeed: 5.0,
  passives: {
    crashResetValue: 45,
    dampedDecay: 0.6,
  },
  // Tank identity: heavy single-target slam, an omni spin for crowd control,
  // and a shield to soak hits. Slow, deliberate, defensive.
  startingDeck: ["crashing_blow", "whirlwind", "aegis"],
  bodyTint: new Color3(0.55, 0.55, 0.60),
  capeTint: new Color3(0.30, 0.30, 0.40),
  swordTint: new Color3(0.70, 0.72, 0.78),
  idleStyle: "stoic",
  weaponShape: "sword",
  unlockedByDefault: false,
  lockedDesc: "Clear Act III to unlock",
};
