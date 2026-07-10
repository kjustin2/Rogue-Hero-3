import "@fontsource/cinzel/600.css";
import "@fontsource/cinzel/700.css";
import "@fontsource/rajdhani/500.css";
import "@fontsource/rajdhani/600.css";
import "@fontsource/rajdhani/700.css";
import "./style.css";

import * as THREE from "three";
import { Stage } from "./render/stage";
import { CameraRig } from "./render/cameraRig";
import { Particles } from "./render/particles";
import { SwordTrail } from "./render/trail";
import { Telegraphs } from "./render/telegraphs";
import { Floaters } from "./render/floaters";
import { Arena, ARENA_RADIUS, THEMES } from "./render/arena";
import { ContactShadows } from "./render/contactShadow";
import { EffectsPanel } from "./debug/effectsToggle";
import { auditUI, auditOcclusion } from "./debug/uiAudit";
import { setRimEnabled } from "./render/materialFx";
import { Decals } from "./render/decals";
import { Input } from "./core/input";
import { EventBus } from "./core/events";
import { Rng } from "./core/rng";
import { Sfx } from "./audio/sfx";
import { Music } from "./audio/music";
import { Player } from "./game/player";
import { Controller } from "./game/controller";
import { Tempo, ZONE_PALETTE } from "./game/tempo";
import { Combat } from "./game/combat";
import { Projectiles, HostileProjectiles } from "./game/projectiles";
import { EnemyManager } from "./game/enemies";
import "./game/enemies2"; // registers the Act II/III roster
import { ROMAN } from "./game/run";
import { Relics } from "./game/relics";
import { Profile, loadRunSave, writeRunSave, clearRunSave, type RunSave, type UnlockedItem } from "./game/profile";
import { heroById, HEROES, type HeroDef } from "./game/heroes";
import { cardById, CARDS } from "./game/cards";
import { Deck } from "./game/deck";
import { CardCaster } from "./game/cards";
import { RunManager } from "./game/run";
import { MapFeatures } from "./game/features";
import { Hud } from "./ui/hud";
import { Menus } from "./ui/menus";
import { MenuNav } from "./ui/menuNav";
import { Tutorial } from "./game/tutorial";
import { generatePlan } from "./game/mapgen";
import { difficultyFor, MAX_DEPTH } from "./game/difficulty";
import { freshStats, type Ctx } from "./game/ctx";
import { PerfMonitor } from "./debug/perfMonitor";

type GameState = "menu" | "playing" | "paused" | "draft" | "cutscene" | "dead" | "victory";

const STORY_LINES = [
  "A hundred years ago the Rift tore open beneath the kingdom, and a terrible light came pouring out of the dark.",
  "That light burned the world. It also became our every gift — our power, our wonder. It made the Rift-sworn. It made you.",
  "Three wardens were sworn to keep its heart. The kingdom calls them monsters now, and sends you to break them.",
  "Descend, Rift-sworn. Reach the core. End what began here — whatever it costs.",
];

/** Story beats shown as a short cutscene when you cross into a new act (2–5). */
const ACT_STORY: Record<number, string[]> = {
  2: [
    "The Pit Warden is broken — yet it does not curse you. It weeps. “You don't know what you're ending,” it breathes, and goes still.",
    "Far above, a shattered spire sings with caged lightning. The second warden has guarded this way for a hundred years.",
  ],
  3: [
    "The Spire Caster comes apart into falling sparks. “We were never your enemy,” its echoes sigh. “We were only the last to love the light.”",
    "The floor melts to molten glass. In the burning heart of the world, the Colossus has kept its watch since the day it fell.",
  ],
  4: [
    "The Colossus stills at last. Across its chest, words worn nearly smooth: HERE WE KEEP THE LAST WARMTH OF THE WORLD.",
    "The final seals fail. Beyond the broken world the Abyss yawns — and the Rift Tyrant lays down its crown rather than raise it against you.",
  ],
  5: [
    "“Go, then,” the Tyrant breathes, kneeling. “Put out the star. Be the hero they need. We were too weak to do it. Or too kind.”",
    "At the end of all light waits the Hollow Star: the dying heart of the world, alone in the dark a hundred years, holding the cold back by itself.",
  ],
};
/** Highest act whose transition story has already played this run (1 = opening covers act 1). */
let lastActStory = 1;

/** The bittersweet payoff after the Hollow Star falls — saved the world, and dimmed it. */
const ENDING_LINES = [
  "The Hollow Star is gone. The Rift folds shut behind it, quiet at last.",
  "You have done it. The dark will not spread again. The world is saved.",
  "But the light that fell a hundred years ago — the light that became your every gift — goes out with the star.",
  "Far above, a kingdom wakes to a grey and silent dawn. Safe. Ordinary. A little smaller than it was.",
  "No one will ever know what it cost. That, too, is yours to keep.",
];

/** The mercy ending — spare the Hollow Star and carry its ember home. */
const MERCY_ENDING_LINES = [
  "You lower your blade. The Hollow Star, braced for an ending, finds none.",
  "It does not understand mercy. Neither, quite, do you — only that some lights are worth the dark they cost.",
  "You gather its last ember in your hands and carry it up, out of the Rift, into a world that will never know how close it came to going out.",
  "The Rift remains. So does the wonder. So does the danger. You chose to keep all of it.",
  "Some will call it foolish. You call it hope.",
];

/** A closing line tinted by who you played — appended to whichever ending you reached. */
const HERO_ENDING: Record<string, string> = {
  blade: "The Blade sheathes a sword that was never truly the answer, and walks on.",
  bulwark: "The Bulwark, who only ever wanted to hold the line, finally lets it rest.",
  sparkmage: "The Sparkmage feels the borrowed lightning fade from their hands — and does not grieve it.",
  reaver: "The Reaver's fury, with nothing left to burn, goes quiet for the first time in years.",
  tempest: "The Tempest stops moving — just once — long enough to remember why it ran.",
};

/** Set true while the Unmaker is in its fading phase and can still be spared. */
let unmakerFading = false;
let spareHold = 0;
/** True if the player spared the Hollow Star (drives the mercy ending). */
let chosenMercy = false;

const ACT_FLAVOR = [
  "WHERE THE KINGDOM FIRST FELL",
  "THE WARDENS' SHATTERED SANCTUM",
  "THE HEART OF THE WOUND",
  "BEYOND THE BROKEN WORLD",
  "AT THE END OF ALL LIGHT",
];

const BOSS_EPITAPHS: Record<string, [string, string]> = {
  warden: ["THE PIT WARDEN WEEPS", "“You don't know what you're ending.”"],
  spire: ["THE SPIRE CASTER FADES", "“We were the last to love the light.”"],
  colossus: ["THE COLOSSUS RESTS", "HERE WE KEEP THE LAST WARMTH OF THE WORLD"],
  tyrant: ["THE TYRANT KNEELS", "“Put out the star. We could not.”"],
};

const canvas = document.getElementById("game") as HTMLCanvasElement;

// ---------------------------------------------------------------- boot wiring
const ctx = {} as Ctx;
ctx.stage = new Stage(canvas);
ctx.cam = new CameraRig(ctx.stage.camera);
ctx.events = new EventBus();
ctx.rng = new Rng();
ctx.input = new Input(canvas);
ctx.fx = new Particles(ctx.stage.scene);
ctx.trail = new SwordTrail(ctx.stage.scene);
ctx.tele = new Telegraphs(ctx.stage.scene);
ctx.floaters = new Floaters(ctx.stage.camera);
ctx.arena = new Arena(ctx.stage);
// ponytail: fixed 12/type — stage.quality is still its "high" default here (settings
// apply later), so the old low→8 branch never fired; 4 flat quads isn't worth the wiring.
ctx.decals = new Decals(ctx.stage.scene, 12);
const contactShadows = new ContactShadows(ctx.stage.scene);
// Reused scratch so placing a blob under the hero + every living enemy each frame
// allocates nothing (the object pool is mutated in place).
const CA_MAX = 48;
const caPool = Array.from({ length: CA_MAX }, () => ({ x: 0, z: 0, radius: 0.8, y: 0 }));
const caList: { x: number; z: number; radius: number; y: number }[] = [];
function updateContactShadows(): void {
  caList.length = 0;
  let i = 0;
  if (ctx.player.alive && i < CA_MAX) {
    const o = caPool[i++]; o.x = ctx.player.pos.x; o.z = ctx.player.pos.z; o.radius = ctx.player.radius; caList.push(o);
  }
  for (const e of ctx.enemies.living()) {
    if (i >= CA_MAX) break;
    const o = caPool[i++]; o.x = e.pos.x; o.z = e.pos.z; o.radius = (e.radius || 0.8); caList.push(o);
  }
  contactShadows.update(caList);
}
ctx.sfx = new Sfx(ctx.events);
ctx.music = new Music();
ctx.stats = freshStats();
ctx.playing = false;
ctx.tempo = new Tempo(ctx.events);
ctx.player = new Player(ctx);
ctx.controller = new Controller(ctx);
ctx.combat = new Combat(ctx);
ctx.projectiles = new Projectiles(ctx, ctx.stage.scene);
ctx.hostiles = new HostileProjectiles(ctx, ctx.stage.scene);
ctx.enemies = new EnemyManager(ctx);
ctx.deck = new Deck(ctx);
ctx.caster = new CardCaster(ctx);
ctx.profile = new Profile();
ctx.relics = new Relics(ctx);
ctx.difficulty = difficultyFor(0);
ctx.run = new RunManager(ctx);
ctx.features = new MapFeatures(ctx);
// Relics scale (or freeze) the tempo drift
ctx.tempo.decayScale = (v) => ctx.relics.tempoDecayMult(v);

const hud = new Hud(ctx);
const tutorial = new Tutorial(ctx, hud);
let state: GameState = "menu";
let inTutorial = false;
// Latched the instant a run ends (death / victory). Blocks pause AND the
// pause→Exit→checkpoint path so a win/death can't be undone by quitting during
// the resolution delay. Reset at each startRun.
let runResolved = false;
// Latched at the Wound reveal (point of no return past the Unmaker). Blocks only
// checkpoint writes — the fight stays pausable — so quitting mid-Wound can't
// leave a save that resumes at the already-dead Unmaker. Reset at each startRun.
let woundActive = false;

// Run seeding: each run gets a fresh random stream (resume reproduces via the saved seed).
let nextRunDepth = 0;
let nextBlessing: string | null = null;
let currentSeed = 0;
let currentDepth = 0;

const menus = new Menus(ctx, {
  onStartRun: (hero, depth, blessing) => { nextRunDepth = depth; nextBlessing = blessing || null; startRun(hero); },
  onNewRun: () => { menus.showHeroSelect(); },
  onTutorial: startTutorial,
  onContinueRun: continueRun,
  onResume: resume,
  onAbandon: abandonRun,
  onExitRun: () => { if (!inTutorial) checkpoint(); toMenu(); },
  onRetry: () => { nextRunDepth = currentDepth; startRun(ctx.player.hero); },
  onMenu: toMenu,
  onQuit: quitToDesktop,
  hasSave: () => loadRunSave() !== null,
});
menus.applySettings();
const menuNav = new MenuNav(ctx.input);

// Controller plug/unplug feedback — so the player can SEE the pad was detected
// (Chromium only exposes a pad after its first button press, hence the prompt).
let padToastEl: HTMLElement | null = null;
let padToastTimer = 0;
ctx.input.onGamepadChange = (connected) => {
  if (!padToastEl) {
    padToastEl = document.createElement("div");
    padToastEl.className = "pad-toast";
    document.body.appendChild(padToastEl);
  }
  padToastEl.textContent = connected ? "🎮  Controller connected" : "🎮  Controller disconnected";
  padToastEl.classList.toggle("pad-toast--off", !connected);
  // Force reflow so re-showing restarts the slide-in animation.
  void padToastEl.offsetWidth;
  padToastEl.classList.add("pad-toast--show");
  window.clearTimeout(padToastTimer);
  padToastTimer = window.setTimeout(() => padToastEl?.classList.remove("pad-toast--show"), 2800);
};

// Audio unlock on first gesture (browser autoplay policy)
const unlock = () => {
  ctx.sfx.resume();
  ctx.music.unlock();
  window.removeEventListener("pointerdown", unlock);
  window.removeEventListener("keydown", unlock);
};
window.addEventListener("pointerdown", unlock);
window.addEventListener("keydown", unlock);

let combatWarmupDone = false;
let combatWarmupScheduled = false;
function warmCombatShaders(): void {
  if (combatWarmupDone) return;
  combatWarmupDone = true;
  combatWarmupScheduled = false;
  ctx.caster.precompile();
  ctx.enemies.precompile();
}

function scheduleCombatWarmup(): void {
  if (combatWarmupDone || combatWarmupScheduled) return;
  combatWarmupScheduled = true;
  window.setTimeout(() => warmCombatShaders(), 140);
}

// ---------------------------------------------------------------- state flow
function startRun(hero: HeroDef, resume?: RunSave): void {
  menus.clear();
  ctx.sfx.stopAmbient();
  ctx.stats = resume ? resume.stats : freshStats();
  ctx.player.applyHero(hero, ctx.profile.data.equipped.cape, ctx.profile.data.equipped.blade);
  ctx.profile.setLastHero(hero.id);
  ctx.player.alive = true;
  ctx.player.shield = 0;
  ctx.player.root.visible = true;
  ctx.tempo.reset();
  ctx.tempo.heroDecayMult = hero.tempoDecayMult;
  ctx.deck.resetForRun();
  ctx.relics.resetForRun();
  ctx.profile.beginRun();
  inTutorial = false;
  lastActStory = 1;
  musicLament = false;
  unmakerFading = false;
  spareHold = 0;
  chosenMercy = false;
  ctx.stage.setMood("neutral"); // retry/continue must not inherit the last run's death/victory grade
  // Re-derive Ascendant Rank from the (possibly restored) kill count so a resumed run
  // doesn't reset to 0 and replay already-earned milestone heals/banners on the next kills.
  ascendantRank = ASCENDANT_THRESHOLDS.filter((t) => ctx.stats.kills >= t).length;
  ctx.combat.runRankMult = 1 + ascendantRank * 0.06;
  ctx.combat.emberRevive = false;
  runResolved = false;
  woundActive = false;
  clearEmberAlly();

  if (resume) {
    currentSeed = resume.seed;
    // Re-seed the sim RNG on resume — the fresh-run path does this (below) but the
    // resume path did NOT, so a resumed run's crit/drop/spawn stream continued from
    // whatever menu-time entropy it held instead of the run's seed. Without this a
    // resume is non-reproducible (each resume rolls a different fight). Found by the
    // save-determinism oracle; the golden-trace MR gates it.
    ctx.rng.reseed(resume.seed);
    currentDepth = resume.depth;
    ctx.stats.depth = resume.depth;
    ctx.difficulty = difficultyFor(resume.depth);
    ctx.tempo.drainMult = ctx.difficulty.tempoDrainMult;
    ctx.run.restore(generatePlan(resume.seed, resume.depth), resume.position, resume.path);
    lastActStory = ctx.run.forkOptions()[0]?.act ?? 1; // don't replay the act we're resuming into
    resume.slots.forEach((id, i) => (ctx.deck.slots[i] = id ? cardById(id) : null));
    ctx.deck.upgraded = resume.upgraded ? resume.upgraded.slice() : [false, false, false];
    ctx.relics.restore(resume.relics);
    // Restore run-scoped max-HP gains (blessing / Warden's Heart) so resume keeps them.
    if (resume.maxHp && resume.maxHp > ctx.player.maxHp) ctx.player.maxHp = resume.maxHp;
    ctx.player.hp = Math.max(1, Math.min(ctx.player.maxHp, resume.hp));
    hud.buildPips(ctx.run.plan);
    ctx.cam.mode = "follow";
    hud.setVisible(true);
    presentFork();
    scheduleCombatWarmup();
    return;
  }

  clearRunSave();
  // Seed + depth: a fresh random stream each run (the saved seed reproduces on resume).
  currentSeed = Date.now() >>> 0;
  currentDepth = Math.min(nextRunDepth, ctx.profile.data.maxDepth);
  ctx.stats.depth = currentDepth;
  ctx.difficulty = difficultyFor(currentDepth);
  ctx.tempo.drainMult = ctx.difficulty.tempoDrainMult;
  ctx.rng.reseed(currentSeed);
  ctx.run.begin(generatePlan(currentSeed, currentDepth));
  hud.buildPips(ctx.run.plan);
  // Run-start blessing (chosen after the hero) — applied before HP is topped off.
  // Guarded: blessings are unlocked through play, so an un-earned one is ignored.
  if (nextBlessing && ctx.profile.isUnlocked(`blessing:${nextBlessing}`)) {
    if (nextBlessing === "vigor") ctx.player.maxHp += 25;
    else if (nextBlessing === "fortune") awardShards(120);
    else if (nextBlessing === "arsenal") { const r = ctx.relics.draftChoices()[0]; if (r) ctx.relics.add(r); }
  }
  nextBlessing = null;
  checkpoint(); // initial save so quitting during the opening still has a Continue point
  ctx.player.hp = ctx.player.maxHp;
  // Opening story over an emptied arena; the first node loads after
  ctx.enemies.clear();
  ctx.projectiles.clear();
  ctx.hostiles.clear();
  ctx.caster.clear();
  ctx.arena.setObstacles([], 0);
  ctx.player.pos.set(0, 0, 6);
  ctx.player.facing = Math.PI;
  ctx.cam.snapTo(0, 6);
  state = "cutscene";
  ctx.input.enabled = false;
  ctx.music.duckTo(1);
  ctx.music.map();
  // Opening cinematic: slow orbit of the lone hero on the disc, embers drifting up,
  // the rift's words rising over a letterboxed frame.
  ctx.arena.applyTheme(THEMES.rift);
  ctx.cam.menuOrbit();
  ctx.fx.ambientColor = THEMES.rift.ember;
  ctx.fx.ambientRate = 18;
  const introFx = window.setInterval(() => {
    const a = Math.random() * Math.PI * 2;
    const r = 6 + Math.random() * 11;
    ctx.fx.burst({
      x: Math.sin(a) * r, y: 0.2, z: Math.cos(a) * r,
      count: 4, color: [0xff7733, 0x55ccff], speed: [0.4, 2], up: 2.4, size: [0.25, 0.6], life: [0.9, 1.7], gravity: 0.3, drag: 1.1, jitter: 0.6,
    });
  }, 200);
  menus.storyIntro(STORY_LINES, () => {
    window.clearInterval(introFx);
    menus.clear();
    ctx.cam.mode = "follow";
    ctx.fx.ambientRate = 7;
    hud.setVisible(true);
    presentFork();
  });
  scheduleCombatWarmup();
}

