import { describe, expect, it } from "vitest";
import { PIT_WARDEN_MOVE_PROFILE, chooseBossMove } from "./bossMoves";

describe("Pit Warden move deck", () => {
  it("teaches only dash and guard in phase one", () => {
    const seen = new Set(Array.from({ length: 20 }, (_, i) => chooseBossMove(PIT_WARDEN_MOVE_PROFILE, 1, null, 5, i / 20).id));
    expect([...seen].sort()).toEqual(["dash", "guard"]);
  });

  it("prevents immediate repeats when another valid move exists", () => {
    for (const phase of [1, 2, 3]) {
      for (const last of ["dash", "guard", "leap", "fissure", "fan"] as const) {
        const next = chooseBossMove(PIT_WARDEN_MOVE_PROFILE, phase, last, 7, 0).id;
        if (PIT_WARDEN_MOVE_PROFILE[phase - 1].moves.some((move) => move.id === last)) expect(next).not.toBe(last);
      }
    }
  });

  it("keeps the authored phase-three identity in data", () => {
    expect(PIT_WARDEN_MOVE_PROFILE[2].moves.find((move) => move.id === "dash")?.presentation).toContain("three chained");
    expect(PIT_WARDEN_MOVE_PROFILE[2].moves.find((move) => move.id === "fan")?.presentation).toContain("nine-bolt");
    expect(PIT_WARDEN_MOVE_PROFILE[2].moves.find((move) => move.id === "fissure")?.presentation).toContain("six lanes");
  });
});
