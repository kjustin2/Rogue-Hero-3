import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { EnemyDef } from "../Enemy";
import { Player } from "../../player/Player";
import { BossBase } from "./BossBase";
import { Telegraph } from "../../fx/Telegraph";
import { events } from "../../engine/EventBus";

const SPIRE_DEF: EnemyDef = {
  name: "boss_spire_caster",
  hp: 320,
  speed: 2.6,
  radius: 1.0,
  contactDamage: 8,
  color: new Color3(0.30, 0.55, 0.95),
  aggroRange: 60,
};

/**
 * Act II boss — Warden of Spires.
 *
 *   P1 (100→75%): Sky Lance — kites at ~10m, telegraphed line attack
 *     (0.85s wind-up, 14m line, 16 dmg).
 *
 *   P2 (75→50%) "THE WARDEN UNVEILS HIS SPIRES": Roots, channels for 4s while
 *     line arcs telegraph in random directions. Damage taken is reduced 80%.
 *     Channel ends with a triple Sky Lance fan PLUS Ward Shatter — 4 expanding
 *     rings outward from the boss to force the player to move during the fan.
 *
 *   P3 (50→25%) "WITNESS THE STORM": Faster Sky Lance cadence + chain
 *     lightning every 3s. Mirror Spire — summons 2 stationary echo spires
 *     that re-fire each Sky Lance from a different angle.
 *
 *   P4 (25→0%) "ALL SPIRES, BURN": Convergence — 5 lance lines all converge
 *     on the player's predicted position 0.7s ahead. Only safe escape is
 *     dodging perpendicular to your motion.
 */
export class BossSpireCaster extends BossBase {
  private orbL!: Mesh;
  private orbR!: Mesh;
  private orbAngle = 0;

  // Sky-Lance state
  private lanceCooldown = 2.0;
  private lanceWindUp = 0;
  private lanceDir = new Vector3(0, 0, 1);
  private static readonly LANCE_RANGE = 14;
  private static readonly LANCE_WIDTH = 1.6;
  private static readonly LANCE_WIND_UP = 0.85;
  private static readonly LANCE_DAMAGE = 16;

  // P2 channel state
  private channeling = 0;
  private channelArcCooldown = 0;
  private static readonly CHANNEL_DURATION = 4.0;

  // P3 chain-lightning state
  private chainCooldown = 3.0;
  private chainWindUp = 0;
  private chainCenter = new Vector3();
  private static readonly CHAIN_RADIUS = 2.8;
  private static readonly CHAIN_DAMAGE = 14;
  private static readonly CHAIN_WIND_UP = 0.55;

  // P3+ Mirror Spire — 2 fixed arena positions that re-fire the boss's Sky
  // Lance after a short echo delay. Re-anchored on phase entry; the visual
  // is just a particle/disc telegraph at the spire spot when it fires.
  private mirrorSpires: Vector3[] = [];

  // P4 Convergence — 5-lance attack with predictive aim. Cooldown resets
  // each cast; only spins up once the boss reaches phase 4.
  private convergeCooldown = 4.0;
  private static readonly CONVERGE_WIND_UP = 1.4;
  private static readonly CONVERGE_DAMAGE = 18;

