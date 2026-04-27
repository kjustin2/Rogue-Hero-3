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
  startingDeck: [
    "cleave", "cleave", "crashing_blow",
    "bolt", "dashstrike", "whirlwind",
    "aegis", "phase_step",
  ],
  bodyTint: new Color3(0.78, 0.74, 0.70),
  capeTint: new Color3(0.78, 0.18, 0.18),
  swordTint: new Color3(0.85, 0.88, 0.92),
  idleStyle: "stoic",
  weaponShape: "sword",
  unlockedByDefault: true,
};
