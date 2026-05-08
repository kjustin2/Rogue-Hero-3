import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Enemy, EnemyDef } from "../Enemy";
import { Player } from "../../player/Player";
import { HostileProjectileSystem } from "../../combat/handlers/hostileProjectile";

export const TETHER_DEF: EnemyDef = {
  name: "tether",
  hp: 36,
  speed: 2.0,
  radius: 0.6,
  contactDamage: 6,
  color: new Color3(0.55, 0.20, 0.70),
  aggroRange: 26,
};

/**
 * Stationary-leaning ranged threat. Kites to ~12m and fires 3-shot fan
 * patterns of slow purple orbs (5 m/s, 8 dmg each) every 3.2s. Each burst
 * spans ~30° so the player must dodge perpendicular to the boss-to-self
 * vector — standing still in the firing line eats all three.
 */
export class Tether extends Enemy {
  private fireTimer = 1.6;
  private fireDirBuf = new Vector3();
  private static readonly BURST_SPREAD = Math.PI / 6; // 30° fan
  private static readonly KITE_DIST = 12;

  constructor(
    scene: Scene,
    shadow: ShadowGenerator,
    spawnPos: Vector3,
    idSuffix: string,
    private projectiles: HostileProjectileSystem,
  ) {
    const body = MeshBuilder.CreateCylinder(
      `tether_${idSuffix}_body`,
      { diameterTop: 0.4, diameterBottom: 1.0, height: 1.7, tessellation: 14 },
      scene,
    );
    body.position = new Vector3(0, 0.85, 0);
    super(scene, shadow, TETHER_DEF, spawnPos, body, idSuffix);
    this.swayAmpY = 0.05;
    this.swayFreqHz = 0.6;

    // Crystal floating above the head — clear "ranged caster" silhouette,
    // pulses with each burst.
    const crystal = MeshBuilder.CreateCylinder(
      `tether_${idSuffix}_crystal`,
      { diameterTop: 0, diameterBottom: 0.5, height: 0.7, tessellation: 4 },
      scene,
    );
    crystal.position.set(0, 2.1, 0);
    this.addPart(crystal, new Color3(0.85, 0.55, 1.0), {
      disableLighting: true,
      emissive: new Color3(0.65, 0.35, 0.95),
    });
    shadow.addShadowCaster(crystal);

    // Dark hem to match the caster-style silhouette.
    const hem = MeshBuilder.CreateTorus(
      `tether_${idSuffix}_hem`,
      { diameter: 1.1, thickness: 0.10, tessellation: 16 },
      scene,
    );
    hem.position.set(0, 0.06, 0);
    this.addPart(hem, new Color3(0.30, 0.10, 0.40));
  }

  updateLogic(dt: number, player: Player): void {
    if (!this.alive) return;
    this.tickCommon(dt);

    const dx = player.root.position.x - this.root.position.x;
    const dz = player.root.position.z - this.root.position.z;
    const distSq = dx * dx + dz * dz;
    if (distSq > this.def.aggroRange * this.def.aggroRange) {
      this.state = "idle";
      return;
    }

    // Kite: keep ~12m range. Closer → back away; further → close in slowly.
    const dist = Math.sqrt(distSq);
    if (dist > 1e-4) {
      const dir = dist < Tether.KITE_DIST - 1.5 ? -1 : dist > Tether.KITE_DIST + 1.5 ? 1 : 0;
      if (dir !== 0) {
        const step = this.def.speed * dir * this.speedScale() * dt;
        this.root.position.x += (dx / dist) * step;
        this.root.position.z += (dz / dist) * step;
      }
      this.state = dir === 0 ? "idle" : "chase";
    }

    this.fireTimer -= dt;
    if (this.fireTimer > 0) return;
    this.fireTimer = 3.2;

    // 3-shot fan around the boss-to-player heading.
    if (dist > 1e-4) {
      const baseDx = dx / dist;
      const baseDz = dz / dist;
      for (const a of [-Tether.BURST_SPREAD, 0, Tether.BURST_SPREAD]) {
        const cs = Math.cos(a);
        const sn = Math.sin(a);
        const fx = baseDx * cs - baseDz * sn;
        const fz = baseDx * sn + baseDz * cs;
        this.fireDirBuf.set(fx, 0, fz);
        this.projectiles.fire(this.root.position, this.fireDirBuf, 5, 8, 4.0);
      }
    }
  }
}
