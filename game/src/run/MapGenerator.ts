import { mulberry32 } from "../engine/Rng";
import { RoomDescriptor, ACT_ROOMS } from "./RunManager";
import { RunMap, RunNode, RunNodeKind, nodeIdFor } from "./RunMap";
import { rollAnomaly } from "./Anomalies";

/**
 * Per-act constants. Each act has 3 non-boss layers + 1 boss layer.
 * Column count is 3 except for the start node (layer 0, column 0 only).
 */
const NON_BOSS_LAYERS_PER_ACT = 3;
const COLUMNS = 3;
const ACT_COUNT = 3;

/** Layout maps:
 *   layer 0           = START (1 node)
 *   layers 1..3       = Act I non-boss (3 each)
 *   layer 4           = Act I boss
 *   layers 5..7       = Act II non-boss
 *   layer 8           = Act II boss
 *   layers 9..11      = Act III non-boss
 *   layer 12          = Act III boss (final)
 */
const TOTAL_LAYERS = 1 + ACT_COUNT * (NON_BOSS_LAYERS_PER_ACT + 1);

/**
 * `ACT_ROOMS` template indexes used to seed descriptors per act. Each act has
 * 3 non-boss room templates we can draw from at random for combat nodes.
 */
const ACT_NON_BOSS_TEMPLATES: number[][] = [
  [0, 1],     // Act I non-boss templates (Verdant Approach, Verdant Crossing)
  [3, 4],     // Act II (Spire Ascent, Crystal Hall)
  [6, 7],     // Act III (Magma Vents, Forge Path)
];
const ACT_BOSS_TEMPLATES: number[] = [2, 5, 8];

interface KindWeights {
  combat: number;
  elite: number;
  shrine: number;
  shop: number;
}

/** Weights per act-layer (0 = first non-boss layer in the act, 2 = last). */
const KIND_WEIGHTS: KindWeights[] = [
  { combat: 60, elite: 0, shrine: 25, shop: 15 },
  { combat: 50, elite: 20, shrine: 15, shop: 15 },
  { combat: 40, elite: 30, shrine: 20, shop: 10 },
];

function pickKind(rng: () => number, w: KindWeights): RunNodeKind {
  const r = rng() * (w.combat + w.elite + w.shrine + w.shop);
  if (r < w.combat) return "combat";
  if (r < w.combat + w.elite) return "elite";
  if (r < w.combat + w.elite + w.shrine) return "shrine";
  return "shop";
}

/** Pick a non-boss room template for an act + return a copy of the descriptor. */
function descriptorForCombat(act: number, rng: () => number): RoomDescriptor {
  const pool = ACT_NON_BOSS_TEMPLATES[act];
  const tmpl = pool[Math.floor(rng() * pool.length) % pool.length];
  return ACT_ROOMS[tmpl];
}

/** Pick the elite room descriptor — currently reuses combat templates with a flag. */
function descriptorForElite(act: number, _rng: () => number): RoomDescriptor {
  // Elite rooms reuse combat arenas; spawn replacement happens in Phase 2.
  // For now, use the second non-boss template per act (denser arena).
  const pool = ACT_NON_BOSS_TEMPLATES[act];
  return ACT_ROOMS[pool[pool.length - 1]];
}

/** Pick the shrine descriptor — reuses combat arena layouts, no spawns. */
function descriptorForShrine(act: number, rng: () => number): RoomDescriptor {
  const base = descriptorForCombat(act, rng);
  return { ...base, spawns: [], hazards: [] };
}

function descriptorForShop(act: number, rng: () => number): RoomDescriptor {
  const base = descriptorForCombat(act, rng);
  return { ...base, spawns: [], hazards: [] };
}

function descriptorForBoss(act: number): RoomDescriptor {
  return ACT_ROOMS[ACT_BOSS_TEMPLATES[act]];
}

/**
 * Build the run-map graph for a fresh run. Deterministic given a seed.
 *
 * Generation rules:
 * - Start node at (layer 0, column 0).
 * - For each act, three non-boss layers each with 3 columns. Per-layer kind
 *   distribution is rolled with the seeded RNG (see `KIND_WEIGHTS`).
 * - Boss layer per act has a single node at column 1.
 * - Edges fan: (L, C) → (L+1, C-1), (L+1, C), (L+1, C+1) clipped to bounds.
 *   Pre-boss-layer nodes all connect to the single boss node.
 * - Constraint: never two elites at adjacent columns within the same layer
 *   — re-roll the column with the highest column-index until satisfied.
 *   At least one combat node per layer.
 * - Risk tier (`elite_dense`): ~15% chance on a combat node in the act's
 *   final non-boss layer.
 */
