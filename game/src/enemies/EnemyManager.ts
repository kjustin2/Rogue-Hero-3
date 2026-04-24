import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Enemy } from "./Enemy";
import { Chaser } from "./types/Chaser";
import { Shooter } from "./types/Shooter";
import { Caster } from "./types/Caster";
import { Elite } from "./types/Elite";
import { BossBrawler } from "./types/BossBrawler";
import { Player } from "../player/Player";
import { HostileProjectileSystem } from "../combat/handlers/hostileProjectile";
import { events } from "../engine/EventBus";

export type EnemyKind = "chaser" | "shooter" | "caster" | "elite" | "boss_brawler";

export interface SpawnRequest {
  kind: EnemyKind;
  pos: Vector3;
}

export class EnemyManager {
  enemies: Enemy[] = [];
  pillars: Mesh[] = [];
  private nextId = 1;
  private roomClearedEmitted = false;

  constructor(
    private scene: Scene,
    private shadow: ShadowGenerator,
    private hostileProjectiles: HostileProjectileSystem,
  ) {}

  setPillars(pillars: Mesh[]): void {
    this.pillars = pillars;
  }

  spawn(kind: EnemyKind, pos: Vector3): Enemy {
    const id = String(this.nextId++);
    let e: Enemy;
    switch (kind) {
      case "chaser":
        e = new Chaser(this.scene, this.shadow, pos, id);
        break;
      case "shooter":
        e = new Shooter(this.scene, this.shadow, pos, id, this.hostileProjectiles);
        break;
      case "caster":
        e = new Caster(this.scene, this.shadow, pos, id);
        break;
      case "elite":
        e = new Elite(this.scene, this.shadow, pos, id);
        break;
      case "boss_brawler":
        e = new BossBrawler(this.scene, this.shadow, pos, id);
        break;
      default: {
        const exhaustive: never = kind;
        throw new Error(`unknown enemy kind: ${exhaustive as string}`);
      }
    }
    this.enemies.push(e);
    this.roomClearedEmitted = false;
    return e;
  }

  spawnAll(reqs: SpawnRequest[]): void {
    for (const r of reqs) this.spawn(r.kind, r.pos);
  }

  update(dt: number, player: Player): void {
    for (const e of this.enemies) {
      if (e.alive) {
        e.updateLogic(dt, player);
        // Knockback integrates AFTER the subclass chase/attack logic so the hit
        // actually shows; otherwise enemies would re-snap to the player instantly.
        e.applyKnockback(dt);
        e.clampToPillars(this.pillars);
      } else if (e.dissolving) {
        // Dissolving enemies still consume knockback (so they don't freeze mid-hit)
        // but skip their AI logic entirely.
        e.applyKnockback(dt);
      }
    }
    // Cull dead — only after the dissolve completes.
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (!e.alive) {
        const done = e.tickDissolve(dt);
        if (done) {
          e.dispose();
          this.enemies.splice(i, 1);
        }
      }
    }
    // Emit room-cleared once per wave
    if (!this.roomClearedEmitted && this.enemies.length === 0) {
      this.roomClearedEmitted = true;
      events.emit("ROOM_CLEARED");
    }
  }

  aliveCount(): number {
    return this.enemies.reduce((n, e) => n + (e.alive ? 1 : 0), 0);
  }

  clear(): void {
    for (const e of this.enemies) e.dispose();
    this.enemies.length = 0;
    this.roomClearedEmitted = false;
  }
}
