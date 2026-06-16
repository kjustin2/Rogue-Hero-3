import { CARDS, type CardDef } from "./cards";
import { RELICS, type RelicDef } from "./relics";
import { HEROES, type HeroDef } from "./heroes";
import { blessingById, type BlessingDef } from "./blessings";
import { DEFAULT_COSMETICS } from "./cosmetics";
import { MAX_DEPTH } from "./difficulty";
import type { RunStats } from "./ctx";

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
  /** Highest act whose boss has died (0–3). */
  actsCleared: number;
  /** Highest act ever reached. */
  furthestAct: number;
  bestTime: number | null;
  bestStreak: number;
  /** Highest Ascension depth unlocked (0-based; win depth N to unlock N+1). */
  maxDepth: number;
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

/** Mid-run checkpoint, written when each node is entered. v2 = forked-map runs. */
export interface RunSave {
  v: 2;
  /** Map regenerates deterministically from seed+depth; position locates the node. */
  seed: number;
  depth: number;
  position: number;
  path: number[];
  hero: string;
  hp: number;
  /** Saved so run-scoped max-HP gains (Vigor blessing, Warden's Heart) survive a resume. */
  maxHp?: number;
  slots: (string | null)[];
  /** Which slots hold a honed (upgraded) card. */
  upgraded?: boolean[];
  relics: string[];
  stats: RunStats;
}

const SAVE_KEY = "rh3v2-runsave";

export function loadRunSave(): RunSave | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as RunSave;
      // v1 (linear-room) saves are no longer compatible — silently dropped.
      if (s.v === 2 && typeof s.seed === "number" && typeof s.position === "number") return s;
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

// --- Daily challenge best (per-seed), kept tiny and self-contained.
const DAILY_KEY = "rh3v2-daily";
export interface DailyBest {
  seed: number;
  kills: number;
  time: number;
  won: boolean;
}

/** A stable integer seed for today's daily challenge. */
export function dailySeed(): number {
  const d = new Date();
  return (d.getFullYear() * 372 + (d.getMonth() + 1) * 31 + d.getDate()) >>> 0;
}

export function getDailyBest(seed: number): DailyBest | null {
  try {
    const raw = localStorage.getItem(DAILY_KEY);
    if (raw) {
      const d = JSON.parse(raw) as DailyBest;
      if (d.seed === seed) return d;
    }
  } catch { /* ignore */ }
  return null;
}

export function recordDailyBest(seed: number, kills: number, time: number, won: boolean): void {
  const prev = getDailyBest(seed);
  const next: DailyBest = prev
    ? { seed, kills: Math.max(prev.kills, kills), time: won ? (prev.won ? Math.min(prev.time, time) : time) : prev.time, won: prev.won || won }
    : { seed, kills, time, won };
  try { localStorage.setItem(DAILY_KEY, JSON.stringify(next)); } catch { /* ignore */ }
}

const KEY = "rh3v2-profile";

/** The base game: all 8 original cards + 5 relics + The Blade, free from the start. */
const STARTER_UNLOCKS = [
  "card:dash-strike", "card:arc-bolt", "card:cleave", "card:frost-nova",
  "card:phase-step", "card:mine-field", "card:aegis", "card:chain-lightning",
  "relic:bloodthirst", "relic:runaway-engine", "relic:metronome",
  "relic:kinetic-core", "relic:co-aggro-pact",
  "hero:blade",
];

