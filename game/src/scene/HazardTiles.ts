import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { events } from "../engine/EventBus";

export type HazardKind = "lava" | "spikes";

export interface HazardTileSpec {
  kind: HazardKind;
  x: number;
  z: number;
  /** Footprint in meters. width is X, depth is Z. */
  width: number;
  depth: number;
  /** Spikes only — emergence cycle length in seconds (default 1.8). */
  cycle?: number;
}

interface LavaTile {
  kind: "lava";
  base: Mesh;
  border: Mesh;
  borderMat: StandardMaterial;
  cx: number; cz: number;
  hw: number; hd: number;
  /** DoT residue — fractional damage carried frame-to-frame. */
  acc: number;
}

interface SpikeTile {
  kind: "spikes";
  base: Mesh;
  spikes: Mesh[];
  ring: Mesh;
  ringMat: StandardMaterial;
  cx: number; cz: number;
  hw: number; hd: number;
  cycle: number;
  phase: number; // 0..cycle, drives emergence parabola
  /** True when spikes are extended past the danger threshold this cycle. */
  hasDealtThisCycle: boolean;
}

type Tile = LavaTile | SpikeTile;

/**
 * Static damaging floor tiles — placed by RoomDescriptor.hazards. Lava is a
 * persistent damage-over-time zone (~8 dmg/sec). Spikes emerge on a cycle and
 * deal a single 18-damage hit on each emergence.
 *
 * Both ignore the player while airborne or dodging — jumping over a tile is
 * a meaningful skill check. The damage value is RETURNED from tick() so the
 * caller (main.ts) can route it through the same applyPlayerDamage helper as
 * boss attacks.
 */
export class HazardTiles {
  private tiles: Tile[] = [];
  private clock = 0;
  private lavaTex: DynamicTexture | null = null;

  constructor(private scene: Scene, specs: HazardTileSpec[]) {
    for (const s of specs) {
      if (s.kind === "lava") this.tiles.push(this.buildLava(s));
      else this.tiles.push(this.buildSpikes(s));
    }
  }

  private buildLava(s: HazardTileSpec): LavaTile {
    const scene = this.scene;
    const base = MeshBuilder.CreateBox(
      `hazardLava_${s.x}_${s.z}`,
      { width: s.width, height: 0.05, depth: s.depth },
      scene,
    );
    base.position = new Vector3(s.x, 0.025, s.z);
    base.isPickable = false;

    const mat = new StandardMaterial(`hazardLavaMat_${s.x}_${s.z}`, scene);
    mat.disableLighting = true;
    mat.diffuseColor = new Color3(0, 0, 0);
    mat.emissiveColor = new Color3(1.0, 0.28, 0.06);
    if (!this.lavaTex) {
      // Procedural noisy texture — one per scene, shared by every lava tile.
      const tex = new DynamicTexture("hazardLavaTex", { width: 128, height: 128 }, scene, false);
      const ctx = tex.getContext();
      // Hand-roll the noise via fillRect — Babylon's ICanvasRenderingContext
      // type doesn't expose createImageData/putImageData. Coarser cells but
      // faster and portable across the NullEngine smoke environment too.
      const cell = 4;
      for (let y = 0; y < 128; y += cell) {
        for (let x = 0; x < 128; x += cell) {
          const v = Math.random();
          const r = 220 + Math.floor(v * 35);
          const g = 90 + Math.floor(v * 80);
          const b = 30 + Math.floor(v * 40);
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          ctx.fillRect(x, y, cell, cell);
        }
      }
      tex.update();
      tex.uScale = 2; tex.vScale = 2;
      this.lavaTex = tex;
    }
    mat.emissiveTexture = this.lavaTex;
    base.material = mat;

    // Bright border ring so the danger silhouette reads at any angle.
    const border = MeshBuilder.CreateBox(
      `hazardLavaBorder_${s.x}_${s.z}`,
      { width: s.width + 0.4, height: 0.06, depth: s.depth + 0.4 },
      scene,
    );
    border.position = new Vector3(s.x, 0.02, s.z);
    border.isPickable = false;
    const borderMat = new StandardMaterial(`hazardLavaBorderMat_${s.x}_${s.z}`, scene);
    borderMat.disableLighting = true;
    borderMat.diffuseColor = new Color3(0, 0, 0);
    borderMat.emissiveColor = new Color3(1.0, 0.45, 0.05);
    border.material = borderMat;

    return {
      kind: "lava", base, border, borderMat,
      cx: s.x, cz: s.z, hw: s.width / 2, hd: s.depth / 2,
      acc: 0,
    };
  }

