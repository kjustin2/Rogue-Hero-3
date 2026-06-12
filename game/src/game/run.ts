import { ARENA_RADIUS, THEMES } from "../render/arena";
import { PitWarden } from "./boss";
import { SpireCaster } from "./bossSpire";
import { Colossus } from "./bossColossus";
import { makeEnemy, type Enemy, type EnemyKind } from "./enemies";
import type { Ctx } from "./ctx";

type FieldKind = Exclude<EnemyKind, "boss">;
/** [kind, count] — append "elite" to spawn a scaled-up anchor instead. */
type SpawnList = [FieldKind, number, "elite"?][];

export type BossKind = "warden" | "spire" | "colossus";

export interface RoomDef {
  name: string;
  theme: keyof typeof THEMES;
  act: number;
  actName: string;
  waves: SpawnList[];
  elite?: boolean;
  bossKind?: BossKind;
  reward: "card" | "relic";
}

interface BossEntry {
  name: string;
  title: string;
  make: (c: Ctx, x: number, z: number) => Enemy;
}

export const BOSSES: Record<BossKind, BossEntry> = {
  warden: { name: "THE PIT WARDEN", title: "Keeper of the Ember Rift", make: (c, x, z) => new PitWarden(c, x, z) },
  spire: { name: "THE SPIRE CASTER", title: "Warden of the Glass Crown", make: (c, x, z) => new SpireCaster(c, x, z) },
  colossus: { name: "THE COLOSSUS", title: "Engine of the Core", make: (c, x, z) => new Colossus(c, x, z) },
};

export const ROMAN = ["I", "II", "III"];

/** 3 acts × (combat → elite → boss). Combat clears draft cards, elites draft relics. */
export const ROOMS: RoomDef[] = [
  { name: "The Threshold", theme: "rift", act: 1, actName: "THE EMBER RIFT", waves: [], reward: "card" },
  { name: "Ember Crossing", theme: "dusk", act: 1, actName: "THE EMBER RIFT", waves: [], elite: true, reward: "relic" },
  { name: "The Pit", theme: "ember", act: 1, actName: "THE EMBER RIFT", waves: [], bossKind: "warden", reward: "card" },
  { name: "Glass Causeway", theme: "spire", act: 2, actName: "THE SHATTERED SPIRE", waves: [], reward: "card" },
  { name: "The Mirror Gallery", theme: "spire", act: 2, actName: "THE SHATTERED SPIRE", waves: [], elite: true, reward: "relic" },
  { name: "The Spire Crown", theme: "tempest", act: 2, actName: "THE SHATTERED SPIRE", waves: [], bossKind: "spire", reward: "card" },
  { name: "The Slag Fields", theme: "forge", act: 3, actName: "THE MOLTEN CORE", waves: [], reward: "card" },
  { name: "Furnace Approach", theme: "forge", act: 3, actName: "THE MOLTEN CORE", waves: [], elite: true, reward: "relic" },
  { name: "The Core", theme: "core", act: 3, actName: "THE MOLTEN CORE", waves: [], bossKind: "colossus", reward: "card" },
];
// Wave tables (kept out of the literals so the room list reads at a glance).
// Act I — the original roster, gentle ramp.
ROOMS[0].waves = [[["husk", 3]], [["husk", 2], ["spitter", 1]]];
ROOMS[1].waves = [
  [["swarmer", 4], ["bomber", 1]],
  [["sentinel", 1, "elite"], ["husk", 2], ["spitter", 1]],
];
// Act II — glass spire roster (wisp/tether/leaper/mirror land with enemies2).
ROOMS[3].waves = [
  [["wisp", 3], ["husk", 2]],
  [["tether", 2], ["swarmer", 3]],
];
ROOMS[4].waves = [
  [["leaper", 2], ["wisp", 2]],
  [["mirror", 1, "elite"], ["tether", 2], ["wisp", 2]],
];
// Act III — forge roster, everything bites.
ROOMS[6].waves = [
  [["leaper", 3], ["bomber", 2]],
  [["caster", 2], ["swarmer", 4]],
];
ROOMS[7].waves = [
  [["caster", 1, "elite"], ["mirror", 1], ["leaper", 2]],
  [["sentinel", 1], ["caster", 1], ["tether", 2], ["swarmer", 3]],
];

/** Elite anchors: a normal enemy scaled into a chunkier, slower threat. */
function makeElite(kind: FieldKind, ctx: Ctx, x: number, z: number): Enemy {
  const e = makeEnemy(kind, ctx, x, z);
  e.hp = e.maxHp = Math.round(e.maxHp * 2.5);
  e.radius *= 1.3;
  e.speed *= 0.92;
  e.root.scale.multiplyScalar(1.35);
  ctx.floaters.spawn(x, 2.6, z, "ELITE", "label");
  return e;
}

