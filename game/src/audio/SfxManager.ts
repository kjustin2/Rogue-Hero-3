import { events } from "../engine/EventBus";
import { TempoZone } from "../tempo/TempoSystem";

/**
 * Procedural Web Audio SFX system. Subscribes to gameplay events on the
 * EventBus and synthesises every sound in code — no asset files, no Babylon
 * audio surface, no side-effect imports.
 *
 * Architecture:
 *   recipe nodes -> recipeGain (per-shot, GC after onended)
 *               -> sfxGain (category)
 *               -> masterGain
 *               -> compressor (limits peaks during dense combat)
 *               -> ctx.destination
 *
 * Headless-safe: in environments without an `AudioContext` (Node-based
 * verify scripts), the manager constructs as a tombstone, registers no
 * listeners, and every public method is a no-op.
 */

export interface SfxOptions {
  /** 0..1 — final output gain. Default 0.7 to leave headroom under the limiter. */
  masterVolume?: number;
  muted?: boolean;
}

interface ComboHitPayload { hitNum: number; count: number }
interface PlayerLandedPayload { aerial: boolean }
interface ZoneTransitionPayload { oldZone: TempoZone; newZone: TempoZone }
interface CardFxPayload { kind: string }
interface CastFxPayload { kind: string }

type AudioCtxCtor = typeof AudioContext;

function resolveAudioContextCtor(): AudioCtxCtor | undefined {
  if (typeof window === "undefined") return undefined;
  if (typeof window.AudioContext !== "undefined") return window.AudioContext;
  const w = window as unknown as { webkitAudioContext?: AudioCtxCtor };
  return w.webkitAudioContext;
}

/** Hand-pickable musical pitches — used by the COMBO_HIT pitch ramp. */
const SEMITONE = Math.pow(2, 1 / 12);

