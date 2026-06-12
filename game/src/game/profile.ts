import { CARDS, type CardDef } from "./cards";
import { RELICS, type RelicDef } from "./relics";
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
  unlocks: string[];
  earnedMilestones: string[];
  history: RunRecord[];
}

const KEY = "rh3v2-profile";

/** The base game: all 8 original cards + 5 relics, free from the start. */
const STARTER_UNLOCKS = [
  "card:dash-strike", "card:arc-bolt", "card:cleave", "card:frost-nova",
  "card:phase-step", "card:mine-field", "card:aegis", "card:chain-lightning",
  "relic:bloodthirst", "relic:runaway-engine", "relic:metronome",
  "relic:kinetic-core", "relic:co-aggro-pact",
];

function defaults(): ProfileData {
  return {
    v: 1,
    runs: 0, wins: 0, kills: 0, perfectDodges: 0, crashes: 0, bossesKilled: 0,
    actsCleared: 0, furthestAct: 1, bestTime: null, bestStreak: 0,
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
];

export type UnlockedItem =
  | { kind: "card"; def: CardDef }
  | { kind: "relic"; def: RelicDef };

function resolveUnlock(key: string): UnlockedItem | null {
  const [kind, id] = key.split(":");
  if (kind === "card") {
    const def = CARDS.find((c) => c.id === id);
    return def ? { kind: "card", def } : null;
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
}
