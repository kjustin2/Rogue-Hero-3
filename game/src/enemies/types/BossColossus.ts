import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { EnemyDef } from "../Enemy";
import { Player } from "../../player/Player";
import { BossBase } from "./BossBase";
import { Telegraph } from "../../fx/Telegraph";
import { events } from "../../engine/EventBus";

const COLOSSUS_DEF: EnemyDef = {
  name: "boss_colossus",
  hp: 420,
  speed: 2.0,
  radius: 1.7,
  contactDamage: 12,
  color: new Color3(0.45, 0.10, 0.06),
  aggroRange: 60,
};

/**
 * Act III boss — Magma Colossus.
 *
 *   P1 (100→75%): Ground Pound — large radial telegraph (7m, 24 dmg, 1.05s
 *     wind-up, ~5.5s cycle) plus the room's static lava pools.
 *
 *   P2 (75→50%) "THE MOUNTAIN ERUPTS": Roots itself at center. Geysers + boulder
 *     craters fall on cycles; Magma Mines spawn 4 lava orbs across the arena
 *     every 6s that detonate after 3s into 3m fire discs.
 *
 *   P3 (50→25%) "THE FORGE CONSUMES": Pound cadence halves; a 60° fire wave
 *     sweeps in place, leaving Lava Trail patches behind it that linger 5s
 *     and deny zone access. Boulder craters fall more often.
 *
 *   P4 (25→0%) "THE CALDERA CRACKS": Tectonic Slam replaces Pound — three
 *     concentric rings expanding outward (4m / 8m / 12m, staggered 0.4s).
 *     Magma Mines spawn 6 at a time. The forge gives no quarter.
 */
export class BossColossus extends BossBase {
  // Pound state
  private poundCooldown = 4.0;
  private poundWindUp = 0;
  private static readonly POUND_RADIUS = 7.0;
  private static readonly POUND_WIND_UP = 1.05;
  private static readonly POUND_DAMAGE = 24;

  // Geyser state (P2+)
  private geyserCooldown = 2.5;
  private static readonly GEYSER_RADIUS = 3.0;
  private static readonly GEYSER_WIND_UP = 0.95;
  private static readonly GEYSER_DAMAGE = 18;

  // Boulder crater state (P2+)
  private boulderCooldown = 3.0;
  private static readonly BOULDER_RADIUS = 4.0;
  private static readonly BOULDER_WIND_UP = 1.4;
  private static readonly BOULDER_DAMAGE = 14;
  /** Approximate arena half-extent for random boulder targeting. */
  private static readonly ARENA_HALF = 22;

  // Fire-wave state (P3)
  private waveAngle = 0;
  private waveDamageAcc = 0;
  private static readonly WAVE_HALF_ANGLE = Math.PI / 6; // matches Telegraph cone half-angle
  private static readonly WAVE_RANGE = 12;
  private static readonly WAVE_ANG_VEL = 0.55;
  private static readonly WAVE_DPS = 22;
  /** Cadence for Lava Trail patch drops along the fire-wave sweep (P3+). */
  private lavaTrailAcc = 0;
  private static readonly LAVA_TRAIL_INTERVAL = 0.5;
  private static readonly LAVA_TRAIL_RADIUS = 2.5;
  private static readonly LAVA_TRAIL_DURATION = 5.0;
  private static readonly LAVA_TRAIL_TICK_DAMAGE = 4;

  // Magma Mines state (P2+) — 4 lava orbs, 3s fuse, detonate into fire discs
  private mineCooldown = 4.0;
  private static readonly MINE_FUSE = 3.0;
  private static readonly MINE_RADIUS = 3.0;
  private static readonly MINE_DAMAGE = 16;

  // Tectonic Slam state (P4) — replaces Pound. Three concentric expanding rings.
  private static readonly TECTONIC_WIND_UP = 1.6;
  private static readonly TECTONIC_RING_RADII = [4.0, 8.0, 12.0];
  private static readonly TECTONIC_DAMAGE = 22;

