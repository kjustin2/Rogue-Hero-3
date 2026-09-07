import { ENCOUNTERS, type EncounterKind } from "./encounters";
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
  encounter?: EncounterKind;
  obstacles?: { x: number; z: number; r: number }[];
  /** Optional arena mechanic on combat/elite nodes — see MapFeatures. */
  feature?: "hazard" | "teleport" | "spikes" | "drifters" | "sweeper" | "flamevent";
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
  { act: 4, name: "THE SUNDERED ABYSS", theme: "abyss", altTheme: "abyss", bossTheme: "voidcrown", boss: "tyrant", bossRoom: "The Usurper's Throne", pool: ["harrier", "brute", "splitter", "caster", "bastion", "leaper", "mirror"], eliteKind: "mirror" },
  { act: 5, name: "THE HOLLOW STAR", theme: "hollow", altTheme: "hollow", bossTheme: "starfall", boss: "unmaker", bossRoom: "The Hollow Star", pool: ["voidling", "warper", "caster", "harrier", "brute", "mirror", "shade"], eliteKind: "brute" },
];

// Roles for coordinated packs — a tanky front line you must break through to
// reach the fragile, dangerous back line.
export const FIELD_ROLES: Record<FieldKind, "guard" | "ranged" | "hunter" | "swarm"> = {
  husk: "hunter", spitter: "ranged", swarmer: "swarm", bomber: "hunter", sentinel: "guard",
  wisp: "ranged", leaper: "hunter", tether: "ranged", mirror: "guard", caster: "ranged",
  shade: "hunter", bastion: "guard", brute: "guard", harrier: "ranged", splitter: "swarm",
  voidling: "swarm", warper: "ranged",
};

/** Each room teaches one tactical shape, then changes the pressure in its second wave. */
function generateWaves(a: ActDef, rng: Rng, elite: boolean, diff: Difficulty, encounter: EncounterKind): SpawnList[] {
  type Role = (typeof FIELD_ROLES)[FieldKind];
  const pick = (role: Role): FieldKind => {
    const candidates = a.pool.filter(k => FIELD_ROLES[k] === role);
    if (candidates.length) return rng.pick(candidates);
    // Each act retains its creatures, with the act's elite species filling a missing guard role.
    if (role === "guard") return a.eliteKind;
    const fallback = a.pool.filter(k => FIELD_ROLES[k] === (role === "swarm" ? "hunter" : "swarm"));
    return rng.pick(fallback.length ? fallback : a.pool);
  };
  const patterns: Record<EncounterKind, [Role, number][][]> = {
    procession: [[["hunter", 3], ["ranged", 1]], [["hunter", 2], ["swarm", 3], ["ranged", 1]]],
    crossfire: [[["ranged", 2], ["hunter", 2]], [["ranged", 2], ["guard", 1], ["hunter", 2]]],
    pursuit: [[["hunter", 4]], [["hunter", 3], ["swarm", 3], ["ranged", 1]]],
    bastion: [[["guard", 1], ["ranged", 2]], [["guard", 1], ["ranged", 2], ["hunter", 2]]],
    breach: [[["swarm", 5], ["hunter", 1]], [["guard", 1], ["hunter", 2], ["ranged", 1]]],
  };
  const waves = patterns[encounter].map(pattern => {
    const wave: SpawnList = [];
    for (const [role, count] of pattern) {
      const kind = pick(role);
      // Splitters already create another generation; five parents overwhelm the room.
      const n = kind === "splitter" ? Math.min(count, 2) : count;
      const existing = wave.find(s => s[0] === kind);
      if (existing) existing[1] += n;
      else wave.push([kind, n]);
    }
    for (let i = 0; i < diff.extraEnemies; i++) wave[i % wave.length][1]++;
    return wave;
  });
  if (elite) {
    // The named keeper arrives in the counterattack, with a small supporting pack.
    const final = waves[1];
    const oldGuard = final.findIndex(s => FIELD_ROLES[s[0]] === "guard");
    if (oldGuard >= 0) final.splice(oldGuard, 1);
    final.push([a.eliteKind, 1, a.act >= 3 && rng.chance(0.5) ? "champion" : "elite"]);
  }
  return waves;
}

