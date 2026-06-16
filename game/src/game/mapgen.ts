import { Rng } from "../core/rng";
import { THEMES } from "../render/arena";
import { difficultyFor, type Difficulty } from "./difficulty";
import type { EnemyKind } from "./enemies";
import type { BossKind } from "./run";

type FieldKind = Exclude<EnemyKind, "boss">;
type Spawn = [FieldKind, number, ("elite" | "champion")?];
export type SpawnList = Spawn[];
type ThemeKey = keyof typeof THEMES;

export type NodeKind = "combat" | "elite" | "shop" | "treasure" | "rest" | "event" | "shrine" | "gamble" | "boss";

export interface MapNode {
  id: number;
  kind: NodeKind;
  act: number;
  actName: string;
  name: string;
  theme: ThemeKey;
  reward: "card" | "relic";
  waves: SpawnList[];
  bossKind?: BossKind;
  elite?: boolean;
  obstacles?: { x: number; z: number; r: number }[];
  /** Optional arena mechanic on combat/elite nodes — see MapFeatures. */
  feature?: "hazard" | "teleport" | "spikes" | "drifters" | "sweeper";
}

export interface RunPlan {
  seed: number;
  depth: number;
  /** forks[i] = the 1–3 node options offered at step i (all acts concatenated). */
  forks: MapNode[][];
}

interface ActDef {
  act: number;
  name: string;
  theme: ThemeKey;
  altTheme: ThemeKey;
  bossTheme: ThemeKey;
  boss: BossKind;
  bossRoom: string;
  pool: FieldKind[];
  eliteKind: FieldKind;
}

const ACTS: ActDef[] = [
  { act: 1, name: "THE EMBER RIFT", theme: "rift", altTheme: "dusk", bossTheme: "ember", boss: "warden", bossRoom: "The Pit", pool: ["husk", "spitter", "swarmer", "bomber", "splitter"], eliteKind: "sentinel" },
  { act: 2, name: "THE SHATTERED SPIRE", theme: "spire", altTheme: "spire", bossTheme: "tempest", boss: "spire", bossRoom: "The Spire Crown", pool: ["wisp", "tether", "bastion", "shade", "leaper", "harrier"], eliteKind: "mirror" },
  { act: 3, name: "THE MOLTEN CORE", theme: "forge", altTheme: "forge", bossTheme: "core", boss: "colossus", bossRoom: "The Core", pool: ["leaper", "bomber", "caster", "swarmer", "bastion", "shade", "brute"], eliteKind: "brute" },
  { act: 4, name: "THE SUNDERED ABYSS", theme: "abyss", altTheme: "abyss", bossTheme: "voidcrown", boss: "tyrant", bossRoom: "The Wound", pool: ["harrier", "brute", "splitter", "caster", "bastion", "leaper", "mirror"], eliteKind: "mirror" },
  { act: 5, name: "THE HOLLOW STAR", theme: "hollow", altTheme: "hollow", bossTheme: "starfall", boss: "unmaker", bossRoom: "The Hollow Star", pool: ["voidling", "warper", "caster", "harrier", "brute", "mirror", "shade"], eliteKind: "brute" },
];

const COMBAT_NAMES = ["Skirmish", "The Gauntlet", "Ambush", "Broken Ground", "The Crossing", "Hollow Run"];
const OBSTACLE_PRESETS: { x: number; z: number; r: number }[][] = [
  [{ x: -6, z: -3, r: 1.2 }, { x: 6, z: -3, r: 1.2 }, { x: 0, z: 6, r: 1.5 }],
  [{ x: -8, z: 2, r: 1.3 }, { x: 8, z: 2, r: 1.3 }, { x: -4, z: -8, r: 1.1 }, { x: 4, z: -8, r: 1.1 }],
  [{ x: 0, z: 0, r: 1.6 }, { x: -9, z: -5, r: 1.2 }, { x: 9, z: -5, r: 1.2 }],
];

