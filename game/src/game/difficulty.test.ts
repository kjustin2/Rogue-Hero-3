import { describe, it, expect } from "vitest";
import { difficultyFor, depthLevelLabels, MAX_DEPTH } from "./difficulty";

// The difficulty ladder is the "does it get harder properly" contract as a pure
// function. balance.mjs gates this live too; here it's a fast unit.
describe("difficultyFor", () => {
  it("depth 0 is the neutral baseline", () => {
    const d = difficultyFor(0);
    expect(d.enemyHpMult).toBe(1);
    expect(d.enemyDmgMult).toBe(1);
    expect(d.bossHpMult).toBe(1);
    expect(d.healMult).toBe(1);
    expect(d.extraEnemies).toBe(0);
    expect(d.labels).toHaveLength(0);
  });

  it("monotonic non-decreasing on the harder-with-depth axes", () => {
    const mono: (keyof ReturnType<typeof difficultyFor>)[] = ["enemyHpMult", "bossHpMult", "enemyDmgMult", "enemySpeedMult", "extraEnemies", "enemyArmor"];
    for (let d = 1; d <= MAX_DEPTH; d++) {
      const prev = difficultyFor(d - 1), cur = difficultyFor(d);
      for (const k of mono) expect(cur[k] as number).toBeGreaterThanOrEqual(prev[k] as number);
    }
  });

  it("free heals only shrink and never zero out", () => {
    for (let d = 0; d <= MAX_DEPTH; d++) {
      const cur = difficultyFor(d);
      expect(cur.healMult).toBeGreaterThan(0);
      if (d > 0) expect(cur.healMult).toBeLessThanOrEqual(difficultyFor(d - 1).healMult);
    }
  });

  it("clamps out-of-range depth to [0, MAX_DEPTH]", () => {
    expect(difficultyFor(-5)).toEqual(difficultyFor(0));
    expect(difficultyFor(MAX_DEPTH + 99)).toEqual(difficultyFor(MAX_DEPTH));
  });

  it("labels count matches the applied depth", () => {
    for (let d = 0; d <= MAX_DEPTH; d++) expect(difficultyFor(d).labels).toHaveLength(d);
    expect(depthLevelLabels()).toHaveLength(MAX_DEPTH);
  });

  it("kb-resist stays within its documented [0, 0.85] band", () => {
    for (let d = 0; d <= MAX_DEPTH; d++) {
      const k = difficultyFor(d).enemyKbResist;
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThanOrEqual(0.85);
    }
  });
});
