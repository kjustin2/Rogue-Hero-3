import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Arena, buildArena, ArenaOptions, VERDANT_ENV_PALETTE, PIT_ENV_PALETTE } from "../scene/ArenaBuilder";
import { EnemyManager, SpawnRequest } from "../enemies/EnemyManager";
import { HazardTileSpec } from "../scene/HazardTiles";

export interface RoomDescriptor {
  name: string;
  arena: ArenaOptions;
  spawns: SpawnRequest[];
  /** Static damaging tiles placed at room build time. */
  hazards?: HazardTileSpec[];
  /** True for the boss room of an act — drives reward type + intro phase. */
  isBoss?: boolean;
}

// ---- Per-act palettes (kept as constants so multiple rooms can share) ----

// Verdant — warm green forest floor, brown stone walls.
const VERDANT_FLOOR = new Color3(0.18, 0.34, 0.20);
const VERDANT_WALL = new Color3(0.22, 0.18, 0.14);
const VERDANT_PILLAR = new Color3(0.50, 0.42, 0.34);

// Spire — cold blue stone with white-grey marble pillars.
const SPIRE_FLOOR = new Color3(0.16, 0.20, 0.32);
const SPIRE_WALL = new Color3(0.16, 0.18, 0.26);
const SPIRE_PILLAR = new Color3(0.74, 0.78, 0.88);
const SPIRE_ENV = {
  ...VERDANT_ENV_PALETTE,
  grass: new Color3(0.20, 0.26, 0.32),
  grassTip: new Color3(0.45, 0.55, 0.70),
  rock: new Color3(0.55, 0.58, 0.65),
  mushroomCap: new Color3(0.40, 0.55, 0.85),
  mushroomStem: new Color3(0.62, 0.66, 0.74),
  skyTop: new Color3(0.18, 0.24, 0.38),
  skyBottom: new Color3(0.55, 0.60, 0.75),
  moteColor: new Color3(0.65, 0.85, 1.0),
  grassCount: 140,
  rockCount: 22,
  mushroomCount: 4,
};

// Magma — black basalt floor, red glowing veins via env mote color.
const MAGMA_FLOOR = new Color3(0.10, 0.08, 0.07);
const MAGMA_WALL = new Color3(0.12, 0.06, 0.05);
const MAGMA_PILLAR = new Color3(0.30, 0.18, 0.12);
const MAGMA_ENV = {
  ...PIT_ENV_PALETTE,
  grass: new Color3(0.08, 0.05, 0.04),
  grassTip: new Color3(1.0, 0.35, 0.10),
  rock: new Color3(0.10, 0.06, 0.05),
  mushroomCap: new Color3(0.85, 0.20, 0.05),
  mushroomStem: new Color3(0.30, 0.10, 0.05),
  skyTop: new Color3(0.12, 0.04, 0.04),
  skyBottom: new Color3(0.55, 0.18, 0.05),
  moteColor: new Color3(1.0, 0.55, 0.20),
  grassCount: 60,
  rockCount: 38,
  mushroomCount: 1,
};

/**
 * 9-room run laid out across 3 acts (2 fights + 1 boss each). Each act
 * shares a palette + env so the player gets a clear "this is Act II" read,
 * and each room within varies by pillar formation, hazards, and enemy mix.
 *
 * Boss rooms set `isBoss: true` so the reward dispatcher knows to offer a
 * new card instead of a relic.
 *
 * Backwards-compat note: the previous `VERTICAL_SLICE_ROOMS` export is kept
 * as an alias so any external script (smoke tests, dev tools) that still
 * imports it continues to work.
 */
