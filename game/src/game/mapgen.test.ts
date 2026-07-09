import { describe, it, expect } from "vitest";
import { generatePlan } from "./mapgen";

// generatePlan is pure over (seed, depth) — the resume + daily-seed contract.
// save-determinism.mjs gates cross-reload purity live; this is the fast in-process unit.
describe("generatePlan", () => {
  it("is deterministic for a fixed (seed, depth)", () => {
    const a = generatePlan(12345, 3);
    const b = generatePlan(12345, 3);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("different seeds produce different maps", () => {
    expect(JSON.stringify(generatePlan(1, 0))).not.toBe(JSON.stringify(generatePlan(2, 0)));
  });

  it("every fork offers 1–3 selectable nodes (no empty fork = no soft-lock)", () => {
    const plan = generatePlan(777, 5);
    expect(plan.forks.length).toBeGreaterThan(0);
    for (const fork of plan.forks) {
      expect(fork.length).toBeGreaterThanOrEqual(1);
      expect(fork.length).toBeLessThanOrEqual(3);
    }
  });

  it("the terminal fork holds a boss (victory is reachable)", () => {
    const plan = generatePlan(777, 5);
    const last = plan.forks[plan.forks.length - 1];
    expect(last.some((n) => n.kind === "boss")).toBe(true);
  });

  it("carries the requested depth", () => {
    expect(generatePlan(3, 7).depth).toBe(7);
  });
});