export class SfxManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private subs: Array<() => void> = [];
  private muted = false;
  private targetVolume = 0.7;
  /** Cached zone — refreshed by ZONE_TRANSITION listener. Some recipes (footsteps)
   *  modulate by current tempo state for moment-to-moment feedback. */
  private currentZone: TempoZone = "FLOWING";
  /** Last time PLAYER_STEP recipe fired; throttle-gate to footfall cadence. */
  private lastStepAt = 0;
  /** Coalesce window for ENEMY_HIT — multi-hit AoE casts emit dozens in one frame. */
  private hitCoalesceCount = 0;
  private hitCoalesceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts?: SfxOptions) {
    this.targetVolume = opts?.masterVolume ?? 0.7;
    this.muted = opts?.muted ?? false;

    const Ctor = resolveAudioContextCtor();
    if (!Ctor) {
      // Headless / unsupported — leave everything null. All public methods
      // gate on `this.ctx` so they no-op cleanly.
      return;
    }

    try {
      this.ctx = new Ctor();
    } catch {
      // Some test environments expose AudioContext but throw on construction.
      this.ctx = null;
      return;
    }

    this.buildBus();
    this.buildNoiseBuffer();
    this.subscribeAll();
  }

  isAvailable(): boolean {
    return this.ctx !== null;
  }

  resume(): void {
    if (!this.ctx) return;
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
  }

  setMasterVolume(v: number): void {
    this.targetVolume = Math.max(0, Math.min(1, v));
    if (!this.masterGain || !this.ctx) return;
    const target = this.muted ? 0 : this.targetVolume;
    this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.masterGain.gain.linearRampToValueAtTime(target, this.ctx.currentTime + 0.05);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.setMasterVolume(this.targetVolume);
  }

  dispose(): void {
    for (const unsub of this.subs) unsub();
    this.subs.length = 0;
    if (this.hitCoalesceTimer !== null) {
      clearTimeout(this.hitCoalesceTimer);
      this.hitCoalesceTimer = null;
    }
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this.masterGain = null;
    this.sfxGain = null;
    this.compressor = null;
    this.noiseBuffer = null;
  }

  // -------- Setup --------

  private buildBus(): void {
    if (!this.ctx) return;
    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -12;
    this.compressor.knee.value = 10;
    this.compressor.ratio.value = 4;
    this.compressor.attack.value = 0.005;
    this.compressor.release.value = 0.1;
    this.compressor.connect(this.ctx.destination);

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.muted ? 0 : this.targetVolume;
    this.masterGain.connect(this.compressor);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 1;
    this.sfxGain.connect(this.masterGain);
  }

  private buildNoiseBuffer(): void {
    if (!this.ctx) return;
    const len = Math.floor(this.ctx.sampleRate * 0.5);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
  }

  private subscribeAll(): void {
    this.subs.push(events.on<ZoneTransitionPayload>("ZONE_TRANSITION", (p) => this.onZoneTransition(p)));
    this.subs.push(events.on("ENEMY_HIT", () => this.onEnemyHit()));
    this.subs.push(events.on("KILL", () => this.playKill()));
    this.subs.push(events.on("DAMAGE_TAKEN", () => this.playDamageTaken()));
    this.subs.push(events.on("DODGE", () => this.playDodge()));
    this.subs.push(events.on("PERFECT_DODGE", () => this.playPerfectDodge()));
    this.subs.push(events.on("HEAVY_HIT", () => this.playHeavyHit()));
    this.subs.push(events.on("HEAVY_MISS", () => this.playHeavyMiss()));
    this.subs.push(events.on("CRASH_ATTACK", () => this.playCrashAttack()));
    this.subs.push(events.on("COLD_CRASH", () => this.playColdCrash()));
    this.subs.push(events.on<ComboHitPayload>("COMBO_HIT", (p) => this.playComboHit(p)));
    this.subs.push(events.on("CARD_PLAYED", () => this.playCardPlayed()));
    this.subs.push(events.on("CARD_PLAYED_SLOT", () => this.playCardPlayedSlot()));
    this.subs.push(events.on("CARD_FAIL", () => this.playCardFail()));
    this.subs.push(events.on<CastFxPayload>("CAST_FX", (p) => { if (p.kind === "bolt") this.playCastBolt(); }));
    this.subs.push(events.on<CardFxPayload>("CARD_FX", (p) => this.onCardFx(p)));
    this.subs.push(events.on("RELIC_EQUIPPED", () => this.playRelicEquipped()));
    this.subs.push(events.on("ROOM_CLEARED", () => this.playRoomCleared()));
    this.subs.push(events.on("BOSS_INTRO_START", () => this.playBossIntroStart()));
    this.subs.push(events.on("BOSS_PHASE", () => this.playBossPhase()));
    this.subs.push(events.on("DRAIN", () => this.playDrain()));
    this.subs.push(events.on("PLAYER_STEP", () => this.onPlayerStep()));
    this.subs.push(events.on<PlayerLandedPayload>("PLAYER_LANDED", (p) => this.playPlayerLanded(p)));
    this.subs.push(events.on<string>("PLAY_SOUND", (p) => this.onPlaySound(p)));
  }

  // -------- Event-side handlers (with throttling / coalescing) --------

  private onZoneTransition(p: ZoneTransitionPayload): void {
    this.currentZone = p.newZone;
    this.playZoneTransition(p);
  }

  private onPlayerStep(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastStepAt < 0.11) return;
    this.lastStepAt = now;
    this.playPlayerStep();
  }

  private onEnemyHit(): void {
    if (!this.ctx) return;
    this.hitCoalesceCount++;
    if (this.hitCoalesceTimer === null) {
      this.hitCoalesceTimer = setTimeout(() => {
        const count = this.hitCoalesceCount;
        this.hitCoalesceCount = 0;
        this.hitCoalesceTimer = null;
        this.playEnemyHit(count);
      }, 30);
    }
  }

  private onCardFx(p: CardFxPayload): void {
    if (p.kind === "arc") this.playArcSwing();
    else if (p.kind === "chain") this.playChainArc();
    else if (p.kind === "dash") this.playDashWoosh();
    // "aoe", "slam", "shield" — covered by other recipes (HEAVY_HIT, PLAYER_LANDED, RELIC_EQUIPPED).
  }

  private onPlaySound(name: string): void {
    if (name === "crash") this.playCrashAttack();
  }

  // -------- Recipes --------
  // Each recipe:
  //   1. Allocates a fresh per-shot gain
  //   2. Connects oscillators / noise sources to it
  //   3. Schedules envelopes via gain.linearRampToValueAtTime / setTargetAtTime
  //   4. Calls start() and stop() — Web Audio one-shot lifecycle handles GC
  //
  // Recipes only run when this.ctx exists; the public-facing handler-side
  // methods above gate on it via the bus pointers being null.

  private now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  private mkGain(level: number): GainNode | null {
    if (!this.ctx || !this.sfxGain) return null;
    const g = this.ctx.createGain();
    g.gain.value = level;
    g.connect(this.sfxGain);
    return g;
  }

  private playEnemyHit(count: number): void {
    if (!this.ctx) return;
    const t0 = this.now();
    const c = Math.max(1, Math.min(8, count));
    // Coalesced multi-hit: louder + slightly lower-pitched as count rises (chord-thickness).
    const gain = this.mkGain(0.0001);
    if (!gain) return;
    const tri = this.ctx.createOscillator();
    tri.type = "triangle";
    const startFreq = 700 - 40 * (c - 1);
    tri.frequency.setValueAtTime(startFreq, t0);
    tri.frequency.exponentialRampToValueAtTime(Math.max(120, startFreq * 0.3), t0 + 0.06);
    tri.connect(gain);
    const peak = Math.min(0.55, 0.32 + 0.04 * c);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.07);
    tri.start(t0);
    tri.stop(t0 + 0.08);
    // Noise click for the metallic edge.
    this.scheduleNoise(t0, 0.04, "highpass", 2000, 0.18);
  }

  private playKill(): void {
    if (!this.ctx) return;
    const t0 = this.now();
    const gain = this.mkGain(0.0001);
    if (!gain) return;
    const sq = this.ctx.createOscillator();
    sq.type = "square";
    sq.frequency.setValueAtTime(220, t0);
    sq.frequency.exponentialRampToValueAtTime(120, t0 + 0.18);
    const detuned = this.ctx.createOscillator();
    detuned.type = "square";
    detuned.frequency.value = 220 * 1.5;
    detuned.detune.value = 7;
    const lpf = this.ctx.createBiquadFilter();
    lpf.type = "lowpass";
    lpf.frequency.value = 1200;
    sq.connect(lpf);
    detuned.connect(lpf);
    lpf.connect(gain);
    gain.gain.exponentialRampToValueAtTime(0.4, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
    sq.start(t0); sq.stop(t0 + 0.2);
    detuned.start(t0); detuned.stop(t0 + 0.2);
  }

  private playDamageTaken(): void {
    if (!this.ctx) return;
    const t0 = this.now();
    const gain = this.mkGain(0.0001);
    if (!gain) return;
    const saw = this.ctx.createOscillator();
    saw.type = "sawtooth";
    saw.frequency.setValueAtTime(180, t0);
    saw.frequency.exponentialRampToValueAtTime(90, t0 + 0.22);
    const lpf = this.ctx.createBiquadFilter();
    lpf.type = "lowpass";
    lpf.frequency.value = 600;
    saw.connect(lpf);
    lpf.connect(gain);
    // Double-pluck envelope — 0 → peak → dip → peak → 0
    gain.gain.exponentialRampToValueAtTime(0.45, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.07);
    gain.gain.exponentialRampToValueAtTime(0.32, t0 + 0.11);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
    saw.start(t0); saw.stop(t0 + 0.24);
    this.scheduleNoise(t0 + 0.005, 0.04, "lowpass", 800, 0.12);
  }

  private playDodge(): void {
    if (!this.ctx) return;
    const t0 = this.now();
    const gain = this.mkGain(0.0001);
    if (!gain) return;
    const sine = this.ctx.createOscillator();
    sine.type = "sine";
    sine.frequency.setValueAtTime(400, t0);
    sine.frequency.exponentialRampToValueAtTime(900, t0 + 0.09);
    sine.connect(gain);
    gain.gain.linearRampToValueAtTime(0.22, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
    sine.start(t0); sine.stop(t0 + 0.1);
  }

  private playPerfectDodge(): void {
    if (!this.ctx) return;
    const t0 = this.now();
    const gain = this.mkGain(0.0001);
    if (!gain) return;
    // Layered bell — base + octave + LFO-shimmer.
    const base = this.ctx.createOscillator();
    base.type = "sine";
    base.frequency.value = 600;
    const octave = this.ctx.createOscillator();
    octave.type = "sine";
    octave.frequency.value = 1200;
    // LFO modulating octave's gain — subtle shimmer.
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 14;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.15;
    const octaveGain = this.ctx.createGain();
    octaveGain.gain.value = 0.6;
    lfo.connect(lfoGain);
    lfoGain.connect(octaveGain.gain);
    base.connect(gain);
    octave.connect(octaveGain);
    octaveGain.connect(gain);
    gain.gain.linearRampToValueAtTime(0.32, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
    base.start(t0); base.stop(t0 + 0.26);
    octave.start(t0); octave.stop(t0 + 0.26);
    lfo.start(t0); lfo.stop(t0 + 0.26);
    // Metallic tick at start.
    this.scheduleNoise(t0, 0.02, "highpass", 4000, 0.18);
  }

  private playHeavyHit(): void {
    if (!this.ctx) return;
    const t0 = this.now();
    const gain = this.mkGain(0.0001);
    if (!gain) return;
    const sub = this.ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.value = 70;
    const lpf = this.ctx.createBiquadFilter();
    lpf.type = "lowpass";
    lpf.frequency.value = 200;
    sub.connect(lpf);
    lpf.connect(gain);
    gain.gain.exponentialRampToValueAtTime(0.55, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
    sub.start(t0); sub.stop(t0 + 0.36);
    this.scheduleNoise(t0, 0.12, "lowpass", 250, 0.36);
  }

  private playHeavyMiss(): void {
    if (!this.ctx) return;
    const t0 = this.now();
    const gain = this.mkGain(0.0001);
    if (!gain) return;
    const tri = this.ctx.createOscillator();
    tri.type = "triangle";
    tri.frequency.setValueAtTime(240, t0);
    tri.frequency.exponentialRampToValueAtTime(160, t0 + 0.14);
    const bpf = this.ctx.createBiquadFilter();
    bpf.type = "bandpass";
    bpf.frequency.value = 800;
    bpf.Q.value = 2;
    tri.connect(bpf);
    bpf.connect(gain);
    gain.gain.exponentialRampToValueAtTime(0.28, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
    tri.start(t0); tri.stop(t0 + 0.15);
    this.scheduleNoise(t0 + 0.02, 0.08, "bandpass", 1100, 0.14);
  }

  private playCrashAttack(): void {
    if (!this.ctx) return;
    const t0 = this.now();
    const gain = this.mkGain(0.0001);
    if (!gain) return;
    const sub = this.ctx.createOscillator();
    sub.type = "sine"; sub.frequency.value = 60;
    const sq = this.ctx.createOscillator();
    sq.type = "square"; sq.frequency.value = 90;
    // AM modulation via LFO.
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 7;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.25;
    const amGain = this.ctx.createGain();
    amGain.gain.value = 0.5;
    lfo.connect(lfoGain);
    lfoGain.connect(amGain.gain);
    sub.connect(amGain);
    sq.connect(amGain);
    amGain.connect(gain);
    gain.gain.exponentialRampToValueAtTime(0.55, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.7);
    sub.start(t0); sub.stop(t0 + 0.7);
    sq.start(t0); sq.stop(t0 + 0.7);
    lfo.start(t0); lfo.stop(t0 + 0.7);
    // Sweeping noise — burst + slow LPF descent.
    this.scheduleNoiseSweep(t0, 0.7, 4000, 200, 0.35);
  }

  private playColdCrash(): void {
    if (!this.ctx) return;
    const t0 = this.now();
    const gain = this.mkGain(0.0001);
    if (!gain) return;
    // CRASH_ATTACK transposed -7 semitones (≈0.667× freq).
    const sub = this.ctx.createOscillator();
    sub.type = "sine"; sub.frequency.value = 60 * Math.pow(SEMITONE, -7);
    const sq = this.ctx.createOscillator();
    sq.type = "square"; sq.frequency.value = 90 * Math.pow(SEMITONE, -7);
    const shimmer = this.ctx.createOscillator();
    shimmer.type = "sine"; shimmer.frequency.value = 2400;
    shimmer.detune.value = 12;
    const shimmerGain = this.ctx.createGain();
    shimmerGain.gain.value = 0.05;
    sub.connect(gain); sq.connect(gain);
    shimmer.connect(shimmerGain); shimmerGain.connect(gain);
    gain.gain.exponentialRampToValueAtTime(0.45, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.2);
    sub.start(t0); sub.stop(t0 + 1.2);
    sq.start(t0); sq.stop(t0 + 1.2);
    shimmer.start(t0); shimmer.stop(t0 + 1.2);
    this.scheduleNoiseSweep(t0, 1.2, 3000, 150, 0.28);
  }

  private playComboHit(p: ComboHitPayload): void {
    if (!this.ctx) return;
    const t0 = this.now();
    const gain = this.mkGain(0.0001);
    if (!gain) return;
    const n = Math.max(1, Math.min(16, p.hitNum ?? 1));
    const freq = 600 * Math.pow(SEMITONE, n - 1);
    const sine = this.ctx.createOscillator();
    sine.type = "sine";
    sine.frequency.value = freq;
    sine.connect(gain);
    gain.gain.linearRampToValueAtTime(0.18, t0 + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
    sine.start(t0); sine.stop(t0 + 0.06);
  }

  private playCardPlayed(): void {
    if (!this.ctx) return;
    const t0 = this.now();
    const gain = this.mkGain(0.0001);
    if (!gain) return;
    const tri = this.ctx.createOscillator();
    tri.type = "triangle";
    tri.frequency.value = 880;
    tri.connect(gain);
    gain.gain.linearRampToValueAtTime(0.22, t0 + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.08);
    tri.start(t0); tri.stop(t0 + 0.09);
  }

  private playCardPlayedSlot(): void {
    if (!this.ctx) return;
    const t0 = this.now();
    const gain = this.mkGain(0.0001);
    if (!gain) return;
    const sine = this.ctx.createOscillator();
    sine.type = "sine";
    sine.frequency.value = 1100;
    sine.connect(gain);
    gain.gain.linearRampToValueAtTime(0.12, t0 + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.04);
    sine.start(t0); sine.stop(t0 + 0.05);
  }

  private playCardFail(): void {
    if (!this.ctx) return;
    const t0 = this.now();
    const gain = this.mkGain(0.0001);
    if (!gain) return;
    const sq = this.ctx.createOscillator();
    sq.type = "square";
    sq.frequency.setValueAtTime(220, t0);
    sq.frequency.exponentialRampToValueAtTime(180, t0 + 0.12);
    const lpf = this.ctx.createBiquadFilter();
    lpf.type = "lowpass"; lpf.frequency.value = 800;
    sq.connect(lpf); lpf.connect(gain);
    gain.gain.linearRampToValueAtTime(0.18, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
    sq.start(t0); sq.stop(t0 + 0.13);
  }

  private playCastBolt(): void {
    if (!this.ctx) return;
    const t0 = this.now();
    const gain = this.mkGain(0.0001);
    if (!gain) return;
    const sine = this.ctx.createOscillator();
    sine.type = "sine";
    sine.frequency.value = 700;
    sine.connect(gain);
    gain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
    sine.start(t0); sine.stop(t0 + 0.21);
    this.scheduleNoise(t0, 0.18, "bandpass", 1500, 0.3, 8);
  }

  private playArcSwing(): void {
    if (!this.ctx) return;
    const t0 = this.now();
    const gain = this.mkGain(0.0001);
    if (!gain) return;
    const saw1 = this.ctx.createOscillator();
    saw1.type = "sawtooth"; saw1.frequency.value = 300;
    const saw2 = this.ctx.createOscillator();
    saw2.type = "sawtooth"; saw2.frequency.value = 302;
    const hpf = this.ctx.createBiquadFilter();
    hpf.type = "highpass";
    hpf.frequency.setValueAtTime(800, t0);
    hpf.frequency.exponentialRampToValueAtTime(2000, t0 + 0.18);
    saw1.connect(hpf); saw2.connect(hpf); hpf.connect(gain);
    gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
    saw1.start(t0); saw1.stop(t0 + 0.2);
    saw2.start(t0); saw2.stop(t0 + 0.2);
  }

  private playChainArc(): void {
    if (!this.ctx) return;
    const t0 = this.now();
    const freqs = [880, 1100, 1320];
    const offsets = [0, 0.04, 0.08];
    for (let i = 0; i < 3; i++) {
      const gain = this.mkGain(0.0001);
      if (!gain) continue;
      const tri = this.ctx.createOscillator();
      tri.type = "triangle";
      tri.frequency.value = freqs[i];
      tri.connect(gain);
      const ti = t0 + offsets[i];
      gain.gain.linearRampToValueAtTime(0.18, ti + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, ti + 0.06);
      tri.start(ti); tri.stop(ti + 0.07);
    }
  }

  private playDashWoosh(): void {
    if (!this.ctx) return;
    const t0 = this.now();
    this.scheduleNoiseSweep(t0, 0.15, 4000, 500, 0.3);
  }

  private playRelicEquipped(): void {
    if (!this.ctx) return;
    const t0 = this.now();
    const freqs = [523.25, 659.25, 783.99]; // C5 E5 G5
    const offsets = [0, 0.1, 0.2];
    for (let i = 0; i < 3; i++) {
      const gain = this.mkGain(0.0001);
      if (!gain) continue;
      const sine = this.ctx.createOscillator();
      sine.type = "sine";
      sine.frequency.value = freqs[i];
      sine.connect(gain);
      const ti = t0 + offsets[i];
      gain.gain.linearRampToValueAtTime(0.18, ti + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ti + 0.5);
      sine.start(ti); sine.stop(ti + 0.55);
    }
  }

  private playZoneTransition(p: ZoneTransitionPayload): void {
    if (!this.ctx) return;
    const t0 = this.now();
    const direction = zoneIndex(p.newZone) - zoneIndex(p.oldZone);
    const gain = this.mkGain(0.0001);
    if (!gain) return;
    const sine = this.ctx.createOscillator();
    sine.type = "sine";
    const f0 = direction >= 0 ? 200 : 320;
    const f1 = direction >= 0 ? 320 : 200;
    sine.frequency.setValueAtTime(f0, t0);
    sine.frequency.exponentialRampToValueAtTime(f1, t0 + 0.6);
    sine.connect(gain);
    gain.gain.linearRampToValueAtTime(0.16, t0 + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.8);
    sine.start(t0); sine.stop(t0 + 0.85);
    this.scheduleNoiseSweep(t0, 0.6, direction >= 0 ? 600 : 1800, direction >= 0 ? 1800 : 600, 0.08);
  }

  private playRoomCleared(): void {
    if (!this.ctx) return;
    const t0 = this.now();
    const freqs = [440, 554.37, 659.25]; // A4 C#5 E5 — major triad
    for (let i = 0; i < 3; i++) {
      const gain = this.mkGain(0.0001);
      if (!gain) continue;
      const sine = this.ctx.createOscillator();
      sine.type = "sine";
      sine.frequency.value = freqs[i];
      sine.connect(gain);
      gain.gain.linearRampToValueAtTime(0.16, t0 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.2);
      sine.start(t0); sine.stop(t0 + 1.25);
    }
  }

  private playBossIntroStart(): void {
    if (!this.ctx) return;
    const t0 = this.now();
    const gain = this.mkGain(0.0001);
    if (!gain) return;
    const sub = this.ctx.createOscillator();
    sub.type = "sine"; sub.frequency.value = 55;
    sub.connect(gain);
    gain.gain.linearRampToValueAtTime(0.32, t0 + 0.4);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.5);
    sub.start(t0); sub.stop(t0 + 1.55);
    this.scheduleNoiseSweep(t0, 1.5, 100, 3000, 0.18);
  }

  private playBossPhase(): void {
    if (!this.ctx) return;
    const t0 = this.now();
    const gain = this.mkGain(0.0001);
    if (!gain) return;
    const sine = this.ctx.createOscillator();
    sine.type = "sine"; sine.frequency.value = 110;
    const sq = this.ctx.createOscillator();
    sq.type = "square"; sq.frequency.value = 165;
    const lpf = this.ctx.createBiquadFilter();
    lpf.type = "lowpass"; lpf.frequency.value = 600;
    sine.connect(gain); sq.connect(lpf); lpf.connect(gain);
    gain.gain.exponentialRampToValueAtTime(0.55, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
    sine.start(t0); sine.stop(t0 + 0.36);
    sq.start(t0); sq.stop(t0 + 0.36);
    this.scheduleNoise(t0, 0.1, "lowpass", 400, 0.32);
  }

  private playDrain(): void {
    if (!this.ctx) return;
    const t0 = this.now();
    const gain = this.mkGain(0.0001);
    if (!gain) return;
    const saw = this.ctx.createOscillator();
    saw.type = "sawtooth";
    saw.frequency.setValueAtTime(200, t0);
    saw.frequency.exponentialRampToValueAtTime(80, t0 + 0.4);
    const lpf = this.ctx.createBiquadFilter();
    lpf.type = "lowpass"; lpf.frequency.value = 400;
    saw.connect(lpf); lpf.connect(gain);
    gain.gain.exponentialRampToValueAtTime(0.3, t0 + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
    saw.start(t0); saw.stop(t0 + 0.42);
    this.scheduleNoise(t0 + 0.1, 0.2, "lowpass", 600, 0.12);
  }

  private playPlayerStep(): void {
    if (!this.ctx) return;
    const t0 = this.now();
    // Zone-modulated: HOT/CRITICAL adds a touch more presence.
    const hot = this.currentZone === "HOT" || this.currentZone === "CRITICAL";
    const cutoff = hot ? 380 : 300;
    const peak = hot ? 0.14 : 0.09;
    this.scheduleNoise(t0, 0.04, "lowpass", cutoff, peak);
  }

  private playPlayerLanded(p: PlayerLandedPayload): void {
    if (!this.ctx) return;
    const t0 = this.now();
    const gain = this.mkGain(0.0001);
    if (!gain) return;
    const sine = this.ctx.createOscillator();
    sine.type = "sine"; sine.frequency.value = 80;
    sine.connect(gain);
    const peak = p.aerial ? 0.55 : 0.28;
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
    sine.start(t0); sine.stop(t0 + 0.13);
    if (p.aerial) {
      const sub = this.ctx.createOscillator();
      sub.type = "sine"; sub.frequency.value = 60;
      const subGain = this.mkGain(0.0001);
      if (subGain) {
        sub.connect(subGain);
        subGain.gain.exponentialRampToValueAtTime(0.45, t0 + 0.018);
        subGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
      }
      sub.start(t0); sub.stop(t0 + 0.21);
    }
    this.scheduleNoise(t0, 0.05, "lowpass", 250, p.aerial ? 0.22 : 0.12);
  }

  // -------- Helpers --------

  /**
   * Schedule a one-shot noise burst through a biquad filter. Reuses the shared
   * white-noise AudioBuffer; the BufferSource is one-shot and self-GCs after
   * `stop()`.
   */
  private scheduleNoise(
    t0: number,
    duration: number,
    filterType: BiquadFilterType,
    cutoff: number,
    peak: number,
    Q = 1,
  ): void {
    if (!this.ctx || !this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = cutoff;
    filter.Q.value = Q;
    const gain = this.mkGain(0.0001);
    if (!gain) return;
    src.connect(filter);
    filter.connect(gain);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.start(t0);
    src.stop(t0 + duration + 0.02);
  }

  /** Filter sweep variant — useful for whooshes and crash sweeps. */
  private scheduleNoiseSweep(
    t0: number,
    duration: number,
    fStart: number,
    fEnd: number,
    peak: number,
  ): void {
    if (!this.ctx || !this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(fStart, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, fEnd), t0 + duration);
    const gain = this.mkGain(0.0001);
    if (!gain) return;
    src.connect(filter);
    filter.connect(gain);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.start(t0);
    src.stop(t0 + duration + 0.02);
  }
}

function zoneIndex(z: TempoZone): number {
  switch (z) {
    case "COLD": return 0;
    case "FLOWING": return 1;
    case "HOT": return 2;
    case "CRITICAL": return 3;
  }
}
