import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Player } from "../player/Player";
import { Telegraph } from "../fx/Telegraph";
import { events } from "../engine/EventBus";

export type Biome = "verdant" | "spire" | "magma";

interface PendingHazard {
  ttl: number;
  resolve: (player: Player) => void;
}

/**
 * Per-biome ambient hazards layered onto regular fight rooms. Each act has
 * its own flavor:
 *
 *   verdant  → falling debris (disc telegraph, 1.5s wind-up, 2.5m, 14 dmg)
 *   spire    → ambient lightning (line telegraph, 1.0s wind-up, 14 dmg)
 *   magma    → magma geysers (disc telegraph, 2.0s wind-up, 3m, 18 dmg)
 *
 * The manager is global to the run and re-keyed at each room load via
 * `setBiome(...)`. Boss rooms call `setActive(false)` so the boss owns the
 * pressure budget without ambient noise on top.
 *
 * Locations are sampled in a ring around the player (kept ≥6m away so the
 * hazard never insta-damages without a reaction window) and clamped to the
 * arena half-extent.
 */
export class BiomeHazardManager {
  private biome: Biome = "verdant";
  private active = false;
  private cooldown = 4.0;
  private arenaHalf = 18;
  private pending: PendingHazard[] = [];

  constructor(private telegraph: Telegraph) {}

  setBiome(b: Biome): void {
    this.biome = b;
    this.cooldown = b === "magma" ? 4.5 : b === "spire" ? 5.5 : 6.0;
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!active) {
      // Don't carry pending hazards across the boundary — they'd resolve in
      // the wrong arena (or the picker phase).
      this.pending.length = 0;
    }
  }

  setArenaHalf(half: number): void {
    this.arenaHalf = Math.max(6, half);
  }

  update(dt: number, player: Player): void {
    // Pending strikes always tick — even if newly-deactivated, in flight
    // hazards finish their short windows naturally. setActive(false) clears
    // them eagerly, so this loop is safe either way.
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const h = this.pending[i];
      h.ttl -= dt;
      if (h.ttl <= 0) {
        h.resolve(player);
        this.pending.splice(i, 1);
      }
    }
    if (!this.active) return;
    this.cooldown -= dt;
    if (this.cooldown > 0) return;
    this.spawnHazard(player);
    // Set the next cadence with some jitter so two consecutive hazards don't
    // feel metronomic. Base cadence is biome-specific.
    const base = this.biome === "magma" ? 4.5 : this.biome === "spire" ? 5.5 : 6.0;
    this.cooldown = base + (Math.random() * 1.5 - 0.5);
  }

  private samplePosition(player: Player): { x: number; z: number } {
    // Sample a random point at least 6m from the player and inside the arena.
    // Try up to 6 times; if all attempts land too close, fall back to the
    // last sample (better than no hazard).
    const half = this.arenaHalf - 3;
    let x = 0;
    let z = 0;
    for (let i = 0; i < 6; i++) {
      x = (Math.random() * 2 - 1) * half;
      z = (Math.random() * 2 - 1) * half;
      const dx = x - player.root.position.x;
      const dz = z - player.root.position.z;
      if (dx * dx + dz * dz >= 36) return { x, z };
    }
    return { x, z };
  }

  private spawnHazard(player: Player): void {
    const { x, z } = this.samplePosition(player);
    const center = new Vector3(x, 0, z);
    if (this.biome === "verdant") {
      this.telegraph.spawnDisc(center, 2.5, 1.5, [0.85, 0.65, 0.35]);
      this.pending.push({
        ttl: 1.5,
        resolve: (p) => this.resolveDisc(p, x, z, 2.5, 14),
      });
    } else if (this.biome === "spire") {
      // Random horizontal line direction — the line is centered at the strike
      // point and extends both ways for 6m total.
      const a = Math.random() * Math.PI * 2;
      const dirX = Math.cos(a);
      const dirZ = Math.sin(a);
      // Anchor the line so the strike point sits in the middle of the bar.
      const origin = new Vector3(x - dirX * 3, 0, z - dirZ * 3);
      this.telegraph.spawnLine(origin, dirX, dirZ, 6, 1.4, 1.0, [0.5, 0.8, 1.0]);
      this.pending.push({
        ttl: 1.0,
        resolve: (p) => this.resolveLine(p, x, z, dirX, dirZ, 6, 0.7, 14),
      });
    } else {
      // magma geyser
      this.telegraph.spawnDisc(center, 3.0, 2.0, [1.0, 0.55, 0.10]);
      this.pending.push({
        ttl: 2.0,
        resolve: (p) => this.resolveDisc(p, x, z, 3.0, 18),
      });
    }
  }

  private resolveDisc(player: Player, x: number, z: number, radius: number, damage: number): void {
    const dx = player.root.position.x - x;
    const dz = player.root.position.z - z;
    const r = radius + player.stats.radius;
    if (dx * dx + dz * dz <= r * r) {
      if (!player.isDodging) {
        events.emit("DAMAGE_TAKEN", { amount: damage, source: "biome_hazard" });
      } else if (player.tryConsumePerfectDodge()) {
        events.emit("PERFECT_DODGE", {});
      }
    }
  }

  private resolveLine(
    player: Player,
    cx: number,
    cz: number,
    dirX: number,
    dirZ: number,
    length: number,
    halfWidth: number,
    damage: number,
  ): void {
    // Bar center is (cx, cz). Test the player's position against the segment
    // — half the length on either side along (dirX, dirZ).
    const px = player.root.position.x - cx;
    const pz = player.root.position.z - cz;
    const along = px * dirX + pz * dirZ;
    if (Math.abs(along) > length * 0.5) return;
    const perp = Math.abs(px * -dirZ + pz * dirX);
    if (perp > halfWidth + player.stats.radius) return;
    if (!player.isDodging) {
      events.emit("DAMAGE_TAKEN", { amount: damage, source: "biome_hazard" });
    } else if (player.tryConsumePerfectDodge()) {
      events.emit("PERFECT_DODGE", {});
    }
  }
}
