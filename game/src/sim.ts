// All combat authority lives here. No renderer, browser state, or wall clock.
export type Kind = "blade" | "hook" | "bearer" | "cantor" | "boss";
export type Action =
  | "idle"
  | "slash"
  | "heavy"
  | "dodge"
  | "tell"
  | "strike"
  | "recover"
  | "awaken"
  | "dead";
export type Phase = "title" | "fight" | "between" | "dead" | "won";
export interface RunCheckpoint {
  version: 1;
  room: number;
  hp: number;
  seed: number;
  bossPractice: boolean;
}
export interface Actor {
  id: number;
  kind: Kind;
  x: number;
  z: number;
  angle: number;
  hp: number;
  max: number;
  action: Action;
  time: number;
  duration: number;
  cooldown: number;
  hit: boolean;
  flash: number;
  combo: number;
  bossPhase: 1 | 2;
  attackIndex: number;
}
export interface Input {
  x: number;
  z: number;
  aim: number;
  attack: boolean;
  heavy: boolean;
  dodge: boolean;
}
export interface Effect {
  x: number;
  z: number;
  angle: number;
  kind: "cut" | "heavySwing" | "slam" | "hit" | "impact" | "impactHeavy" | "dashDust" | "ring" | "core" | "death" | "bossDeath" | "sweep";
  time: number;
  life: number;
  enemy: boolean;
}
export interface Cue {
  kind: "heavy" | "swing" | "hit" | "hurt" | "dodge" | "bell" | "bossToll";
}
export const ROOM = { x: 11, z: 9 };
export const BELL = { inner: 1.8, outer: 6.2, echo: 2.8 };
export const BOSS_BODY = 1.45;
export const CROSS_ANGLE = 0.65;
export const BOSS_SWEEP = { reach: 4.5, arc: 1.35 };
export const ENEMY_IMPACT = { hook: 0.07, bearer: 0.14, cantor: 0.18, boss: 0.16, blade: 0.09 };
export const ROOM_TRANSITION = 2.2;
export const MAX_STEP = 0.034;
export const LUNGE = { speed: 9, impact: 0.07, reach: 2.35, arc: 0.9 };
export const STRIKES = {
  slash: { impact: 0.09, duration: 0.32, reach: 2.65, arc: 1.25, damage: 18 },
  heavy: { impact: 0.34, duration: 0.86, reach: 3.4, arc: 0.62, damage: 38 },
};
export const PILLARS = [
  { x: -6, z: -3, r: 1 },
  { x: 6, z: -3, r: 1 },
  { x: -6, z: 4, r: 0.8 },
  { x: 6, z: 4, r: 0.8 },
];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const angleDiff = (a: number, b: number) =>
  Math.atan2(Math.sin(a - b), Math.cos(a - b));