  // Visuals
  private vein!: Mesh;
  private veinMat!: StandardMaterial;

  private rooted = false;

  constructor(scene: Scene, shadow: ShadowGenerator, spawnPos: Vector3, idSuffix: string, telegraph: Telegraph) {
    const body = MeshBuilder.CreateCylinder(
      `colossus_${idSuffix}_body`,
      { diameterTop: COLOSSUS_DEF.radius * 1.7, diameterBottom: COLOSSUS_DEF.radius * 2.4, height: 3.2, tessellation: 20 },
      scene,
    );
    body.position = new Vector3(0, 1.6, 0);
    super(scene, shadow, COLOSSUS_DEF, spawnPos, body, idSuffix, telegraph);
    this.bossDisplayName = "MAGMA COLOSSUS";
    this.phaseHpThresholds = [0.75, 0.50, 0.25];
    this.enrageLines = ["THE MOUNTAIN ERUPTS", "THE FORGE CONSUMES", "THE CALDERA CRACKS"];
    this.spawnComposition = [
      ["lancer", "chaser"],
      ["lancer", "lancer", "chaser"],
      ["lancer", "lancer"],
    ];
    this.introTimer = 3.8;
    this.introDuration = 3.8;
    this.swayAmpY = 0.04;
    this.swayFreqHz = 0.30;

    // Lava-vein chest plate.
    this.vein = MeshBuilder.CreateBox(
      `colossus_${idSuffix}_vein`,
      { width: 1.9, height: 0.22, depth: 0.14 },
      scene,
    );
    this.vein.position.set(0, 1.9, COLOSSUS_DEF.radius * 1.0);
    const veinRec = this.addPart(this.vein, new Color3(1.0, 0.45, 0.10), {
      disableLighting: true,
      emissive: new Color3(1.0, 0.45, 0.10),
    });
    this.veinMat = veinRec.mat;

    // Two stubby pauldron blocks for silhouette weight.
    for (const xOff of [-1.5, 1.5]) {
      const pauldron = MeshBuilder.CreateBox(
        `colossus_${idSuffix}_pld_${xOff}`,
        { width: 1.0, height: 0.7, depth: 1.2 },
        scene,
      );
      pauldron.position.set(xOff, 2.5, 0);
      this.addPart(pauldron, new Color3(0.30, 0.08, 0.05));
      shadow.addShadowCaster(pauldron);
    }
  }

  protected override onPhaseEnter(phase: number): void {
    if (phase === 2) {
      this.rooted = true;
      this.geyserCooldown = 1.0;
      this.boulderCooldown = 1.5;
      this.mineCooldown = 2.0;
    }
    if (phase === 3) {
      this.poundCooldown = 1.5;
      this.boulderCooldown = 1.0;
    }
    if (phase === 4) {
      // Tectonic Slam queues immediately on phase entry — gives the player a
      // moment to read the banner before the rings start expanding.
      this.poundCooldown = 1.0;
      this.mineCooldown = 1.5;
    }
  }

  protected override phaseAttackTick(dt: number, player: Player): void {
    this.tickPending(dt, player);

    // Vein emissive ramps with phase — reads as "the magma is rising."
    const intensity = this.currentPhase >= 3 ? 1.6 : this.currentPhase >= 2 ? 1.2 : 1.0;
    this.veinMat.emissiveColor.set(1.0 * intensity, 0.45 * intensity, 0.10 * intensity);

    // ----- Pound (active in all phases, faster in P3) -----
    if (this.poundWindUp > 0) {
      this.poundWindUp = Math.max(0, this.poundWindUp - dt);
      if (this.poundWindUp === 0) this.detonatePound(player);
      return;
    }

    // P2+ extras run alongside the pound cadence; pound itself stays the spine.
    if (this.currentPhase >= 2) this.tickGeyser(dt, player);
    if (this.currentPhase >= 2) this.tickBoulder(dt);
    if (this.currentPhase >= 2) this.tickMines(dt);
    if (this.currentPhase >= 3) this.tickFireWave(dt, player);

    this.poundCooldown -= dt;

    // Movement: only in P1. P2+ is rooted at the spawn position so the boss
    // becomes an arena-control turret rather than a pursuer.
    if (!this.rooted) {
      const dx = player.root.position.x - this.root.position.x;
      const dz = player.root.position.z - this.root.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > this.def.radius + player.stats.radius && dist > 1e-4) {
        const speed = this.def.speed * this.speedScale();
        this.root.position.x += (dx / dist) * speed * dt;
        this.root.position.z += (dz / dist) * speed * dt;
        this.state = "chase";
      } else {
        this.tryContactDamage(player, this.def.contactDamage, 0.9);
      }
    }