export const ACT_ROOMS: RoomDescriptor[] = [
  // ---- Act I — Verdant ----
  {
    name: "Verdant Approach",
    arena: {
      size: 40, wallHeight: 10, pillarCount: 4,
      pillarFormation: "scatter",
      paletteFloor: VERDANT_FLOOR, paletteWall: VERDANT_WALL, palettePillar: VERDANT_PILLAR,
      envPalette: VERDANT_ENV_PALETTE, rngSeed: 1337, ceiling: true, exitDoor: true,
    },
    spawns: [
      { kind: "chaser", pos: new Vector3(8, 0, 6) },
      { kind: "chaser", pos: new Vector3(-7, 0, 5) },
      { kind: "chaser", pos: new Vector3(0, 0, -10) },
    ],
  },
  {
    name: "Verdant Crossing",
    arena: {
      size: 46, wallHeight: 10, pillarCount: 6,
      pillarFormation: "rows",
      paletteFloor: VERDANT_FLOOR, paletteWall: VERDANT_WALL, palettePillar: VERDANT_PILLAR,
      envPalette: VERDANT_ENV_PALETTE, rngSeed: 4242, ceiling: true, exitDoor: true,
    },
    spawns: [
      { kind: "chaser", pos: new Vector3(10, 0, 8) },
      { kind: "chaser", pos: new Vector3(-9, 0, 7) },
      { kind: "shooter", pos: new Vector3(12, 0, -10) },
      { kind: "caster", pos: new Vector3(-12, 0, -8) },
    ],
  },
  {
    name: "Brawler's Pit",
    arena: {
      size: 54, wallHeight: 12, pillarCount: 0,
      paletteFloor: new Color3(0.12, 0.16, 0.12), paletteWall: new Color3(0.18, 0.10, 0.08),
      palettePillar: VERDANT_PILLAR, paletteCeiling: new Color3(0.10, 0.06, 0.05),
      envPalette: PIT_ENV_PALETTE, rngSeed: 9999, ceiling: true, exitDoor: true,
    },
    spawns: [
      { kind: "boss_brawler", pos: new Vector3(0, 0, -18) },
    ],
    isBoss: true,
  },

  // ---- Act II — Spire ----
  {
    name: "Spire Ascent",
    arena: {
      size: 44, wallHeight: 12, pillarCount: 6,
      pillarFormation: "ring",
      paletteFloor: SPIRE_FLOOR, paletteWall: SPIRE_WALL, palettePillar: SPIRE_PILLAR,
      envPalette: SPIRE_ENV, rngSeed: 2025, ceiling: true, exitDoor: true,
    },
    spawns: [
      { kind: "lancer", pos: new Vector3(0, 0, -12) },
      { kind: "swarmer", pos: new Vector3(7, 0, 0) },
      { kind: "swarmer", pos: new Vector3(-7, 0, 0) },
      { kind: "swarmer", pos: new Vector3(9, 0, 4) },
      { kind: "wisp", pos: new Vector3(-10, 0, -6) },
    ],
  },
  {
    name: "Crystal Hall",
    arena: {
      size: 50, wallHeight: 12, pillarCount: 8,
      pillarFormation: "rows",
      paletteFloor: SPIRE_FLOOR, paletteWall: SPIRE_WALL, palettePillar: SPIRE_PILLAR,
      envPalette: SPIRE_ENV, rngSeed: 4422, ceiling: true, exitDoor: true,
    },
    spawns: [
      { kind: "lancer", pos: new Vector3(8, 0, -8) },
      { kind: "lancer", pos: new Vector3(-8, 0, -8) },
      { kind: "wisp", pos: new Vector3(0, 0, -12) },
      { kind: "caster", pos: new Vector3(0, 0, 4) },
      { kind: "shooter", pos: new Vector3(12, 0, 6) },
    ],
  },
  {
    name: "Spire Apex",
    arena: {
      size: 56, wallHeight: 14, pillarCount: 6,
      pillarFormation: "throne_back",
      paletteFloor: new Color3(0.10, 0.14, 0.22), paletteWall: new Color3(0.12, 0.14, 0.20),
      palettePillar: SPIRE_PILLAR, paletteCeiling: new Color3(0.08, 0.10, 0.18),
      envPalette: SPIRE_ENV, rngSeed: 7777, ceiling: true, exitDoor: true,
    },
    spawns: [
      { kind: "boss_spire_caster", pos: new Vector3(0, 0, -18) },
    ],
    isBoss: true,
  },

  // ---- Act III — Magma ----
  {
    name: "Magma Vents",
    arena: {
      size: 46, wallHeight: 12, pillarCount: 4,
      pillarFormation: "scatter",
      paletteFloor: MAGMA_FLOOR, paletteWall: MAGMA_WALL, palettePillar: MAGMA_PILLAR,
      envPalette: MAGMA_ENV, rngSeed: 1212, ceiling: true, exitDoor: true,
    },
    hazards: [
      { kind: "lava", x: 8, z: 0, width: 6, depth: 4 },
      { kind: "lava", x: -8, z: -4, width: 5, depth: 5 },
    ],
    spawns: [
      { kind: "leaper", pos: new Vector3(0, 0, -10) },
      { kind: "swarmer", pos: new Vector3(6, 0, 5) },
      { kind: "swarmer", pos: new Vector3(-6, 0, 5) },
      { kind: "swarmer", pos: new Vector3(0, 0, 8) },
    ],
  },
  {
    name: "Forge Path",
    arena: {
      size: 52, wallHeight: 12, pillarCount: 4,
      pillarFormation: "rows",
      paletteFloor: MAGMA_FLOOR, paletteWall: MAGMA_WALL, palettePillar: MAGMA_PILLAR,
      envPalette: MAGMA_ENV, rngSeed: 1313, ceiling: true, exitDoor: true,
    },
    hazards: [
      { kind: "spikes", x: 0, z: -4, width: 8, depth: 3, cycle: 2.0 },
      { kind: "spikes", x: 0, z: 6, width: 8, depth: 3, cycle: 2.4 },
      { kind: "lava", x: 14, z: 0, width: 4, depth: 6 },
    ],
    spawns: [
      { kind: "leaper", pos: new Vector3(-6, 0, -12) },
      { kind: "lancer", pos: new Vector3(0, 0, -16) },
      { kind: "swarmer", pos: new Vector3(8, 0, -2) },
      { kind: "swarmer", pos: new Vector3(-8, 0, -2) },
      { kind: "wisp", pos: new Vector3(0, 0, 12) },
    ],
  },
  {
    name: "Colossal Caldera",
    arena: {
      size: 60, wallHeight: 14, pillarCount: 0,
      paletteFloor: new Color3(0.08, 0.06, 0.05), paletteWall: new Color3(0.14, 0.07, 0.05),
      palettePillar: MAGMA_PILLAR, paletteCeiling: new Color3(0.08, 0.04, 0.03),
      envPalette: MAGMA_ENV, rngSeed: 1414, ceiling: true, exitDoor: false,
    },
    hazards: [
      { kind: "lava", x: -12, z: -10, width: 8, depth: 8 },
      { kind: "lava", x: 12, z: -10, width: 8, depth: 8 },
      { kind: "lava", x: 0, z: -22, width: 12, depth: 4 },
    ],
    spawns: [
      { kind: "boss_colossus", pos: new Vector3(0, 0, -18) },
    ],
    isBoss: true,
  },
];

/** Backwards-compat alias — older callers / tests reference this name. */
export const VERTICAL_SLICE_ROOMS = ACT_ROOMS;

export class RunManager {
  arena: Arena | null = null;
  currentIndex = -1;

  constructor(
    private scene: Scene,
    private shadow: ShadowGenerator,
    private enemies: EnemyManager,
    public rooms: RoomDescriptor[],
  ) {}

  /** Load the room at idx. Disposes the current arena and clears enemies first. */
  loadRoom(idx: number): Arena {
    if (idx < 0 || idx >= this.rooms.length) {
      throw new Error(`RunManager: room index ${idx} out of bounds (have ${this.rooms.length})`);
    }
    if (this.arena) {
      this.arena.dispose();
      this.arena = null;
    }
    this.enemies.clear();

    const desc = this.rooms[idx];
    this.arena = buildArena(this.scene, this.shadow, desc.arena);
    this.enemies.spawnAll(desc.spawns);
    this.currentIndex = idx;
    return this.arena;
  }

  isLastRoom(): boolean {
    return this.currentIndex >= this.rooms.length - 1;
  }

  hasNext(): boolean {
    return !this.isLastRoom();
  }

  nextRoom(): Arena {
    return this.loadRoom(this.currentIndex + 1);
  }
}
