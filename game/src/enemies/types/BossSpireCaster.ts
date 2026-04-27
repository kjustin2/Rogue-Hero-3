import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { BossBrawler, BRAWLER_DEF } from "./BossBrawler";

/**
 * Act II boss — Spire Caster. Shares the brawler's FSM (chase → telegraphed
 * dash → recover) but with a slimmer silhouette, blue palette, glowing orb
 * accents, and the longer name banner. Phase mechanics are inherited.
 *
 * The bigger differentiation between bosses lives in the room they're in
 * (Spire Apex uses the throne_back columned hall) and in their intro tween.
 */
export class BossSpireCaster extends BossBrawler {
  constructor(scene: Scene, shadow: ShadowGenerator, spawnPos: Vector3, idSuffix: string) {
    super(scene, shadow, spawnPos, idSuffix);
    this.bossDisplayName = "WARDEN OF SPIRES";
    // Slightly longer intro — drama-build for the act-finale.
    this.introTimer = 3.4;
    this.introDuration = 3.4;
    // Override the base color/emissive for the body to read as cold/electric.
    this.material.diffuseColor = new Color3(0.30, 0.55, 0.95);
    this.material.emissiveColor = new Color3(0.15, 0.30, 0.55);
    this.baseColor = this.material.diffuseColor.clone();

    // Two glowing orbs orbiting the body — pure visual flavor, not yet wired
    // as the invulnerable phase-2 shield orbs (deferred to a future pass).
    const orbColor = new Color3(0.65, 0.85, 1.0);
    for (const xOff of [-1.4, 1.4]) {
      const orb = MeshBuilder.CreateSphere(
        `${this.id}_orb_${xOff}`,
        { diameter: 0.48, segments: 12 },
        scene,
      );
      orb.position.set(xOff, 2.2, 0);
      this.addPart(orb, orbColor, {
        disableLighting: true,
        emissive: new Color3(0.55, 0.80, 1.0),
      });
      shadow.addShadowCaster(orb);
    }
    // Override the EnemyDef reference's name so main.ts banners + smoke tests
    // see the correct kind. We don't mutate the shared BRAWLER_DEF — instead
    // alias-swap onto a local object identity (the parent stored a ref).
    this.def = { ...BRAWLER_DEF, name: "boss_spire_caster" };
  }
}