/**
 * Between-acts cutscene: clear the field, crossfade to the new act's look, orbit
 * the lone hero under drifting embers, and rise the story over a letterboxed
 * frame — then hand off to load the act's first chamber.
 */
/**
 * Act interlude: a short PLAYABLE beat between acts. The hero walks a narrow
 * pillar causeway under the new act's sky while the story lines drift past as
 * banners, and two lights burn at the far end — step into one to take its gift
 * (mend vs shards) and cross into the act. The skip button uses the same
 * .story-skip affordance the old cutscene had, so smokes and impatient players
 * resolve it instantly (no boon).
 */
let interlude: {
  pads: { x: number; z: number; kind: "mend" | "shards"; ring: THREE.Mesh; mat: THREE.MeshBasicMaterial; label: string; color: number; badge: HTMLElement }[];
  group: THREE.Group;
  timers: number[];
  /** Just the story-banner timers — cleared when the words are skipped early. */
  wordTimers: number[];
  skipBtn: HTMLElement;
  hint: HTMLElement;
  onDone: () => void;
  onAdvance: (e: Event) => void;
  t: number;
  /** True while the act's story banners are still playing — the hero is held at
   * the causeway mouth and the lights are inert until the words come and go. */
  locked: boolean;
} | null = null;

/** Skip the remaining story banners and release the hero to the choice (click / key
 *  during the words, or the release timer firing). Does NOT skip the whole interlude —
 *  the player still walks into a light for its boon. */
function releaseInterludeWords(): void {
  if (!interlude || !interlude.locked) return;
  interlude.wordTimers.forEach((t) => window.clearTimeout(t)); // no more words after this
  interlude.locked = false;
  interlude.hint.remove();
  ctx.sfx.cardReady();
  hud.banner("STEP INTO A LIGHT", "", "banner--clear");
  for (const pad of interlude.pads) ctx.fx.ring(pad.x, pad.z, { radius: 2.0, color: pad.color, duration: 0.6 });
}

/** Tear the interlude scene down. `chosen` applies that pad's boon; null = skipped. */
function finishInterlude(chosen: "mend" | "shards" | null, proceed = true): void {
  if (!interlude) return;
  const it = interlude;
  interlude = null;
  ctx.input.enabled = true; // the words-lock may have disabled it; the next node needs movement
  it.timers.forEach((t) => window.clearTimeout(t));
  it.skipBtn.remove();
  it.hint.remove();
  for (const pad of it.pads) pad.badge.remove();
  window.removeEventListener("pointerdown", it.onAdvance);
  window.removeEventListener("keydown", it.onAdvance);
  ctx.stage.scene.remove(it.group);
  it.group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
  hud.setLetterbox(false);
  ctx.arena.setObstacles([], 0);
  if (chosen === "mend") {
    const h = Math.min(30, ctx.player.maxHp - ctx.player.hp);
    if (h > 0) {
      ctx.player.hp += h;
      ctx.events.emit("HEAL", { amount: h });
    }
    ctx.sfx.relicPickup();
    hud.banner("THE WARM LIGHT MENDS YOU", "", "banner--clear");
  } else if (chosen === "shards") {
    awardShards(45);
    ctx.sfx.relicPickup();
    hud.banner("THE BRIGHT LIGHT PAYS ITS DEBT", "", "banner--clear");
  }
  if (proceed) it.onDone();
}

const interludeScratch = new THREE.Vector3();
/** Peg each light's persistent DOM badge above its beam by projecting the world
 *  position to screen — so the player always sees what each light does, even while moving. */
function positionInterludeBadges(): void {
  if (!interlude) return;
  const w = window.innerWidth, h = window.innerHeight;
  for (const pad of interlude.pads) {
    interludeScratch.set(pad.x, 3.4, pad.z).project(ctx.stage.camera);
    // Clamp into the visible band: the lights sit far up the causeway and often
    // project off the top edge at the spawn, so pin the badge on-screen (it tracks
    // the light once it comes into view) — the choice must be readable from the start.
    const sx = Math.max(w * 0.15, Math.min(w * 0.85, (interludeScratch.x * 0.5 + 0.5) * w));
    const sy = Math.max(h * 0.18, Math.min(h * 0.68, (-interludeScratch.y * 0.5 + 0.5) * h));
    pad.badge.style.left = `${sx}px`;
    pad.badge.style.top = `${sy}px`;
  }
}

/** Per-frame interlude tick (runs inside the playing branch of the loop). */
function updateInterlude(dt: number): void {
  if (!interlude) return;
  const it = interlude;
  it.t += dt;
  positionInterludeBadges();
  // While the act's words play, the hero is paused at the causeway mouth: no
  // crossing until the story has come and gone (or the player clicks to skip them).
  // Re-assert the freeze every frame so a pause→resume can't unlock movement early.
  if (it.locked) {
    ctx.input.enabled = false;
    for (const pad of it.pads) {
      pad.mat.opacity = 0.28 + Math.abs(Math.sin(it.t * 2.0 + pad.x)) * 0.14;
      pad.ring.rotation.z += dt * 0.6;
    }
    return;
  }
  ctx.input.enabled = true;
  for (const pad of it.pads) {
    pad.mat.opacity = 0.55 + Math.abs(Math.sin(it.t * 2.4 + pad.x)) * 0.4;
    pad.ring.rotation.z += dt * 1.2;
    if (ctx.player.alive && Math.hypot(ctx.player.pos.x - pad.x, ctx.player.pos.z - pad.z) < 1.6) {
      takeInterludePad(pad);
      return;
    }
  }
  // Crossing the line of lights always resolves to the NEAREST light — walking
  // dead-center between the pads (or past them) must never strand the player.
  if (ctx.player.alive && ctx.player.pos.z < -13.6) {
    let best = it.pads[0];
    for (const pad of it.pads) if (Math.abs(ctx.player.pos.x - pad.x) < Math.abs(ctx.player.pos.x - best.x)) best = pad;
    takeInterludePad(best);
    return;
  }
}

function takeInterludePad(pad: { x: number; z: number; kind: "mend" | "shards"; color: number }): void {
  ctx.fx.ring(pad.x, pad.z, { radius: 2.4, color: pad.color, duration: 0.5 });
  ctx.fx.burst({
    x: pad.x, y: 1, z: pad.z,
    count: 24, color: [pad.color, 0xffffff], speed: [2, 7], up: 0.8, size: [0.35, 0.7], life: [0.25, 0.55], gravity: -1, drag: 3,
  });
  finishInterlude(pad.kind);
}

function playActTransition(node: { act: number; actName: string; theme: keyof typeof THEMES }, onDone: () => void): void {
  state = "playing"; // a real playable beat — the hero walks the causeway
  ctx.input.enabled = false; // held frozen until the act's words come and go (see release timer)
  hud.setVisible(true);
  hud.setLetterbox(true);
  ctx.music.duckTo(0.7);
  ctx.music.map();
  ctx.enemies.clear();
  ctx.projectiles.clear();
  ctx.hostiles.clear();
  ctx.caster.clear();
  ctx.features.clear();
  const theme = THEMES[node.theme];
  ctx.arena.applyTheme(theme);
  ctx.fx.ambientColor = theme.ember;
  ctx.fx.ambientRate = 14;

  // The causeway: two pillar rows funnel the walk from the south rim to the lights.
  const obs: { x: number; z: number; r: number }[] = [];
  for (let i = 0; i < 5; i++) {
    const z = 10 - i * 5.5;
    obs.push({ x: -4.4, z, r: 1.1 }, { x: 4.4, z, r: 1.1 });
  }
  ctx.arena.setObstacles(obs, theme.crystal);
  ctx.player.pos.set(0, 0, 13);
  ctx.player.facing = Math.PI;
  ctx.cam.mode = "follow";
  ctx.cam.snapTo(0, 13);

  // Two lights at the bridge's end — the choice tiles. Big, bright beams + a
  // persistent screen badge over each so it's unmistakable what each gift does.
  const group = new THREE.Group();
  const pads: NonNullable<typeof interlude>["pads"] = [];
  const padDefs = [
    { x: -3.4, z: -14, kind: "mend" as const, color: 0x7dffb0, label: "MEND", title: "✚ MEND", sub: "restore 30 HP" },
    { x: 3.4, z: -14, kind: "shards" as const, color: 0xffd24a, label: "SHARDS", title: "◆ SHARDS", sub: "gain 45 shards" },
  ];
  const makeBadge = (color: number, title: string, sub: string): HTMLElement => {
    const el = document.createElement("div");
    const hex = "#" + color.toString(16).padStart(6, "0");
    el.style.cssText = `position:fixed;transform:translate(-50%,-50%);pointer-events:none;z-index:40;text-align:center;white-space:nowrap;font-family:var(--font-display,'Cinzel',serif);`;
    el.innerHTML =
      `<div style="font-size:30px;font-weight:700;letter-spacing:4px;color:${hex};text-shadow:0 0 16px ${hex},0 0 32px ${hex},0 2px 8px #000;">${title}</div>` +
      `<div style="font-size:15px;letter-spacing:3px;margin-top:3px;color:#eef4ff;text-shadow:0 0 8px ${hex},0 1px 4px #000;font-family:var(--font-body,sans-serif);">${sub}</div>`;
    document.body.appendChild(el);
    return el;
  };
  for (const d of padDefs) {
    const mat = new THREE.MeshBasicMaterial({ color: d.color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 1.7, 32), mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(d.x, 0.05, d.z);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.7, 28), mat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(d.x, 0.04, d.z);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.15, 6.2, 18, 1, true), mat);
    beam.position.set(d.x, 3.1, d.z);
    group.add(ring, disc, beam);
    pads.push({ x: d.x, z: d.z, kind: d.kind, ring, mat, label: d.label, color: d.color, badge: makeBadge(d.color, d.title, d.sub) });
  }
  group.userData.solidity = "nonsolid"; // boon pads are walked ONTO by design
  ctx.stage.scene.add(group);

  // Skip affordance (skips the WHOLE interlude, no boon — same class the old cutscene used).
  const skipBtn = document.createElement("button");
  skipBtn.className = "story-skip";
  skipBtn.textContent = "SKIP ▸";
  document.body.appendChild(skipBtn);
  skipBtn.addEventListener("click", () => finishInterlude(null));

  // A click / Space / Enter anywhere else during the words SKIPS THROUGH THE WORDS
  // (releases the hero to the choice) without skipping the boon — read at your pace.
  const hint = document.createElement("div");
  hint.style.cssText = `position:fixed;left:50%;bottom:16%;transform:translateX(-50%);z-index:41;pointer-events:none;color:rgba(223,232,255,0.72);font-size:14px;letter-spacing:2px;text-shadow:0 1px 4px #000;`;
  hint.textContent = "click / space to skip the words ▸";
  document.body.appendChild(hint);
  const onAdvance = (e: Event): void => {
    if (!interlude || !interlude.locked) return;
    if (e.target === skipBtn) return; // that button skips the whole beat
    if (e.type === "keydown" && !["Space", "Enter", "KeyE"].includes((e as KeyboardEvent).code)) return;
    releaseInterludeWords();
  };
  window.addEventListener("pointerdown", onAdvance);
  window.addEventListener("keydown", onAdvance);

  // The story drifts past as banners while the hero walks.
  const timers: number[] = [];
  const wordTimers: number[] = [];
  const lines = [...(ACT_STORY[node.act] ?? [])];
  const LINE_START = 4200, LINE_GAP = 6200, LAMENT_MS = 8200; // last line uses banner--lament (8.2s dwell)
  wordTimers.push(window.setTimeout(() => hud.banner(`ACT ${ROMAN[node.act - 1] ?? node.act}`, node.actName, "banner--long"), 500));
  lines.forEach((line, i) => {
    wordTimers.push(window.setTimeout(() => hud.banner(line, "", "banner--long banner--lament"), LINE_START + i * LINE_GAP));
  });
  // Release the hero once the last word has come and gone (or a click gets there first).
  const wordsEndMs = lines.length ? LINE_START + (lines.length - 1) * LINE_GAP + LAMENT_MS : 3200;
  timers.push(window.setTimeout(() => releaseInterludeWords(), wordsEndMs));
  // Soft-lock guard: if nothing is chosen in 45s (past the words), cross without a gift.
  timers.push(window.setTimeout(() => finishInterlude(null), 45000));
  timers.push(...wordTimers);

  interlude = { pads, group, timers, wordTimers, skipBtn, hint, onDone, onAdvance, t: 0, locked: true };
}

/** Present the current fork: a forced node auto-enters; a choice fork opens the map. */
function presentFork(): void {
  if (ctx.run.position >= ctx.run.totalForks) return; // run resolved (boss → victory)
  if (ctx.run.isChoice) {
    state = "draft";
    ctx.input.enabled = false;
    ctx.music.map();
    menus.showMap(ctx.run.forkOptions(), ctx.run.position, ctx.run.totalForks, (i) => {
      menus.clear();
      ctx.run.select(i);
      enterCurrentNode();
    });
  } else {
    ctx.run.select(0);
    enterCurrentNode();
  }
}

/** Dispatch the chosen node: combat/elite/boss fight in the arena; the rest are screens. */
function enterCurrentNode(): void {
  const node = ctx.run.currentNode;
  if (!node) return;
  const fightDone = () => { menus.clear(); advanceAfterNode(); };
  switch (node.kind) {
    case "combat":
    case "elite":
    case "boss": {
      const load = () => {
        menus.clear();
        hud.setVisible(true);
        state = "playing";
        ctx.input.enabled = true;
        warmCombatShaders();
        ctx.run.loadCurrentNode();
      };
      // Crossing into a new act (2+) plays a short story cutscene before the fight.
      if (node.act > lastActStory && ACT_STORY[node.act]) {
        lastActStory = node.act;
        playActTransition(node, load);
      } else {
        load();
      }
      break;
    }
    case "shop":
      state = "draft"; ctx.music.map();
      menus.showShop(fightDone);
      break;
    case "treasure":
      state = "draft"; ctx.music.map();
      menus.showTreasure(fightDone);
      break;
    case "rest":
      state = "draft"; ctx.music.map();
      menus.showRest(fightDone);
      break;
    case "event":
      state = "draft"; ctx.music.map();
      menus.showEvent(fightDone);
      break;
    case "shrine":
      state = "draft"; ctx.music.map();
      menus.showShrine(fightDone);
      break;
    case "gamble":
      state = "draft"; ctx.music.map();
      menus.showGamble(fightDone);
      break;
  }
}

