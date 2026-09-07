import { CARDS, cardById, type CardDef } from "./cards";
import { RELICS, type RelicDef, type RelicRunState } from "./relics";
import type { TempoState } from "./tempo";
import { HEROES, type HeroDef } from "./heroes";
import { blessingById, type BlessingDef } from "./blessings";
import { COSMETICS, DEFAULT_COSMETICS, type CosmeticDef } from "./cosmetics";
import { MAX_DEPTH } from "./difficulty";
import { freshStats, type RunStats } from "./ctx";
import { isRunPlan, type RunPlan } from "./mapgen";

export interface RunRecord {
  outcome: "victory" | "death" | "abandon";
  act: number;
  kills: number;
  time: number;
  depth: number;
  date: number;
}

interface ProfileData {
  v: 1;
  runs: number;
  wins: number;
  kills: number;
  perfectDodges: number;
  crashes: number;
  bossesKilled: number;
  /** Highest act whose boss has died (0–5). */
  actsCleared: number;
  /** Highest act ever reached. */
  furthestAct: number;
  bestTime: number | null;
  bestStreak: number;
  /** Highest Ascension depth unlocked (0-based; win depth N to unlock N+1). */
  maxDepth: number;
  /** Hero mastery: wins per hero id, and the deepest depth each has won at. */
  heroWins: Record<string, number>;
  heroBestWinDepth: Record<string, number>;
  /** Kills of the Ascension true-final boss (The Wound Beneath, depth 3+). */
  woundKills: number;
  /** Rift-shard balance + lifetime earnings (the Armory currency). */
  shards: number;
  shardsEarned: number;
  cosmeticsOwned: string[];
  equipped: { cape: string; blade: string };
  lastHero: string;
  unlocks: string[];
  earnedMilestones: string[];
  history: RunRecord[];
}

/** Complete boundary checkpoint, written after rewards and before the next fork. */
export interface RunSave {
  v: 2;
  /** Legacy saves regenerate from seed+depth; current saves preserve their route. */
  seed: number;
  plan?: RunPlan;
  depth: number;
  position: number;
  path: number[];
  hero: string;
  hp: number;
  /** Both vitality gains and shrine sacrifices survive a resume. */
  maxHp?: number;
  slots: (string | null)[];
  /** Which slots hold a honed (upgraded) card. */
  upgraded?: boolean[];
  relics: string[];
  rngState?: number;
  castCount?: number;
  relicState?: RelicRunState;
  tempo?: TempoState;
  stats: RunStats;
}

const SAVE_KEY = "rh3v2-runsave";

export function loadRunSave(): RunSave | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as RunSave;
      // v1 (linear-room) saves are no longer compatible — silently dropped.
      if (s.v === 2 && Number.isFinite(s.seed) && Number.isInteger(s.position) && s.position >= 0
        && Number.isInteger(s.depth) && s.depth >= 0 && s.depth <= MAX_DEPTH && Number.isFinite(s.hp)
        && Array.isArray(s.slots) && Array.isArray(s.path) && Array.isArray(s.relics) && s.stats && typeof s.stats === "object") {
        const seen = new Set<string>();
        s.hero = "blade";
        s.slots = Array.from({ length: 3 }, (_, index) => {
          const id = s.slots[index];
          if (!id) return null;
          try {
            const card = cardById(id);
            if (seen.has(card.id)) return null;
            seen.add(card.id);
            return card.id;
          } catch { return null; }
        });
        s.path = s.path.slice(0,64).map(i=>Number.isInteger(i) && i>=0 && i<3 ? i : 0);
        s.upgraded = Array.from({length:3},(_,i)=>!!s.slots[i] && s.upgraded?.[i]===true);
        s.relics = [...new Set(s.relics.filter(id=>typeof id==="string" && RELICS.some(r=>r.id===id)))];
        const stats = freshStats();
        for (const key of Object.keys(stats) as (keyof RunStats)[]) {
          const value = s.stats[key];
          if (Number.isFinite(value) && value >= 0) stats[key] = value;
        }
        stats.depth = s.depth;
        s.stats = stats;
        if (!Number.isInteger(s.rngState) || s.rngState! < 0 || s.rngState! > 0xffffffff) delete s.rngState;
        if (!Number.isInteger(s.castCount) || s.castCount! < 0) delete s.castCount;
        if (!s.relicState || typeof s.relicState !== "object") delete s.relicState;
        if (!s.tempo || typeof s.tempo !== "object") delete s.tempo;
        if (!Number.isFinite(s.maxHp) || (s.maxHp ?? 0) <= 0) delete s.maxHp;
        if (!isRunPlan(s.plan,s.seed,s.depth)) delete s.plan;
        return s;
      }
    }
  } catch { /* corrupt — ignore */ }
  return null;
}

