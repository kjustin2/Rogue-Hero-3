import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { EnemyManager } from "../enemies/EnemyManager";
import { Telegraph } from "../fx/Telegraph";
import { Player } from "../player/Player";
import { events } from "../engine/EventBus";
import { isAnomaly } from "../run/Anomalies";

/**
 * Hazard kinds — each branches the tick logic slightly.
 *   "fire" / "sword" — vanilla damage-on-tick zone. Applies dmgPerTick to any
 *     enemy inside the disc on each tick.
 *   "frost" — same as "fire" but also applies a brief freeze on each tick (so
 *     enemies that wander in are slowed; the player's Frost Field card uses
 *     this kind).
 *   "mine" — armed after a short delay, detonates on first enemy contact for a
 *     larger radius and instantly deactivates. No periodic ticking.
 *   "phantom" — fixed-fuse explosion. Damages once at the end of duration in a
 *     larger radius. The visible disc grows during the fuse so the player can
 *     read the impending blast.
 */
export type HazardKind = "fire" | "sword" | "frost" | "mine" | "phantom";

interface HazardSlot {
  mesh: Mesh;
  mat: StandardMaterial;
  active: boolean;
  kind: HazardKind;
  x: number;
  z: number;
  radius: number;
  /** Detonation radius for mines / phantoms (>= radius). */
  blastRadius: number;
  ttl: number;
  total: number;
  dmgPerTick: number;
  tickInterval: number;
  tickAcc: number;
  /** Mine arming countdown — once <= 0 the mine listens for enemies. */
  armTimer: number;
  /** Source card id (for relic hooks / FX colour cues). */
  sourceCard: string;
  /** Color [r, g, b]. */
  baseR: number;
  baseG: number;
  baseB: number;
  baseAlpha: number;
}

export interface HazardSpawnOpts {
  x: number;
  z: number;
  radius: number;
  duration: number;
  dmgPerTick: number;
  tickInterval: number;
  color: [number, number, number];
  kind: HazardKind;
  sourceCard: string;
  /** Mines / phantoms only — radius of the detonation. Defaults to 1.6× radius. */
  blastRadius?: number;
  /** Mines only — arming delay before contact will detonate. Default 0.25s. */
  armDelay?: number;
}

/**
 * Pooled lingering player AoE patches — fire pillars (Meteor Slam), frost
 * fields (Frost Nova), sword trails (Dash Strike), mines (Mine Field),
 * phantom decoys (Phase Step). Owns its own meshes + materials so card
 * casts don't allocate per-spawn.
 *
 * Ticking lives in `update(dt)` — call once per frame from the render loop.
 * Damage is applied directly via `Enemy.takeDamage`; CARD_PLAYED-style hook
 * routing isn't needed because hazard ticks are decoupled from cast events.
 *
 * Frost-kind zones additionally let the player query whether they're standing
 * inside one (`isPlayerInsideFrost(x, z)`) so PlayerController can apply the
 * +20% move-speed buff the card promises.
 */
export class HazardZones {
  private slots: HazardSlot[] = [];
  private static readonly POOL_SIZE = 60;
  /** Optional — wired by main.ts so the Frost Mirror anomaly can damage the player. */
  private player: Player | null = null;
  /** Per-tick damage to the player when standing inside a frost zone with Frost Mirror active. */
  private static readonly FROST_MIRROR_DMG = 3;

  constructor(
    private scene: Scene,
    private enemies: EnemyManager,
    private telegraph: Telegraph,
  ) {
    for (let i = 0; i < HazardZones.POOL_SIZE; i++) {
      this.slots.push(this.makeSlot(i));
    }
  }

  setPlayer(player: Player): void {
    this.player = player;
  }