export function generateRunMap(seed: number): RunMap {
  const rng = mulberry32(seed);
  const nodes: RunNode[] = [];
  const byId = new Map<string, RunNode>();
  const edges = new Map<string, string[]>();

  // ---- Layer 0: START ----
  // Lobby arena — reuses the first Act I template but strips spawns and forces
  // 3 doors so the player picks their first layer-1 destination on entry.
  const startId = nodeIdFor(0, 0);
  const startTemplate = ACT_ROOMS[0];
  const start: RunNode = {
    id: startId,
    layer: 0,
    column: 0,
    kind: "start",
    act: 0,
    descriptor: { ...startTemplate, spawns: [], hazards: [] },
    anomalyId: null,
    riskTier: "normal",
    cleared: true,
  };
  nodes.push(start);
  byId.set(startId, start);

  // ---- Act layers ----
  for (let act = 0; act < ACT_COUNT; act++) {
    const baseLayer = 1 + act * (NON_BOSS_LAYERS_PER_ACT + 1);
    // Three non-boss layers
    for (let aLayer = 0; aLayer < NON_BOSS_LAYERS_PER_ACT; aLayer++) {
      const layer = baseLayer + aLayer;
      const weights = KIND_WEIGHTS[aLayer];
      const layerKinds: RunNodeKind[] = [];
      for (let c = 0; c < COLUMNS; c++) layerKinds.push(pickKind(rng, weights));

      // Constraint: never two elites adjacent
      for (let c = 1; c < COLUMNS; c++) {
        if (layerKinds[c] === "elite" && layerKinds[c - 1] === "elite") {
          layerKinds[c] = "combat";
        }
      }
      // Constraint: at least one combat node
      if (!layerKinds.includes("combat")) {
        layerKinds[Math.floor(rng() * COLUMNS)] = "combat";
      }

      for (let c = 0; c < COLUMNS; c++) {
        const kind = layerKinds[c];
        let descriptor: RoomDescriptor;
        if (kind === "combat") descriptor = descriptorForCombat(act, rng);
        else if (kind === "elite") descriptor = descriptorForElite(act, rng);
        else if (kind === "shrine") descriptor = descriptorForShrine(act, rng);
        else descriptor = descriptorForShop(act, rng);
        // Risk-tier roll: only on the final non-boss layer of the act, only on
        // combat nodes, ~15% chance.
        const isFinalNonBoss = aLayer === NON_BOSS_LAYERS_PER_ACT - 1;
        const riskTier: RunNode["riskTier"] =
          isFinalNonBoss && kind === "combat" && rng() < 0.15 ? "elite_dense" : "normal";
        // Anomaly roll: 60% chance for combat rooms in layer 1+ within the act.
        const anomalyId = (kind === "combat" && aLayer >= 1 && rng() < 0.6)
          ? rollAnomaly(rng)
          : null;
        const node: RunNode = {
          id: nodeIdFor(layer, c),
          layer,
          column: c,
          kind,
          act,
          descriptor,
          anomalyId,
          riskTier,
          cleared: false,
        };
        nodes.push(node);
        byId.set(node.id, node);
      }
    }
    // Boss layer (single node, column 1)
    const bossLayer = baseLayer + NON_BOSS_LAYERS_PER_ACT;
    const bossNode: RunNode = {
      id: nodeIdFor(bossLayer, 1),
      layer: bossLayer,
      column: 1,
      kind: "boss",
      act,
      descriptor: descriptorForBoss(act),
      anomalyId: null,
      riskTier: "normal",
      cleared: false,
    };
    nodes.push(bossNode);
    byId.set(bossNode.id, bossNode);
  }

  // ---- Edges ----
  // Layer 0 (start) → all of layer 1
  edges.set(startId, [
    nodeIdFor(1, 0),
    nodeIdFor(1, 1),
    nodeIdFor(1, 2),
  ]);

  for (let layer = 1; layer < TOTAL_LAYERS - 1; layer++) {
    const isPreBoss = isPreBossLayer(layer);
    if (isPreBoss) {
      // Every column at this layer routes to the single boss node next.
      const bossId = nodeIdFor(layer + 1, 1);
      for (let c = 0; c < COLUMNS; c++) {
        edges.set(nodeIdFor(layer, c), [bossId]);
      }
    } else if (isBossLayer(layer)) {
      // Boss node fans out to all 3 of the next act's first non-boss layer.
      const nextLayer = layer + 1;
      edges.set(nodeIdFor(layer, 1), [
        nodeIdFor(nextLayer, 0),
        nodeIdFor(nextLayer, 1),
        nodeIdFor(nextLayer, 2),
      ]);
    } else {
      // Within an act between non-boss layers — fan ±1 column.
      for (let c = 0; c < COLUMNS; c++) {
        const choices: string[] = [];
        for (const dc of [-1, 0, 1]) {
          const nc = c + dc;
          if (nc < 0 || nc >= COLUMNS) continue;
          choices.push(nodeIdFor(layer + 1, nc));
        }
        edges.set(nodeIdFor(layer, c), choices);
      }
    }
  }

  const finalBossId = nodeIdFor(TOTAL_LAYERS - 1, 1);
  return { nodes, byId, edges, startId, finalBossId, currentId: startId };
}

/** True if `layer` is the boss layer of any act. */
function isBossLayer(layer: number): boolean {
  // Act I boss = layer 4; Act II = 8; Act III = 12.
  return layer === 4 || layer === 8 || layer === 12;
}

/** True if `layer` is the last non-boss layer before a boss. */
function isPreBossLayer(layer: number): boolean {
  return layer === 3 || layer === 7 || layer === 11;
}

/** Number of non-boss layers per act — exposed for UI and tests. */
export const RUN_MAP_TOTAL_LAYERS = TOTAL_LAYERS;
