import type { EventBus } from "../core/events";

interface ToneOpts {
  f: number;
  /** Frequency to slide to over the duration. */
  f2?: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
  attack?: number;
  delay?: number;
}

interface NoiseOpts {
  dur: number;
  freq: number;
  q?: number;
  gain?: number;
  type?: BiquadFilterType;
  /** Filter frequency slide target. */
  freq2?: number;
  delay?: number;
}

/**
 * Fully procedural SFX — every sound is synthesised from oscillators and
 * filtered noise at call time. Headless-safe: silently no-ops without
 * AudioContext. The context resumes on the first user gesture (main.ts).
 */
export class Sfx {
  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambientNodes: AudioNode[] = [];
  private ambientGain: GainNode | null = null;
  volume = 0.7;
  private noiseBuf: AudioBuffer | null = null;

  constructor(events: EventBus) {
    try {
      this.ac = new AudioContext();
      this.master = this.ac.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ac.destination);
      // Shared 2s white-noise buffer
      const len = this.ac.sampleRate * 2;
      this.noiseBuf = this.ac.createBuffer(1, len, this.ac.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    } catch {
      this.ac = null;
    }

    events.on("ENEMY_HIT", (e) => (e.heavy ? this.hitHeavy() : this.hit()));
    events.on("KILL", () => this.kill());
    events.on("PLAYER_HIT", () => this.hurt());
    events.on("DODGE", () => this.dodge());
    events.on("PERFECT_DODGE", () => this.perfectDodge());
    events.on("ROOM_CLEARED", () => this.roomClear());
    events.on("KILL_STREAK", (e) => this.streak(e.count));
    events.on("HEAL", () => this.heal());
    events.on("UI_HOVER", () => this.uiHover());
    events.on("UI_CLICK", () => this.uiClick());
    events.on("FREEZE", () => this.freezeSound());
    events.on("TEMPO_ZONE", (e) => {
      if (e.zone === "critical") this.zoneCritical();
    });
  }

  resume(): void {
    if (this.ac?.state === "suspended") void this.ac.resume();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  // ---------------------------------------------------------------- helpers
  private tone(o: ToneOpts): void {
    if (!this.ac || !this.master) return;
    const t0 = this.ac.currentTime + (o.delay ?? 0);
    const osc = this.ac.createOscillator();
    const g = this.ac.createGain();
    osc.type = o.type ?? "sine";
    osc.frequency.setValueAtTime(o.f, t0);
    if (o.f2 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t0 + o.dur);
    const gain = o.gain ?? 0.18;
    const attack = o.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.05);
  }

