import { ARENA_RADIUS, THEMES } from "../render/arena";
import { PitWarden } from "./boss";
import { SpireCaster } from "./bossSpire";
import { Colossus } from "./bossColossus";
import { RiftTyrant } from "./bossTyrant";
import { Unmaker } from "./bossUnmaker";
import { RiftEcho } from "./bossEcho";
import { makeEnemy, type Enemy, type EnemyKind } from "./enemies";
import { rollAffixes, affixById } from "./affixes";
import { generatePlan, type MapNode, type NodeKind, type RunPlan, type SpawnList } from "./mapgen";
import type { Ctx } from "./ctx";

type FieldKind = Exclude<EnemyKind, "boss">;

export type BossKind = "warden" | "spire" | "colossus" | "tyrant" | "unmaker" | "echo";

interface BossEntry {
  name: string;
  title: string;
  make: (c: Ctx, x: number, z: number) => Enemy;
}

export const BOSSES: Record<BossKind, BossEntry> = {
  warden: { name: "THE PIT WARDEN", title: "Keeper of the Ember Rift", make: (c, x, z) => new PitWarden(c, x, z) },
  spire: { name: "THE SPIRE CASTER", title: "Warden of the Glass Crown", make: (c, x, z) => new SpireCaster(c, x, z) },
  colossus: { name: "THE COLOSSUS", title: "Engine of the Core", make: (c, x, z) => new Colossus(c, x, z) },
  tyrant: { name: "THE RIFT TYRANT", title: "The Wound Made Flesh", make: (c, x, z) => new RiftTyrant(c, x, z) },
  unmaker: { name: "THE UNMAKER", title: "The Hollow Star", make: (c, x, z) => new Unmaker(c, x, z) },
  echo: { name: "THE RIFT ECHO", title: "Your Reflection, Sharpened", make: (c, x, z) => new RiftEcho(c, x, z) },
};

export const ROMAN = ["I", "II", "III", "IV", "V"];

/** Elite anchors: a normal enemy scaled up, then given 1–2 random affixes. */
function makeElite(kind: FieldKind, ctx: Ctx, x: number, z: number): Enemy {
  const e = makeEnemy(kind, ctx, x, z);
  e.hp = e.maxHp = Math.round(e.maxHp * 2.5);
  e.radius *= 1.3;
  e.speed *= 0.92;
  e.root.scale.multiplyScalar(1.35);
  const affixes = rollAffixes(ctx.rng, ctx.difficulty.depth);
  for (const id of affixes) {
    const def = affixById(id);
    if (def) e.applyAffix(id, def.color);
  }
  const label = "ELITE" + affixes.map((id) => " · " + (affixById(id)?.label ?? "")).join("");
  ctx.floaters.spawn(x, 2.6, z, label, "label");
  return e;
}

/** Champion: a 2-affix mini-boss — far tankier and bigger than an elite. */
function makeChampion(kind: FieldKind, ctx: Ctx, x: number, z: number): Enemy {
  const e = makeEnemy(kind, ctx, x, z);
  e.hp = e.maxHp = Math.round(e.maxHp * 4.5);
  e.radius *= 1.5;
  e.speed *= 0.9;
  e.root.scale.multiplyScalar(1.6);
  // Force two affixes regardless of depth (rollAffixes gives 2 at depth ≥ 6).
  const affixes = rollAffixes(ctx.rng, Math.max(6, ctx.difficulty.depth));
  for (const id of affixes) {
    const def = affixById(id);
    if (def) e.applyAffix(id, def.color);
  }
  const label = "CHAMPION" + affixes.map((id) => " · " + (affixById(id)?.label ?? "")).join("");
  ctx.floaters.spawn(x, 3.0, z, label, "label");
  return e;
}

type RunState = "idle" | "fighting" | "cleared" | "victory";

/**
 * Drives a run over a generated forked-path map (`mapgen.ts`). Combat/elite/boss
 * nodes load the arena and fight here; main.ts owns the map screen + interstitial
 * nodes (shop/treasure/rest/event) and tells us when to advance. Mid-act bosses
 * resolve as room clears (full heal, scaled by Ascension); only the final-act
 * boss wins the run. Events (ROOM_START/ROOM_CLEARED/ACT_START/BOSS_INTRO/
 * RUN_VICTORY) are unchanged so HUD/music/cutscenes keep working.
 */
export class RunManager {
  plan: RunPlan = { seed: 0, depth: 0, forks: [] };
  position = 0;
  state: RunState = "idle";
  currentNode: MapNode | null = null;
  /** Chosen option index per fork (for the map trail + save). */
  path: number[] = [];
  private waveIndex = 0;
  private prevAct = 0;

