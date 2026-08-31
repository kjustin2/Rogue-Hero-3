import type { CinematicBeat, CinematicSequence } from "./types";

export interface CinematicHooks {
  run(beat: CinematicBeat): void;
  finish(sequence: CinematicSequence, skipped: boolean): void;
}

/** Deterministic, dt-driven cinematic timeline. No wall-clock timers and skip
 * always applies the sequence finalizer exactly once. */
export class CinematicDirector {
  private sequence: CinematicSequence | null = null;
  private t = 0;
  private next = 0;
  private endAt = 0;

  constructor(private readonly hooks: CinematicHooks) {}

  play(sequence: CinematicSequence): void {
    if (this.sequence) this.skip();
    this.sequence = sequence;
    this.t = 0;
    this.next = 0;
    this.endAt = sequence.duration;
    this.flushDue();
  }

  update(dt: number): void {
    if (!this.sequence) return;
    this.t = Math.min(this.endAt, this.t + Math.max(0, dt));
    this.flushDue();
    if (this.t >= this.endAt) this.complete(false);
  }

  skip(): void {
    if (!this.sequence) return;
    const seq = this.sequence;
    if (seq.skipTo !== undefined && this.t < seq.skipTo) {
      this.t = seq.skipTo;
      this.flushDue();
      this.endAt = Math.min(seq.duration, seq.skipTo + (seq.skipDuration ?? 0.6));
      return;
    }
    while (this.next < seq.beats.length) this.hooks.run(seq.beats[this.next++]);
    this.complete(true);
  }

  cancel(): void {
    this.sequence = null;
    this.t = 0;
    this.next = 0;
    this.endAt = 0;
  }

  state(): { active: boolean; id: string | null; time: number; duration: number } {
    return { active: !!this.sequence, id: this.sequence?.id ?? null, time: this.t, duration: this.endAt };
  }

  private flushDue(): void {
    const seq = this.sequence;
    if (!seq) return;
    while (this.next < seq.beats.length && seq.beats[this.next].at <= this.t) {
      this.hooks.run(seq.beats[this.next++]);
    }
  }

  private complete(skipped: boolean): void {
    const seq = this.sequence;
    if (!seq) return;
    this.sequence = null;
    this.t = 0;
    this.next = 0;
    this.endAt = 0;
    seq.onFinish?.();
    this.hooks.finish(seq, skipped);
  }
}
