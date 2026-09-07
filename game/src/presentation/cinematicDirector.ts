import type { CinematicBeat, CinematicSequence } from "./types";

export interface CinematicHooks {
  run(beat: CinematicBeat): void;
  finish(sequence: CinematicSequence, skipped: boolean): void;
}

/** One game-time timeline, with an atomic finalizer shared by finish and skip. */
export class CinematicDirector {
  private sequence: CinematicSequence | null = null;
  private t = 0;
  private next = 0;
  constructor(private readonly hooks: CinematicHooks) {}

  play(sequence: CinematicSequence): void {
    if (this.sequence) this.complete(true);
    this.sequence = { ...sequence, beats: [...sequence.beats].sort((a, b) => a.at - b.at) };
    this.t = this.next = 0;
    this.flushDue();
  }

  update(dt: number): void {
    const seq = this.sequence;
    if (!seq) return;
    this.t = Math.min(seq.duration, this.t + Math.max(0, dt));
    this.flushDue();
    if (this.sequence === seq && this.t >= seq.duration) this.complete(false);
  }

  // The finalizer establishes a playable scene. Replaying every skipped beat
  // would fire landing effects, sounds and camera cuts on the same frame.
  skip(): void { this.complete(true); }
  cancel(): void { this.sequence = null; this.t = this.next = 0; }
  state(): { active: boolean; id: string | null; time: number; duration: number } {
    return { active: !!this.sequence, id: this.sequence?.id ?? null, time: this.t, duration: this.sequence?.duration ?? 0 };
  }
  private flushDue(): void {
    const seq = this.sequence;
    if (!seq) return;
    while (this.sequence === seq && this.next < seq.beats.length && seq.beats[this.next].at <= this.t) {
      this.hooks.run(seq.beats[this.next++]);
    }
  }
  private complete(skipped: boolean): void {
    const seq = this.sequence;
    if (!seq) return;
    this.cancel();
    this.hooks.finish(seq, skipped);
    seq.onFinish?.();
  }
}
