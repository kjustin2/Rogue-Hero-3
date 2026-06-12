/**
 * Typed synchronous pub-sub. Event names and payloads are compile-checked —
 * a typo'd emit is a type error, not a silent no-op (the v1 codebase's biggest pitfall).
 */
export interface EventMap {
  ENEMY_HIT: { x: number; y: number; z: number; dmg: number; heavy: boolean; killed: boolean };
  KILL: { x: number; z: number; kind: string };
  COMBO_HIT: { count: number };
  KILL_STREAK: { count: number };
  PLAYER_HIT: { dmg: number };
  PLAYER_DIED: Record<string, never>;
  DODGE: Record<string, never>;
  PERFECT_DODGE: { x: number; z: number };
  CARD_CAST: { id: string };
  CARD_FAIL: { slot: number };
  TEMPO_ZONE: { zone: TempoZone; prev: TempoZone };
  CRASH: { x: number; z: number };
  COLD_CRASH: { x: number; z: number };
  SHIELD_GAINED: { amount: number };
  SHIELD_BROKEN: Record<string, never>;
  ROOM_START: { index: number; name: string; isBoss: boolean };
  ROOM_CLEARED: { index: number; reward: "card" | "relic" };
  ACT_START: { act: number; name: string };
  RELIC_ADDED: { id: string };
  RUN_VICTORY: Record<string, never>;
  BOSS_INTRO: { name: string; title: string };
  BOSS_PHASE: { phase: number; line: string };
  BOSS_DEFEATED: { x: number; z: number };
  BOSS_HP: { hp: number; maxHp: number };
  EXPLOSION: { x: number; z: number; radius: number };
  FREEZE: Record<string, never>;
  UI_HOVER: Record<string, never>;
  UI_CLICK: Record<string, never>;
  DRAFT_OPEN: Record<string, never>;
  HEAL: { amount: number };
}

export type TempoZone = "cold" | "flowing" | "hot" | "critical";

type Handler<K extends keyof EventMap> = (payload: EventMap[K]) => void;

export class EventBus {
  private handlers = new Map<keyof EventMap, Set<Handler<keyof EventMap>>>();

  on<K extends keyof EventMap>(name: K, fn: Handler<K>): () => void {
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    set.add(fn as Handler<keyof EventMap>);
    return () => set.delete(fn as Handler<keyof EventMap>);
  }

  emit<K extends keyof EventMap>(name: K, payload: EventMap[K]): void {
    const set = this.handlers.get(name);
    if (!set) return;
    for (const fn of set) (fn as Handler<K>)(payload);
  }
}
