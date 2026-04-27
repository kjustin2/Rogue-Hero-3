import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { FresnelParameters } from "@babylonjs/core/Materials/fresnelParameters";
import { Player } from "../player/Player";
import { events } from "../engine/EventBus";

/**
 * Red rim fresnel on enemy bodies — helps silhouette against the green verdant
 * floor, and tips the visual language "this thing is a threat". Bosses get a
 * stronger rim via isBoss below.
 */
function applyEnemyRim(mat: StandardMaterial, isBoss: boolean): void {
  const f = new FresnelParameters();
  f.bias = 0.22;
  f.power = 2.5;
  f.leftColor = isBoss
    ? new Color3(1.0, 0.22, 0.12)
    : new Color3(0.85, 0.20, 0.14);
  f.rightColor = new Color3(0, 0, 0);
  mat.emissiveFresnelParameters = f;
}

export type EnemyState = "idle" | "chase" | "telegraph" | "attack" | "recover" | "dead";

export interface EnemyDef {
  name: string;
  hp: number;
  speed: number;
  radius: number;
  contactDamage: number;
  color: Color3;
  /** Distance at which enemy starts chasing player */
  aggroRange: number;
}

export abstract class Enemy {
  readonly id: string;
  readonly root: TransformNode;
  readonly body: Mesh;
  readonly material: StandardMaterial;
  readonly threatRing: Mesh;
  readonly threatRingMat: StandardMaterial;

  state: EnemyState = "idle";
  hp: number;
  alive = true;
  protected hitFlashTimer = 0;
  /** How long the current hit flash lasts. Set by takeDamage so subclasses can override duration. */
  protected hitFlashDur = 0.14;
  protected baseColor: Color3;
  /** Transient knockback velocity (m/s). Decays exponentially each frame. */
  private kbVel = new Vector3(0, 0, 0);
  /**
   * Per-type idle sway tuning. Subclasses set these in their constructor to
   * pick a Y-bob amplitude + frequency. tickCommon applies the Y offset to the
   * root each frame so static enemies don't feel statue-still. Zero amplitude
   * = no sway (used during chase/attack states by setting `swayActive = false`).
   */
  protected swayAmpY = 0;
  protected swayFreqHz = 0;
  /** Per-instance phase so a wave of Chasers don't all bob in lockstep. */
  protected swayPhase = Math.random() * Math.PI * 2;
  /**
   * When true, the idle Y bob is applied each frame. Subclasses flip this off
   * during chase/attack so the bob doesn't compound with movement / charges.
   */
  protected swayActive = true;
  /** Cached y baseline so the sway can compose additively without drift. */
  private swayBaseY = 0;
  private swayBaseCaptured = false;
  /**
   * Extra body primitives (heads, limbs, spikes, etc). Each tracks its own base
   * color so the hit flash can tint them without losing their tint on rest.
   * Using one material per subclass would mean all parts flashed together — but
   * parts often *want* different colors (armor vs skin), so we give each its own.
   */
  protected extraParts: {
    mesh: Mesh;
    mat: StandardMaterial;
    baseColor: Color3;
  }[] = [];
  /** Timer driving orb/limb bob animations. Subclasses read, base class increments. */
  protected partClock = 0;
  /** Dissolve state — set when the enemy dies; fades alpha/scale over `dissolveTotal`. */
  dissolving = false;
  dissolveTimer = 0;
  dissolveTotal = 0;

  constructor(
    scene: Scene,
    shadow: ShadowGenerator,
    public def: EnemyDef,
    spawnPos: Vector3,
    bodyMesh: Mesh,
    idSuffix: string,
  ) {
    this.id = `e_${def.name}_${idSuffix}`;
    this.hp = def.hp;
    this.baseColor = def.color.clone();

    this.root = new TransformNode(`${this.id}_root`, scene);
    this.root.position = spawnPos.clone();

    this.body = bodyMesh;
    this.body.parent = this.root;

    const mat = new StandardMaterial(`${this.id}_mat`, scene);
    mat.diffuseColor = this.baseColor;
    mat.specularColor = new Color3(0.05, 0.05, 0.05);
    applyEnemyRim(mat, def.name.startsWith("boss_"));
    this.material = mat;
    this.body.material = mat;
    shadow.addShadowCaster(this.body);

    // Threat ring on the ground under each enemy. Keeps crowd readability high — you can count
    // enemies and judge their footprint even when bodies overlap or the camera is zoomed out.
    // Boss gets a thicker, more saturated ring so it stands out as the focal threat.
    const isBoss = def.name.startsWith("boss_");
    const ringD = def.radius * 2 + (isBoss ? 0.9 : 0.4);
    this.threatRing = MeshBuilder.CreateTorus(
      `${this.id}_ring`,
      { diameter: ringD, thickness: isBoss ? 0.11 : 0.055, tessellation: 28 },
      scene,
    );
    const rm = new StandardMaterial(`${this.id}_ringMat`, scene);
    rm.diffuseColor = new Color3(isBoss ? 1.0 : 0.85, 0.15, 0.12);
    rm.emissiveColor = new Color3(isBoss ? 0.95 : 0.7, 0.1, 0.08);
    rm.disableLighting = true;
    rm.alpha = isBoss ? 0.7 : 0.45;
    this.threatRing.material = rm;
    this.threatRing.position = new Vector3(0, 0.04, 0);
    this.threatRing.parent = this.root;
    this.threatRingMat = rm;
  }