/** A node has fully resolved (reward taken / screen left): checkpoint and present the next fork. */
function advanceAfterNode(): void {
  ctx.run.proceed();
  checkpoint();
  presentFork();
}

function continueRun(): void {
  const save = loadRunSave();
  if (!save) {
    menus.showMain();
    return;
  }
  startRun(heroById(save.hero), save);
}

/** Save point: written at each fork boundary. Map regenerates from seed+depth. */
function checkpoint(): void {
  if (runResolved || woundActive) return; // run ended / past the Wound gate — never re-arm a save
  writeRunSave({
    v: 2,
    seed: currentSeed,
    depth: currentDepth,
    position: ctx.run.position,
    path: ctx.run.path.slice(),
    hero: ctx.player.hero.id,
    hp: ctx.player.hp,
    maxHp: ctx.player.maxHp,
    slots: ctx.deck.slots.map((s) => s?.id ?? null),
    upgraded: ctx.deck.upgraded.slice(),
    relics: ctx.relics.owned.map((r) => r.id),
    stats: ctx.stats,
  });
}

/** Shards: the run's earnings, banked into the profile at run end. */
function awardShards(n: number): void {
  const m = ctx.relics.has("lucky-coin") ? Math.round(n * 1.5) : n;
  ctx.stats.shards += m;
}

function abandonRun(): void {
  if (inTutorial) { toMenu(); return; } // training isn't a real run
  clearRunSave();
  ctx.profile.recordRun("abandon", ctx.stats);
  toMenu();
}

/** Training Grounds: a safe, scripted arena teaching the core verbs. */
function startTutorial(): void {
  menus.clear();
  ctx.sfx.stopAmbient();
  warmCombatShaders();
  inTutorial = true;
  ctx.stats = freshStats();
  const hero = heroById(ctx.profile.data.lastHero);
  ctx.player.applyHero(hero, ctx.profile.data.equipped.cape, ctx.profile.data.equipped.blade);
  ctx.player.alive = true;
  ctx.player.shield = 0;
  ctx.player.root.visible = true;
  ctx.tempo.reset();
  ctx.tempo.heroDecayMult = hero.tempoDecayMult;
  ctx.deck.resetForRun();
  ctx.relics.resetForRun();
  ctx.enemies.clear();
  ctx.projectiles.clear();
  ctx.hostiles.clear();
  ctx.caster.clear();
  ctx.arena.applyTheme(THEMES.rift);
  ctx.arena.setObstacles([], 0);
  ctx.fx.ambientColor = THEMES.rift.ember;
  ctx.fx.ambientRate = 7;
  ctx.player.pos.set(0, 0, 6);
  ctx.player.facing = Math.PI;
  ctx.player.hp = ctx.player.maxHp;
  ctx.cam.snapTo(0, 6);
  ctx.cam.mode = "follow";
  hud.setVisible(true);
  ctx.music.tutorial();
  state = "playing";
  ctx.input.enabled = true;
  ctx.enemies.spawn("husk", -4, -3, 0.8);
  ctx.enemies.spawn("husk", 4, -3, 0.8);
  tutorial.onComplete = () => toMenu();
  tutorial.start();
}

/** Quit to desktop. The run save persists (written at the last chamber), so Continue Run still works. */
function quitToDesktop(): void {
  try {
    // Desktop: ask the main process to quit cleanly; browser: best-effort close.
    if (window.rh3native) { void window.rh3native.quit(); return; }
    window.close();
  } catch { /* browser may block — fall through */ }
  // If the window didn't close (browser), at least return to the menu.
  toMenu();
}

function toMenu(): void {
  finishInterlude(null, false); // quitting mid-causeway: tear the scene down, don't load the node
  clearEmberAlly();
  ctx.decals.clear();
  ctx.stage.setMood("neutral"); // clear any death/victory grade
  state = "menu";
  pendingRoomReward = null;
  inTutorial = false;
  tutorial.stop();
  ctx.enemies.clear();
  ctx.projectiles.clear();
  ctx.hostiles.clear();
  ctx.caster.clear();
  ctx.features.clear();
  ctx.arena.setObstacles([], 0); // don't leave the last fight's pillars on the menu backdrop
  // Quitting mid-swing must not freeze the menu hero mid-attack: drop any
  // in-flight swing/charge pose and its visuals before the orbit shot.
  ctx.combat.clearTransient();
  ctx.combat.clearSlashVisuals();
  ctx.trail.clear();
  ctx.player.root.visible = true;
  ctx.player.pos.set(0, 0, 5.2);
  ctx.player.facing = Math.PI;
  ctx.player.root.position.set(ctx.player.pos.x, ctx.player.pos.y, ctx.player.pos.z);
  ctx.player.root.rotation.y = ctx.player.facing;
  ctx.cam.menuOrbit();
  ctx.arena.applyTheme(THEMES.rift);
  ctx.arena.criticalHeat = 0; // don't carry a mid-run Critical surge into the menu
  ctx.cam.snapTo(0, 5.2);
  ctx.fx.ambientColor = THEMES.rift.ember;
  // The drifting embers are a big part of the menu's "deep rift" backdrop — keep
  // them rich (the pool is a single draw call); only trim slightly on the low preset.
  ctx.fx.ambientRate = menus.settings.quality === "low" ? 7 : 10;
  hud.setVisible(false);
  menus.showMain();
  musicLament = false;
  ctx.music.duckTo(1);
  ctx.music.menu();
}

function pause(): void {
  if (state !== "playing" || runResolved) return; // don't let a pause interrupt death/victory resolution
  state = "paused";
  ctx.input.enabled = false;
  ctx.music.duckTo(0.32);
  menus.showPause();
}

function resume(): void {
  menus.clear();
  ctx.input.enabled = true;
  ctx.music.duckTo(1);
  state = "playing";
  if (pendingRoomReward) {
    const reward = pendingRoomReward;
    pendingRoomReward = null;
    window.setTimeout(() => resolveRoomReward(reward), 0);
  }
}

// In-run passive growth: the hero's passive sharpens at kill milestones (Ascendant ranks).
const ASCENDANT_THRESHOLDS = [35, 85, 150, 240];
let ascendantRank = 0;
ctx.events.on("KILL", () => {
  awardShards(1);
  // The Revenant's Sanguine passive: every kill stitches a little life back.
  const kh = ctx.player.hero.killHeal ?? 0;
  if (kh > 0 && ctx.player.alive && ctx.player.hp < ctx.player.maxHp) {
    ctx.player.hp = Math.min(ctx.player.maxHp, ctx.player.hp + kh);
  }
  if (ascendantRank < ASCENDANT_THRESHOLDS.length && ctx.stats.kills >= ASCENDANT_THRESHOLDS[ascendantRank]) {
    ascendantRank++;
    ctx.combat.runRankMult = 1 + ascendantRank * 0.06;
    const p = ctx.player;
    p.hp = Math.min(p.maxHp, p.hp + 8);
    ctx.events.emit("HEAL", { amount: 8 });
    if (state === "playing") hud.banner(ctx.player.hero.passiveName.toUpperCase(), `ASCENDANT ${ROMAN[ascendantRank - 1] ?? ascendantRank}`, "banner--clear");
    ctx.sfx.cardReady();
  }
});

// Tempo stinger: a bright rising triad the moment you reach the Critical zone.
// The arena breathes with the player while Critical holds (rim/crystal surge).
ctx.events.on("TEMPO_ZONE", ({ zone, prev }) => {
  if (zone === "critical" && prev !== "critical") ctx.sfx.critical();
  ctx.arena.criticalHeat = zone === "critical" ? 1 : 0;
});

function playRoomClearFloorBeat(): void {
  const node = ctx.run.currentNode;
  const theme = node?.theme ? THEMES[node.theme] : THEMES.rift;
  const bossClear = !!node?.bossKind;
  const rings = bossClear ? [3.5, 7, 11, 15] : [2.8, 5.6, 8.8, 12.2];
  ctx.stage.punch(bossClear ? 0.34 : 0.18);
  hud.flash(bossClear ? "#ffe39a" : "#bfefff", bossClear ? 0.28 : 0.16);
  rings.forEach((radius, i) => {
    window.setTimeout(() => {
      ctx.fx.ring(0, 0, {
        radius,
        startRadius: Math.max(0.2, radius - 3.2),
        color: i % 2 === 0 ? theme.ember : theme.crystal,
        duration: bossClear ? 0.8 : 0.55,
      });
      ctx.fx.burst({
        x: ctx.player.pos.x, y: 0.18, z: ctx.player.pos.z,
        count: bossClear ? 12 : 8,
        color: [theme.ember, theme.crystal, 0xffffff],
        speed: [0.6, bossClear ? 4.8 : 3.4],
        up: bossClear ? 2.1 : 1.5,
        size: [0.22, bossClear ? 0.75 : 0.55],
        life: [0.35, 0.85],
        gravity: 0.15,
        drag: 1.4,
        jitter: 0.7,
      });
    }, i * (bossClear ? 130 : 95));
  });
}

function playBossDeathBeat(kind: string | undefined, x: number, z: number): void {
  const cfg = BOSS_FX[kind ?? "warden"] ?? BOSS_FX.warden;
  const dx = x - ctx.player.pos.x;
  const dz = z - ctx.player.pos.z;
  const len = Math.hypot(dx, dz) || 1;
  ctx.sfx.bossDeath();
  ctx.cam.kick(dx / len, dz / len, cfg.seismic ? 8 : 6);
  ctx.cam.addTrauma(cfg.seismic ? 0.82 : 0.7);
  ctx.cam.pulseFov(1);
  ctx.stage.punch(cfg.seismic ? 0.85 : 0.7);
  hud.flash(cfg.hex, cfg.quiet ? 0.3 : 0.45);
  ctx.fx.beam(x, z, cfg.c2);

  const beat = (delay: number, fn: () => void): void => { window.setTimeout(fn, delay); };
  const boom = (delay: number, radius: number, count: number, color: number, up = 0.9): void => {
    beat(delay, () => {
      ctx.fx.ring(x, z, { radius, color, duration: 0.55, startRadius: Math.max(0.2, radius - 4) });
      ctx.fx.ring(x, z, { radius: radius * 0.5, color: 0xffffff, duration: 0.35 });
      ctx.fx.burst({ x, y: 1, z, count, color: [color, cfg.c2, 0xffffff], speed: [4, 17], up, size: [0.45, 1.25], life: [0.35, 0.95], gravity: up < 0 ? 0.6 : -3.5, drag: 2 });
      ctx.cam.addTrauma(0.24);
    });
  };

  if (kind === "spire") {
    boom(120, 4.2, 38, cfg.c1, 1.4);
    boom(320, 7.2, 52, cfg.c2, 1.2);
    beat(540, () => {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        ctx.fx.beam(x + Math.sin(a) * 2.8, z + Math.cos(a) * 2.8, i % 2 ? cfg.c1 : cfg.c2);
      }
    });
    boom(680, 10.5, 44, 0xffffff, 1.6);
  } else if (kind === "colossus") {
    for (const [delay, radius, count] of [[90, 4.5, 36], [260, 8, 52], [470, 12, 62]] as const) {
      boom(delay, radius, count, delay === 470 ? 0xfff0c0 : cfg.c1, -0.15);
      beat(delay + 20, () => ctx.stage.punch(0.35));
    }
  } else if (kind === "tyrant") {
    boom(100, 4.5, 34, cfg.c1, 1.1);
    beat(290, () => ctx.fx.ring(x, z, { radius: 8.5, startRadius: 1.5, color: cfg.c1, duration: 0.85 }));
    beat(440, () => ctx.fx.burst({ x, y: 1.4, z, count: 52, color: [0x9a5cff, 0xffffff], speed: [2, 12], up: 1.7, size: [0.35, 1.1], life: [0.45, 1.05], gravity: -1.2, drag: 1.8, jitter: 1.2 }));
    boom(700, 11, 42, cfg.c2, 1.3);
  } else if (kind === "echo") {
    for (let i = 0; i < 4; i++) {
      beat(110 + i * 125, () => {
        const a = (i / 4) * Math.PI * 2;
        const ox = x + Math.sin(a) * 2.2;
        const oz = z + Math.cos(a) * 2.2;
        ctx.fx.ring(ox, oz, { radius: 3.4 + i * 1.5, color: i % 2 ? cfg.c2 : cfg.c1, duration: 0.5 });
        ctx.fx.burst({ x: ox, y: 1, z: oz, count: 22, color: [cfg.c1, cfg.c2, 0xffffff], speed: [2, 10], up: 1.2, size: [0.3, 0.85], life: [0.25, 0.7], gravity: -2, drag: 2.2, jitter: 0.8 });
      });
    }
    boom(720, 10, 36, cfg.c2, 1.0);
  } else {
    for (let i = 0; i < 3; i++) {
      beat(90 + i * 110, () => {
        const ox = x + (i - 1) * 0.8;
        ctx.fx.burst({ x: ox, y: 0.85, z: z - 0.3 + i * 0.25, count: 24, color: [cfg.c1, cfg.c2, 0xffffff], speed: [4, 15], up: 0.45, size: [0.45, 1.1], life: [0.25, 0.75], gravity: -5, drag: 2.3 });
      });
    }
    boom(360, 7, 56, cfg.c2, 0.9);
    boom(620, 10, 44, 0xffffff, 1.1);
  }
}

let pendingRoomReward: "card" | "relic" | null = null;

function resolveRoomReward(reward: "card" | "relic"): void {
  if (state === "paused") {
    pendingRoomReward = reward;
    return;
  }
  if (state !== "playing") return;
  const done = () => { menus.clear(); advanceAfterNode(); };
  if (reward === "relic") {
    const choices = ctx.relics.draftChoices();
    if (choices.length === 0) {
      // Maxed out — quiet consolation heal, straight on to the next fork
      ctx.player.hp = Math.min(ctx.player.maxHp, ctx.player.hp + 10);
      ctx.events.emit("HEAL", { amount: 10 });
      advanceAfterNode();
      return;
    }
    state = "draft";
    ctx.music.map();
    menus.showRelicDraft(choices, done);
  } else {
    state = "draft";
    ctx.music.map();
    menus.showDraft(ctx.deck.draftChoices(), done);
  }
}

ctx.events.on("ROOM_CLEARED", ({ reward }) => {
  hud.fadeHints();
  awardShards(6);
  playRoomClearFloorBeat();
  // After a boss, hold so the epitaph banner ("THE WARDEN FALLS") can be read —
  // a generous window so the line lands before the reward draft covers it.
  const rewardDelay = ctx.run.currentNode?.bossKind ? 7200 : 1500;
  window.setTimeout(() => {
    resolveRoomReward(reward);
  }, rewardDelay);
});

ctx.events.on("BOSS_DEFEATED", ({ x, z }) => {
  // A boss dying mid-cutscene (debug kills, smoke tests) must not soft-lock
  finishCutscene();
  const node = ctx.run.currentNode;
  // Bank the milestone immediately — dying later can't take it back
  ctx.profile.noteBossKill(node?.act ?? ctx.stats.actReached, ctx.stats);
  awardShards(20);

  // The Hollow Star does not burst in triumph. It collapses inward and quietly goes out —
  // unless you spared it, in which case its ember rekindles and rises with you.
  if (node?.bossKind === "unmaker") {
    unmakerFading = false;
    hud.setSparePrompt(false, 0);
    if (chosenMercy) playUnmakerRekindle(x, z);
    else playUnmakerCollapse(x, z);
    return; // RUN_VICTORY (from RunManager) drives the ending
  }

  // The true final boss: bank the kill, pay out big, let RUN_VICTORY end it.
  if (node?.bossKind === "wound") {
    ctx.profile.noteWoundKill();
    awardShards(150 + ctx.stats.depth * 25);
    clearEmberAlly();
    playBossDeathBeat("wound", x, z);
    hud.banner("THE WOUND CLOSES", "the floor of the world is whole again", "banner--clear banner--epitaph");
    return;
  }

  // Mid-run wardens get a themed death beat, an epitaph, and a boon.
  const kind = node?.bossKind;
  playBossDeathBeat(kind, x, z);
  if (kind) ctx.relics.grantBoon(kind);
  if (kind && BOSS_EPITAPHS[kind] && ctx.run.position < ctx.run.totalForks - 1) {
    const [title, sub] = BOSS_EPITAPHS[kind];
    window.setTimeout(() => {
      if (state === "playing") hud.banner(title, sub, "banner--clear banner--epitaph");
    }, 1100);
  }
});