  private buildSpikes(s: HazardTileSpec): SpikeTile {
    const scene = this.scene;
    const base = MeshBuilder.CreateBox(
      `hazardSpikesBase_${s.x}_${s.z}`,
      { width: s.width, height: 0.05, depth: s.depth },
      scene,
    );
    base.position = new Vector3(s.x, 0.025, s.z);
    base.isPickable = false;
    const baseMat = new StandardMaterial(`hazardSpikesBaseMat_${s.x}_${s.z}`, scene);
    baseMat.diffuseColor = new Color3(0.20, 0.20, 0.22);
    baseMat.emissiveColor = new Color3(0.04, 0.04, 0.04);
    baseMat.specularColor = new Color3(0.1, 0.1, 0.1);
    base.material = baseMat;

    // Spike grid — 3×3 cluster of pyramidal cones inside the footprint.
    const spikes: Mesh[] = [];
    const COLS = 3, ROWS = 3;
    const gx = s.width / (COLS + 1);
    const gz = s.depth / (ROWS + 1);
    const spikeMat = new StandardMaterial(`hazardSpikesMat_${s.x}_${s.z}`, scene);
    spikeMat.diffuseColor = new Color3(0.35, 0.35, 0.40);
    spikeMat.specularColor = new Color3(0.6, 0.6, 0.7);
    spikeMat.emissiveColor = new Color3(0.05, 0.02, 0.02);
    for (let r = 1; r <= ROWS; r++) {
      for (let c = 1; c <= COLS; c++) {
        const sp = MeshBuilder.CreateCylinder(
          `hazardSpike_${s.x}_${s.z}_${r}_${c}`,
          { diameterTop: 0.0, diameterBottom: 0.18, height: 0.6, tessellation: 6 },
          scene,
        );
        sp.position = new Vector3(s.x - s.width / 2 + c * gx, 0, s.z - s.depth / 2 + r * gz);
        sp.material = spikeMat;
        sp.isPickable = false;
        spikes.push(sp);
      }
    }

    // Telegraph ring — a thin red glow on the floor; pulses brighter just before
    // emergence so the player has a reliable read.
    const ring = MeshBuilder.CreateBox(
      `hazardSpikesRing_${s.x}_${s.z}`,
      { width: s.width + 0.4, height: 0.04, depth: s.depth + 0.4 },
      scene,
    );
    ring.position = new Vector3(s.x, 0.012, s.z);
    ring.isPickable = false;
    const ringMat = new StandardMaterial(`hazardSpikesRingMat_${s.x}_${s.z}`, scene);
    ringMat.disableLighting = true;
    ringMat.diffuseColor = new Color3(0, 0, 0);
    ringMat.emissiveColor = new Color3(0.9, 0.15, 0.15);
    ring.material = ringMat;

    return {
      kind: "spikes", base, spikes, ring, ringMat,
      cx: s.x, cz: s.z, hw: s.width / 2, hd: s.depth / 2,
      cycle: s.cycle ?? 1.8,
      phase: Math.random() * (s.cycle ?? 1.8),
      hasDealtThisCycle: false,
    };
  }