  /** Override per-type. Receives dt and player ref. */
  abstract updateLogic(dt: number, player: Player): void;

  takeDamage(amount: number): void {
    if (!this.alive) return;
    this.hp -= amount;
    // Scale the white-flash with the hit's damage relative to the enemy's
    // max HP — a 30% chunk lands a longer flash than a 5% chip. Capped at
    // 2× baseline so massive crits don't strobe forever.
    const ratio = Math.max(0, Math.min(1, amount / Math.max(1, this.def.hp)));
    this.hitFlashTimer = this.hitFlashDur * (1 + Math.min(1, ratio * 3));
    const killed = this.hp <= 0;
    events.emit("ENEMY_HIT", {
      enemyId: this.id,
      x: this.root.position.x,
      y: this.root.position.y + 1,
      z: this.root.position.z,
      amount,
      killed,
      isBoss: this.def.name.startsWith("boss_"),
    });
    if (killed) this.die();
  }

  protected die(): void {
    this.alive = false;
    this.state = "dead";
    // Start the dissolve — bosses take longer so the kill lands as a moment.
    const isBoss = this.def.name.startsWith("boss_");
    this.dissolving = true;
    this.dissolveTotal = isBoss ? 1.5 : 0.45;
    this.dissolveTimer = this.dissolveTotal;
    // Flip all body materials to alpha-blend so we can fade them out. Threat
    // ring gets the same treatment so it doesn't linger solid while the body fades.
    this.material.alphaMode = 2; // BABYLON.Engine.ALPHA_COMBINE
    for (const p of this.extraParts) p.mat.alphaMode = 2;
    events.emit("KILL", { enemyId: this.id });
  }

  /** Tick the dissolve animation. Returns true when finished (caller should dispose). */
  tickDissolve(dt: number): boolean {
    if (!this.dissolving) return false;
    this.dissolveTimer = Math.max(0, this.dissolveTimer - dt);
    const t = this.dissolveTimer / (this.dissolveTotal || 1);
    // Fade alpha + sink body. Threat ring fades in sync.
    this.material.alpha = t;
    for (const p of this.extraParts) p.mat.alpha = t;
    this.threatRingMat.alpha = t * (this.def.name.startsWith("boss_") ? 0.7 : 0.45);
    // Sink the body ~0.4m into the ground while it fades. Root Y, not body Y,
    // so all child parts sink together.
    this.root.position.y = -0.4 * (1 - t);
    // Slightly compress vertically for a "melting" effect.
    this.root.scaling.y = 0.4 + 0.6 * t;
    return this.dissolveTimer === 0;
  }

  /**
   * Returns all visible body meshes — used by the outline layer when this
   * enemy becomes the locked target. Includes the primary body plus every
   * registered secondary part.
   */
  getOutlineMeshes(): Mesh[] {
    const out: Mesh[] = [this.body];
    for (const p of this.extraParts) out.push(p.mesh);
    return out;
  }

  /**
   * Adds a secondary body part (spike, arm, orb, helmet, etc) that's parented to
   * this enemy and participates in the hit flash. The part is added as a shadow
   * caster. `baseColor` captures its resting diffuse so we can flash back to it.
   */
  protected addPart(mesh: Mesh, color: Color3, opts?: { castShadow?: boolean; disableLighting?: boolean; emissive?: Color3 }): {
    mesh: Mesh;
    mat: StandardMaterial;
    baseColor: Color3;
  } {
    mesh.parent = this.root;
    const mat = new StandardMaterial(`${mesh.name}_mat`, mesh.getScene());
    mat.diffuseColor = color.clone();
    mat.specularColor = new Color3(0.05, 0.05, 0.05);
    if (opts?.emissive) mat.emissiveColor = opts.emissive.clone();
    if (opts?.disableLighting) mat.disableLighting = true;
    // Apply the same rim as the main body so secondary parts read consistently.
    // Parts with disableLighting already have their own emissive pop, so skip
    // those — the fresnel would fight with the unlit look.
    if (!opts?.disableLighting) {
      applyEnemyRim(mat, this.def.name.startsWith("boss_"));
    }
    mesh.material = mat;
    const rec = { mesh, mat, baseColor: color.clone() };
    this.extraParts.push(rec);
    return rec;
  }