  constructor(scene: Scene, shadow: ShadowGenerator, spawnPos: Vector3, idSuffix: string, telegraph: Telegraph) {
    const body = MeshBuilder.CreateCylinder(
      `spire_${idSuffix}_body`,
      { diameterTop: 0.7, diameterBottom: 1.4, height: 2.8, tessellation: 18 },
      scene,
    );
    body.position = new Vector3(0, 1.4, 0);
    super(scene, shadow, SPIRE_DEF, spawnPos, body, idSuffix, telegraph);
    this.bossDisplayName = "WARDEN OF SPIRES";
    this.phaseHpThresholds = [0.75, 0.50, 0.25];
    this.enrageLines = ["THE WARDEN UNVEILS HIS SPIRES", "WITNESS THE STORM", "ALL SPIRES, BURN"];
    this.spawnComposition = [["wisp", "wisp"], ["caster", "wisp"], ["caster", "caster"]];
    this.introTimer = 3.4;
    this.introDuration = 3.4;
    this.swayAmpY = 0.05;
    this.swayFreqHz = 0.5;

    const hem = MeshBuilder.CreateTorus(
      `spire_${idSuffix}_hem`,
      { diameter: 1.7, thickness: 0.18, tessellation: 22 },
      scene,
    );
    hem.position.set(0, 0.1, 0);
    this.addPart(hem, new Color3(0.18, 0.32, 0.6));

    const hood = MeshBuilder.CreateCylinder(
      `spire_${idSuffix}_hood`,
      { diameterTop: 0, diameterBottom: 0.85, height: 0.7, tessellation: 14 },
      scene,
    );
    hood.position.set(0, 3.05, 0);
    this.addPart(hood, new Color3(0.20, 0.40, 0.7));

    const orbColor = new Color3(0.65, 0.85, 1.0);
    const orbEmissive = new Color3(0.55, 0.80, 1.0);
    this.orbL = MeshBuilder.CreateSphere(`spire_${idSuffix}_orbL`, { diameter: 0.55, segments: 12 }, scene);
    this.orbL.position.set(-1.4, 2.3, 0);
    this.addPart(this.orbL, orbColor, { disableLighting: true, emissive: orbEmissive });
    shadow.addShadowCaster(this.orbL);

    this.orbR = MeshBuilder.CreateSphere(`spire_${idSuffix}_orbR`, { diameter: 0.55, segments: 12 }, scene);
    this.orbR.position.set(1.4, 2.3, 0);
    this.addPart(this.orbR, orbColor, { disableLighting: true, emissive: orbEmissive });
    shadow.addShadowCaster(this.orbR);
  }

  override takeDamage(amount: number): void {
    // Channel phase soaks 80% of incoming damage — the "shielded" feel
    // without the player-frustration of literal invulnerability.
    if (this.channeling > 0) amount *= 0.2;
    super.takeDamage(amount);
  }

  protected override onPhaseEnter(phase: number): void {
    if (phase === 2) this.beginChannel();
    if (phase === 3) {
      this.lanceCooldown = 0.6;
      this.chainCooldown = 1.5;
      this.anchorMirrorSpires();
    }
    if (phase === 4) {
      // Convergence opens in 1.5s — gives the player a beat to read the new
      // banner before the 5-lance attack telegraphs.
      this.convergeCooldown = 1.5;
      this.lanceCooldown = Math.min(this.lanceCooldown, 1.0);
      this.chainCooldown = Math.min(this.chainCooldown, 1.0);
    }
  }

  private beginChannel(): void {
    this.channeling = BossSpireCaster.CHANNEL_DURATION;
    this.channelArcCooldown = 0;
    this.lanceWindUp = 0;
  }