  /**
   * Tick the hazards. Returns the integer damage to apply to the player this
   * frame. Caller is expected to route through their normal damage path so
   * relic hooks (Ironclad, Aegis absorb) compose. Emits DAMAGE_TAKEN with the
   * source so the HUD can flash appropriately.
   */
  tick(dt: number, playerPos: Vector3, playerRadius: number, isAirborne: boolean, isDodging: boolean): number {
    this.clock += dt;
    let totalDamage = 0;
    const safe = isAirborne || isDodging;

    for (const t of this.tiles) {
      if (t.kind === "lava") {
        // Animate scrolling emissive UVs on the border for a "hot air" wobble.
        if (this.lavaTex) {
          this.lavaTex.uOffset = (this.clock * 0.1) % 1;
          this.lavaTex.vOffset = (this.clock * 0.07) % 1;
        }
        t.borderMat.emissiveColor.r = 0.9 + 0.1 * Math.sin(this.clock * 4);

        if (safe) continue;
        if (this.pointInRect(playerPos, playerRadius, t)) {
          // 8 dmg/sec, accumulated to integer chunks.
          t.acc += 8 * dt;
          if (t.acc >= 1) {
            const dmg = Math.floor(t.acc);
            t.acc -= dmg;
            totalDamage += dmg;
            events.emit("DAMAGE_TAKEN", { amount: dmg, source: "lava" });
          }
        } else {
          t.acc = 0;
        }
      } else {
        // Spikes — drive the emergence on a cycle. Phase 0..0.5*cycle: rest.
        // 0.5..0.7: telegraph (ring brightens). 0.7..0.85: spike up. 0.85..1.0: hold/retract.
        t.phase = (t.phase + dt) % t.cycle;
        const tNorm = t.phase / t.cycle;
        let height = 0;
        let telegraph = 0;
        if (tNorm < 0.5) {
          height = 0; telegraph = 0;
          t.hasDealtThisCycle = false;
        } else if (tNorm < 0.7) {
          telegraph = (tNorm - 0.5) / 0.2; // 0..1
          height = 0;
        } else if (tNorm < 0.85) {
          telegraph = 1.0;
          height = (tNorm - 0.7) / 0.15; // 0..1 — emerge
        } else {
          telegraph = 1.0 - (tNorm - 0.85) / 0.15; // fade ring as spikes retract
          height = 1.0 - (tNorm - 0.85) / 0.15;
        }
        for (const sp of t.spikes) sp.position.y = 0.3 * height; // half-height embedded so tip = 0.6m at full

        const breath = 0.5 + 0.5 * Math.abs(Math.sin(this.clock * 6));
        t.ringMat.emissiveColor.r = 0.4 + 0.55 * telegraph * breath;
        t.ringMat.emissiveColor.g = 0.08 * telegraph;
        t.ringMat.emissiveColor.b = 0.08 * telegraph;

        // Damage on emerge: when spikes are at >= 50% height, count one strike.
        if (height >= 0.5 && !t.hasDealtThisCycle && !safe) {
          if (this.pointInRect(playerPos, playerRadius, t)) {
            t.hasDealtThisCycle = true;
            totalDamage += 18;
            events.emit("DAMAGE_TAKEN", { amount: 18, source: "spikes" });
          }
        }
      }
    }
    return totalDamage;
  }

  private pointInRect(p: Vector3, r: number, t: { cx: number; cz: number; hw: number; hd: number }): boolean {
    return (
      p.x + r >= t.cx - t.hw &&
      p.x - r <= t.cx + t.hw &&
      p.z + r >= t.cz - t.hd &&
      p.z - r <= t.cz + t.hd
    );
  }

  dispose(): void {
    for (const t of this.tiles) {
      if (t.kind === "lava") {
        t.base.dispose();
        t.border.dispose();
        (t.base.material as StandardMaterial)?.dispose();
        t.borderMat.dispose();
      } else {
        t.base.dispose();
        for (const sp of t.spikes) sp.dispose();
        (t.base.material as StandardMaterial)?.dispose();
        if (t.spikes[0]?.material) (t.spikes[0].material as StandardMaterial).dispose();
        t.ring.dispose();
        t.ringMat.dispose();
      }
    }
    this.tiles = [];
    if (this.lavaTex) {
      this.lavaTex.dispose();
      this.lavaTex = null;
    }
  }
}
