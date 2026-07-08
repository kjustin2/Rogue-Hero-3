import type { Ctx } from "./ctx";
import type { Hud } from "../ui/hud";

/** Event-driven training sequence. Steps advance as the player performs each action. */
const STEPS: string[] = [
  "Move with W A S D  ·  (or the left stick)",
  "Aim with the mouse and click to ATTACK the husk",
  "Press SPACE to DODGE — roll through an attack for a PERFECT DODGE",
  "Cast a card with 1",
  "Attacks build TEMPO — you're hot now, press F to CRASH!",
];

/** The verb each step certifies — the tutorial-correctness oracle reads this off
 *  the bus (via TUTORIAL_STEP) and diffs it against the run's required verbs. */
export const TUTORIAL_VERBS: string[] = ["move", "attack", "dodge", "card", "crash"];

export class Tutorial {
  active = false;
  onComplete: () => void = () => {};
  /** Read by the tutorial-correctness oracle (debug.tutorial()). */
  get currentStep(): number { return this.step; }
  get done(): boolean { return this.doneTimer >= 0; }
  get taughtSoFar(): string[] { return TUTORIAL_VERBS.slice(0, Math.max(0, this.step + (this.doneTimer >= 0 ? 1 : 0))); }
  get objective(): string { return this.doneTimer >= 0 ? "TRAINING COMPLETE" : (STEPS[this.step] ?? ""); }
  get verb(): string { return TUTORIAL_VERBS[this.step] ?? ""; }
  private step = -1;
  private moved = 0;
  private doneTimer = -1;
  private lastX = 0;
  private lastZ = 0;
  private flags = { hit: false, dodged: false, cast: false, crashed: false };

  constructor(private ctx: Ctx, private hud: Hud) {
    ctx.events.on("ENEMY_HIT", () => { if (this.active) this.flags.hit = true; });
    ctx.events.on("DODGE", () => { if (this.active) this.flags.dodged = true; });
    ctx.events.on("CARD_CAST", () => { if (this.active) this.flags.cast = true; });
    ctx.events.on("CRASH", () => { if (this.active) this.flags.crashed = true; });
  }

  start(): void {
    this.active = true;
    this.step = 0;
    this.moved = 0;
    this.doneTimer = -1;
    this.movedFired = false;
    this.flags = { hit: false, dodged: false, cast: false, crashed: false };
    this.lastX = this.ctx.player.pos.x;
    this.lastZ = this.ctx.player.pos.z;
    this.hud.setObjective(`TRAINING  ·  ${STEPS[0]}`);
    this.ctx.events.emit("TUTORIAL_STEP", { index: 0, verb: TUTORIAL_VERBS[0], taught: TUTORIAL_VERBS[0] });
  }
  private movedFired = false;

  stop(): void {
    this.active = false;
    this.hud.setObjective(null);
  }

  update(dt: number): void {
    if (!this.active) return;
    if (this.doneTimer >= 0) {
      this.doneTimer -= dt;
      if (this.doneTimer <= 0) {
        this.stop();
        this.onComplete();
      }
      return;
    }

    const p = this.ctx.player.pos;
    this.moved += Math.hypot(p.x - this.lastX, p.z - this.lastZ);
    this.lastX = p.x;
    this.lastZ = p.z;
    // Make step 0 (move) observable to the coverage bus — it otherwise advanced
    // on a silent distance threshold, invisible to coverage()/the oracle.
    if (!this.movedFired && this.moved > 3) { this.movedFired = true; this.ctx.events.emit("MOVE", {}); }

    let advance = false;
    switch (this.step) {
      case 0: advance = this.moved > 3; break;
      case 1: advance = this.flags.hit; break;
      case 2: advance = this.flags.dodged; break;
      case 3: advance = this.flags.cast; break;
      case 4: advance = this.flags.crashed; break;
    }
    if (!advance) return;

    this.step++;
    if (this.step >= STEPS.length) {
      this.hud.setObjective("TRAINING COMPLETE  ·  The Rift awaits.");
      this.doneTimer = 2.6;
      return;
    }
    // Entering the crash lesson: heat the player so CRASH is available immediately.
    if (this.step === 4) this.ctx.tempo.gain(95);
    this.hud.setObjective(`TRAINING  ·  ${STEPS[this.step]}`);
    this.ctx.events.emit("TUTORIAL_STEP", { index: this.step, verb: TUTORIAL_VERBS[this.step], taught: TUTORIAL_VERBS[this.step] });
  }
}
