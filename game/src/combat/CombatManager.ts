import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Player } from "../player/Player";
import { CardDef } from "../deck/CardDefinitions";

interface ArcSlash {
  mesh: Mesh;
  mat: StandardMaterial;
  ttl: number;
  initial: number;
  active: boolean;
}

/**
 * Visual preview of the currently-selected attack.
 *   - Melee cards: an arc sector on the ground matching the card's reach and swing angle.
 *   - Projectile/dash: no ground preview (the aim line + world FX handle those).
 *
 * Also plays a brief bright flash when a melee card successfully casts, so the player gets a
 * clear "swung here" readout beyond the per-card FX mesh spawned by CardCaster.
 *
 * Replaces the old LMB-triggered auto-melee — LMB now plays whichever card is selected, and
 * card dispatch / damage lives in CardCaster.
 */
export class CombatManager {
  private flash: Mesh | null = null;
  private flashMat: StandardMaterial | null = null;
  private flashTimer = 0;
  private preview: Mesh | null = null;
  private previewMat: StandardMaterial | null = null;
  private previewPulse = 0;
  /** Last (range, arcDeg) used to build the preview geometry — rebuilt only when these change. */
  private previewShape: { range: number; arcDeg: number } | null = null;
  /**
   * Pooled slash arcs. Each entry's mesh + material are pre-allocated and
   * reused. Pool size 4 covers rapid-fire melee swings without ever growing.
   * Geometry is rebuilt once per slot the first time it's spawned at a given
   * range/arcDeg, and cached after — most runs only ever swing one card so
   * this is effectively a single rebuild per slot.
   */
  private readonly SLASH_POOL_SIZE = 4;
  private slashes: ArcSlash[] = [];
  /** Per-slot cache of the last (range, arcDeg) used to build the geometry. */
  private slashShape: ({ range: number; arcDeg: number } | null)[] = [];

  private readonly MELEE_ARC_DEG = 140; // must match CardCaster.castMelee's arc
  private readonly FLASH_DURATION = 0.18;

  constructor(
    private scene: Scene,
    private player: Player,
  ) {}

  /** Rebuild the preview geometry for a melee card, or hide it for projectile/dash/no-card. */
  setSelectedCard(card: CardDef | null): void {
    if (!card || card.type !== "melee") {
      this.hide();
      return;
    }
    this.ensureShape(card.range, this.MELEE_ARC_DEG);
  }

  /** Play a bright swing flash — called when a melee card successfully casts. */
  triggerFlash(): void {
    if (!this.flash || !this.flashMat) return;
    this.flash.isVisible = true;
    this.flashTimer = this.FLASH_DURATION;
    this.flashMat.alpha = 0.6;
    // Also spawn an airborne slash arc (a tilted thin curved band) that sells the swing
    // as a physical blade motion rather than just a ground decal flash.
    this.spawnSlashArc();
    // Animate the humanoid proxy's sword arm.
    this.player.triggerSwing();
  }

  /**
   * A thin curved band that tilts ~25° off the ground and fades quickly. Pooled —
   * the first call at a given range/arcDeg builds the geometry for that slot;
   * subsequent calls reuse it. If a slot's cached geometry doesn't match, we
   * rebuild for that slot only.
   */
  private spawnSlashArc(): void {
    const range = this.previewShape ? this.previewShape.range : 3.2;
    const arcDeg = this.previewShape ? this.previewShape.arcDeg : this.MELEE_ARC_DEG;

    // Find a free slot.
    let slot = -1;
    for (let i = 0; i < this.slashes.length; i++) {
      if (!this.slashes[i].active) { slot = i; break; }
    }
    if (slot === -1) {
      // Pool not yet at capacity — extend it on demand up to SLASH_POOL_SIZE.
      if (this.slashes.length < this.SLASH_POOL_SIZE) {
        slot = this.slashes.length;
        this.slashes.push(this.allocateSlashSlot(slot));
        this.slashShape.push(null);
      } else {
        return; // all 4 slots in flight; drop this one
      }
    }

    // Rebuild this slot's geometry only if shape differs from the cached one.
    const shape = this.slashShape[slot];
    if (!shape || shape.range !== range || shape.arcDeg !== arcDeg) {
      this.rebuildSlashSlot(slot, range, arcDeg);
    }

    const s = this.slashes[slot];
    s.mesh.scaling.set(0.75, 1, 0.75);
    s.mat.alpha = 0.85;
    s.ttl = 0.22;
    s.initial = 0.22;
    s.active = true;
    s.mesh.setEnabled(true);
  }

  private allocateSlashSlot(idx: number): ArcSlash {
    // Placeholder — geometry built on first use via rebuildSlashSlot.
    const mesh = MeshBuilder.CreateDisc(`slashArc_${idx}`, { radius: 1, tessellation: 40, arc: 0.5 }, this.scene);
    mesh.parent = this.player.aimPivot;
    mesh.position = new Vector3(0, 1.15, 0);
    mesh.setEnabled(false);
    mesh.isPickable = false;
    mesh.doNotSyncBoundingInfo = true;
    const mat = new StandardMaterial(`slashArcMat_${idx}`, this.scene);
    mat.emissiveColor = new Color3(1.0, 0.92, 0.55);
    mat.diffuseColor = new Color3(1.0, 0.85, 0.35);
    mat.disableLighting = true;
    mat.alpha = 0.85;
    mat.backFaceCulling = false;
    mesh.material = mat;
    return { mesh, mat, ttl: 0, initial: 0, active: false };
  }

