import { describe, it, expect } from "vitest";
import { Rng } from "./rng";

describe("Rng (Mulberry32)", () => {
  it("is deterministic: same seed → identical sequence", () => {
    const a = new Rng(12345), b = new Rng(12345);
    const sa = Array.from({ length: 50 }, () => a.next());
    const sb = Array.from({ length: 50 }, () => b.next());
    expect(sa).toEqual(sb);
  });

  it("different seeds diverge", () => {
    const a = Array.from({ length: 20 }, ((r) => () => r.next())(new Rng(1)));
    const b = Array.from({ length: 20 }, ((r) => () => r.next())(new Rng(2)));
    expect(a).not.toEqual(b);
  });

  it("getState/setState round-trips the exact cursor", () => {
    const r = new Rng(999);
    r.next(); r.next();
    const cursor = r.getState();
    const after = [r.next(), r.next(), r.next()];
    r.setState(cursor);
    expect([r.next(), r.next(), r.next()]).toEqual(after);
  });

  it("reseed restarts the stream", () => {
    const r = new Rng(7);
    const first = r.next();
    r.next(); r.next();
    r.reseed(7);
    expect(r.next()).toBe(first);
  });

  it("next() ∈ [0,1)", () => {
    const r = new Rng(42);
    for (let i = 0; i < 1000; i++) { const v = r.next(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });

  it("int(lo,hi) is inclusive and in-range", () => {
    const r = new Rng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) { const v = r.int(2, 5); expect(v).toBeGreaterThanOrEqual(2); expect(v).toBeLessThanOrEqual(5); seen.add(v); }
    expect([...seen].sort()).toEqual([2, 3, 4, 5]); // both endpoints reachable
  });

  it("pick returns an element of the array", () => {
    const r = new Rng(8);
    const arr = ["a", "b", "c"] as const;
    for (let i = 0; i < 100; i++) expect(arr).toContain(r.pick(arr));
  });

  it("shuffle is a permutation (no loss/dup)", () => {
    const r = new Rng(11);
    const src = Array.from({ length: 20 }, (_, i) => i);
    const out = r.shuffle([...src]);
    expect([...out].sort((a, b) => a - b)).toEqual(src);
  });

  it("chance(0) never true, chance(1) always true", () => {
    const r = new Rng(5);
    for (let i = 0; i < 50; i++) { expect(r.chance(0)).toBe(false); expect(r.chance(1)).toBe(true); }
  });
});