function combatNode(a: ActDef, rng: Rng, diff: Difficulty, id: number, avoid: EncounterKind[] = [], forced?: EncounterKind): MapNode {
  const kinds = (Object.keys(ENCOUNTERS) as EncounterKind[]).filter(k => !avoid.includes(k));
  const encounter = forced ?? rng.pick(kinds.length ? kinds : ["procession" as const]);
  const design = ENCOUNTERS[encounter];
  const reward = rng.chance(.13) ? "relic" : "card";
  return {
    id, kind: "combat", act: a.act, actName: a.name,
    name: design.name, theme: a.theme, reward: forced ? "card" : reward, encounter,
    waves: generateWaves(a, rng, false, diff, encounter),
    obstacles: design.obstacles.map(o => ({ ...o })),
    // The open breach has room for an act-specific hazard. Cover rooms stay readable.
    feature: encounter === "breach" && a.act > 1 ? (["hazard", "sweeper", "flamevent", "teleport", "drifters"] as const)[a.act - 1] : undefined,
  };
}

function eliteNode(a: ActDef, rng: Rng, diff: Difficulty, id: number): MapNode {
  const encounter: EncounterKind = rng.pick(["bastion", "breach"]);
  return {
    id, kind: "elite", act: a.act, actName: a.name,
    name: "The Keeper's Hunt", theme: a.altTheme, reward: "relic", elite: true, encounter,
    waves: generateWaves(a, rng, true, diff, encounter),
    obstacles: ENCOUNTERS[encounter].obstacles.map(o => ({ ...o })),
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
 *  `combatOnly` makes every option a fight (so non-combat nodes can't replace a real
 *  battle on the way to the boss). `forceRest` guarantees a Quiet Hollow (heal + hone)
 *  is one of the options — a CHOICE the player picks, never an auto-entered step. */
function choiceFork(a: ActDef, rng: Rng, diff: Difficulty, stepIdx: number, state: { shopLeft: number }, nextId: () => number, opts?: { combatOnly?: boolean; forceRest?: boolean }): MapNode[] {
  const count = a.act <= 1 ? 2 : rng.chance(0.55) ? 3 : 2;
  const out: MapNode[] = [];
  const usedSimple = new Set<NodeKind>();

  // Guaranteed combat/elite anchor
  const wantElite = (diff.forceElite && stepIdx === 1) || (a.act >= 3 && rng.chance(0.5)) || rng.chance(0.18);
  out.push(wantElite ? eliteNode(a, rng, diff, nextId()) : combatNode(a, rng, diff, nextId()));

  while (out.length < count) {
    // Rest is never in the random bag — it's added only as a deliberate, guaranteed
    // option in the pre-boss fork (forceRest), so it's offered exactly once per act.
    const bag: NodeKind[] = opts?.combatOnly
      ? (a.act >= 2 ? ["combat", "combat", "elite"] : ["combat"])
      : ["combat", "combat", "treasure", "treasure", "event", "event"];
    if (!opts?.combatOnly && a.act >= 2) bag.push("elite", "gamble");
    if (!opts?.combatOnly && a.act >= 2) bag.push("shrine"); // the altar wants blood — mid-run onward
    if (!opts?.combatOnly && state.shopLeft > 0) bag.push("shop", "shop");
    // No duplicate non-combat kinds within one fork
    const choices = bag.filter((k) => k === "combat" || k === "elite" || !usedSimple.has(k));
    const kind = rng.pick(choices);
    if (kind === "combat") out.push(combatNode(a, rng, diff, nextId(), out.flatMap(n => n.encounter ? [n.encounter] : [])));
    else if (kind === "elite") out.push(eliteNode(a, rng, diff, nextId()));
    else {
      usedSimple.add(kind);
      if (kind === "shop") state.shopLeft--;
      out.push(simpleNode(kind, a, nextId()));
    }
  }
  // The pre-boss fork always OFFERS a Quiet Hollow (heal + card hone) — a choice, so the
  // player elects to rest rather than being railroaded into it. Replaces a non-anchor
  // option, preserving the combat/elite anchor at index 0.
  if (opts?.forceRest) {
    if (!out.some((n) => n.kind === "rest")) out[out.length - 1] = simpleNode("rest", a, nextId());
    // …and rarely a Rift Tear (optional superboss) tempts in the late acts, replacing a
    // different non-anchor, non-rest option (so the anchor AND the rest both survive).
    if (a.act >= 4 && out.length >= 3 && rng.chance(0.16)) {
      const idx = out.findIndex((n, i) => i > 0 && n.kind !== "rest");
      if (idx > 0) out[idx] = riftTearNode(a, nextId());
    }
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
    forks.push([combatNode(a, rng, diff, nextId(), [], (["procession", "bastion", "pursuit", "crossfire", "breach"] as const)[a.act - 1])]); // act entry (forced)
    const state = { shopLeft: 1 };
    // First choice fork is combat-only so you always fight ≥2 battles before the boss
    // (non-combat nodes can't replace a real fight on the way down).
    forks.push(choiceFork(a, rng, diff, 0, state, nextId, { combatOnly: true }));
    // The pre-boss fork always OFFERS a Quiet Hollow (heal + hone) as one choice among
    // a combat anchor + shop/treasure/event — never auto-entered, so picking the shop
    // or an event can't dump you into a rest you didn't choose.
    forks.push(choiceFork(a, rng, diff, 1, state, nextId, { forceRest: true }));
    forks.push([bossNode(a, nextId())]); // act boss (forced)
  }
  return { seed, depth, forks };
}

/** Saved routes stay intact across generator changes. Reject malformed local
 * data before any enemy or collider can be built from it. */
export function isRunPlan(value: unknown, seed: number, depth: number): value is RunPlan {
  try {
    const plan = value as RunPlan;
    const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
    const kinds: readonly string[] = ["combat","elite","shop","treasure","rest","event","shrine","gamble","boss"];
    const features: readonly string[] = ["hazard","teleport","spikes","drifters","sweeper","flamevent"];
    return !!plan && plan.seed === seed && plan.depth === depth && Array.isArray(plan.forks)
      && plan.forks.length > 0 && plan.forks.length <= 64 && plan.forks.every(fork =>
        Array.isArray(fork) && fork.length > 0 && fork.length <= 3 && fork.every(node =>
          !!node && finite(node.id) && kinds.includes(node.kind) && ACTS.some(a=>a.act===node.act)
          && typeof node.name === "string" && node.name.length <= 100 && typeof node.actName === "string"
          && Object.hasOwn(THEMES,node.theme) && ["card","relic"].includes(node.reward)
          && (!node.encounter || Object.hasOwn(ENCOUNTERS,node.encounter))
          && (!node.feature || features.includes(node.feature))
          && (node.kind !== "boss" || ACTS.some(a=>a.boss===node.bossKind) || node.bossKind === "echo" || node.bossKind === "wound")
          && Array.isArray(node.waves) && node.waves.length <= 8 && node.waves.every(wave =>
            Array.isArray(wave) && wave.length <= 12 && wave.every(spawn => Array.isArray(spawn)
              && Object.hasOwn(FIELD_ROLES,spawn[0]) && Number.isInteger(spawn[1]) && spawn[1] > 0 && spawn[1] <= 32
              && (!spawn[2] || spawn[2] === "elite" || spawn[2] === "champion")))
          && (!node.obstacles || (Array.isArray(node.obstacles) && node.obstacles.length <= 16 && node.obstacles.every(o =>
            finite(o.x) && finite(o.z) && finite(o.r) && o.r > 0 && o.r <= 6 && Math.hypot(o.x,o.z)+o.r <= 19)))
        ));
  } catch { return false; }
}
