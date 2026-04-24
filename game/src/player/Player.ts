import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { FresnelParameters } from "@babylonjs/core/Materials/fresnelParameters";
import { events } from "../engine/EventBus";
import { dampCoeff } from "../util/Smoothing";

/**
 * Warm rim fresnel for the player silhouette. Added as an additive emissive on
 * grazing angles so the capsule body reads against the arena floor from any
 * camera angle. Bias 0.2 = rim starts at the edge and fades ~20% in; power 3 =
 * sharp rim, not a wash. Right color (facing the camera) is black so the rim is
 * additive on top of the normal shading, not a replacement.
 */
function applyPlayerRim(mat: StandardMaterial): void {
  const f = new FresnelParameters();
  f.bias = 0.2;
  f.power = 3;
  f.leftColor = new Color3(1.0, 0.85, 0.45);  // warm gold at grazing angles
  f.rightColor = new Color3(0, 0, 0);         // no addition at head-on
  mat.emissiveFresnelParameters = f;
}

export interface PlayerStats {
  hp: number;
  maxHp: number;
  ap: number;
  maxAp: number;
  moveSpeed: number;     // m/s
  dodgeDuration: number; // seconds of i-frames
  dodgeSpeed: number;    // m/s during dodge
  dodgeCooldown: number; // seconds before next dodge
  radius: number;        // collider radius (meters)
}

export const DEFAULT_PLAYER_STATS: PlayerStats = {
  hp: 100,
  maxHp: 100,
  ap: 4,
  maxAp: 4,
  moveSpeed: 6,
  dodgeDuration: 0.18,
  dodgeSpeed: 18,
  dodgeCooldown: 0.45,
  radius: 0.5,
};

export class Player {
  readonly root: TransformNode;
  /** Container for all visible body primitives — pivoted for dodge lean. */
  readonly torsoPivot: TransformNode;
  /** Primary body mesh (tapered torso). Acts as the shadow caster + hit target. */
  readonly body: Mesh;
  readonly bodyMat: StandardMaterial;
  /** Head sphere. */
  readonly head: Mesh;
  /** Shoulder pivot for the sword arm so we can animate the swing. */
  readonly swordArm: TransformNode;
  /** Off-hand arm — static. */
  readonly offArm: Mesh;
  /** Sword mesh — parented to swordArm. */
  readonly sword: Mesh;
  /** Sword material — exposed so main.ts can ramp emissive with Tempo. Assigned in ctor. */
  readonly swordMat!: StandardMaterial;
  readonly aimPivot: TransformNode;
  readonly aimMarker: Mesh;
  readonly footRing: Mesh;
  readonly footRingMat: StandardMaterial;
  /** Base emissive color of the foot ring — restored after dodge brightens it. */
  readonly footRingBaseEmissive: Color3;
  readonly aimLine: LinesMesh;
  stats: PlayerStats;
  private aimLinePulse = 0;
  /** Decays from 1 to 0 during a melee swing — drives the sword arm rotation. */
  swingTimer = 0;
  swingDuration = 0.22;
  /** Run cycle clock for the walk bob on the torso + arm sway. */
  private locoClock = 0;
  /**
   * Cast-animation timer for non-melee cards. Counts down from castDuration.
   * `castKind` chooses which animation branch runs in tickAnim:
   *  - "bolt": off-arm thrusts forward + slight torso pitch (evokes "shoot a bolt")
   *  - "dash": sword arm sweeps back for the follow-through pose during the dash
   */
  castTimer = 0;
  castDuration = 0.32;
  castKind: "bolt" | "dash" | null = null;
  /**
   * Target yaw for the aim pivot. faceTowards() updates this; tickAnim slerps
   * the actual aimPivot.rotation.y toward it, so the body rotates smoothly
   * instead of snapping. Cards that need an instant snap (Dash) call
   * `snapFacingNextFrame()` to bypass the slerp for the next tick.
   */
  private facingYawTarget = 0;
  private snapFacing = true; // true on first frame so spawn pose is exact

