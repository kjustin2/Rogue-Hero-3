import { Color3 } from "@babylonjs/core/Maths/math.color";
import { HeroDef } from "./Hero";

/**
 * Sparkmage — glass-cannon ranged caster. Fewer hit points but a wider
 * starting toolkit of projectiles + AoE, plus the only hero to begin with
 * Meteor Slam. Plays at distance, kites with Phase Step.
 */
export const SPARKMAGE: HeroDef = {
  id: "sparkmage",
  name: "Sparkmage",
  tagline: "Glass cannon. Storm at range.",
  hp: 80,
  moveSpeed: 6.5,
  passives: {
    crashResetValue: 60,
    perfectDodgeTempoGain: 12,
  },
  // Pure caster identity: a fast single-target bolt, a panic-AoE freeze, and
  // a phase blink for kiting. No melee — leans into the glass-cannon fantasy.
  startingDeck: ["bolt", "frost_nova", "phase_step"],
  bodyTint: new Color3(0.30, 0.55, 0.95),
  capeTint: new Color3(0.18, 0.28, 0.62),
  swordTint: new Color3(0.55, 0.85, 1.0),
  idleStyle: "floaty",
  weaponShape: "staff",
  unlockedByDefault: true,
};