    if (this.poundCooldown <= 0) {
      // P4 swaps the standard radial pound for the Tectonic Slam — three
      // concentric expanding rings with safe gaps between. Pound stays the
      // attack-cycle spine; only the visual + damage shape changes.
      if (this.currentPhase >= 4) this.beginTectonic();
      else this.beginPound();
    }
  }

  private beginPound(): void {
    this.telegraph.spawnRing(
      this.root.position,
      BossColossus.POUND_RADIUS,
      BossColossus.POUND_WIND_UP,
      [1.0, 0.35, 0.05],
    );
    this.poundWindUp = BossColossus.POUND_WIND_UP;
    this.state = "telegraph";
    this.hyperarmorActive = true;
    // Cycle scales with phase — P3 hits much more often.
    this.poundCooldown = this.currentPhase >= 3 ? 3.5 : 5.5;
  }

  /**
   * P4 Tectonic Slam — replaces beginPound. Three concentric expanding rings
   * staggered by 0.4s. The safe gap is between rings, so the player has to
   * time movement to one of two thin shells. Reuses poundWindUp + state so
   * the rest of the FSM doesn't need to special-case P4.
   */
  private beginTectonic(): void {
    const origin = this.root.position.clone();
    const radii = BossColossus.TECTONIC_RING_RADII;
    for (let i = 0; i < radii.length; i++) {
      const r = radii[i];
      const delay = i * 0.4;
      // Telegraph each ring at its delay, then resolve damage at the same beat.
      this.queueStrike(delay, () => {
        if (!this.alive) return;
        this.telegraph.spawnRing(origin, r, 0.65, [1.0, 0.35, 0.05]);
        this.queueStrike(0.65, (p) => {
          if (!this.alive) return;
          const dx = p.root.position.x - origin.x;
          const dz = p.root.position.z - origin.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          // Hit if player is within ±1.4m of this ring's radius. The gaps
          // between successive radii (4→8 = 4m, 8→12 = 4m) leave ~1.2m of
          // safe shell on each side after accounting for player radius.
          if (Math.abs(dist - r) <= 1.4 + p.stats.radius) {
            if (!p.isDodging) {
              events.emit("DAMAGE_TAKEN", { amount: BossColossus.TECTONIC_DAMAGE, source: this.id });
            } else if (p.tryConsumePerfectDodge()) {
              events.emit("PERFECT_DODGE", {});
            }
          }
        });
      });
    }
    // Mirror the pound state shape so the existing recover transitions still apply.
    this.poundWindUp = BossColossus.TECTONIC_WIND_UP;
    this.state = "telegraph";
    this.hyperarmorActive = true;
    this.poundCooldown = 3.5;
  }

  private detonatePound(player: Player): void {
    const dx = player.root.position.x - this.root.position.x;
    const dz = player.root.position.z - this.root.position.z;
    const r = BossColossus.POUND_RADIUS;
    if (dx * dx + dz * dz <= r * r) {
      if (!player.isDodging) {
        events.emit("DAMAGE_TAKEN", { amount: BossColossus.POUND_DAMAGE, source: this.id });
      } else if (player.tryConsumePerfectDodge()) {
        events.emit("PERFECT_DODGE", {});
      }
    }
    events.emit("HEAVY_HIT", { x: this.root.position.x, z: this.root.position.z });
    this.state = "recover";
    this.hyperarmorActive = false;
  }

  /**
   * Magma Mines (P2+) — spawn 4 lava orbs at random arena spots; each detonates
   * after a 3s fuse into a 3m fire disc. Telegraphed by a small disc that
   * grows to MINE_RADIUS over the fuse so the player knows how big the
   * eventual blast will be. P4 spawns 6 at a time for denser zone control.
   */
  private tickMines(dt: number): void {
    this.mineCooldown -= dt;
    if (this.mineCooldown > 0) return;
    const count = this.currentPhase >= 4 ? 6 : 4;
    const r = BossColossus.ARENA_HALF * 0.78;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 3 + Math.random() * (r - 3);
      const cx = Math.cos(angle) * radius;
      const cz = Math.sin(angle) * radius;
      const center = new Vector3(cx, 0, cz);
      this.telegraph.spawnDisc(center, BossColossus.MINE_RADIUS, BossColossus.MINE_FUSE, [1.0, 0.55, 0.10]);
      this.queueStrike(BossColossus.MINE_FUSE, (p) => {
        if (!this.alive) return;
        events.emit("HOSTILE_AOE", {
          x: cx,
          z: cz,
          radius: BossColossus.MINE_RADIUS,
          damage: BossColossus.MINE_DAMAGE,
          source: this.id,
        });
        void p;
      });
    }
    this.mineCooldown = this.currentPhase >= 4 ? 5.0 : 6.0;
  }

  private tickGeyser(dt: number, player: Player): void {
    this.geyserCooldown -= dt;
    if (this.geyserCooldown > 0) return;
    // Geyser snaps to the player's CURRENT position — the player's task is to
    // keep moving so the strike point lags behind them.
    const center = player.root.position.clone();
    this.telegraph.spawnDisc(
      center,
      BossColossus.GEYSER_RADIUS,
      BossColossus.GEYSER_WIND_UP,
      [1.0, 0.55, 0.10],
    );
    this.queueStrike(BossColossus.GEYSER_WIND_UP, (p2) => {
      const dx = p2.root.position.x - center.x;
      const dz = p2.root.position.z - center.z;
      const r = BossColossus.GEYSER_RADIUS + p2.stats.radius;
      if (dx * dx + dz * dz <= r * r) {
        if (!p2.isDodging) {
          events.emit("DAMAGE_TAKEN", { amount: BossColossus.GEYSER_DAMAGE, source: this.id });
        } else if (p2.tryConsumePerfectDodge()) {
          events.emit("PERFECT_DODGE", {});
        }
      }
    });
    this.geyserCooldown = this.currentPhase >= 3 ? 1.8 : 2.5;
  }

  private tickBoulder(dt: number): void {
    this.boulderCooldown -= dt;
    if (this.boulderCooldown > 0) return;
    // Boulder craters fall at random arena locations away from the boss —
    // forces the player to maintain situational awareness, not just dodge
    // the geyser. Simple uniform sample within the arena half-extent.
    const r = BossColossus.ARENA_HALF * 0.75;
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * r;
    const cx = Math.cos(angle) * radius;
    const cz = Math.sin(angle) * radius;
    const center = new Vector3(cx, 0, cz);
    this.telegraph.spawnDisc(center, BossColossus.BOULDER_RADIUS, BossColossus.BOULDER_WIND_UP, [0.95, 0.30, 0.08]);
    this.queueStrike(BossColossus.BOULDER_WIND_UP, (p2) => {
      const dx = p2.root.position.x - center.x;
      const dz = p2.root.position.z - center.z;
      const rad = BossColossus.BOULDER_RADIUS + p2.stats.radius;
      if (dx * dx + dz * dz <= rad * rad) {
        if (!p2.isDodging) {
          events.emit("DAMAGE_TAKEN", { amount: BossColossus.BOULDER_DAMAGE, source: this.id });
        } else if (p2.tryConsumePerfectDodge()) {
          events.emit("PERFECT_DODGE", {});
        }
      }
    });
    this.boulderCooldown = this.currentPhase >= 3 ? 2.5 : 4.0;
  }

  private tickFireWave(dt: number, player: Player): void {
    // Continuous rotating cone telegraph. A new cone telegraph is spawned each
    // tick at the boss with the current sweep angle, short-lived (0.3s) so the
    // visual reads as a moving wedge. Damage applies whenever the player is
    // inside the current arc.
    this.waveAngle += BossColossus.WAVE_ANG_VEL * dt;
    this.waveDamageAcc += dt;
    this.lavaTrailAcc += dt;
    // Lava Trail — drop a persistent fire disc along the wave's leading edge
    // every LAVA_TRAIL_INTERVAL seconds. The patches outlast the cone sweep,
    // turning the wave into a floor-painting attack rather than a one-shot.
    if (this.lavaTrailAcc >= BossColossus.LAVA_TRAIL_INTERVAL) {
      this.lavaTrailAcc -= BossColossus.LAVA_TRAIL_INTERVAL;
      const dirXTrail = Math.cos(this.waveAngle);
      const dirZTrail = Math.sin(this.waveAngle);
      // Drop the patch at the wave's leading edge — ~70% of WAVE_RANGE along
      // the current direction. That's where the player tends to dodge to.
      const leadDist = BossColossus.WAVE_RANGE * 0.7;
      const cx = this.root.position.x + dirXTrail * leadDist;
      const cz = this.root.position.z + dirZTrail * leadDist;
      this.telegraph.spawnDisc(
        new Vector3(cx, 0, cz),
        BossColossus.LAVA_TRAIL_RADIUS,
        BossColossus.LAVA_TRAIL_DURATION,
        [1.0, 0.30, 0.05],
      );
      // Tick damage every 0.6s for the patch's lifetime — gives the player
      // multiple chances to recognise the threat without instakill chaining.
      const ticks = Math.floor(BossColossus.LAVA_TRAIL_DURATION / 0.6);
      for (let k = 1; k <= ticks; k++) {
        this.queueStrike(k * 0.6, (p) => {
          if (!this.alive) return;
          const dx = p.root.position.x - cx;
          const dz = p.root.position.z - cz;
          const r = BossColossus.LAVA_TRAIL_RADIUS + p.stats.radius;
          if (dx * dx + dz * dz <= r * r) {
            if (!p.isDodging) {
              events.emit("DAMAGE_TAKEN", {
                amount: BossColossus.LAVA_TRAIL_TICK_DAMAGE,
                source: this.id,
              });
            }
          }
        });
      }
    }
    if (this.waveDamageAcc < 0.18) return; // gate visual + damage on the same beat
    this.waveDamageAcc -= 0.18;

    const dirX = Math.cos(this.waveAngle);
    const dirZ = Math.sin(this.waveAngle);
    this.telegraph.spawnCone(this.root.position, dirX, dirZ, BossColossus.WAVE_RANGE, 0.3, [1.0, 0.42, 0.10]);

    // Damage check: is the player within the cone's wedge AND within range?
    const px = player.root.position.x - this.root.position.x;
    const pz = player.root.position.z - this.root.position.z;
    const distSq = px * px + pz * pz;
    if (distSq > BossColossus.WAVE_RANGE * BossColossus.WAVE_RANGE) return;
    const along = px * dirX + pz * dirZ;
    if (along <= 0) return; // behind the cone
    let aabs = Math.abs(Math.atan2(pz, px) - Math.atan2(dirZ, dirX));
    if (aabs > Math.PI) aabs = Math.PI * 2 - aabs;
    if (aabs > BossColossus.WAVE_HALF_ANGLE) return;
    if (!player.isDodging) {
      const tickDmg = Math.round(BossColossus.WAVE_DPS * 0.18);
      events.emit("DAMAGE_TAKEN", { amount: tickDmg, source: this.id });
    }
  }
}
