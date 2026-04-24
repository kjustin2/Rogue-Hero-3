import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Player } from "../../player/Player";
import { events } from "../../engine/EventBus";

interface HostileProjectile {
  mesh: Mesh;
  vel: Vector3;
  damage: number;
  ttl: number;
}

/** Enemy projectiles: travel in a straight line; first contact with player damages and dies. */
export class HostileProjectileSystem {
  private active: HostileProjectile[] = [];
  private mat: StandardMaterial;

  constructor(private scene: Scene, private player: Player) {
    this.mat = new StandardMaterial("hostileProjMat", scene);
    this.mat.emissiveColor = new Color3(0.95, 0.25, 0.3);
    this.mat.diffuseColor = new Color3(1, 0.4, 0.4);
    this.mat.disableLighting = true;
  }

  fire(origin: Vector3, dir: Vector3, speed: number, damage: number, ttl = 2.5): void {
    const mesh = MeshBuilder.CreateSphere("hostileProj", { diameter: 0.4, segments: 8 }, this.scene);
    mesh.position = origin.clone();
    mesh.position.y = 1;
    mesh.material = this.mat;
    const v = dir.clone();
    v.y = 0;
    const len = Math.hypot(v.x, v.z);
    if (len < 1e-4) {
      mesh.dispose();
      return;
    }
    v.x /= len;
    v.z /= len;
    v.scaleInPlace(speed);
    this.active.push({ mesh, vel: v, damage, ttl });
  }

  update(dt: number): void {
    const px = this.player.root.position.x;
    const pz = this.player.root.position.z;
    const playerR = this.player.stats.radius;

    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.ttl -= dt;
      p.mesh.position.x += p.vel.x * dt;
      p.mesh.position.z += p.vel.z * dt;

      let consumed = false;
      const dx = px - p.mesh.position.x;
      const dz = pz - p.mesh.position.z;
      const r = playerR + 0.2;
      if (dx * dx + dz * dz <= r * r) {
        if (!this.player.isDodging) {
          this.player.hp = Math.max(0, this.player.hp - p.damage);
          events.emit("DAMAGE_TAKEN", { amount: p.damage, source: "projectile" });
        }
        consumed = true;
      }

      if (consumed || p.ttl <= 0) {
        p.mesh.dispose();
        this.active.splice(i, 1);
      }
    }
  }

  /** Drop all in-flight enemy projectiles — for in-place run restart. */
  reset(): void {
    for (const p of this.active) p.mesh.dispose();
    this.active.length = 0;
  }

  dispose(): void {
    for (const p of this.active) p.mesh.dispose();
    this.active.length = 0;
    this.mat.dispose();
  }
}