export function writeRunSave(save: RunSave): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch { /* private mode */ }
}

export function clearRunSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch { /* ignore */ }
}

const KEY = "rh3v2-profile";

/** Abilities are discovered within runs; permanent progression unlocks relics and blessings. */
const STARTER_UNLOCKS = [
  ...CARDS.map(card => `card:${card.id}`),
  "relic:bloodthirst", "relic:runaway-engine", "relic:metronome",
  "relic:kinetic-core", "relic:co-aggro-pact",
  "relic:frost-chord", "relic:shatterglass", "relic:chain-amulet",
  "relic:ember-codex", "relic:bulwark-idol",
  "relic:keepers-thread", "relic:widows-needle",
  "hero:blade",
];

function defaults(): ProfileData {
  return {
    v: 1,
    runs: 0, wins: 0, kills: 0, perfectDodges: 0, crashes: 0, bossesKilled: 0,
    actsCleared: 0, furthestAct: 1, bestTime: null, bestStreak: 0,
    maxDepth: 0,
    heroWins: {}, heroBestWinDepth: {},
    woundKills: 0,
    shards: 0, shardsEarned: 0,
    cosmeticsOwned: [DEFAULT_COSMETICS.cape, DEFAULT_COSMETICS.blade],
    equipped: { ...DEFAULT_COSMETICS },
    lastHero: "blade",
    unlocks: [...STARTER_UNLOCKS],
    earnedMilestones: [],
    history: [],
  };
}

export interface Milestone {
  id: string;
  /** Condition text, shown on locked entries in the progress screen. */
  desc: string;
  unlocks: string[];
  check: (p: ProfileData, run: RunStats | null) => boolean;
}

// Every specialty has an initial supporting relic. Further rewards arrive through
// readable feats and a few early runs, with deep wins reserved for cosmetic mastery.
export const MILESTONES: Milestone[] = [
  { id: "dodge-master", desc: "6 perfect dodges in one run", unlocks: ["relic:adrenal-surge"], check: (_p, run) => !!run && run.perfectDodges >= 6 },
  { id: "untouchable", desc: "Clear Act I taking 60 damage or less", unlocks: ["relic:ironclad"], check: (p, run) => p.actsCleared >= 1 && !!run && run.actReached >= 2 && run.damageTaken <= 60 },
  { id: "act2-clear", desc: "Defeat the Glass Regent", unlocks: ["relic:berserker-sigil"], check: (p) => p.actsCleared >= 2 },
  { id: "veteran-5", desc: "Brave the Rift 3 times", unlocks: ["relic:second-wind"], check: (p) => p.runs >= 3 },
  { id: "slayer-40-run", desc: "Slay 35 enemies in one run", unlocks: ["relic:thorn-plate"], check: (_p, run) => !!run && run.kills >= 35 },
  { id: "rich-1500", desc: "Earn 600 lifetime shards", unlocks: ["relic:lucky-coin"], check: (p) => p.shardsEarned >= 600 },
  { id: "crash-50", desc: "Crash your tempo 18 times", unlocks: ["relic:resonant-bell"], check: (p) => p.crashes >= 18 },
  { id: "slayer-800", desc: "Slay 250 enemies", unlocks: ["relic:glass-cannon"], check: (p) => p.kills >= 250 },
  { id: "slayer-600b", desc: "Slay 500 enemies", unlocks: ["relic:molten-heart"], check: (p) => p.kills >= 500 },
  { id: "crash-75", desc: "Crash your tempo 40 times", unlocks: ["relic:siphon-sigil"], check: (p) => p.crashes >= 40 },
  { id: "dodge-100", desc: "30 lifetime perfect dodges", unlocks: ["relic:tempo-capacitor"], check: (p) => p.perfectDodges >= 30 },
  { id: "boss-6", desc: "Slay 5 wardens", unlocks: ["relic:executioner"], check: (p) => p.bossesKilled >= 5 },
  { id: "rich-4000", desc: "Earn 1500 lifetime shards", unlocks: ["relic:rampart"], check: (p) => p.shardsEarned >= 1500 },
  { id: "crash-60", desc: "Crash your tempo 28 times", unlocks: ["relic:hex-brand"], check: (p) => p.crashes >= 28 },
  { id: "fourth-seal", desc: "Seal the Rift twice", unlocks: ["relic:overcharger"], check: (p) => p.wins >= 2 },
  { id: "streak-20", desc: "Reach an 8-kill streak", unlocks: ["relic:tempo-engine"], check: (p, run) => p.bestStreak >= 8 || (!!run && run.bestStreak >= 8) },
  { id: "veteran-20", desc: "Brave the Rift 6 times", unlocks: ["relic:featherbone"], check: (p) => p.runs >= 6 },
  // --- Run-start blessings: locked at first, earned slowly through play.
  { id: "bless-vigor", desc: "Brave the Rift 5 times", unlocks: ["blessing:vigor"], check: (p) => p.runs >= 5 },
  { id: "bless-arsenal", desc: "Defeat the Glass Regent", unlocks: ["blessing:arsenal"], check: (p) => p.actsCleared >= 2 },
  { id: "bless-fortune", desc: "Earn 2000 lifetime shards", unlocks: ["blessing:fortune"], check: (p) => p.shardsEarned >= 2000 },
  // --- Hero mastery: each hero's first win + a depth-5 win earn exclusive cosmetics.
  ...HEROES.flatMap((h): Milestone[] => [
    { id: `mastery-${h.id}-1`, desc: `Seal the Rift as ${h.name}`, unlocks: [`cosmetic:blade-sig-${h.id}`], check: (p) => (p.heroWins[h.id] ?? 0) >= 1 },
    { id: `mastery-${h.id}-5`, desc: `Seal the Rift at Depth 5+ as ${h.name}`, unlocks: [`cosmetic:cape-sig-${h.id}`], check: (p) => (p.heroBestWinDepth[h.id] ?? -1) >= 5 },
  ]),
  // --- The Ascension summit: winning the final depth earns a title + a unique blade.
  { id: "depth-15", desc: "Seal the Rift at Depth 15", unlocks: ["cosmetic:blade-riftgold"], check: (p) => p.history.some((r) => r.outcome === "victory" && r.depth >= 15) },
  { id: "wound-slayer", desc: "Slay the Wound Beneath (Depth 3+)", unlocks: ["cosmetic:blade-woundbreaker"], check: (p) => p.woundKills >= 1 },
];

