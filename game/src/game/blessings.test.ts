import { describe, it, expect } from "vitest";
import { BLESSINGS, blessingById } from "./blessings";

describe("blessings catalog", () => {
  it("blessingById round-trips every id", () => {
    for (const b of BLESSINGS) expect(blessingById(b.id)).toBe(b);
  });

  it("unknown id → undefined", () => {
    expect(blessingById("nope")).toBeUndefined();
  });

  it("ids are unique", () => {
    const ids = BLESSINGS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every entry has non-empty name + desc (no placeholder gaps)", () => {
    for (const b of BLESSINGS) {
      expect(b.name.trim().length).toBeGreaterThan(0);
      expect(b.desc.trim().length).toBeGreaterThan(0);
    }
  });
});