  private rebuildSlashSlot(idx: number, range: number, arcDeg: number): void {
    const s = this.slashes[idx];
    // Dispose old geometry; keep mesh node + material to retain parenting + reused refs.
    s.mesh.dispose(false, false);
    const arcFraction = arcDeg / 360;
    const newMesh = MeshBuilder.CreateDisc(`slashArc_${idx}`, { radius: range, tessellation: 40, arc: arcFraction }, this.scene);
    newMesh.parent = this.player.aimPivot;
    newMesh.position = new Vector3(0, 1.15, 0);
    const yaw = (arcDeg / 2) * (Math.PI / 180) - Math.PI / 2;
    newMesh.rotation.x = Math.PI / 2 - 0.35;
    newMesh.rotation.y = yaw;
    newMesh.material = s.mat;
    newMesh.isPickable = false;
    newMesh.doNotSyncBoundingInfo = true;
    newMesh.setEnabled(false);
    s.mesh = newMesh;
    this.slashShape[idx] = { range, arcDeg };
  }

  update(dt: number): void {
    if (this.flashTimer > 0 && this.flash && this.flashMat) {
      this.flashTimer = Math.max(0, this.flashTimer - dt);
      this.flashMat.alpha = 0.6 * (this.flashTimer / this.FLASH_DURATION);
      if (this.flashTimer === 0) this.flash.isVisible = false;
    }
    if (this.preview && this.previewMat) {
      this.previewPulse += dt * 2.2;
      const breath = 0.5 + 0.5 * Math.sin(this.previewPulse);
      this.previewMat.alpha = 0.10 + 0.08 * breath;
    }
    for (const s of this.slashes) {
      if (!s.active) continue;
      s.ttl -= dt;
      if (s.ttl <= 0) {
        s.active = false;
        s.mesh.setEnabled(false);
        continue;
      }
      const t = 1 - s.ttl / s.initial;
      // Expand slightly as it trails off — sells follow-through.
      const scale = 0.75 + 0.35 * t;
      s.mesh.scaling.x = s.mesh.scaling.z = scale;
      s.mat.alpha = 0.85 * (1 - t) * (1 - t);
    }
  }

  private ensureShape(range: number, arcDeg: number): void {
    if (this.previewShape && this.previewShape.range === range && this.previewShape.arcDeg === arcDeg) {
      if (this.preview) this.preview.isVisible = true;
      if (this.flash) this.flash.isVisible = this.flashTimer > 0;
      return;
    }
    this.disposeMeshes();

    // Babylon YXZ Euler: disc is in local XY (normal +Z); Rx(π/2) tips it into XZ (normal +Y).
    // After the tip the arc spans +X → arcDeg° in XZ, so yaw by (arcDeg/2 − π/2) to center on +Z.
    const yaw = (arcDeg / 2) * (Math.PI / 180) - Math.PI / 2;
    const arcFraction = arcDeg / 360;

    this.flash = MeshBuilder.CreateDisc(
      "swingFlash",
      { radius: range, tessellation: 32, arc: arcFraction },
      this.scene,
    );
    this.flash.rotation.x = Math.PI / 2;
    this.flash.rotation.y = yaw;
    this.flash.position = new Vector3(0, 0.07, 0);
    this.flash.parent = this.player.aimPivot;
    this.flashMat = new StandardMaterial("swingFlashMat", this.scene);
    this.flashMat.diffuseColor = new Color3(1, 0.9, 0.4);
    this.flashMat.emissiveColor = new Color3(1, 0.85, 0.3);
    this.flashMat.alpha = 0.0;
    this.flashMat.disableLighting = true;
    this.flashMat.backFaceCulling = false;
    this.flash.material = this.flashMat;
    this.flash.isVisible = false;

    this.preview = MeshBuilder.CreateDisc(
      "swingPreview",
      { radius: range, tessellation: 32, arc: arcFraction },
      this.scene,
    );
    this.preview.rotation.x = Math.PI / 2;
    this.preview.rotation.y = yaw;
    this.preview.position = new Vector3(0, 0.05, 0);
    this.preview.parent = this.player.aimPivot;
    this.previewMat = new StandardMaterial("swingPreviewMat", this.scene);
    this.previewMat.diffuseColor = new Color3(1, 0.9, 0.5);
    this.previewMat.emissiveColor = new Color3(0.9, 0.75, 0.25);
    this.previewMat.alpha = 0.12;
    this.previewMat.disableLighting = true;
    this.previewMat.backFaceCulling = false;
    this.preview.material = this.previewMat;

    this.previewShape = { range, arcDeg };
  }

  private hide(): void {
    if (this.preview) this.preview.isVisible = false;
    if (this.flash) this.flash.isVisible = false;
  }

  private disposeMeshes(): void {
    if (this.flash) { this.flash.dispose(); this.flash = null; }
    if (this.flashMat) { this.flashMat.dispose(); this.flashMat = null; }
    if (this.preview) { this.preview.dispose(); this.preview = null; }
    if (this.previewMat) { this.previewMat.dispose(); this.previewMat = null; }
    this.previewShape = null;
  }

  dispose(): void {
    for (const s of this.slashes) { s.mesh.dispose(); s.mat.dispose(); }
    this.slashes.length = 0;
    this.slashShape.length = 0;
    this.disposeMeshes();
  }
}
