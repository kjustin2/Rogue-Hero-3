import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents";
import { KeyboardEventTypes } from "@babylonjs/core/Events/keyboardEvents";
import { Mesh } from "@babylonjs/core/Meshes/mesh";

export interface FrameInput {
  /** Camera-relative move direction on the ground plane, length 0–1 */
  move: Vector3;
  /** True the frame the dodge key was pressed */
  dodgePressed: boolean;
  /** True the frame LMB was pressed — plays the currently-selected card */
  attackPressed: boolean;
  /** True while LMB is held (for future channel cards) */
  attackHeld: boolean;
  /** True the frame RMB was pressed — cycles the selected hand slot */
  cycleSelectedPressed: boolean;
  /** 1-based card slots pressed this frame (1..4) — selects that slot (does NOT play) */
  selectSlotPressed: number[];
  /** True the frame the manual crash key (F) was pressed */
  crashPressed: boolean;
  /** True the frame the cycle-target key (Q or Tab) was pressed */
  cycleTargetPressed: boolean;
  /** World-space aim point on the floor (or null if pointer is off the floor) */
  aimPoint: Vector3 | null;
}

export class InputController {
  private keys = new Set<string>();
  private dodgeQueued = false;
  private attackQueuedDown = false;
  private attackHeld = false;
  private cycleQueued = false;
  private crashQueued = false;
  private cycleTargetQueued = false;
  private cardQueue: number[] = [];

  private aimPoint: Vector3 | null = null;
  private floorRef: Mesh | null = null;

  constructor(private scene: Scene) {
    scene.onKeyboardObservable.add((kb) => {
      const key = kb.event.key.toLowerCase();
      if (kb.type === KeyboardEventTypes.KEYDOWN) {
        if (!this.keys.has(key)) {
          // edge-triggered actions
          if (key === " " || key === "shift") this.dodgeQueued = true;
          if (key === "f") this.crashQueued = true;
          if (key === "q" || key === "tab") {
            this.cycleTargetQueued = true;
            // Tab would otherwise move browser focus off the canvas.
            if (key === "tab") kb.event.preventDefault();
          }
          if (key === "1" || key === "2" || key === "3" || key === "4") {
            this.cardQueue.push(parseInt(key, 10));
          }
        }
        this.keys.add(key);
      } else if (kb.type === KeyboardEventTypes.KEYUP) {
        this.keys.delete(key);
      }
    });

    scene.onPointerObservable.add((pi) => {
      if (pi.type === PointerEventTypes.POINTERDOWN) {
        if (pi.event.button === 0) {
          this.attackQueuedDown = true;
          this.attackHeld = true;
        } else if (pi.event.button === 2) {
          this.cycleQueued = true;
        }
      } else if (pi.type === PointerEventTypes.POINTERUP && pi.event.button === 0) {
        this.attackHeld = false;
      } else if (pi.type === PointerEventTypes.POINTERMOVE) {
        this.updateAim();
      }
    });

    // Kill the browser's RMB context menu on the game canvas so RMB can be used for gameplay.
    const canvas = scene.getEngine().getRenderingCanvas();
    if (canvas) canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  setFloorReference(floor: Mesh) {
    this.floorRef = floor;
  }

  private updateAim(): void {
    if (!this.floorRef) {
      this.aimPoint = null;
      return;
    }
    const pick = this.scene.pick(this.scene.pointerX, this.scene.pointerY, (m) => m === this.floorRef);
    if (pick && pick.hit && pick.pickedPoint) {
      this.aimPoint = pick.pickedPoint;
    } else {
      // Pick missed — cursor is over a wall, sky, or UI. Drop the stale aim
      // so the reticle disappears rather than freezing at the last good point.
      this.aimPoint = null;
    }
  }

  /** Drain queued one-shot inputs and read held state. Camera is needed to map WASD to camera-relative move. */
  consume(cameraForward: Vector3): FrameInput {
    // Build camera-relative basis on the XZ plane
    const fwd = new Vector3(cameraForward.x, 0, cameraForward.z);
    const fwdLen = Math.hypot(fwd.x, fwd.z);
    if (fwdLen > 1e-4) {
      fwd.x /= fwdLen;
      fwd.z /= fwdLen;
    } else {
      fwd.x = 0;
      fwd.z = 1;
    }
    // right = fwd rotated -90deg around Y: (z, -x)
    const rightX = fwd.z;
    const rightZ = -fwd.x;

    let mx = 0;
    let mz = 0;
    if (this.keys.has("w") || this.keys.has("arrowup")) {
      mx += fwd.x;
      mz += fwd.z;
    }
    if (this.keys.has("s") || this.keys.has("arrowdown")) {
      mx -= fwd.x;
      mz -= fwd.z;
    }
    if (this.keys.has("d") || this.keys.has("arrowright")) {
      mx += rightX;
      mz += rightZ;
    }
    if (this.keys.has("a") || this.keys.has("arrowleft")) {
      mx -= rightX;
      mz -= rightZ;
    }
    const ml = Math.hypot(mx, mz);
    if (ml > 1) {
      mx /= ml;
      mz /= ml;
    }

    const out: FrameInput = {
      move: new Vector3(mx, 0, mz),
      dodgePressed: this.dodgeQueued,
      attackPressed: this.attackQueuedDown,
      attackHeld: this.attackHeld,
      cycleSelectedPressed: this.cycleQueued,
      selectSlotPressed: this.cardQueue.slice(),
      crashPressed: this.crashQueued,
      cycleTargetPressed: this.cycleTargetQueued,
      aimPoint: this.aimPoint ? this.aimPoint.clone() : null,
    };

    this.dodgeQueued = false;
    this.attackQueuedDown = false;
    this.cycleQueued = false;
    this.crashQueued = false;
    this.cycleTargetQueued = false;
    this.cardQueue.length = 0;

    // Refresh aim each frame even if mouse didn't move (camera might have)
    this.updateAim();

    return out;
  }
}
