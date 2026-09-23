import "@fontsource/im-fell-english/latin-400.css";
import "./style.css";
import { Game, type Input, type RunCheckpoint } from "./sim";
import { View } from "./view";
let game = new Game();
const canvas = document.querySelector<HTMLCanvasElement>("#world")!,
  view = new View(canvas),
  overlay = document.querySelector<HTMLElement>("#overlay")!,
  hud = document.querySelector<HTMLElement>("#hud")!;
const RUN_KEY = "rogue-hero.buried-bell.run.v1",
  VOLUME_KEY = "rogue-hero.buried-bell.volume.v1",
  DISPLAY_KEY = "rogue-hero.buried-bell.display.v1";
function read(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Private storage may be unavailable; session play still works. */
  }
}
function loadRun(): RunCheckpoint | null {
  const value = read(RUN_KEY) as Partial<RunCheckpoint> | null;
  return value &&
    value.version === 1 &&
    Number.isInteger(value.room) &&
    value.room! >= 0 &&
    value.room! <= 3 &&
    typeof value.hp === "number" &&
    Number.isFinite(value.hp) &&
    value.hp > 0 &&
    value.hp <= 100 &&
    Number.isInteger(value.seed) &&
    value.seed! >= 0 &&
    value.seed! <= 0xffffffff &&
    typeof value.bossPractice === "boolean"
    ? (value as RunCheckpoint)
    : null;
}
let saved = loadRun();
const storedVolume = read(VOLUME_KEY);
let volume =
  typeof storedVolume === "number" && Number.isFinite(storedVolume)
    ? Math.max(0, Math.min(1, storedVolume))
    : 0.7;
const storedDisplay = read(DISPLAY_KEY) as Record<string, unknown> | null;
let brightness = typeof storedDisplay?.brightness === "number" && Number.isFinite(storedDisplay.brightness)
  ? Math.max(0.7, Math.min(1.4, storedDisplay.brightness)) : 1;
let quality = storedDisplay?.quality === "low" ? "low" : "high";
let hints = storedDisplay?.hints === true;
function applyDisplay() {
  view.configure(brightness, quality);
  document.body.classList.toggle("hide-hints", !hints);
  write(DISPLAY_KEY, { brightness, quality, hints });
}
applyDisplay();
const keys = new Set<string>();
type Page = "title" | "options" | "tutorial" | "ready" | "replace" | "achievements" | "intro" | null;
let page: Page = "title",
  backPage: Page = "title",
  screen = "",
  mx = innerWidth / 2,
  my = innerHeight / 2,
  attack = false,
  heavy = false,
  dodge = false,
  suspended: Game | null = null,
  lesson = -1,
  lessonDashDone = false,
  lessonOrigin = { x: 0, z: 0 };