  private makeSlot(i: number): HazardSlot {
    const mesh = MeshBuilder.CreateCylinder(
      `hz_${i}`,
      { diameter: 1, height: 0.05, tessellation: 28 },
      this.scene,
    );
    mesh.position.y = 0.05;
    mesh.isPickable = false;
    mesh.doNotSyncBoundingInfo = true;
    mesh.setEnabled(false);
    const mat = new StandardMaterial(`hz_mat_${i}`, this.scene);
    mat.disableLighting = true;
    mat.specularColor = new Color3(0, 0, 0);
    mat.backFaceCulling = false;
    mat.alpha = 0.5;
    mesh.material = mat;
    return {
      mesh,
      mat,
      active: false,
      kind: "fire",
      x: 0,
      z: 0,
      radius: 1,
      blastRadius: 1.6,
      ttl: 0,
      total: 0,
      dmgPerTick: 0,
      tickInterval: 0.5,
      tickAcc: 0,
      armTimer: 0,
      sourceCard: "",
      baseR: 1,
      baseG: 1,
      baseB: 1,
      baseAlpha: 0.5,
    };
  }

  /** Spawn a hazard. Returns false if all slots are busy. */
  spawn(opts: HazardSpawnOpts): boolean {
    const slot = this.acquire();
    if (!slot) return false;
    slot.active = true;
    slot.kind = opts.kind;
    slot.x = opts.x;
    slot.z = opts.z;
    slot.radius = opts.radius;
    slot.blastRadius = opts.blastRadius ?? opts.radius * 1.6;
    slot.ttl = opts.duration;
    slot.total = opts.duration;
    slot.dmgPerTick = opts.dmgPerTick;
    slot.tickInterval = opts.tickInterval;
    slot.tickAcc = 0;
    slot.armTimer = opts.kind === "mine" ? (opts.armDelay ?? 0.25) : 0;
    slot.sourceCard = opts.sourceCard;
    slot.baseR = opts.color[0];
    slot.baseG = opts.color[1];
    slot.baseB = opts.color[2];
    // Mines + phantoms read brighter so the player can spot the danger glyph.
    slot.baseAlpha = opts.kind === "mine" || opts.kind === "phantom" ? 0.75 : 0.45;
    slot.mat.diffuseColor.set(slot.baseR, slot.baseG, slot.baseB);
    slot.mat.emissiveColor.set(slot.baseR, slot.baseG, slot.baseB);
    slot.mat.alpha = slot.baseAlpha;
    slot.mesh.position.x = opts.x;
    slot.mesh.position.z = opts.z;
    const d = opts.radius * 2;
    slot.mesh.scaling.x = d;
    slot.mesh.scaling.z = d;
    slot.mesh.setEnabled(true);
    events.emit("HAZARD_SPAWNED", { x: opts.x, z: opts.z, kind: opts.kind, duration: opts.duration });
    return true;
  }

  private acquire(): HazardSlot | null {
    for (const s of this.slots) if (!s.active) return s;
    return null;
  }

  /** Drive lifetimes + damage. Call once per frame from main.ts. */
  update(dt: number): void {
    for (const s of this.slots) {
      if (!s.active) continue;
      s.ttl -= dt;
      if (s.armTimer > 0) s.armTimer = Math.max(0, s.armTimer - dt);
      if (s.ttl <= 0) {
        // Phantom expiry resolves the delayed blast before the slot retires.
        if (s.kind === "phantom") this.detonate(s);
        s.mesh.setEnabled(false);
        s.active = false;
        continue;
      }

      // Visual: pulse alpha around the base, fade to nothing in the last 25%.
      const t = 1 - s.ttl / s.total;
      const fade = s.ttl / s.total < 0.25 ? (s.ttl / s.total) / 0.25 : 1.0;
      const pulse = 0.85 + 0.15 * Math.sin(t * Math.PI * 6);
      s.mat.alpha = s.baseAlpha * fade * pulse;

      if (s.kind === "mine") {
        // Mines wait for arming, then watch for any enemy entering the radius.
        if (s.armTimer > 0) continue;
        let triggered = false;
        const r = s.radius;
        for (const e of this.enemies.enemies) {
          if (!e.alive) continue;
          const dx = e.root.position.x - s.x;
          const dz = e.root.position.z - s.z;
          const reach = r + e.def.radius;
          if (dx * dx + dz * dz <= reach * reach) {
            triggered = true;
            break;
          }
        }
        if (triggered) {
          this.detonate(s);
          s.mesh.setEnabled(false);
          s.active = false;
        }
        continue;
      }

      if (s.kind === "phantom") {
        // Phantoms don't tick — they wait, then explode at expiry. The TTL
        // branch above handles that. We just animate the mesh growing as the
        // fuse winds down.
        const grow = 1 + 0.4 * t;
        const d = s.radius * 2 * grow;
        s.mesh.scaling.x = d;
        s.mesh.scaling.z = d;
        continue;
      }

      // Damage-on-tick zones (fire / sword / frost).
      s.tickAcc += dt;
      if (s.tickAcc < s.tickInterval) continue;
      s.tickAcc -= s.tickInterval;
      this.applyTickDamage(s);
    }
  }

