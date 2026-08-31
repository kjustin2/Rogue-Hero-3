import { describe, expect, it } from "vitest";
import { CinematicDirector } from "./cinematicDirector";
import type { ImpactCue } from "./types";
import { ACT_SET_PROFILES, ATTACK_PRESENTATION, BOSS_ATTACK_FAMILY, BOSS_PRESENTATION, ENEMY_ATTACK_FAMILY, ENEMY_PRESENTATION, HERO_PRESENTATION, actSetFor, heroAttackFamily } from "./profiles";

const cue = (strength: ImpactCue["strength"], targetKind = "husk"): ImpactCue => ({
  sourceId: "hero:blade", sourceKind: "hero", targetId: "enemy:1", targetKind,
  attackFamily: "blade-opener", x: 0, y: 1, z: 0, dirX: 0, dirZ: 1,
  damage: 8, color: 0xffffff, strength, element: "steel", shielded: false, killed: false,
});

describe("presentation timing", () => {
  it("skip lands on the reveal and holds it before returning control", () => {
    const seen: string[] = [];
    let finished = false;
    const director = new CinematicDirector({
      run: (beat) => seen.push(beat.type),
      finish: () => { finished = true; },
    });
    director.play({
      id: "warden", duration: 4.8, skipTo: 2.75, skipDuration: 0.6,
      beats: [
        { at: 0, type: "letterbox", on: true },
        { at: 2.75, type: "title", title: "THE PIT WARDEN", subtitle: "Keeper", className: "warden" },
        { at: 4.5, type: "letterbox", on: false },
      ],
    });
    director.update(0.5);
    director.skip();
    expect(seen).toContain("title");
    expect(finished).toBe(false);
    expect(director.state().duration).toBeCloseTo(3.35);
    director.update(0.59);
    expect(finished).toBe(false);
    director.update(0.02);
    expect(finished).toBe(true);
  });
});

describe("full-game presentation catalog", () => {
  it("covers every playable hero with a distinct authored attack family", () => {
    const heroes = ["blade", "bulwark", "sparkmage", "reaver", "tempest", "revenant"];
    expect(Object.keys(HERO_PRESENTATION).sort()).toEqual([...heroes].sort());
    expect(new Set(heroes.map(heroAttackFamily)).size).toBe(6);
    for (const id of heroes) {
      const profile = HERO_PRESENTATION[id];
      expect(profile.poseLanguage.length).toBeGreaterThan(8);
      expect(profile.maxLocalParticles).toBeLessThanOrEqual(16);
    }
  });

  it("covers the complete field-enemy and boss roster", () => {
    const enemies = ["husk", "spitter", "swarmer", "bomber", "splitter", "sentinel", "wisp", "leaper", "tether", "mirror", "caster", "shade", "bastion", "brute", "harrier", "voidling", "warper"];
    const bosses = ["warden", "spire", "colossus", "tyrant", "unmaker", "echo", "wound"];
    for (const id of enemies) {
      expect(ENEMY_ATTACK_FAMILY[id], id).toBeTruthy();
      expect(ENEMY_PRESENTATION[id]?.poseLanguage.length, id).toBeGreaterThan(8);
      expect(ATTACK_PRESENTATION[ENEMY_ATTACK_FAMILY[id]], id).toBeTruthy();
    }
    for (const id of bosses) {
      expect(BOSS_ATTACK_FAMILY[id], id).toBeTruthy();
      expect(BOSS_PRESENTATION[id], id).toBeTruthy();
      expect(ATTACK_PRESENTATION[BOSS_ATTACK_FAMILY[id]], id).toBeTruthy();
    }
  });

  it("provides bounded local feedback for every attack family", () => {
    for (const [family, profile] of Object.entries(ATTACK_PRESENTATION)) {
      expect(profile.family, family).toBe(family);
      expect(profile.contactCore, family).toBe(0xffffff);
      expect(profile.particleScale, family).toBeGreaterThan(0);
      expect(profile.particleScale, family).toBeLessThanOrEqual(1.08);
      expect(profile.shardSpread, family).toBeLessThanOrEqual(0.78);
    }
  });

  it("routes every act and optional ending arena to an authored set", () => {
    expect(actSetFor(1)).toBe("rift");
    expect(actSetFor(2)).toBe("spire");
    expect(actSetFor(3)).toBe("forge");
    expect(actSetFor(4)).toBe("abyss");
    expect(actSetFor(5)).toBe("hollow");
    expect(actSetFor(4, "echo")).toBe("echo");
    expect(actSetFor(5, "wound")).toBe("wound");
    expect(Object.keys(ACT_SET_PROFILES)).toHaveLength(7);
  });
});
