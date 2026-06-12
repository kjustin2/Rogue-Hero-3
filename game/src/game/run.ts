import { ARENA_RADIUS, THEMES } from "../render/arena";
import { PitWarden } from "./boss";
import type { EnemyKind } from "./enemies";
import type { Ctx } from "./ctx";

type SpawnList = [Exclude<EnemyKind, "boss">, number][];

interface RoomDef {
  name: string;
  theme: keyof typeof THEMES;
  waves: SpawnList[];
  boss?: boolean;
}

export const ROOMS: RoomDef[] = [
  { name: "The Threshold", theme: "rift", waves: [] },
  { name: "Ember Crossing", theme: "rift", waves: [] },
  { name: "The Broodground", theme: "dusk", waves: [] },
  { name: "Sentinel Approach", theme: "dusk", waves: [] },
  { name: "The Pit", theme: "ember", waves: [], boss: true },
];
// Wave tables (kept out of the literals so the room list reads at a glance)
ROOMS[0].waves = [[["husk", 3]]];
ROOMS[1].waves = [
  [["husk", 2], ["spitter", 1]],
  [["spitter", 1], ["swarmer", 3]],
];
ROOMS[2].waves = [
  [["swarmer", 4], ["bomber", 1]],
  [["husk", 2], ["bomber", 1], ["swarmer", 2]],
];
ROOMS[3].waves = [
  [["sentinel", 1], ["spitter", 2]],
  [["sentinel", 1], ["husk", 2], ["swarmer", 2]],
];

type RunState = "idle" | "fighting" | "cleared" | "victory";

/**
 * Room sequencing: spawn waves, detect clears, hand the boss room to the
 * PitWarden. main.ts listens for ROOM_CLEARED / BOSS_DEFEATED to drive
 * drafts and screens; this class only owns the arena's contents.
 */
export class RunManager {
  roomIndex = 0;
  state: RunState = "idle";
  private waveIndex = 0;
  private bossSpawned = false;

  constructor(private ctx: Ctx) {
    ctx.events.on("BOSS_DEFEATED", () => {
      if (this.state === "fighting") {
        this.state = "victory";
        this.ctx.stats.roomsCleared++;
        this.ctx.events.emit("RUN_VICTORY", {});
      }
    });
  }

  get currentRoom(): RoomDef {
    return ROOMS[this.roomIndex];
  }

  get totalRooms(): number {
    return ROOMS.length;
  }

  startRun(): void {
    this.roomIndex = 0;
    this.loadRoom(0);
  }

  nextRoom(): void {
    if (this.roomIndex < ROOMS.length - 1) {
      this.loadRoom(this.roomIndex + 1);
    }
  }

  loadRoom(index: number): void {
    const { ctx } = this;
    this.roomIndex = index;
    this.waveIndex = 0;
    this.bossSpawned = false;
    this.state = "fighting";

    ctx.enemies.clear();
    ctx.projectiles.clear();
    ctx.hostiles.clear();
    ctx.caster.clear();

    const room = ROOMS[index];
    ctx.arena.applyTheme(THEMES[room.theme]);
    ctx.fx.ambientColor = THEMES[room.theme].ember;
    ctx.fx.ambientRate = room.boss ? 14 : 7;

    // Player drops at the south edge facing in
    ctx.player.pos.set(0, 0, ARENA_RADIUS * 0.55);
    ctx.player.facing = Math.PI;
    ctx.cam.snapTo(ctx.player.pos.x, ctx.player.pos.z);
    ctx.fx.ring(ctx.player.pos.x, ctx.player.pos.z, { radius: 3, color: 0x66ddff, duration: 0.6 });

    ctx.events.emit("ROOM_START", { index, name: room.name, isBoss: !!room.boss });

    if (room.boss) {
      ctx.events.emit("BOSS_INTRO", { name: "THE PIT WARDEN", title: "Keeper of the Ember Rift" });
      ctx.enemies.spawnCustom((c, x, z) => new PitWarden(c, x, z), 0, -ARENA_RADIUS * 0.4, 2.4);
      this.bossSpawned = true;
    } else {
      this.spawnWave(room.waves[0]);
    }
  }

  private spawnWave(wave: SpawnList): void {
    const { ctx } = this;
    const p = ctx.player.pos;
    for (const [kind, count] of wave) {
      for (let i = 0; i < count; i++) {
        // Ring placement, kept away from the player
        let x = 0;
        let z = 0;
        for (let attempt = 0; attempt < 12; attempt++) {
          const a = ctx.rng.range(0, Math.PI * 2);
          const r = ctx.rng.range(5, ARENA_RADIUS - 3);
          x = Math.sin(a) * r;
          z = Math.cos(a) * r;
          if (Math.hypot(x - p.x, z - p.z) > 7) break;
        }
        ctx.enemies.spawn(kind, x, z, 0.8 + ctx.rng.range(0, 0.6));
      }
    }
  }

  update(): void {
    if (this.state !== "fighting") return;
    const room = this.currentRoom;
    if (this.ctx.enemies.remaining > 0) return;

    if (room.boss) {
      // Victory handled via BOSS_DEFEATED; adds dying shouldn't clear the room
      if (!this.bossSpawned) return;
      return;
    }

    this.waveIndex++;
    if (this.waveIndex < room.waves.length) {
      this.spawnWave(room.waves[this.waveIndex]);
    } else {
      this.state = "cleared";
      this.ctx.stats.roomsCleared++;
      // No cheap deaths from stray bullets after the last kill
      this.ctx.hostiles.clear();
      // Clearing a room restores a little vitality
      const heal = 12;
      this.ctx.player.hp = Math.min(this.ctx.player.maxHp, this.ctx.player.hp + heal);
      this.ctx.events.emit("HEAL", { amount: heal });
      this.ctx.events.emit("ROOM_CLEARED", { index: this.roomIndex });
    }
  }
}
