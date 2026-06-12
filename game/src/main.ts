import "@fontsource/cinzel/600.css";
import "@fontsource/cinzel/700.css";
import "@fontsource/rajdhani/500.css";
import "@fontsource/rajdhani/600.css";
import "@fontsource/rajdhani/700.css";
import "./style.css";

import { Stage } from "./render/stage";
import { CameraRig } from "./render/cameraRig";
import { Particles } from "./render/particles";
import { Telegraphs } from "./render/telegraphs";
import { Floaters } from "./render/floaters";
import { Arena, THEMES } from "./render/arena";
import { Input } from "./core/input";
import { EventBus } from "./core/events";
import { Rng } from "./core/rng";
import { Sfx } from "./audio/sfx";
import { Player } from "./game/player";
import { Controller } from "./game/controller";
import { Tempo } from "./game/tempo";
import { Combat } from "./game/combat";
import { Projectiles, HostileProjectiles } from "./game/projectiles";
import { EnemyManager } from "./game/enemies";
import "./game/enemies2"; // registers the Act II/III roster
import { ROMAN, ROOMS } from "./game/run";
import { Relics } from "./game/relics";
import { Profile } from "./game/profile";
import { Deck } from "./game/deck";
import { CardCaster } from "./game/cards";
import { RunManager } from "./game/run";
import { Hud } from "./ui/hud";
import { Menus } from "./ui/menus";
import { freshStats, type Ctx } from "./game/ctx";

type GameState = "menu" | "playing" | "paused" | "draft" | "dead" | "victory";

const canvas = document.getElementById("game") as HTMLCanvasElement;

// ---------------------------------------------------------------- boot wiring
const ctx = {} as Ctx;
ctx.stage = new Stage(canvas);
ctx.cam = new CameraRig(ctx.stage.camera);
ctx.events = new EventBus();
ctx.rng = new Rng();
ctx.input = new Input(canvas);
ctx.fx = new Particles(ctx.stage.scene);
ctx.tele = new Telegraphs(ctx.stage.scene);
ctx.floaters = new Floaters(ctx.stage.camera);
ctx.arena = new Arena(ctx.stage);
ctx.sfx = new Sfx(ctx.events);
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
ctx.run = new RunManager(ctx);
// Relics scale (or freeze) the tempo drift
ctx.tempo.decayScale = (v) => ctx.relics.tempoDecayMult(v);

const hud = new Hud(ctx);
let state: GameState = "menu";

const menus = new Menus(ctx, {
  onStartRun: startRun,
  onResume: resume,
  onAbandon: abandonRun,
  onRetry: startRun,
  onMenu: toMenu,
});
menus.applySettings();

// Audio unlock on first gesture (browser autoplay policy)
const unlock = () => {
  ctx.sfx.resume();
  window.removeEventListener("pointerdown", unlock);
  window.removeEventListener("keydown", unlock);
};
window.addEventListener("pointerdown", unlock);
window.addEventListener("keydown", unlock);

// ---------------------------------------------------------------- state flow
function startRun(): void {
  menus.clear();
  ctx.sfx.stopAmbient();
  ctx.stats = freshStats();
  ctx.player.hp = ctx.player.maxHp;
  ctx.player.alive = true;
  ctx.player.shield = 0;
  ctx.player.root.visible = true;
  ctx.tempo.reset();
  ctx.deck.resetForRun();
  ctx.relics.resetForRun();
  ctx.profile.beginRun();
  ctx.run.startRun();
  ctx.cam.mode = "follow";
  hud.setVisible(true);
  state = "playing";
  ctx.input.enabled = true;
}

function abandonRun(): void {
  ctx.profile.recordRun("abandon", ctx.stats);
  toMenu();
}