// Roles for coordinated packs — a tanky front line you must break through to
// reach the fragile, dangerous back line.
const FRONTLINE = new Set<FieldKind>(["bastion", "brute", "sentinel", "mirror"]);
const BACKLINE = new Set<FieldKind>(["spitter", "caster", "wisp", "tether"]);

/** A coordinated wave: a couple of front-liners shielding a cluster of back-liners. */
function formationWave(a: ActDef, rng: Rng, diff: Difficulty): SpawnList | null {
  const front = a.pool.filter((k) => FRONTLINE.has(k));
  const back = a.pool.filter((k) => BACKLINE.has(k));
  if (!front.length || !back.length) return null;
  const f = rng.pick(front);
  const b = rng.pick(back);
  const wave: SpawnList = [
    [f, 1 + (a.act >= 3 ? 1 : 0)],
    [b, 2 + rng.int(0, 1) + diff.extraEnemies],
  ];
  return wave;
}

/** Two waves drawn from the act pool, scaled by act + difficulty; one may be a coordinated pack. */
function generateWaves(a: ActDef, rng: Rng, elite: boolean, diff: Difficulty): SpawnList[] {
  const waves: SpawnList[] = [];
  // ~45% of fights open with a coordinated formation (front line + back line).
  const formation = rng.chance(0.45) ? formationWave(a, rng, diff) : null;
  for (let w = 0; w < 2; w++) {
    if (w === 0 && formation) { waves.push(formation); continue; }
    const wave: SpawnList = [];
    const k = rng.shuffle([...a.pool]).slice(0, 2 + (a.act >= 3 ? 1 : 0));
    for (const kind of k) {
      const count = 2 + rng.int(0, 1) + (a.act >= 3 ? 1 : 0) + diff.extraEnemies;
      wave.push([kind, count]);
    }
    waves.push(wave);
  }
  if (elite) {
    // From the Molten Core on, an elite hunt may instead crown a Champion — a 2-affix mini-boss.
    const anchor: "elite" | "champion" = a.act >= 3 && rng.chance(0.5) ? "champion" : "elite";
    waves[waves.length - 1].push([a.eliteKind, 1, anchor]);
  }
  return waves;
}

function combatNode(a: ActDef, rng: Rng, diff: Difficulty, id: number): MapNode {
  const hasObstacles = rng.chance(0.3);
  return {
    id, kind: "combat", act: a.act, actName: a.name,
    name: rng.pick(COMBAT_NAMES), theme: a.theme, reward: "card",
    waves: generateWaves(a, rng, false, diff),
    obstacles: hasObstacles ? rng.pick(OBSTACLE_PRESETS) : undefined,
    // Some chambers carry a mechanic (skip if pillars already crowd the floor).
    feature: !hasObstacles && rng.chance(0.52)
      ? rng.pick(["hazard", "teleport", "spikes", "drifters", "sweeper"] as const)
      : undefined,
  };
}

function eliteNode(a: ActDef, rng: Rng, diff: Difficulty, id: number): MapNode {
  return {
    id, kind: "elite", act: a.act, actName: a.name,
    name: "Elite Hunt", theme: a.altTheme, reward: "relic", elite: true,
    waves: generateWaves(a, rng, true, diff),
    feature: rng.chance(0.58) ? rng.pick(["hazard", "spikes", "drifters", "sweeper"] as const) : undefined,
  };
}

function simpleNode(kind: NodeKind, a: ActDef, id: number): MapNode {
  const names: Record<string, string> = {
    shop: "Rift Merchant", treasure: "Hidden Cache", rest: "Quiet Hollow", event: "Strange Rift",
    shrine: "Bloodstone Altar", gamble: "The Rift's Wager",
  };
  return {
    id, kind, act: a.act, actName: a.name,
    name: names[kind] ?? kind, theme: a.theme, reward: "card", waves: [],
  };
}

function bossNode(a: ActDef, id: number): MapNode {
  return {
    id, kind: "boss", act: a.act, actName: a.name,
    name: a.bossRoom, theme: a.bossTheme, reward: "card",
    bossKind: a.boss, waves: [],
  };
}

