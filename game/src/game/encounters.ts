/** Authored spaces and tactics. The counterclockwise outlines are shared by
 * collision, spawning, projectiles and the visible chamber masonry. */
export type EncounterKind = "procession" | "crossfire" | "pursuit" | "bastion" | "breach";
export interface EncounterDef {
  name: string;
  brief: string;
  boundary: readonly (readonly [number, number])[];
  obstacles: { x: number; z: number; r: number }[];
}

export const ENCOUNTERS: Record<EncounterKind, EncounterDef> = {
  procession: {
    name: "The Processional",
    brief: "Break the advancing line. Hunters screen the archers behind it.",
    boundary: [[-8,-16],[8,-16],[11,-12],[11,12],[8,16],[-8,16],[-11,12],[-11,-12]],
    obstacles: [{ x: -7, z: -5, r: 1.2 }, { x: 7, z: -5, r: 1.2 }, { x: -7, z: 5, r: 1.2 }, { x: 7, z: 5, r: 1.2 }],
  },
  crossfire: {
    name: "The Split Gallery",
    brief: "Two firing positions. Use the central cover to close on one flank at a time.",
    boundary: [[-11,-12],[11,-12],[16,-7],[16,7],[9,13],[-9,13],[-16,7],[-16,-7]],
    obstacles: [{ x: 0, z: -4, r: 1.7 }, { x: 0, z: 4, r: 1.7 }, { x: -10, z: -7, r: 1.0 }, { x: 10, z: -7, r: 1.0 }],
  },
  pursuit: {
    name: "The Hounds' Walk",
    brief: "Hunters strike from the wings. Turn around the broken columns to separate the pack.",
    boundary: [[-7,-16],[7,-14],[13,-6],[11,8],[6,15],[-7,14],[-13,5],[-12,-7]],
    obstacles: [{ x: -5, z: -6, r: 1.3 }, { x: 6, z: -1, r: 1.3 }, { x: -5, z: 6, r: 1.3 }],
  },
  bastion: {
    name: "The Shield Court",
    brief: "A guard protects the artillery. Circle the bastion or break straight through.",
    boundary: [[-8,-15],[8,-15],[14,-7],[14,6],[8,14],[-8,14],[-14,6],[-14,-7]],
    obstacles: [{ x: -4.4, z: -3, r: 1.5 }, { x: 4.4, z: -3, r: 1.5 }, { x: -10, z: 4, r: 1.0 }, { x: 10, z: 4, r: 1.0 }],
  },
  breach: {
    name: "The Breach",
    brief: "A rushing swarm, then its keeper. Build heat on the pack and save your Crash for the counterattack.",
    boundary: [[-7,-16],[7,-16],[16,-7],[16,7],[7,16],[-7,16],[-16,7],[-16,-7]],
    obstacles: [{ x: -9, z: -3, r: 1.5 }, { x: 9, z: -3, r: 1.5 }],
  },
};