function toMenu(): void {
  state = "menu";
  ctx.enemies.clear();
  ctx.projectiles.clear();
  ctx.hostiles.clear();
  ctx.caster.clear();
  ctx.player.root.visible = false;
  ctx.cam.mode = "menu";
  ctx.arena.applyTheme(THEMES.rift);
  ctx.fx.ambientColor = THEMES.rift.ember;
  ctx.fx.ambientRate = 6;
  hud.setVisible(false);
  menus.showMain();
  ctx.sfx.startAmbient();
}

function pause(): void {
  if (state !== "playing") return;
  state = "paused";
  ctx.input.enabled = false;
  menus.showPause();
}

function resume(): void {
  menus.clear();
  ctx.input.enabled = true;
  state = "playing";
}

ctx.events.on("ROOM_CLEARED", ({ reward }) => {
  hud.fadeHints();
  window.setTimeout(() => {
    if (state !== "playing") return;
    const done = () => {
      menus.clear();
      state = "playing";
      ctx.run.nextRoom();
    };
    if (reward === "relic") {
      const choices = ctx.relics.draftChoices();
      if (choices.length === 0) {
        // Maxed out — quiet consolation heal, straight to the next chamber
        ctx.player.hp = Math.min(ctx.player.maxHp, ctx.player.hp + 10);
        ctx.events.emit("HEAL", { amount: 10 });
        ctx.run.nextRoom();
        return;
      }
      state = "draft";
      menus.showRelicDraft(choices, done);
    } else {
      state = "draft";
      menus.showDraft(ctx.deck.draftChoices(), done);
    }
  }, 1500);
});

ctx.events.on("BOSS_DEFEATED", () => {
  // Bank the milestone immediately — dying later can't take it back
  ctx.profile.noteBossKill(ROOMS[ctx.run.roomIndex].act, ctx.stats);
});

ctx.events.on("ACT_START", ({ act, name }) => {
  menus.actIntro(`ACT ${ROMAN[act - 1]}`, name);
});

ctx.events.on("ROOM_START", ({ isBoss }) => {
  if (isBoss) ctx.sfx.bossIntroSting();
});

ctx.events.on("HEAL", ({ amount }) => {
  const p = ctx.player;
  if (p.alive) ctx.floaters.spawn(p.pos.x, 1.9, p.pos.z, `+${amount}`, "heal");
});

ctx.events.on("RUN_VICTORY", () => {
  ctx.sfx.victory();
  ctx.cam.addTrauma(0.4);
  const unlocks = ctx.profile.recordRun("victory", ctx.stats);
  window.setTimeout(() => {
    state = "victory";
    ctx.cam.mode = "menu";
    hud.setVisible(false);
    menus.showVictory(ctx.stats, unlocks);
    if (unlocks.length) ctx.sfx.unlockFanfare();
  }, 2600);
});

ctx.events.on("PLAYER_DIED", () => {
  ctx.cam.addTrauma(0.7);
  ctx.stage.punch(1);
  ctx.sfx.defeat();
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

ctx.stage.renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  ctx.playing = state === "playing";

  if (ctx.playing) {
    ctx.stats.time += dt;
    ctx.input.updateAim(ctx.stage.camera);
    ctx.controller.update(dt);
    ctx.combat.update(dt);
    ctx.tempo.update(dt);
    ctx.deck.update(dt);
    ctx.caster.update(dt);
    ctx.enemies.update(dt);
    ctx.projectiles.update(dt);
    ctx.hostiles.update(dt);
    ctx.run.update();
    ctx.player.update(dt);
    hud.update();
  } else if (state === "draft" || state === "paused") {
    // World idles but the hero still breathes
    ctx.player.update(0.0001);
  }

  ctx.arena.update(dt);
  ctx.fx.update(dt);
  ctx.tele.update(dt);
  ctx.cam.update(dt);
  ctx.stage.update(dt);
  ctx.stage.render(dt);
  ctx.input.endFrame();
});

// Boot into the menu
toMenu();

// Dev/debug hook for headless smoke tests
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__rh3 = ctx;
}
