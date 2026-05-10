import { events } from "../engine/EventBus";

/**
 * Per-room modifier flags. Active on the current room only; cleared on
 * `ROOM_CLEARED`. Hooks live in main.ts / managers — this module owns the
 * registry + the active-state surface that other systems query each frame.
 *
 * Keep these data-driven so the door-choice HUD can preview the anomaly's
 * name + description before the player commits.
 */

export type AnomalyId =
  | "echo_chamber"
  | "frost_mirror"
  | "slick_floor"
  | "stoneskin_mob"
  | "twin_spawn";

export interface AnomalyDef {
  id: AnomalyId;
  name: string;
  description: string;
  /** Brief glyph (one char) for door-choice HUD chip. */
  glyph: string;
}

export const ANOMALY_DEFS: Record<AnomalyId, AnomalyDef> = {
  echo_chamber: {
    id: "echo_chamber",
    name: "Echo Chamber",
    description: "Every card replays 0.5s later for free.",
    glyph: "≈",
  },
  frost_mirror: {
    id: "frost_mirror",
    name: "Frost Mirror",
    description: "Frost Field zones also damage you.",
    glyph: "❄",
  },
  slick_floor: {
    id: "slick_floor",
    name: "Slick Floor",
    description: "You slide 30% farther on every move.",
    glyph: "≋",
  },
  stoneskin_mob: {
    id: "stoneskin_mob",
    name: "Stoneskin Mob",
    description: "Enemies take 25% less damage but move 30% slower.",
    glyph: "▲",
  },
  twin_spawn: {
    id: "twin_spawn",
    name: "Twin Spawn",
    description: "Enemy kills sometimes echo a low-HP twin.",
    glyph: "♊",
  },
};

export const ALL_ANOMALY_IDS: AnomalyId[] = Object.keys(ANOMALY_DEFS) as AnomalyId[];

/**
 * Singleton-ish state for the active anomaly. Exposed as plain getter/setter
 * functions so the various managers (PlayerController, CardCaster, EnemyManager,
 * HazardZones) can read without a circular dependency on a class instance.
 */
let activeId: AnomalyId | null = null;

export function setActiveAnomaly(id: AnomalyId | null): void {
  if (activeId === id) return;
  activeId = id;
  events.emit("ANOMALY_CHANGED", { id });
}

export function getActiveAnomaly(): AnomalyId | null {
  return activeId;
}

/** Convenience: query whether a specific anomaly is on. Reads cheaply. */
export function isAnomaly(id: AnomalyId): boolean {
  return activeId === id;
}

/** Pick a random anomaly id given an RNG. Used by MapGenerator. */
export function rollAnomaly(rng: () => number): AnomalyId {
  return ALL_ANOMALY_IDS[Math.floor(rng() * ALL_ANOMALY_IDS.length) % ALL_ANOMALY_IDS.length];
}