  protected override phaseAttackTick(dt: number, player: Player): void {
    // Drain pending deferred strikes regardless of phase — they survive phase
    // transitions but stop firing once the boss is dead (handled by the alive
    // check inside the resolver wrappers).
    this.tickPending(dt, player);

    // Orb orbit + emissive ramp during channel.
    this.orbAngle += dt * (this.channeling > 0 ? 4.5 : 1.5);
    const r = 1.4;
    this.orbL.position.x = Math.cos(this.orbAngle) * r;
    this.orbL.position.z = Math.sin(this.orbAngle) * r;
    this.orbR.position.x = -Math.cos(this.orbAngle) * r;
    this.orbR.position.z = -Math.sin(this.orbAngle) * r;

    if (this.channeling > 0) {
      this.tickChannel(dt);
      return;
    }

    if (this.lanceWindUp > 0) {
      this.lanceWindUp = Math.max(0, this.lanceWindUp - dt);
      if (this.lanceWindUp === 0) this.detonateLance(player);
      return;
    }
    if (this.chainWindUp > 0) {
      this.chainWindUp = Math.max(0, this.chainWindUp - dt);
      if (this.chainWindUp === 0) this.detonateChain(player);
      return;
    }

    this.lanceCooldown -= dt;
    if (this.currentPhase >= 3) this.chainCooldown -= dt;
    if (this.currentPhase >= 4) this.convergeCooldown -= dt;

    // P4 Convergence interrupts the regular cadence when ready — pre-empts the
    // chain/lance cooldowns so the player reads it as the dominant threat.
    if (this.currentPhase >= 4 && this.convergeCooldown <= 0) {
      this.beginConverge(player);
      return;
    }

    // Movement: kite to ~10m. Closer than that → back off; further → close in.
    const dx = player.root.position.x - this.root.position.x;
    const dz = player.root.position.z - this.root.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const idealDist = this.currentPhase >= 3 ? 8 : 10;
    if (dist > 1e-4) {
      const dir = dist > idealDist + 1.5 ? 1 : dist < idealDist - 1.5 ? -1 : 0;
      if (dir !== 0) {
        const speed = this.def.speed * dir * this.speedScale();
        this.root.position.x += (dx / dist) * speed * dt;
        this.root.position.z += (dz / dist) * speed * dt;
      }
      this.state = "chase";
    }

    if (this.currentPhase >= 3 && this.chainCooldown <= 0) {
      this.beginChain(player);
      return;
    }
    if (this.lanceCooldown <= 0 && dist > 1e-4) {
      this.lanceDir.x = dx / dist;
      this.lanceDir.z = dz / dist;
      this.spawnLanceTelegraph(this.lanceDir.x, this.lanceDir.z);
      this.lanceWindUp = BossSpireCaster.LANCE_WIND_UP;
      this.lanceCooldown = this.currentPhase >= 3 ? 2.4 : 3.4;
      this.state = "telegraph";
    }
  }

  private spawnLanceTelegraph(dirX: number, dirZ: number): void {
    this.telegraph.spawnLine(
      this.root.position,
      dirX,
      dirZ,
      BossSpireCaster.LANCE_RANGE,
      BossSpireCaster.LANCE_WIDTH,
      BossSpireCaster.LANCE_WIND_UP,
      [0.45, 0.7, 1.0],
    );
  }

  private detonateLance(player: Player): void {
    const px = player.root.position.x - this.root.position.x;
    const pz = player.root.position.z - this.root.position.z;
    const along = px * this.lanceDir.x + pz * this.lanceDir.z;
    const perp = Math.abs(px * -this.lanceDir.z + pz * this.lanceDir.x);
    if (along >= 0 && along <= BossSpireCaster.LANCE_RANGE && perp <= BossSpireCaster.LANCE_WIDTH * 0.5 + player.stats.radius) {
      if (!player.isDodging) {
        events.emit("DAMAGE_TAKEN", { amount: BossSpireCaster.LANCE_DAMAGE, source: this.id });
      } else if (player.tryConsumePerfectDodge()) {
        events.emit("PERFECT_DODGE", {});
      }
    }
    events.emit("HEAVY_HIT", { x: this.root.position.x, z: this.root.position.z });
    // Mirror Spire echoes — every Sky Lance the boss fires re-fires from each
    // anchored spire 0.4s later. Active P3+; the spires were anchored in
    // onPhaseEnter so they're a known fixed threat, not random.
    if (this.currentPhase >= 3) this.fireMirrorEchoes(player);
    this.state = "recover";
  }

