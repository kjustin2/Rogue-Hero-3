import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Enemy, EnemyDef } from "../Enemy";
import { Player } from "../../player/Player";
import { events } from "../../engine/EventBus";
import { Telegraph } from "../../fx/Telegraph";
import type { EnemyKind } from "../EnemyManager";

/**
 * Helper: sample the player's dominant archetype from the deck collection.
 * Read once per fight (first phase tick) so the boss can bias its AI.
 *
 * Late-bound import — DeckManager + CardDefinitions live outside the enemies
 * module tree, so we resolve via a globally-set accessor wired in main.ts.
 * This avoids creating a hard dependency from enemies → deck.
 */
let _archAccessor: (() => "fire" | "frost" | "storm" | null) | null = null;
export function setBossArchAccessor(fn: () => "fire" | "frost" | "storm" | null): void {
  _archAccessor = fn;
}
function sampleDominantArchetype(): "fire" | "frost" | "storm" | null {
  return _archAccessor ? _archAccessor() : null;
}

/**
 * Payload emitted on BOSS_PHASE. Adds per-boss enrage line + minion composition
 * so the main.ts listeners (banner + spawn) don't have to special-case bosses.
 */
export interface BossPhasePayload {
  bossId: string;
  phase: number;
  spawnPos: Vector3;
  enrageLine: string;
  spawnComposition: EnemyKind[];
}

/** Deferred strike used by every boss to resolve a windup at a future tick. */
interface PendingStrike {
  ttl: number;
  resolve: (player: Player) => void;
}

/**
 * Shared boss machinery: intro tween, phase-threshold transitions, contact
 * cooldown helper, deferred-strike queue, hyperarmor flag.
 *
 * Subclasses define their own attack FSM in `phaseAttackTick` and override the
 * per-phase config (`phaseHpThresholds`, `enrageLines`, `spawnComposition`).
 *
 * Why a base class: every boss currently inherits `BossBrawler` to reuse the
 * dash FSM, which means they all play the same fight. Pulling the cross-cutting
 * pieces (intro, healthbar plumbing, phase events, pending strikes) up here
 * lets each boss own its own combat verbs without dragging the brawler's FSM
 * along — and lets the new four-phase content (Earthsplitter, Mirror Spire,
 * Magma Mines) reuse one queue instead of redefining it per subclass.
 */
export abstract class BossBase extends Enemy {
  /** Intro animation — body lerps scale.y from 0.4 → 1.0 over `introDuration`. */
  introTimer = 3.0;
  introDuration = 3.0;
  /** Banner shown during intro (subclass override). */
  bossDisplayName = "BOSS";
  /** Optional subtitle line. Subclass override; empty = no subtitle row. */
  introSubtitle = "";
  /**
   * HP-fraction thresholds for phase transitions, descending. e.g. `[0.75, 0.50, 0.25]`
   * → phase 2 fires at 75% HP, phase 3 at 50%, phase 4 at 25%. Each fires once.
   * The matching `enrageLines` / `spawnComposition` entry is read at index
   * `phase - 2`.
   */
  protected phaseHpThresholds: number[] = [0.5];
  /** Banner string per phase transition. */
  protected enrageLines: string[] = ["BOSS ENRAGES"];
  /** Minion composition spawned on each phase transition. */
  protected spawnComposition: EnemyKind[][] = [["chaser", "chaser"]];
  /** Current phase (1-indexed). Starts at 1; advances each crossed threshold. */
  protected currentPhase = 1;
  /** Touch-damage cooldown; subclasses share this so chase-contact timing reads consistently. */
  protected contactCooldown = 0;
  /** Shared telegraph library for boss attacks (slam ring, sky-lance line, geyser disc, beam cone). */
  protected telegraph: Telegraph;
  /**
   * When true the boss ignores knockback impulses. Set during signature
   * windups (Brawler's Earthsplitter cock, Colossus's Tectonic Slam) so the
   * player can't stagger them out of a committed attack — preserves the
   * "this is happening, dodge it" pressure the plan calls for.
   */
  protected hyperarmorActive = false;
  /** Deferred strikes — drained each frame via `tickPending`. */
  protected pending: PendingStrike[] = [];
  /**
   * Total seconds the player has been engaged with this boss. Drives the
   * Enrage scaling — past 90 s the boss attacks faster + hits harder, capped
   * at +60% over a 90 s ramp. Subclasses read `enrageMultiplier()` to scale
   * windups and contact damage; reading is allocation-free.
   */
  protected fightElapsedSec = 0;
  /**
   * Dominant player archetype, sampled at first phase tick. Used by the
   * adaptive AI hooks below — the boss bias their attack mix slightly to
   * counter the player's dominant build. Set once and stable for the fight.
   */
  protected dominantArchetype: "fire" | "frost" | "storm" | null = null;
  private dominantSampled = false;