const distance = (a: Actor, b: Actor) => Math.hypot(a.x - b.x, a.z - b.z);
function clearLine(a: Actor, b: Actor) {
  const dx = b.x - a.x,
    dz = b.z - a.z,
    length = dx * dx + dz * dz;
  return PILLARS.every((p) => {
    const t = length
      ? clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / length, 0, 1)
      : 0;
    return Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z) > p.r;
  });
}
export class Game {
  slain: Kind[] = [];
  phase: Phase = "title";
  paused = false;
  bossPractice = false;
  time = 0;
  room = 0;
  seed = 319;
  nextId = 0;
  player = this.actor("blade", 0, 4);
  enemies: Actor[] = [];
  effects: Effect[] = [];
  cues: Cue[] = [];
  training = false;
  checkpoint: RunCheckpoint | null = null;
  private intermission = 0;
  transitionVariant: 0 | 1 | 2 = 0;
  dodgeRecovery = 0.72;
  cause = "";
  private buffer: {
    action: "slash" | "heavy" | "dodge";
    remaining: number;
  } | null = null;
  private dodgeCd = 0;
  private actor(kind: Kind, x: number, z: number): Actor {
    const hp = { blade: 100, hook: 42, bearer: 72, cantor: 48, boss: 520 }[
      kind
    ];
    return {
      id: this.nextId++,
      kind,
      x,
      z,
      angle: Math.PI,
      hp,
      max: hp,
      action: "idle",
      time: 0,
      duration: 1,
      cooldown: 1,
      hit: false,
      flash: 0,
      combo: 0,
      bossPhase: 1,
      attackIndex: 0,
    };
  }
  random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
  start(
    seed = 319,
    bossPractice = false,
    room = bossPractice ? 3 : 0,
    hp = 100,
  ) {
    this.slain.length = 0;
    this.training = false;
    this.bossPractice = bossPractice;
    this.seed = seed;
    this.player = this.actor("blade", 0, 4);
    this.phase = "fight";
    this.paused = false;
    this.room = room;
    this.player.hp = hp;
    this.dodgeRecovery = 0.72;
    this.dodgeCd = 0;
    this.player.combo = 2;
    this.effects = [];
    this.cues = [];
    this.enter();
  }
  private enter() {
    this.checkpoint = {
      version: 1,
      room: this.room,
      hp: this.player.hp,
      seed: this.seed,
      bossPractice: this.bossPractice,
    };
    this.buffer = null;
    this.enemies = [];
    this.effects = [];
    this.player.x = 0;
    this.player.z = 5;
    this.set(this.player, "idle", 1);
    this.player.cooldown = 0.6;
    const encounters: Kind[][] = [
      ["hook", "bearer"],
      ["hook", "cantor", "hook"],
      ["bearer", "cantor", "hook", "bearer"],
      ["boss"],
    ];
    encounters[this.room].forEach((kind, i) => {
      const e = this.actor(
        kind,
        (i - (encounters[this.room].length - 1) / 2) * 3.2,
        -4 - this.random() * 1.8,
      );
      e.cooldown = 0.9 + i * 0.38;
      if (kind === "boss") {
        e.angle = Math.atan2(this.player.x - e.x, this.player.z - e.z);
        this.set(e, "awaken", 1.6);
        this.cues.push({ kind: "bossToll" });
      }
      this.enemies.push(e);
    });
  }
  private set(a: Actor, action: Action, duration: number) {
    a.action = action;
    a.time = 0;
    a.duration = duration;
    a.hit = false;
  }
  private move(a: Actor, dx: number, dz: number) {
    const oldX = a.x, oldZ = a.z;
    a.x = clamp(a.x + dx, -ROOM.x + 0.6, ROOM.x - 0.6);
    a.z = clamp(a.z + dz, -ROOM.z + 0.6, ROOM.z - 0.6);
    for (const p of PILLARS) {
      const x = a.x - p.x,
        z = a.z - p.z,
        d = Math.hypot(x, z),
        r = p.r + (a.kind === "boss" ? 0.85 : 0.4);
      if (d < r) {
        a.x = p.x + (d ? x / d : 1) * r;
        a.z = p.z + (d ? z / d : 0) * r;
      }
    }
    const obstacle = a.kind === "blade" ? this.enemies.find(e => e.kind === "boss" && e.hp > 0) : a.kind === "boss" ? this.player : undefined;
    if (obstacle && obstacle.hp > 0 && distance(a, obstacle) < BOSS_BODY) {
      const angle = Math.atan2(oldX - obstacle.x, oldZ - obstacle.z);
      const x = a.x - obstacle.x, z = a.z - obstacle.z, d = Math.hypot(x, z);
      a.x = obstacle.x + (d > 0.001 ? x / d : Math.sin(angle)) * BOSS_BODY;
      a.z = obstacle.z + (d > 0.001 ? z / d : Math.cos(angle)) * BOSS_BODY;
      // Do not resolve body contact by pushing either actor through a wall/pillar.
      if (Math.abs(a.x) > ROOM.x - 0.6 || Math.abs(a.z) > ROOM.z - 0.6 || PILLARS.some(p => Math.hypot(a.x - p.x, a.z - p.z) < p.r + (a.kind === "boss" ? 0.85 : 0.4))) {
        a.x = oldX; a.z = oldZ;
      }
    }
  }

