import { events } from "../engine/EventBus";

/**
 * Per-room perfect-clear flag tracker. Records whether the player took any
 * damage / cast any cards / cleared in under 30 s. On `ROOM_CLEARED`, awards
 * shards (or whatever consumer reads) per flag earned.
 *
 * Flags reset on `loadNode` (called from main.ts).
 */
export class PerfectClear {
  noHit = true;
  noCardCast = true;
  startedAt = 0;

  constructor() {
    events.on("DAMAGE_TAKEN", () => { this.noHit = false; });
    events.on("CARD_PLAYED", () => { this.noCardCast = false; });
  }

  /** Reset on room entry. Call once after the new arena is in place. */
  beginRoom(): void {
    this.noHit = true;
    this.noCardCast = true;
    this.startedAt = performance.now();
  }

  /** Returns the number of flags satisfied. Caller awards shards from this. */
  evaluate(): { flags: string[]; shards: number } {
    const flags: string[] = [];
    if (this.noHit) flags.push("noHit");
    if (this.noCardCast) flags.push("noCardCast");
    if ((performance.now() - this.startedAt) < 30000) flags.push("under30s");
    return { flags, shards: flags.length };
  }
}