  constructor(private ctx: Ctx) {
    ctx.events.on("BOSS_DEFEATED", () => {
      if (this.state !== "fighting") return;
      this.ctx.stats.roomsCleared++;
      if (this.position >= this.plan.forks.length - 1) {
        this.state = "victory";
        this.ctx.events.emit("RUN_VICTORY", {});
        return;
      }
      // Mid-act boss: pop surviving adds, heal (scaled by Ascension), clear flow
      this.state = "cleared";
      for (const e of this.ctx.enemies.living()) if (e.kind !== "boss") e.takeDamage(99999);
      this.ctx.hostiles.clear();
      this.heal(this.ctx.player.maxHp - this.ctx.player.hp);
      this.ctx.events.emit("ROOM_CLEARED", { index: this.position, reward: this.currentNode?.reward ?? "card" });
    });
  }

  get totalForks(): number {
    return this.plan.forks.length;
  }

  /** The 1–3 options at the current fork. */
  forkOptions(): MapNode[] {
    return this.plan.forks[this.position] ?? [];
  }

  /** A forced fork (act entry / boss) auto-enters; a choice fork shows the map. */
  get isChoice(): boolean {
    return this.forkOptions().length > 1;
  }

  /** Start a fresh plan (caller then drives selection + loading). */
  begin(plan: RunPlan): void {
    this.plan = plan;
    this.position = 0;
    this.path = [];
    this.prevAct = 0;
    this.state = "idle";
    this.currentNode = null;
  }

  /** Restore from a save: same plan (regenerated from seed+depth), jump to position. */
  restore(plan: RunPlan, position: number, path: number[]): void {
    this.plan = plan;
    this.position = Math.max(0, Math.min(position, plan.forks.length - 1));
    this.path = path.slice();
    this.prevAct = 0;
    this.state = "idle";
    this.currentNode = null;
  }

  /** Pick option i at the current fork; records the choice and sets currentNode. */
  select(i: number): MapNode {
    const opts = this.forkOptions();
    const idx = Math.max(0, Math.min(i, opts.length - 1));
    this.path[this.position] = idx;
    this.currentNode = opts[idx];
    return this.currentNode;
  }

  /** Advance to the next fork after the current node fully resolves. */
  proceed(): void {
    if (this.position < this.plan.forks.length - 1) this.position++;
  }

  /** Load the current combat/elite/boss node into the arena. Interstitials never call this. */
  loadCurrentNode(): void {
    const node = this.currentNode;
    if (!node) return;
    const { ctx } = this;
    this.waveIndex = 0;
    this.state = "fighting";

    ctx.enemies.clear();
    ctx.projectiles.clear();
    ctx.hostiles.clear();
    ctx.caster.clear();

    ctx.arena.applyTheme(THEMES[node.theme]);
    ctx.arena.setObstacles(node.obstacles ?? [], THEMES[node.theme].crystal);
    ctx.fx.ambientColor = THEMES[node.theme].ember;
    ctx.fx.ambientRate = node.bossKind ? 14 : 7;
    ctx.stats.actReached = Math.max(ctx.stats.actReached, node.act);

    ctx.player.pos.set(0, 0, ARENA_RADIUS * 0.55);
    ctx.player.facing = Math.PI;
    ctx.cam.snapTo(ctx.player.pos.x, ctx.player.pos.z);
    ctx.fx.ring(ctx.player.pos.x, ctx.player.pos.z, { radius: 3, color: 0x66ddff, duration: 0.6 });

    ctx.events.emit("ROOM_START", { index: this.position, name: node.name, isBoss: !!node.bossKind, act: node.act, elite: !!node.elite });
    if (node.act !== this.prevAct) {
      ctx.events.emit("ACT_START", { act: node.act, name: node.actName });
      this.prevAct = node.act;
    }
    ctx.relics.onRoomStart();

    if (node.bossKind) {
      const boss = BOSSES[node.bossKind];
      const bx = 0;
      const bz = -ARENA_RADIUS * 0.4;
      ctx.events.emit("BOSS_INTRO", { name: boss.name, title: boss.title, x: bx, z: bz });
      ctx.enemies.spawnCustom((c, x, z) => {
        const e = boss.make(c, x, z);
        e.setSpawnGrace(5.0);
        return e;
      }, bx, bz, 2.4);
      // Ascension boss variant: from Rift Depth 5, the boss arrives with an honor guard.
      if (ctx.difficulty.depth >= 5) {
        const guard: Record<number, FieldKind> = { 1: "spitter", 2: "wisp", 3: "caster", 4: "harrier", 5: "warper" };
        const k = guard[node.act] ?? "spitter";
        ctx.enemies.spawn(k, -8, -2, 5.2);
        ctx.enemies.spawn(k, 8, -2, 5.6);
      }
    } else {
      this.spawnWave(node.waves[0] ?? []);
    }
    ctx.features.setup(node); // hazard patches / teleporters for this chamber
  }