// ---------------------------------------------------------------- the wound (true final)
/** The spared star's ember — a drifting light that fights beside you in the Wound fight. */
let emberAlly: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; t: number; acc: number } | null = null;

function spawnEmberAlly(): void {
  if (emberAlly) return;
  const mat = new THREE.MeshBasicMaterial({ color: 0xffd8a0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), mat);
  mesh.userData.solidity = "fx";
  ctx.stage.scene.add(mesh);
  emberAlly = { mesh, mat, t: 0, acc: 4 };
  hud.banner("THE EMBER YOU SPARED RISES WITH YOU", "", "banner--clear");
}

function updateEmberAlly(dt: number): void {
  if (!emberAlly) return;
  const e = emberAlly;
  e.t += dt;
  const p = ctx.player.pos;
  e.mesh.position.set(p.x + Math.sin(e.t * 1.4) * 2.1, 1.6 + Math.sin(e.t * 2.2) * 0.3, p.z + Math.cos(e.t * 1.4) * 2.1);
  e.mat.opacity = 0.8 + Math.sin(e.t * 5) * 0.15;
  if (Math.random() < dt * 6) {
    ctx.fx.burst({
      x: e.mesh.position.x, y: e.mesh.position.y, z: e.mesh.position.z,
      count: 1, color: 0xffd8a0, speed: [0.2, 0.8], up: 0.6, size: [0.2, 0.4], life: [0.3, 0.6], gravity: 0.3, drag: 2, jitter: 0.3,
    });
  }
  e.acc -= dt;
  if (e.acc <= 0) {
    e.acc = 5;
    ctx.tempo.gain(8);
    ctx.fx.ring(p.x, p.z, { radius: 1.8, color: 0xffd8a0, duration: 0.4 });
  }
}

function clearEmberAlly(): void {
  if (!emberAlly) return;
  ctx.stage.scene.remove(emberAlly.mesh);
  emberAlly.mesh.geometry.dispose();
  emberAlly.mat.dispose();
  emberAlly = null;
}

// Ascension truth (depth 3+): the Unmaker's fall doesn't seal the Rift — the floor
// of the world gives way, and the thing the star was holding shut comes up.
ctx.events.on("WOUND_REVEAL", () => {
  woundActive = true;   // past the Unmaker: no checkpoint may resume there
  clearRunSave();       // drop the stale Unmaker save immediately
  window.setTimeout(() => {
    if (state !== "playing") return; // quit-to-menu during the collapse beat
    hud.banner("THE FLOOR OF THE WORLD GIVES WAY", "it was never the star", "banner--boss banner--long");
    ctx.cam.addTrauma(0.6);
    ctx.stage.punch(0.5);
    hud.flash("#ff2a4a", 0.5);
    ctx.fx.ring(0, 0, { radius: 16, color: 0xff2a4a, duration: 1.0 });
    ctx.fx.ring(0, 0, { radius: 9, color: 0xffffff, duration: 0.8 });
    ctx.sfx.bossRoar();
  }, 3600);
  window.setTimeout(() => {
    if (state !== "playing") return;
    // Mercy pays off mechanically: the spared star fights beside you.
    if (chosenMercy) {
      ctx.combat.emberRevive = true;
      spawnEmberAlly();
    }
    ctx.run.loadWoundFight();
  }, 5600);
});

/** The final boss's quiet end: the star's light gathers, folds inward, and winks out. */
function playUnmakerCollapse(x: number, z: number): void {
  ctx.sfx.bossDeath();
  ctx.cam.cinematic(x, z, 0.7);
  ctx.cam.addTrauma(0.22);
  ctx.cam.pulseFov(0.4);
  // Converging rings — the light falls INWARD to a single point instead of bursting out.
  const ringIn = (delay: number, r: number, col: number): void => {
    cutsceneTimers.push(window.setTimeout(() => ctx.fx.ring(x, z, { radius: r, color: col, duration: 0.7 }), delay));
  };
  ringIn(60, 11, 0x6a78b0);
  ringIn(360, 7.5, 0x8a9ad0);
  ringIn(680, 4, 0xcbb6ff);
  ringIn(1000, 1.6, 0xffffff);
  // It gathers, holds... then a single soft outrush as it lets go of a hundred years.
  cutsceneTimers.push(window.setTimeout(() => {
    ctx.fx.ring(x, z, { radius: 6, color: 0xffffff, duration: 1.5 });
    ctx.fx.burst({ x, y: 2.2, z, count: 52, color: [0xcbb6ff, 0x8a9ad0, 0xffffff], speed: [1, 6], up: 1.2, size: [0.3, 0.9], life: [1.0, 2.0], gravity: 0.4, drag: 1.4 });
    ctx.cam.pulseFov(0.5);
    hud.flash("#e8e0ff", 0.45);
  }, 1300));
}

/** The spared star rekindles — warm light rises and gathers to the hero instead of dying. */
function playUnmakerRekindle(x: number, z: number): void {
  ctx.sfx.relicPickup();
  ctx.cam.cinematic(x, z, 0.72);
  ctx.cam.pulseFov(0.5);
  const warm = (delay: number, r: number, col: number): void => {
    cutsceneTimers.push(window.setTimeout(() => {
      ctx.fx.ring(x, z, { radius: r, color: col, duration: 0.9 });
      ctx.fx.burst({ x, y: 1.4, z, count: 22, color: [col, 0xffffff], speed: [0.6, 3], up: 3.2, size: [0.25, 0.7], life: [0.9, 1.9], gravity: 0.15, drag: 1.0, jitter: 0.5 });
    }, delay));
  };
  warm(40, 3, 0xffd27a);
  warm(420, 5.5, 0xffe8b0);
  warm(820, 8, 0xfff4d8);
  cutsceneTimers.push(window.setTimeout(() => { hud.flash("#ffe8b0", 0.4); ctx.cam.pulseFov(0.4); }, 1100));
}

ctx.events.on("ACT_START", ({ act, name }) => {
  menus.actIntro(`ACT ${ROMAN[act - 1]}`, name, ACT_FLAVOR[act - 1]);
});

ctx.events.on("ROOM_START", ({ isBoss, act, elite }) => {
  // Transient combat state never carries across a room boundary.
  ctx.combat.clearTransient();
  if (isBoss) {
    ctx.sfx.bossIntroSting();
    ctx.music.boss(act);
  } else {
    ctx.music.combat(act, elite);
  }
});

// ---------------------------------------------------------------- boss cutscene
let bossCutscene = false;
let cutsceneTimers: number[] = [];
/** Phase cutscenes hold the world still (fair — input is off); the entrance lets adds materialize. */
let cutsceneFreezeWorld = false;
/** Set when the Hollow Star starts to fade — keeps the music low through the bittersweet end. */
let musicLament = false;
/** A brief grace window so the attack click the player is holding doesn't instantly skip the beat. */
let cutsceneSkipReadyTs = 0;
/** Repeating environmental FX during a boss entrance (cleared on finish). */
let bossStormInterval: number | null = null;
/** Temporary meshes owned by the active boss cutscene. Cleared on skip/finish. */
let cutsceneTemps: THREE.Object3D[] = [];

type BossOmen = "claws" | "mirrors" | "fists" | "reactor" | "star" | "echoes" | "gate" | "beam";
type BossColorRef = "c1" | "c2" | "white" | "phase";
type BossBurstPreset = "summon" | "pillar" | "reveal" | "shards" | "seismic" | "tear" | "starfall";
type BossCutsceneBeat =
  | { at: number; type: "camera"; zoom: number; xOff?: number; zOff?: number }
  | { at: number; type: "ring"; radius: number; color: BossColorRef; duration: number; startRadius?: number }
  | { at: number; type: "burst"; preset: BossBurstPreset }
  | { at: number; type: "prop"; omen: BossOmen }
  | { at: number; type: "pulse"; trauma?: number; kick?: number; punch?: number; fov?: number }
  | { at: number; type: "flash"; color: string; intensity: number }
  | { at: number; type: "sound"; cue: "intro" | "roar" }
  | { at: number; type: "reveal"; name: string; title: string }
  | { at: number; type: "faceHero" };

interface BossFxConfig {
  zoom: number;
  c1: number;
  c2: number;
  hex: string;
  bannerClass: string;
  omen: BossOmen;
  phaseColor: number;
  phaseHex: string;
  seismic?: boolean;
  tear?: boolean;
  quiet?: boolean;
}

function disposeMaterial(mat: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
  else mat.dispose();
}

function clearCutsceneTemps(): void {
  for (const obj of cutsceneTemps) {
    obj.parent?.remove(obj);
    obj.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        disposeMaterial(o.material as THREE.Material | THREE.Material[]);
      }
    });
  }
  cutsceneTemps = [];
}

function trackCutsceneTemp<T extends THREE.Object3D>(obj: T): T {
  cutsceneTemps.push(obj);
  obj.userData.solidity = "fx";
  ctx.stage.scene.add(obj);
  return obj;
}

function skipCutscene(): void {
  if (performance.now() < cutsceneSkipReadyTs) return;
  finishCutscene();
}

function finishCutscene(): void {
  if (!bossCutscene) return;
  bossCutscene = false;
  cutsceneTimers.forEach((t) => window.clearTimeout(t));
  cutsceneTimers = [];
  window.removeEventListener("pointerdown", skipCutscene);
  window.removeEventListener("keydown", skipCutscene);
  hud.setLetterbox(false);
  ctx.arena.cutsceneDim = 0; // skip path: never leave the arena held dark
  ctx.cam.mode = "follow";
  ctx.input.enabled = true;
  ctx.music.duckTo(musicLament ? 0.25 : 1); // keep the lament quiet through the fade
  cutsceneFreezeWorld = false;
  if (bossStormInterval !== null) { window.clearInterval(bossStormInterval); bossStormInterval = null; }
  clearCutsceneTemps();
  if (state === "cutscene") state = "playing";
}

/** Per-boss entrance palettes — each warden arrives in its own colors + intensity. */
const BOSS_FX: Record<string, BossFxConfig> = {
  warden: {
    zoom: 0.55, c1: 0xff6622, c2: 0xffcc66, hex: "#ffcc66",
    bannerClass: "banner--boss-warden", omen: "claws", phaseColor: 0xff7a3a, phaseHex: "#ff7a3a",
  },
  spire: {
    zoom: 0.6, c1: 0x3effd2, c2: 0xaaffee, hex: "#aaffee",
    bannerClass: "banner--boss-spire", omen: "mirrors", phaseColor: 0x3effd2, phaseHex: "#aaffee",
  },
  colossus: {
    zoom: 0.5, c1: 0xff3300, c2: 0xffaa44, hex: "#ffaa44",
    bannerClass: "banner--boss-colossus", omen: "fists", phaseColor: 0xff5500, phaseHex: "#ffaa44", seismic: true,
  },
  tyrant: {
    zoom: 0.62, c1: 0x9a5cff, c2: 0xffffff, hex: "#cbb6ff",
    bannerClass: "banner--boss-tyrant", omen: "reactor", phaseColor: 0x9a5cff, phaseHex: "#cbb6ff", tear: true,
  },
  unmaker: {
    zoom: 0.66, c1: 0xb98cff, c2: 0xffffff, hex: "#e8e0ff",
    bannerClass: "banner--boss-unmaker", omen: "star", phaseColor: 0xb98cff, phaseHex: "#e8e0ff", tear: true, quiet: true,
  },
  echo: {
    zoom: 0.6, c1: 0x3aa0ff, c2: 0x9fe8ff, hex: "#9fe8ff",
    bannerClass: "banner--boss-echo", omen: "echoes", phaseColor: 0x3aa0ff, phaseHex: "#9fe8ff", tear: true,
  },
  wound: {
    zoom: 0.58, c1: 0xff2a4a, c2: 0xff9aa8, hex: "#ff5a6e",
    bannerClass: "banner--boss-tyrant", omen: "claws", phaseColor: 0xff2a4a, phaseHex: "#ff5a6e", tear: true, seismic: true,
  },
};

function bossColor(cfg: BossFxConfig, ref: BossColorRef): number {
  if (ref === "c1") return cfg.c1;
  if (ref === "c2") return cfg.c2;
  if (ref === "phase") return cfg.phaseColor;
  return 0xffffff;
}

function cutsceneMat(color: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function addBossOmen(kind: BossOmen, cfg: BossFxConfig, bx: number, bz: number, phase = 0): void {
  const root = new THREE.Group();
  root.position.set(bx, 0, bz);
  const primary = cutsceneMat(cfg.c1, 0.78);
  const secondary = cutsceneMat(cfg.c2, 0.48);

  if (kind === "claws") {
    for (let i = 0; i < 3; i++) {
      const claw = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.035, 6.2 - i * 0.35), i === 1 ? secondary : primary);
      claw.position.set((i - 1) * 0.72, 0.08, -0.45 + i * 0.2);
      claw.rotation.y = -0.28 + i * 0.28;
      root.add(claw);
    }
  } else if (kind === "mirrors") {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + phase * 0.2;
      const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.38 + (i % 3) * 0.08), i % 2 ? secondary : primary);
      shard.position.set(Math.sin(a) * (1.7 + (i % 2) * 0.5), 0.7 + i * 0.16, Math.cos(a) * (1.7 + (i % 2) * 0.5));
      shard.rotation.set(a * 0.7, a, 0.5);
      root.add(shard);
    }
  } else if (kind === "fists") {
    for (const side of [-1, 1]) {
      const fist = new THREE.Mesh(new THREE.BoxGeometry(1.35, 1.5, 1.55), primary);
      fist.position.set(side * 1.35, 0.82, -0.25);
      fist.rotation.set(0.15, side * 0.25, side * 0.16);
      root.add(fist);
      const knuckle = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.25, 0.55), secondary);
      knuckle.position.set(side * 1.35, 1.42, 0.58);
      knuckle.rotation.y = side * 0.25;
      root.add(knuckle);
    }
  } else if (kind === "reactor") {
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.25 + i * 0.45, 0.035, 8, 72), i % 2 ? secondary : primary);
      ring.position.y = 1.2 + i * 0.08;
      ring.rotation.set(i * 0.55, i * 0.82 + phase * 0.2, i * 0.35);
      root.add(ring);
    }
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 0), secondary);
    core.position.y = 1.25;
    root.add(core);
  } else if (kind === "star") {
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 1), secondary);
    core.position.y = 1.3;
    root.add(core);
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0 + i * 0.42, 0.025, 8, 80), i % 2 ? secondary : primary);
      ring.position.y = 1.3;
      ring.rotation.set(Math.PI / 2 + i * 0.35, i * 0.8, phase * 0.2);
      root.add(ring);
    }
  } else if (kind === "gate") {
    for (let i = 0; i < 2; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.1 + i * 0.7, 0.035, 8, 80), i ? secondary : primary);
      ring.position.y = 0.08 + i * 0.02;
      ring.rotation.x = Math.PI / 2;
      root.add(ring);
    }
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const rune = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.035, 0.55), i % 2 ? secondary : primary);
      rune.position.set(Math.sin(a) * 2.72, 0.11, Math.cos(a) * 2.72);
      rune.rotation.y = a;
      root.add(rune);
    }
  } else if (kind === "beam") {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.08, 3.4, 6), i % 2 ? secondary : primary);
      beam.position.set(Math.sin(a) * 1.45, 1.7, Math.cos(a) * 1.45);
      beam.rotation.z = Math.sin(a) * 0.12;
      beam.rotation.x = Math.cos(a) * 0.12;
      root.add(beam);
    }
    const halo = new THREE.Mesh(new THREE.TorusGeometry(1.48, 0.03, 8, 72), secondary);
    halo.position.y = 3.45;
    halo.rotation.x = Math.PI / 2;
    root.add(halo);
  } else {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const portal = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.035, 8, 48), i % 2 ? secondary : primary);
      portal.position.set(Math.sin(a) * 2.0, 0.9 + i * 0.08, Math.cos(a) * 2.0);
      portal.rotation.set(Math.PI / 2, a, 0);
      root.add(portal);
    }
  }

  root.scale.setScalar(1 + phase * 0.12);
  trackCutsceneTemp(root);
}

