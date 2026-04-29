import { Color3 } from "@babylonjs/core/Maths/math.color";
import { HeroDef } from "./Hero";

/**
 * Stalker — fast hit-and-run rogue. Locked at run start; unlocked by clearing
 * Act II. Starting deck and tuning are stubbed; full kit lands when the unlock
 * actually triggers in a future pass.
 */
export const STALKER: HeroDef = {
  id: "stalker",
  name: "Stalker",
  tagline: "Fast hit-and-run rogue.",
  hp: 85,
  moveSpeed: 7.2,
  passives: {
    crashResetValue: 55,
    perfectDodgeTempoGain: 10,
  },
  // Hit-and-run identity: damage dash to engage, phase blink to disengage,
  // and a ranged bolt for finishing kited targets.
  startingDeck: ["dashstrike", "phase_step", "bolt"],
  bodyTint: new Color3(0.35, 0.20, 0.55),
  capeTint: new Color3(0.20, 0.10, 0.35),
  swordTint: new Color3(0.85, 0.65, 1.0),
  idleStyle: "stoic",
  weaponShape: "sword",
  unlockedByDefault: false,
  lockedDesc: "Clear Act II to unlock",
};
