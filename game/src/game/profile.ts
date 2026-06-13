import { CARDS, type CardDef } from "./cards";
import { RELICS, type RelicDef } from "./relics";
import { HEROES, type HeroDef } from "./heroes";
import { DEFAULT_COSMETICS } from "./cosmetics";
import type { RunStats } from "./ctx";

export interface RunRecord {
  outcome: "victory" | "death" | "abandon";
  act: number;
  kills: number;
  time: number;
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

/** Mid-run checkpoint, written at every chamber boundary. */
export interface RunSave {
  v: 1;
  roomIndex: number;
  hero: string;
  hp: number;
  slots: (string | null)[];
  relics: string[];
  stats: RunStats;
}

const SAVE_KEY = "rh3v2-runsave";

export function loadRunSave(): RunSave | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as RunSave;
      if (s.v === 1 && typeof s.roomIndex === "number") return s;
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
  { id: "slayer-25", desc: "Slay 25 enemies", unlocks: ["card:sunder"], check: (p) => p.kills >= 25 },
  { id: "act1-clear", desc: "Defeat the Pit Warden", unlocks: ["card:meteor-call", "card:bleeding-edge"], check: (p) => p.actsCleared >= 1 },
  { id: "slayer-150", desc: "Slay 150 enemies", unlocks: ["relic:frost-chord"], check: (p) => p.kills >= 150 },
  { id: "dodge-master", desc: "15 perfect dodges in one run", unlocks: ["relic:adrenal-surge"], check: (_p, run) => !!run && run.perfectDodges >= 15 },
  { id: "untouchable", desc: "Clear Act I taking 60 damage or less", unlocks: ["relic:ironclad"], check: (p, run) => p.actsCleared >= 1 && !!run && run.actReached >= 2 && run.damageTaken <= 60 },
  { id: "streak-8", desc: "Reach an 8-kill streak", unlocks: ["card:gravity-well"], check: (p, run) => p.bestStreak >= 8 || (!!run && run.bestStreak >= 8) },
  { id: "act2-clear", desc: "Defeat the Spire Caster", unlocks: ["card:storm-conduit", "relic:berserker-sigil"], check: (p) => p.actsCleared >= 2 },
  { id: "crash-20", desc: "Crash your tempo 20 times", unlocks: ["card:charged-lance"], check: (p) => p.crashes >= 20 },
  { id: "slayer-400", desc: "Slay 400 enemies", unlocks: ["relic:bulwark-idol"], check: (p) => p.kills >= 400 },
  { id: "first-win", desc: "Seal the Rift — win a full run", unlocks: ["card:ember-wave", "relic:chain-amulet"], check: (p) => p.wins >= 1 },
  // --- Heroes
  { id: "hero-bulwark", desc: "Defeat the Pit Warden", unlocks: ["hero:bulwark"], check: (p) => p.actsCleared >= 1 },
  { id: "hero-sparkmage", desc: "Defeat the Spire Caster", unlocks: ["hero:sparkmage"], check: (p) => p.actsCleared >= 2 },
  // --- Expansion II content
  { id: "streak-12", desc: "Reach a 12-kill streak", unlocks: ["card:blade-cyclone"], check: (p, run) => p.bestStreak >= 12 || (!!run && run.bestStreak >= 12) },
  { id: "dodge-50", desc: "50 lifetime perfect dodges", unlocks: ["card:riposte"], check: (p) => p.perfectDodges >= 50 },
  { id: "crash-35", desc: "Crash your tempo 35 times", unlocks: ["card:tempo-theft"], check: (p) => p.crashes >= 35 },
  { id: "second-seal", desc: "Seal the Rift twice", unlocks: ["card:starfall"], check: (p) => p.wins >= 2 },
  { id: "veteran-5", desc: "Brave the Rift 5 times", unlocks: ["relic:second-wind"], check: (p) => p.runs >= 5 },
  { id: "slayer-40-run", desc: "Slay 40 enemies in one run", unlocks: ["relic:thorn-plate"], check: (_p, run) => !!run && run.kills >= 40 },
  { id: "rich-1500", desc: "Earn 1500 lifetime shards", unlocks: ["relic:lucky-coin"], check: (p) => p.shardsEarned >= 1500 },
  { id: "crash-50", desc: "Crash your tempo 50 times", unlocks: ["relic:resonant-bell"], check: (p) => p.crashes >= 50 },
  { id: "slayer-800", desc: "Slay 800 enemies", unlocks: ["relic:glass-cannon"], check: (p) => p.kills >= 800 },
];

export type UnlockedItem =
  | { kind: "card"; def: CardDef }
  | { kind: "relic"; def: RelicDef }
  | { kind: "hero"; def: HeroDef };

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
