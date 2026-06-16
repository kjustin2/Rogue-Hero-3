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
import { Arena, THEMES } from "./render/arena";
import { Input } from "./core/input";
import { EventBus } from "./core/events";
import { Rng } from "./core/rng";
import { Sfx } from "./audio/sfx";
import { Music } from "./audio/music";
import { Player } from "./game/player";
import { Controller } from "./game/controller";
import { Tempo } from "./game/tempo";
import { Overdrive } from "./game/overdrive";
import { Combat } from "./game/combat";
import { Projectiles, HostileProjectiles } from "./game/projectiles";
import { EnemyManager } from "./game/enemies";
import "./game/enemies2"; // registers the Act II/III roster
import { ROMAN } from "./game/run";
import { Relics } from "./game/relics";
import { Profile, loadRunSave, writeRunSave, clearRunSave, recordDailyBest, dailySeed, type RunSave, type UnlockedItem } from "./game/profile";
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
ctx.sfx = new Sfx(ctx.events);
ctx.music = new Music();
ctx.stats = freshStats();
ctx.playing = false;
ctx.tempo = new Tempo(ctx.events);
ctx.overdrive = new Overdrive(ctx);
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

// Run seeding: daily/seeded runs reproduce; normal runs reseed randomly each start.
let nextRunSeed: number | null = null;
let nextRunDaily = false;
let nextRunDepth = 0;
let nextBlessing: string | null = null;
let currentRunDaily = false;
let currentSeed = 0;
let currentDepth = 0;

const menus = new Menus(ctx, {
  onStartRun: (hero, depth, blessing) => { nextRunDepth = depth; nextBlessing = blessing || null; startRun(hero); },
  onNewRun: () => { nextRunSeed = null; nextRunDaily = false; menus.showHeroSelect(); },
  onDaily: () => { nextRunSeed = dailySeed(); nextRunDaily = true; menus.showHeroSelect(); },
  onTutorial: startTutorial,
  onContinueRun: continueRun,
  onResume: resume,
  onAbandon: abandonRun,
  onExitRun: () => { if (!inTutorial) checkpoint(); toMenu(); },
  onRetry: () => { nextRunSeed = null; nextRunDaily = false; nextRunDepth = currentDepth; startRun(ctx.player.hero); },
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
  ctx.overdrive.reset();
  ctx.deck.resetForRun();
  ctx.relics.resetForRun();
  ctx.profile.beginRun();
  inTutorial = false;
  lastActStory = 1;
  musicLament = false;
  unmakerFading = false;
  spareHold = 0;
  chosenMercy = false;
  ascendantRank = 0;
  ctx.combat.runRankMult = 1;

  if (resume) {
    currentRunDaily = false; // resumed runs aren't tracked as daily attempts
    currentSeed = resume.seed;
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
    return;
  }

  clearRunSave();
  // Seed + depth: daily/seeded reproduces, normal runs get a fresh random stream
  currentSeed = nextRunSeed ?? (Date.now() >>> 0);
  currentDepth = Math.min(nextRunDepth, ctx.profile.data.maxDepth);
  currentRunDaily = nextRunDaily;
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
  ctx.cam.mode = "menu";
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
}

/**
 * Between-acts cutscene: clear the field, crossfade to the new act's look, orbit
 * the lone hero under drifting embers, and rise the story over a letterboxed
 * frame — then hand off to load the act's first chamber.
 */
function playActTransition(node: { act: number; actName: string; theme: keyof typeof THEMES }, onDone: () => void): void {
  state = "cutscene";
  ctx.input.enabled = false;
  hud.setVisible(false);
  ctx.music.duckTo(0.7);
  ctx.music.map();
  ctx.enemies.clear();
  ctx.projectiles.clear();
  ctx.hostiles.clear();
  ctx.caster.clear();
  ctx.arena.setObstacles([], 0);
  const theme = THEMES[node.theme];
  ctx.arena.applyTheme(theme);
  ctx.fx.ambientColor = theme.ember;
  ctx.fx.ambientRate = 16;
  ctx.cam.mode = "menu";
  ctx.player.pos.set(0, 0, 6);
  ctx.player.facing = Math.PI;
  const emberFx = window.setInterval(() => {
    const a = Math.random() * Math.PI * 2;
    const r = 6 + Math.random() * 11;
    ctx.fx.burst({
      x: Math.sin(a) * r, y: 0.2, z: Math.cos(a) * r,
      count: 4, color: [theme.ember, theme.crystal], speed: [0.4, 2], up: 2.2, size: [0.25, 0.6], life: [0.9, 1.7], gravity: 0.3, drag: 1.1, jitter: 0.6,
    });
  }, 200);
  const lines = [`ACT ${ROMAN[node.act - 1] ?? node.act} · ${node.actName}`, ...(ACT_STORY[node.act] ?? [])];
  menus.storyIntro(lines, () => {
    window.clearInterval(emberFx);
    menus.clear();
    ctx.cam.mode = "follow";
    ctx.fx.ambientRate = 7;
    onDone();
  });
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
  inTutorial = true;
  currentRunDaily = false;
  ctx.stats = freshStats();
  const hero = heroById(ctx.profile.data.lastHero);
  ctx.player.applyHero(hero, ctx.profile.data.equipped.cape, ctx.profile.data.equipped.blade);
  ctx.player.alive = true;
  ctx.player.shield = 0;
  ctx.player.root.visible = true;
  ctx.tempo.reset();
  ctx.tempo.heroDecayMult = hero.tempoDecayMult;
  ctx.overdrive.reset();
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
    window.close();
  } catch { /* browser may block — fall through */ }
  // If the window didn't close (browser), at least return to the menu.
  toMenu();
}

