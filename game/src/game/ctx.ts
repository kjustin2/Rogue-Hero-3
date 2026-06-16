import type { Stage } from "../render/stage";
import type { CameraRig } from "../render/cameraRig";
import type { Particles } from "../render/particles";
import type { SwordTrail } from "../render/trail";
import type { Telegraphs } from "../render/telegraphs";
import type { Floaters } from "../render/floaters";
import type { Arena } from "../render/arena";
import type { Input } from "../core/input";
import type { EventBus } from "../core/events";
import type { Rng } from "../core/rng";
import type { Player } from "./player";
import type { Controller } from "./controller";
import type { Tempo } from "./tempo";
import type { Overdrive } from "./overdrive";
import type { Combat } from "./combat";
import type { Projectiles, HostileProjectiles } from "./projectiles";
import type { EnemyManager } from "./enemies";
import type { Deck } from "./deck";
import type { CardCaster } from "./cards";
import type { RunManager } from "./run";
import type { MapFeatures } from "./features";
import type { Relics } from "./relics";
import type { Profile } from "./profile";
import type { Sfx } from "../audio/sfx";
import type { Music } from "../audio/music";
import type { Difficulty } from "./difficulty";

export interface RunStats {
  kills: number;
  damageDealt: number;
  damageTaken: number;
  perfectDodges: number;
  roomsCleared: number;
  time: number;
  bestStreak: number;
  crashes: number;
  actReached: number;
  /** Ascension depth this run was played at. */
  depth: number;
  /** Rift shards earned this run (banked into the profile at run end). */
  shards: number;
}

export function freshStats(): RunStats {
  return {
    kills: 0, damageDealt: 0, damageTaken: 0, perfectDodges: 0,
    roomsCleared: 0, time: 0, bestStreak: 0, crashes: 0, actReached: 1, depth: 0, shards: 0,
  };
}

/**
 * Shared wiring hub. main.ts fills every field during boot before the first
 * frame; systems hold the ctx and reach peers through it. Type-only imports
 * keep this cycle-free at runtime.
 */
export interface Ctx {
  stage: Stage;
  cam: CameraRig;
  fx: Particles;
  trail: SwordTrail;
  tele: Telegraphs;
  floaters: Floaters;
  arena: Arena;
  input: Input;
  events: EventBus;
  rng: Rng;
  sfx: Sfx;
  music: Music;
  player: Player;
  controller: Controller;
  tempo: Tempo;
  overdrive: Overdrive;
  combat: Combat;
  projectiles: Projectiles;
  hostiles: HostileProjectiles;
  enemies: EnemyManager;
  deck: Deck;
  caster: CardCaster;
  run: RunManager;
  features: MapFeatures;
  relics: Relics;
  profile: Profile;
  /** Current run's Ascension difficulty (depth modifiers). */
  difficulty: Difficulty;
  stats: RunStats;
  /** True while gameplay systems should tick (not menu/paused/draft). */
  playing: boolean;
}
