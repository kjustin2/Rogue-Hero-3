import * as THREE from "three";
import { ACT_SET_PROFILES } from "../presentation/profiles";
import type { ActComposition, ActSetId } from "../presentation/types";
import { buildWorldArchitecture, type WorldArchitecture } from "./worldArchitecture";

/** Cache the architectural sets, showing only the current act and room composition. */
export class WorldSetDirector {
  private readonly sets = new Map<ActSetId, WorldArchitecture>();
  private active: WorldArchitecture | null = null;
  private t = 0;
  private motionScale = 1;
  private quality: "low" | "medium" | "high" = "high";

  constructor(private scene: THREE.Scene) {}

  setPresentationQuality(quality: "low" | "medium" | "high", reduceMotion: boolean): void {
    this.quality = quality;
    this.motionScale = reduceMotion ? 0.08 : quality === "low" ? 0.35 : quality === "medium" ? 0.7 : 1;
  }

  set(id: ActSetId, composition: ActComposition): void {
    if (id !== "rift" && !this.sets.has(id)) {
      const set = buildWorldArchitecture(ACT_SET_PROFILES[id]);
      this.scene.add(set.root);
      this.sets.set(id, set);
    }
    this.active = null;
    let parked = 1;
    for (const [key, set] of this.sets) {
      const on = key === id;
      set.root.visible = on;
      set.root.position.y = on ? 0 : -1000 * parked++;
      if (!on) continue;
      this.active = set;
      for (const [name, group] of Object.entries(set.compositions)) group.visible = name === composition;
    }
  }

  update(dt: number, dim: number): void {
    const set = this.active;
    if (!set) return;
    this.t += dt * this.motionScale;
    set.glow.opacity = 0.3 * (1 - dim * 0.58);
    set.accent.emissiveIntensity = 0.1 * (1 - dim * 0.42);
    const moverCount = this.quality === "low" ? Math.min(2, set.movers.length) : set.movers.length;
    for (let i = 0; i < moverCount; i++) {
      const mover = set.movers[i];
      mover.object.rotation[mover.axis ?? "y"] = mover.phase + this.t * mover.speed;
    }
  }

}
