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
import { BossSpireCaster } from "./types/BossSpireCaster";
import { BossColossus } from "./types/BossColossus";
import { Leaper } from "./types/Leaper";
import { Swarmer } from "./types/Swarmer";
import { Lancer } from "./types/Lancer";
import { Wisp } from "./types/Wisp";
import { Player } from "../player/Player";
import { HostileProjectileSystem } from "../combat/handlers/hostileProjectile";
import { events } from "../engine/EventBus";

export type EnemyKind =
  | "chaser" | "shooter" | "caster" | "elite"
  | "leaper" | "swarmer" | "lancer" | "wisp"
  | "boss_brawler" | "boss_spire_caster" | "boss_colossus";

export interface SpawnRequest {
  kind: EnemyKind;
  pos: Vector3;
}

export class EnemyManager {
  enemies: Enemy[] = [];
  pillars: Mesh[] = [];
  private nextId = 1;
  private roomClearedEmitted = false;
  /**
   * Optional hooks fired around enemy lifecycle. main.ts wires these to
   * register/unregister meshes with the HighlightLayer and to spawn the
   * end-of-dissolve ash puff. Kept as plain callbacks (rather than EventBus
   * events) so the order is deterministic — onSpawn runs before any frame
   * tick, onDispose runs immediately before the body's mesh is destroyed.
   */
  onSpawn?: (e: Enemy) => void;
  onDispose?: (e: Enemy) => void;

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
      case "leaper":
        e = new Leaper(this.scene, this.shadow, pos, id);
        break;
      case "swarmer":
        e = new Swarmer(this.scene, this.shadow, pos, id);
        break;
      case "lancer":
        e = new Lancer(this.scene, this.shadow, pos, id);
        break;
      case "wisp":
        e = new Wisp(this.scene, this.shadow, pos, id, this.hostileProjectiles);
        break;
      case "boss_brawler":
        e = new BossBrawler(this.scene, this.shadow, pos, id);
        break;
      case "boss_spire_caster":
        e = new BossSpireCaster(this.scene, this.shadow, pos, id);
        break;
      case "boss_colossus":
        e = new BossColossus(this.scene, this.shadow, pos, id);
        break;
      default: {
        const exhaustive: never = kind;
        throw new Error(`unknown enemy kind: ${exhaustive as string}`);
      }
    }
    this.enemies.push(e);
    this.roomClearedEmitted = false;
    this.onSpawn?.(e);
    // Boss spawn announces itself — main.ts listens to drive camera orbit +
    // banner during the intro phase. Display name is plucked off the boss so
    // each subclass can override (e.g. "WARDEN OF SPIRES").
    if (e.def.name.startsWith("boss_")) {
      const intro = (e as unknown as { introDuration?: number; bossDisplayName?: string });
      events.emit("BOSS_INTRO_START", {
        bossId: e.id,
        duration: intro.introDuration ?? 3.0,
        name: intro.bossDisplayName ?? e.def.name.replace("boss_", "").toUpperCase(),
        pos: pos.clone(),
      });
    }
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
          this.onDispose?.(e);
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
    for (const e of this.enemies) {
      this.onDispose?.(e);
      e.dispose();
    }
    this.enemies.length = 0;
    this.roomClearedEmitted = false;
  }
}
