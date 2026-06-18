/**
 * Compatibility shim for the removed Overdrive mechanic.
 *
 * The rest of the combat stack still queries this object at shared choke points.
 * Keeping neutral getters avoids a broad rewrite while removing the actual
 * gameplay layer and all player-facing activation.
 */
export class Overdrive {
  readonly active = false;

  constructor(_ctx?: unknown) {}

  get ready(): boolean { return false; }
  get timeLeft(): number { return 0; }
  get fraction(): number { return 0; }
  get name(): string { return ""; }

  get damageMult(): number { return 1; }
  get damageTakenMult(): number { return 1; }
  get lifestealFrac(): number { return 0; }
  get freeCasts(): boolean { return false; }
  get enemySpeedMult(): number { return 1; }
  get moveSpeedMult(): number { return 1; }

  tryActivate(): void {}
  onDamageDealt(_amount: number): void {}
  update(_dt: number): void {}
  reset(): void {}
}