export type UnlockedItem =
  | { kind: "card"; def: CardDef }
  | { kind: "relic"; def: RelicDef }
  | { kind: "hero"; def: HeroDef }
  | { kind: "blessing"; def: BlessingDef }
  | { kind: "cosmetic"; def: CosmeticDef };

function resolveUnlock(key: string): UnlockedItem | null {
  const [kind, id] = key.split(":");
  if (kind === "card") {
    const def = CARDS.find((c) => c.id === id);
    return def ? { kind: "card", def } : null;
  }
  if (kind === "cosmetic") {
    const def = COSMETICS.find((c) => c.id === id);
    return def ? { kind: "cosmetic", def } : null;
  }
  if (kind === "hero") {
    const def = HEROES.find((h) => h.id === id);
    return def ? { kind: "hero", def } : null;
  }
  if (kind === "blessing") {
    const def = blessingById(id);
    return def ? { kind: "blessing", def } : null;
  }
  const def = RELICS.find((r) => r.id === id);
  return def ? { kind: "relic", def } : null;
}

/**
 * Persistent meta-progression (localStorage). Lifetime stats, milestone
 * unlocks that gate draft pools, and recent run history — all surfaced on
 * the main-menu PROGRESS screen. Never throws on corrupt storage.
 */
export class Profile {
  data: ProfileData;
  /** Unlocks earned mid-run (boss milestones) — surfaced on the end screen. */
  private runUnlocks: string[] = [];

