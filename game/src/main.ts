import "@fontsource/cinzel/600.css";
import "@fontsource/cinzel/700.css";
import "@fontsource/rajdhani/500.css";
import "@fontsource/rajdhani/600.css";
import "@fontsource/rajdhani/700.css";
import "./style.css";

import * as THREE from "three";
import { Stage } from "./render/stage";
import { CameraRig } from "./render/cameraRig";
import { Particles, ParticleShape } from "./render/particles";
import { SwordTrail } from "./render/trail";
import { Telegraphs } from "./render/telegraphs";
import { Floaters } from "./render/floaters";
import { Arena, ARENA_RADIUS, THEMES } from "./render/arena";
import { ContactShadows, type ShadowActor } from "./render/contactShadow";
import { Decals } from "./render/decals";
import { Input } from "./core/input";
import { EventBus } from "./core/events";
import { Rng } from "./core/rng";
import { Sfx } from "./audio/sfx";
import { Music } from "./audio/music";
import { Player } from "./game/player";
import { Controller } from "./game/controller";
import { Tempo, CRASH_THRESHOLD } from "./game/tempo";
import { Combat } from "./game/combat";
import { Projectiles, HostileProjectiles } from "./game/projectiles";
import { EnemyManager } from "./game/enemies";
import "./game/enemies2"; // registers the Act II/III roster
import { ROMAN } from "./game/run";
import { Relics } from "./game/relics";
import { Profile, loadRunSave, writeRunSave, clearRunSave, type RunSave, type UnlockedItem } from "./game/profile";
import { heroById, type HeroDef } from "./game/heroes";
import { cardById } from "./game/cards";
import { Deck } from "./game/deck";
import { CardCaster } from "./game/cards";
import { RunManager } from "./game/run";
import { MapFeatures } from "./game/features";
import { Hud } from "./ui/hud";
import { Menus, storyDwellMs } from "./ui/menus";
import { MenuNav } from "./ui/menuNav";
import { Tutorial } from "./game/tutorial";
import { generatePlan } from "./game/mapgen";
import { difficultyFor } from "./game/difficulty";
import { freshStats, type Ctx } from "./game/ctx";
import { PerfMonitor } from "./debug/perfMonitor";
import { VfxDirector } from "./presentation/vfxDirector";
import { CinematicDirector } from "./presentation/cinematicDirector";
import type { CinematicBeat, CinematicSequence } from "./presentation/types";
import { ATTACK_ELEMENT, ATTACK_PRESENTATION, BOSS_ATTACK_FAMILY, HERO_PRESENTATION } from "./presentation/profiles";

type GameState = "menu" | "playing" | "paused" | "draft" | "cutscene" | "dead" | "victory";

const STORY_LINES = [
  "At the Basilica gate, you find a grave wearing your name. The date is a century old.",
  "You remember a woman's hands fixing three ivory leaves to your collar. You cannot remember her face.",
  "Below, the Rift still burns. The wardens kept its light alive. One of them may remember who you were.",
];

/** Story beats shown as a short cutscene when you cross into a new act (2–5). */
const ACT_STORY: Record<number, string[]> = {
  2: [
    "The Pit Warden recognizes your three ivory leaves. 'She made you promise to come home.'",
    "Behind its gate lie burial registers. Beside your name, in a hundred different hands: RETURNED.",
    "The Shattered Spire kept the kingdom's memories in glass. You climb to ask what the registers cannot tell you.",
  ],
  3: [
    "In the Regent's broken glass, the woman finishes your cloak. Then she grows old. You do not.",
    "The star returns its sworn dead, but each return costs a memory. You have paid away almost everyone you loved.",
    "Below, the foundry still feeds the star. You follow the chains to learn what keeps the rest of the kingdom alive.",
  ],
  4: [
    "Inside the Colossus, no furnace burns. Thousands of little names turn on brass wheels: the kingdom's gifts, its cures, its impossible harvests.",
    "Break the star and the returning dead will rest. So will every miracle the living depend on.",
    "Across the Sundered Abyss, the Tyrant has laid its crown beside the switch. It has waited a century for someone else to choose.",
  ],
  5: [
    "The Tyrant opens its empty hands. 'I ordered the first return. I called it mercy.'",
    "At the final altar, the Hollow Star speaks with a voice you almost know. It learned to speak from everything you gave it.",
    "The blade can end the bargain. Your empty hand may change it. First, survive the last light's fear of being alone.",
  ],
};
/** Highest act whose transition story has already played this run (1 = opening covers act 1). */
let lastActStory = 1;
let openingWalk = false;

/** The bittersweet payoff after the Hollow Star falls — saved the world, and dimmed it. */
const ENDING_LINES = [
  "The Hollow Star is gone. The Rift folds shut behind it, quiet at last.",
  "You have done it. The dark will not spread again. The world is saved.",
  "But the light that fell a hundred years ago — the light that became your every gift — goes out with the star.",
  "Far above, a kingdom wakes to a grey and silent dawn. Safe. Ordinary. A little smaller than it was.",
  "Mara. Her name returns before her face. At the Basilica gate, you turn your own gravestone toward the dawn. This time, the life ahead is the only one you have.",
];

/** The mercy ending — spare the Hollow Star and carry its ember home. */
const MERCY_ENDING_LINES = [
  "You lower your blade. The Hollow Star, braced for an ending, finds none.",
  "It does not understand mercy. Neither, quite, do you — only that some lights are worth the dark they cost.",
  "You gather its last ember in your hands and carry it up, out of the Rift, into a world that will never know how close it came to going out.",
  "The Rift remains. So does the wonder. So does the danger. You chose to keep all of it.",
  "Mara. You speak her name into the ember before it can ask for another memory. Whatever bargain comes next, you will enter it remembering the price.",
];