/** A hidden optional superboss node (the Rift Echo) — rare, in the late acts, pays a relic. */
function riftTearNode(a: ActDef, id: number): MapNode {
  return {
    id, kind: "boss", act: a.act, actName: a.name,
    name: "A Rift Tear", theme: a.altTheme, reward: "relic",
    bossKind: "echo", waves: [],
  };
}

/** Build one choice fork: 2–3 options, always with ≥1 combat/elite.
 *  `combatOnly` makes every option a fight (so non-combat nodes can't replace
 *  a real battle on the way to the boss). */
function choiceFork(a: ActDef, rng: Rng, diff: Difficulty, stepIdx: number, state: { shopLeft: number }, nextId: () => number, opts?: { forceRest?: boolean; combatOnly?: boolean }): MapNode[] {
  const count = a.act <= 1 ? 2 : rng.chance(0.55) ? 3 : 2;
  const out: MapNode[] = [];
  const usedSimple = new Set<NodeKind>();

  // Guaranteed combat/elite anchor
  const wantElite = (diff.forceElite && stepIdx === 1) || (a.act >= 3 && rng.chance(0.5)) || rng.chance(0.18);
  out.push(wantElite ? eliteNode(a, rng, diff, nextId()) : combatNode(a, rng, diff, nextId()));

  while (out.length < count) {
    const bag: NodeKind[] = opts?.combatOnly
      ? (a.act >= 2 ? ["combat", "combat", "elite"] : ["combat"])
      : ["combat", "combat", "treasure", "treasure", "rest", "rest", "event", "event"];
    if (!opts?.combatOnly && a.act >= 2) bag.push("elite", "gamble");
    if (!opts?.combatOnly && a.act >= 2) bag.push("shrine"); // the altar wants blood — mid-run onward
    if (!opts?.combatOnly && state.shopLeft > 0) bag.push("shop", "shop");
    // No duplicate non-combat kinds within one fork
    const choices = bag.filter((k) => k === "combat" || k === "elite" || !usedSimple.has(k));
    const kind = rng.pick(choices);
    if (kind === "combat") out.push(combatNode(a, rng, diff, nextId()));
    else if (kind === "elite") out.push(eliteNode(a, rng, diff, nextId()));
    else {
      usedSimple.add(kind);
      if (kind === "shop") state.shopLeft--;
      out.push(simpleNode(kind, a, nextId()));
    }
  }
  // Guarantee a Quiet Hollow (heal + card hone) somewhere this act — keeps the
  // honing path discoverable. The anchor (index 0) stays combat/elite.
  if (opts?.forceRest && !out.some((n) => n.kind === "rest")) {
    out[out.length - 1] = simpleNode("rest", a, nextId());
  }
  // A rare Rift Tear (optional superboss) tempts you in the late acts — replaces a
  // non-anchor option, so the combat/elite anchor at index 0 is preserved.
  else if (a.act >= 4 && !opts?.forceRest && rng.chance(0.16)) {
    out[out.length - 1] = riftTearNode(a, nextId());
  }
  rng.shuffle(out);
  return out;
}

/** Deterministic for a (seed, depth) pair — used for new runs, resume, and dailies. */
export function generatePlan(seed: number, depth: number): RunPlan {
  const rng = new Rng(seed);
  const diff = difficultyFor(depth);
  let id = 1;
  const nextId = () => id++;
  const forks: MapNode[][] = [];
  for (const a of ACTS) {
    forks.push([combatNode(a, rng, diff, nextId())]); // act entry (forced)
    const state = { shopLeft: 1 };
    // First choice fork is combat-only so you always fight ≥2 battles before the boss
    // (non-combat nodes — rest/shop/heal — can't replace a real fight on the way down).
    forks.push(choiceFork(a, rng, diff, 0, state, nextId, { combatOnly: true }));
    // The pre-boss fork always offers a Quiet Hollow so honing is reachable each act.
    forks.push(choiceFork(a, rng, diff, 1, state, nextId, { forceRest: true }));
    forks.push([bossNode(a, nextId())]); // act boss (forced)
  }
  return { seed, depth, forks };
}