  constructor() {
    this.data = defaults();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<ProfileData>;
        this.data = { ...defaults(), ...parsed, unlocks: parsed.unlocks ?? defaults().unlocks };
      }
    } catch { /* corrupt storage — fresh profile */ }
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch { /* private mode */ }
  }

  isUnlocked(key: string): boolean {
    if (key.startsWith("card:")) return CARDS.some(c => `card:${c.id}` === key);
    return STARTER_UNLOCKS.includes(key) || this.data.unlocks.includes(key);
  }

  /** Milestone condition text for a locked item, for the progress grid. */
  unlockHintFor(key: string): string {
    const m = MILESTONES.find((m) => m.unlocks.includes(key));
    return m ? m.desc : "???";
  }

  beginRun(): void {
    this.runUnlocks = [];
  }

  /** Evaluate milestones against a stats view; returns keys newly unlocked. */
  private evaluateWith(view: ProfileData, run: RunStats | null): string[] {
    const fresh: string[] = [];
    for (const m of MILESTONES) {
      if (this.data.earnedMilestones.includes(m.id)) continue;
      if (!m.check(view, run)) continue;
      this.data.earnedMilestones.push(m.id);
      for (const key of m.unlocks) {
        if (!this.data.unlocks.includes(key)) {
          this.data.unlocks.push(key);
          // Earned cosmetics land straight in the wardrobe (never shard-bought).
          if (key.startsWith("cosmetic:")) {
            const id = key.slice("cosmetic:".length);
            if (!this.data.cosmeticsOwned.includes(id)) this.data.cosmeticsOwned.push(id);
          }
          fresh.push(key);
        }
      }
    }
    return fresh;
  }

  /**
   * Mid-run boss kill: bank act progress + evaluate immediately, so a death
   * later in the run can't take an earned unlock away. Lifetime counters
   * merge only at run end, so milestones see a provisional combined view.
   */
  noteBossKill(actCleared: number, run: RunStats): void {
    this.data.bossesKilled++;
    this.data.actsCleared = Math.max(this.data.actsCleared, actCleared);
    const provisional: ProfileData = {
      ...this.data,
      kills: this.data.kills + run.kills,
      perfectDodges: this.data.perfectDodges + run.perfectDodges,
      crashes: this.data.crashes + run.crashes,
    };
    this.runUnlocks.push(...this.evaluateWith(provisional, run));
    this.save();
  }

  /** The Ascension true-final boss fell — banked immediately, like boss kills. */
  noteWoundKill(): void {
    this.data.woundKills++;
    this.save();
  }

  /** Run over — merge lifetime stats, evaluate, persist. Returns everything unlocked this run. */
  recordRun(outcome: RunRecord["outcome"], run: RunStats): UnlockedItem[] {
    this.data.runs++;
    if (outcome === "victory") {
      this.data.wins++;
      if (this.data.bestTime === null || run.time < this.data.bestTime) this.data.bestTime = run.time;
      // Win at your current ceiling → the next Rift Depth opens.
      if (run.depth >= this.data.maxDepth) this.data.maxDepth = Math.min(run.depth + 1, MAX_DEPTH);
      // Hero mastery: lastHero is set at run start, so it names this run's hero.
      const h = this.data.lastHero;
      this.data.heroWins[h] = (this.data.heroWins[h] ?? 0) + 1;
      this.data.heroBestWinDepth[h] = Math.max(this.data.heroBestWinDepth[h] ?? -1, run.depth);
    }
    this.data.kills += run.kills;
    this.data.perfectDodges += run.perfectDodges;
    this.data.crashes += run.crashes;
    this.data.shards += run.shards;
    this.data.shardsEarned += run.shards;
    this.data.furthestAct = Math.max(this.data.furthestAct, run.actReached);
    this.data.bestStreak = Math.max(this.data.bestStreak, run.bestStreak);
    this.data.history.unshift({
      outcome,
      act: run.actReached,
      kills: run.kills,
      time: run.time,
      depth: run.depth,
      date: Date.now(),
    });
    this.data.history = this.data.history.slice(0, 10);

    this.runUnlocks.push(...this.evaluateWith(this.data, run));
    this.save();

    const items = this.runUnlocks
      .map(resolveUnlock)
      .filter((x): x is UnlockedItem => x !== null);
    this.runUnlocks = [];
    return items;
  }

  // ------------------------------------------------------------- armory
  ownsCosmetic(id: string): boolean {
    return this.data.cosmeticsOwned.includes(id);
  }

  buyCosmetic(id: string, price: number): boolean {
    if (this.ownsCosmetic(id) || this.data.shards < price) return false;
    this.data.shards -= price;
    this.data.cosmeticsOwned.push(id);
    this.save();
    return true;
  }

  equipCosmetic(slot: "cape" | "blade", id: string): void {
    if (!this.ownsCosmetic(id)) return;
    this.data.equipped[slot] = id;
    this.save();
  }

  setLastHero(id: string): void {
    this.data.lastHero = id;
    this.save();
  }
}
