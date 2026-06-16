/**
 * Streaming, crossfading music with per-state playlists, ducking and a
 * low-HP tension swell. Uses two HTMLAudioElement channels (A/B) that
 * crossfade so transitions never hard-cut. Tracks are STREAMED (never all
 * decoded into memory) so the ~56MB soundtrack costs almost nothing at boot.
 *
 * Headless-safe: play() rejections from the browser autoplay policy are
 * swallowed and retried on the first user gesture (Music.unlock), and media
 * `error` events are silenced so the smoke tests stay console-clean.
 *
 * Source tracks live in game/public/music and are served at /music/*.mp3.
 */

const BASE = import.meta.env.BASE_URL;

/**
 * Bespoke per-act soundtrack. One track per role/act so each act + boss has its
 * own identity: `set{act}` is the act's battle bed, `boss{act}` its boss theme.
 * Index 0 is a placeholder so `set[act]`/`boss[act]` read naturally (acts are 1-based).
 */
const TRACKS = {
  menu: "menu.mp3",
  tutorial: "tutorial.mp3",
  // The bed between stages (drafts, map, act intros) — distinct from the menu theme.
  between: "inbetween.mp3",
  // Per-act combat beds (set1..set5). Clamps past the last act.
  set: ["set1.mp3", "set1.mp3", "set2.mp3", "set3.mp3", "set4.mp3", "set5.mp3"],
  // Per-act boss themes (boss1..boss5). Act V uses its driving "start" theme; the
  // final fading phase swaps to the sad boss5 track via bossFinale().
  boss: ["boss1.mp3", "boss1.mp3", "boss2.mp3", "boss3.mp3", "boss4.mp3", "boss5start.mp3"],
  bossFinale: "boss5.mp3",
};

interface Channel {
  el: HTMLAudioElement;
  gain: number;
  target: number;
  file: string;
  /** While true this channel ramps fast (a loop crossfade); cleared once settled. */
  fast: boolean;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The soundtrack sits UNDER the SFX — a mid slider should still feel like a backing bed. */
const MUSIC_MASTER = 0.55;

/**
 * Seconds of overlap when a track loops back on itself. Kept SHORT — just enough
 * to paper over the MP3 seam without audibly layering the intro over the outro
 * (a long overlap muddied the loop). Both channels ramp fast over this window
 * (LOOP_RATE) so they cross cleanly with no dip and no end-of-file click.
 */
const LOOP_XFADE = 0.5;
const LOOP_RATE = 8; // fast equal-power-ish ramp used only during a loop crossfade

export class Music {
  volume = 0.55;
  private a: Channel;
  private b: Channel;
  private front: Channel;
  private duck = 1;
  private duckTarget = 1;
  private tension = 0;
  private tensionTarget = 0;
  private currentKey = "";

  constructor() {
    this.a = this.makeChannel();
    this.b = this.makeChannel();
    this.front = this.a;
  }

  private makeChannel(): Channel {
    const el = new Audio();
    // We loop manually (crossfade at the seam), so disable native looping.
    el.loop = false;
    el.preload = "auto";
    el.volume = 0;
    // Swallow load/decode errors so a missing file never trips the smoke tests.
    el.addEventListener("error", () => {});
    // Fallback hard-loop: if the crossfade never armed (e.g. duration unknown),
    // a still-active bed that runs out just restarts from the top.
    el.addEventListener("ended", () => {
      const ch = el === this.a.el ? this.a : el === this.b.el ? this.b : null;
      if (ch && ch === this.front && ch.target > 0 && this.currentKey !== "silence") {
        try { el.currentTime = 0; } catch { /* not seekable */ }
        this.tryPlay(el);
      }
    });
    return { el, gain: 0, target: 0, file: "", fast: false };
  }

  // ------------------------------------------------------------ public cues
  menu(): void {
    this.cue("menu", TRACKS.menu);
  }

  /** The Training Grounds theme. */
  tutorial(): void {
    this.cue("tutorial", TRACKS.tutorial);
  }

  /** The breather bed between stages: drafts, story scrolls, act intros, the map. */
  map(): void {
    this.cue("map", TRACKS.between);
  }