const HERO_ENDING: Record<string, string> = {
  blade: "The Blade lowers a sword that was never the whole answer, and walks on.",
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
  warden: ["THE PIT WARDEN WEEPS", "“She sewed those leaves for you. You never remember.”"],
  spire: ["THE GLASS REGENT FADES", "“We kept what you could no longer carry.”"],
  colossus: ["THE COLOSSUS RESTS", "HERE WE KEEP THE LAST WARMTH OF THE WORLD"],
  tyrant: ["THE ENGINE FALLS SILENT", "“Put out the star. We could not.”"],
  echo: ["THE ECHO LETS GO", "For a moment, the reflection is your own."],
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
ctx.vfx = new VfxDirector(ctx.stage.scene, ctx.fx);
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
const caPool: ShadowActor[] = Array.from({ length: CA_MAX }, () => ({ x: 0, z: 0, radius: 0.8, y: 0 }));
const caList: ShadowActor[] = [];
function updateContactShadows(): void {
  caList.length = 0;
  let i = 0;
  if (ctx.player.alive && ctx.player.root.visible && i < CA_MAX) {
    const o = caPool[i++]; o.x = ctx.player.pos.x; o.z = ctx.player.pos.z; o.radius = ctx.player.radius; o.y = ctx.player.root.position.y; o.feet = ctx.player.footContacts; caList.push(o);
  }
  for (const e of ctx.enemies.living()) {
    if (i >= CA_MAX) break;
    if (!e.root.visible) continue;
    const o = caPool[i++]; o.x = e.pos.x; o.z = e.pos.z; o.radius = (e.radius || 0.8); o.y = e.root.position.y; o.feet = e.footContacts; caList.push(o);
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
ctx.presentation = new CinematicDirector({
  run: (beat) => runSliceCinematicBeat(beat),
  finish: (_sequence, skipped) => finishCutscene(skipped),
});
let impactMotionThisFrame = 0;
ctx.events.on("IMPACT_CUE", (cue) => {
  ctx.vfx.impact(cue);
  if (cue.sustained && !cue.killed) return;
  const family = ATTACK_PRESENTATION[cue.attackFamily];
  const weight = (cue.strength === "light" ? 0.75 : cue.strength === "heavy" ? 1.25 : cue.strength === "critical" ? 1.65 : 2.15) * family.cameraWeight;
  const motion = menus.settings.reduceMotion ? 0.22 : 1;
  const allowed = Math.max(0, Math.min(weight, 1.8 - impactMotionThisFrame));
  impactMotionThisFrame += allowed;
  ctx.cam.kick(cue.dirX, cue.dirZ, allowed * motion);
  ctx.cam.addTrauma(allowed * .05 * motion);
  if (cue.strength !== "light") ctx.stage.punch(0.06 * allowed * motion);
});
const tutorial = new Tutorial(ctx, hud);
let state: GameState = "menu";
let inTutorial = false;
type CoachTopic = "tempo" | "perfect-dodge" | "shield" | "draft" | "relic" | "shop" | "hone";
const coached = new Set<CoachTopic>();
const coach = (topic: CoachTopic, title: string, body: string): void => {
  if (coached.has(topic) || inTutorial || state === "cutscene" || state === "dead" || state === "victory") return;
  coached.add(topic);
  hud.showCoach(title, body);
};
ctx.events.on("TEMPO_ZONE", ({ zone }) => {
  if (zone !== "cold") coach("tempo", "TEMPO", `Keep landing hits. Press ${ctx.input.label("crash")} at ${CRASH_THRESHOLD}+ to Crash. At 95+, the Crash is perfect.`);
});
ctx.events.on("PERFECT_DODGE", () => coach("perfect-dodge", "PERFECT DODGE", "Evade at the last instant: your next strike becomes a gold counter."));
ctx.events.on("SHIELD_GAINED", () => coach("shield", "BARRIER", "Barrier absorbs incoming damage before your health."));
ctx.events.on("DRAFT_OPEN", () => coach("draft", "DRAFT", "Choose one card for this run. Its slot becomes a new combat action."));
ctx.events.on("RELIC_ADDED", () => coach("relic", "RELIC", "Relics reshape this run and remain active until it ends."));
ctx.events.on("COACH_TRIGGER", ({ topic }) => {
  if (topic === "shop") coach("shop", "RIFT MERCHANT", "Spend shards on immediate strength, or leave with them banked for later.");
  else coach("hone", "HONING", "Hone a held card once to strengthen its effect for the rest of this run.");
});
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
  onNewRun: () => { menus.showRunSetup(); },
  onTutorial: startTutorial,
  onContinueRun: continueRun,
  onResume: resume,
  onAbandon: abandonRun,
  // Combat actors are not serialized. Preserve the complete boundary snapshot;
  // saving only current HP/loot here would replay a room with half-mutated state.
  onExitRun: toMenu,
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

// Prime shared card and trail materials once, under the loader. Enemies and
// bosses compile as they enter; no invisible duplicate roster lives in the scene.
function warmCombatShaders(): void { ctx.caster.precompile(); }

// ---------------------------------------------------------------- state flow
interface SceneBeat { remaining: number; run: () => void; }
const sceneBeats: SceneBeat[] = [];
function afterScene(run: () => void, milliseconds: number): void {
  sceneBeats.push({ remaining: milliseconds / 1000, run });
}
function updateSceneBeats(dt: number): void {
  for (const beat of sceneBeats) beat.remaining -= dt;
  while (true) {
    const index = sceneBeats.findIndex(beat => beat.remaining <= 0);
    if (index < 0) break;
    const [beat] = sceneBeats.splice(index, 1);
    beat.run();
  }
}

function startRun(hero: HeroDef, resume?: RunSave): void {
  resetPresentation();
  sceneBeats.length = 0;
  menus.clear();
  ctx.sfx.stopAmbient();
  ctx.stats = resume ? resume.stats : freshStats();
  ctx.player.applyHero(hero, ctx.profile.data.equipped.cape, ctx.profile.data.equipped.blade);
  ctx.player.setVictoryPose(false);
  ctx.profile.setLastHero(hero.id);
  ctx.player.alive = true;
  ctx.player.shield = 0;
  ctx.player.root.visible = true;
  ctx.tempo.reset();
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
    // Continue the checkpoint's stream; legacy saves fall back to their seed.
    ctx.rng.reseed(resume.rngState ?? resume.seed);
    currentDepth = resume.depth;
    ctx.stats.depth = resume.depth;
    ctx.difficulty = difficultyFor(resume.depth);
    ctx.tempo.drainMult = ctx.difficulty.tempoDrainMult;
    ctx.run.restore(resume.plan ?? generatePlan(resume.seed, resume.depth), resume.position, resume.path);
    lastActStory = ctx.run.forkOptions()[0]?.act ?? 1; // don't replay the act we're resuming into
    resume.slots.forEach((id, i) => (ctx.deck.slots[i] = id ? cardById(id) : null));
    ctx.deck.upgraded = resume.upgraded ? resume.upgraded.slice() : [false, false, false];
    ctx.relics.restore(resume.relics, resume.relicState);
    ctx.deck.restoreCastCount(resume.castCount);
    if (resume.tempo) ctx.tempo.restore(resume.tempo);
    // Both earned vitality and shrine sacrifices persist across checkpoints.
    if (resume.maxHp) ctx.player.maxHp = resume.maxHp;
    ctx.player.hp = Math.max(1, Math.min(ctx.player.maxHp, resume.hp));
    hud.buildPips(ctx.run.plan);
    ctx.cam.mode = "follow";
    hud.setVisible(true);
    presentFork();
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
  // Optional run-start blessing, applied before HP is topped off.
  // Guarded: blessings are unlocked through play, so an un-earned one is ignored.
  if (nextBlessing && ctx.profile.isUnlocked(`blessing:${nextBlessing}`)) {
    if (nextBlessing === "vigor") ctx.player.maxHp += 25;
    else if (nextBlessing === "fortune") awardShards(120);
    else if (nextBlessing === "arsenal") { const r = ctx.relics.draftChoices()[0]; if (r) ctx.relics.add(r); }
  }
  nextBlessing = null;
  ctx.player.hp = ctx.player.maxHp;
  checkpoint(); // save the healed, fully initialized run
  // Opening story over an emptied arena; the first node loads after
  ctx.enemies.clear();
  ctx.projectiles.clear();
  ctx.hostiles.clear();
  ctx.caster.clear();
  ctx.fx.clear();
  ctx.vfx.clear();
  ctx.arena.setObstacles([], 0);
  ctx.player.pos.set(0, 0, 6);
  ctx.player.facing = Math.PI;
  openingWalk = true;
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
  stormEmitter = { t: 0, every: 0.2, fn: () => {
    const a = Math.random() * Math.PI * 2; // cosmetic: ember placement
    const r = 6 + Math.random() * 11;      // cosmetic:
    ctx.fx.burst({
      x: Math.sin(a) * r, y: 0.2, z: Math.cos(a) * r,
      count: 4, color: [0xff7733, 0x55ccff], speed: [0.4, 2], up: 2.4, size: [0.25, 0.6], life: [0.9, 1.7], gravity: 0.3, drag: 1.1, jitter: 0.6,
    });
  } };
  const introShots = [
    { x: 0, z: -12, zoom: 0.9, preset: "wide" as const, composition: "courtyard" as const },
    { x: 0, z: -7, zoom: 0.67, preset: "threat" as const, composition: "reliquary" as const },
    { x: ctx.player.pos.x, z: ctx.player.pos.z, zoom: 0.7, preset: "hero" as const, composition: "nave" as const },
  ];
  menus.storyIntro(STORY_LINES, () => {
    stormEmitter = null;
    openingWalk = false;
    ctx.player.cinematicGuard = false;
    ctx.player.animMoveAmount = 0;
    menus.clear();
    ctx.cam.mode = "follow";
    ctx.fx.ambientRate = 7;
    hud.setVisible(true);
    presentFork();
  }, 0, 0, (idx) => {
    const shot = introShots[Math.min(idx, introShots.length - 1)];
    ctx.arena.setBasilicaComposition("courtyard");
    ctx.cam.cinematicShot(ctx.player.pos.x, ctx.player.pos.z - 1.5, shot.zoom, shot.preset, 0.75, "smooth");
  });
}

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
  /** Story/release/soft-lock beats, timed on the interlude's OWN clock. */
  schedule: InterludeBeat[];
  skipBtn: HTMLElement;
  hint: HTMLElement;
  caption: HTMLElement;
  onDone: () => void;
  onAdvance: (e: Event) => void;
  t: number;
  /** The hero walks the causeway automatically while its story is playing. */
  locked: boolean;
} | null = null;

/** One scheduled interlude beat, on the interlude's own clock (seconds). */
interface InterludeBeat {
  at: number;
  /** A story-banner beat: dropped when the player skips the words. */
  word: boolean;
  fn: () => void;
}

/** Skip the remaining story banners and release the hero to the choice (click / key
 *  during the words, or the release timer firing). Does NOT skip the whole interlude —
 *  the player still walks into a light for its boon. */
function releaseInterludeWords(): void {
  if (!interlude || !interlude.locked) return;
  // Drop the remaining word beats, and rebase the soft-lock auto-cross so that
  // skipping the story still leaves a full 45s to walk into a light.
  interlude.schedule = interlude.schedule.filter((b) => !b.word);
  for (const b of interlude.schedule) b.at = interlude.t + 45;
  interlude.locked = false;
  interlude.hint.remove();
  interlude.caption.remove();
  ctx.player.animMoveAmount = 0;
  hud.setLetterbox(false);
  hud.setCinematic(false);
  for (const pad of interlude.pads) pad.badge.style.visibility = "visible";
  ctx.sfx.cardReady();
  ctx.cam.mode = "follow";
  ctx.cam.snapTo(ctx.player.pos.x, ctx.player.pos.z);
  hud.banner("STEP INTO A LIGHT", "", "banner--clear");
  for (const pad of interlude.pads) ctx.fx.ring(pad.x, pad.z, { radius: 2.0, color: pad.color, duration: 0.6 });
}

/** Tear the interlude scene down. `chosen` applies that pad's boon; null = skipped. */
function finishInterlude(chosen: "mend" | "shards" | null, proceed = true): void {
  if (!interlude) return;
  const it = interlude;
  interlude = null;
  ctx.input.enabled = true; // the words-lock may have disabled it; the next node needs movement
  it.skipBtn.remove();
  it.hint.remove();
  it.caption.remove();
  ctx.player.animMoveAmount = 0;
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
  hud.setCinematic(false);
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
  // Story beats run on THIS clock, which only advances while the game is actually
  // playing. On wall-clock timers the act's words played out behind the pause
  // menu, and the 45s soft-lock guard could cross the causeway -- silently
  // forfeiting the boon -- while the player sat in the pause screen.
  while (it.schedule.length && it.schedule[0].at <= it.t) {
    it.schedule.shift()!.fn();
    if (interlude !== it) return; // a beat tore the interlude down
  }
  positionInterludeBadges();
  // Keep the authored walk in control through pause/resume; the gifts become
  // interactive when the words finish or the player skips ahead.
  if (it.locked) {
    ctx.input.enabled = false;
    const step = Math.min(Math.max(0, ctx.player.pos.z + 8), dt * 1.3);
    ctx.player.pos.z -= step;
    ctx.player.facing = Math.PI;
    ctx.player.animMoveAmount = step > 0 ? 0.3 : 0;
    ctx.player.animMoveZ = step > 0 ? 1 : 0;
    ctx.cam.trackCinematic(0, ctx.player.pos.z - 1.5);
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
  menus.clear();
  hud.clearBanner();
  // Warm only the roster the player is about to meet, behind this authored
  // transition. First boot remains bounded to Act I instead of compiling the
  // entire five-act game before the main menu appears.
  state = "playing"; // a real playable beat — the hero walks the causeway
  ctx.input.enabled = false;
  hud.setVisible(true);
  hud.setLetterbox(true);
  hud.setCinematic(true);
  ctx.music.duckTo(0.7);
  ctx.music.map();
  ctx.enemies.clear();
  ctx.projectiles.clear();
  ctx.hostiles.clear();
  ctx.caster.clear();
  ctx.features.clear();
  const theme = THEMES[node.theme];
  ctx.arena.applyTheme(theme);
  ctx.arena.setActComposition(node.act, "noncombat");
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
    el.style.cssText = `position:fixed;transform:translate(-50%,-50%);pointer-events:none;z-index:29;text-align:center;white-space:nowrap;font-family:var(--font-display,'Cinzel',serif);`;
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
  hint.style.cssText = `position:fixed;left:50%;bottom:5%;transform:translateX(-50%);z-index:29;pointer-events:none;color:rgba(223,232,255,0.72);font-size:12px;letter-spacing:2px;text-shadow:0 1px 4px #000;`;
  hint.textContent = "click / space to skip the words ▸";
  document.body.appendChild(hint);
  const caption = document.createElement("div");
  caption.className = "interlude-caption";
  document.body.appendChild(caption);
  for (const pad of pads) pad.badge.style.visibility = "hidden";
  const onAdvance = (e: Event): void => {
    if (!interlude || !interlude.locked) return;
    if (state !== "playing") return; // a click on the pause menu is not a skip
    if (e.target === skipBtn) return; // that button skips the whole beat
    if (e.type === "keydown" && !["Space", "Enter", "KeyE"].includes((e as KeyboardEvent).code)) return;
    releaseInterludeWords();
  };
  window.addEventListener("pointerdown", onAdvance);
  window.addEventListener("keydown", onAdvance);

  // The story drifts past as banners while the hero walks. Each beat is timed in
  // SECONDS on the interlude's own clock (see updateInterlude).
  const schedule: InterludeBeat[] = [];
  const lines = [...(ACT_STORY[node.act] ?? [])];
  const ACT_CARD_S = 2.8;
  const LAMENT_S = 4.2;   // .banner--lament animation duration
  schedule.push({ at: 0.5, word: true, fn: () => {
    ctx.cam.cinematicShot(0, ctx.player.pos.z - 1.5, 0.88, "wide", 0.75, "smooth");
    hud.banner(`ACT ${ROMAN[node.act - 1] ?? node.act}`, node.actName, "banner--long");
  } });
  // The act title card plays out IN FULL before the first line: it used to be cut
  // off at ~3.7s of its 5.6s animation by a fixed line start.
  let cursor = 0.5 + ACT_CARD_S;
  lines.forEach((line, i) => {
    const at = cursor;
    schedule.push({ at, word: true, fn: () => {
      hud.clearBanner();
      caption.textContent = line;
      caption.dataset.beat = String(i);

    } });
    // The project's dwell rule, from the same function storyIntro uses — a line is
    // never replaced before it can be read. A fixed gap cut off act lines of
    // 120-137 characters, which need ~9.5s.
    cursor += Math.max(LAMENT_S, storyDwellMs(line) / 1000);
  });
  const wordsEnd = lines.length ? cursor : 3.2;
  // Release the hero once the last word has come and gone (or a click gets there first).
  schedule.push({ at: wordsEnd, word: false, fn: () => releaseInterludeWords() });
  // Soft-lock guard: if nothing is chosen 45s AFTER the words, cross without a gift.
  schedule.push({ at: wordsEnd + 45, word: false, fn: () => finishInterlude(null) });

  interlude = { pads, group, schedule, skipBtn, hint, caption, onDone, onAdvance, t: 0, locked: true };
}

/** Present the current fork: a forced node auto-enters; a choice fork opens the map. */
function presentFork(): void {
  if (ctx.run.position >= ctx.run.totalForks) return; // run resolved (boss → victory)
  if (ctx.run.isChoice) {
    state = "draft";
    ctx.input.enabled = false;
    ctx.music.map();
    // A fork used to be a dead end for the Escape key: no back, no pause, no way
    // to reach Settings or quit without first committing to a node.
    menus.showMap(ctx.run.forkOptions(), ctx.run.position, ctx.run.totalForks, (i) => {
      menus.clear();
      ctx.run.select(i);
      enterCurrentNode();
    }, () => menus.showSettings(() => presentFork()));
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
        ctx.music.duckTo(1); // playActTransition ducks to 0.7 and nothing else restored it
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

/** Save point: written at each fork boundary, preserving the generated route. */
function checkpoint(): void {
  if (runResolved || woundActive) return; // run ended / past the Wound gate — never re-arm a save
  writeRunSave({
    v: 2,
    seed: currentSeed,
    plan: ctx.run.plan,
    depth: currentDepth,
    position: ctx.run.position,
    path: ctx.run.path.slice(),
    hero: ctx.player.hero.id,
    hp: ctx.player.hp,
    maxHp: ctx.player.maxHp,
    slots: ctx.deck.slots.map((s) => s?.id ?? null),
    upgraded: ctx.deck.upgraded.slice(),
    relics: ctx.relics.owned.map((r) => r.id),
    rngState: ctx.rng.state,
    castCount: ctx.deck.totalCasts,
    relicState: ctx.relics.snapshot(),
    tempo: ctx.tempo.snapshot(),
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
  resetPresentation();
  sceneBeats.length = 0;
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
  ctx.deck.resetForRun();
  ctx.relics.resetForRun();
  ctx.enemies.clear();
  ctx.projectiles.clear();
  ctx.hostiles.clear();
  ctx.caster.clear();
  ctx.fx.clear();
  ctx.vfx.clear();
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
  resetPresentation();
  sceneBeats.length = 0;
  openingWalk = false;
  ctx.player.cinematicGuard = false;
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
  ctx.fx.clear();
  ctx.vfx.clear();
  ctx.features.clear();
  ctx.arena.setObstacles([], 0); // don't leave the last fight's pillars on the menu backdrop
  // Quitting mid-swing must not freeze the menu hero mid-attack: drop any
  // in-flight swing/charge pose and its visuals before the orbit shot.
  ctx.combat.clearTransient();
  ctx.combat.clearSlashVisuals();
  ctx.controller.clearTransient();
  ctx.trail.clear();
  ctx.player.root.visible = true;
  ctx.player.pos.set(0, 0, 3.8);
  ctx.player.facing = Math.PI;
  ctx.player.root.position.set(ctx.player.pos.x, ctx.player.pos.y, ctx.player.pos.z);
  ctx.player.root.rotation.y = ctx.player.facing;
  ctx.cam.showcaseOrbit(ctx.player.pos.x, ctx.player.pos.z);
  ctx.arena.applyTheme(THEMES.rift);
  ctx.arena.criticalHeat = 0; // don't carry a mid-run Critical surge into the menu
  ctx.cam.snapTo(ctx.player.pos.x, ctx.player.pos.z);
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
    afterScene(() => resolveRoomReward(reward), 0);
  }
}

// In-run passive growth: the hero's passive sharpens at kill milestones (Ascendant ranks).
const ASCENDANT_THRESHOLDS = [35, 85, 150, 240];
let ascendantRank = 0;
ctx.events.on("KILL", ({ kind }) => {
  awardShards(1);
  // Bosses emit KILL before BOSS_DEFEATED. Bank their milestone and bounty now,
  // so the final victory record includes the last kill, reward and unlocks.
  if (kind === "boss" && ctx.run.currentNode?.bossKind) {
    ctx.profile.noteBossKill(ctx.run.currentNode.act, ctx.stats);
    awardShards(20);
    if (ctx.run.currentNode.bossKind === "wound") {
      ctx.profile.noteWoundKill();
      awardShards(150 + ctx.stats.depth * 25);
    }
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
  const theme = THEMES[ctx.run.currentNode?.theme ?? "rift"];
  for (const [i, radius] of [2.8, 5.6].entries()) afterScene(() => {
    ctx.fx.ring(ctx.player.pos.x, ctx.player.pos.z, { radius, color: theme.ember, duration: .5 });
  }, i * 120);
}

/** Let the body carry the defeat; one local release accents its settling weight. */
function playBossDeathBeat(kind: string | undefined, x: number, z: number): void {
  const cfg = BOSS_FX[kind ?? "warden"] ?? BOSS_FX.warden;
  const node = ctx.run.currentNode;
  ctx.sfx.bossDeath();
  ctx.cam.addTrauma(cfg.seismic ? .32 : .18);
  ctx.cam.pulseFov(.35);
  ctx.fx.directionalBurst({ x, y: .6, z, count: 12, color: [cfg.c1, cfg.c2], dirX: 0, dirY: 1, dirZ: 0,
    spread: 1.2, speed: [1, 4], size: [.1, .24], life: [.25, .6], gravity: -4, drag: 3, shape: ParticleShape.shard });
  afterScene(() => {
    if (ctx.run.currentNode !== node) return;
    const inward = kind === "tyrant" || kind === "echo" || kind === "wound";
    ctx.fx.ring(x, z, { radius: inward ? .2 : cfg.seismic ? 5.2 : 3.5, startRadius: inward ? 4 : .8, color: cfg.c2, duration: .55 });
    ctx.fx.burst({ x, y: .3, z, count: cfg.seismic ? 20 : 12, color: [cfg.c1, 0x80766c], speed: [1, 5], up: .45,
      size: [.1, .3], life: [.3, .65], gravity: -4, drag: 2.5, shape: ParticleShape.shard });
    if (cfg.seismic) ctx.cam.addTrauma(.16);
  }, 820);
}

/** An authored defeat shot uses the same skip/finalizer contract as an entrance. */
function playBossAftermath(kind: string, x: number, z: number): void {
  bossCutscene = true;
  cutsceneFreezeWorld = false; // dead rigs must finish their collapse
  state = "cutscene";
  ctx.input.enabled = false;
  hud.setCinematicSkip(true);
  ctx.music.duckTo(.4);
  const [title, subtitle] = BOSS_EPITAPHS[kind] ?? ["THE WARDEN FALLS", "The way opens."];
  // Damage callbacks may still be inside a sword/spell update. Clear its pose
  // on the next scene tick, after that update has returned.
  afterScene(() => {
    ctx.combat.clearTransient(); ctx.controller.clearTransient(); ctx.caster.clear();
    ctx.floaters.clear(); ctx.trail.clear();
    ctx.player.cinematicGuard = true;
    faceHeroToward(x, z);
  }, 0);
  ctx.presentation.play({
    id: "boss-death:" + kind, duration: 3.4,
    beats: [
      { at: 0, type: "letterbox", on: true },
      { at: 0, type: "hud", hidden: true },
      { at: 0, type: "camera", x, z, zoom: kind === "colossus" ? 1.12 : .88, preset: "threat", duration: .42, easing: "smooth" },
      { at: .65, type: "title", title, subtitle, className: "banner--clear banner--epitaph" },
      { at: 2.35, type: "camera", x: ctx.player.pos.x, z: ctx.player.pos.z, zoom: .85, preset: "handoff", duration: .55 },
      { at: 3.1, type: "letterbox", on: false },
    ],
    onFinish: () => {
      const reward = pendingRoomReward; pendingRoomReward = null;
      if (reward) resolveRoomReward(reward);
    },
  });
  window.addEventListener("pointerdown", skipCutscene);
  window.addEventListener("keydown", skipCutscene);
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
  if (ctx.run.currentNode?.bossKind) { pendingRoomReward = reward; return; }
  playRoomClearFloorBeat();
  afterScene(() => {
    resolveRoomReward(reward);
  }, 900);
});

ctx.events.on("BOSS_DEFEATED", ({ x, z }) => {
  // A boss dying mid-cutscene (debug kills, smoke tests) must not soft-lock
  finishCutscene();
  const node = ctx.run.currentNode;
  ctx.hostiles.clear();

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
    clearEmberAlly();
    playBossDeathBeat("wound", x, z);
    hud.banner("THE WOUND CLOSES", "the floor of the world is whole again", "banner--clear banner--epitaph");
    return;
  }

  // Mid-run wardens get a themed death beat, an epitaph, and a boon.
  const kind = node?.bossKind;
  playBossDeathBeat(kind, x, z);
  if (kind) ctx.relics.grantBoon(kind);
  if (kind && pendingRoomReward) playBossAftermath(kind, x, z);
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
  woundActive = true;
  ctx.enemies.clearNonBosses();
  ctx.hostiles.clear();
  ctx.projectiles.clear();
  clearRunSave();
  afterScene(() => {
    if (state !== "playing") return;
    bossCutscene = true;
    cutsceneFreezeWorld = true;
    state = "cutscene";
    ctx.input.enabled = false;
    ctx.player.cinematicGuard = true;
    hud.setCinematicSkip(true);
    const sealZ=-ARENA_RADIUS*.4;
    ctx.decals.crack(0, sealZ, 7);
    ctx.sfx.bossIntroSting();
    ctx.presentation.play({
      id: "story:wound", duration: 2.4,
      beats: [
        { at: 0, type: "letterbox", on: true },
        { at: 0, type: "hud", hidden: true },
        { at: 0, type: "camera", x: 0, z: sealZ, zoom: .88, preset: "threat", duration: .6 },
        { at: .12, type: "hero-reaction", x: 0, z: sealZ },
        { at: 0.2, type: "environment", dim: 0.35 },
        { at: 0.35, type: "title", title: "THE SEAL BENEATH THE STAR", subtitle: "The wardens held it shut. You broke the last lock.", className: "banner--phase-slice" },
      ],
      onFinish: () => {
        if (chosenMercy) { ctx.combat.emberRevive = true; spawnEmberAlly(); }
        ctx.run.loadWoundFight();
      },
    });
    window.addEventListener("pointerdown", skipCutscene);
    window.addEventListener("keydown", skipCutscene);
  }, 1500);
});

/** The final boss's quiet end: the star's light gathers, folds inward, and winks out. */
function playUnmakerCollapse(x: number, z: number): void {
  ctx.sfx.bossDeath();
  ctx.cam.cinematic(x, z, 0.7);
  ctx.cam.addTrauma(0.22);
  ctx.cam.pulseFov(0.4);
  // Converging rings — the light falls INWARD to a single point instead of bursting out.
  const ringIn = (delay: number, r: number, col: number): void => {
    afterScene(() => ctx.fx.ring(x, z, { radius: .15, startRadius: r, color: col, duration: 0.7 }), delay);
  };
  ringIn(60, 11, 0x6a78b0);
  ringIn(360, 7.5, 0x8a9ad0);
  ringIn(680, 4, 0xcbb6ff);
  ringIn(1000, 1.6, 0xffffff);
  // It gathers, holds... then a single soft outrush as it lets go of a hundred years.
  afterScene(() => {
    ctx.fx.ring(x, z, { radius: 6, color: 0xffffff, duration: 1.5 });
    ctx.fx.burst({ x, y: 2.2, z, count: 52, color: [0xcbb6ff, 0x8a9ad0, 0xffffff], speed: [1, 6], up: 1.2, size: [0.3, 0.9], life: [1.0, 2.0], gravity: 0.4, drag: 1.4 });
    ctx.cam.pulseFov(0.5);
    hud.flash("#e8e0ff", 0.45);
  }, 1300);
}

/** The spared star rekindles — warm light rises and gathers to the hero instead of dying. */
function playUnmakerRekindle(x: number, z: number): void {
  ctx.sfx.relicPickup();
  ctx.cam.cinematic(x, z, 0.72);
  ctx.cam.pulseFov(0.5);
  const warm = (delay: number, r: number, col: number): void => {
    afterScene(() => {
      ctx.fx.ring(x, z, { radius: r, color: col, duration: 0.9 });
      ctx.fx.burst({ x, y: 1.4, z, count: 22, color: [col, 0xffffff], speed: [0.6, 3], up: 3.2, size: [0.25, 0.7], life: [0.9, 1.9], gravity: 0.15, drag: 1.0, jitter: 0.5 });
    }, delay);
  };
  warm(40, 3, 0xffd27a);
  warm(420, 5.5, 0xffe8b0);
  warm(820, 8, 0xfff4d8);
  afterScene(() => { hud.flash("#ffe8b0", 0.4); ctx.cam.pulseFov(0.4); }, 1100);
}

ctx.events.on("ACT_START", ({ act, name }) => {
  // Acts 2+ already got a full title card during the causeway interlude --
  // announcing the same act again 30 seconds later read as a bug.
  if (act > 1 && act === lastActStory) return;
  menus.actIntro(`ACT ${ROMAN[act - 1]}`, name, ACT_FLAVOR[act - 1], true);
});

ctx.events.on("ROOM_START", ({ isBoss, act, elite }) => {
  // Transient combat state never carries across a room boundary.
  ctx.combat.clearTransient();
  ctx.controller.clearTransient();
  ctx.arena.setActComposition(
    act,
    isBoss ? "boss" : elite ? "elite" : "combat",
    isBoss ? ctx.run.currentNode?.bossKind : undefined,
  );
  if (isBoss) {
    ctx.sfx.bossIntroSting();
    ctx.music.boss(act);
  } else {
    ctx.music.combat(act, elite);
  }
});

// ---------------------------------------------------------------- boss cutscene
let bossCutscene = false;
/** Phase cutscenes hold the world still (fair — input is off); the entrance lets adds materialize. */
let cutsceneFreezeWorld = false;
/** Set when the Hollow Star starts to fade — keeps the music low through the bittersweet end. */
let musicLament = false;
/** A brief grace window so the attack click the player is holding doesn't instantly skip the beat. */
/**
 * The one repeating environmental FX emitter (opening crawl embers, boss-entrance
 * storm). Driven by the frame loop's dt, NOT setInterval: a private wall-clock
 * loop defeats freezeForTest()/frames(n,dt) and makes every capture
 * nondeterministic (a hard rule in CLAUDE.md).
 */
let stormEmitter: { t: number; every: number; fn: () => void } | null = null;
/** Temporary meshes owned by the active boss cutscene. Cleared on skip/finish. */
let cutsceneTemps: THREE.Object3D[] = [];

type BossOmen = "claws" | "gate";
interface BossFxConfig {
  zoom: number;
  c1: number;
  c2: number;
  hex: string;
  bannerClass: string;
  phaseColor: number;
  seismic?: boolean;
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

function skipCutscene(event?: Event): void {
  if (event instanceof KeyboardEvent && (event.repeat || !["Space", "Enter", "Escape"].includes(event.code))) return;
  const cine = ctx.presentation.state();
  if (cine.active) {
    if (cine.time < 0.45) return;
    ctx.presentation.skip();
    return;
  }
  finishCutscene();
}

function finishCutscene(skipped = false): void {
  if (!bossCutscene) return;
  bossCutscene = false;
  window.removeEventListener("pointerdown", skipCutscene);
  window.removeEventListener("keydown", skipCutscene);
  hud.setLetterbox(false, true);
  hud.setCinematic(false);
  hud.setCinematicSkip(false);
  hud.clearBanner();
  ctx.presentation.cancel();
  ctx.player.cinematicGuard = false;
  ctx.arena.cutsceneDim = 0; // skip path: never leave the arena held dark
  ctx.cam.mode = "follow";
  if (skipped) ctx.cam.followImmediately(ctx.player.pos.x, ctx.player.pos.z);
  ctx.input.enabled = true;
  ctx.music.duckTo(musicLament ? 0.25 : 1); // keep the lament quiet through the fade
  cutsceneFreezeWorld = false;
  hud.revealBossBar(); // skipping the entrance must not leave the fight bar-less
  stormEmitter = null;
  clearCutsceneTemps();
  // The authored reveal is the grace window. Once control returns the boss must
  // visibly engage instead of standing inert for the unused remainder of its
  // materialization timer (especially noticeable when pausing at the handoff).
  ctx.enemies.living().find((e) => e.kind === "boss")?.finishCinematic();
  hud.setSparePrompt(unmakerFading, 0);
  if (state === "cutscene") state = "playing";
}

/** A new run/menu must not inherit a hidden HUD or live timeline from an ending. */
function resetPresentation(): void {
  ctx.floaters.clear();
  finishInterlude(null, false);
  ctx.presentation.cancel();
  finishCutscene(true);
  openingWalk = false;
  cutsceneFreezeWorld = false;
  stormEmitter = null;
  ctx.player.cinematicGuard = false;
  ctx.arena.cutsceneDim = 0;
  hud.setCinematic(false);
  hud.setCinematicSkip(false);
  hud.setLetterbox(false, true);
  hud.setSparePrompt(false);
  hud.clearBanner();
}

/** Per-boss entrance palettes — each warden arrives in its own colors + intensity. */
const BOSS_FX: Record<string, BossFxConfig> = {
  warden: {
    zoom: 0.55, c1: 0xff6622, c2: 0xffcc66, hex: "#ffcc66",
    bannerClass: "banner--boss-warden", phaseColor: 0xff7a3a,
  },
  spire: {
    zoom: 0.6, c1: 0x3effd2, c2: 0xaaffee, hex: "#aaffee",
    bannerClass: "banner--boss-spire", phaseColor: 0x3effd2,
  },
  colossus: {
    zoom: 1.0, c1: 0xff3300, c2: 0xffaa44, hex: "#ffaa44",
    bannerClass: "banner--boss-colossus", phaseColor: 0xff5500, seismic: true,
  },
  tyrant: {
    zoom: 0.62, c1: 0x9a5cff, c2: 0xffffff, hex: "#cbb6ff",
    bannerClass: "banner--boss-tyrant", phaseColor: 0x9a5cff,
  },
  unmaker: {
    zoom: 0.82, c1: 0x9874c8, c2: 0xd8cef0, hex: "#d8cef0",
    bannerClass: "banner--boss-unmaker", phaseColor: 0xb98cff, quiet: true,
  },
  echo: {
    zoom: 0.6, c1: 0x3aa0ff, c2: 0x9fe8ff, hex: "#9fe8ff",
    bannerClass: "banner--boss-echo", phaseColor: 0x3aa0ff,
  },
  wound: {
    zoom: 0.58, c1: 0xff2a4a, c2: 0xff9aa8, hex: "#ff5a6e",
    bannerClass: "banner--boss-wound", phaseColor: 0xff2a4a, seismic: true,
  },
};

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
  } else {
    // This is an establishing seal, not an area attack. Keep it as a quiet coral
    // read until the actual landing concentrates the brightness at contact.
    primary.opacity = 0.36;
    secondary.opacity = 0.22;
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
  }

  root.scale.setScalar(1 + phase * 0.12);
  trackCutsceneTemp(root);
}

function faceHeroToward(x: number, z: number): void {
  const p = ctx.player.pos;
  if (Math.hypot(x - p.x, z - p.z) > 0.1) ctx.player.facing = Math.atan2(x - p.x, z - p.z);
}

function runSliceCinematicBeat(beat: CinematicBeat): void {
  if (!bossCutscene) return;
  if (beat.type === "camera") {
    const zoom = menus.settings.reduceMotion ? Math.max(0.72, beat.zoom) : beat.zoom;
    if (beat.preset === "handoff") {
      ctx.cam.mode = "follow";
      ctx.cam.target.copy(ctx.player.pos);
      ctx.cam.aimPoint.copy(ctx.player.pos);
    } else ctx.cam.cinematicShot(beat.x, beat.z, zoom, beat.preset, beat.duration, beat.easing);
  } else if (beat.type === "hero-reaction") {
    faceHeroToward(beat.x, beat.z);
    if (!menus.settings.reduceMotion) ctx.player.cinematicGuard = true;
  } else if (beat.type === "boss-action") {
    const boss = ctx.enemies.living().find((e) => e.kind === "boss");
    const kind = ctx.run.currentNode?.bossKind ?? "warden";
    const cfg = BOSS_FX[kind] ?? BOSS_FX.warden;
    if (beat.action === "gate") addBossOmen("gate", BOSS_FX.warden, boss?.pos.x ?? 0, boss?.pos.z ?? -8);
    else if (beat.action === "drop") boss?.performCinematic("drop");
    else if (beat.action === "land" && boss) {
      boss.performCinematic("land");
      ctx.decals.crack(boss.pos.x, boss.pos.z, 2.3);
      ctx.fx.directionalBurst({
        x: boss.pos.x, y: 0.18, z: boss.pos.z, count: 18,
        color: [0xff7a3a, 0xffd27a], dirX: 0, dirY: 0.22, dirZ: 1,
        spread: 1.1, speed: [3, 9], size: [0.25, 0.62], life: [0.2, 0.5],
        gravity: -5, drag: 4, shape: 2,
      });
      if (!menus.settings.reduceMotion) { ctx.cam.addTrauma(0.38); ctx.stage.punch(0.28); }
    } else if (beat.action === "drag" && boss) {
      boss.performCinematic("drag");
      ctx.decals.scorch(boss.pos.x, boss.pos.z + 1.15, 1.15);
      ctx.fx.directionalBurst({
        x: boss.pos.x, y: 0.12, z: boss.pos.z + 1.1, count: 9,
        color: [0xff7a3a, 0x6b281d], dirX: 0.1, dirY: 0.12, dirZ: 1,
        spread: 0.55, speed: [2, 6], size: [0.18, 0.42], life: [0.2, 0.42], gravity: -4, drag: 4,
      });
    } else if (beat.action === "phase" || beat.action === "last-stand") {
      boss?.performCinematic(beat.action);
    } else if (beat.action === "manifest" || beat.action === "rise") {
      boss?.performCinematic(beat.action);
      // Reveal the real rig without a second, competing mesh silhouette.
    } else if (beat.action === "channel") {
      boss?.performCinematic("channel");
    } else if (beat.action === "shatter") {
      boss?.performCinematic("shatter");
    } else if (beat.action === "ignite") {
      boss?.performCinematic("ignite");
    } else if (beat.action === "tear") {
      boss?.performCinematic("tear");
    } else if (beat.action === "mirror") {
      boss?.performCinematic("mirror");
    } else if (beat.action === "strip") {
      boss?.performCinematic("strip");
      addBossOmen("claws", cfg, boss?.pos.x ?? 0, boss?.pos.z ?? -8);
    } else if (beat.action === "roar") {
      boss?.performCinematic("roar");
      ctx.sfx.bossRoar();
    }
  } else if (beat.type === "impact") {
    ctx.vfx.impact(beat.cue);
    if (!menus.settings.reduceMotion) { ctx.cam.kick(beat.cue.dirX, beat.cue.dirZ, 3.2); ctx.cam.pulseFov(0.28); }
  } else if (beat.type === "title") {
    ctx.arena.cutsceneDim = 0;
    hud.banner(beat.title, beat.subtitle, `banner--boss banner--long banner--cutscene ${beat.className}`);
    ctx.sfx.bossIntroSting();
    if (ctx.presentation.state().id?.startsWith("boss-intro:")) ctx.music.duckTo(1);
  } else if (beat.type === "letterbox") hud.setLetterbox(beat.on);
  else if (beat.type === "hud") hud.setCinematic(beat.hidden);
  else if (beat.type === "environment") ctx.arena.cutsceneDim = beat.dim;
  else if (beat.type === "sound") {
    if (beat.cue === "roar") ctx.sfx.bossRoar();
    else ctx.sfx.bossIntroSting();
  }
}

function wardenIntroSequence(name: string, title: string, bx: number, bz: number): CinematicSequence {
  const impact = {
    sourceId: "arena:gate", sourceKind: "environment", targetId: "boss:warden", targetKind: "boss", attackFamily: "boss" as const,
    x: bx, y: 0.75, z: bz, dirX: 0, dirZ: 1, damage: 0,
    color: 0xff8a42, strength: "execute" as const, element: "fire" as const,
    shielded: false, killed: false,
  };
  return {
    id: "boss-intro:warden",
    duration: 4.8,
    beats: [
      { at: 0, type: "letterbox", on: true },
      { at: 0, type: "hud", hidden: true },
      { at: 0.02, type: "environment", dim: 0.72 },
      { at: 0.08, type: "camera", x: 0, z: -8.8, zoom: 0.86, preset: "wide", duration: 0.72, easing: "smooth" },
      { at: 0.28, type: "boss-action", action: "gate" },
      { at: 0.7, type: "sound", cue: "riser" },
      { at: 1.15, type: "hero-reaction", x: bx, z: bz },
      { at: 1.62, type: "boss-action", action: "drop" },
      { at: 1.68, type: "camera", x: bx, z: bz + 0.8, zoom: 0.52, preset: "low-reveal", duration: 0.5, easing: "dramatic" },
      { at: 1.94, type: "environment", dim: 0.35 },
      { at: 2.05, type: "boss-action", action: "land" },
      { at: 2.08, type: "impact", cue: impact },
      { at: 2.28, type: "boss-action", action: "drag" },
      { at: 2.56, type: "boss-action", action: "roar" },
      { at: 2.76, type: "title", title: name, subtitle: title, className: `${BOSS_FX.warden.bannerClass} banner--slice` },
      { at: 2.76, type: "environment", dim: 0 },
      { at: 4.02, type: "camera", x: (bx + ctx.player.pos.x) * 0.5, z: (bz + ctx.player.pos.z) * 0.5, zoom: 0.76, preset: "handoff", duration: 0.62 },
      { at: 4.48, type: "letterbox", on: false },
    ],
  };
}

function fullGameBossIntroSequence(kind: string, name: string, title: string, bx: number, bz: number): CinematicSequence {
  if (kind === "warden") return wardenIntroSequence(name, title, bx, bz);
  const cfg = BOSS_FX[kind] ?? BOSS_FX.warden;
  const duration = kind === "spire" ? 4.6 : kind === "colossus" || kind === "wound" ? 5 : kind === "unmaker" ? 5.2 : kind === "echo" ? 4.2 : 4.8;
  const action = kind === "spire" ? "shatter" as const : kind === "colossus" ? "ignite" as const
    : kind === "tyrant" ? "tear" as const : kind === "unmaker" ? "channel" as const
    : kind === "echo" ? "mirror" as const : kind === "wound" ? "strip" as const : "manifest" as const;
  const revealAt = Math.min(duration - 1.7, kind === "echo" ? 2.34 : kind === "unmaker" ? 2.92 : 2.7);
  const family = BOSS_ATTACK_FAMILY[kind] ?? "boss";
  const bodyRevealZoom = kind === "spire" ? 0.9 : kind === "colossus" ? 1.35
    : kind === "tyrant" ? 1.2 : kind === "unmaker" ? 1.25
      : kind === "wound" ? 1.05 : kind === "echo" ? 1.0 : cfg.zoom;
  const bodyRevealPreset = kind === "echo" ? "wide" as const : "threat" as const;
  const impact = {
    sourceId: `boss:${kind}`, sourceKind: kind, targetId: "arena:arrival", targetKind: "environment", attackFamily: family,
    x: bx, y: kind === "spire" || kind === "unmaker" ? 1.35 : 0.42, z: bz, dirX: 0, dirZ: 1, damage: 0,
    color: cfg.phaseColor, strength: kind === "colossus" || kind === "wound" ? "execute" as const : "critical" as const,
    element: ATTACK_ELEMENT[family] ?? (kind === "colossus" ? "fire" as const : "rift" as const),
    shielded: false, killed: false,
  };
  return {
    id: `boss-intro:${kind}`,
    duration,
    beats: [
      { at: 0, type: "letterbox", on: true },
      { at: 0, type: "hud", hidden: true },
      { at: 0.02, type: "environment", dim: kind === "unmaker" ? 0.88 : 0.76 },
      { at: 0.08, type: "camera", x: 0, z: -8.5, zoom: 0.86, preset: "wide", duration: 0.68, easing: "smooth" },
      { at: 0.28, type: "boss-action", action: kind === "wound" ? "rise" : "manifest" },
      { at: 0.72, type: "sound", cue: "riser" },
      { at: 1.08, type: "hero-reaction", x: bx, z: bz },
      { at: 1.48, type: "camera", x: bx, z: bz + 0.65, zoom: bodyRevealZoom, preset: bodyRevealPreset, duration: 0.54, easing: "dramatic" },
      { at: 1.72, type: "boss-action", action },
      { at: revealAt - 0.24, type: "impact", cue: impact },
      { at: revealAt, type: "title", title: name, subtitle: title, className: `${cfg.bannerClass} banner--slice` },
      { at: revealAt, type: "environment", dim: kind === "spire" ? 0.25 : 0 },
      { at: revealAt + 0.22, type: "sound", cue: "roar" },
      { at: duration - 0.72, type: "camera", x: (bx + ctx.player.pos.x) * 0.5, z: (bz + ctx.player.pos.z) * 0.5, zoom: 0.78, preset: "handoff", duration: 0.5, easing: "smooth" },
      { at: duration - 0.58, type: "environment", dim: 0 },
      { at: duration - 0.28, type: "letterbox", on: false },
    ],
  };
}

function bossPhaseSequence(
  kind: string,
  phase: number,
  line: string,
  bx: number,
  bz: number,
  cfg: BossFxConfig,
): CinematicSequence {
  const fading = phase >= 4;
  const lastStand = kind === "warden" && phase >= 3;
  const duration = fading ? 3.4 : 2.2;
  const element = ATTACK_ELEMENT[BOSS_ATTACK_FAMILY[kind] ?? "boss"] ?? "rift";
  const wardenPhase = kind === "warden";
  const phaseZoom = wardenPhase ? (lastStand ? 0.9 : 0.82) : kind === "unmaker" ? 1.85 : kind === "tyrant" ? 1.45 : kind === "colossus" ? 1.35 : 1.05;
  const beats: CinematicBeat[] = [
    { at: 0, type: "letterbox", on: true },
    { at: 0, type: "hud", hidden: true },
    { at: 0.02, type: "environment", dim: fading || lastStand ? 0.58 : 0.38 },
    { at: 0.04, type: "camera", x: bx, z: bz, zoom: phaseZoom, preset: "threat", duration: 0.45, easing: "dramatic" },
  ];
  // The sound must not replace the phase pose 40 ms after it starts.
  if (!fading) beats.push({ at: 0.12, type: "boss-action", action: lastStand ? "last-stand" : "phase" }, { at: 0.16, type: "sound", cue: "roar" });
  beats.push(
    { at: 0.25, type: "impact", cue: {
      sourceId: `boss:${kind}`, sourceKind: "boss", targetId: "arena:phase", targetKind: "environment", attackFamily: "boss",
      x: bx, y: fading ? 1.4 : 0.4, z: bz, dirX: 0, dirZ: 1, damage: 0,
      color: fading ? cfg.c2 : cfg.phaseColor,
      strength: fading ? "heavy" : "critical",
      element,
      shielded: false,
      killed: false,
    } },
    {
      at: 0.33,
      type: "title",
      title: line,
      subtitle: fading ? "" : `PHASE ${phase}`,
      className: `${cfg.bannerClass} ${fading ? "banner--lament" : "banner--phase-slice"}`,
    },
    { at: duration - 0.52, type: "camera", x: (bx + ctx.player.pos.x) * 0.5, z: (bz + ctx.player.pos.z) * 0.5, zoom: 0.78, preset: "handoff", duration: 0.4 },
    { at: duration - 0.34, type: "environment", dim: 0 },
    { at: duration - 0.26, type: "letterbox", on: false },
  );
  return {
    id: `boss-phase:${kind}:${phase}`,
    duration,
    beats,
  };
}

/** Reveal the real actor, then return camera and control together. */
function playBossCutscene(kind: string, name: string, title: string, bx: number, bz: number): void {
  if (bossCutscene) finishCutscene();
  menus.clear();
  bossCutscene = true;
  cutsceneFreezeWorld = true;
  state = "cutscene";
  ctx.input.enabled = false;
  ctx.player.animSwing = ctx.player.animDodge = null;
  ctx.player.castGesture = null;
  ctx.player.cinematicGuard = true;
  hud.setLetterbox(true);
  hud.setCinematicSkip(true);
  ctx.arena.cutsceneDim = 0.72;
  ctx.music.duckTo(0.35);
  faceHeroToward(bx, bz);
  ctx.enemies.living().find(e => e.kind === "boss")?.holdCinematic();
  ctx.presentation.play(fullGameBossIntroSequence(kind, name, title, bx, bz));
  window.addEventListener("pointerdown", skipCutscene);
  window.addEventListener("keydown", skipCutscene);
}

ctx.events.on("BOSS_INTRO", ({ name, title, x, z }) =>
  playBossCutscene(ctx.run.currentNode?.bossKind ?? "warden", name, title, x, z));

/** A short, punchy cinematic beat each time a boss escalates a phase. */
function playBossPhaseCutscene(phase: number, line: string): void {
  if (state !== "playing") return; // never interrupt the entrance or other states
  const boss = ctx.enemies.living().find((e) => e.kind === "boss");
  if (!boss) return; // HUD still shows the phase banner on its own
  const kind = ctx.run.currentNode?.bossKind ?? "warden";
  const cfg = BOSS_FX[kind] ?? BOSS_FX.warden;
  boss.holdCinematic();
  ctx.hostiles.clear();
  ctx.floaters.clear();
  bossCutscene = true;
  cutsceneFreezeWorld = true; // hold the fight — the player can't act, so neither can the boss
  state = "cutscene";
  ctx.input.enabled = false;
  hud.setLetterbox(true);
  hud.setCinematicSkip(true);
  ctx.arena.cutsceneDim = phase >= 4 ? 0.55 : 0.42;

  if (phase >= 4) {
    // The fading phase keeps its lament and mercy state, but no longer locks
    // input behind a long wall-clock dwell.
    musicLament = true;
    if (ctx.run.currentNode?.bossKind === "unmaker") unmakerFading = true; // mercy becomes possible
    if (ctx.run.currentNode?.bossKind === "unmaker") ctx.music.bossFinale();
    ctx.music.duckTo(0.22);
  } else {
    ctx.music.duckTo(0.58);
  }
  ctx.presentation.play(bossPhaseSequence(kind, phase, line, boss.pos.x, boss.pos.z, cfg));
  window.addEventListener("pointerdown", skipCutscene);
  window.addEventListener("keydown", skipCutscene);
}

ctx.events.on("BOSS_PHASE", ({ phase, line }) => playBossPhaseCutscene(phase, line));

ctx.events.on("HEAL", ({ amount }) => {
  const p = ctx.player;
  if (p.alive) ctx.floaters.spawn(p.pos.x, 1.9, p.pos.z, `+${amount}`, "heal");
});

ctx.events.on("RUN_VICTORY", () => {
  if (runResolved) return;
  runResolved = true; // lock out pause/checkpoint through the resolution delay
  hud.setCinematic(true);
  ctx.input.enabled = false;
  ctx.hostiles.clear();
  ctx.projectiles.clear();
  ctx.enemies.clearNonBosses();
  ctx.stage.setMood("victory"); // warm the frame + bloom the light (IDEAS-GRAPHICS #18)
  ctx.player.setVictoryPose(true);
  afterScene(() => {
    ctx.combat.clearTransient(); ctx.controller.clearTransient(); ctx.caster.clear();
    ctx.player.animMoveAmount = 0;
  }, 0);
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
  afterScene(() => { if (state === "playing") playEnding(unlocks); }, 2800);
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
  const woundEnding = chosenMercy ? [
    "The Wound closes. This time, nothing is left beneath it.",
    "Beside you, the ember of the Hollow Star still burns. The light you spared helped you finish the descent.",
    "You carry it home, beyond the broken seals. The wardens can rest at last.",
  ] : [
    "The Wound closes. The last thing beneath the star is gone.",
    "The wardens held it back for a century. You broke their seals, then finished the work they could not.",
    "The world wakes safe beneath an ordinary dawn. No star remains to light your way home.",
  ];
  const lines = [...(woundActive ? woundEnding : chosenMercy ? MERCY_ENDING_LINES : ENDING_LINES), ...(heroLine ? [heroLine] : [])];
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
  // The run is already won: a lingering projectile landing inside the 2.8s
  // victory-resolution window must not replace the ending with a death screen.
  if (runResolved) return;
  sceneBeats.length = 0;
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
  hud.setCinematic(true);
  // Tear down anything a run-transition would: an in-flight interlude (its skip
  // button + 45s auto-cross), the Wound's ember ally, and the mercy prompt —
  // any of which would otherwise survive onto the death screen.
  finishInterlude(null, false);
  clearEmberAlly();
  hud.setSparePrompt(false, 0);
  unmakerFading = false;
  spareHold = 0;
  // The run is resolved: hold enemy brains and clear live ordnance so the death
  // composition is a readable aftermath, not another attack (and so an unseen
  // first-use boss VFX cannot compile on the lethal-hit frame).
  for (const enemy of ctx.enemies.living()) enemy.setSpawnGrace(2);
  ctx.projectiles.clear();
  ctx.hostiles.clear();
  ctx.music.silence();
  ctx.cam.addTrauma(0.7);
  ctx.stage.punch(1);
  ctx.sfx.defeat();
  clearRunSave();
  const unlocks = ctx.profile.recordRun("death", ctx.stats);
  afterScene(() => {
    state = "dead";
    ctx.cam.menuOrbit();
    hud.setVisible(false);
    menus.showDeath(ctx.stats, unlocks);
    if (unlocks.length) ctx.sfx.unlockFanfare();
  }, 1700);
});

window.addEventListener("keydown", (e) => {
  if (e.code !== "Escape") return;
  if (state === "cutscene") return; // story screens own Escape (skip) -- see Menus.storyIntro
  // An open overlay with a Back control closes THAT first, so Escape inside
  // Settings returns to the pause menu instead of resuming the fight beneath it.
  if (menus.back()) return;
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
  impactMotionThisFrame = 0;
  // Gamepad: poll every frame; Start toggles pause (works while paused, unlike the action layer)
  // Cinematic and combat clocks both stop when paused.
  if (state !== "paused") {
    menus.updatePresentation(dt);
    hud.updatePresentation(dt);
  }
  if (state === "playing" || state === "cutscene") updateSceneBeats(dt);
  if (state !== "paused" && ctx.presentation.state().active) ctx.presentation.update(dt);
  ctx.input.pollGamepad();
  if (ctx.input.pauseEdgeRaw()) {
    if (state === "playing") pause();
    else if (state === "paused") resume();
  }

  ctx.playing = state === "playing" && !runResolved;

  // Gamepad menu navigation runs whenever a menu overlay is up (no-op without a pad).
  if (!ctx.playing) menuNav.update(dt);

  if (ctx.playing) {
    const gameDt = dt;
    ctx.stats.time += gameDt;
    ctx.input.updateAim(ctx.stage.camera);
    ctx.controller.update(gameDt);
    ctx.combat.update(gameDt);
    ctx.tempo.update(gameDt);
    ctx.cam.setTempo(ctx.tempo.value / 100); // tempo tightens the framing (IDEAS-GRAPHICS #46)
    ctx.deck.update(gameDt);
    ctx.caster.update(gameDt);
    ctx.enemies.update(gameDt);
    ctx.projectiles.update(gameDt);
    ctx.hostiles.update(gameDt);
    ctx.features.update(gameDt);
    // The causeway interlude is a non-combat beat with no loaded node; don't let
    // wave/clear logic tick under it. (In the real flow run-state is already
    // "cleared" here so update() no-ops — this just keeps the beat self-contained.)
    if (!interlude) ctx.run.update(gameDt);
    if (interlude) updateInterlude(gameDt);
    ctx.player.update(gameDt);
    updateContactShadows();
    // Tempo stays local to the hero, HUD, trails, and attacks. Whole-frame tinting
    // made the arena background visibly phase between colours during ordinary play.
    // Sword ribbon while the blade is actually moving (chain or card swings)
    ctx.player.getBladePoints(trailTip, trailBase);
    ctx.trail.setColor(ctx.player.bladeColor);
    ctx.trail.setStyle((HERO_PRESENTATION[ctx.player.hero.id] ?? HERO_PRESENTATION.blade).trail, ctx.tempo.value / 100);
    ctx.trail.update(gameDt, trailTip, trailBase, ctx.combat.swinging || ctx.caster.swinging);
    if (emberAlly) updateEmberAlly(gameDt);
    if (inTutorial) tutorial.update(gameDt);
    // Mercy: while the Hollow Star fades, holding the mercy input spares it instead of killing it.
    if (unmakerFading && !chosenMercy) {
      if (ctx.input.actionDown("mercy")) {
        spareHold += gameDt;
        hud.setSparePrompt(true, spareHold / SPARE_TIME);
        if (spareHold >= SPARE_TIME) doMercy();
      } else {
        spareHold = Math.max(0, spareHold - gameDt * 1.5);
        hud.setSparePrompt(true, spareHold / SPARE_TIME);
      }
    }
    hud.update(dt);
  } else if (state === "playing" && runResolved) {
    // The outcome is committed. Only the body and effects finish their action;
    // hazards, attacks, cooldowns and the recorded run timer are already stopped.
    ctx.player.update(dt);
    ctx.enemies.updateRemains(dt);
    updateContactShadows();
    ctx.player.getBladePoints(trailTip, trailBase);
    ctx.trail.update(dt, trailTip, trailBase, false);
  } else if (state === "cutscene") {
    // Cinematics: the world breathes, spawns materialize, nothing fights.
    // A controller button skips the boss entrance just like a key/click does
    // (story screens are handled by menuNav, which reads the pad directly).
    if (bossCutscene && ctx.input.anyButtonEdge()) skipCutscene();
    // Phase beats freeze the fight so a boss can't hit the disarmed player.
    ctx.player.animMoveAmount = 0;
    if (openingWalk) {
      const step = Math.min(Math.max(0, ctx.player.pos.z + 8), dt * 0.85);
      ctx.player.pos.z -= step;
      ctx.player.animMoveAmount = step > 0 ? 0.22 : 0;
      ctx.player.animMoveZ = step > 0 ? 1 : 0;
      ctx.player.cinematicGuard = step === 0;
      ctx.cam.trackCinematic(ctx.player.pos.x, ctx.player.pos.z - 1.5);
    }
    ctx.player.update(dt);
    if (runResolved) ctx.enemies.updateRemains(dt);
    else if (!cutsceneFreezeWorld) ctx.enemies.update(dt);
    else ctx.enemies.living().find(e => e.kind === "boss")?.update(dt, false);
    updateContactShadows();
    ctx.player.getBladePoints(trailTip, trailBase);
    ctx.trail.update(dt, trailTip, trailBase, false);
  } else if (state === "draft" || state === "paused" || state === "menu") {
    // World idles but the hero still breathes -- including on the title screen,
    // where the camera orbits him and a frozen pose reads as a broken build.
    ctx.player.update(state === "menu" ? dt : 0);
    if (state === "menu") updateContactShadows();
  }

  // The one repeating-FX emitter, on the threaded dt.
  if (stormEmitter && state !== "paused") {
    stormEmitter.t += dt;
    while (stormEmitter.t >= stormEmitter.every) { stormEmitter.t -= stormEmitter.every; stormEmitter.fn(); }
  }

  // Low-HP swell: the bed leans in as the hero nears death.
  const hpFrac = ctx.player.maxHp > 0 ? ctx.player.hp / ctx.player.maxHp : 1;
  ctx.music.setTension(ctx.playing && ctx.player.alive && hpFrac < 0.35 ? (0.35 - hpFrac) / 0.35 : 0);
  ctx.music.update(dt);

  const worldDt = state === "paused" || state === "draft" ? 0 : dt;
  ctx.arena.update(worldDt);
  ctx.vfx.update(worldDt);
  ctx.fx.update(worldDt);
  ctx.decals.update(worldDt);
  ctx.tele.update(worldDt);
  ctx.cam.update(worldDt);
  ctx.floaters.update(worldDt);
  ctx.arena.updateForegroundOcclusion(
    dt,
    ctx.stage.camera,
    ctx.player.pos,
    ctx.cam.mode === "follow" && (state === "playing" || state === "paused" || state === "draft"),
  );
  ctx.stage.update(dt);

  // Combat + cinematics get the full post chain at full rate. Main-menu screens
  // use the lean chain at a capped rate. In-run draft/pause overlays preserve the
  // last combat frame instead of redrawing a world they cover/freeze.
  // While the loading screen is up, skip the visible render entirely (the loader
  // is opaque) so the menu's first real frame is already warm and never compiles.
  //
  // `dead`/`victory` deliberately stay on the FULL path: the player can die with the
  // boss + a full enemy pack still on the field, and flipping to the lean menu path
  // there (drop shadows + switch composer) would relink every lit material on that
  // one live frame — the "killed by a boss → ~3-second freeze". Holding the full path
  // means no flip happens until `toMenu()`/retry has cleared the scene back to the
  // (already-warm) menu, where the toggle is cheap. Draft/pause likewise keep the
  // combat shadow/program state, but submit no WebGL work until play resumes. This
  // removes the first-draft shadow relink and makes the opaque map essentially free.
  if (!booting) {
    const frozenOverlay = state === "draft" || state === "paused";
    const fullPath = state !== "menu";
    ctx.stage.setLowCost(!fullPath);
    if (fullPath && !frozenOverlay) {
      ctx.stage.render(renderDt);
      menuRenderAccum = 0;
    } else if (frozenOverlay) {
      // The canvas retains its last composited combat frame under the DOM overlay.
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
type BootPhase = "starting" | "menu" | "fonts" | "assets" | "combat" | "reveal" | "ready" | "error";
interface BootReadiness {
  ready: boolean;
  phase: BootPhase;
  error: string | null;
  startedAt: number;
  completedAt: number | null;
}
const bootReadiness: BootReadiness = {
  ready: false,
  phase: "starting",
  error: null,
  startedAt: performance.now(),
  completedAt: null,
};
(window as unknown as { __rh3boot: BootReadiness }).__rh3boot = bootReadiness;

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
    bootReadiness.phase = "menu";
    toMenu();
    step(0.18, "Kindling the rift…");
    await paint();

    // 2. Webfonts — gate the reveal on these so the menu doesn't render in a
    //    fallback face and then reflow (FOUT). Bounded so a slow fetch can't hang.
    bootReadiness.phase = "fonts";
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

    // Compile the title scene before revealing it.
    bootReadiness.phase = "assets";
    await ctx.stage.warmMenuAsync();
    step(0.62, "Lighting the embers…");
    await paint();

    warmCombatShaders();

    // 5. Let the (cool) loader read as intentional rather than a flash, then reveal.
    const elapsed = performance.now() - startedAt;
    if (elapsed < RIFT_LOADER_MIN_MS) await new Promise((r) => window.setTimeout(r, RIFT_LOADER_MIN_MS - elapsed));
    bootReadiness.phase = "reveal";
    step(1, "Descend.");
  } catch (error) {
    // Do not trap the player, but make the failure explicit to the smoke gate.
    bootReadiness.phase = "error";
    bootReadiness.error = error instanceof Error ? error.message : String(error);
    console.error("[rh3] boot warm-up failed; revealing fallback menu:", error);
  }

  booting = false;
  // Apply the saved display mode + window resolution now that the window is live
  // (deferred to here so it runs once, after warm-up, not on every settings tweak).
  menus.applyInitialDisplay();
  if (loader) {
    loader.classList.add("rl-done");
    window.setTimeout(() => {
      loader.remove();
      bootReadiness.ready = bootReadiness.error === null;
      bootReadiness.phase = bootReadiness.error === null ? "ready" : "error";
      bootReadiness.completedAt = performance.now();
    }, 700);
  } else {
    bootReadiness.ready = bootReadiness.error === null;
    bootReadiness.phase = bootReadiness.error === null ? "ready" : "error";
    bootReadiness.completedAt = performance.now();
  }
}
void boot();

// Manual development shortcuts. No analyzers, recorders, or test suites run here.
{
  const w = window as unknown as Record<string, unknown>;
  w.__rh3 = ctx;
  w.__rh3menus = menus;
  w.__rh3state = () => state;
  w.__rh3perf = perf;
  type DebugBoss = Parameters<typeof ctx.run.debugLoadBoss>[0];
  type DebugNode = Parameters<typeof ctx.run.debugLoadNode>[0];
  type DebugKind = Parameters<typeof ctx.enemies.spawn>[0];
  interface ScenarioOpts { act?: number; seed?: number; depth?: number; skipIntro?: boolean; frame?: boolean; zoom?: number; }
  const BOSS_ACT: Record<string, number> = { warden: 1, spire: 2, colossus: 3, tyrant: 4, unmaker: 5, echo: 4, wound: 5 };
  const PHASE_FRAC: Record<string, number> = { p2: 0.66, p3: 0.32, p4: 0.1 };
  const livingBoss = () => ctx.enemies.living().find(e => e.alive && e.kind === "boss") ?? null;

  const debug = {
    /** Cut to a named scenario. Returns true if the name was recognized. */
    scenario(name: string, opts: ScenarioOpts = {}): boolean {
      resetPresentation();
      sceneBeats.length = 0;
      hud.setVisible(true);
      const parts = String(name).split(":");
      // Loading a room also needs the active input, HUD and gameplay loop.
      if (parts[0] === "boss" || parts[0] === "enemy" || parts[0] === "room") {
        if (state === "menu" || runResolved || !ctx.player.alive) {
          ctx.stats = freshStats();
          ctx.player.alive = true;
          ctx.player.hp = ctx.player.maxHp;
          ctx.player.shield = 0;
          ctx.player.setVictoryPose(false);
          ctx.tempo.reset();
          ctx.deck.resetForRun();
          ctx.relics.resetForRun();
          runResolved = false;
        }
        menus.clear();
        hud.setVisible(true);
        state = "playing";
        ctx.input.enabled = true;
        ctx.cam.mode = "follow";
      }
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
      if (!ok) return false;
      // Bosses are created synchronously with the room. No delayed skipper may
      // remain alive and accidentally dismiss a later phase or defeat scene.
      if (opts.skipIntro !== false || target > 0) ctx.presentation.skip();
      const boss = livingBoss();
      if (target > 0 && boss) {
        for (let attempt = 0; attempt < 3; attempt++) {
          if (((boss as { phase?: number }).phase ?? 1) >= target) break;
          ctx.presentation.skip();
          debug.setBossPhase(PHASE_FRAC[phase!]);
        }
        if (opts.skipIntro !== false) ctx.presentation.skip();
      }
      return true;
    },
    /** A stationary portrait subject in a room held outside wave progression. */
    enemy(kind: string, opts: ScenarioOpts = {}): boolean {
      ctx.run.debugLoadBoss("warden", 1, 424242, 1);
      ctx.presentation.skip();
      ctx.enemies.clear();
      ctx.run.state = "idle";
      ctx.enemies.spawn(kind as DebugKind, 0, 0, 0);
      ctx.enemies.update(0);
      const subject = ctx.enemies.living()[0];
      if (subject) subject.setSpawnGrace(1e9);
      ctx.player.pos.set(26, 0, 26);
      ctx.player.hp = ctx.player.maxHp;
      hud.clearBanner(); hud.setVisible(false);
      if (opts.frame !== false) debug.frameNow(0, 0, opts.zoom ?? .36);
      return true;
    },
    /** Load any node kind: combat/elite/shop/treasure/rest/event. */
    room(kind: string, act = 1): boolean { return ctx.run.debugLoadNode(kind as DebugNode, act); },
    /** Play a story interlude. The hero may cross after its banners finish. */
    interlude(act = 2): boolean {
      playActTransition({ act, actName: "TRIAL OF WORDS", theme: "dusk" }, () => ctx.run.debugLoadNode("combat", act));
      return true;
    },
    /** Words-lock state of an active interlude: true while the banners play, false
     *  once the hero may cross, null when no interlude is running. */
    interludeLocked(): boolean | null { return interlude ? interlude.locked : null; },
    /** Dolly the cinematic camera onto a point (small zoom = closer). */
    frame(x = 0, z = 0, zoom = 0.5): void { ctx.cam.cinematic(x, z, zoom); },
    /** Immediate deterministic variant for screenshot plates. */
    frameNow(x = 0, z = 0, zoom = 0.5): void { ctx.cam.cinematicSnap(x, z, zoom); },
    /** Hand the camera back to gameplay follow. */
    follow(): void { ctx.cam.mode = "follow"; },
    /** Drop the active boss to a HP fraction (triggers its phase cutscene). */
    setBossPhase(frac: number): boolean { const b = livingBoss(); if (b) b.takeDamage(Math.max(1, Math.round(b.hp - b.maxHp * frac))); return !!b; },
    /** Stage an authored boss move for deterministic telegraph/action galleries. */
    setBossMove(move: string): boolean { return livingBoss()?.debugForceMove(move) ?? false; },
    /** Infinite HP: all incoming player damage is ignored. Defaults ON (and idempotent,
     *  so repeated calls keep it on); pass `false` to turn it off. Also tops you off.
     *  Returns the new state. */
    godmode(on = true): boolean {
      ctx.combat.god = on;
      ctx.player.hp = ctx.player.maxHp;
      if (on) ctx.player.alive = true;
      return ctx.combat.god;
    },
    /** Clear all non-boss enemies. */
    killEnemies(): void { for (const e of ctx.enemies.living()) if (e.kind !== "boss") e.takeDamage(99999); },
    /** Skip an active intro/phase cutscene. */
    skipCutscene(): void { skipCutscene(); },
    /** Hold the world and camera still for direct visual inspection. */
    freezeForTest(on = true): boolean { frozenForTest = on; return frozenForTest; },
    /** Advance a chosen number of frames for manual animation inspection. */
    frames(n: number, dt = 1 / 60): number {
      for (let i = 0; i < n; i++) runFrame(last + dt * 1000, dt);
      return n;
    },
    /** One forced frame (see frames()). */
    tick(dt = 1 / 60): void { runFrame(last + dt * 1000, dt); },
    /** Recent frame errors; the smoke checks that the loop did not swallow one. */
    frameErrors(): { t: number; state: string; msg: string }[] { return frameErrorRing.slice(); },
    state(): string { return state; },
    snapshot() { return { state, hp: ctx.player.hp, enemies: ctx.enemies.remaining, room: ctx.run.currentNode?.name }; },
    list() { return ['room:combat', 'room:elite', ...Object.keys(BOSS_ACT).map(k => 'boss:' + k), 'menu', 'tutorial', 'death', 'victory']; },
  };
  w.__rh3debug = debug;
}