  // Live state
  hp: number;
  ap: number;
  isDodging = false;
  dodgeTimer = 0;
  dodgeCooldownTimer = 0;
  dodgeDir = new Vector3(0, 0, 1);
  facing = new Vector3(0, 0, 1);

  constructor(scene: Scene, shadow: ShadowGenerator, stats: PlayerStats = DEFAULT_PLAYER_STATS) {
    this.stats = { ...stats };
    this.hp = stats.maxHp;
    this.ap = stats.maxAp;

    this.root = new TransformNode("playerRoot", scene);
    this.root.position = new Vector3(0, 0, 0);

    // aimPivot gets created below, but we need it to exist before the torsoPivot so
    // we can parent visible body parts under it. Create the aimPivot first here —
    // the subsequent `this.aimPivot = new TransformNode(...)` is now pure
    // re-assignment instead of first creation.
    this.aimPivot = new TransformNode("playerAimPivot", scene);
    this.aimPivot.parent = this.root;

    // torsoPivot sits at the hip and hosts everything that leans when dodging
    // — body, head, arms, sword. Parented to aimPivot so the humanoid faces
    // whatever direction the player is aiming. The foot ring + aim marker stay
    // on `root` so they ignore the lean but still move with the player.
    this.torsoPivot = new TransformNode("playerTorsoPivot", scene);
    this.torsoPivot.parent = this.aimPivot;
    this.torsoPivot.position.set(0, 0, 0);

    // Tapered torso — wider at the chest than the hip, reads as a humanoid figure
    // rather than a block. 1.15m tall; head sits on top, arms hang off the sides.
    this.body = MeshBuilder.CreateCylinder(
      "playerTorso",
      { diameterTop: stats.radius * 1.7, diameterBottom: stats.radius * 1.35, height: 1.15, tessellation: 14 },
      scene,
    );
    this.body.position.set(0, 0.95, 0);
    this.body.parent = this.torsoPivot;

    const mat = new StandardMaterial("playerMat", scene);
    mat.diffuseColor = new Color3(0.85, 0.78, 0.45);
    mat.specularColor = new Color3(0.1, 0.1, 0.1);
    mat.emissiveColor = new Color3(0.05, 0.05, 0.02);
    applyPlayerRim(mat);
    this.body.material = mat;
    this.bodyMat = mat;
    shadow.addShadowCaster(this.body);

    // Small head sphere on top of the torso.
    this.head = MeshBuilder.CreateSphere(
      "playerHead",
      { diameter: 0.55, segments: 14 },
      scene,
    );
    this.head.position.set(0, 1.78, 0);
    this.head.parent = this.torsoPivot;
    const headMat = new StandardMaterial("playerHeadMat", scene);
    headMat.diffuseColor = new Color3(0.92, 0.82, 0.55);
    headMat.specularColor = new Color3(0.08, 0.08, 0.08);
    applyPlayerRim(headMat);
    this.head.material = headMat;
    shadow.addShadowCaster(this.head);

    // Off-hand arm — a simple box that hangs off the left shoulder.
    this.offArm = MeshBuilder.CreateBox(
      "playerOffArm",
      { width: 0.22, height: 0.9, depth: 0.22 },
      scene,
    );
    this.offArm.position.set(-stats.radius * 1.15, 1.05, 0);
    this.offArm.parent = this.torsoPivot;
    const armMat = new StandardMaterial("playerArmMat", scene);
    armMat.diffuseColor = new Color3(0.7, 0.62, 0.35);
    armMat.specularColor = new Color3(0.08, 0.08, 0.08);
    applyPlayerRim(armMat);
    this.offArm.material = armMat;
    shadow.addShadowCaster(this.offArm);

    // Sword arm: a pivot at the shoulder, rotated around X on melee swings. The
    // arm hangs off the pivot; the sword hangs off the end of the arm.
    this.swordArm = new TransformNode("playerSwordArm", scene);
    this.swordArm.parent = this.torsoPivot;
    this.swordArm.position.set(stats.radius * 1.15, 1.45, 0);

    const swordArmMesh = MeshBuilder.CreateBox(
      "playerSwordArmMesh",
      { width: 0.22, height: 0.9, depth: 0.22 },
      scene,
    );
    // Offset down so the arm hangs from the shoulder pivot (origin at top).
    swordArmMesh.position.set(0, -0.42, 0);
    swordArmMesh.parent = this.swordArm;
    swordArmMesh.material = armMat;
    shadow.addShadowCaster(swordArmMesh);

    // Sword: thin elongated box extending from the hand down (on a resting arm).
    this.sword = MeshBuilder.CreateBox(
      "playerSword",
      { width: 0.12, height: 1.35, depth: 0.06 },
      scene,
    );
    this.sword.position.set(0, -1.55, 0); // sticks out below the hand
    this.sword.parent = this.swordArm;
    const swordMat = new StandardMaterial("playerSwordMat", scene);
    swordMat.diffuseColor = new Color3(0.85, 0.85, 0.9);
    swordMat.specularColor = new Color3(0.4, 0.4, 0.5);
    swordMat.emissiveColor = new Color3(0.25, 0.22, 0.1);
    this.sword.material = swordMat;
    this.swordMat = swordMat;
    shadow.addShadowCaster(this.sword);

    // aimPivot is the parent node for anything that should rotate with player.facing —
    // attack arc preview/flash, telegraphs, etc. It was already created above so the
    // torsoPivot could attach to it. This block used to re-create the pivot but that
    // leaked the earlier node; we simply reuse it now.

    // Aim marker on the ground (reticle) — torus + inner dot for clear cursor read
    this.aimMarker = MeshBuilder.CreateTorus(
      "aimMarker",
      { diameter: 1.4, thickness: 0.09, tessellation: 28 },
      scene,
    );
    const aimMat = new StandardMaterial("aimMat", scene);
    aimMat.diffuseColor = new Color3(1.0, 0.85, 0.4);
    aimMat.emissiveColor = new Color3(0.85, 0.55, 0.15);
    aimMat.disableLighting = true;
    this.aimMarker.material = aimMat;
    this.aimMarker.position = new Vector3(0, 0.05, 2);

    const aimDot = MeshBuilder.CreateDisc(
      "aimDot",
      { radius: 0.12, tessellation: 16 },
      scene,
    );
    aimDot.rotation.x = Math.PI / 2;
    aimDot.material = aimMat;
    aimDot.parent = this.aimMarker;
    aimDot.position = new Vector3(0, 0, 0);

    // Inner crosshair + outer tick rim on the reticle — much easier to spot at a glance.
    const aimInner = MeshBuilder.CreateTorus(
      "aimInner",
      { diameter: 0.45, thickness: 0.04, tessellation: 20 },
      scene,
    );
    aimInner.material = aimMat;
    aimInner.parent = this.aimMarker;

    // Player foot ring: thin glowing circle at base so the hero reads against the floor.
    this.footRing = MeshBuilder.CreateTorus(
      "footRing",
      { diameter: 1.5, thickness: 0.055, tessellation: 36 },
      scene,
    );
    const ringMat = new StandardMaterial("footRingMat", scene);
    ringMat.diffuseColor = new Color3(0.3, 0.7, 1.0);
    ringMat.emissiveColor = new Color3(0.25, 0.6, 0.95);
    ringMat.disableLighting = true;
    ringMat.alpha = 0.7;
    this.footRing.material = ringMat;
    this.footRing.position = new Vector3(0, 0.04, 0);
    this.footRing.parent = this.root;
    this.footRingMat = ringMat;
    this.footRingBaseEmissive = ringMat.emissiveColor.clone();

    // Aim line: single-segment line from player base to reticle. Updated each frame.
    this.aimLine = MeshBuilder.CreateLines(
      "aimLine",
      {
        points: [new Vector3(0, 0.07, 0), new Vector3(0, 0.07, 1)],
        updatable: true,
        colors: [new Color4(1, 0.85, 0.4, 0.8), new Color4(1, 0.85, 0.4, 0.2)],
      },
      scene,
    );
    this.aimLine.isPickable = false;
    this.aimLine.alwaysSelectAsActiveMesh = true;
  }