  /** Apply this frame's tick to every alive enemy inside the zone. */
  private applyTickDamage(s: HazardSlot): void {
    const r = s.radius;
    const r2 = r * r;
    for (const e of this.enemies.enemies) {
      if (!e.alive) continue;
      const dx = e.root.position.x - s.x;
      const dz = e.root.position.z - s.z;
      const reach = r + e.def.radius;
      if (dx * dx + dz * dz > reach * reach) continue;
      e.takeDamage(s.dmgPerTick);
      if (s.kind === "frost") {
        e.applyFreeze?.(0.6);
      }
    }
    // Frost Mirror anomaly — frost zones also tick damage to the player.
    // Reuses the zone's tickInterval (0.5s) for natural debouncing. Dodging
    // i-frames let the player roll across the zone without taking the tick.
    if (s.kind === "frost" && this.player && isAnomaly("frost_mirror")) {
      const px = this.player.root.position.x - s.x;
      const pz = this.player.root.position.z - s.z;
      const reach = r + this.player.stats.radius;
      if (px * px + pz * pz <= reach * reach && !this.player.isDodging) {
        events.emit("DAMAGE_TAKEN", { amount: HazardZones.FROST_MIRROR_DMG, source: "frost_mirror" });
      }
    }
    void r2;
  }

  /** Mine / phantom blast. Wider radius, single damage pulse. */
  private detonate(s: HazardSlot): void {
    const r = s.blastRadius;
    const r2 = r * r;
    for (const e of this.enemies.enemies) {
      if (!e.alive) continue;
      const dx = e.root.position.x - s.x;
      const dz = e.root.position.z - s.z;
      const reach = r + e.def.radius;
      if (dx * dx + dz * dz > reach * reach) continue;
      e.takeDamage(s.dmgPerTick);
      void r2;
    }
    // Visual feedback — orange ring on detonation. Cheap, reuses the shared
    // Telegraph pool. Mines flash brighter than phantoms.
    const isMine = s.kind === "mine";
    this.telegraph.spawnRing(
      s.mesh.position,
      s.blastRadius,
      0.25,
      [s.baseR * (isMine ? 1.0 : 0.85), s.baseG * (isMine ? 1.0 : 0.85), s.baseB * (isMine ? 1.0 : 0.85)],
    );
    if (s.kind === "phantom") {
      events.emit("PHANTOM_DETONATE", { x: s.x, z: s.z });
    }
  }

  /** PlayerController calls this to apply the Frost Field +20% move-speed buff. */
  isPlayerInsideFrost(px: number, pz: number): boolean {
    for (const s of this.slots) {
      if (!s.active || s.kind !== "frost") continue;
      const dx = px - s.x;
      const dz = pz - s.z;
      if (dx * dx + dz * dz <= s.radius * s.radius) return true;
    }
    return false;
  }

  /** Disable every slot — called on room load. */
  reset(): void {
    for (const s of this.slots) {
      if (!s.active) continue;
      s.active = false;
      s.mesh.setEnabled(false);
    }
  }

  dispose(): void {
    for (const s of this.slots) {
      s.mesh.dispose();
      s.mat.dispose();
    }
    this.slots.length = 0;
  }
}