  /** A little vitality, scaled by Ascension's healMult. */
  private heal(amount: number): void {
    const heal = Math.round(amount * this.ctx.difficulty.healMult);
    if (heal <= 0) return;
    this.ctx.player.hp = Math.min(this.ctx.player.maxHp, this.ctx.player.hp + heal);
    this.ctx.events.emit("HEAL", { amount: heal });
  }

  private spawnWave(wave: SpawnList): void {
    const { ctx } = this;
    const p = ctx.player.pos;
    for (const [kind, count, eliteFlag] of wave) {
      for (let i = 0; i < count; i++) {
        let x = 0;
        let z = 0;
        for (let attempt = 0; attempt < 16; attempt++) {
          const a = ctx.rng.range(0, Math.PI * 2);
          const r = ctx.rng.range(5, ARENA_RADIUS - 3);
          x = Math.sin(a) * r;
          z = Math.cos(a) * r;
          const clearOfPillars = ctx.arena.obstacles.every((o) => Math.hypot(x - o.x, z - o.z) > o.r + 1.2);
          if (Math.hypot(x - p.x, z - p.z) > 7 && clearOfPillars) break;
        }
        const delay = 0.8 + ctx.rng.range(0, 0.6);
        if (eliteFlag === "champion") {
          ctx.enemies.spawnCustom((c, xx, zz) => makeChampion(kind, c, xx, zz), x, z, delay + 0.4);
        } else if (eliteFlag === "elite") {
          ctx.enemies.spawnCustom((c, xx, zz) => makeElite(kind, c, xx, zz), x, z, delay + 0.3);
        } else {
          ctx.enemies.spawn(kind, x, z, delay);
        }
      }
    }
  }

  update(): void {
    if (this.state !== "fighting") return;
    const node = this.currentNode;
    if (!node) return;
    if (this.ctx.enemies.remaining > 0) return;
    if (node.bossKind) return; // resolved via BOSS_DEFEATED

    this.waveIndex++;
    if (this.waveIndex < node.waves.length) {
      this.spawnWave(node.waves[this.waveIndex]);
    } else {
      this.state = "cleared";
      this.ctx.stats.roomsCleared++;
      this.ctx.hostiles.clear();
      this.heal(12);
      this.ctx.events.emit("ROOM_CLEARED", { index: this.position, reward: node.reward });
    }
  }

  // ----------------------------------------------------------- dev / test
  /** Jump straight to a node of a given kind/act (smoke tests). Always regenerates a
   *  guaranteed plan (depth 5 forces an elite per act), so combat/elite/boss are findable. */
  debugLoadNode(kind: NodeKind, act: number, seed = 424242, depth = 5): boolean {
    this.begin(generatePlan(seed, depth));
    for (let i = 0; i < this.plan.forks.length; i++) {
      // Skip the optional Rift Echo superboss node — "load act N's boss" means the act's
      // real boss; the echo lives in an earlier fork and would otherwise shadow it.
      const idx = this.plan.forks[i].findIndex(
        (n) => n.kind === kind && n.act === act && (kind !== "boss" || n.bossKind !== "echo"),
      );
      if (idx >= 0) {
        this.position = i;
        this.currentNode = this.plan.forks[i][idx];
        this.loadCurrentNode();
        return true;
      }
    }
    return false;
  }

  /** Jump straight to a specific boss (incl. the optional Rift Echo) for tests. */
  debugLoadBoss(bossKind: BossKind, act = 4, seed = 424242, depth = 5): boolean {
    this.begin(generatePlan(seed, depth));
    // Land on a real mid-map fork, then swap in a synthetic boss node of the requested kind.
    this.position = Math.min(act * 4 - 2, this.plan.forks.length - 2);
    this.currentNode = {
      id: -1, kind: "boss", act, actName: "DEBUG", name: bossKind === "echo" ? "A Rift Tear" : "Boss",
      theme: "abyss", reward: "relic", bossKind, waves: [],
    };
    this.loadCurrentNode();
    return true;
  }

  /** Warm boss shader/material variants under the boot loader. Bosses aren't in the
   *  enemy registry, so the first time one is constructed mid-run its materials
   *  compile on a live frame (a ~250ms+ stall). Build each off-screen, warm the
   *  whole scene, then dispose — so no boss ever compiles during play. */
  warmBosses(): void {
    const dummies: Enemy[] = [];
    for (const key of Object.keys(BOSSES) as BossKind[]) {
      try {
        const b = BOSSES[key].make(this.ctx, 0, -1000);
        b.warmVisuals();
        dummies.push(b);
      } catch { /* skip a bad ctor */ }
    }
    this.ctx.stage.warmUp();
    for (const b of dummies) b.dispose();
  }
}