const ACHIEVEMENTS_KEY = "lost-fiend.achievements.v1";
const storedAchievements = read(ACHIEVEMENTS_KEY) as { kills?: number; boss?: boolean } | null;
const achievements = { kills: Number.isSafeInteger(storedAchievements?.kills) ? Math.max(0, storedAchievements!.kills!) : 0, boss: storedAchievements?.boss === true };
let introTime = 0;
function finishIntro() {
  introTime = 0;
  page = null;
  game.paused = false;
  clearInput();
  canvas.focus();
}
let lastCheckpoint: RunCheckpoint | null = null;
let audio: AudioContext | null = null;
function clearInput() {
  keys.clear();
  attack = heavy = dodge = false;
}
function sound(kind: string) {
  if (volume === 0) return;
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
    if (kind === "bossToll") {
      for (const [pitch, level] of [[110, 0.052], [164, 0.023]]) {
        const tone = audio.createOscillator(), gain = audio.createGain();
        tone.type = "sine";
        tone.frequency.setValueAtTime(pitch, audio.currentTime);
        tone.frequency.exponentialRampToValueAtTime(pitch * 0.72, audio.currentTime + 0.8);
        gain.gain.setValueAtTime(level * volume, audio.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.9);
        tone.connect(gain).connect(audio.destination);
        tone.start(); tone.stop(audio.currentTime + 0.9);
        tone.onended = () => { tone.disconnect(); gain.disconnect(); };
      }
      return;
    }
    const o = audio.createOscillator(),
      g = audio.createGain();
    o.type = kind === "bell" ? "sine" : "triangle";
    const f =
      kind === "heavy" ? 85 : kind === "hit" ? 150 : kind === "hurt" ? 65 : kind === "bell" ? 220 : 300;
    o.frequency.setValueAtTime(f, audio.currentTime);
    o.frequency.exponentialRampToValueAtTime(
      f * 0.35,
      audio.currentTime + 0.13,
    );
    g.gain.setValueAtTime(0.035 * volume, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.16);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.17);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  } catch {
    /* Sound never gates input. */
  }
}
const rooms = [
  "The Outer Crypt",
  "The Silent Procession",
  "The Bell-house",
  "The Bellwether",
];
const lessons = [
  [
    "Movement",
    "WASD",
    "Hold WASD to move. Aim with your mouse.",
  ],
  ["Slash", "LEFT CLICK", "Click once to slash toward your mouse."],
  [
    "Heavy attack",
    "RIGHT CLICK",
    "Right-click once. Heavy attacks interrupt smaller enemies.",
  ],
  [
    "Dash",
    "SPACE",
    "Hold a movement key and press Space to dash. Without movement, dash toward your mouse.",
  ],
];
function persist() {
  if (lesson >= 0) return;
  if (game.phase === "dead" || game.phase === "won") {
    if (saved) {
      saved = null;
      write(RUN_KEY, null);
    }
  } else if (game.checkpoint && game.checkpoint !== lastCheckpoint) {
    saved = game.checkpoint;
    lastCheckpoint = game.checkpoint;
    write(RUN_KEY, saved);
  }
}
function returnHome() {
  if (lesson >= 0) {
    game = suspended ?? new Game();
    suspended = null;
    lesson = -1;
  }
  game.paused = game.phase === "fight" || game.phase === "between";
  clearInput();
  page = "title";
}
function startRun(practice = false) {
  game.start(319, practice);
  game.paused = true;
  introTime = 0;
  page = "intro";
  lesson = -1;
  persist();
}
function continueRun() {
  if (game.phase !== "fight" && game.phase !== "between" && saved)
    game.start(saved.seed, saved.bossPractice, saved.room, saved.hp);
  game.paused = false;
  page = null;
  persist();
}
function beginTutorial() {
  suspended = game;
  game = new Game();
  game.start();
  game.training = true;
  game.enemies = [];
  lesson = 0;
  lessonDashDone = false;
  lessonOrigin = { x: game.player.x, z: game.player.z };
  page = null;
}
function button(
  text: string,
  action: () => void,
  description = "",
  secondary = false,
) {
  const b = document.createElement("button");
  b.className = secondary ? "secondary" : "";
  b.innerHTML = `<strong>${text}</strong>${description ? `<span>${description}</span>` : ""}`;
  b.onclick = () => {
    sound("swing");
    clearInput();
    action();
    paint();
  };
  overlay.querySelector(".actions")!.append(b);
}
function paint() {
  const next =
    page ??
    (game.paused
      ? "pause"
      : game.phase === "dead" && game.player.time < game.player.duration
        ? "fall"
        : game.phase);
  const key = `${next}:${lesson}`;
  if (screen === key) return;
  screen = key;
  overlay.replaceChildren();
  overlay.hidden = next === "fight" || next === "fall" || next === "between";
  hud.hidden = next !== "fight";
  const tip = hud.querySelector<HTMLElement>(".lesson")!;
  tip.hidden = lesson < 0 || next !== "fight";
  if (!tip.hidden)
    tip.innerHTML = `<small>TRAINING · ${lesson + 1} / 4</small><strong>${lessons[lesson][0]}</strong><p><kbd>${lessons[lesson][1]}</kbd> ${lessons[lesson][2]}</p>`;

  if (next === "fight") {
    canvas.focus();
    return;
  }
  if (next === "fall" || next === "between") return;
  if (next === "intro") {
    overlay.dataset.page = "intro";
    overlay.innerHTML = '<div class="actions"></div>';
    button("Skip intro", finishIntro, "", true);
    return;
  }
  const content: Record<string, string[]> = {
    title: [
      "LOST FIEND",
      "",
      "",
    ],
    pause: [
      "PAUSED",
      "",
      "",
    ],
    achievements: ["ACHIEVEMENTS", "", ""],
    options: ["OPTIONS", "", ""],
    tutorial: [
      "TUTORIAL",
      "",
      "Practice without enemies. Your current run stays saved.",
    ],
    ready: [
      "TUTORIAL COMPLETE",
      "",
      "",
    ],
    replace: [
      "NEW RUN",
      "",
      "Your current run will be replaced.",
    ],
    dead: ["DEFEAT", "", `Struck down by ${game.cause}.`],
    won: ["VICTORY", "", ""],
  };
  const [title, kicker, copy] = content[next];
  overlay.dataset.page = next;
  overlay.innerHTML = `<section class="panel ${next === "title" ? "title-panel" : ""}">${kicker ? `<small>${kicker}</small>` : ""}${next === "title" ? '<h1 class="wordmark" aria-label="Lost Fiend"><span>Lost</span> <span>Fiend</span></h1>' : `<h1>${title}</h1>`}${copy ? `<p>${copy}</p>` : ""}<div class="actions"></div></section>`;
  if (next === "title") {
    const active = game.phase === "fight" || game.phase === "between";
    if (active || saved)
      button(
        "Continue",
        continueRun,
        rooms[active ? game.room : saved!.room],
      );
    button(
      "New run",
      () => {
        if (active || saved) page = "replace";
        else startRun();
      },
      "",
      active || !!saved,
    );
    button("Achievements", () => (page = "achievements"), "", true);
    button("Tutorial", () => (page = "tutorial"), "", true);
    button(
      "Options",
      () => {
        backPage = "title";
        page = "options";
      },
      "",
      true,
    );
  }
  if (next === "achievements") {
    const list = document.createElement("div");
    list.className = "achievements";
    const entries: [string, string, number, number][] = [
      ["First blood", "Slay 10 enemies", achievements.kills, 10],
      ["Executioner", "Slay 50 enemies", achievements.kills, 50],
      ["Bell breaker", "Defeat the Bellwether", Number(achievements.boss), 1],
    ];
    list.innerHTML = entries.map(([name, description, value, target]) => `<article class="${value >= target ? "unlocked" : ""}"><div><h2>${name}</h2><p>${description}</p></div><span>${value >= target ? "Unlocked" : `${value} / ${target}`}</span><progress aria-label="${name}" max="${target}" value="${Math.min(value, target)}"></progress></article>`).join("");
    overlay.querySelector(".actions")!.append(list);
    button("Back", () => (page = "title"), "", true);
  }
  if (next === "pause") {
    button("Resume", () => (game.paused = false));
    button(
      "Options",
      () => {
        backPage = null;
        page = "options";
      },
      "",
      true,
    );
    button(
      lesson >= 0 ? "Exit tutorial" : "Exit run",
      returnHome,
      "",
      true,
    );
  }
  if (next === "options") {
    const row = document.createElement("div");
    row.className = "volume-setting";
    row.innerHTML = `<h2>Audio</h2><label for="volume">Sound volume <output id="volume-value">${Math.round(volume * 100)}%</output></label><input id="volume" type="range" min="0" max="100" step="5" value="${Math.round(volume * 100)}">`;
    overlay.querySelector(".actions")!.append(row);
    const slider = row.querySelector<HTMLInputElement>("input")!;
    slider.oninput = () => {
      volume = Number(slider.value) / 100;
      row.querySelector("output")!.textContent = `${slider.value}%`;
      write(VOLUME_KEY, volume);
    };
    slider.onchange = () => sound("bell");
    const display = document.createElement("div");
    display.className = "display-settings";
    display.innerHTML = `<h2>Display</h2><div class="setting-row"><label for="quality">Graphics quality</label><select id="quality"><option value="high">High · Shadows</option><option value="low">Low · Performance</option></select></div><div class="volume-setting"><label for="brightness">Brightness <output>${Math.round(brightness * 100)}%</output></label><input id="brightness" type="range" min="70" max="140" step="5" value="${Math.round(brightness * 100)}"></div><div class="setting-row"><span>Screen mode</span><button class="secondary fullscreen">${document.fullscreenElement ? "Exit fullscreen" : "Fullscreen"}</button></div><h2>Controls</h2><label class="setting-row" for="hints">Show control hints<input id="hints" type="checkbox" ${hints ? "checked" : ""}></label><dl class="controls-reference"><div><dt>Move</dt><dd><kbd>WASD</kbd></dd></div><div><dt>Aim</dt><dd>Mouse</dd></div><div><dt>Slash</dt><dd><kbd>Left click</kbd></dd></div><div><dt>Heavy</dt><dd><kbd>Right click</kbd></dd></div><div><dt>Dash</dt><dd><kbd>Space</kbd></dd></div><div><dt>Pause</dt><dd><kbd>Esc</kbd></dd></div></dl>`;
    overlay.querySelector(".actions")!.append(display);
    const qualitySelect = display.querySelector<HTMLSelectElement>("select")!;
    qualitySelect.value = quality;
    qualitySelect.onchange = () => { quality = qualitySelect.value; applyDisplay(); };
    const light = display.querySelector<HTMLInputElement>("#brightness")!;
    light.oninput = () => {
      brightness = Number(light.value) / 100;
      display.querySelector("output")!.textContent = `${light.value}%`;
      applyDisplay();
    };
    display.querySelector<HTMLInputElement>("#hints")!.onchange = (event) => {
      hints = (event.target as HTMLInputElement).checked; applyDisplay();
    };
    display.querySelector<HTMLButtonElement>(".fullscreen")!.onclick = async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
      } catch {
        display.querySelector(".fullscreen")!.textContent = "Unavailable";
      }
    };
    button("Back", () => (page = backPage), "", true);
  }
  if (next === "tutorial") {
    button("Begin practice", beginTutorial);
    button("Back", () => (page = "title"), "", true);
  }
  if (next === "ready") {
    button("Return to title", returnHome, "");
    button(
      "Practice again",
      () => {
        game.start();
        game.training = true;
        game.enemies = [];
        lesson = 0;
        lessonDashDone = false;
        lessonOrigin = { x: game.player.x, z: game.player.z };
        page = null;
      },
      "",
      true,
    );
  }
  if (next === "replace") {
    button("Begin new run", () => startRun());
    button("Keep current run", () => (page = "title"), "", true);
  }
  if (next === "dead" || next === "won") {
    button("Try again", () => startRun(game.bossPractice));
    button("Return to title", returnHome, "", true);
  }
  overlay.querySelector<HTMLElement>("input,button")?.focus();
}
window.addEventListener("keydown", (e) => {
  if (e.code === "Escape") {
    if (e.repeat) return;
    if (page === "intro") finishIntro();
    else if (page === "achievements") page = "title";
    else if (page === "options") page = backPage;
    else if (page === "tutorial" || page === "replace") page = "title";
    else if (
      page === "ready" ||
      (page === null && (game.phase === "dead" || game.phase === "won"))
    )
      returnHome();
    else if (
      page === null &&
      (game.phase === "fight" || game.phase === "between")
    )
      game.paused = !game.paused;
    clearInput();
    paint();
    return;
  }
  if (page !== null || game.phase !== "fight" || game.paused) return;
  if (e.code === "Space") e.preventDefault();
  keys.add(e.code);
  if (!e.repeat && e.code === "Space") dodge = true;
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
canvas.addEventListener("pointermove", (e) => {
  mx = e.clientX;
  my = e.clientY;
});
canvas.addEventListener("pointerdown", (e) => {
  if (page !== null || game.phase !== "fight" || game.paused) return;
  mx = e.clientX;
  my = e.clientY;
  if (e.button === 0) attack = true;
  if (e.button === 2) heavy = true;
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
window.addEventListener("blur", () => {
  clearInput();
  if (page === null && (game.phase === "fight" || game.phase === "between")) {
    game.paused = true;
    paint();
  }
});
window.addEventListener("resize", () => view.resize());
document.addEventListener("fullscreenchange", () => {
  const button = overlay.querySelector(".fullscreen");
  if (button) button.textContent = document.fullscreenElement ? "Exit fullscreen" : "Fullscreen";
});
hud.innerHTML =
  '<div class="health"><div class="health-track"><i></i></div><b></b></div><div class="room"></div><div class="boss" hidden><span>THE BELLWETHER</span><i></i></div><div class="lesson" hidden></div><div class="kit"><span><strong>Slash</strong><kbd>Left click</kbd></span><span><strong>Heavy</strong><kbd>Right click</kbd></span><span id="dash"><strong>Dash</strong><kbd>Space</kbd></span></div>';
const danger = document.createElement("div");
danger.className = "danger-vignette";
document.body.append(danger);
const passage = document.createElement("div");
passage.className = "room-passage";
passage.setAttribute("aria-hidden", "true");
document.body.append(passage);
let arrival = 0, lastRoom = game.room;
let previous = 0;
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = previous ? Math.min(0.034, (now - previous) / 1000) : 0;
  previous = now;
  const sx = Number(keys.has("KeyD")) - Number(keys.has("KeyA")),
    sz = Number(keys.has("KeyS")) - Number(keys.has("KeyW"));
  const input: Input = {
    x: sx * 0.78 + sz * 0.625,
    z: sz * 0.78 - sx * 0.625,
    aim: view.aimAngle(mx, my, game),
    attack,
    heavy,
    dodge,
  };
  if (page === "intro" && document.hasFocus()) {
    const before = introTime;
    introTime += dt;
    if (before < 0.65 && introTime >= 0.65) sound("hurt");
    if (introTime >= 2.6) finishIntro();
  }
  game.update(dt, input);
  if (game.room !== lastRoom) {
    arrival = game.room > lastRoom && page === null ? 0.4 : 0;
    lastRoom = game.room;
  }
  if (!game.paused) arrival = Math.max(0, arrival - dt);
  const crossing = page === null && !game.paused && game.phase === "between";
  const fade = crossing ? Math.max(0, Math.min(1, (game.transitionProgress - 0.55) / 0.35)) : page === null && !game.paused ? arrival / 0.4 : 0;
  passage.style.opacity = String(fade);
  document.body.classList.toggle("crossing-room", crossing);
  if (crossing) clearInput();
  if (game.slain.length) {
    if (lesson < 0) {
      achievements.kills += game.slain.length;
      achievements.boss ||= game.slain.includes("boss");
      write(ACHIEVEMENTS_KEY, achievements);
    }
    game.slain.length = 0;
  }
  danger.style.opacity = page === null && !game.paused && game.phase === "fight" ? String(Math.max(0, (35 - game.player.hp) / 35)) : "0";
  attack = heavy = dodge = false;
  if (lesson >= 0 && page === null && !game.paused) {
    const p = game.player;
    if (lesson === 3 && p.action === "dodge") lessonDashDone = true;
    const done =
      lesson === 0
        ? Math.hypot(p.x - lessonOrigin.x, p.z - lessonOrigin.z) > 1.3
        : lesson === 1
          ? p.action === "slash" && p.hit
          : lesson === 2
            ? p.action === "heavy" && p.hit
            : lessonDashDone && p.action === "idle";
    if (done) {
      if (lesson === 3) {
        page = "ready";
        game.paused = true;
      } else lesson++;
    }
  }
  persist();
  const titleBackdrop = page === "title" || page === "achievements" || page === "replace" || page === "tutorial" || (page === "options" && backPage === "title");
  document.body.classList.toggle("title-backdrop", titleBackdrop);
  view.render(game, !!(sx || sz), titleBackdrop ? now / 1000 : undefined, page === "intro" ? introTime : undefined);
  for (const cue of game.cues) sound(cue.kind);
  game.cues.length = 0;
  paint();
  if (game.phase === "fight" || game.phase === "between") {
    hud.querySelector<HTMLElement>(".health i")!.style.width =
      `${(game.player.hp / game.player.max) * 100}%`;
    hud.querySelector(".health b")!.textContent =
      `${Math.ceil(game.player.hp)} / ${game.player.max}`;
    hud.querySelector(".room")!.textContent =
      lesson >= 0 ? "TRAINING" : `${game.room + 1} / 4 · ${rooms[game.room]}`;
    hud.querySelector("#dash")!.classList.toggle("spent", !game.dodgeReady);
    const boss = game.enemies.find((e) => e.kind === "boss");
    hud.querySelector<HTMLElement>(".boss")!.hidden = !boss;
    hud.querySelector<HTMLElement>(".room")!.hidden = !!boss;
    if (boss) hud.querySelector(".boss span")!.textContent = "THE BELLWETHER";
    if (boss)
      hud.querySelector<HTMLElement>(".boss i")!.style.width =
        `${(boss.hp / boss.max) * 100}%`;
  }
}
Object.assign(window, {
  __rogue: {
    state: () => ({
      phase: game.phase,
      paused: game.paused,
      hp: game.player.hp,
      x: game.player.x,
      z: game.player.z,
      action: game.player.action,
      enemies: game.enemies.length,
      threats: game.enemies
        .filter((e) => e.hp > 0)
        .map((e) => ({ kind: e.kind, action: e.action })),
    }),
  },
});
paint();
requestAnimationFrame(frame);