  /** Trigger a melee swing animation — called from CombatManager.triggerFlash. */
  triggerSwing(): void {
    this.swingTimer = this.swingDuration;
  }

  /**
   * Trigger a non-melee cast animation. Replaces any in-flight cast. Melee
   * swings use `triggerSwing` directly; this is for Bolt / Dash (and future
   * projectile or dash-like cards) to get their own character pose.
   */
  triggerCast(kind: "bolt" | "dash"): void {
    this.castKind = kind;
    this.castTimer = this.castDuration;
  }

  /**
   * World-space position of the off-hand "palm" — roughly where a Bolt leaves
   * the character during the cast animation. Used by CardCaster to pick a more
   * grounded spawn origin than the player's feet. Computed from the body mesh
   * world matrix + a local offset so it tracks torso lean and facing.
   */
  getOffHandWorld(out: Vector3): Vector3 {
    const m = this.offArm.getWorldMatrix();
    // The off-arm box is 0.9m tall with origin at its center (1.05m above root
    // locally); the "palm" is at the bottom tip, which is roughly -0.45 from
    // the mesh's local origin along Y. During the Bolt cast anim the arm
    // rotates forward, so world-space transform captures that pose.
    const localTip = new Vector3(0, -0.45, 0);
    Vector3.TransformCoordinatesToRef(localTip, m, out);
    return out;
  }