  private fx(a: Actor, kind: Effect["kind"], life = 0.24) {
    this.effects.push({
      x: a.x,
      z: a.z,
      angle: a.angle,
      kind,
      time: 0,
      life,
      enemy: a.kind !== "blade",
    });
  }
  private hurt(a: Actor, damage: number, source: string) {
    if (a.hp <= 0) return;
    a.hp = Math.max(0, a.hp - damage);
    a.flash = damage >= STRIKES.heavy.damage ? 0.24 : 0.16;
    this.fx(a, a.kind === "blade" ? "hit" : damage >= STRIKES.heavy.damage ? "impactHeavy" : "impact", damage >= STRIKES.heavy.damage ? 0.28 : 0.21);
    this.cues.push({
      kind: a.kind === "blade" ? "hurt" : "hit",
    });
    if (a.hp === 0) {
      this.set(a, "dead", a.kind === "boss" ? 2.6 : a.kind === "blade" ? 0.9 : 1.15);
      if (a.kind !== "blade") this.slain.push(a.kind);
      this.fx(a, a.kind === "boss" ? "bossDeath" : "death", a.kind === "boss" ? 2.6 : 1.15);
      if (a.kind === "blade") {
        this.phase = "dead";
        this.cause = source;
      }
    }
  }
  private playerHit(heavy: boolean) {
    const p = this.player;
    const strike = STRIKES[heavy ? "heavy" : "slash"];
    this.fx(p, heavy ? "heavySwing" : "cut", heavy ? 0.16 : 0.22);
    this.cues.push({ kind: heavy ? "heavy" : "swing" });
    for (const e of this.enemies) {
      if (e.hp <= 0 || !clearLine(p, e)) continue;
      const d = distance(p, e),
        angle = Math.atan2(e.x - p.x, e.z - p.z);
      if (
        d < strike.reach &&
        Math.abs(angleDiff(angle, p.angle)) < strike.arc
      ) {
        this.hurt(e, strike.damage + (!heavy && p.combo === 2 ? 7 : 0), "");
        if (e.hp > 0 && heavy && e.kind !== "boss")
          this.set(e, "recover", 0.75);
        if (e.kind !== "boss" && e.action !== "tell" && e.action !== "strike")
          this.move(e, Math.sin(p.angle) * 0.25, Math.cos(p.angle) * 0.25);
      }
    }
  }
  private enemyHit(e: Actor) {
    const p = this.player;
    if (!clearLine(e, p)) return;
    if (p.action === "dodge" || p.cooldown > 0 || p.hp <= 0) return;
    const d = distance(e, p),
      a = Math.atan2(p.x - e.x, p.z - e.z);
    let hit = false;
    if (e.kind === "boss" && e.combo === 4) hit = d < 7 && [-CROSS_ANGLE, CROSS_ANGLE].some(offset => Math.abs(angleDiff(a, e.angle + offset)) < 0.24);
    else if (e.kind === "boss" && e.combo === 1) hit = d < BOSS_SWEEP.reach && Math.abs(angleDiff(a, e.angle)) < BOSS_SWEEP.arc;
    else if (e.kind === "boss" && e.combo === 3) hit = d < BELL.echo;
    else if (e.kind === "cantor" || (e.kind === "boss" && e.combo === 2))
      hit = d > BELL.inner && d < BELL.outer;
    else if (e.kind === "bearer" || e.kind === "boss")
      hit = d < 7 && Math.abs(angleDiff(a, e.angle)) < 0.24;
    else hit = d < LUNGE.reach && Math.abs(angleDiff(a, e.angle)) < LUNGE.arc;
    if (hit) {
      this.hurt(
        p,
        e.kind === "boss" ? 24 : e.kind === "bearer" ? 20 : 14,
        {
          hook: "The Knife Penitent",
          bearer: "The Bell-bearer",
          cantor: "The Grave Cantor",
          boss: "The Bellwether",
          blade: "",
        }[e.kind],
      );
      p.cooldown = 0.6;
    }
  }
  update(dt: number, input: Input) {
    dt = Math.min(MAX_STEP, Math.max(0, dt));
    if (!this.paused && this.phase === "between") {
      this.intermission += dt;
      if (this.intermission >= this.transitionDuration) {
        this.room++;
        this.player.hp = Math.min(this.player.max, this.player.hp + 18);
        this.phase = "fight";
        this.enter();
      }
      return;
    }
    if (this.paused || this.phase !== "fight") {
      this.buffer = null;
      // Finish the fall without continuing combat or accepting another action.
      if (!this.paused && this.phase === "dead") {
        this.player.time = Math.min(
          this.player.duration,
          this.player.time + dt,
        );
        this.player.flash = Math.max(0, this.player.flash - dt);
        this.effects = this.effects.filter((f) => (f.time += dt) < f.life);
      }
      return;
    }
    this.time += dt;
    this.effects = this.effects.filter((f) => (f.time += dt) < f.life);
    this.dodgeCd = Math.max(0, this.dodgeCd - dt);
    const p = this.player;
    p.cooldown = Math.max(0, p.cooldown - dt);
    p.flash = Math.max(0, p.flash - dt);
    p.time += dt;
    const requested = input.dodge
      ? "dodge"
      : input.heavy
        ? "heavy"
        : input.attack
          ? "slash"
          : null;
    if (requested) this.buffer = { action: requested, remaining: 0.16 };
    else if (this.buffer && (this.buffer.remaining -= dt) <= 0)
      this.buffer = null;
    if (
      this.buffer?.action === "dodge" &&
      this.dodgeCd === 0 &&
      p.action !== "heavy"
    ) {
      p.angle =
        Math.hypot(input.x, input.z) > 0.1
          ? Math.atan2(input.x, input.z)
          : input.aim;
      this.set(p, "dodge", 0.22);
      this.dodgeCd = this.dodgeRecovery;
      this.buffer = null;
      this.cues.push({ kind: "dodge" });
      this.fx(p, "dashDust", 0.3);
    }
    if (p.action === "idle") {
      p.angle = input.aim;
      const length = Math.hypot(input.x, input.z) || 1;
      this.move(
        p,
        (input.x / length) * 6.4 * dt,
        (input.z / length) * 6.4 * dt,
      );
      if (this.buffer?.action === "heavy") {
        this.set(p, "heavy", STRIKES.heavy.duration);
        this.buffer = null;
      } else if (this.buffer?.action === "slash") {
        p.combo = (p.combo + 1) % 3;
        this.set(p, "slash", STRIKES.slash.duration);
        this.buffer = null;
      }
    } else if (p.action === "dodge")
      this.move(p, Math.sin(p.angle) * 18 * dt, Math.cos(p.angle) * 18 * dt);
    else if (
      (p.action === "slash" || p.action === "heavy") &&
      !p.hit &&
      p.time >= STRIKES[p.action].impact
    ) {
      p.hit = true;
      this.playerHit(p.action === "heavy");
      if (p.action === "slash") this.move(p, Math.sin(p.angle) * 0.35, Math.cos(p.angle) * 0.35);
    }
    if (p.action === "heavy" && p.time > 0.24 && p.time <= STRIKES.heavy.impact) {
      const step = Math.min(dt, p.time - 0.24) * 3.5;
      this.move(p, Math.sin(p.angle) * step, Math.cos(p.angle) * step);
    }
    if (p.action !== "idle" && p.action !== "dead" && p.time >= p.duration)
      this.set(p, "idle", 1);
    for (const e of this.enemies) {
      e.flash = Math.max(0, e.flash - dt);
      e.time += dt;
      if (e.hp <= 0) continue;
      if (e.kind === "boss" && e.bossPhase === 1 && e.hp <= e.max * 0.5) {
        e.bossPhase = 2; e.attackIndex = 0;
        this.set(e, "awaken", 1.2);
        this.cues.push({ kind: "bossToll" });
      }
      if (e.action === "awaken") {
        if (e.time >= e.duration) { this.set(e, "idle", 1); e.cooldown = 0.35; }
        continue;
      }
      const d = distance(e, p),
        target = Math.atan2(p.x - e.x, p.z - e.z);
      if (e.action === "idle") {
        const blocked = !clearLine(e, p);
        e.angle = target;
        e.cooldown -= dt;
        const desired = e.kind === "cantor" ? 4.8 : e.kind === "hook" ? 2 : 5;
        if (d > desired || blocked) {
          const flank = blocked
            ? (e.id % 2 ? 1 : -1) * 0.65
            : e.kind === "hook"
              ? Math.sin(e.id) * 0.6
              : 0;
          this.move(
            e,
            Math.sin(target + flank) * dt * (e.kind === "hook" ? 3.8 : 2),
            Math.cos(target + flank) * dt * (e.kind === "hook" ? 3.8 : 2),
          );
        } else if (e.kind === "cantor" && d < 3)
          this.move(
            e,
            -Math.sin(target) * dt * 1.4,
            -Math.cos(target) * dt * 1.4,
          );
        if (!blocked && e.cooldown <= 0 && d < (e.kind === "hook" ? 3 : 8)) {
          this.set(
            e,
            "tell",
            e.kind === "hook" ? 0.55 : e.kind === "boss" ? 0.85 : 1,
          );
          if (e.kind === "boss") {
            const attacks = e.bossPhase === 1 ? [0, 1] : [2, 4, 3];
            e.combo = attacks[e.attackIndex++ % attacks.length];
          }
        }
      } else if (e.action === "tell" && e.time >= e.duration) {
        this.set(e, "strike", e.kind === "hook" ? 0.22 : e.kind === "boss" ? 0.48 : 0.42);
      } else if (e.action === "strike") {
        if (e.kind === "hook")
          this.move(
            e,
            Math.sin(e.angle) * dt * LUNGE.speed,
            Math.cos(e.angle) * dt * LUNGE.speed,
          );
        if (!e.hit && e.time >= ENEMY_IMPACT[e.kind]) {
          e.hit = true;
          this.enemyHit(e);
          this.fx(
            e,
            e.kind === "boss" && e.combo === 1
              ? "sweep"
              : e.kind === "boss" && e.combo === 3
              ? "core"
              : e.kind === "cantor" || (e.kind === "boss" && e.combo === 2)
                ? "ring"
                : e.kind === "hook"
                  ? "cut"
                  : "slam",
            0.3,
          );
          if (e.kind === "boss" && e.combo === 4) {
            this.effects.pop();
            for (const offset of [-CROSS_ANGLE, CROSS_ANGLE]) {
              this.fx(e, "slam", 0.3);
              this.effects[this.effects.length - 1].angle += offset;
            }
          }
          this.cues.push({ kind: "bell" });
        }
        if (e.time >= e.duration) {
          // A second, fully warned pulse reverses the safe space. The boss stays planted.
          if (e.kind === "boss" && e.combo === 2 && e.bossPhase === 2) {
            e.combo = 3;
            this.set(e, "tell", 0.8);
          } else
            this.set(
              e,
              "recover",
              e.kind === "boss" ? (e.combo === 3 ? 1.35 : 1.1) : 0.75,
            );
        }
      } else if (e.action === "recover" && e.time >= e.duration) {
        this.set(e, "idle", 1);
        e.cooldown = e.kind === "boss" && e.hp < e.max * 0.5 ? 0.2 : 0.6;
      }
    }
    // Let small enemies recover their footing after a lunge or a dodge through them.
    // Never displace the player, a committed attack, or the planted boss.
    if (p.hp > 0 && p.action !== "dodge")
      for (const e of this.enemies) {
        if (
          e.hp <= 0 ||
          e.kind === "boss" ||
          (e.action !== "idle" && e.action !== "recover")
        )
          continue;
        const d = distance(e, p);
        if (d >= 1.05) continue;
        const step = Math.min(1.05 - d, 3 * dt);
        this.move(
          e,
          (d > 0.001 ? (e.x - p.x) / d : -Math.sin(e.angle)) * step,
          (d > 0.001 ? (e.z - p.z) / d : -Math.cos(e.angle)) * step,
        );
      }
    // Separate living silhouettes without adding physics or moving committed attacks.
    for (let i = 0; i < this.enemies.length; i++)
      for (let j = i + 1; j < this.enemies.length; j++) {
        const a = this.enemies[i],
          b = this.enemies[j],
          d = distance(a, b);
        if (a.hp > 0 && b.hp > 0 && d < 1.15 && d > 0.001) {
          const dx = ((a.x - b.x) / d) * 0.7 * dt,
            dz = ((a.z - b.z) / d) * 0.7 * dt;
          if (a.action === "idle") this.move(a, dx, dz);
          if (b.action === "idle") this.move(b, -dx, -dz);
        }
      }
    if (
      !this.training &&
      this.phase === "fight" &&
      this.enemies.every((e) => e.hp === 0 && e.time >= e.duration)
    ) {
      this.phase = this.room === 3 ? "won" : "between";
      this.intermission = 0;
      if (this.phase === "between") this.transitionVariant = Math.floor(this.random() * 3) as 0 | 1 | 2;
      this.effects = [];
    }
  }
  get transitionProgress() {
    return this.phase === "between" ? this.intermission / this.transitionDuration : 0;
  }
  get transitionDuration() {
    return ROOM_TRANSITION;
  }
  get dodgeReady() {
    return this.dodgeCd === 0;
  }
}
