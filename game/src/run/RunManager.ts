import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Arena, buildArena, ArenaOptions, VERDANT_ENV_PALETTE, PIT_ENV_PALETTE } from "../scene/ArenaBuilder";
import { EnemyManager, SpawnRequest } from "../enemies/EnemyManager";

export interface RoomDescriptor {
  name: string;
  arena: ArenaOptions;
  spawns: SpawnRequest[];
}

export const VERTICAL_SLICE_ROOMS: RoomDescriptor[] = [
  {
    name: "Verdant Approach",
    arena: {
      size: 40,
      wallHeight: 10,
      pillarCount: 4,
      paletteFloor: new Color3(0.16, 0.34, 0.18),
      paletteWall: new Color3(0.22, 0.18, 0.14),
      palettePillar: new Color3(0.45, 0.40, 0.34),
      paletteCeiling: new Color3(0.18, 0.16, 0.14),
      envPalette: VERDANT_ENV_PALETTE,
      rngSeed: 1337,
      ceiling: true,
      exitDoor: true,
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
      size: 46,
      wallHeight: 10,
      pillarCount: 6,
      paletteFloor: new Color3(0.18, 0.30, 0.20),
      paletteWall: new Color3(0.20, 0.16, 0.12),
      palettePillar: new Color3(0.50, 0.42, 0.34),
      paletteCeiling: new Color3(0.18, 0.16, 0.14),
      envPalette: VERDANT_ENV_PALETTE,
      rngSeed: 4242,
      ceiling: true,
      exitDoor: true,
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
      size: 54,
      wallHeight: 12,
      pillarCount: 0,
      paletteFloor: new Color3(0.12, 0.16, 0.12),
      paletteWall: new Color3(0.18, 0.10, 0.08),
      palettePillar: new Color3(0.38, 0.32, 0.26),
      paletteCeiling: new Color3(0.10, 0.06, 0.05),
      envPalette: PIT_ENV_PALETTE,
      rngSeed: 9999,
      ceiling: true,
      exitDoor: false,
    },
    spawns: [
      { kind: "boss_brawler", pos: new Vector3(0, 0, -18) },
    ],
  },
];

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