  /**
   * World-space position of the sword tip. Used by WeaponTrail to sample the
   * blade's motion during a swing. We compute it from the sword's world matrix
   * + a local offset down the blade (origin is at the hand, blade extends
   * toward -Y in local space) — cheaper than adding a dedicated TransformNode.
   */
  getSwordTipWorld(out: Vector3): Vector3 {
    const m = this.sword.getWorldMatrix();
    // Sword local origin sits at the hand; blade extends -Y to roughly -1.35/2 + -1.55 from center.
    // Local center of the blade already sits at (0,-1.55,0) because we positioned it there; the tip
    // is half the height below that, so ~-2.2 Y in the sword's local frame.
    const localTip = new Vector3(0, -2.22, 0);
    Vector3.TransformCoordinatesToRef(localTip, m, out);
    return out;
  }

  /** Is the sword currently mid-swing? Used to gate trail sample emission. */
  isSwinging(): boolean {
    return this.swingTimer > 0;
  }

  /**
   * Animate torso bob, sword swing, and dodge lean. Called once per frame from
   * PlayerController after the movement update. Inputs are the movement delta
   * for loco-bob tuning and the dodge flag for the body lean.
   */
  tickAnim(dt: number, moving: boolean): void {
    // Slerp the body yaw toward the facing target. Snap on the first frame
    // (or whenever a card requested it) so the start pose is exact; otherwise
    // ease so mouse aiming doesn't snap-rotate the character.
    if (this.snapFacing) {
      this.aimPivot.rotation.y = this.facingYawTarget;
      this.snapFacing = false;
    } else {
      let diff = this.facingYawTarget - this.aimPivot.rotation.y;
      // Wrap to [-π, π] so we always rotate the short way.
      diff = ((diff + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      this.aimPivot.rotation.y += diff * dampCoeff(18, dt);
    }

    // Advance the run-cycle clock when moving so the bob scales with activity.
    // Detect step beats (two per walk cycle, at multiples of π) by watching for
    // a floor(locoClock/π) change — emits a PLAYER_STEP event for FX consumers
    // like StepDust. Only fires while moving so idle dust doesn't puff forever.
    const prevLoco = this.locoClock;
    if (moving) this.locoClock += dt * 8;
    if (moving && !this.isDodging) {
      const prevStep = Math.floor(prevLoco / Math.PI);
      const currStep = Math.floor(this.locoClock / Math.PI);
      if (currStep !== prevStep) {
        events.emit("PLAYER_STEP", {
          x: this.root.position.x,
          z: this.root.position.z,
        });
      }
    }
    // Decay locoClock continuity when idle so we settle back to upright.
    const bob = moving ? Math.sin(this.locoClock) * 0.03 : 0;
    this.torsoPivot.position.y = bob;

    // Resting arm sway — ~2Hz shoulder twist on both arms.
    if (moving) {
      const sway = Math.sin(this.locoClock) * 0.35;
      this.offArm.rotation.x = sway;
    } else {
      this.offArm.rotation.x = 0;
    }

    // Sword swing: ease-out rotation forward then recover. Swing goes around
    // the shoulder's local X axis (overhead → down), scaled to ~120° at peak.
    // Cast animations ride on top of the resting pose, so we compute a base
    // sword-arm rotation first and let branches below add to it.
    let swordArmRot = 0;
    if (this.swingTimer > 0) {
      this.swingTimer = Math.max(0, this.swingTimer - dt);
      const t = 1 - this.swingTimer / this.swingDuration;
      // Cubic ease-out — fast start, slow settle.
      const eased = 1 - Math.pow(1 - t, 3);
      // Peak near t=0.4, decay back after. Easier to read as a swing than a hold.
      const swing = Math.sin(eased * Math.PI);
      swordArmRot = -Math.PI * 0.72 * swing;
    } else {
      // Resting: arm trails behind body slightly while moving.
      swordArmRot = moving ? Math.sin(this.locoClock + Math.PI) * 0.25 : 0;
    }

    // Cast animations (non-melee cards). Drives the off-arm, sword arm, and
    // torso lean together for a cohesive pose. Progress eases in quickly and
    // releases over the full duration so the moment is readable.
    let offArmCastRot = 0;
    let torsoCastPitch = 0;
    if (this.castTimer > 0) {
      this.castTimer = Math.max(0, this.castTimer - dt);
      const t = 1 - this.castTimer / this.castDuration;       // 0 → 1
      // sin(tπ) peaks at 0.5 — gives a "raise then release" motion rather than a snap-and-hold.
      const pulse = Math.sin(t * Math.PI);
      if (this.castKind === "bolt") {
        // Off-hand thrusts forward: arm rotates around X (down-arm → forward
        // along +Z local), peaks at ~-115° (hand pointing forward), recovers.
        offArmCastRot = -Math.PI * 0.65 * pulse;
        // Sword arm counterbalances slightly back.
        swordArmRot += Math.PI * 0.15 * pulse;
        // Gentle torso pitch forward into the cast.
        torsoCastPitch = 0.18 * pulse;
      } else if (this.castKind === "dash") {
        // Dash prep pose: sword swept up-and-back for a follow-through read
        // (the dash itself teleports the player; this sells it as a motion).
        swordArmRot += Math.PI * 0.55 * pulse;
        // Off-arm trails behind.
        offArmCastRot = Math.PI * 0.35 * pulse;
      }
      if (this.castTimer === 0) this.castKind = null;
    }
    this.swordArm.rotation.x = swordArmRot;

    // Compose off-arm pose: cast overrides walk sway, otherwise use walk sway.
    if (this.castTimer > 0) {
      this.offArm.rotation.x = offArmCastRot;
    }

    // Dodge lean — tilt forward into the dodge direction. Cast pitch adds to
    // the dodge lean so a dash-cast reads as "explode forward". Implemented as
    // a simple X pitch scaled by the dodge fraction + cast pulse.
    if (this.isDodging) {
      // Dash card routes through here via its post-cast i-frames; deepen the
      // lean a touch during a dash-cast so the pose reads dramatic.
      const leanAmount = 0.35 + (this.castKind === "dash" ? 0.18 : 0);
      this.torsoPivot.rotation.x = leanAmount + torsoCastPitch;
    } else {
      this.torsoPivot.rotation.x = torsoCastPitch;
    }
  }

  /** Faces the given world point (XZ only). */
  faceTowards(worldPoint: Vector3) {
    const dx = worldPoint.x - this.root.position.x;
    const dz = worldPoint.z - this.root.position.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return;
    this.facing.x = dx / len;
    this.facing.z = dz / len;
    // Store the target yaw — actual rotation is slerped in tickAnim each
    // frame so the body doesn't snap with mouse movement. snapFacing forces
    // an immediate apply for the next frame (used at spawn + by Dash).
    this.facingYawTarget = Math.atan2(this.facing.x, this.facing.z);
    if (this.snapFacing) {
      this.aimPivot.rotation.y = this.facingYawTarget;
    }
  }

  /**
   * Mark the next tickAnim to snap the body yaw instantly to the facing target
   * instead of slerping. Used by Dash so the body jumps to the new direction
   * the moment the dash teleports — slerping over 50ms in that situation
   * would look like the body got left behind.
   */
  snapFacingNextFrame(): void {
    this.snapFacing = true;
  }

  /**
   * Set the body's facing direction immediately. Used at spawn / room
   * transitions where snapping is correct (the player isn't doing a smooth
   * turn — they're being placed). XZ is normalized internally.
   */
  setFacingDirection(fx: number, fz: number): void {
    const len = Math.hypot(fx, fz);
    if (len < 1e-4) return;
    this.facing.x = fx / len;
    this.facing.z = fz / len;
    this.facingYawTarget = Math.atan2(this.facing.x, this.facing.z);
    this.aimPivot.rotation.y = this.facingYawTarget;
    this.snapFacing = true;
  }

  setAimMarker(point: Vector3 | null) {
    this.aimMarker.isVisible = !!point;
    this.aimLine.isVisible = !!point;
    if (point) {
      this.aimMarker.position.x = point.x;
      this.aimMarker.position.z = point.z;
      this.aimMarker.position.y = 0.05;

      // Rebuild the aim line each frame from player base to the reticle. MeshBuilder rebuilds
      // vertex buffers in-place when `instance` is passed, so no per-frame allocation of mesh.
      const px = this.root.position.x;
      const pz = this.root.position.z;
      MeshBuilder.CreateLines(
        "aimLine",
        {
          points: [new Vector3(px, 0.07, pz), new Vector3(point.x, 0.07, point.z)],
          instance: this.aimLine,
        },
        undefined,
      );

      // Pulse the reticle so it stays findable during fast combat.
      this.aimLinePulse += 0.18;
      const pulse = 0.75 + 0.25 * Math.sin(this.aimLinePulse);
      this.aimMarker.scaling.x = this.aimMarker.scaling.z = pulse * 0.95 + 0.1;
    }
  }

  /** Restore live state to defaults — for in-place run restart. */
  reset(): void {
    this.hp = this.stats.maxHp;
    this.ap = this.stats.maxAp;
    this.isDodging = false;
    this.dodgeTimer = 0;
    this.dodgeCooldownTimer = 0;
    this.dodgeDir.set(0, 0, 1);
    this.facing.set(0, 0, 1);
    this.root.position.set(0, 0, 0);
    this.aimPivot.rotation.y = 0;
    this.bodyMat.alpha = 1;
    this.footRingMat.emissiveColor.copyFrom(this.footRingBaseEmissive);
    this.swingTimer = 0;
    this.castTimer = 0;
    this.castKind = null;
    this.locoClock = 0;
    this.torsoPivot.rotation.x = 0;
    this.torsoPivot.position.y = 0;
    this.swordArm.rotation.x = 0;
    this.offArm.rotation.x = 0;
    // Reset facing yaw target so the in-place restart pose matches the
    // freshly-set aimPivot.rotation.y (which is 0 above).
    this.facingYawTarget = 0;
    this.snapFacing = true;
  }

  dispose() {
    this.aimLine.dispose();
    this.footRing.dispose();
    this.aimMarker.dispose();
    this.sword.dispose();
    this.swordArm.dispose();
    this.offArm.dispose();
    this.head.dispose();
    this.body.dispose();
    this.torsoPivot.dispose();
    this.aimPivot.dispose();
    this.root.dispose();
  }
}
