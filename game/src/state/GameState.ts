export type GamePhase = "playing" | "reward" | "transitioning" | "victory" | "dead";

export class GameState {
  phase: GamePhase = "playing";
  roomIndex = 0;
  totalRooms = 1;

  setPhase(p: GamePhase): void {
    this.phase = p;
  }

  isInteractive(): boolean {
    return this.phase === "playing";
  }
}
