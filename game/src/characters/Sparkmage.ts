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
  startingDeck: [
    "bolt", "bolt", "chain_lightning",
    "frost_nova", "aegis", "phase_step",
    "meteor_slam", "dashstrike",
  ],
  bodyTint: new Color3(0.30, 0.55, 0.95),
  capeTint: new Color3(0.18, 0.28, 0.62),
  swordTint: new Color3(0.55, 0.85, 1.0),
  idleStyle: "floaty",
  weaponShape: "staff",
  unlockedByDefault: true,
};
