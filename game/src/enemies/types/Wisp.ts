import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Enemy, EnemyDef } from "../Enemy";
import { Player } from "../../player/Player";
import { HostileProjectileSystem } from "../../combat/handlers/hostileProjectile";

export const WISP_DEF: EnemyDef = {
  name: "wisp",
  hp: 18,
  speed: 3.2,
  radius: 0.4,
  contactDamage: 0,
  color: new Color3(0.55, 0.85, 1.0),
  aggroRange: 26,
};

/** Y-altitude wisps hover at — out of melee reach for grounded melee strikes. */
const WISP_HOVER_Y = 2.0;

/**
 * Always-airborne nuisance. Hovers at Y=2 so a grounded melee swing can't
 * reach it — players need a projectile, an aerial slam, or a jump+melee.
 * Spits slow blue orbs at long intervals so it pressures movement without
 * outright punishing the player who chooses to ignore it.
 */
export class Wisp extends Enemy {
  private fireTimer = 1.6;
  private fireDirBuf = new Vector3();

  constructor(
    scene: Scene,
    shadow: ShadowGenerator,
    spawnPos: Vector3,
    idSuffix: string,
    private projectiles: HostileProjectileSystem,
  ) {
    const body = MeshBuilder.CreateSphere(
      `wisp_${idSuffix}_body`,
      { diameter: WISP_DEF.radius * 2, segments: 12 },
      scene,
    );
    // Spawn at hover Y so the parent's swayBaseY captures it correctly.
    body.position = new Vector3(0, 0, 0);
    super(scene, shadow, WISP_DEF, new Vector3(spawnPos.x, WISP_HOVER_Y, spawnPos.z), body, idSuffix);
    this.swayAmpY = 0.18;
    this.swayFreqHz = 0.7;

    // Glow halo — a slightly larger transparent emissive sphere wrapped around the body.
    const halo = MeshBuilder.CreateSphere(
      `wisp_${idSuffix}_halo`,
      { diameter: WISP_DEF.radius * 3.0, segments: 12 },
      scene,
    );
    halo.position.set(0, 0, 0);
    this.addPart(halo, new Color3(0.4, 0.7, 0.9), {
      disableLighting: true,
      emissive: new Color3(0.5, 0.8, 1.0),
    });
    halo.material!.alpha = 0.35;

    // Tiny inner core that pulses with hit flash.
    const core = MeshBuilder.CreateSphere(
      `wisp_${idSuffix}_core`,
      { diameter: 0.2, segments: 8 },
      scene,
    );
    core.position.set(0, 0, 0);
    this.addPart(core, new Color3(1.0, 1.0, 1.0), {
      disableLighting: true,
      emissive: new Color3(1.0, 1.0, 1.0),
    });
  }

  updateLogic(dt: number, player: Player): void {
    if (!this.alive) return;
    this.tickCommon(dt);

    const dx = player.root.position.x - this.root.position.x;
    const dz = player.root.position.z - this.root.position.z;
    const distSq = dx * dx + dz * dz;
    if (distSq > this.def.aggroRange * this.def.aggroRange) {
      this.state = "idle";
      // Always re-anchor at hover Y — sway composes around it.
      this.root.position.y = WISP_HOVER_Y;
      return;
    }

    // Drift toward the player but maintain ~7m kite distance.
    const dist = Math.sqrt(distSq);
    if (dist > 1e-4) {
      const nx = dx / dist;
      const nz = dz / dist;
      const target = 7;
      let moveDir = 0;
      if (dist > target + 1.5) moveDir = 1;
      else if (dist < target - 1.5) moveDir = -1;
      const step = this.def.speed * this.speedScale() * dt * moveDir;
      this.root.position.x += nx * step;
      this.root.position.z += nz * step;
    }
    // Pin Y at hover height; tickCommon's sway will compose a small ±0.18m bob on top.
    this.root.position.y = WISP_HOVER_Y;

    this.fireTimer -= dt;
    if (this.fireTimer <= 0 && distSq < 18 * 18) {
      this.fireTimer = 2.4;
      this.fireDirBuf.set(dx, 0, dz);
      // Slow orb — easy to dodge but pressures camping.
      this.projectiles.fire(this.root.position, this.fireDirBuf, 7, 6, 3.5);
    }
  }
}
