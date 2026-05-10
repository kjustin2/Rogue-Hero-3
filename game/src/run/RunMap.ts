import { RoomDescriptor } from "./RunManager";
import { AnomalyId } from "./Anomalies";

/**
 * Branching map graph for a run. Three acts of three layers each, plus the
 * boss layer at the end of each act, plus a single START node. The player
 * picks one of up to three exits from each non-boss room.
 *
 * Layout (by layer index):
 *   0           = START
 *   1, 2, 3     = Act I non-boss layers (3 nodes each, columns 0/1/2)
 *   4           = Act I boss (1 node)
 *   5, 6, 7     = Act II non-boss layers
 *   8           = Act II boss
 *   9, 10, 11   = Act III non-boss layers
 *   12          = Act III boss (final)
 *
 * Edges fan from each (layer, col) to (layer+1, col-1), (layer+1, col), and
 * (layer+1, col+1) clipped to bounds. The pre-boss layer edges all converge
 * on the single boss node.
 */
export type RunNodeKind =
  | "start"
  | "combat"
  | "elite"
  | "shrine"
  | "shop"
  | "boss";

export interface RunNode {
  /** Unique id, e.g. "L3C1". */
  id: string;
  layer: number;
  column: number;
  kind: RunNodeKind;
  /** 0 = act I, 1 = act II, 2 = act III. */
  act: number;
  /**
   * Resolved descriptor; null until generation has filled it in. Set during
   * `MapGenerator.assignDescriptor` for every node so room-load is a simple
   * lookup at door-pass time.
   */
  descriptor: RoomDescriptor | null;
  /** Anomaly id for combat rooms, or null. Resolved at generation. */
  anomalyId: AnomalyId | null;
  /** Risk tier flag for layer-2 combat rooms (~15% roll). */
  riskTier: "normal" | "elite_dense";
  /** True after the player has cleared this node. */
  cleared: boolean;
}

export interface RunMap {
  /** All nodes, indexable by id via `byId`. */
  nodes: RunNode[];
  /** Direct lookup. */
  byId: Map<string, RunNode>;
  /** Adjacency: nodeId → next nodeIds the player can choose from. */
  edges: Map<string, string[]>;
  /** The starting node id (always layer 0). */
  startId: string;
  /** Final-boss node id (last layer of last act). */
  finalBossId: string;
  /** Currently-occupied node id. Updated by RunManager.loadNode. */
  currentId: string;
}

/** Build a node id from layer/column. */
export function nodeIdFor(layer: number, column: number): string {
  return `L${layer}C${column}`;
}

/** Get the next-choice node ids for the player's current location. */
export function nextChoices(map: RunMap): RunNode[] {
  const ids = map.edges.get(map.currentId) ?? [];
  const out: RunNode[] = [];
  for (const id of ids) {
    const n = map.byId.get(id);
    if (n) out.push(n);
  }
  return out;
}