function bossBurst(preset: BossBurstPreset, cfg: BossFxConfig, bx: number, bz: number): void {
  const palette = [cfg.c1, cfg.c2, 0xffffff];
  if (preset === "summon") {
    ctx.fx.burst({ x: bx, y: 0.5, z: bz, count: 28, color: palette, speed: [1, 5], up: 1.6, size: [0.3, 0.75], life: [0.4, 0.9], gravity: 0.4, drag: 1.5, jitter: 1.1 });
  } else if (preset === "pillar") {
    ctx.fx.burst({ x: bx, y: 0.2, z: bz, count: 44, color: [cfg.c2, 0xffffff], speed: [0.4, 1.7], up: cfg.quiet ? 4.8 : 9, size: [0.25, 0.72], life: [0.65, 1.25], gravity: cfg.quiet ? 0.1 : -1.5, drag: 0.7, jitter: 0.55 });
  } else if (preset === "reveal") {
    ctx.fx.burst({ x: bx, y: 1, z: bz, count: cfg.quiet ? 42 : 70, color: palette, speed: cfg.quiet ? [2, 8] : [5, 18], up: cfg.quiet ? 1.6 : 0.8, size: [0.45, 1.3], life: [0.45, 1.0], gravity: cfg.quiet ? -0.3 : -3, drag: cfg.quiet ? 1.5 : 2 });
  } else if (preset === "shards") {
    ctx.fx.burst({ x: bx, y: 1.0, z: bz, count: 34, color: [cfg.c1, cfg.c2, 0xffffff], speed: [2, 10], up: 1.1, size: [0.3, 0.9], life: [0.4, 0.85], gravity: -1, drag: 1.7, jitter: 1.4 });
  } else if (preset === "seismic") {
    ctx.fx.burst({ x: bx, y: 0.3, z: bz, count: 42, color: [cfg.c1, cfg.c2], speed: [4, 13], up: -0.4, size: [0.5, 1.2], life: [0.5, 1.1], gravity: 0.8, drag: 1.8 });
  } else if (preset === "starfall") {
    ctx.fx.burst({ x: bx, y: 2.3, z: bz, count: 36, color: [cfg.c2, 0xffffff], speed: [0.6, 3.5], up: -1.2, size: [0.28, 0.85], life: [0.9, 1.8], gravity: -0.15, drag: 0.9, jitter: 2.2 });
  } else {
    ctx.fx.burst({ x: bx, y: 1, z: bz, count: 32, color: [0x9a5cff, 0xffffff], speed: [3, 12], up: 1.4, size: [0.4, 1.0], life: [0.4, 0.9], gravity: -2, drag: 2 });
  }
}

function faceHeroToward(x: number, z: number): void {
  const p = ctx.player.pos;
  if (Math.hypot(x - p.x, z - p.z) > 0.1) ctx.player.facing = Math.atan2(x - p.x, z - p.z);
}

function revealBoss(cfg: BossFxConfig, name: string, title: string, bx: number, bz: number): void {
  // The room stops holding its breath: dimmed arena snaps back with the flash,
  // and the boss body lands with an overshoot settle instead of fading in.
  ctx.arena.cutsceneDim = 0;
  ctx.enemies.living().find((e) => e.kind === "boss")?.arrivalPop();
  if (cfg.quiet) ctx.sfx.bossIntroSting();
  else ctx.sfx.bossRoar();
  ctx.cam.addTrauma(cfg.quiet ? 0.22 : cfg.seismic ? 0.82 : 0.55);
  ctx.cam.kick(0, 1, cfg.quiet ? 2.5 : cfg.seismic ? 7 : 5);
  ctx.stage.punch(cfg.quiet ? 0.22 : cfg.seismic ? 0.6 : 0.4);
  ctx.cam.pulseFov(cfg.quiet ? 0.45 : 1);
  hud.flash(cfg.hex, cfg.quiet ? 0.36 : 0.55);
  hud.banner(name, title, `banner--boss banner--long banner--cutscene ${cfg.bannerClass}`);
  ctx.fx.ring(bx, bz, { radius: cfg.quiet ? 7.5 : 10, color: cfg.c1, duration: 0.6 });
  ctx.fx.ring(bx, bz, { radius: cfg.quiet ? 3.5 : 5, color: 0xffffff, duration: 0.45 });
  bossBurst("reveal", cfg, bx, bz);
}

function runBossBeat(beat: BossCutsceneBeat, cfg: BossFxConfig, bx: number, bz: number): void {
  if (!bossCutscene) return;
  if (beat.type === "camera") ctx.cam.cinematic(bx + (beat.xOff ?? 0), bz + (beat.zOff ?? 0), beat.zoom);
  else if (beat.type === "ring") ctx.fx.ring(bx, bz, { radius: beat.radius, color: bossColor(cfg, beat.color), duration: beat.duration, startRadius: beat.startRadius });
  else if (beat.type === "burst") bossBurst(beat.preset, cfg, bx, bz);
  else if (beat.type === "prop") addBossOmen(beat.omen, cfg, bx, bz);
  else if (beat.type === "flash") hud.flash(beat.color, beat.intensity);
  else if (beat.type === "sound") {
    if (beat.cue === "intro") ctx.sfx.bossIntroSting();
    else if (!cfg.quiet) ctx.sfx.bossRoar();
  } else if (beat.type === "pulse") {
    if (beat.trauma) ctx.cam.addTrauma(beat.trauma);
    if (beat.kick) ctx.cam.kick(0, 1, beat.kick);
    if (beat.punch) ctx.stage.punch(beat.punch);
    if (beat.fov) ctx.cam.pulseFov(beat.fov);
  } else if (beat.type === "reveal") revealBoss(cfg, beat.name, beat.title, bx, bz);
  else faceHeroToward(bx, bz);
}

function buildBossIntroBeats(kind: string, cfg: BossFxConfig, name: string, title: string): BossCutsceneBeat[] {
  const beats: BossCutsceneBeat[] = [
    { at: 0, type: "faceHero" },
    // Camera language: start WIDE and push IN continuously toward the name-drop
    // (the old beats started close and pulled out — tension read backwards).
    { at: 180, type: "camera", zoom: cfg.zoom * 1.45, zOff: -0.25 },
    { at: 260, type: "prop", omen: "gate" },
    { at: 300, type: "sound", cue: "intro" },
    { at: 360, type: "prop", omen: cfg.omen },
    { at: 500, type: "ring", radius: 15, color: "c1", duration: 0.5, startRadius: 18 },
    { at: 620, type: "ring", radius: 4, color: "c1", duration: 0.85 },
    { at: 860, type: "ring", radius: 11, color: "c1", duration: 0.5, startRadius: 14 },
    { at: 900, type: "camera", zoom: cfg.zoom * 1.1 },
    { at: 1180, type: "ring", radius: 7.5, color: "c2", duration: 0.45, startRadius: 10 },
    { at: 1200, type: "burst", preset: "summon" },
    { at: 1520, type: "ring", radius: 4.5, color: "c2", duration: 0.4, startRadius: 6.5 },
    { at: 1700, type: "burst", preset: cfg.quiet ? "starfall" : "pillar" },
    { at: 1760, type: "prop", omen: "beam" },
    { at: 1900, type: "camera", zoom: cfg.zoom * 0.88 },
    { at: 1920, type: "ring", radius: 6.5, color: "c2", duration: 0.7 },
    { at: 1930, type: "burst", preset: kind === "spire" || kind === "echo" ? "shards" : cfg.seismic ? "seismic" : "summon" },
    { at: 2180, type: "flash", color: cfg.hex, intensity: cfg.quiet ? 0.16 : 0.24 },
    { at: 2240, type: "pulse", trauma: cfg.quiet ? 0.1 : 0.2, fov: cfg.quiet ? 0.18 : 0.32 },
    // The name-drop lands as a real impact: a column of light, a shock ring out of
    // the spawn, a screen flash, and a punch — the boss "arrives" instead of fading in.
    { at: 2470, type: "burst", preset: cfg.quiet ? "starfall" : "pillar" },
    { at: 2500, type: "ring", radius: cfg.quiet ? 9 : 13, color: "c1", duration: 0.55, startRadius: 1 },
    { at: 2520, type: "flash", color: cfg.hex, intensity: cfg.quiet ? 0.2 : 0.42 },
    { at: 2550, type: "reveal", name, title },
    { at: 2580, type: "pulse", trauma: cfg.quiet ? 0.12 : 0.34, punch: cfg.quiet ? 0.18 : 0.42, fov: cfg.quiet ? 0.2 : 0.34 },
    { at: 2620, type: "ring", radius: cfg.quiet ? 6 : 8, color: "white", duration: 0.4, startRadius: 0.5 },
  ];

  if (kind === "warden") {
    beats.push(
      { at: 2860, type: "prop", omen: "claws" },
      { at: 2980, type: "pulse", trauma: 0.32, punch: 0.25 },
      { at: 3180, type: "ring", radius: 9, color: "c2", duration: 0.5 },
      { at: 3340, type: "burst", preset: "seismic" },
      { at: 3600, type: "ring", radius: 12, color: "c1", duration: 0.5 },
      { at: 4220, type: "prop", omen: "claws" },
      { at: 4460, type: "pulse", trauma: 0.36, punch: 0.24, fov: 0.34 },
    );
  } else if (kind === "spire") {
    beats.push(
      { at: 2850, type: "prop", omen: "mirrors" },
      { at: 3040, type: "burst", preset: "shards" },
      { at: 3220, type: "prop", omen: "beam" },
      { at: 3440, type: "ring", radius: 12, color: "c2", duration: 0.55 },
      { at: 4180, type: "burst", preset: "shards" },
      { at: 4520, type: "ring", radius: 15, color: "white", duration: 0.55 },
    );
  } else if (cfg.seismic) {
    beats.push(
      { at: 3050, type: "pulse", trauma: 0.5, punch: 0.35 },
      { at: 3150, type: "ring", radius: 8.5, color: "c1", duration: 0.55 },
      { at: 3550, type: "pulse", trauma: 0.35 },
      { at: 3570, type: "ring", radius: 12, color: "c2", duration: 0.5 },
      { at: 3680, type: "prop", omen: "fists" },
      { at: 3850, type: "burst", preset: "seismic" },
      { at: 4300, type: "pulse", trauma: 0.5, punch: 0.34, fov: 0.28 },
      { at: 4640, type: "ring", radius: 16, color: "c1", duration: 0.6 },
    );
  } else if (kind === "unmaker") {
    beats.push(
      { at: 2920, type: "prop", omen: "star" },
      { at: 3150, type: "flash", color: "#ffffff", intensity: 0.24 },
      { at: 3260, type: "prop", omen: "beam" },
      { at: 3480, type: "ring", radius: 11, color: "white", duration: 0.75 },
      { at: 3820, type: "burst", preset: "starfall" },
      { at: 4380, type: "ring", radius: 17, color: "phase", duration: 0.9 },
      { at: 4760, type: "burst", preset: "starfall" },
      { at: 5100, type: "flash", color: "#ffffff", intensity: 0.2 },
    );
  } else if (cfg.tear) {
    beats.push(
      { at: 3050, type: "flash", color: "#ffffff", intensity: 0.38 },
      { at: 3050, type: "ring", radius: 12, color: "phase", duration: 0.6 },
      { at: 3250, type: "prop", omen: "beam" },
      { at: 3450, type: "ring", radius: 14, color: "white", duration: 0.5 },
      { at: 3800, type: "burst", preset: "tear" },
      { at: 4320, type: "ring", radius: 16, color: "phase", duration: 0.65 },
      { at: 4640, type: "pulse", trauma: 0.38, punch: 0.25, fov: 0.32 },
    );
  }

  beats.push(
    { at: 4920, type: "camera", zoom: cfg.zoom * 0.82, zOff: -0.1 },
    { at: 5200, type: "ring", radius: cfg.quiet ? 13 : 16, color: "c2", duration: 0.75, startRadius: 2 },
    { at: 5380, type: "pulse", trauma: cfg.quiet ? 0.08 : 0.2, fov: cfg.quiet ? 0.16 : 0.28 },
  );

  return beats.sort((a, b) => a.at - b.at);
}

/** Entrance: letterbox in, dolly to the spawn, a themed charge-up, then materialize + roar. */
function playBossCutscene(kind: string, name: string, title: string, bx: number, bz: number): void {
  const cfg = BOSS_FX[kind] ?? BOSS_FX.warden;
  if (bossCutscene) finishCutscene();
  bossCutscene = true;
  cutsceneFreezeWorld = false; // entrance: let the boss beam in
  cutsceneSkipReadyTs = performance.now() + 700;
  state = "cutscene";
  ctx.input.enabled = false;
  hud.setLetterbox(true);
  ctx.arena.cutsceneDim = 1; // the room holds its breath until the reveal
  ctx.music.duckTo(0.35);
  faceHeroToward(bx, bz);
  const queueBeat = (t: number, fn: () => void) => cutsceneTimers.push(window.setTimeout(fn, t));

  bossStormInterval = window.setInterval(() => {
    const a = Math.random() * Math.PI * 2;
    const r = 7 + Math.random() * 10;
    ctx.fx.burst({
      x: Math.sin(a) * r, y: 0.3, z: Math.cos(a) * r,
      count: cfg.quiet ? 2 : 3,
      color: [cfg.c1, cfg.c2],
      speed: cfg.quiet ? [0.25, 1.4] : [0.5, 2.5],
      up: cfg.seismic ? -0.5 : cfg.quiet ? 0.75 : 2.2,
      size: [0.3, cfg.quiet ? 0.9 : 0.7],
      life: cfg.quiet ? [1.1, 2.0] : [0.6, 1.3],
      gravity: cfg.seismic ? 0.6 : cfg.quiet ? 0.05 : 0.2,
      drag: cfg.quiet ? 0.65 : 1.1,
      jitter: cfg.quiet ? 1.5 : 0.8,
    });
  }, cfg.quiet ? 180 : 140);

  const introBeats = buildBossIntroBeats(kind, cfg, name, title);
  for (const beat of introBeats) {
    queueBeat(beat.at, () => runBossBeat(beat, cfg, bx, bz));
  }
  // Hand control back a short breath after the FINAL beat instead of dwelling on a
  // hardcoded later time — the old fixed delay left ~0.5s of input-locked dead air
  // after the choreography had visibly settled. The last shock ring keeps fading
  // into live gameplay (particle FX outlive the cutscene), so nothing is cut short.
  const lastIntroBeat = introBeats.reduce((m, b) => Math.max(m, b.at), 0);
  queueBeat(lastIntroBeat + (cfg.quiet ? 380 : 200), () => finishCutscene());
  window.addEventListener("pointerdown", skipCutscene);
  window.addEventListener("keydown", skipCutscene);
}

ctx.events.on("BOSS_INTRO", ({ name, title, x, z }) =>
  playBossCutscene(ctx.run.currentNode?.bossKind ?? "warden", name, title, x, z));

