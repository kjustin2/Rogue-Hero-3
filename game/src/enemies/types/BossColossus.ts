import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { BossBrawler, BRAWLER_DEF } from "./BossBrawler";

/**
 * Act III boss — Magma Colossus. Slow, hulking, basaltic. Same brawler FSM
 * but with magma palette + larger telegraph crackle. Banner names it
 * accordingly. Phase / lava-pit mechanics live in the room descriptor.
 */
export class BossColossus extends BossBrawler {
  constructor(scene: Scene, shadow: ShadowGenerator, spawnPos: Vector3, idSuffix: string) {
    super(scene, shadow, spawnPos, idSuffix);
    this.bossDisplayName = "MAGMA COLOSSUS";
    // Long intro — emerges from the floor, takes its time.
    this.introTimer = 3.8;
    this.introDuration = 3.8;
    // Volcanic body — saturated red base + bright orange emissive cracks.
    this.material.diffuseColor = new Color3(0.45, 0.10, 0.06);
    this.material.emissiveColor = new Color3(0.60, 0.18, 0.05);
    this.baseColor = this.material.diffuseColor.clone();

    // Lava-vein streak across the chest — emissive plate.
    const vein = MeshBuilder.CreateBox(
      `${this.id}_vein`,
      { width: 1.6, height: 0.18, depth: 0.12 },
      scene,
    );
    vein.position.set(0, 1.6, BRAWLER_DEF.radius * 1.0);
    this.addPart(vein, new Color3(1.0, 0.45, 0.10), {
      disableLighting: true,
      emissive: new Color3(1.0, 0.45, 0.10),
    });

    this.def = { ...BRAWLER_DEF, name: "boss_colossus" };
  }
}