  combat(act: number, _elite = false): void {
    const file = TRACKS.set[Math.min(act, TRACKS.set.length - 1)] ?? TRACKS.set[1];
    this.cue(`combat:${act}`, file);
  }

  boss(act: number): void {
    const file = TRACKS.boss[Math.min(act, TRACKS.boss.length - 1)] ?? TRACKS.boss[1];
    this.cue(`boss:${act}`, file);
  }

  /** The final boss's last (sad) phase — swap the driving theme for the lament. */
  bossFinale(): void {
    this.cue("boss:finale", TRACKS.bossFinale);
  }

  silence(): void {
    if (this.currentKey === "silence") return;
    this.currentKey = "silence";
    this.front.target = 0;
  }

  // ------------------------------------------------------------ modulation
  /** Lower the bed under cutscenes / dialogue. 1 = full, ~0.3 = ducked. */
  duckTo(level: number): void {
    this.duckTarget = clamp01(level);
  }

  /** 0..1 — a subtle swell as the player nears death. */
  setTension(t: number): void {
    this.tensionTarget = clamp01(t);
  }

  setVolume(v: number): void {
    this.volume = clamp01(v);
    // Coming back from muted: make sure the foreground is actually rolling.
    if (this.volume > 0 && this.currentKey !== "silence") this.unlock();
  }

  /** Retry blocked playback after the first user gesture. */
  unlock(): void {
    for (const ch of [this.a, this.b]) {
      if (ch.target > 0 && ch.file && ch.el.paused) this.tryPlay(ch.el);
    }
  }

  // ------------------------------------------------------------ per-frame
  update(dt: number): void {
    this.duck += (this.duckTarget - this.duck) * Math.min(1, dt * 4);
    this.tension += (this.tensionTarget - this.tension) * Math.min(1, dt * 1.5);
    this.maybeLoop();
    for (const ch of [this.a, this.b]) {
      ch.gain += (ch.target - ch.gain) * Math.min(1, dt * (ch.fast ? LOOP_RATE : 1.4));
      const vol = clamp01(ch.gain) * this.volume * MUSIC_MASTER * this.duck * (1 + this.tension * 0.16);
      ch.el.volume = clamp01(vol);
      // Once a loop crossfade settles, drop back to the smooth ramp for state changes.
      if (ch.fast && Math.abs(ch.target - ch.gain) < 0.02) ch.fast = false;
      if (ch.target === 0 && ch.gain < 0.02 && !ch.el.paused) ch.el.pause();
    }
  }

  // ------------------------------------------------------------ internals
  private cue(key: string, file: string): void {
    if (key === this.currentKey) return;
    this.currentKey = key;
    this.crossTo(file);
  }

  private crossTo(file: string): void {
    // Already foregrounding this file — just make sure it's rising.
    if (this.front.file === file && !this.front.el.paused) {
      this.front.target = 1;
      return;
    }
    this.startBack(file);
  }

  /** Bring the back channel up on `file` from the top and fade the front out. */
  private startBack(file: string): void {
    const back = this.front === this.a ? this.b : this.a;
    back.file = file;
    const url = `${BASE}music/${file}`;
    if (!back.el.src.endsWith(url)) back.el.src = url;
    try {
      back.el.currentTime = 0;
    } catch {
      /* not seekable yet */
    }
    this.tryPlay(back.el);
    back.target = 1;
    this.front.target = 0;
    this.front = back;
  }

  /**
   * Gapless loop: a little before the active bed reaches its end, start a fresh
   * copy of the same track on the other channel and crossfade. The outgoing tail
   * plays out cleanly (no native loop seam) while the new copy takes over.
   */
  private maybeLoop(): void {
    if (this.currentKey === "silence") return;
    const f = this.front;
    if (f.target !== 1 || !f.file || f.el.paused) return;
    const dur = f.el.duration;
    if (!Number.isFinite(dur) || dur <= LOOP_XFADE * 2) return;
    if (dur - f.el.currentTime <= LOOP_XFADE) {
      const outgoing = this.front;
      this.startBack(f.file); // swaps front → the new copy (full duration remaining, won't re-fire)
      outgoing.fast = true;   // both channels ramp fast for the short loop crossfade
      this.front.fast = true;
    }
  }

  private tryPlay(el: HTMLAudioElement): void {
    if (!el.play) return;
    const p = el.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  }
}