const PHASE_FLASH = ["#ff7a4a", "#ff7a4a", "#ffd24a", "#ff5a4a"];
/** A short, punchy cinematic beat each time a boss escalates a phase. */
function playBossPhaseCutscene(phase: number, line: string): void {
  if (state !== "playing") return; // never interrupt the entrance or other states
  const boss = ctx.enemies.living().find((e) => e.kind === "boss");
  if (!boss) return; // HUD still shows the phase banner on its own
  const kind = ctx.run.currentNode?.bossKind ?? "warden";
  const cfg = BOSS_FX[kind] ?? BOSS_FX.warden;
  bossCutscene = true;
  cutsceneFreezeWorld = true; // hold the fight — the player can't act, so neither can the boss
  cutsceneSkipReadyTs = performance.now() + (phase >= 4 ? 1500 : 900);
  state = "cutscene";
  ctx.input.enabled = false;
  hud.setLetterbox(true);
  ctx.arena.cutsceneDim = 1; // dim under the escalation beat (fading phase stays dim throughout)

  if (phase >= 4) {
    // The fading phase. No roar, no shake — the fight simply quiets, and the star sags.
    musicLament = true;
    if (ctx.run.currentNode?.bossKind === "unmaker") unmakerFading = true; // mercy becomes possible
    // Swap the driving boss-5 theme for the sad lament as the star dies.
    if (ctx.run.currentNode?.bossKind === "unmaker") ctx.music.bossFinale();
    ctx.music.duckTo(0.22);
    ctx.cam.cinematic(boss.pos.x, boss.pos.z, 0.62);
    ctx.cam.pulseFov(0.35);
    hud.flash(cfg.quiet ? "#ffffff" : "#9fb4ff", cfg.quiet ? 0.22 : 0.28);
    hud.banner(line, "", `banner--lament banner--long ${cfg.bannerClass}`);
    addBossOmen(cfg.quiet ? "star" : cfg.omen, cfg, boss.pos.x, boss.pos.z, phase);
    ctx.fx.ring(boss.pos.x, boss.pos.z, { radius: 6, color: cfg.quiet ? cfg.c2 : 0x8a9ad0, duration: 1.4 });
    bossBurst(cfg.quiet ? "starfall" : "tear", cfg, boss.pos.x, boss.pos.z);
    // The star's last words linger — hold the quiet long enough to read them in full.
    cutsceneTimers.push(window.setTimeout(() => finishCutscene(), 7600));
  } else {
    ctx.music.duckTo(0.5);
    const bx = boss.pos.x, bz = boss.pos.z;
    ctx.cam.cinematic(bx, bz, cfg.seismic ? 0.55 : 0.66);
    ctx.sfx.bossRoar();
    ctx.cam.addTrauma(cfg.seismic ? 0.8 : 0.62);
    ctx.stage.punch(cfg.seismic ? 0.55 : 0.46);
    ctx.cam.pulseFov(1.15);
    hud.flash(cfg.phaseHex || (PHASE_FLASH[Math.min(phase, PHASE_FLASH.length - 1)] ?? "#ff7a4a"), 0.5);
    hud.banner(line, `PHASE ${phase}`, `banner--boss banner--long banner--cutscene ${cfg.bannerClass}`);
    addBossOmen(cfg.omen, cfg, bx, bz, phase);
    // Staged eruption: white core-flash → themed shockwave → (520ms) column of light +
    // a wider ring + a second jolt → (1050ms) a far outer shock + flash. Reads as the
    // boss tearing itself up a tier, not a single ping.
    ctx.fx.ring(bx, bz, { radius: 3.1, color: 0xffffff, duration: 0.4, startRadius: 0.5 });
    ctx.fx.ring(bx, bz, { radius: 6, color: cfg.phaseColor, duration: 0.7 });
    bossBurst(cfg.seismic ? "seismic" : cfg.tear ? "tear" : kind === "spire" ? "shards" : "summon", cfg, bx, bz);
    cutsceneTimers.push(window.setTimeout(() => {
      bossBurst("pillar", cfg, bx, bz);
      ctx.fx.ring(bx, bz, { radius: 11, color: cfg.c1, duration: 0.55, startRadius: 4 });
      ctx.cam.addTrauma(0.4); ctx.stage.punch(0.3);
    }, 520));
    cutsceneTimers.push(window.setTimeout(() => {
      ctx.fx.ring(bx, bz, { radius: 16, color: cfg.c2, duration: 0.6, startRadius: 8 });
      hud.flash(cfg.phaseHex || "#ffffff", 0.3);
      ctx.cam.pulseFov(0.5);
      ctx.arena.cutsceneDim = 0; // lights back up as the new phase asserts itself
    }, 1050));
    // Hold the phase banner up a beat or two longer so the line reads cleanly.
    cutsceneTimers.push(window.setTimeout(() => finishCutscene(), 5800));
  }
  window.addEventListener("pointerdown", skipCutscene);
  window.addEventListener("keydown", skipCutscene);
}

ctx.events.on("BOSS_PHASE", ({ phase, line }) => playBossPhaseCutscene(phase, line));

ctx.events.on("HEAL", ({ amount }) => {
  const p = ctx.player;
  if (p.alive) ctx.floaters.spawn(p.pos.x, 1.9, p.pos.z, `+${amount}`, "heal");
});

ctx.events.on("RUN_VICTORY", () => {
  runResolved = true; // lock out pause/checkpoint through the resolution delay
  ctx.stage.setMood("victory"); // warm the frame + bloom the light (IDEAS-GRAPHICS #18)
  // Not a fanfare — a quiet. The last light is out; let the music fall to nothing.
  ctx.music.silence();
  // Ascension reward: deeper clears bank far more shards (a reason to climb).
  const newDepthCleared = currentDepth >= ctx.profile.data.maxDepth && currentDepth > 0;
  awardShards(60 + currentDepth * 30);
  if (newDepthCleared) {
    awardShards(currentDepth * 40);
    hud.banner(`RIFT DEPTH ${currentDepth} CLEARED`, "A DEEPER DESCENT UNLOCKS", "banner--clear");
  }
  clearRunSave();
  const unlocks = ctx.profile.recordRun("victory", ctx.stats);
  // Let the collapse settle, then the bittersweet ending plays into the end screen.
  window.setTimeout(() => { if (state === "playing") playEnding(unlocks); }, 2800);
});

/** The denouement: a letterboxed story (bittersweet, or hopeful if you showed mercy), then the end screen. */
function playEnding(unlocks: UnlockedItem[]): void {
  state = "cutscene";
  ctx.input.enabled = false;
  hud.setVisible(false);
  // The beauty shot: a slow, close orbit of the hero who did it — held behind
  // the ending story and the recap, instead of the raw last combat frame.
  ctx.cam.heroOrbit(ctx.player.pos.x, ctx.player.pos.z);
  // Mercy keeps the world's light alive — the embers stay thick rather than thinning out.
  ctx.fx.ambientRate = chosenMercy ? 14 : 2;
  const heroLine = HERO_ENDING[ctx.player.hero.id];
  const lines = [...(chosenMercy ? MERCY_ENDING_LINES : ENDING_LINES), ...(heroLine ? [heroLine] : [])];
  menus.storyIntro(lines, () => {
    menus.clear();
    state = "victory";
    musicLament = false;
    menus.showVictory(ctx.stats, unlocks, chosenMercy);
    if (unlocks.length) ctx.sfx.unlockFanfare();
  });
}

/** Seconds the player must hold the spare input to grant the Hollow Star mercy. */
const SPARE_TIME = 1.6;

/** The player chose mercy — end the fight gently and steer to the hopeful ending. */
function doMercy(): void {
  if (chosenMercy) return;
  chosenMercy = true;
  unmakerFading = false;
  spareHold = 0;
  hud.setSparePrompt(false, 0);
  hud.banner("MERCY", "you lower your blade", "banner--lament");
  const boss = ctx.enemies.living().find((e) => e.kind === "boss");
  if (boss) boss.takeDamage(99999); // ends the run via the normal victory pipeline → mercy ending
}

ctx.events.on("PLAYER_DIED", () => {
  // Training Grounds is forgiving — pick the hero back up and keep teaching.
  if (inTutorial) {
    ctx.player.alive = true;
    ctx.player.hp = ctx.player.maxHp;
    ctx.player.root.visible = true;
    return;
  }
  runResolved = true; // lock out pause/checkpoint through the death resolution
  ctx.stage.setMood("dead"); // drain + cool the frame (IDEAS-GRAPHICS #18)
  // If death lands during a boss phase cutscene, tear the cutscene down first so
  // its skip listeners / letterbox / world-freeze don't stay armed over the death
  // screen (guarded no-op otherwise; mirrors BOSS_DEFEATED).
  finishCutscene();
  // Tear down anything a run-transition would: an in-flight interlude (its skip
  // button + 45s auto-cross), the Wound's ember ally, and the mercy prompt —
  // any of which would otherwise survive onto the death screen.
  finishInterlude(null, false);
  clearEmberAlly();
  hud.setSparePrompt(false, 0);
  unmakerFading = false;
  spareHold = 0;
  ctx.music.silence();
  ctx.cam.addTrauma(0.7);
  ctx.stage.punch(1);
  ctx.sfx.defeat();
  clearRunSave();
  const unlocks = ctx.profile.recordRun("death", ctx.stats);
  window.setTimeout(() => {
    state = "dead";
    ctx.cam.menuOrbit();
    hud.setVisible(false);
    menus.showDeath(ctx.stats, unlocks);
    if (unlocks.length) ctx.sfx.unlockFanfare();
  }, 1700);
});

window.addEventListener("keydown", (e) => {
  if (e.code !== "Escape") return;
  if (state === "playing") pause();
  else if (state === "paused") resume();
});

// ---------------------------------------------------------------- frame loop
// True until the loading screen has warmed the menu render path + fonts. While it
// holds, the loop runs its (cheap) logic but skips the visible render — the only
// render during boot is the warm-up itself, behind the opaque loader.
let booting = true;
let last = performance.now();
// While a menu/overlay is up the scene is near-static, so we render it at a
// capped rate (logic + input still poll every vsync) — a still title screen has
// no reason to redraw 120–144×/sec and that's exactly where weak GPUs choke.
let menuRenderAccum = 0;
// Cap menu/overlay redraws so a high-refresh panel doesn't redraw a near-static
// screen 144×/sec. 40fps is smooth for the slow orbiting backdrop + twinkling sky
// (the orbit turns ~0.1°/frame) while keeping the per-frame cost well clear of stalls.
const MENU_FRAME = 1 / 40;
const trailTip = new THREE.Vector3();
const trailBase = new THREE.Vector3();

// Perf instrumentation: a single accurate source of frame pacing + GPU load for
// the harness (window.__rh3perf) and an optional on-screen overlay. `?perf` auto-
// shows it; F8 toggles it live. See src/debug/perfMonitor.ts.
const perf = new PerfMonitor(ctx, () => state);
/** Latches once the frame loop has thrown so the recovery log fires only on the first hit. */
let loopErrorLogged = false;
/** Capped log of every frame-loop error (state + message) — QA reads it via
 *  __rh3debug.frameErrors() and asserts it stays EMPTY: a loop that survives a
 *  throwing frame otherwise looks perfectly healthy from the outside. */
const frameErrorRing: { t: number; state: string; msg: string }[] = [];
/** Test-only: when true the frame loop freezes all updates (dt=0) but keeps rendering the
 *  full composer, so a shimmer test can isolate per-frame-random post FX. Set via __rh3debug. */
let frozenForTest = false;
/** Test-only motion recorder (the animation oracles' data source): while armed, each
 *  playing frame appends one compact numeric sample — sim time, player/camera world
 *  positions, facing, per-foot world contact points and the pose layer's lift signals —
 *  so foot-skate/jitter/smoothness are MEASURED numbers, never filmstrip eyeballs.
 *  Off (zero work, zero allocation) in normal play; capped so a forgotten arm can't grow. */
let motionOn = false;
let motionT = 0;
const motionBuf: number[][] = [];
const MOTION_CAP = 1800; // 30s at 60fps
const motionSampleOut = new Float64Array(8);

/** One frame of the game. Live play calls it from setAnimationLoop with the real
 *  clock; the QA stepper (__rh3debug.frames) calls it directly with a forced dt —
 *  same sim, same composer, exact frames instead of wall-waiting a slow headless
 *  clock. */
const runFrame = (now: number, forcedDt: number | null = null): void => {
  // Frame-rate limit: on a high-refresh display, skip vsync ticks that arrive
  // sooner than the chosen interval (the 1ms tolerance keeps a 60-cap from
  // collapsing to 30 on a 60Hz panel under jitter). Input/sim/render all run on
  // the ticks we keep, so latency tracks the cap — not vsync. Never gate boot,
  // never gate a forced step.
  const fpsCap = menus.settings.fpsCap;
  if (forcedDt == null && fpsCap > 0 && !booting && now - last < 1000 / fpsCap - 1) return;
  // max(0): after a stepper run, `last` can sit ahead of the real clock.
  const renderDt = forcedDt ?? Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  // Test-only world freeze (__rh3debug.freezeForTest): pass dt=0 to every sim/camera/arena
  // update so the scene is pixel-identical frame-to-frame, while the composer still renders
  // with a real dt. Any remaining frame-to-frame change is then a PER-FRAME-RANDOM post
  // effect (e.g. animated film grain) — exactly what the flicker shimmer test isolates. It's
  // a no-op in normal play (frozenForTest stays false).
  const dt = frozenForTest ? 0 : renderDt;

  // The entire frame body — INCLUDING the perf instrument — is guarded. Three's
  // setAnimationLoop never re-requests once its callback throws, so a single
  // unhandled exception anywhere below (even in perf.begin/end) would freeze the
  // game permanently — a player-facing "crash". Contain it: log the first failure
  // with the state it struck in, keep the loop alive.
  try {
  perf.begin(now);
  // Gamepad: poll every frame; Start toggles pause (works while paused, unlike the action layer)
  ctx.input.pollGamepad();
  if (ctx.input.pauseEdgeRaw()) {
    if (state === "playing") pause();
    else if (state === "paused") resume();
  }

  ctx.playing = state === "playing";

  // Gamepad menu navigation runs whenever a menu overlay is up (no-op without a pad).
  if (!ctx.playing) menuNav.update(dt);

  if (ctx.playing) {
    ctx.stats.time += dt;
    ctx.input.updateAim(ctx.stage.camera);
    ctx.controller.update(dt);
    ctx.combat.update(dt);
    ctx.tempo.update(dt);
    ctx.cam.setTempo(ctx.tempo.value / 100); // tempo tightens the framing (IDEAS-GRAPHICS #46)
    ctx.deck.update(dt);
    ctx.caster.update(dt);
    ctx.enemies.update(dt);
    ctx.projectiles.update(dt);
    ctx.hostiles.update(dt);
    ctx.features.update(dt);
    // The causeway interlude is a non-combat beat with no loaded node; don't let
    // wave/clear logic tick under it. (In the real flow run-state is already
    // "cleared" here so update() no-ops — this just keeps the beat self-contained.)
    if (!interlude) ctx.run.update();
    ctx.player.update(dt);
    updateContactShadows();
    // Tempo colours the whole frame, not just the HUD (IDEAS-GRAPHICS #17). Stops
    // once a run resolves so the death/victory mood grade owns the frame.
    if (!runResolved) ctx.stage.setTempoTint(ctx.tempo.zone.color, 0.13);
    // Sword ribbon while the blade is actually moving (chain or card swings)
    ctx.player.getBladePoints(trailTip, trailBase);
    ctx.trail.setColor(ctx.player.bladeColor);
    ctx.trail.update(dt, trailTip, trailBase, ctx.combat.swinging || ctx.caster.swinging);
    if (interlude) updateInterlude(dt);
    if (emberAlly) updateEmberAlly(dt);
    if (inTutorial) tutorial.update(dt);
    // Mercy: while the Hollow Star fades, holding the mercy input spares it instead of killing it.
    if (unmakerFading && !chosenMercy) {
      if (ctx.input.actionDown("mercy")) {
        spareHold += dt;
        hud.setSparePrompt(true, spareHold / SPARE_TIME);
        if (spareHold >= SPARE_TIME) doMercy();
      } else {
        spareHold = Math.max(0, spareHold - dt * 1.5);
        hud.setSparePrompt(true, spareHold / SPARE_TIME);
      }
    }
    hud.update();
  } else if (state === "cutscene") {
    // Cinematics: the world breathes, spawns materialize, nothing fights.
    // A controller button skips the boss entrance just like a key/click does
    // (story screens are handled by menuNav, which reads the pad directly).
    if (bossCutscene && ctx.input.anyButtonEdge()) skipCutscene();
    // Phase beats freeze the fight so a boss can't hit the disarmed player.
    ctx.player.animMoveAmount = 0;
    ctx.player.update(dt);
    if (!cutsceneFreezeWorld) ctx.enemies.update(dt);
    ctx.player.getBladePoints(trailTip, trailBase);
    ctx.trail.update(dt, trailTip, trailBase, false);
  } else if (state === "draft" || state === "paused") {
    // World idles but the hero still breathes
    ctx.player.update(0.0001);
  }

  // Low-HP swell: the bed leans in as the hero nears death.
  const hpFrac = ctx.player.maxHp > 0 ? ctx.player.hp / ctx.player.maxHp : 1;
  ctx.music.setTension(ctx.playing && ctx.player.alive && hpFrac < 0.35 ? (0.35 - hpFrac) / 0.35 : 0);
  ctx.music.update(dt);

  // Motion recorder (test-only; armed via __rh3debug.recordMotion)
  if (motionOn && ctx.playing && motionBuf.length < MOTION_CAP) {
    motionT += dt;
    ctx.player.motionSample(motionSampleOut);
    const cp = ctx.stage.camera.position;
    motionBuf.push([
      motionT, ctx.player.pos.x, ctx.player.pos.y, ctx.player.pos.z, ctx.player.facing,
      cp.x, cp.y, cp.z,
      motionSampleOut[0], motionSampleOut[1], motionSampleOut[2],
      motionSampleOut[3], motionSampleOut[4], motionSampleOut[5],
      motionSampleOut[6], motionSampleOut[7],
    ]);
  }

  ctx.arena.update(dt);
  ctx.fx.update(dt);
  ctx.decals.update(dt); // scorch/crack marks fade on their own clock, even through death
  ctx.tele.update(dt);
  ctx.cam.update(dt);
  ctx.stage.update(dt);

  // Combat + cinematics get the full post chain at full rate; menus/overlays get
  // the lean chain (no bloom/SMAA/grain/shadows) rendered at a capped frame rate.
  // While the loading screen is up, skip the visible render entirely (the loader
  // is opaque) so the menu's first real frame is already warm and never compiles.
  //
  // `dead`/`victory` deliberately stay on the FULL path: the player can die with the
  // boss + a full enemy pack still on the field, and flipping to the lean menu path
  // there (drop shadows + switch composer) would relink every lit material on that
  // one live frame — the "killed by a boss → ~3-second freeze". Holding the full path
  // means no flip happens until `toMenu()`/retry has cleared the scene back to the
  // (already-warm) menu, where the toggle is cheap.
  if (!booting) {
    const fullPath = ctx.playing || state === "cutscene" || state === "dead" || state === "victory";
    ctx.stage.setLowCost(!fullPath);
    if (fullPath) {
      ctx.stage.render(renderDt);
      menuRenderAccum = 0;
    } else {
      menuRenderAccum += dt;
      if (menuRenderAccum >= MENU_FRAME) {
        ctx.stage.render(menuRenderAccum);
        menuRenderAccum = 0;
      }
    }
  }
  ctx.input.endFrame();
  } catch (err) {
    if (!loopErrorLogged) {
      loopErrorLogged = true;
      console.error(`[rh3] frame loop error (state=${state}) — recovered, loop kept alive:`, err);
    }
    if (frameErrorRing.length < 20) frameErrorRing.push({ t: Math.round(now), state, msg: String(err) });
    // Clear per-frame input edges even on a bad frame so a stuck press can't latch.
    try { ctx.input.endFrame(); } catch { /* ignore */ }
  } finally {
    try { perf.end(dt); } catch { /* the instrument must never freeze the loop */ }
  }
};