  private tickChannel(dt: number): void {
    this.state = "telegraph";
    this.channeling = Math.max(0, this.channeling - dt);
    this.channelArcCooldown -= dt;
    if (this.channelArcCooldown <= 0) {
      const a = Math.random() * Math.PI * 2;
      const dirX = Math.cos(a);
      const dirZ = Math.sin(a);
      this.telegraph.spawnLine(this.root.position, dirX, dirZ, 12, 1.2, 0.7, [0.55, 0.8, 1.0]);
      // Resolve the arc strike 0.7s later — same window as the telegraph.
      const originX = this.root.position.x;
      const originZ = this.root.position.z;
      this.queueStrike(0.7, (player) => {
        if (!this.alive) return;
        const dx = player.root.position.x - originX;
        const dz = player.root.position.z - originZ;
        const along = dx * dirX + dz * dirZ;
        const perp = Math.abs(dx * -dirZ + dz * dirX);
        if (along >= 0 && along <= 12 && perp <= 0.6 + player.stats.radius) {
          if (!player.isDodging) {
            events.emit("DAMAGE_TAKEN", { amount: 10, source: this.id });
          } else if (player.tryConsumePerfectDodge()) {
            events.emit("PERFECT_DODGE", {});
          }
        }
      });
      this.channelArcCooldown = 0.85;
    }
    if (this.channeling === 0) this.endChannel();
  }

  private endChannel(): void {
    // Ward Shatter — 4 expanding ring telegraphs from the boss outward,
    // staggered so the player can't simply walk away from the lance fan;
    // they have to also weave through the rings. Each ring is short-lived
    // (1.0s wind-up, ~5m → 14m radii) so the choke is a moment, not a wall.
    const originVec = this.root.position.clone();
    const ringRadii = [4.5, 8.0, 11.5, 14.5];
    for (let i = 0; i < ringRadii.length; i++) {
      const r = ringRadii[i];
      const delay = i * 0.18;
      this.queueStrike(delay, () => {
        if (!this.alive) return;
        this.telegraph.spawnRing(originVec, r, 0.85, [0.55, 0.85, 1.0]);
        // Damage application — fire HOSTILE_AOE on a small "shell" of the ring
        // so a player standing on the ring takes a hit.
        this.queueStrike(0.85, (p) => {
          if (!this.alive) return;
          const dx = p.root.position.x - originVec.x;
          const dz = p.root.position.z - originVec.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          // Hit if player is within ±1m of the ring radius (the shell width).
          if (Math.abs(dist - r) <= 1.0 + p.stats.radius) {
            if (!p.isDodging) {
              events.emit("DAMAGE_TAKEN", { amount: 12, source: this.id });
            } else if (p.tryConsumePerfectDodge()) {
              events.emit("PERFECT_DODGE", {});
            }
          }
        });
      });
    }

    // Triple Sky Lance fan — directions baked off the player's position at
    // channel-end (immediate strike with ttl=0 lets the resolver capture the
    // live player ref), then the actual lance strikes resolve after the
    // standard LANCE_WIND_UP.
    const originX = this.root.position.x;
    const originZ = this.root.position.z;
    this.queueStrike(0.0, (player) => {
      const px = player.root.position.x - originX;
      const pz = player.root.position.z - originZ;
      const dist = Math.max(1e-4, Math.sqrt(px * px + pz * pz));
      const cdx = px / dist;
      const cdz = pz / dist;
      const offsets = [-Math.PI / 6, 0, Math.PI / 6];
      const dirs: Array<[number, number]> = offsets.map((a) => {
        const cs = Math.cos(a);
        const sn = Math.sin(a);
        return [cdx * cs - cdz * sn, cdx * sn + cdz * cs];
      });
      // Spawn three telegraphs.
      for (const [ndx, ndz] of dirs) {
        this.telegraph.spawnLine(
          new Vector3(originX, 0, originZ),
          ndx,
          ndz,
          BossSpireCaster.LANCE_RANGE,
          BossSpireCaster.LANCE_WIDTH,
          BossSpireCaster.LANCE_WIND_UP,
          [0.45, 0.7, 1.0],
        );
      }
      // Resolve all three after the standard lance wind-up.
      this.queueStrike(BossSpireCaster.LANCE_WIND_UP, (p2) => {
        if (!this.alive) return;
        for (const [ndx, ndz] of dirs) {
          const lpx = p2.root.position.x - originX;
          const lpz = p2.root.position.z - originZ;
          const along = lpx * ndx + lpz * ndz;
          const perp = Math.abs(lpx * -ndz + lpz * ndx);
          if (
            along >= 0 &&
            along <= BossSpireCaster.LANCE_RANGE &&
            perp <= BossSpireCaster.LANCE_WIDTH * 0.5 + p2.stats.radius
          ) {
            if (!p2.isDodging) {
              events.emit("DAMAGE_TAKEN", { amount: BossSpireCaster.LANCE_DAMAGE, source: this.id });
              break;
            } else if (p2.tryConsumePerfectDodge()) {
              events.emit("PERFECT_DODGE", {});
              break;
            }
          }
        }
        events.emit("HEAVY_HIT", { x: originX, z: originZ });
      });
    });
    this.lanceCooldown = 2.5;
    this.state = "recover";
  }

