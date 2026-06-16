import type { Ctx } from "./ctx";

/**
 * Overdrive — the active payoff for the Tempo meter. At Critical (≥90) the player
 * may spend the heat to ignite a short, hero-specific super. Each hero turns the
 * meter into a different fantasy; the meter is consumed on activation, so the only
 * gate is earning your way back to Critical. Systems consult the query getters at
 * their existing chokepoints (dealDamage, damagePlayer, deck cooldowns, enemy
 * speed, move speed).
 */
interface OdConfig {
  name: string;
  /** Outgoing damage multiplier. */
  dmg: number;
  /** Incoming damage multiplier (lower = tankier). */
  dr: number;
  /** Fraction of damage dealt returned as HP. */
  lifesteal?: number;
  /** Cards cost no cooldown while active. */
  freeCasts?: boolean;
  /** Enemy move-speed multiplier while active (time-dilation feel). */
  enemySlow?: number;
  /** Player move-speed multiplier while active. */
  move?: number;
}

const DEFAULT: OdConfig = { name: "OVERDRIVE", dmg: 1.5, dr: 0.7 };

const CONFIG: Record<string, OdConfig> = {
  blade: { name: "TEMPO FLURRY", dmg: 1.6, dr: 0.7, enemySlow: 0.5 },
  bulwark: { name: "UNBROKEN", dmg: 1.35, dr: 0.3 },
  sparkmage: { name: "OVERFLOW", dmg: 1.5, dr: 0.7, freeCasts: true },
  reaver: { name: "BLOOD FRENZY", dmg: 1.6, dr: 0.85, lifesteal: 0.3 },
  tempest: { name: "CYCLONE", dmg: 1.4, dr: 0.65, move: 1.45, enemySlow: 0.75 },
  revenant: { name: "HARVEST", dmg: 1.5, dr: 0.8, lifesteal: 0.4 },
};

const DURATION = 5.0;
const THRESHOLD = 90;

export class Overdrive {
  active = false;
  private timer = 0;
  private cfg: OdConfig = DEFAULT;

  constructor(private ctx: Ctx) {}

  get ready(): boolean {
    return !this.active && this.ctx.tempo.value >= THRESHOLD && this.ctx.player.alive;
  }
  get timeLeft(): number { return this.active ? this.timer : 0; }
  get fraction(): number { return this.active ? this.timer / DURATION : 0; }
  get name(): string { return this.cfg.name; }

  get damageMult(): number { return this.active ? this.cfg.dmg : 1; }
  get damageTakenMult(): number { return this.active ? this.cfg.dr : 1; }
  get lifestealFrac(): number { return this.active ? this.cfg.lifesteal ?? 0 : 0; }
  get freeCasts(): boolean { return this.active && !!this.cfg.freeCasts; }
  get enemySpeedMult(): number { return this.active ? this.cfg.enemySlow ?? 1 : 1; }
  get moveSpeedMult(): number { return this.active ? this.cfg.move ?? 1 : 1; }

  tryActivate(): void {
    if (!this.ready) { this.ctx.sfx.deny(); return; }
    const hero = this.ctx.player.hero;
    this.cfg = CONFIG[hero.id] ?? DEFAULT;
    this.active = true;
    this.timer = DURATION;
    this.ctx.tempo.crash(35); // cash the Critical heat out into the super
    const p = this.ctx.player;
    this.ctx.events.emit("OVERDRIVE_START", { hero: hero.id, name: this.cfg.name });
    this.ctx.cam.addTrauma(0.5);
    this.ctx.cam.pulseFov(1);
    this.ctx.stage.punch(0.6);
    this.ctx.fx.ring(p.pos.x, p.pos.z, { radius: 7, color: 0xffe066, duration: 0.6 });
    this.ctx.fx.ring(p.pos.x, p.pos.z, { radius: 4, color: 0xffffff, duration: 0.45 });
    this.ctx.fx.burst({
      x: p.pos.x, y: 1, z: p.pos.z,
      count: 50, color: [0xffe066, 0xff8822, 0xffffff],
      speed: [4, 14], up: 0.9, size: [0.4, 1.0], life: [0.3, 0.8], gravity: -4, drag: 2.5,
    });
    this.ctx.sfx.crash();
  }

  /** Lifesteal hook — called by combat after a hit lands. */
  onDamageDealt(amount: number): void {
    const ls = this.lifestealFrac;
    if (ls <= 0 || amount <= 0) return;
    const p = this.ctx.player;
    if (!p.alive || p.hp >= p.maxHp) return;
    const heal = Math.max(1, Math.round(amount * ls));
    p.hp = Math.min(p.maxHp, p.hp + heal);
  }

  update(dt: number): void {
    if (!this.active) return;
    this.timer -= dt;
    const p = this.ctx.player;
    // A steady aura of embers while it burns.
    if (Math.random() < dt * 30) {
      this.ctx.fx.burst({
        x: p.pos.x, y: 0.6, z: p.pos.z,
        count: 2, color: [0xffe066, 0xff8822], speed: [0.5, 2.5], up: 2.4, size: [0.2, 0.5], life: [0.4, 0.9], gravity: 0.2, drag: 1.2, jitter: 0.5,
      });
    }
    if (this.timer <= 0) {
      this.active = false;
      this.timer = 0;
      this.ctx.events.emit("OVERDRIVE_END", {});
      this.ctx.fx.ring(p.pos.x, p.pos.z, { radius: 5, color: 0xffaa44, duration: 0.5 });
    }
  }

  reset(): void {
    this.active = false;
    this.timer = 0;
    this.cfg = DEFAULT;
  }
}