ctx.stage.renderer.setAnimationLoop(() => runFrame(performance.now()));

// ── WebGL context-loss watchdog ────────────────────────────────────────────
// Three re-inits GL and lazily re-uploads resources on restore, but the whole
// PROGRAM CACHE is dropped — without a re-warm the first-use compile-hitch
// class silently returns on the first post-restore fight. If the context never
// comes back, reload: the fixed loopback origin + checkpoint saves make a
// reload lossless. (Restore-with-reload-fallback is the shipped-web-game norm.)
let ctxLostAt = 0;
ctx.stage.renderer.domElement.addEventListener("webglcontextlost", () => {
  ctxLostAt = performance.now();
  console.error("[rh3] WebGL context LOST — waiting for restore");
});
ctx.stage.renderer.domElement.addEventListener("webglcontextrestored", () => {
  console.warn(`[rh3] WebGL context restored after ${Math.round(performance.now() - ctxLostAt)}ms — re-warming shaders`);
  ctxLostAt = 0;
  try { ctx.stage.warmUp(); ctx.stage.warmMenu(); } catch (e) { console.error("[rh3] post-restore warm-up failed:", e); }
});
window.setInterval(() => {
  if (ctxLostAt && performance.now() - ctxLostAt > 10_000) location.reload();
}, 1000);

// ---------------------------------------------------------------- boot
// The loading screen (#rift-loader in index.html) is already painting. Under it we
// build the menu scene, wait for the webfonts (so the title doesn't swap/reflow),
// and pre-compile the menu + combat render paths — so the moment the loader lifts,
// the menu is smooth and the first fight won't hitch on a first-use shader compile.
const RIFT_LOADER_MIN_MS = 900;
async function boot(): Promise<void> {
  const loader = document.getElementById("rift-loader");
  const bar = loader?.querySelector<HTMLElement>(".rl-bar-fill") ?? null;
  const status = loader?.querySelector<HTMLElement>(".rl-status") ?? null;
  const step = (pct: number, text: string): void => {
    if (bar) bar.style.width = `${Math.round(pct * 100)}%`;
    if (status) status.textContent = text;
  };
  // Yield two frames so the loader can paint the new status/bar between heavy,
  // main-thread-blocking warm-up steps (keeps the loader animation alive).
  const paint = (): Promise<void> =>
    new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  const startedAt = performance.now();

  try {
    // 1. Build the menu scene (rift theme, hero mesh, ambient embers, main-menu DOM).
    toMenu();
    step(0.18, "Kindling the rift…");
    await paint();

    // 2. Webfonts — gate the reveal on these so the menu doesn't render in a
    //    fallback face and then reflow (FOUT). Bounded so a slow fetch can't hang.
    try {
      await Promise.race([
        Promise.all([
          document.fonts.load("700 1em Cinzel"),
          document.fonts.load("600 1em Cinzel"),
          document.fonts.load("600 1em Rajdhani"),
          document.fonts.load("500 1em Rajdhani"),
        ]),
        new Promise((r) => window.setTimeout(r, 1500)),
      ]);
    } catch { /* fonts optional — fall through to fallback faces */ }
    step(0.42, "Forging the arena…");
    await paint();

    // 3. Compile the menu render path (in-scene materials + lean menuComposer), and
    //    pre-paint the heavy hero-select DOM so its first open doesn't stall.
    ctx.stage.warmMenu();
    menus.warmHeroSelect();
    step(0.62, "Lighting the embers…");
    await paint();

    // 4. Pre-render the combat roster + card effects (and both shadow states, so the
    //    menu↔combat and death transitions never compile on a live frame). Done in
    //    two yielded chunks so no single compile dominates a frame and the loader
    //    keeps animating. Latch first so any in-run warm call (node load) no-ops.
    if (!combatWarmupDone) {
      combatWarmupDone = true;
      combatWarmupScheduled = false;
      ctx.caster.precompile();
      step(0.74, "Sharpening the blades…");
      await paint();
      // Stage the new render-system materials in-frustum so precompile's warmUp draws
      // and compiles their composer-target (srgb-linear) program — decals start
      // visible:false and the telegraph band mesh is lazily built, so both would
      // otherwise pay a first-use compile in combat. Under the (opaque) loader; cleared
      // right after warmUp so nothing shows.
      const wp = ctx.player.pos;
      ctx.decals.scorch(wp.x, wp.z, 0.25);
      ctx.decals.crack(wp.x + 0.6, wp.z, 0.25);
      ctx.tele.ring(wp.x, wp.z, 0.15, 0.3, 0.05);
      ctx.tele.line(wp.x, wp.z, 0, 1, 0.15, 0.05);
      ctx.enemies.precompile();
      ctx.decals.clear();
      step(0.86, "Summoning the wardens…");
      await paint();
      ctx.run.warmBosses();
      step(0.92, "Binding the wardens…");
      await paint();
    }

    // 5. Let the (cool) loader read as intentional rather than a flash, then reveal.
    const elapsed = performance.now() - startedAt;
    if (elapsed < RIFT_LOADER_MIN_MS) await new Promise((r) => window.setTimeout(r, RIFT_LOADER_MIN_MS - elapsed));
    step(1, "Descend.");
  } catch { /* never trap the player behind the loader */ }

  booting = false;
  // Apply the saved display mode + window resolution now that the window is live
  // (deferred to here so it runs once, after warm-up, not on every settings tweak).
  menus.applyInitialDisplay();
  if (loader) {
    loader.classList.add("rl-done");
    window.setTimeout(() => loader.remove(), 700);
  }
}
void boot();