  private beginChain(player: Player): void {
    this.chainCenter.copyFrom(player.root.position);
    this.telegraph.spawnDisc(
      this.chainCenter,
      BossSpireCaster.CHAIN_RADIUS,
      BossSpireCaster.CHAIN_WIND_UP,
      [0.45, 0.85, 1.0],
    );
    this.chainWindUp = BossSpireCaster.CHAIN_WIND_UP;
    this.chainCooldown = 3.5;
  }

  private detonateChain(player: Player): void {
    const dx = player.root.position.x - this.chainCenter.x;
    const dz = player.root.position.z - this.chainCenter.z;
    const r = BossSpireCaster.CHAIN_RADIUS + player.stats.radius;
    if (dx * dx + dz * dz <= r * r) {
      if (!player.isDodging) {
        events.emit("DAMAGE_TAKEN", { amount: BossSpireCaster.CHAIN_DAMAGE, source: this.id });
      } else if (player.tryConsumePerfectDodge()) {
        events.emit("PERFECT_DODGE", {});
      }
    }
  }

  /**
   * Anchor 2 echo spires at fixed offsets from the boss. Used by P3+ Mirror
   * Spire — every Sky Lance the boss fires is re-fired from each spire on a
   * 0.4s delay. Anchored once at phase entry so the player can learn the spots.
   */
  private anchorMirrorSpires(): void {
    const cx = this.root.position.x;
    const cz = this.root.position.z;
    this.mirrorSpires = [
      new Vector3(cx + 8, 0, cz + 5),
      new Vector3(cx - 8, 0, cz + 5),
    ];
  }

  /**
   * Re-fire the most-recent Sky Lance from each Mirror Spire on a short delay.
   * Each echo paints its own line telegraph at the spire and resolves into a
   * lance strike — same width/range/damage as the primary, just from a
   * different origin. Direction is recomputed at fire time so the lance still
   * tracks the player's last position when the echo lands.
   */
  private fireMirrorEchoes(player: Player): void {
    if (this.mirrorSpires.length === 0) return;
    for (const origin of this.mirrorSpires) {
      const o = origin.clone();
      this.queueStrike(0.4, (p) => {
        if (!this.alive) return;
        const dx = p.root.position.x - o.x;
        const dz = p.root.position.z - o.z;
        const dist = Math.max(1e-4, Math.sqrt(dx * dx + dz * dz));
        const ndx = dx / dist;
        const ndz = dz / dist;
        this.telegraph.spawnLine(
          o,
          ndx,
          ndz,
          BossSpireCaster.LANCE_RANGE,
          BossSpireCaster.LANCE_WIDTH,
          0.45,
          [0.55, 0.85, 1.0],
        );
        this.queueStrike(0.45, (p2) => {
          if (!this.alive) return;
          const px = p2.root.position.x - o.x;
          const pz = p2.root.position.z - o.z;
          const along = px * ndx + pz * ndz;
          const perp = Math.abs(px * -ndz + pz * ndx);
          if (
            along >= 0 &&
            along <= BossSpireCaster.LANCE_RANGE &&
            perp <= BossSpireCaster.LANCE_WIDTH * 0.5 + p2.stats.radius
          ) {
            if (!p2.isDodging) {
              events.emit("DAMAGE_TAKEN", { amount: BossSpireCaster.LANCE_DAMAGE, source: this.id });
            } else if (p2.tryConsumePerfectDodge()) {
              events.emit("PERFECT_DODGE", {});
            }
          }
        });
      });
    }
    void player;
  }

