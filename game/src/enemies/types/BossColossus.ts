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
  hp: 280,
  speed: 2.0,
  radius: 1.7,
  contactDamage: 12,
  color: new Color3(0.45, 0.10, 0.06),
  aggroRange: 60,
};

interface PendingStrike {
  ttl: number;
  resolve: (player: Player) => void;
}

/**
 * Act III boss — Magma Colossus.
 *
 *   P1 (HP 100% → 66%): Ground Pound — large radial telegraph (7m, 24 dmg,
 *     1.5s wind-up, ~5.5s cycle) plus the room's static lava pools.
 *
 *   P2 (HP 66% → 33%) "THE MOUNTAIN ERUPTS": Roots itself at center.
 *     Geysers (3m disc, 18 dmg) spawn at the player's position on a 2.5s
 *     cycle; boulder craters (4m disc, 14 dmg, slower) hit random arena
 *     locations on a 4s cycle. Spawns 1 lancer + 1 chaser.
 *
 *   P3 (HP 33% → 0%) "THE FORGE CONSUMES": Rotates in place. Pound cadence
 *     halves; a 90° fire-wave cone sweeps continuously at ~0.5 rad/sec,
 *     dealing damage if the player stays in the arc. Boulder craters fall
 *     more often.
 */
export class BossColossus extends BossBase {
  // Pound state
  private poundCooldown = 4.0;
  private poundWindUp = 0;
  private static readonly POUND_RADIUS = 7.0;
  private static readonly POUND_WIND_UP = 1.5;
  private static readonly POUND_DAMAGE = 24;

  // Geyser state (P2+)
  private geyserCooldown = 2.5;
  private static readonly GEYSER_RADIUS = 3.0;
  private static readonly GEYSER_WIND_UP = 1.4;
  private static readonly GEYSER_DAMAGE = 18;

  // Boulder crater state (P2+)
  private boulderCooldown = 3.0;
  private static readonly BOULDER_RADIUS = 4.0;
  private static readonly BOULDER_WIND_UP = 2.0;
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

  // Visuals
  private vein!: Mesh;
  private veinMat!: StandardMaterial;

  private pending: PendingStrike[] = [];
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
    this.phaseHpThresholds = [0.66, 0.33];
    this.enrageLines = ["THE MOUNTAIN ERUPTS", "THE FORGE CONSUMES"];
    this.spawnComposition = [["lancer", "chaser"], ["lancer", "lancer", "chaser"]];
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
    }
    if (phase === 3) {
      this.poundCooldown = 1.5;
      this.boulderCooldown = 1.0;
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
      this.beginPound();
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
    // Cycle scales with phase — P3 hits much more often.
    this.poundCooldown = this.currentPhase >= 3 ? 3.5 : 5.5;
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

  private queueStrike(delaySec: number, resolve: (player: Player) => void): void {
    this.pending.push({ ttl: delaySec, resolve });
  }

  private tickPending(dt: number, player: Player): void {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const s = this.pending[i];
      s.ttl -= dt;
      if (s.ttl <= 0) {
        s.resolve(player);
        this.pending.splice(i, 1);
      }
    }
  }
}
