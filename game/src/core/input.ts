import * as THREE from "three";

/**
 * Keyboard + mouse state with per-frame edge detection.
 * Call endFrame() once per tick after all consumers have read.
 */
export class Input {
  private held = new Set<string>();
  private pressedThisFrame = new Set<string>();
  /** Pointer in NDC (-1..1). */
  readonly pointer = new THREE.Vector2();
  mouseHeld = [false, false, false];
  mousePressed = [false, false, false];
  /** World-space point under the cursor on the ground plane. Updated by the game each frame. */
  readonly aimPoint = new THREE.Vector3();
  enabled = true;

  private ray = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", (e) => {
      // Space must never scroll or re-trigger a focused button mid-run
      if (e.code === "Space") e.preventDefault();
      if (e.repeat) return;
      this.held.add(e.code);
      this.pressedThisFrame.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.held.delete(e.code));
    window.addEventListener("blur", () => {
      this.held.clear();
      this.mouseHeld = [false, false, false];
    });
    window.addEventListener("pointermove", (e) => {
      this.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    });
    this.canvas.addEventListener("pointerdown", (e) => {
      if (e.button < 3) {
        this.mouseHeld[e.button] = true;
        this.mousePressed[e.button] = true;
      }
    });
    window.addEventListener("pointerup", (e) => {
      if (e.button < 3) this.mouseHeld[e.button] = false;
    });
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  down(code: string): boolean {
    return this.enabled && this.held.has(code);
  }

  pressed(code: string): boolean {
    return this.enabled && this.pressedThisFrame.has(code);
  }

  /** Re-projects the cursor onto the ground plane. Call once per frame before consumers. */
  updateAim(camera: THREE.Camera, planeY = 0): void {
    this.groundPlane.constant = -planeY;
    this.ray.setFromCamera(this.pointer, camera);
    const hit = new THREE.Vector3();
    if (this.ray.ray.intersectPlane(this.groundPlane, hit)) {
      this.aimPoint.copy(hit);
    }
  }

  endFrame(): void {
    this.pressedThisFrame.clear();
    this.mousePressed = [false, false, false];
  }
}