type RunState = "idle" | "fighting" | "cleared" | "victory";

/**
 * Room sequencing across the three acts. Mid-run bosses (rooms 2, 5) resolve
 * as room clears with a full heal; only the final boss wins the run.
 * main.ts listens for ROOM_CLEARED / ACT_START / RUN_VICTORY to drive drafts
 * and screens; this class only owns the arena's contents.
 */
export class RunManager {
  roomIndex = 0;
  state: RunState = "idle";
  private waveIndex = 0;

  constructor(private ctx: Ctx) {
    ctx.events.on("BOSS_DEFEATED", () => {
      if (this.state !== "fighting") return;
      this.ctx.stats.roomsCleared++;
      if (this.roomIndex >= ROOMS.length - 1) {
        this.state = "victory";
        this.ctx.events.emit("RUN_VICTORY", {});
        return;
      }
      // Mid-run boss: pop surviving adds (with death FX), full heal, clear flow
      this.state = "cleared";
      for (const e of this.ctx.enemies.living()) {
        if (e.kind !== "boss") e.takeDamage(99999);
      }
      this.ctx.hostiles.clear();
      const missing = Math.round(this.ctx.player.maxHp - this.ctx.player.hp);
      this.ctx.player.hp = this.ctx.player.maxHp;
      if (missing > 0) this.ctx.events.emit("HEAL", { amount: missing });
      this.ctx.events.emit("ROOM_CLEARED", { index: this.roomIndex, reward: this.currentRoom.reward });
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
    const prevAct = index === 0 ? 0 : ROOMS[index - 1].act;
    this.roomIndex = index;
    this.waveIndex = 0;
    this.state = "fighting";

    ctx.enemies.clear();
    ctx.projectiles.clear();
    ctx.hostiles.clear();
    ctx.caster.clear();

    const room = ROOMS[index];
    ctx.arena.applyTheme(THEMES[room.theme]);
    ctx.fx.ambientColor = THEMES[room.theme].ember;
    ctx.fx.ambientRate = room.bossKind ? 14 : 7;
    ctx.stats.actReached = Math.max(ctx.stats.actReached, room.act);

    // Player drops at the south edge facing in
    ctx.player.pos.set(0, 0, ARENA_RADIUS * 0.55);
    ctx.player.facing = Math.PI;
    ctx.cam.snapTo(ctx.player.pos.x, ctx.player.pos.z);
    ctx.fx.ring(ctx.player.pos.x, ctx.player.pos.z, { radius: 3, color: 0x66ddff, duration: 0.6 });

    ctx.events.emit("ROOM_START", { index, name: room.name, isBoss: !!room.bossKind });
    if (room.act !== prevAct) {
      ctx.events.emit("ACT_START", { act: room.act, name: room.actName });
    }
    ctx.relics.onRoomStart();

    if (room.bossKind) {
      const boss = BOSSES[room.bossKind];
      ctx.events.emit("BOSS_INTRO", { name: boss.name, title: boss.title });
      ctx.enemies.spawnCustom(boss.make, 0, -ARENA_RADIUS * 0.4, 2.4);
    } else {
      this.spawnWave(room.waves[0]);
    }
  }

  private spawnWave(wave: SpawnList): void {
    const { ctx } = this;
    const p = ctx.player.pos;
    for (const [kind, count, eliteFlag] of wave) {
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
        const delay = 0.8 + ctx.rng.range(0, 0.6);
        if (eliteFlag === "elite") {
          ctx.enemies.spawnCustom((c, xx, zz) => makeElite(kind, c, xx, zz), x, z, delay + 0.3);
        } else {
          ctx.enemies.spawn(kind, x, z, delay);
        }
      }
    }
  }

  update(): void {
    if (this.state !== "fighting") return;
    const room = this.currentRoom;
    if (this.ctx.enemies.remaining > 0) return;
    if (room.bossKind) return; // resolved via BOSS_DEFEATED

    this.waveIndex++;
    if (this.waveIndex < room.waves.length) {
      this.spawnWave(room.waves[this.waveIndex]);
    } else {
      this.state = "cleared";
      this.ctx.stats.roomsCleared++;
      // No cheap deaths from stray bullets after the last kill
      this.ctx.hostiles.clear();
      // Clearing a chamber restores a little vitality
      const heal = 12;
      this.ctx.player.hp = Math.min(this.ctx.player.maxHp, this.ctx.player.hp + heal);
      this.ctx.events.emit("HEAL", { amount: heal });
      this.ctx.events.emit("ROOM_CLEARED", { index: this.roomIndex, reward: room.reward });
    }
  }
}