function defaults(): ProfileData {
  return {
    v: 1,
    runs: 0, wins: 0, kills: 0, perfectDodges: 0, crashes: 0, bossesKilled: 0,
    actsCleared: 0, furthestAct: 1, bestTime: null, bestStreak: 0,
    maxDepth: 0,
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

export const MILESTONES: Milestone[] = [
  { id: "slayer-25", desc: "Slay 40 enemies", unlocks: ["card:sunder"], check: (p) => p.kills >= 40 },
  { id: "act1-clear", desc: "Defeat the Pit Warden", unlocks: ["card:meteor-call", "card:bleeding-edge"], check: (p) => p.actsCleared >= 1 },
  { id: "slayer-150", desc: "Slay 280 enemies", unlocks: ["relic:frost-chord"], check: (p) => p.kills >= 280 },
  { id: "dodge-master", desc: "18 perfect dodges in one run", unlocks: ["relic:adrenal-surge"], check: (_p, run) => !!run && run.perfectDodges >= 18 },
  { id: "untouchable", desc: "Clear Act I taking 60 damage or less", unlocks: ["relic:ironclad"], check: (p, run) => p.actsCleared >= 1 && !!run && run.actReached >= 2 && run.damageTaken <= 60 },
  { id: "streak-8", desc: "Reach an 8-kill streak", unlocks: ["card:gravity-well"], check: (p, run) => p.bestStreak >= 8 || (!!run && run.bestStreak >= 8) },
  { id: "act2-clear", desc: "Defeat the Spire Caster", unlocks: ["card:storm-conduit", "relic:berserker-sigil"], check: (p) => p.actsCleared >= 2 },
  { id: "crash-20", desc: "Crash your tempo 34 times", unlocks: ["card:charged-lance"], check: (p) => p.crashes >= 34 },
  { id: "slayer-400", desc: "Slay 680 enemies", unlocks: ["relic:bulwark-idol"], check: (p) => p.kills >= 680 },
  { id: "first-win", desc: "Seal the Rift — win a full run", unlocks: ["card:ember-wave", "relic:chain-amulet"], check: (p) => p.wins >= 1 },
  // --- Heroes (each unlocks its signature, hero-locked card alongside it)
  { id: "hero-bulwark", desc: "Defeat the Pit Warden", unlocks: ["hero:bulwark", "card:shield-bash"], check: (p) => p.actsCleared >= 1 },
  { id: "hero-sparkmage", desc: "Defeat the Spire Caster", unlocks: ["hero:sparkmage", "card:singularity"], check: (p) => p.actsCleared >= 2 },
  // --- Expansion II content
  { id: "streak-12", desc: "Reach a 12-kill streak", unlocks: ["card:blade-cyclone"], check: (p, run) => p.bestStreak >= 12 || (!!run && run.bestStreak >= 12) },
  { id: "dodge-50", desc: "85 lifetime perfect dodges", unlocks: ["card:riposte"], check: (p) => p.perfectDodges >= 85 },
  { id: "crash-35", desc: "Crash your tempo 58 times", unlocks: ["card:tempo-theft"], check: (p) => p.crashes >= 58 },
  { id: "second-seal", desc: "Seal the Rift twice", unlocks: ["card:starfall"], check: (p) => p.wins >= 2 },
  { id: "veteran-5", desc: "Brave the Rift 8 times", unlocks: ["relic:second-wind"], check: (p) => p.runs >= 8 },
  { id: "slayer-40-run", desc: "Slay 55 enemies in one run", unlocks: ["relic:thorn-plate"], check: (_p, run) => !!run && run.kills >= 55 },
  { id: "rich-1500", desc: "Earn 2400 lifetime shards", unlocks: ["relic:lucky-coin"], check: (p) => p.shardsEarned >= 2400 },
  { id: "crash-50", desc: "Crash your tempo 82 times", unlocks: ["relic:resonant-bell"], check: (p) => p.crashes >= 82 },
  { id: "slayer-800", desc: "Slay 1350 enemies", unlocks: ["relic:glass-cannon"], check: (p) => p.kills >= 1350 },
  // --- Expansion III content
  { id: "slayer-300", desc: "Slay 520 enemies", unlocks: ["hero:reaver", "card:rend-boomerang"], check: (p) => p.kills >= 520 },
  { id: "dodge-75", desc: "125 lifetime perfect dodges", unlocks: ["hero:tempest", "card:tempest-storm"], check: (p) => p.perfectDodges >= 125 },
  { id: "third-seal", desc: "Seal the Rift three times", unlocks: ["card:spectral-volley"], check: (p) => p.wins >= 3 },
  { id: "veteran-10", desc: "Brave the Rift 15 times", unlocks: ["card:glacial-lance"], check: (p) => p.runs >= 15 },
  { id: "veteran-15", desc: "Brave the Rift 22 times", unlocks: ["card:seismic-slam"], check: (p) => p.runs >= 22 },
  { id: "streak-15", desc: "Reach a 15-kill streak", unlocks: ["card:warcry"], check: (p, run) => p.bestStreak >= 15 || (!!run && run.bestStreak >= 15) },
  { id: "slayer-1200", desc: "Slay 1950 enemies", unlocks: ["card:soul-harvest"], check: (p) => p.kills >= 1950 },
  { id: "slayer-600b", desc: "Slay 1000 enemies", unlocks: ["relic:molten-heart"], check: (p) => p.kills >= 1000 },
  { id: "crash-75", desc: "Crash your tempo 122 times", unlocks: ["relic:siphon-sigil"], check: (p) => p.crashes >= 122 },
  { id: "dodge-100", desc: "165 lifetime perfect dodges", unlocks: ["relic:tempo-capacitor"], check: (p) => p.perfectDodges >= 165 },
  { id: "boss-6", desc: "Slay 9 wardens", unlocks: ["relic:executioner"], check: (p) => p.bossesKilled >= 9 },
  { id: "rich-4000", desc: "Earn 6500 lifetime shards", unlocks: ["relic:rampart"], check: (p) => p.shardsEarned >= 6500 },
  // --- Expansion IV content (Act V + new cards)
  { id: "slayer-60", desc: "Slay 110 enemies", unlocks: ["card:seeker-swarm"], check: (p) => p.kills >= 110 },
  { id: "act3-clear", desc: "Defeat the Colossus", unlocks: ["card:flame-channel"], check: (p) => p.actsCleared >= 3 },
  { id: "veteran-3", desc: "Brave the Rift 4 times", unlocks: ["card:decoy-totem"], check: (p) => p.runs >= 4 },
  { id: "rich-800", desc: "Earn 1300 lifetime shards", unlocks: ["card:leech-orb"], check: (p) => p.shardsEarned >= 1300 },
  { id: "streak-10", desc: "Reach a 10-kill streak", unlocks: ["card:tempo-edge"], check: (p, run) => p.bestStreak >= 10 || (!!run && run.bestStreak >= 10) },
  // --- Expansion V: status-combo relics + tiers
  { id: "slayer-500", desc: "Slay 840 enemies", unlocks: ["relic:shatterglass"], check: (p) => p.kills >= 840 },
  { id: "crash-60", desc: "Crash your tempo 98 times", unlocks: ["relic:hex-brand"], check: (p) => p.crashes >= 98 },
  { id: "slayer-700", desc: "Slay 1180 enemies", unlocks: ["relic:ember-codex"], check: (p) => p.kills >= 1180 },
  { id: "fourth-seal", desc: "Seal the Rift four times", unlocks: ["relic:overcharger"], check: (p) => p.wins >= 4 },
  { id: "streak-20", desc: "Reach a 20-kill streak", unlocks: ["relic:tempo-engine"], check: (p, run) => p.bestStreak >= 20 || (!!run && run.bestStreak >= 20) },
  { id: "veteran-20", desc: "Brave the Rift 28 times", unlocks: ["relic:featherbone"], check: (p) => p.runs >= 28 },
  { id: "hero-revenant", desc: "Slay 1650 enemies", unlocks: ["hero:revenant"], check: (p) => p.kills >= 1650 },
  // --- Run-start blessings: locked at first, earned through play.
  { id: "bless-vigor", desc: "Brave the Rift 2 times", unlocks: ["blessing:vigor"], check: (p) => p.runs >= 2 },
  { id: "bless-arsenal", desc: "Defeat the Pit Warden", unlocks: ["blessing:arsenal"], check: (p) => p.actsCleared >= 1 },
  { id: "bless-fortune", desc: "Earn 850 lifetime shards", unlocks: ["blessing:fortune"], check: (p) => p.shardsEarned >= 850 },
];

export type UnlockedItem =
  | { kind: "card"; def: CardDef }
  | { kind: "relic"; def: RelicDef }
  | { kind: "hero"; def: HeroDef }
  | { kind: "blessing"; def: BlessingDef };

function resolveUnlock(key: string): UnlockedItem | null {
  const [kind, id] = key.split(":");
  if (kind === "card") {
    const def = CARDS.find((c) => c.id === id);
    return def ? { kind: "card", def } : null;
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
    return this.data.unlocks.includes(key);
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

  /** Run over — merge lifetime stats, evaluate, persist. Returns everything unlocked this run. */
  recordRun(outcome: RunRecord["outcome"], run: RunStats): UnlockedItem[] {
    this.data.runs++;
    if (outcome === "victory") {
      this.data.wins++;
      if (this.data.bestTime === null || run.time < this.data.bestTime) this.data.bestTime = run.time;
      // Win at your current ceiling → the next Rift Depth opens.
      if (run.depth >= this.data.maxDepth) this.data.maxDepth = Math.min(run.depth + 1, MAX_DEPTH);
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