// Debug/automation hook. Exposed in BOTH dev and production builds so the
// real-runtime Electron smoke (scripts/smoke-electron.cjs) can drive the
// shipped bundle, exactly as Wall-of-Dead exposes window.__wod. Harmless for an
// offline single-player game; nothing reads it unless a test reaches for it.
{
  const w = window as unknown as Record<string, unknown>;
  w.__rh3 = ctx;
  w.__rh3gen = { generatePlan, difficultyFor, MAX_DEPTH };
  w.__rh3palettes = { default: ZONE_PALETTE.default.map((p) => p.color), colorblind: ZONE_PALETTE.colorblind.map((p) => p.color) };
  // Player-facing narrative corpus for the text-pacing + narrative-cohesion QA oracles.
  w.__rh3text = { story: STORY_LINES, actStory: ACT_STORY, endings: ENDING_LINES, mercyEndings: MERCY_ENDING_LINES, heroEndings: HERO_ENDING, actFlavor: ACT_FLAVOR, bossEpitaphs: BOSS_EPITAPHS };
  w.__rh3cards = CARDS;
  w.__rh3heroes = HEROES;
  w.__rh3menus = menus;
  // Perf instrumentation surface (see src/debug/perfMonitor.ts). `?perf` opens the
  // overlay on boot; F8 toggles it during play without touching gameplay input.
  w.__rh3perf = perf;
  if (new URLSearchParams(location.search).has("perf")) perf.hud(true);
  window.addEventListener("keydown", (e) => { if (e.code === "F8") perf.hud(); });
  // Live effect-bisection panel (backtick `): strip every render feature and add them back
  // one-by-one on REAL hardware to pinpoint a GPU-specific glitch software rendering can't
  // show. Also exposed as window.__rh3fx for the harness.
  const fxPanel = new EffectsPanel([
    { id: "msaa", label: "MSAA (4× hardware anti-alias)", hint: "OFF: caused real-GPU flicker", on: false, apply: (on) => ctx.stage.setDebug("msaa", on) },
    { id: "smaa", label: "SMAA (post anti-alias)", apply: (on) => ctx.stage.setDebug("smaa", on) },
    { id: "bloom", label: "Bloom (glow)", apply: (on) => ctx.stage.setDebug("bloom", on) },
    { id: "shadows", label: "Shadows", hint: "shadow-map flicker", apply: (on) => ctx.stage.setDebug("shadows", on) },
    { id: "env", label: "Env reflections (IBL)", hint: "view-dependent", apply: (on) => ctx.stage.setDebug("env", on) },
    { id: "rim", label: "Rim edge-light (fresnel)", hint: "view-dependent, on edges", apply: (on) => setRimEnabled(on) },
    { id: "fog", label: "Fog", apply: (on) => ctx.stage.setDebug("fog", on) },
    { id: "grade", label: "Color grade + dither", apply: (on) => ctx.stage.setDebug("grade", on) },
    { id: "vignette", label: "Vignette", apply: (on) => ctx.stage.setDebug("vignette", on) },
    { id: "contact", label: "Contact shadows (ground blobs)", apply: (on) => contactShadows.setVisible(on) },
  ]);
  w.__rh3fx = fxPanel;
  window.addEventListener("keydown", (e) => { if (e.code === "Backquote") fxPanel.toggleOpen(); });
  // Current top-level UI screen, for the automation/capture harness so it can
  // tell menu/draft/pause/end states apart without guessing from the DOM.
  w.__rh3state = () => state;

  // ── Debug scenario system ────────────────────────────────────────────────
  // A single documented surface for automated tests to "cut to" a scenario and
  // screenshot it, instead of hand-stitching debugLoadBoss/spawn/cinematic calls.
  //   __rh3debug.scenario("boss:colossus:p2")   boss room, jumped to phase 2
  //   __rh3debug.scenario("enemy:caster")       one framed enemy in a holding room
  //   __rh3debug.scenario("room:elite")         a node kind (combat/elite/shop/…)
  //   __rh3debug.scenario("menu"|"victory"|"death")
  // plus low-level helpers (frame/godmode/setBossPhase/killEnemies/skipCutscene).
  type DebugBoss = Parameters<typeof ctx.run.debugLoadBoss>[0];
  type DebugNode = Parameters<typeof ctx.run.debugLoadNode>[0];
  type DebugKind = Parameters<typeof ctx.enemies.spawn>[0];
  interface ScenarioOpts { act?: number; seed?: number; depth?: number; skipIntro?: boolean; frame?: boolean; zoom?: number; }
  const BOSS_ACT: Record<string, number> = { warden: 1, spire: 2, colossus: 3, tyrant: 4, unmaker: 5, echo: 4 };
  const PHASE_FRAC: Record<string, number> = { p2: 0.66, p3: 0.32, p4: 0.1 };
  // Time-based (NOT frame-based) deferral: headless renderers can run the rAF loop
  // uncapped, so a frame-count budget burns through in a fraction of a second and
  // misses a boss that spawns a couple seconds into a long entrance.
  const soon = (fn: () => void, ms = 50) => window.setTimeout(fn, ms);
  const livingBoss = () => ctx.enemies.living().find((e) => e.kind === "boss") ?? null;
  /** Run fn once a boss has actually spawned (it materializes during the entrance). */
  const whenBoss = (fn: () => void, ms = 12000): void => {
    const t0 = performance.now();
    const tick = () => { if (livingBoss()) fn(); else if (performance.now() - t0 < ms) soon(tick, 60); };
    tick();
  };

  const debug = {
    /** Cut to a named scenario. Returns true if the name was recognized. */
    scenario(name: string, opts: ScenarioOpts = {}): boolean {
      finishInterlude(null, false); // a debug jump must not leave interlude badges/timers lingering
      const parts = String(name).split(":");
      switch (parts[0]) {
        case "boss": return debug.boss(parts[1], parts[2], opts);
        case "enemy": return debug.enemy(parts[1], opts);
        case "room": return debug.room(parts[1], opts.act ?? 1);
        case "menu": toMenu(); return true;
        case "tutorial": startTutorial(); return true;
        case "victory": ctx.events.emit("RUN_VICTORY", {}); return true;
        case "death": ctx.combat.damagePlayer(99999, ctx.player.pos.x, ctx.player.pos.z); return true;
        default: return false;
      }
    },
    /** Load a boss room; optional phase tag ("p2"/"p3"/"p4") jumps straight there. */
    boss(kind: string, phase?: string, opts: ScenarioOpts = {}): boolean {
      const act = opts.act ?? BOSS_ACT[kind] ?? 4;
      const ok = ctx.run.debugLoadBoss(kind as DebugBoss, act, opts.seed ?? 424242, opts.depth ?? (kind === "echo" ? 3 : 5));
      const target = phase === "p4" ? 4 : phase === "p3" ? 3 : phase === "p2" ? 2 : 0;
      whenBoss(() => {
        // Each frame: keep trying to skip the entrance (the skip is grace-gated for
        // ~700ms, and a boss can't be phase-advanced until it's actually in play),
        // then push the boss to the target phase. Continue until the intro is over
        // AND the phase has landed — robust to long entrances + entrance wards.
        const t0 = performance.now();
        const step = () => {
          if (opts.skipIntro !== false) skipCutscene();
          const b = livingBoss();
          const atPhase = target === 0 || (b ? ((b as { phase?: number }).phase ?? 1) >= target : false);
          if (target > 0 && b && !atPhase) debug.setBossPhase(PHASE_FRAC[phase!]);
          if ((state !== "playing" || !atPhase) && performance.now() - t0 < 12000) soon(step, 80);
        };
        step();
      });
      return ok;
    },
    /** Spawn one enemy at the origin in a holding room (a hidden, banished boss
     *  keeps the room from auto-clearing), framed for a portrait. */
    enemy(kind: string, opts: ScenarioOpts = {}): boolean {
      ctx.run.debugLoadBoss("warden", 1, 424242, 1);
      whenBoss(() => {
        skipCutscene();
        const b = livingBoss();
        if (b) { b.root.visible = false; b.setSpawnGrace(1e9); b.pos.x = 0; b.pos.z = -60; }
        ctx.enemies.spawn(kind as DebugKind, 0, 0, 0);
        ctx.player.pos.x = 26; ctx.player.pos.z = 26; ctx.player.hp = ctx.player.maxHp;
      });
      if (opts.frame !== false) window.setTimeout(() => debug.frame(0, 0, opts.zoom ?? 0.36), 1500);
      return true;
    },
    /** Load any node kind: combat/elite/shop/treasure/rest/event. */
    room(kind: string, act = 1): boolean { return ctx.run.debugLoadNode(kind as DebugNode, act); },
    /** Play a mid-act story interlude (the causeway) — for the words-lock smoke.
     *  The hero is frozen until the act's banners come and go, then may cross. */
    interlude(act = 2): boolean {
      playActTransition({ act, actName: "TRIAL OF WORDS", theme: "dusk" }, () => ctx.run.debugLoadNode("combat", act));
      return true;
    },
    /** Words-lock state of an active interlude: true while the banners play, false
     *  once the hero may cross, null when no interlude is running. */
    interludeLocked(): boolean | null { return interlude ? interlude.locked : null; },
    /** Dolly the cinematic camera onto a point (small zoom = closer). */
    frame(x = 0, z = 0, zoom = 0.5): void { ctx.cam.cinematic(x, z, zoom); },
    /** Hand the camera back to gameplay follow. */
    follow(): void { ctx.cam.mode = "follow"; },
    /** Drop the active boss to a HP fraction (triggers its phase cutscene). */
    setBossPhase(frac: number): boolean { const b = livingBoss(); if (b) b.takeDamage(Math.max(1, Math.round(b.hp - b.maxHp * frac))); return !!b; },
    /** Infinite HP: all incoming player damage is ignored. Defaults ON (and idempotent,
     *  so repeated calls keep it on); pass `false` to turn it off. Also tops you off.
     *  Returns the new state. */
    godmode(on = true): boolean {
      ctx.combat.god = on;
      ctx.player.hp = ctx.player.maxHp;
      return ctx.combat.god;
    },
    /** Clear all non-boss enemies. */
    killEnemies(): void { for (const e of ctx.enemies.living()) if (e.kind !== "boss") e.takeDamage(99999); },
    /** Skip an active intro/phase cutscene. */
    skipCutscene(): void { skipCutscene(); },
    /** Test-only: freeze all world/camera updates (dt=0) while still rendering the full
     *  composer, so the flicker shimmer test can isolate per-frame-random post FX. */
    freezeForTest(on = true): boolean { frozenForTest = on; return frozenForTest; },
    /** Deterministic stepper: advance EXACTLY n frames at a fixed dt (seconds), real sim +
     *  real composer render each step. The base of filmstrips and frame-exact tests —
     *  never wall-wait the ~3×-slow headless clock when you can step. */
    frames(n: number, dt = 1 / 60): number {
      for (let i = 0; i < n; i++) runFrame(last + dt * 1000, dt);
      return n;
    },
    /** One forced frame (see frames()). */
    tick(dt = 1 / 60): void { runFrame(last + dt * 1000, dt); },
    /** Every error the frame loop caught (capped at 20). QA asserts this is EMPTY —
     *  the loop surviving a throwing frame otherwise looks healthy from outside. */
    frameErrors(): { t: number; state: string; msg: string }[] { return frameErrorRing.slice(); },
    /** Per-event emit counts since boot — the QA coverage matrix (0 = untested content). */
    coverage(): Record<string, number> { return { ...ctx.events.counts } as Record<string, number>; },
    /** True while the WebGL context is lost (context-loss resilience smoke reads this). */
    contextLost(): boolean { return ctxLostAt > 0; },
    /** Non-pixel scene oracles: NaN scan over world matrices, finite scene bounds,
     *  type counts, renderer.info gauges — catches geometry/scale explosions and
     *  scene-transition leaks that pixels can't localize. QA asserts ok===true. */
    sceneCheck(): { ok: boolean; nan: number; finiteBounds: boolean; meshes: number; info: { geometries: number; textures: number; programs: number } } {
      const scene = ctx.stage.scene;
      scene.updateMatrixWorld(true);
      let nan = 0, meshes = 0;
      scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) meshes++;
        for (const e of o.matrixWorld.elements) if (Number.isNaN(e)) { nan++; break; }
      });
      const box = new THREE.Box3().setFromObject(scene);
      const finiteBounds = [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].every(Number.isFinite);
      const info = ctx.stage.renderer.info;
      return {
        ok: nan === 0 && finiteBounds, nan, finiteBounds, meshes,
        info: { geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length ?? 0 },
      };
    },
    /** The active boss instance (or null). */
    boss0() { return livingBoss(); },
    /** Current top-level UI screen. */
    state(): string { return state; },
    /** Open an interstitial screen directly (shop/treasure/rest/event/shrine/gamble) — smokes/screenshots. */
    screen(kind: string): boolean {
      const done = () => menus.clear();
      if (kind === "shop") menus.showShop(done);
      else if (kind === "treasure") menus.showTreasure(done);
      else if (kind === "rest") menus.showRest(done);
      else if (kind === "event") menus.showEvent(done);
      else if (kind === "shrine") menus.showShrine(done);
      else if (kind === "gamble") menus.showGamble(done);
      else return false;
      return true;
    },
    /** Structural world constants for the collision/reachability oracles — oracles
     *  read these OFF the seam, never hardcode them (a hardcoded bound broke silently
     *  in another repo when the level resized). */
    world(): { arenaRadius: number; playerRadius: number; obstacles: { x: number; z: number; r: number }[] } {
      return {
        arenaRadius: ARENA_RADIUS,
        playerRadius: ctx.player.radius,
        obstacles: ctx.arena.obstacles.map((o) => ({ x: o.x, z: o.z, r: o.r })),
      };
    },
    /** What the player should perceive right now: current screen, goal, next action.
     *  A reachable state this cannot articulate is confusing by definition (the
     *  articulability gate), and the blind comprehension probe scores a context-free
     *  model's reading of the frame against exactly this ground truth. */
    flow(): { screen: string; goal: string; nextAction: string } {
      const boss = livingBoss();
      const foes = ctx.enemies.living().filter((e) => e.kind !== "boss").length;
      switch (state) {
        case "menu": {
          // Save-aware: with a checkpoint the menu leads with CONTINUE RUN, and a
          // first-time reader of the frame correctly infers "resume", not "begin"
          // (the blind probe caught this ground truth being imprecise).
          if (document.querySelector(".continue")) return { screen: "menu", goal: "continue the saved run", nextAction: "click CONTINUE RUN" };
          return { screen: "menu", goal: "begin a run", nextAction: "click PLAY (or press Enter)" };
        }
        case "cutscene": return { screen: "cutscene", goal: "watch the story beat", nextAction: "press Space to skip" };
        case "paused": return { screen: "paused", goal: "resume the run", nextAction: "press Escape or click RESUME" };
        case "dead": return { screen: "death", goal: "start a new run", nextAction: "click the retry button" };
        case "victory": return { screen: "victory", goal: "bank the run and continue", nextAction: "click CONTINUE" };
        case "draft": {
          if (document.querySelector(".mapnode")) return { screen: "map", goal: "choose the next node on the forked path", nextAction: "click a highlighted map node" };
          if (document.querySelector(".draft-row .card")) return { screen: "card-draft", goal: "add one card to the deck", nextAction: "click one of the offered cards" };
          return { screen: "interstitial", goal: "resolve this screen and move on", nextAction: "click one of the offered choices" };
        }
        default: { // playing
          if (interlude) return { screen: "interlude", goal: "cross the causeway", nextAction: interlude.locked ? "wait for the words to pass" : "walk forward across the causeway" };
          if (boss) return { screen: "combat", goal: "defeat the boss", nextAction: "attack the boss and dodge its telegraphed attacks" };
          if (foes > 0) return { screen: "combat", goal: `defeat the remaining ${foes} ${foes === 1 ? "enemy" : "enemies"}`, nextAction: "attack the nearest enemy" };
          return { screen: "combat", goal: "room cleared — collect the reward", nextAction: "wait for the reward screen" };
        }
      }
    },
    /** Collision-truth oracle: the render scene and the collider set must AGREE about
     *  where solid matter is — every prior oracle only checked the resolver against its
     *  own collider list, so a visible prop with no collider passed everything. Run in
     *  a staged, quiescent room (transient combat FX absent). Finding classes:
     *  - unclassified: an in-reach mesh with no userData.solidity on itself or any
     *    ancestor (a NEW prop nobody classified — exactly the walk-through incubator);
     *  - uncovered: a "solid" mesh whose XZ footprint no collider circle covers to
     *    within a player-radius tolerance (the walk-through class);
     *  - phantom: a collider circle with no solid mesh footprint over it (the
     *    invisible-wall class). Deterministic; no pixels. */
    collisionAudit(): {
      ok: boolean;
      unclassified: { name: string; x: number; z: number; r: number }[];
      uncovered: { name: string; x: number; z: number; r: number; overhang: number }[];
      phantom: { x: number; z: number; r: number }[];
    } {
      const scene = ctx.stage.scene;
      scene.updateMatrixWorld(true);
      const R = ctx.player.radius;
      const obstacles = ctx.arena.obstacles;
      const rnd2 = (n: number): number => Math.round(n * 100) / 100;
      const cls = (o: THREE.Object3D): string | null => {
        for (let p: THREE.Object3D | null = o; p; p = p.parent) {
          const s = (p.userData as { solidity?: string }).solidity;
          if (s) return s;
        }
        return null;
      };
      const box = new THREE.Box3();
      const unclassified: { name: string; x: number; z: number; r: number }[] = [];
      const uncovered: { name: string; x: number; z: number; r: number; overhang: number }[] = [];
      const covered: boolean[] = new Array<boolean>(obstacles.length).fill(false);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !m.visible) return;
        const s = cls(m);
        if (s && s !== "solid") return; // ground/nonsolid/mover/fx are exempt by declaration
        // precise=true: transform the vertices, not the local AABB — a rotated
        // pillar's loose AABB otherwise reads ~1.3× wider than its true footprint
        // and manufactures phantom overhang findings.
        box.setFromObject(m, true);
        if (!Number.isFinite(box.min.x) || !Number.isFinite(box.max.x)) return;
        const cx = (box.min.x + box.max.x) / 2;
        const cz = (box.min.z + box.max.z) / 2;
        const r = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
        // Reach filter: only geometry a grounded player can bodily touch matters —
        // inside the movement clamp, intersecting the body's height band.
        const inReach = Math.hypot(cx, cz) - r < ARENA_RADIUS - R && box.min.y < 1.6 && box.max.y > 0.12;
        if (!inReach) return;
        const name = m.name || m.parent?.name || m.geometry.type;
        if (!s) { unclassified.push({ name, x: rnd2(cx), z: rnd2(cz), r: rnd2(r) }); return; }
        // "solid": some collider circle must cover this footprint to within a gap the
        // player doesn't fit through (visual overhang the circle still bodily blocks).
        let best = Infinity;
        for (let i = 0; i < obstacles.length; i++) {
          const ob = obstacles[i];
          const overhang = Math.hypot(cx - ob.x, cz - ob.z) + r - ob.r;
          if (overhang < best) best = overhang;
          if (Math.hypot(cx - ob.x, cz - ob.z) < ob.r + r) covered[i] = true;
        }
        if (best > R * 0.8) uncovered.push({ name, x: rnd2(cx), z: rnd2(cz), r: rnd2(r), overhang: rnd2(best) });
      });
      const phantom: { x: number; z: number; r: number }[] = [];
      for (let i = 0; i < obstacles.length; i++) {
        if (!covered[i]) phantom.push({ x: rnd2(obstacles[i].x), z: rnd2(obstacles[i].z), r: rnd2(obstacles[i].r) });
      }
      return { ok: !unclassified.length && !uncovered.length && !phantom.length, unclassified, uncovered, phantom };
    },
    /** Deterministic DOM UI audit (overlap / truncation / offscreen / contrast /
     *  no-owned-surface / raw-text-leak / invisible-interactive) over #hud+#overlay
     *  at the current viewport. The harness drives this at multiple sizes + a
     *  pseudoloc pass. See src/debug/uiAudit.ts. */
    auditUI(opts?: { roots?: string[]; allow?: string[] }) { return auditUI(opts); },
    /** Occlusion hit-test: every interactive control must resolve to itself. */
    auditOcclusion(selector?: string) { return auditOcclusion(selector); },
    /** Arm/disarm the per-frame motion recorder (arming resets the buffer). */
    recordMotion(on = true): boolean {
      motionOn = on;
      if (on) { motionBuf.length = 0; motionT = 0; }
      return motionOn;
    },
    /** Drain the recorded motion samples (see `fields` for the per-sample layout). */
    motion(): { fields: string[]; samples: number[][] } {
      return {
        fields: ["t", "px", "py", "pz", "facing", "camX", "camY", "camZ",
          "footRX", "footRY", "footRZ", "footLX", "footLY", "footLZ", "liftR", "liftL"],
        samples: motionBuf.map((s) => s.slice()),
      };
    },
    /** FNV-1a digest over the live SIM state (float-quantized so FP noise can't
     *  flip it; entity order-stable). The determinism backbone: same (seed, input
     *  tape, fixed dt) MUST yield the same simHash() sequence every frame. Excludes
     *  particles/telegraphs/decals (cosmetic, wall-clock/Math.random by design). The
     *  rng cursor is part of the state — a stream that advanced differently is a
     *  divergence even if positions momentarily match. */
    simHash(): string {
      let h = 0x811c9dc5 >>> 0;
      const mix = (n: number): void => {
        h ^= (Math.round((Number.isFinite(n) ? n : 0) * 1000) | 0) >>> 0;
        h = Math.imul(h, 0x01000193) >>> 0;
      };
      const mixS = (s: string): void => {
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
      };
      const p = ctx.player;
      // facing is DERIVED from camera+mouse (an aim projection), not authoritative
      // sim state — it's excluded so the hash reflects the sim's own determinism,
      // not camera-damping carry-over. Positions/hp/tempo/enemies/rng are the state.
      mix(p.pos.x); mix(p.pos.z); mix(p.hp); mix(ctx.tempo.value);
      // Lesser enemies only — the boss is hashed separately (below). Its `t` AI-phase
      // seed is set at spawn from ctx.rng, so a boss staged before a mid-run reseed
      // carries a stale t that isn't part of the state under test; its position/hp/
      // phase (which its t drives) ARE hashed, so a real boss divergence still shows.
      const foes = ctx.enemies.living().filter((e) => e.kind !== "boss")
        .sort((a, b) => a.pos.x - b.pos.x || a.pos.z - b.pos.z);
      for (const e of foes) { mixS(e.kind); mix(e.pos.x); mix(e.pos.z); mix(e.hp); mix((e as unknown as { t: number }).t); }
      const b = livingBoss();
      if (b) { mix((b as { phase?: number }).phase ?? 1); mix(b.pos.x); mix(b.pos.z); mix(b.hp); }
      mix(ctx.rng.getState());
      return (h >>> 0).toString(16);
    },
    /** Read/restore the sim RNG cursor (the determinism harness + a future
     *  serialize/restore snapshot it). */
    rngState(): number { return ctx.rng.getState(); },
    setRngState(s: number): void { ctx.rng.setState(s); },
    /** Training-Grounds FSM introspection for the tutorial-correctness oracle:
     *  which step, what verb it teaches, the taught-so-far set, whether it's done,
     *  and the current on-screen objective. `inTutorial` distinguishes the training
     *  session from a real run. */
    tutorial(): { inTutorial: boolean; active: boolean; step: number; verb: string; taught: string[]; done: boolean; objective: string } {
      return {
        inTutorial, active: tutorial.active, step: tutorial.currentStep,
        verb: tutorial.verb, taught: tutorial.taughtSoFar, done: tutorial.done,
        objective: tutorial.objective,
      };
    },
    /** The recognized scenario name patterns. */
    list(): string[] {
      return [
        "boss:<warden|spire|colossus|tyrant|unmaker|echo>[:p2|p3|p4]",
        "enemy:<husk|spitter|swarmer|bomber|sentinel|wisp|leaper|tether|mirror|caster|shade|bastion|brute|harrier|splitter|voidling|warper>",
        "room:<combat|elite|shop|treasure|rest|event>",
        "menu", "victory", "death",
      ];
    },
  };
  w.__rh3debug = debug;
}