  /** Common per-frame work — call at top of update loop. */
  tickCommon(dt: number): void {
    this.partClock += dt;
    // Capture the resting Y once so the sway is purely additive — subclass logic
    // continues to write root.position.y for movement/stagger and the sway
    // composes around it without drifting.
    if (!this.swayBaseCaptured) {
      this.swayBaseY = this.root.position.y;
      this.swayBaseCaptured = true;
    }
    if (this.hitFlashTimer > 0) {
      this.hitFlashTimer = Math.max(0, this.hitFlashTimer - dt);
      const t = this.hitFlashTimer / this.hitFlashDur;
      // Pure white pop — lands as "I hit it" rather than the previous red-tint
      // which dilutes against the already-red threat language. Lerp from
      // baseColor toward (1,1,1) by `t` so the flash peaks at full white and
      // eases back to baseline.
      this.material.diffuseColor.copyFrom(this.baseColor).scale(1 - t);
      this.material.diffuseColor.r += t;
      this.material.diffuseColor.g += t;
      this.material.diffuseColor.b += t;
      for (const p of this.extraParts) {
        p.mat.diffuseColor.copyFrom(p.baseColor).scale(1 - t);
        p.mat.diffuseColor.r += t;
        p.mat.diffuseColor.g += t;
        p.mat.diffuseColor.b += t;
      }
    } else {
      this.material.diffuseColor.copyFrom(this.baseColor);
      for (const p of this.extraParts) p.mat.diffuseColor.copyFrom(p.baseColor);
    }
    // Idle Y sway — only when configured AND the subclass deems it appropriate
    // (e.g. not during a charge). Phase per-instance so a group bobs out of
    // sync. Composed additively on top of swayBaseY.
    if (this.swayAmpY > 0 && this.swayActive) {
      const t = this.partClock * this.swayFreqHz * Math.PI * 2;
      this.root.position.y = this.swayBaseY + Math.sin(t + this.swayPhase) * this.swayAmpY;
    }
  }

  /**
   * Apply an instant knockback impulse (XZ, meters/sec). Decays exponentially.
   * Direction is assumed roughly unit-length but we renormalize defensively.
   */
  knockback(dirX: number, dirZ: number, strength: number): void {
    if (!this.alive) return;
    const len = Math.hypot(dirX, dirZ);
    if (len < 1e-4) return;
    // Overwrite rather than stack — multiple rapid hits shouldn't compound into
    // launch-across-the-arena speeds. Bosses get a fractional impulse since a
    // large enemy sliding around undermines its weight read.
    const isBoss = this.def.name.startsWith("boss_");
    const scale = isBoss ? 0.35 : 1;
    this.kbVel.x = (dirX / len) * strength * scale;
    this.kbVel.z = (dirZ / len) * strength * scale;
  }

  /** Integrate the knockback velocity into position. Call after updateLogic each frame. */
  applyKnockback(dt: number): void {
    if (!this.alive) return;
    const vx = this.kbVel.x;
    const vz = this.kbVel.z;
    if (vx === 0 && vz === 0) return;
    this.root.position.x += vx * dt;
    this.root.position.z += vz * dt;
    // Exponential decay — loses ~70% of speed every 0.1s (12/s rate).
    const decay = Math.exp(-12 * dt);
    this.kbVel.x *= decay;
    this.kbVel.z *= decay;
    // Snap to zero below a small threshold to avoid subpixel drift.
    if (Math.abs(this.kbVel.x) < 0.01) this.kbVel.x = 0;
    if (Math.abs(this.kbVel.z) < 0.01) this.kbVel.z = 0;
  }

  /**
   * Push self out of pillars after movement. Same squared-distance scheme as PlayerController.
   * Pillar diameter is 1.6 (radius 0.8). Call at end of updateLogic each frame.
   */
  clampToPillars(pillars: Mesh[]): void {
    if (pillars.length === 0) return;
    const r = this.def.radius;
    let nx = this.root.position.x;
    let nz = this.root.position.z;
    for (const pillar of pillars) {
      const px = pillar.position.x;
      const pz = pillar.position.z;
      const ddx = nx - px;
      const ddz = nz - pz;
      const minDist = 0.8 + r;
      const distSq = ddx * ddx + ddz * ddz;
      if (distSq < minDist * minDist && distSq > 1e-6) {
        const dist = Math.sqrt(distSq);
        const nxn = ddx / dist;
        const nzn = ddz / dist;
        nx = px + nxn * minDist;
        nz = pz + nzn * minDist;
      }
    }
    this.root.position.x = nx;
    this.root.position.z = nz;
  }

  dispose(): void {
    this.threatRing.dispose();
    this.threatRingMat.dispose();
    for (const p of this.extraParts) { p.mesh.dispose(); p.mat.dispose(); }
    this.extraParts.length = 0;
    this.body.dispose();
    this.material.dispose();
    this.root.dispose();
  }
}
