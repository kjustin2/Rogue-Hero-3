import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

/**
 * Trail for the player's sword tip. Each sample is a world-space point recorded
 * once per frame while trailing is active. The rendered ribbon reconstructs
 * itself from the last N samples every frame via `MeshBuilder.CreateRibbon`
 * with `instance` — Babylon rebuilds the vertex buffer in-place, no per-frame
 * allocation of mesh.
 *
 * Perf: one ribbon mesh, one material, `SAMPLE_CAP` samples. Disposed with the
 * player on run reset.
 */
const SAMPLE_CAP = 10;
const SAMPLE_TTL_MS = 220;
const WIDTH_TOP = 0.28;
const WIDTH_BOTTOM = 0.02;

interface Sample {
  p: Vector3;
  t: number; // ms timestamp
}

export class WeaponTrail {
  /**
   * Pooled sample slots — `samples[]` is a windowed view into this fixed-size
   * array, so `tick()` doesn't allocate Sample objects or Vector3 instances on
   * every frame. We rotate the head pointer instead of `.shift()`-ing.
   */
  private samplePool: Sample[];
  private samples: Sample[] = [];
  /** Pre-allocated ribbon path arrays — reused every rebuild() in-place. */
  private topPath: Vector3[];
  private botPath: Vector3[];
  private ribbon: Mesh | null = null;
  private mat: StandardMaterial;
  private scene: Scene;
  /** Set from outside — when true, the per-frame tick records a sample. */
  emitting = false;

  constructor(scene: Scene) {
    this.scene = scene;
    this.mat = new StandardMaterial("weaponTrailMat", scene);
    this.mat.diffuseColor = new Color3(1, 0.9, 0.5);
    this.mat.emissiveColor = new Color3(1, 0.85, 0.35);
    this.mat.disableLighting = true;
    this.mat.backFaceCulling = false;
    this.mat.alpha = 0.85;
    this.mat.alphaMode = 2; // BABYLON.Engine.ALPHA_COMBINE
    // Pre-allocate sample + path pools so combat frames stay alloc-free.
    this.samplePool = new Array(SAMPLE_CAP);
    for (let i = 0; i < SAMPLE_CAP; i++) {
      this.samplePool[i] = { p: new Vector3(), t: 0 };
    }
    this.topPath = new Array(SAMPLE_CAP);
    this.botPath = new Array(SAMPLE_CAP);
    for (let i = 0; i < SAMPLE_CAP; i++) {
      this.topPath[i] = new Vector3();
      this.botPath[i] = new Vector3();
    }
  }

  /** Tempo-driven intensity 0..1.5 — modulates trail alpha + thickness in rebuild. */
  private intensity = 1.0;
  /** Cursor into samplePool for the next sample we're about to overwrite. */
  private poolCursor = 0;

  /**
   * Call once per frame with the current sword-tip world position. `active`
   * controls whether new samples are recorded — set true briefly during a
   * swing so the trail paints. Old samples fade out naturally either way.
   *
   * `intensity` is a 0..1.5 multiplier applied to width + alpha so high tempo
   * thickens the swing and low tempo thins it. Defaults to 1.0 — caller passes
   * `0.6 + 0.9 * tempoNormalized` for a smooth ramp from sluggish to roaring.
   */
  tick(tipWorld: Vector3, active: boolean, intensity = 1.0): void {
    this.intensity = intensity;
    const now = performance.now();
    if (active) {
      // Acquire the next pool slot and overwrite in place.
      const slot = this.samplePool[this.poolCursor];
      this.poolCursor = (this.poolCursor + 1) % SAMPLE_CAP;
      slot.p.copyFrom(tipWorld);
      slot.t = now;
      this.samples.push(slot);
      if (this.samples.length > SAMPLE_CAP) this.samples.shift();
    }
    // Retire samples older than TTL so the trail fades after the swing ends.
    while (this.samples.length > 0 && now - this.samples[0].t > SAMPLE_TTL_MS) {
      this.samples.shift();
    }
    this.rebuild(now);
  }

  private rebuild(now: number): void {
    const n = this.samples.length;
    if (n < 2) {
      if (this.ribbon) this.ribbon.isVisible = false;
      return;
    }
    // Reuse the pre-allocated topPath/botPath arrays — Babylon's in-place
    // `instance` update path requires the same point count as the original
    // ribbon (SAMPLE_CAP), so we always pass the full-length arrays even when
    // fewer real samples are recorded (older slots collapse onto the oldest).
    const top = this.topPath;
    const bot = this.botPath;
    const oldest = this.samples[0];
    const pad = SAMPLE_CAP - n;
    for (let i = 0; i < SAMPLE_CAP; i++) {
      const srcIdx = i < pad ? 0 : i - pad;
      const s = i < pad ? oldest : this.samples[srcIdx];
      const age = (now - s.t) / SAMPLE_TTL_MS;
      // Intensity widens the trail at high tempo, thins it at low.
      const thickness = (1 - age) * WIDTH_TOP * this.intensity;
      const bottomT = (1 - age) * WIDTH_BOTTOM * this.intensity;
      top[i].set(s.p.x, s.p.y + thickness * 0.5, s.p.z);
      bot[i].set(s.p.x, s.p.y - bottomT, s.p.z);
    }

    if (!this.ribbon) {
      this.ribbon = MeshBuilder.CreateRibbon(
        "weaponTrail",
        { pathArray: [top, bot], sideOrientation: Mesh.DOUBLESIDE, updatable: true },
        this.scene,
      );
      this.ribbon.material = this.mat;
      this.ribbon.isPickable = false;
      this.ribbon.alwaysSelectAsActiveMesh = true;
      this.ribbon.doNotSyncBoundingInfo = true;
    } else {
      MeshBuilder.CreateRibbon("weaponTrail", { pathArray: [top, bot], instance: this.ribbon });
    }
    this.ribbon.isVisible = true;
    // Fade the whole ribbon as the newest sample ages out, modulated by tempo
    // intensity so high-tempo swings paint a bolder trail.
    const newestAge = n > 0 ? (now - this.samples[n - 1].t) / SAMPLE_TTL_MS : 1;
    this.mat.alpha = 0.85 * (1 - Math.min(1, newestAge * 0.8)) * this.intensity;
  }

  /** Wipe the buffer — for in-place run restart. */
  reset(): void {
    this.samples.length = 0;
    this.poolCursor = 0;
    if (this.ribbon) this.ribbon.isVisible = false;
  }

  dispose(): void {
    if (this.ribbon) {
      this.ribbon.dispose();
      this.ribbon = null;
    }
    this.mat.dispose();
    this.samples.length = 0;
  }
}