  private noise(o: NoiseOpts): void {
    if (!this.ac || !this.master || !this.noiseBuf) return;
    const t0 = this.ac.currentTime + (o.delay ?? 0);
    const src = this.ac.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filter = this.ac.createBiquadFilter();
    filter.type = o.type ?? "bandpass";
    filter.frequency.setValueAtTime(o.freq, t0);
    if (o.freq2 !== undefined) filter.frequency.exponentialRampToValueAtTime(Math.max(40, o.freq2), t0 + o.dur);
    filter.Q.value = o.q ?? 1;
    const g = this.ac.createGain();
    const gain = o.gain ?? 0.18;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t0, Math.random());
    src.stop(t0 + o.dur + 0.05);
  }

  // ---------------------------------------------------------------- combat
  swing(stage: number, connected: boolean): void {
    // A clean air-whoosh; the 360° finisher adds a low body sweep.
    this.noise({ dur: 0.13, freq: 900 + stage * 350, freq2: 2400, q: 1.1, gain: 0.07, type: "bandpass" });
    if (stage === 2) this.noise({ dur: 0.22, freq: 520, freq2: 140, q: 0.9, gain: 0.13, type: "lowpass" });
    if (connected) void 0; // hit sounds come from ENEMY_HIT
  }

  private hit(): void {
    // Crisp thwack: a short tonal knock + a tight transient + a touch of sub.
    this.tone({ f: 240, f2: 120, dur: 0.05, type: "triangle", gain: 0.12 });
    this.noise({ dur: 0.045, freq: 3200, q: 1.2, gain: 0.08 });
    this.tone({ f: 95, f2: 55, dur: 0.07, type: "sine", gain: 0.1 });
  }

  private hitHeavy(): void {
    // Deeper, weightier impact — body + crack + sub.
    this.tone({ f: 150, f2: 55, dur: 0.16, type: "sine", gain: 0.26 });
    this.tone({ f: 300, f2: 150, dur: 0.06, type: "triangle", gain: 0.12 });
    this.noise({ dur: 0.14, freq: 800, freq2: 220, q: 0.9, gain: 0.14, type: "lowpass" });
  }

  private kill(): void {
    // A satisfying pop: quick downward chirp, airy burst, soft thump.
    this.tone({ f: 520, f2: 120, dur: 0.13, type: "triangle", gain: 0.13 });
    this.noise({ dur: 0.2, freq: 2400, freq2: 500, q: 0.7, gain: 0.1, type: "bandpass" });
    this.tone({ f: 110, f2: 45, dur: 0.16, type: "sine", gain: 0.12, delay: 0.01 });
  }

  private hurt(): void {
    // A dull, sickening thud — less buzz, more body.
    this.tone({ f: 190, f2: 70, dur: 0.2, type: "sine", gain: 0.22 });
    this.noise({ dur: 0.16, freq: 420, freq2: 160, q: 0.7, gain: 0.13, type: "lowpass" });
  }

  private dodge(): void {
    this.noise({ dur: 0.16, freq: 600, freq2: 2400, q: 2, gain: 0.09 });
  }

  private perfectDodge(): void {
    this.tone({ f: 880, dur: 0.1, gain: 0.12 });
    this.tone({ f: 1320, dur: 0.16, gain: 0.12, delay: 0.05 });
    this.tone({ f: 1760, dur: 0.24, gain: 0.1, delay: 0.1 });
  }

  crash(): void {
    this.tone({ f: 60, f2: 30, dur: 0.5, type: "sine", gain: 0.3 });
    this.noise({ dur: 0.45, freq: 2500, freq2: 150, q: 0.6, gain: 0.25 });
    this.tone({ f: 440, f2: 880, dur: 0.3, type: "sawtooth", gain: 0.1 });
  }

  coldCrash(): void {
    this.tone({ f: 800, f2: 120, dur: 0.7, type: "sine", gain: 0.18 });
    this.noise({ dur: 0.6, freq: 4000, freq2: 600, q: 3, gain: 0.12 });
  }

  private zoneCritical(): void {
    this.tone({ f: 440, dur: 0.08, type: "square", gain: 0.07 });
    this.tone({ f: 660, dur: 0.1, type: "square", gain: 0.07, delay: 0.07 });
    this.tone({ f: 880, dur: 0.14, type: "square", gain: 0.08, delay: 0.14 });
  }

  private streak(count: number): void {
    const base = 520 + Math.min(count, 10) * 60;
    this.tone({ f: base, dur: 0.07, type: "triangle", gain: 0.1 });
    this.tone({ f: base * 1.5, dur: 0.1, type: "triangle", gain: 0.09, delay: 0.05 });
  }

  /** Rising chime as the hit-combo crosses each 10. */
  comboMilestone(count: number): void {
    const step = Math.min(8, Math.floor(count / 10));
    const base = 540 + step * 70;
    this.tone({ f: base, dur: 0.08, type: "triangle", gain: 0.08 });
    this.tone({ f: base * 1.26, dur: 0.1, type: "triangle", gain: 0.07, delay: 0.05 });
    this.tone({ f: base * 1.5, dur: 0.14, type: "sine", gain: 0.06, delay: 0.1 });
  }

  // ---------------------------------------------------------------- cards
  cast(id: string): void {
    switch (id) {
      case "dash-strike":
        this.noise({ dur: 0.2, freq: 500, freq2: 3000, q: 2, gain: 0.14 });
        break;
      case "arc-bolt":
        this.tone({ f: 700, f2: 1400, dur: 0.12, type: "sawtooth", gain: 0.1 });
        this.noise({ dur: 0.1, freq: 2000, q: 3, gain: 0.08 });
        break;
      case "cleave":
        this.noise({ dur: 0.25, freq: 900, freq2: 150, q: 1, gain: 0.2 });
        break;
      case "frost-nova":
        this.tone({ f: 1200, f2: 300, dur: 0.4, type: "sine", gain: 0.14 });
        this.noise({ dur: 0.35, freq: 5000, freq2: 1000, q: 2, gain: 0.12 });
        break;
      case "phase-step":
        this.tone({ f: 300, f2: 1500, dur: 0.18, type: "sine", gain: 0.12 });
        break;
      case "mine-field":
        for (let i = 0; i < 4; i++) this.tone({ f: 400 + i * 60, dur: 0.06, type: "square", gain: 0.07, delay: i * 0.05 });
        break;
      case "aegis":
        this.tone({ f: 520, f2: 780, dur: 0.3, type: "triangle", gain: 0.13 });
        break;
      case "chain-lightning":
        this.noise({ dur: 0.18, freq: 4000, q: 6, gain: 0.16 });
        this.tone({ f: 1800, f2: 200, dur: 0.15, type: "sawtooth", gain: 0.1 });
        break;
      case "sunder":
        for (let i = 0; i < 4; i++) this.tone({ f: 220 - i * 25, f2: 70, dur: 0.12, type: "square", gain: 0.1, delay: 0.1 + i * 0.12 });
        break;
      case "charged-lance":
        this.tone({ f: 400, f2: 1800, dur: 0.18, type: "sawtooth", gain: 0.14 });
        this.noise({ dur: 0.22, freq: 2600, freq2: 400, q: 1.6, gain: 0.16 });
        this.tone({ f: 90, f2: 40, dur: 0.2, type: "sine", gain: 0.16 });
        break;
      case "meteor-call":
        this.tone({ f: 900, f2: 1500, dur: 0.3, type: "sine", gain: 0.08 });
        this.tone({ f: 1350, f2: 2200, dur: 0.3, type: "sine", gain: 0.06, delay: 0.12 });
        break;
      case "bleeding-edge":
        this.noise({ dur: 0.22, freq: 1100, freq2: 200, q: 1.2, gain: 0.18 });
        this.tone({ f: 300, f2: 110, dur: 0.16, type: "sawtooth", gain: 0.1 });
        break;
      case "storm-conduit":
        this.tone({ f: 520, f2: 1040, dur: 0.4, type: "triangle", gain: 0.1 });
        this.noise({ dur: 0.35, freq: 5000, q: 5, gain: 0.07 });
        break;
      case "gravity-well":
        this.tone({ f: 600, f2: 90, dur: 0.6, type: "sine", gain: 0.14 });
        this.noise({ dur: 0.5, freq: 800, freq2: 200, q: 2, gain: 0.08, type: "lowpass" });
        break;
      case "ward-pulse":
        this.tone({ f: 440, f2: 660, dur: 0.25, type: "sine", gain: 0.12 });
        this.tone({ f: 660, f2: 880, dur: 0.3, type: "sine", gain: 0.1, delay: 0.1 });
        break;
      case "ember-wave":
        this.noise({ dur: 0.4, freq: 700, freq2: 180, q: 0.9, gain: 0.2, type: "lowpass" });
        this.tone({ f: 160, f2: 60, dur: 0.3, type: "sawtooth", gain: 0.12 });
        break;
      case "blade-cyclone":
        for (let i = 0; i < 3; i++) this.noise({ dur: 0.18, freq: 900 + i * 300, freq2: 250, q: 1.5, gain: 0.12, delay: i * 0.2 });
        break;
      case "riposte":
        this.tone({ f: 980, f2: 1400, dur: 0.18, type: "triangle", gain: 0.1 });
        break;
      case "tempo-theft":
        this.tone({ f: 1200, f2: 300, dur: 0.3, type: "sawtooth", gain: 0.1 });
        this.tone({ f: 300, f2: 700, dur: 0.25, type: "sine", gain: 0.1, delay: 0.12 });
        break;
      case "starfall":
        for (let i = 0; i < 3; i++) this.tone({ f: 1600 - i * 280, f2: 500, dur: 0.2, type: "sine", gain: 0.07, delay: i * 0.12 });
        break;
      case "spectral-volley":
        this.noise({ dur: 0.16, freq: 2600, freq2: 700, q: 3, gain: 0.1 });
        for (let i = 0; i < 3; i++) this.tone({ f: 760 + i * 180, f2: 1500, dur: 0.12, type: "sawtooth", gain: 0.07, delay: i * 0.03 });
        break;
      case "seismic-slam":
        this.tone({ f: 84, f2: 28, dur: 0.45, type: "sine", gain: 0.3 });
        this.noise({ dur: 0.4, freq: 1000, freq2: 90, q: 0.6, gain: 0.22, type: "lowpass" });
        break;
      case "glacial-lance":
        this.tone({ f: 1500, f2: 320, dur: 0.35, type: "sine", gain: 0.12 });
        this.noise({ dur: 0.3, freq: 5200, freq2: 900, q: 3, gain: 0.12 });
        break;
      case "soul-harvest":
        this.tone({ f: 420, f2: 180, dur: 0.4, type: "sawtooth", gain: 0.12 });
        this.tone({ f: 630, f2: 280, dur: 0.45, type: "sine", gain: 0.08, delay: 0.06 });
        this.noise({ dur: 0.35, freq: 1600, freq2: 400, q: 1.4, gain: 0.1, type: "lowpass" });
        break;
      case "warcry":
        this.tone({ f: 180, f2: 320, dur: 0.5, type: "sawtooth", gain: 0.18 });
        this.tone({ f: 270, f2: 480, dur: 0.45, type: "sawtooth", gain: 0.12, delay: 0.04 });
        break;
      case "seeker-swarm":
        for (let i = 0; i < 5; i++) this.tone({ f: 900 + i * 90, f2: 1700, dur: 0.1, type: "triangle", gain: 0.06, delay: i * 0.03 });
        this.noise({ dur: 0.18, freq: 3200, freq2: 900, q: 3, gain: 0.07 });
        break;
      case "singularity":
        this.tone({ f: 240, f2: 40, dur: 0.7, type: "sine", gain: 0.18 });
        this.tone({ f: 380, f2: 70, dur: 0.6, type: "sawtooth", gain: 0.08 });
        this.noise({ dur: 0.6, freq: 600, freq2: 120, q: 2, gain: 0.1, type: "lowpass" });
        break;
      case "tempest-storm":
        this.noise({ dur: 0.4, freq: 4500, freq2: 1200, q: 4, gain: 0.1 });
        this.tone({ f: 220, f2: 90, dur: 0.5, type: "sine", gain: 0.14 });
        this.tone({ f: 1600, f2: 400, dur: 0.18, type: "sawtooth", gain: 0.08, delay: 0.1 });
        break;
      case "flame-channel":
        this.noise({ dur: 0.5, freq: 500, freq2: 1400, q: 0.7, gain: 0.16, type: "bandpass" });
        this.tone({ f: 140, f2: 90, dur: 0.45, type: "sawtooth", gain: 0.1 });
        break;
      case "decoy-totem":
        this.tone({ f: 500, f2: 760, dur: 0.18, type: "triangle", gain: 0.1 });
        this.tone({ f: 760, f2: 1100, dur: 0.16, type: "triangle", gain: 0.07, delay: 0.09 });
        break;
      case "leech-orb":
        this.tone({ f: 300, f2: 520, dur: 0.4, type: "sine", gain: 0.12 });
        this.noise({ dur: 0.35, freq: 1400, freq2: 400, q: 1.4, gain: 0.07, type: "lowpass" });
        break;
      case "shield-bash":
        this.tone({ f: 200, f2: 70, dur: 0.3, type: "sine", gain: 0.26 });
        this.noise({ dur: 0.22, freq: 1200, freq2: 250, q: 0.8, gain: 0.16, type: "lowpass" });
        this.tone({ f: 520, f2: 320, dur: 0.12, type: "triangle", gain: 0.1 });
        break;
      case "rend-boomerang":
        this.noise({ dur: 0.3, freq: 800, freq2: 2200, q: 1.4, gain: 0.12 });
        this.noise({ dur: 0.3, freq: 2200, freq2: 800, q: 1.4, gain: 0.1, delay: 0.42 });
        this.tone({ f: 360, f2: 160, dur: 0.16, type: "sawtooth", gain: 0.08 });
        break;
      case "tempo-edge":
        for (let i = 0; i < 4; i++) this.noise({ dur: 0.12, freq: 1100 + i * 200, freq2: 300, q: 2, gain: 0.09, delay: i * 0.065 });
        this.tone({ f: 700, f2: 1500, dur: 0.18, type: "triangle", gain: 0.07, delay: 0.2 });
        break;
    }
  }

  deny(): void {
    this.tone({ f: 160, f2: 120, dur: 0.1, type: "square", gain: 0.07 });
  }

  cardReady(): void {
    this.tone({ f: 660, dur: 0.06, type: "triangle", gain: 0.06 });
    this.tone({ f: 990, dur: 0.1, type: "triangle", gain: 0.05, delay: 0.04 });
  }

  /** A bright rising triad when the player hits the Critical tempo zone. */
  critical(): void {
    const f = [523, 659, 784, 1047];
    f.forEach((hz, i) => this.tone({ f: hz, dur: 0.16, type: "triangle", gain: 0.06, delay: i * 0.05 }));
  }

  /** A deep, resonant sting under the Overdrive ignition. */
  overdrive(): void {
    this.tone({ f: 130, f2: 65, dur: 0.5, type: "sawtooth", gain: 0.16 });
    this.tone({ f: 523, f2: 1047, dur: 0.35, type: "triangle", gain: 0.1, delay: 0.04 });
    this.noise({ dur: 0.3, freq: 600, freq2: 4000, q: 1.2, gain: 0.1 });
  }

  // ---------------------------------------------------------------- enemies
  enemyLunge(): void {
    this.noise({ dur: 0.14, freq: 400, freq2: 1400, q: 1.6, gain: 0.1 });
  }

  enemyShoot(): void {
    this.tone({ f: 600, f2: 280, dur: 0.12, type: "square", gain: 0.07 });
  }

  fuse(): void {
    this.tone({ f: 1000, dur: 0.08, type: "square", gain: 0.06 });
    this.tone({ f: 1000, dur: 0.08, type: "square", gain: 0.06, delay: 0.18 });
    this.tone({ f: 1200, dur: 0.08, type: "square", gain: 0.07, delay: 0.36 });
    this.tone({ f: 1200, dur: 0.08, type: "square", gain: 0.07, delay: 0.5 });
    this.tone({ f: 1500, dur: 0.3, type: "square", gain: 0.08, delay: 0.64 });
  }

  explosion(): void {
    this.tone({ f: 90, f2: 30, dur: 0.4, type: "sine", gain: 0.3 });
    this.noise({ dur: 0.45, freq: 1200, freq2: 100, q: 0.5, gain: 0.26, type: "lowpass" });
  }

  beamCharge(): void {
    this.tone({ f: 200, f2: 900, dur: 0.45, type: "sawtooth", gain: 0.07 });
  }

  beamFire(): void {
    this.noise({ dur: 0.25, freq: 3000, freq2: 500, q: 2, gain: 0.2 });
    this.tone({ f: 1100, f2: 200, dur: 0.2, type: "sawtooth", gain: 0.12 });
  }

  spawn(): void {
    this.tone({ f: 150, f2: 400, dur: 0.18, type: "triangle", gain: 0.08 });
  }

  shieldHit(): void {
    this.tone({ f: 900, f2: 600, dur: 0.1, type: "sine", gain: 0.12 });
  }

  shieldBreak(): void {
    this.noise({ dur: 0.3, freq: 3500, freq2: 800, q: 2, gain: 0.16 });
    this.tone({ f: 700, f2: 200, dur: 0.25, type: "triangle", gain: 0.12 });
  }

  phantomBoom(): void {
    this.tone({ f: 250, f2: 60, dur: 0.3, type: "sawtooth", gain: 0.16 });
    this.noise({ dur: 0.25, freq: 1800, freq2: 300, q: 1, gain: 0.14 });
  }

  freezeSound(): void {
    this.noise({ dur: 0.5, freq: 6000, freq2: 2000, q: 4, gain: 0.1 });
    this.tone({ f: 1500, f2: 900, dur: 0.4, type: "sine", gain: 0.08 });
  }

  // ---------------------------------------------------------------- boss
  bossRoar(): void {
    this.tone({ f: 85, f2: 58, dur: 0.85, type: "sawtooth", gain: 0.22 });
    this.tone({ f: 128, f2: 86, dur: 0.7, type: "sawtooth", gain: 0.13 });
    this.tone({ f: 44, f2: 32, dur: 0.9, type: "sine", gain: 0.2 });
    this.noise({ dur: 0.7, freq: 280, q: 0.6, gain: 0.13, type: "lowpass" });
  }

  /** A huge, layered detonation when a boss falls. */
  bossDeath(): void {
    this.tone({ f: 80, f2: 22, dur: 0.7, type: "sine", gain: 0.34 });
    this.noise({ dur: 0.6, freq: 1600, freq2: 70, q: 0.5, gain: 0.26, type: "lowpass" });
    this.noise({ dur: 0.4, freq: 4200, freq2: 900, q: 0.8, gain: 0.12, delay: 0.04 });
    this.tone({ f: 360, f2: 60, dur: 0.4, type: "sawtooth", gain: 0.12, delay: 0.02 });
    this.tone({ f: 58, f2: 26, dur: 0.5, type: "sine", gain: 0.22, delay: 0.2 }); // second concussion
  }

  bossDash(): void {
    this.noise({ dur: 0.22, freq: 350, freq2: 1500, q: 1.4, gain: 0.16 });
  }

  bossLeap(): void {
    this.noise({ dur: 0.35, freq: 250, freq2: 900, q: 1.2, gain: 0.13 });
  }

  bossSlam(): void {
    this.tone({ f: 70, f2: 28, dur: 0.5, type: "sine", gain: 0.32 });
    this.noise({ dur: 0.4, freq: 800, freq2: 90, q: 0.6, gain: 0.24, type: "lowpass" });
  }

  // ---------------------------------------------------------------- UI / meta
  private uiHover(): void {
    this.tone({ f: 700, dur: 0.04, type: "sine", gain: 0.035 });
  }

  private uiClick(): void {
    this.tone({ f: 600, f2: 920, dur: 0.06, type: "sine", gain: 0.06 });
    this.tone({ f: 1200, dur: 0.03, type: "sine", gain: 0.03, delay: 0.01 });
  }

  private heal(): void {
    this.tone({ f: 520, f2: 660, dur: 0.2, type: "sine", gain: 0.09 });
    this.tone({ f: 780, f2: 990, dur: 0.25, type: "sine", gain: 0.07, delay: 0.08 });
  }

  private roomClear(): void {
    const notes = [523, 659, 784, 1046];
    notes.forEach((f, i) => this.tone({ f, dur: 0.22, type: "triangle", gain: 0.1, delay: i * 0.09 }));
  }

  relicPickup(): void {
    this.tone({ f: 660, dur: 0.12, type: "triangle", gain: 0.1 });
    this.tone({ f: 880, dur: 0.14, type: "triangle", gain: 0.1, delay: 0.08 });
    this.tone({ f: 1320, dur: 0.22, type: "sine", gain: 0.08, delay: 0.16 });
  }

  unlockFanfare(): void {
    const notes = [660, 880, 990, 1320];
    notes.forEach((f, i) => this.tone({ f, dur: 0.25, type: "triangle", gain: 0.09, delay: i * 0.1 }));
  }

  bossIntroSting(): void {
    // Cinematic riser → low impact. A slow swell of two low sines a fifth apart,
    // a filtered noise rise, then a sub drop — tense, not the old buzzy detune.
    this.tone({ f: 70, dur: 1.5, type: "sine", gain: 0.22, attack: 0.55 });
    this.tone({ f: 105, dur: 1.4, type: "sine", gain: 0.13, attack: 0.65 });
    this.noise({ dur: 1.2, freq: 200, freq2: 1500, q: 0.5, gain: 0.05, type: "bandpass" });
    this.tone({ f: 50, f2: 30, dur: 1.0, type: "sine", gain: 0.22, delay: 1.15 });
  }

  victory(): void {
    const notes = [523, 659, 784, 1046, 1318];
    notes.forEach((f, i) => this.tone({ f, dur: 0.4, type: "triangle", gain: 0.1, delay: i * 0.13 }));
  }

  defeat(): void {
    const notes = [392, 311, 262, 196];
    notes.forEach((f, i) => this.tone({ f, dur: 0.5, type: "sine", gain: 0.12, delay: i * 0.22 }));
  }

  /** Low evolving pad for the menus. */
  startAmbient(): void {
    if (!this.ac || !this.master || this.ambientNodes.length) return;
    const t0 = this.ac.currentTime;
    this.ambientGain = this.ac.createGain();
    this.ambientGain.gain.setValueAtTime(0.0001, t0);
    this.ambientGain.gain.exponentialRampToValueAtTime(0.05, t0 + 2.5);
    const filter = this.ac.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 320;
    const lfo = this.ac.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = this.ac.createGain();
    lfoGain.gain.value = 140;
    lfo.connect(lfoGain).connect(filter.frequency);
    for (const f of [55, 82.5, 110.3]) {
      const o = this.ac.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.detune.value = Math.random() * 8 - 4;
      o.connect(filter);
      o.start();
      this.ambientNodes.push(o);
    }
    filter.connect(this.ambientGain).connect(this.master);
    lfo.start();
    this.ambientNodes.push(lfo, filter);
  }

  stopAmbient(): void {
    if (!this.ac || !this.ambientGain) return;
    const t = this.ac.currentTime;
    this.ambientGain.gain.cancelScheduledValues(t);
    this.ambientGain.gain.setValueAtTime(this.ambientGain.gain.value, t);
    this.ambientGain.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    const nodes = this.ambientNodes;
    this.ambientNodes = [];
    this.ambientGain = null;
    window.setTimeout(() => {
      for (const n of nodes) {
        if (n instanceof OscillatorNode) {
          try { n.stop(); } catch { /* already stopped */ }
        }
        n.disconnect();
      }
    }, 1400);
  }
}