  /**
   * Begin Convergence (P4) — five lances all aimed at the player's predicted
   * position 0.7s ahead. Wind-up shows all five line telegraphs simultaneously
   * so the player can read the converging X. Only escape is to dodge
   * perpendicular to the prediction.
   */
  private beginConverge(player: Player): void {
    const lookAhead = 0.7;
    // Predict where the player will be in 0.7s based on current velocity.
    // Player has no exposed velocity API so we approximate via lockedX/Z;
    // fall back to current position if not moving meaningfully.
    const targetX = player.root.position.x + (player.facing.x ?? 0) * lookAhead * 4;
    const targetZ = player.root.position.z + (player.facing.z ?? 0) * lookAhead * 4;
    const target = new Vector3(targetX, 0, targetZ);
    const offsets = [-Math.PI / 4, -Math.PI / 8, 0, Math.PI / 8, Math.PI / 4];
    const dirs: Array<[number, number, Vector3]> = [];
    for (const off of offsets) {
      // Spawn each lance from a ring around the boss at 60° offsets so the
      // five lines genuinely converge on the predicted point.
      const baseAngle = Math.atan2(targetZ - this.root.position.z, targetX - this.root.position.x);
      const a = baseAngle + off;
      const ox = this.root.position.x + Math.cos(a) * 6 - Math.cos(baseAngle) * 6;
      const oz = this.root.position.z + Math.sin(a) * 6 - Math.sin(baseAngle) * 6;
      const origin = new Vector3(ox, 0, oz);
      const dx = targetX - ox;
      const dz = targetZ - oz;
      const dist = Math.max(1e-4, Math.sqrt(dx * dx + dz * dz));
      const ndx = dx / dist;
      const ndz = dz / dist;
      this.telegraph.spawnLine(
        origin,
        ndx,
        ndz,
        BossSpireCaster.LANCE_RANGE,
        BossSpireCaster.LANCE_WIDTH,
        BossSpireCaster.CONVERGE_WIND_UP,
        [0.7, 0.95, 1.0],
      );
      dirs.push([ndx, ndz, origin]);
    }
    void target;
    this.queueStrike(BossSpireCaster.CONVERGE_WIND_UP, (p) => {
      if (!this.alive) return;
      // Resolve all five lances at once. Hit if the player is along any line.
      for (const [ndx, ndz, origin] of dirs) {
        const px = p.root.position.x - origin.x;
        const pz = p.root.position.z - origin.z;
        const along = px * ndx + pz * ndz;
        const perp = Math.abs(px * -ndz + pz * ndx);
        if (
          along >= 0 &&
          along <= BossSpireCaster.LANCE_RANGE &&
          perp <= BossSpireCaster.LANCE_WIDTH * 0.5 + p.stats.radius
        ) {
          if (!p.isDodging) {
            events.emit("DAMAGE_TAKEN", { amount: BossSpireCaster.CONVERGE_DAMAGE, source: this.id });
            break;
          } else if (p.tryConsumePerfectDodge()) {
            events.emit("PERFECT_DODGE", {});
            break;
          }
        }
      }
      events.emit("HEAVY_HIT", { x: this.root.position.x, z: this.root.position.z });
    });
    this.convergeCooldown = 6.0;
    this.state = "telegraph";
  }
}
