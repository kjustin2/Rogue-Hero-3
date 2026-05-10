export type GamePhase =
  | "menu"
  | "hero_select"
  | "playing"
  | "paused"
  | "boss_intro"
  | "door_open"
  | "reward"
  | "hand_pick"
  | "transitioning"
  | "victory"
  | "dead";

export class GameState {
  phase: GamePhase = "menu";
  roomIndex = 0;
  totalRooms = 1;
  /** Run-scoped currency. Earned from perfect-clear bonuses + elite kills. */
  shards = 0;
  /** Mid-fight elapsed time for the current boss fight (drives enrage). */
  bossElapsed = 0;
  /** When > 0, the next room's enemies start at 50% HP (Pyre shrine effect). */
  pyreActive = false;
  /** When > 0, cancel the next room's anomaly (anomaly_scroll shop offer). */
  anomalyScrollCharges = 0;
  /** Stacking max-HP debt from Skull modifier — reduces max HP for the run. */
  skullDebt = 0;
  /** Active boss-curse id (or null). Awards +1 reward roll on the boss kill. */
  bossCurseId: string | null = null;
  /** Stash for the half-HP boss curse — restored after the fight ends. */
  preBossMaxHp = 0;
  /** When true, the next card-reward picker shows 4 options instead of 3. */
  bossCurseRewardBonus = false;

  setPhase(p: GamePhase): void {
    this.phase = p;
  }

  isInteractive(): boolean {
    // door_open lets the player walk to the exit, so input must remain live.
    return this.phase === "playing" || this.phase === "door_open";
  }

  /** Should the entire gameplay observable bail out (no movement, no AI, no FX ticks)? */
  isFrozen(): boolean {
    return this.phase === "menu" || this.phase === "paused" || this.phase === "hero_select";
  }
}