  constructor(
    scene: Scene,
    shadow: ShadowGenerator,
    def: EnemyDef,
    spawnPos: Vector3,
    bodyMesh: Mesh,
    idSuffix: string,
    telegraph: Telegraph,
  ) {
    super(scene, shadow, def, spawnPos, bodyMesh, idSuffix);
    this.telegraph = telegraph;
  }

  /** Per-frame attack/movement tick. Runs after intro completes and phase checks have advanced. */
  protected abstract phaseAttackTick(dt: number, player: Player): void;

  /** Subclass hook fired when entering a new phase (visuals, attack-roster swap). */
  protected onPhaseEnter(_phase: number): void {}

  /** Subclass hook fired when `updateLogic` runs while dead (hide telegraphs, etc). */
  protected onDeadFrame(): void {}

  protected override die(): void {
    super.die();
    // Distinct from KILL — `BOSS_DEFEATED` carries the display name + position
    // so the HUD can show the proper "DEFEATED" banner and the camera layer
    // can sequence its kill-cam without sniffing every KILL event for boss IDs.
    events.emit("BOSS_DEFEATED", {
      bossId: this.id,
      name: this.bossDisplayName,
      pos: this.root.position.clone(),
    });
  }

  updateLogic(dt: number, player: Player): void {
    if (!this.alive) {
      this.onDeadFrame();
      return;
    }
    // Intro: scale-up tween, no AI. The main.ts layer drives camera orbit +
    // banner via BOSS_INTRO_START emitted in EnemyManager.spawn.
    if (this.introTimer > 0) {
      this.introTimer = Math.max(0, this.introTimer - dt);
      const t = 1 - this.introTimer / this.introDuration;
      this.root.scaling.y = 0.4 + 0.6 * t;
      this.tickCommon(dt);
      return;
    }
    this.tickCommon(dt);
    if (this.contactCooldown > 0) this.contactCooldown = Math.max(0, this.contactCooldown - dt);
    this.fightElapsedSec += dt;
    if (!this.dominantSampled) {
      this.dominantSampled = true;
      this.dominantArchetype = sampleDominantArchetype();
    }
    this.checkPhaseTransitions();
    this.phaseAttackTick(dt, player);
  }

  /**
   * Enrage scaling — kicks in past 90 s of engagement. Linear ramp +0.05/s
   * up to +60% over the next 12 s, then capped. Subclasses multiply attack
   * windup decay and contact damage by this value to make late fights
   * pressure-cook the player.
   */
  protected enrageMultiplier(): number {
    if (this.fightElapsedSec < 90) return 1.0;
    return Math.min(1.6, 1.0 + (this.fightElapsedSec - 90) * 0.05);
  }

  protected checkPhaseTransitions(): void {
    const ratio = this.hp / this.def.hp;
    let target = 1;
    for (let i = 0; i < this.phaseHpThresholds.length; i++) {
      if (ratio <= this.phaseHpThresholds[i]) target = i + 2;
    }
    if (target > this.currentPhase) {
      const idx = target - 2;
      const enrageLine = this.enrageLines[idx] ?? "";
      const spawnComposition = this.spawnComposition[idx] ?? [];
      this.currentPhase = target;
      const payload: BossPhasePayload = {
        bossId: this.id,
        phase: target,
        spawnPos: this.root.position.clone(),
        enrageLine,
        spawnComposition,
      };
      events.emit("BOSS_PHASE", payload);
      this.onPhaseEnter(target);
    }
  }

  /**
   * Apply contact damage if the cooldown is clear. Honors player dodge i-frames
   * and emits PERFECT_DODGE on consumption.
   */
  protected tryContactDamage(player: Player, dmg: number, cooldownAfter: number): void {
    if (this.contactCooldown !== 0) return;
    if (!player.isDodging) {
      events.emit("DAMAGE_TAKEN", { amount: dmg, source: this.id });
      this.contactCooldown = cooldownAfter;
    } else if (player.tryConsumePerfectDodge()) {
      events.emit("PERFECT_DODGE", {});
    }
  }

  /** Queue a deferred strike — `resolve` runs after `delaySec` with the live player ref. */
  protected queueStrike(delaySec: number, resolve: (player: Player) => void): void {
    this.pending.push({ ttl: delaySec, resolve });
  }

  /** Drain pending strikes; call once per frame from `phaseAttackTick`. */
  protected tickPending(dt: number, player: Player): void {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const s = this.pending[i];
      s.ttl -= dt;
      if (s.ttl <= 0) {
        s.resolve(player);
        this.pending.splice(i, 1);
      }
    }
  }

  /**
   * Honor hyperarmor — bosses mid-signature-windup can't be punted around the
   * arena, otherwise a charged Crashing Blow could trivially break a committed
   * attack and the windup telegraph would lie to the player. Subclasses set
   * `hyperarmorActive = true` during the relevant windup state.
   */
  override knockback(dx: number, dz: number, force: number): void {
    if (this.hyperarmorActive) return;
    super.knockback(dx, dz, force);
  }
}
