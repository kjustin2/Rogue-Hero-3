import { describe, it, expect } from "vitest";
import { EventBus } from "../core/events";
import { Tempo, ZONES, CRASH_THRESHOLD } from "./tempo";

const mk = () => {
  const bus = new EventBus();
  const zones: string[] = [];
  bus.on("TEMPO_ZONE", (p) => zones.push(p.zone));
  return { t: new Tempo(bus), zones };
};

describe("Tempo", () => {
  it("starts at rest in the flowing zone", () => {
    const { t } = mk();
    expect(t.value).toBe(50);
    expect(t.zone.zone).toBe("flowing");
  });

  it("gain/drain clamp to [0,100]", () => {
    const { t } = mk();
    t.gain(999); expect(t.value).toBe(100);
    t.drain(999); expect(t.value).toBe(0);
  });

  it("crossing a zone boundary emits TEMPO_ZONE (adjacent, ordered)", () => {
    const { t, zones } = mk();
    t.gain(25); // 50 → 75 = hot
    expect(zones).toContain("hot");
    t.gain(20); // 75 → 95 = critical
    expect(zones).toContain("critical");
    // zones only ever move to an ADJACENT zone per gain step (never skip up)
    const order = ZONES.map((z) => z.zone);
    for (let i = 1; i < zones.length; i++) {
      const a = order.indexOf(zones[i - 1]), b = order.indexOf(zones[i]);
      if (b > a) expect(b - a).toBeLessThanOrEqual(1);
    }
  });

  it("crashReady only at/above the crash threshold", () => {
    const { t } = mk();
    t.gain(CRASH_THRESHOLD - 50 - 1); expect(t.crashReady).toBe(false);
    t.gain(2); expect(t.crashReady).toBe(true);
  });

  it("crash resets to the resting value", () => {
    const { t } = mk();
    t.gain(50); // 100
    t.crash();
    expect(t.value).toBe(50);
  });

  it("crash to a raised floor (relic) respects the clamp", () => {
    const { t } = mk();
    t.gain(50);
    t.crash(70);
    expect(t.value).toBe(70);
  });
});