function toMenu(): void {
  state = "menu";
  inTutorial = false;
  tutorial.stop();
  ctx.enemies.clear();
  ctx.projectiles.clear();
  ctx.hostiles.clear();
  ctx.caster.clear();
  ctx.features.clear();
  ctx.player.root.visible = false;
  ctx.cam.mode = "menu";
  ctx.arena.applyTheme(THEMES.rift);
  ctx.fx.ambientColor = THEMES.rift.ember;
  ctx.fx.ambientRate = 6;
  hud.setVisible(false);
  menus.showMain();
  musicLament = false;
  ctx.music.duckTo(1);
  ctx.music.menu();
}

function pause(): void {
  if (state !== "playing") return;
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

ctx.events.on("OVERDRIVE_START", ({ name }) => {
  hud.banner(name, "OVERDRIVE", "banner--boss");
  hud.flash("#ffe066", 0.4);
  ctx.sfx.overdrive();
});

// Tempo stinger: a bright rising triad the moment you reach the Critical zone.
ctx.events.on("TEMPO_ZONE", ({ zone, prev }) => {
  if (zone === "critical" && prev !== "critical") ctx.sfx.critical();
});

ctx.events.on("ROOM_CLEARED", ({ reward }) => {
  hud.fadeHints();
  awardShards(6);
  // After a boss, hold so the epitaph banner ("THE WARDEN FALLS") can be read —
  // long enough to read, short enough that it never feels like the game hung.
  const rewardDelay = ctx.run.currentNode?.bossKind ? 4600 : 1500;
  window.setTimeout(() => {
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

  // Victory detonation — the warden bursts apart in escalating stages.
  const dx = x - ctx.player.pos.x;
  const dz = z - ctx.player.pos.z;
  const len = Math.hypot(dx, dz) || 1;
  ctx.sfx.bossDeath();
  ctx.cam.kick(dx / len, dz / len, 6);
  ctx.cam.addTrauma(0.7);
  ctx.cam.pulseFov(1);
  ctx.stage.punch(0.7);
  ctx.fx.ring(x, z, { radius: 5, color: 0xffd27a, duration: 0.5 });
  const boom = (delay: number, r: number, n: number, col: number): void => {
    cutsceneTimers.push(window.setTimeout(() => {
      ctx.fx.ring(x, z, { radius: r, color: col, duration: 0.5 });
      ctx.fx.ring(x, z, { radius: r * 0.5, color: 0xffffff, duration: 0.35 });
      ctx.fx.burst({ x, y: 1, z, count: n, color: [col, 0xffffff], speed: [4, 16], up: 0.9, size: [0.5, 1.3], life: [0.3, 0.9], gravity: -4, drag: 2 });
      ctx.cam.addTrauma(0.3);
    }, delay));
  };
  boom(130, 4, 40, 0xff8a4d);
  boom(330, 7, 55, 0xffd27a);
  boom(580, 10, 50, 0xffffff);
  // Mid-run wardens get an epitaph as the dust settles, and you carry away their boon.
  const kind = node?.bossKind;
  if (kind) ctx.relics.grantBoon(kind);
  if (kind && BOSS_EPITAPHS[kind] && ctx.run.position < ctx.run.totalForks - 1) {
    const [title, sub] = BOSS_EPITAPHS[kind];
    window.setTimeout(() => {
      if (state === "playing") hud.banner(title, sub, "banner--clear banner--long");
    }, 1100);
  }
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
  ctx.overdrive.reset();
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

type BossOmen = "claws" | "mirrors" | "fists" | "reactor" | "star" | "echoes";
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
    { at: 180, type: "camera", zoom: cfg.zoom * 0.68, zOff: -0.25 },
    { at: 300, type: "sound", cue: "intro" },
    { at: 360, type: "prop", omen: cfg.omen },
    { at: 500, type: "ring", radius: 15, color: "c1", duration: 0.5, startRadius: 18 },
    { at: 620, type: "ring", radius: 4, color: "c1", duration: 0.85 },
    { at: 860, type: "ring", radius: 11, color: "c1", duration: 0.5, startRadius: 14 },
    { at: 900, type: "camera", zoom: cfg.zoom },
    { at: 1180, type: "ring", radius: 7.5, color: "c2", duration: 0.45, startRadius: 10 },
    { at: 1200, type: "burst", preset: "summon" },
    { at: 1520, type: "ring", radius: 4.5, color: "c2", duration: 0.4, startRadius: 6.5 },
    { at: 1700, type: "burst", preset: cfg.quiet ? "starfall" : "pillar" },
    { at: 1900, type: "camera", zoom: cfg.zoom * 1.12 },
    { at: 1920, type: "ring", radius: 6.5, color: "c2", duration: 0.7 },
    { at: 1930, type: "burst", preset: kind === "spire" || kind === "echo" ? "shards" : cfg.seismic ? "seismic" : "summon" },
    { at: 2550, type: "reveal", name, title },
  ];

  if (kind === "warden") {
    beats.push(
      { at: 2860, type: "prop", omen: "claws" },
      { at: 3180, type: "ring", radius: 9, color: "c2", duration: 0.5 },
      { at: 3600, type: "ring", radius: 12, color: "c1", duration: 0.5 },
    );
  } else if (kind === "spire") {
    beats.push(
      { at: 2850, type: "prop", omen: "mirrors" },
      { at: 3040, type: "burst", preset: "shards" },
      { at: 3440, type: "ring", radius: 12, color: "c2", duration: 0.55 },
    );
  } else if (cfg.seismic) {
    beats.push(
      { at: 3050, type: "pulse", trauma: 0.5, punch: 0.35 },
      { at: 3150, type: "ring", radius: 8.5, color: "c1", duration: 0.55 },
      { at: 3550, type: "pulse", trauma: 0.35 },
      { at: 3570, type: "ring", radius: 12, color: "c2", duration: 0.5 },
      { at: 3850, type: "burst", preset: "seismic" },
    );
  } else if (kind === "unmaker") {
    beats.push(
      { at: 2920, type: "prop", omen: "star" },
      { at: 3150, type: "flash", color: "#ffffff", intensity: 0.24 },
      { at: 3480, type: "ring", radius: 11, color: "white", duration: 0.75 },
      { at: 3820, type: "burst", preset: "starfall" },
    );
  } else if (cfg.tear) {
    beats.push(
      { at: 3050, type: "flash", color: "#ffffff", intensity: 0.38 },
      { at: 3050, type: "ring", radius: 12, color: "phase", duration: 0.6 },
      { at: 3450, type: "ring", radius: 14, color: "white", duration: 0.5 },
      { at: 3800, type: "burst", preset: "tear" },
    );
  }

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

  for (const beat of buildBossIntroBeats(kind, cfg, name, title)) {
    queueBeat(beat.at, () => runBossBeat(beat, cfg, bx, bz));
  }
  queueBeat(cfg.quiet ? 4800 : 4500, () => finishCutscene());
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
  cutsceneSkipReadyTs = performance.now() + (phase >= 4 ? 1100 : 500);
  state = "cutscene";
  ctx.input.enabled = false;
  hud.setLetterbox(true);

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
    cutsceneTimers.push(window.setTimeout(() => finishCutscene(), 3800));
  } else {
    ctx.music.duckTo(0.5);
    ctx.cam.cinematic(boss.pos.x, boss.pos.z, cfg.seismic ? 0.58 : 0.7);
    ctx.sfx.bossRoar();
    ctx.cam.addTrauma(cfg.seismic ? 0.68 : 0.5);
    ctx.stage.punch(cfg.seismic ? 0.5 : 0.4);
    ctx.cam.pulseFov(1);
    hud.flash(cfg.phaseHex || (PHASE_FLASH[Math.min(phase, PHASE_FLASH.length - 1)] ?? "#ff7a4a"), 0.45);
    hud.banner(line, `PHASE ${phase}`, `banner--boss banner--long banner--cutscene ${cfg.bannerClass}`);
    addBossOmen(cfg.omen, cfg, boss.pos.x, boss.pos.z, phase);
    ctx.fx.ring(boss.pos.x, boss.pos.z, { radius: 5, color: cfg.phaseColor, duration: 0.7 });
    ctx.fx.ring(boss.pos.x, boss.pos.z, { radius: 3.1, color: 0xffffff, duration: 0.45 });
    bossBurst(cfg.seismic ? "seismic" : cfg.tear ? "tear" : kind === "spire" ? "shards" : "summon", cfg, boss.pos.x, boss.pos.z);
    cutsceneTimers.push(window.setTimeout(() => finishCutscene(), 2900));
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
  if (currentRunDaily) recordDailyBest(currentSeed, ctx.stats.kills, ctx.stats.time, true);
  const unlocks = ctx.profile.recordRun("victory", ctx.stats);
  // Let the collapse settle, then the bittersweet ending plays into the end screen.
  window.setTimeout(() => playEnding(unlocks), 2800);
});

/** The denouement: a letterboxed story (bittersweet, or hopeful if you showed mercy), then the end screen. */
function playEnding(unlocks: UnlockedItem[]): void {
  state = "cutscene";
  ctx.input.enabled = false;
  hud.setVisible(false);
  ctx.cam.mode = "menu";
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
  ctx.music.silence();
  ctx.cam.addTrauma(0.7);
  ctx.stage.punch(1);
  ctx.sfx.defeat();
  clearRunSave();
  if (currentRunDaily) recordDailyBest(currentSeed, ctx.stats.kills, ctx.stats.time, false);
  const unlocks = ctx.profile.recordRun("death", ctx.stats);
  window.setTimeout(() => {
    state = "dead";
    ctx.cam.mode = "menu";
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
let last = performance.now();
const trailTip = new THREE.Vector3();
const trailBase = new THREE.Vector3();

ctx.stage.renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

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
    ctx.overdrive.update(dt);
    ctx.deck.update(dt);
    ctx.caster.update(dt);
    ctx.enemies.update(dt);
    ctx.projectiles.update(dt);
    ctx.hostiles.update(dt);
    ctx.features.update(dt);
    ctx.run.update();
    ctx.player.update(dt);
    // Sword ribbon while the blade is actually moving (chain or card swings)
    ctx.player.getBladePoints(trailTip, trailBase);
    ctx.trail.setColor(ctx.player.bladeColor);
    ctx.trail.update(dt, trailTip, trailBase, ctx.combat.swinging || ctx.caster.swinging);
    if (inTutorial) tutorial.update(dt);
    // Mercy: while the Hollow Star fades, holding Overdrive [Q] spares it instead of killing it.
    if (unmakerFading && !chosenMercy) {
      if (ctx.input.actionDown("overdrive")) {
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

  ctx.arena.update(dt);
  ctx.fx.update(dt);
  ctx.tele.update(dt);
  ctx.cam.update(dt);
  ctx.stage.update(dt);
  ctx.stage.render(dt);
  ctx.input.endFrame();
});

// Pre-compile all pooled combat shaders AND every roster enemy's materials so the
// first boss shot / cast / enemy spawn never stalls on a real GPU.
ctx.enemies.precompile();

// Boot into the menu
toMenu();

// Debug/automation hook. Exposed in BOTH dev and production builds so the
// real-runtime Electron smoke (scripts/smoke-electron.cjs) can drive the
// shipped bundle, exactly as Wall-of-Dead exposes window.__wod. Harmless for an
// offline single-player game; nothing reads it unless a test reaches for it.
{
  const w = window as unknown as Record<string, unknown>;
  w.__rh3 = ctx;
  w.__rh3gen = { generatePlan, difficultyFor, MAX_DEPTH };
  w.__rh3cards = CARDS;
  w.__rh3heroes = HEROES;
  w.__rh3menus = menus;
}
