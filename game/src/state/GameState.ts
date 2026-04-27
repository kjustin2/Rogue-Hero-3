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
