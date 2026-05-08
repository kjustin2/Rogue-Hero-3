import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Enemy, EnemyDef } from "../Enemy";
import { Player } from "../../player/Player";
import { Telegraph } from "../../fx/Telegraph";
import { events } from "../../engine/EventBus";

export const BOMBER_DEF: EnemyDef = {
  name: "bomber",
  hp: 18,
  speed: 4.0,
  radius: 0.5,
  contactDamage: 0,
  color: new Color3(0.95, 0.55, 0.10),
  aggroRange: 28,
};

/**
 * Kamikaze. Sprints at the player and lights a 1.0s fuse when in range. Fuse
 * resolves in a 4m radial AoE for 24 damage; the bomber self-destructs whether
 * or not the player was hit.
 *
 * Risk/reward: killing the bomber **before** the fuse lights cancels the
 * explosion. Killing it **during** the fuse still triggers the blast — sniping
 * a fusing bomber from melee range punishes the player.
 */
export class Bomber extends Enemy {
  private fuseTimer = 0;
  private fusing = false;
  private cooldown = 0; // small grace before they engage so spawns don't insta-detonate
  private readonly telegraph: Telegraph;
  private static readonly FUSE_DURATION = 1.0;
  private static readonly FUSE_RANGE = 4.0;
  private static readonly FUSE_RANGE_TRIGGER = 4.5; // when to *light* the fuse
  private static readonly FUSE_DAMAGE = 24;

  constructor(
    scene: Scene,
    shadow: ShadowGenerator,
    spawnPos: Vector3,
    idSuffix: string,
    telegraph: Telegraph,
  ) {
    const body = MeshBuilder.CreateSphere(
      `bomber_${idSuffix}_body`,
      { diameter: BOMBER_DEF.radius * 2, segments: 12 },
      scene,
    );
    body.position = new Vector3(0, BOMBER_DEF.radius, 0);
    super(scene, shadow, BOMBER_DEF, spawnPos, body, idSuffix);
    this.telegraph = telegraph;
    this.swayAmpY = 0.06;
    this.swayFreqHz = 1.4;

    // Fuse cap on top — emissive yellow that intensifies during fuse.
    const fuse = MeshBuilder.CreateCylinder(
      `bomber_${idSuffix}_fuse`,
      { diameterTop: 0.10, diameterBottom: 0.18, height: 0.35, tessellation: 10 },
      scene,
    );
    fuse.position.set(0, BOMBER_DEF.radius * 2 + 0.18, 0);
    this.addPart(fuse, new Color3(1.0, 0.8, 0.2), {
      disableLighting: true,
      emissive: new Color3(1.0, 0.6, 0.1),
    });

    // Iron hoop band around the body — visual weight.
    const hoop = MeshBuilder.CreateTorus(
      `bomber_${idSuffix}_hoop`,
      { diameter: BOMBER_DEF.radius * 2.1, thickness: 0.08, tessellation: 18 },
      scene,
    );
    hoop.position.set(0, BOMBER_DEF.radius, 0);
    hoop.rotation.x = Math.PI / 2;
    this.addPart(hoop, new Color3(0.18, 0.16, 0.14));
  }

  protected override die(): void {
    // If killed mid-fuse, still detonate. Damage check uses the bomber's
    // current position; resolve before the dissolve animation starts.
    if (this.fusing) {
      // Player ref is not available here — emit a position-bearing event the
      // main.ts catch handler can use. Simpler: we know `Enemy.die` already
      // emits KILL with the enemy id; we need a separate "explosion" event
      // that carries position + radius + damage so anyone (player damage
      // listener via a thin wrapper, or future hostile-AoE code) can resolve.
      //
      // For minimum scope, do the damage check inline by emitting a
      // pre-resolved DAMAGE_TAKEN if the player is in range. We don't have
      // the player ref, but we DO emit ENEMY_HIT with position; reusing the
      // existing damage flow lets us wire this through main.ts later if the
      // need grows. For now, emit a HOSTILE_AOE event the main.ts handler
      // resolves against the live player ref.
      events.emit("HOSTILE_AOE", {
        x: this.root.position.x,
        z: this.root.position.z,
        radius: Bomber.FUSE_RANGE,
        damage: Bomber.FUSE_DAMAGE,
        source: this.id,
      });
    }
    super.die();
  }

  updateLogic(dt: number, player: Player): void {
    if (!this.alive) return;
    this.tickCommon(dt);

    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);

    const dx = player.root.position.x - this.root.position.x;
    const dz = player.root.position.z - this.root.position.z;
    const distSq = dx * dx + dz * dz;
    if (distSq > this.def.aggroRange * this.def.aggroRange) {
      this.state = "idle";
      return;
    }

    if (this.fusing) {
      this.fuseTimer -= dt;
      // Visual ramp — body emissive flares as the fuse burns down.
      const t = 1 - this.fuseTimer / Bomber.FUSE_DURATION;
      this.material.emissiveColor.set(0.20 + 0.85 * t, 0.10 + 0.15 * t, 0.05);
      // Continue moving toward player at half speed during fuse — the player
      // can still kite, but the bomber commits.
      const dist = Math.sqrt(distSq);
      if (dist > 1e-4) {
        const step = this.def.speed * 0.5 * this.speedScale() * dt;
        this.root.position.x += (dx / dist) * step;
        this.root.position.z += (dz / dist) * step;
      }
      if (this.fuseTimer <= 0) {
        this.detonate(player);
      }
      return;
    }

    // Chase to fuse range.
    const dist = Math.sqrt(distSq);
    if (dist > 1e-4) {
      const step = this.def.speed * this.speedScale() * dt;
      this.root.position.x += (dx / dist) * step;
      this.root.position.z += (dz / dist) * step;
      this.state = "chase";
    }

    // Light the fuse when close enough and the spawn-grace cooldown is clear.
    if (distSq <= Bomber.FUSE_RANGE_TRIGGER * Bomber.FUSE_RANGE_TRIGGER && this.cooldown === 0) {
      this.fusing = true;
      this.fuseTimer = Bomber.FUSE_DURATION;
      this.state = "telegraph";
      this.telegraph.spawnRing(
        this.root.position,
        Bomber.FUSE_RANGE,
        Bomber.FUSE_DURATION,
        [1.0, 0.45, 0.10],
      );
    }
  }

  private detonate(player: Player): void {
    // Damage check + visual ring already telegraphed — boom.
    const dx = player.root.position.x - this.root.position.x;
    const dz = player.root.position.z - this.root.position.z;
    const r = Bomber.FUSE_RANGE + player.stats.radius;
    if (dx * dx + dz * dz <= r * r) {
      if (!player.isDodging) {
        events.emit("DAMAGE_TAKEN", { amount: Bomber.FUSE_DAMAGE, source: this.id });
      } else if (player.tryConsumePerfectDodge()) {
        events.emit("PERFECT_DODGE", {});
      }
    }
    events.emit("HEAVY_HIT", { x: this.root.position.x, z: this.root.position.z });
    // Self-destruct — calling takeDamage triggers die() which emits KILL etc.
    this.fusing = false; // already detonated; don't re-fire HOSTILE_AOE in die()
    this.takeDamage(this.hp + 1);
  }
}
