import { describe, it, expect } from "vitest";
import { EventBus } from "./events";

describe("EventBus", () => {
  it("delivers the payload to a subscriber", () => {
    const bus = new EventBus();
    let got: unknown = null;
    bus.on("KILL", (p) => (got = p));
    bus.emit("KILL", { x: 1, z: 2, kind: "husk" });
    expect(got).toEqual({ x: 1, z: 2, kind: "husk" });
  });

  it("counts emits per event", () => {
    const bus = new EventBus();
    bus.emit("DODGE", {});
    bus.emit("DODGE", {});
    bus.emit("HEAL", { amount: 5 });
    expect(bus.counts.DODGE).toBe(2);
    expect(bus.counts.HEAL).toBe(1);
    expect(bus.counts.KILL).toBeUndefined();
  });

  it("on() returns an unsubscribe that stops delivery", () => {
    const bus = new EventBus();
    let n = 0;
    const off = bus.on("DODGE", () => n++);
    bus.emit("DODGE", {});
    off();
    bus.emit("DODGE", {});
    expect(n).toBe(1);
  });

  it("fans out to multiple subscribers", () => {
    const bus = new EventBus();
    let a = 0, b = 0;
    bus.on("DODGE", () => a++);
    bus.on("DODGE", () => b++);
    bus.emit("DODGE", {});
    expect([a, b]).toEqual([1, 1]);
  });
});
