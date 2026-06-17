import type { Ctx, RunStats } from "../game/ctx";
import type { CardDef } from "../game/cards";
import type { RelicDef } from "../game/relics";
import { CARDS, cardById } from "../game/cards";
import { RELICS } from "../game/relics";
import { HEROES, type HeroDef } from "../game/heroes";
import { COSMETICS } from "../game/cosmetics";
import { ROMAN } from "../game/run";
import { MILESTONES, getDailyBest, dailySeed, type UnlockedItem } from "../game/profile";
import { ACTIONS, ACTION_LABELS, codeLabel, type Action } from "../core/input";
import { setTempoPalette } from "../game/tempo";
import { difficultyFor, MAX_DEPTH } from "../game/difficulty";
import type { MapNode, NodeKind } from "../game/mapgen";
import { BLESSINGS, blessingById } from "../game/blessings";

/** Shards to reroll a draft (spend agency over RNG). */
const REROLL_COST = 15;

const NODE_ICON: Record<NodeKind, string> = {
  combat: "⚔", elite: "★", shop: "⌂", treasure: "❖", rest: "♥", event: "?", shrine: "🜏", gamble: "🎲", boss: "☠",
};
const NODE_BLURB: Record<NodeKind, string> = {
  combat: "A fight — clear it for a card.",
  elite: "A harder fight — clear it for a relic.",
  shop: "Spend rift shards on cards, relics, heals.",
  treasure: "A free reward, no fight.",
  rest: "Heal up, or hone a card.",
  event: "An uncertain encounter.",
  shrine: "Pay in blood for power.",
  gamble: "Wager shards against the Rift.",
  boss: "The warden of this act.",
};

/** Brighten a color to a consistent vividness for tiny UI swatches (dark cape cloth
 *  otherwise reads as "disabled" next to bright blade energy). Display-only. */
function vividHex(c: number): string {
  let r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  const max = Math.max(r, g, b, 1);
  const target = 205;
  if (max < target) { const k = target / max; r *= k; g *= k; b *= k; }
  const h = (v: number) => Math.round(Math.min(255, v)).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

export interface Settings {
  volume: number;
  music: number;
  shake: number;
  quality: "low" | "medium" | "high";
  reduceMotion: boolean;
  colorblind: boolean;
  brightness: number;
  fov: number;
  /** Gamepad auto-aim: face & lock onto the nearest enemy when the right stick is idle. */
  autoAim: boolean;
}

const SETTINGS_KEY = "rh3v2-settings";
const SETTINGS_DEFAULTS: Settings = {
  volume: 0.7, music: 0.55, shake: 1, quality: "high",
  reduceMotion: false, colorblind: false, brightness: 1, fov: 50, autoAim: true,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...SETTINGS_DEFAULTS, ...JSON.parse(raw) };
  } catch { /* fall through */ }
  return { ...SETTINGS_DEFAULTS };
}

export interface MenuCallbacks {
  onStartRun(hero: HeroDef, depth: number, blessing?: string): void;
  onNewRun(): void;
  onDaily(): void;
  onTutorial(): void;
  onContinueRun(): void;
  onResume(): void;
  onAbandon(): void;
  onExitRun(): void;
  onRetry(): void;
  onMenu(): void;
  onQuit(): void;
  hasSave(): boolean;
}

/**
 * Every overlay screen: main menu, how-to, settings, pause, card draft,
 * death and victory. Pure DOM over the live 3D scene — the arena keeps
 * rendering behind a dim/blur layer, which does most of the atmospheric work.
 */
export class Menus {
  private root: HTMLElement;
  settings: Settings;
  /** Depth chosen on the hero-select screen, carried into the run. */
  private heroDepth = 0;
  private heroBlessing = "";

  constructor(private ctx: Ctx, private cb: MenuCallbacks) {
    this.root = document.getElementById("overlay")!;
    this.settings = loadSettings();
  }

  applySettings(): void {
    this.ctx.sfx.setVolume(this.settings.volume);
    this.ctx.music.setVolume(this.settings.music);
    // Reduce Motion overrides shake to zero (also dims screen flashes, which key off shakeScale)
    this.ctx.cam.shakeScale = this.settings.reduceMotion ? 0 : this.settings.shake;
    this.ctx.stage.applyQuality(this.settings.quality);
    this.ctx.stage.setExposure(this.settings.brightness);
    this.ctx.cam.setBaseFov(this.settings.fov);
    setTempoPalette(this.settings.colorblind);
    this.ctx.controller.autoAim = this.settings.autoAim;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch { /* private mode */ }
  }

  clear(): void {
    this.root.innerHTML = "";
  }

  private screen(extraClass = "screen--dim"): HTMLElement {
    this.clear();
    const el = document.createElement("div");
    el.className = `screen ${extraClass}`;
    this.root.appendChild(el);
    return el;
  }

  private wireButtons(scope: HTMLElement): void {
    scope.querySelectorAll("button").forEach((b) => {
      b.addEventListener("mouseenter", () => this.ctx.events.emit("UI_HOVER", {}));
      b.addEventListener("click", () => {
        this.ctx.events.emit("UI_CLICK", {});
        // Drop focus so Space/Enter back in gameplay can't re-trigger the button
        (b as HTMLButtonElement).blur();
      });
    });
  }

  // ---------------------------------------------------------------- main menu
  showMain(): void {
    const s = this.screen("screen--main");
    const p = this.ctx.profile.data;
    const unlockedCount = p.unlocks.length;
    const draftableRelics = RELICS.filter((r) => !r.boon);
    const totalCount = CARDS.length + draftableRelics.length;
    const strip = p.runs > 0
      ? `WINS ${p.wins} &nbsp;·&nbsp; RUNS ${p.runs} &nbsp;·&nbsp; FURTHEST: ACT ${ROMAN[Math.max(0, p.furthestAct - 1)]} &nbsp;·&nbsp; ARSENAL ${unlockedCount}/${totalCount} &nbsp;·&nbsp; ◆ ${p.shards}`
      : `THE RIFT AWAITS ITS FIRST CHALLENGER`;
    const hasSave = this.cb.hasSave();
    const dbest = getDailyBest(dailySeed());
    const dailyLabel = dbest
      ? `Daily Challenge · best ${dbest.kills} kills${dbest.won ? " · sealed ✦" : ""}`
      : "Daily Challenge";
    s.innerHTML = `
      <div class="menu-scene" aria-hidden="true">
        <span class="menu-sigil menu-sigil--one"></span>
        <span class="menu-sigil menu-sigil--two"></span>
        <span class="menu-sigil menu-sigil--three"></span>
        <span class="menu-sigil menu-sigil--four"></span>
      </div>
      <div class="title">ROGUE<br>HERO</div>
      <div class="title-rule"><span class="subtitle">III &nbsp;·&nbsp; The Ember Rift</span></div>
      <div class="menu-strip">${strip}</div>
      <div class="menu-buttons">
        ${hasSave ? '<button class="btn btn--primary" data-act="continue">Continue Run</button>' : ""}
        <button class="btn${hasSave ? "" : " btn--primary"}" data-act="start">${hasSave ? "New Run" : "Begin Run"}</button>
        <button class="btn" data-act="daily">${dailyLabel}</button>
      </div>
      <div class="menu-sub">
        <button class="btn btn--sm" data-act="armory">Armory</button>
        <button class="btn btn--sm" data-act="progress">Progress</button>
        <button class="btn btn--sm" data-act="settings">Settings</button>
      </div>
      <div class="menu-footer">
        <button class="menu-link" data-act="howto">How to Play</button>
        <span class="menu-link__sep">·</span>
        <button class="menu-link" data-act="tutorial">Tutorial</button>
        <span class="menu-link__sep">·</span>
        <button class="menu-link" data-act="credits">Credits</button>
      </div>
    `;
    this.wireButtons(s);
    s.querySelector('[data-act="continue"]')?.addEventListener("click", () => this.cb.onContinueRun());
    s.querySelector('[data-act="start"]')!.addEventListener("click", () => this.cb.onNewRun());
    s.querySelector('[data-act="daily"]')!.addEventListener("click", () => this.cb.onDaily());
    s.querySelector('[data-act="armory"]')!.addEventListener("click", () => this.showArmory(() => this.showMain()));
    s.querySelector('[data-act="progress"]')!.addEventListener("click", () => this.showProgress(() => this.showMain()));
    s.querySelector('[data-act="settings"]')!.addEventListener("click", () => this.showSettings(() => this.showMain()));
    s.querySelector('[data-act="howto"]')!.addEventListener("click", () => this.showHowTo(() => this.showMain()));
    s.querySelector('[data-act="tutorial"]')!.addEventListener("click", () => this.cb.onTutorial());
    s.querySelector('[data-act="credits"]')!.addEventListener("click", () => this.showCredits(() => this.showMain()));
  }

  // ---------------------------------------------------------------- hero select
  showHeroSelect(): void {
    const maxD = this.ctx.profile.data.maxDepth;
    this.heroDepth = Math.max(0, Math.min(this.heroDepth || maxD, maxD));
    const render = () => this.renderHeroSelect();
    render();
  }

  private renderHeroSelect(): void {
    const s = this.screen();
    // A previously-chosen blessing that isn't unlocked (or got reset) falls back to None.
    if (this.heroBlessing && !this.ctx.profile.isUnlocked(`blessing:${this.heroBlessing}`)) this.heroBlessing = "";
    const maxD = this.ctx.profile.data.maxDepth;
    const diff = difficultyFor(this.heroDepth);
    const mods = this.heroDepth === 0
      ? "No modifiers — the standard descent"
      : diff.labels.map((l) => l.replace(/^D\d+\s+/, "")).slice(-3).join(" &nbsp;·&nbsp; ");
    const atCeiling = this.heroDepth === maxD && maxD < MAX_DEPTH;
    s.innerHTML = `
      <div class="draft-title">CHOOSE YOUR HERO</div>
      <div class="draft-sub">EACH FIGHTS THE RIFT THEIR OWN WAY</div>
      <div class="depth-pick">
        <button class="depth-btn" data-d="dn"${this.heroDepth <= 0 ? " disabled" : ""}>◂</button>
        <div class="depth-pick__mid">
          <div class="depth-pick__label">RIFT DEPTH ${this.heroDepth}${atCeiling ? " · your ceiling" : maxD >= MAX_DEPTH && this.heroDepth === maxD ? " · MAX" : ""}</div>
          <div class="depth-pick__mods">${mods}</div>
        </div>
        <button class="depth-btn" data-d="up"${this.heroDepth >= maxD ? " disabled" : ""}>▸</button>
      </div>
      <div class="blessing-pick">
        <span class="blessing-pick__label">BLESSING</span>
        <button class="blessing-chip${this.heroBlessing === "" ? " blessing-chip--on" : ""}" data-bl="">None</button>
        ${BLESSINGS.map((b) => {
          const got = this.ctx.profile.isUnlocked(`blessing:${b.id}`);
          return got
            ? `<button class="blessing-chip${this.heroBlessing === b.id ? " blessing-chip--on" : ""}" data-bl="${b.id}">${b.icon} ${b.name}</button>`
            : `<button class="blessing-chip blessing-chip--locked" data-bl-locked="${b.id}">🔒 ${b.name}</button>`;
        }).join("")}
      </div>
      <div class="blessing-desc">${BLESSINGS.find((b) => b.id === this.heroBlessing)?.desc ?? "An optional gift to begin the run with — pick one, or none. Locked blessings are earned through play."}</div>
      <div class="hero-row"></div>
      <button class="draft-skip">BACK</button>
    `;
    const row = s.querySelector(".hero-row")!;
    const bars = (n: number) =>
      Array.from({ length: 5 }, (_, i) => `<span class="hbar${i < n ? " hbar--on" : ""}"></span>`).join("");

    for (const hero of HEROES) {
      const unlocked = this.ctx.profile.isUnlocked(`hero:${hero.id}`);
      const el = document.createElement("div");
      el.className = `hero-card${unlocked ? "" : " hero-card--locked"}`;
      el.style.setProperty("--accent", hero.color);
      const handIcons = hero.startingHand.map((id) => {
        const c = cardById(id);
        return `<span class="hero-hand__icon" style="--accent:${c.color}" title="${c.name}">${c.icon}</span>`;
      }).join("");
      el.innerHTML = unlocked
        ? `
          <div class="hero-card__icon">${hero.icon}</div>
          <div class="hero-card__name">${hero.name}</div>
          <div class="hero-card__title">${hero.title}</div>
          <div class="hero-card__desc">${hero.desc}</div>
          <div class="hero-stats">
            <div class="hero-stat"><span>VIT</span>${bars(hero.bars.vitality)}</div>
            <div class="hero-stat"><span>SPD</span>${bars(hero.bars.speed)}</div>
            <div class="hero-stat"><span>PWR</span>${bars(hero.bars.power)}</div>
          </div>
          <div class="hero-passive"><b>${hero.passiveName}</b> — ${hero.passiveDesc}</div>
          <div class="hero-hand">${handIcons}</div>`
        : `
          <div class="hero-card__icon">🔒</div>
          <div class="hero-card__name">???</div>
          <div class="hero-card__title">${hero.title}</div>
          <div class="hero-card__desc hero-card__desc--hint">${this.ctx.profile.unlockHintFor(`hero:${hero.id}`)}</div>`;
      if (unlocked) {
        el.addEventListener("mouseenter", () => this.ctx.events.emit("UI_HOVER", {}));
        el.addEventListener("click", () => {
          this.ctx.events.emit("UI_CLICK", {});
          this.cb.onStartRun(hero, this.heroDepth, this.heroBlessing);
        });
      }
      row.appendChild(el);
    }
    this.wireButtons(s);
    s.querySelector('[data-d="dn"]')?.addEventListener("click", () => { if (this.heroDepth > 0) { this.heroDepth--; this.renderHeroSelect(); } });
    s.querySelector('[data-d="up"]')?.addEventListener("click", () => { if (this.heroDepth < maxD) { this.heroDepth++; this.renderHeroSelect(); } });
    s.querySelectorAll<HTMLElement>(".blessing-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const lockedId = chip.dataset.blLocked;
        if (lockedId) {
          // Locked: show how to earn it instead of selecting it.
          const b = blessingById(lockedId);
          const hint = this.ctx.profile.unlockHintFor(`blessing:${lockedId}`);
          const desc = s.querySelector(".blessing-desc");
          if (desc) desc.innerHTML = `🔒 <b>${b?.name}</b> — ${b?.desc} &nbsp;·&nbsp; <span style="color:#9fd2ff">Unlock: ${hint}</span>`;
          this.ctx.events.emit("UI_CLICK", {});
          return;
        }
        this.heroBlessing = chip.dataset.bl ?? "";
        this.renderHeroSelect();
      });
    });
    s.querySelector(".draft-skip")!.addEventListener("click", () => this.showMain());
  }


  // ---------------------------------------------------------------- armory
  showArmory(back: () => void): void {
    const s = this.screen();
    const p = this.ctx.profile;
    const section = (slot: "cape" | "blade") =>
      COSMETICS.filter((c) => c.slot === slot).map((c) => {
        const owned = p.ownsCosmetic(c.id);
        const equipped = p.data.equipped[slot] === c.id;
        const hex = vividHex(c.color);
        return `
          <div class="shop-item${equipped ? " shop-item--equipped" : ""}${owned ? " shop-item--owned" : ""}" data-id="${c.id}" data-slot="${slot}" data-price="${c.price}">
            <div class="shop-item__swatch" style="--swatch:${hex}"></div>
            <div class="shop-item__name">${c.name}</div>
            <div class="shop-item__state">${equipped ? "EQUIPPED" : owned ? "OWNED" : `◆ ${c.price}`}</div>
          </div>`;
      }).join("");

    s.innerHTML = `
      <div class="panel panel--progress">
        <h2>ARMORY</h2>
        <div class="armory-shards">◆ <b>${p.data.shards}</b> RIFT SHARDS — earned by slaying, clearing, and sealing</div>
        <h3 class="prog-h3">CAPES</h3>
        <div class="shop-grid">${section("cape")}</div>
        <h3 class="prog-h3">BLADE ENERGY</h3>
        <div class="shop-grid">${section("blade")}</div>
        <button class="btn">Back</button>
      </div>
    `;
    this.wireButtons(s);
    s.querySelectorAll<HTMLElement>(".shop-item").forEach((item) => {
      item.addEventListener("mouseenter", () => this.ctx.events.emit("UI_HOVER", {}));
      item.addEventListener("click", () => {
        const id = item.dataset.id!;
        const slot = item.dataset.slot as "cape" | "blade";
        const price = parseInt(item.dataset.price!, 10);
        if (p.ownsCosmetic(id)) {
          p.equipCosmetic(slot, id);
          this.ctx.events.emit("UI_CLICK", {});
        } else if (p.buyCosmetic(id, price)) {
          p.equipCosmetic(slot, id);
          this.ctx.sfx.relicPickup();
        } else {
          this.ctx.sfx.deny();
          return;
        }
        this.showArmory(back);
      });
    });
    s.querySelector(".btn")!.addEventListener("click", back);
  }

  // ---------------------------------------------------------------- progress
  showProgress(back: () => void): void {
    const s = this.screen();
    const p = this.ctx.profile.data;
    const mins = (t: number) => `${Math.floor(t / 60)}:${Math.floor(t % 60).toString().padStart(2, "0")}`;
    const draftableRelics = RELICS.filter((r) => !r.boon);

    const gridItem = (kind: "card" | "relic" | "hero" | "blessing", def: { id: string; icon: string; name: string; color: string }): string => {
      const key = `${kind}:${def.id}`;
      const unlocked = this.ctx.profile.isUnlocked(key);
      const hint = unlocked ? def.name : this.ctx.profile.unlockHintFor(key);
      return `
        <div class="prog-item${unlocked ? "" : " prog-item--locked"}" style="--accent:${def.color}">
          <div class="prog-item__icon">${unlocked ? def.icon : "🔒"}</div>
          <div class="prog-item__name">${unlocked ? def.name : "???"}</div>
          <div class="prog-item__hint">${hint}</div>
        </div>`;
    };

    const historyRow = (r: (typeof p.history)[number]): string => {
      const glyph = r.outcome === "victory" ? "✦" : r.outcome === "death" ? "✝" : "—";
      const cls = r.outcome === "victory" ? "win" : r.outcome === "death" ? "loss" : "quit";
      const label = r.outcome === "victory" ? "RIFT SEALED" : r.outcome === "death" ? `FELL IN ACT ${ROMAN[r.act - 1]}` : "ABANDONED";
      return `
        <div class="hist-row hist-row--${cls}">
          <span class="hist-row__glyph">${glyph}</span>
          <span class="hist-row__label">${label}</span>
          <span class="hist-row__meta">${r.kills} kills</span>
          <span class="hist-row__meta">${mins(r.time)}</span>
        </div>`;
    };

    s.innerHTML = `
      <div class="panel panel--progress">
        <h2>PROGRESS</h2>
        <div class="end-stats end-stats--compact">
          <div class="stat"><div class="stat__value">${p.wins}</div><div class="stat__label">Wins</div></div>
          <div class="stat"><div class="stat__value">${p.runs}</div><div class="stat__label">Runs</div></div>
          <div class="stat"><div class="stat__value">${p.kills}</div><div class="stat__label">Kills</div></div>
          <div class="stat"><div class="stat__value">${p.perfectDodges}</div><div class="stat__label">Perfect Dodges</div></div>
          <div class="stat"><div class="stat__value">${p.bestTime !== null ? mins(p.bestTime) : "—"}</div><div class="stat__label">Best Clear</div></div>
          <div class="stat"><div class="stat__value">${ROMAN[Math.max(0, p.furthestAct - 1)]}</div><div class="stat__label">Furthest Act</div></div>
          <div class="stat"><div class="stat__value">${p.maxDepth}</div><div class="stat__label">Rift Depth</div></div>
        </div>
        <h3 class="prog-h3">HEROES</h3>
        <div class="prog-grid">${HEROES.map((h) => gridItem("hero", h)).join("")}</div>
        <h3 class="prog-h3">CARDS</h3>
        <div class="prog-grid">${CARDS.map((c) => gridItem("card", c)).join("")}</div>
        <h3 class="prog-h3">RELICS</h3>
        <div class="prog-grid">${draftableRelics.map((r) => gridItem("relic", r)).join("")}</div>
        <h3 class="prog-h3">BLESSINGS</h3>
        <div class="prog-grid">${BLESSINGS.map((b) => gridItem("blessing", b)).join("")}</div>
        <h3 class="prog-h3">RECENT RUNS</h3>
        <div class="prog-history">${p.history.length ? p.history.map(historyRow).join("") : '<div class="hist-row hist-row--quit"><span class="hist-row__label">No runs yet — the Rift awaits.</span></div>'}</div>
        <div class="menu-buttons" style="margin:6px auto 0">
          <button class="btn" data-act="achievements">Achievements</button>
          <button class="btn btn--primary" data-act="back">Back</button>
        </div>
      </div>
    `;
    this.wireButtons(s);
    s.querySelector('[data-act="achievements"]')!.addEventListener("click", () => this.showAchievements(() => this.showProgress(back)));
    s.querySelector('[data-act="back"]')!.addEventListener("click", back);
  }

  showHowTo(back: () => void): void {
    const s = this.screen();
    s.innerHTML = `
      <div class="panel panel--progress">
        <h2>HOW TO PLAY</h2>
        <div class="howto-cols">
          <div>
            <h3 class="prog-h3">KEYBOARD &amp; MOUSE</h3>
            <div class="controls-grid">
              <b>W A S D</b><span>Move</span>
              <b>MOUSE</b><span>Aim — you always face the cursor</span>
              <b>LMB</b><span>Sword combo; <i>hold</i> to wind up a heavy</span>
              <b>SPACE</b><span>Dodge — dodge <i>through</i> a hit for a <span style="color:#66ffee">PERFECT DODGE</span>; strike as a blow lands to <span style="color:#ffe066">PARRY</span></span>
              <b>1 · 2 · 3</b><span>Cast cards</span>
              <b>F</b><span>CRASH — at 85+ tempo, detonate your heat</span>
              <b>Q</b><span>OVERDRIVE — at Critical tempo, unleash your hero's super</span>
            </div>
          </div>
          <div>
            <h3 class="prog-h3">GAMEPAD <span style="color:#8fffc8;font-size:11px">· plug in &amp; press a button</span></h3>
            <div class="controls-grid">
              <b>L STICK</b><span>Move</span>
              <b>R STICK</b><span>Aim freely (overrides auto-aim)</span>
              <b>RT</b><span>Attack (hold = heavy)</span>
              <b>LT · LB · RB</b><span>Cards 1 · 2 · 3</span>
              <b>A</b><span>Dodge</span>
              <b>B</b><span>Crash</span>
              <b>Y</b><span>Switch target</span>
              <b>X</b><span>Overdrive</span>
              <b>START</b><span>Pause</span>
            </div>
            <div style="margin-top:8px;font-size:12px;color:#8fffc8;letter-spacing:1px"><b>Auto-aim</b> is on by default — you face the nearest foe automatically. Tap <b>Y</b> to switch targets; nudge the right stick to aim by hand. Toggle it in Settings.</div>
            <div style="margin-top:6px;font-size:12px;color:var(--ui-dim);letter-spacing:1px">In menus: D-pad / stick to move · <b>A</b> select · <b>B</b> back. Press any button after plugging in — a <b>“Controller connected”</b> note confirms it.</div>
          </div>
        </div>
        <div style="margin-top:20px;font-size:14px;line-height:1.7;color:var(--ui-dim);letter-spacing:1px;text-align:center">
          <span style="color:var(--ui-text)">TEMPO</span> is everything. Aggression heats you up — more damage, more speed. Getting hit or hiding bleeds you cold. Stay hot. Crash big.
        </div>
        <div class="menu-buttons" style="margin:18px auto 0">
          <button class="btn btn--primary" data-act="train">Enter Training Grounds</button>
          <button class="btn" data-act="back">Back</button>
        </div>
      </div>
    `;
    this.wireButtons(s);
    s.querySelector('[data-act="train"]')!.addEventListener("click", () => this.cb.onTutorial());
    s.querySelector('[data-act="back"]')!.addEventListener("click", back);
  }

  // ---------------------------------------------------------------- achievements
  showAchievements(back: () => void): void {
    const s = this.screen();
    const earned = new Set(this.ctx.profile.data.earnedMilestones);
    const got = MILESTONES.filter((m) => earned.has(m.id)).length;
    const rows = MILESTONES.map((m) => {
      const done = earned.has(m.id);
      const rewards = m.unlocks.map((k) => k.split(":")[1].replace(/-/g, " ")).join(" · ");
      return `
        <div class="ach-row${done ? " ach-row--done" : ""}">
          <span class="ach-row__mark">${done ? "✓" : "○"}</span>
          <span class="ach-row__desc">${m.desc}</span>
          <span class="ach-row__reward">${rewards}</span>
        </div>`;
    }).join("");
    s.innerHTML = `
      <div class="panel panel--progress">
        <h2>ACHIEVEMENTS</h2>
        <div class="armory-shards">${got} / ${MILESTONES.length} milestones earned — each unlocks new cards, relics, or heroes</div>
        <div class="ach-list">${rows}</div>
        <button class="btn">Back</button>
      </div>
    `;
    this.wireButtons(s);
    s.querySelector(".btn")!.addEventListener("click", back);
  }

  // ---------------------------------------------------------------- credits
  showCredits(back: () => void): void {
    const s = this.screen();
    s.innerHTML = `
      <div class="panel" style="text-align:center">
        <h2>CREDITS</h2>
        <div class="credits">
          <div class="credits__title">ROGUE HERO III · THE EMBER RIFT</div>
          <div class="credits__group"><b>Design &amp; Code</b><span>Justin Kramer</span></div>
          <div class="credits__group"><b>Engine</b><span>Three.js · Vite · TypeScript · Electron</span></div>
          <div class="credits__group"><b>Sound Effects</b><span>Procedural Web Audio synthesis</span></div>
          <div class="credits__group"><b>Soundtrack</b><span>Licensed music library</span></div>
          <div class="credits__group"><b>Built with</b><span>Claude Code</span></div>
          <div class="credits__thanks">Thank you for braving the Rift.</div>
        </div>
        <button class="btn">Back</button>
      </div>
    `;
    this.wireButtons(s);
    s.querySelector(".btn")!.addEventListener("click", back);
  }

  // ---------------------------------------------------------------- controls / rebinding
  showControls(back: () => void): void {
    const render = () => {
      const s = this.screen();
      const rows = ACTIONS.map((a) => {
        const binds = this.ctx.input.bindings[a].map(codeLabel).join(" / ") || "—";
        return `
          <div class="ctrl-row">
            <span class="ctrl-row__name">${ACTION_LABELS[a]}</span>
            <button class="ctrl-row__key" data-action="${a}">${binds}</button>
          </div>`;
      }).join("");
      s.innerHTML = `
        <div class="panel panel--progress">
          <h2>CONTROLS</h2>
          <div class="armory-shards">Click a binding, then press a key to rebind. &nbsp;🎮 Gamepad: plug it in and <b>press any button</b> — a “Controller connected” note confirms it. Left stick moves; <b>auto-aim</b> faces the nearest foe (tap <b>Y</b> to switch targets, or aim by hand with the right stick). See How to Play for the full layout.</div>
          <div class="ctrl-list">${rows}</div>
          <div class="menu-buttons" style="margin:10px auto 0">
            <button class="btn" data-act="reset">Reset to Default</button>
            <button class="btn btn--primary" data-act="back">Back</button>
          </div>
        </div>
      `;
      this.wireButtons(s);
      s.querySelectorAll<HTMLButtonElement>(".ctrl-row__key").forEach((b) => {
        b.addEventListener("click", () => {
          b.textContent = "press a key…";
          b.classList.add("ctrl-row__key--wait");
          this.ctx.input.captureNext(b.dataset.action as Action, () => render());
        });
      });
      s.querySelector('[data-act="reset"]')!.addEventListener("click", () => { this.ctx.input.resetBindings(); render(); });
      s.querySelector('[data-act="back"]')!.addEventListener("click", back);
    };
    render();
  }

  showSettings(back: () => void): void {
    const s = this.screen();
    s.innerHTML = `
      <div class="panel">
        <h2>SETTINGS</h2>
        <div class="setting-row">
          <span>SFX VOLUME</span>
          <input type="range" min="0" max="1" step="0.05" value="${this.settings.volume}" data-set="volume">
        </div>
        <div class="setting-row">
          <span>MUSIC VOLUME</span>
          <input type="range" min="0" max="1" step="0.05" value="${this.settings.music}" data-set="music">
        </div>
        <div class="setting-row">
          <span>SCREEN SHAKE</span>
          <input type="range" min="0" max="1.5" step="0.1" value="${this.settings.shake}" data-set="shake">
        </div>
        <div class="setting-row">
          <span>BRIGHTNESS</span>
          <input type="range" min="0.6" max="1.5" step="0.05" value="${this.settings.brightness}" data-set="brightness">
        </div>
        <div class="setting-row">
          <span>FIELD OF VIEW</span>
          <input type="range" min="44" max="62" step="1" value="${this.settings.fov}" data-set="fov">
        </div>
        <div class="setting-row">
          <span>GRAPHICS QUALITY</span>
          <div class="quality-row">
            ${(["low", "medium", "high"] as const).map((q) =>
              `<button class="qbtn${this.settings.quality === q ? " qbtn--on" : ""}" data-q="${q}">${q.toUpperCase()}</button>`
            ).join("")}
          </div>
        </div>
        <div class="setting-row">
          <span>REDUCE MOTION</span>
          <div class="quality-row">
            <button class="qbtn${this.settings.reduceMotion ? " qbtn--on" : ""}" data-rm="on">ON</button>
            <button class="qbtn${!this.settings.reduceMotion ? " qbtn--on" : ""}" data-rm="off">OFF</button>
          </div>
        </div>
        <div class="setting-row">
          <span>COLORBLIND PALETTE</span>
          <div class="quality-row">
            <button class="qbtn${this.settings.colorblind ? " qbtn--on" : ""}" data-cb="on">ON</button>
            <button class="qbtn${!this.settings.colorblind ? " qbtn--on" : ""}" data-cb="off">OFF</button>
          </div>
        </div>
        <div class="setting-row">
          <span>GAMEPAD AUTO-AIM</span>
          <div class="quality-row">
            <button class="qbtn${this.settings.autoAim ? " qbtn--on" : ""}" data-aa="on">ON</button>
            <button class="qbtn${!this.settings.autoAim ? " qbtn--on" : ""}" data-aa="off">OFF</button>
          </div>
        </div>
        <div class="menu-buttons" style="margin:6px auto 0">
          <button class="btn" data-act="controls">Rebind Controls</button>
          <button class="btn btn--primary" data-act="back">Back</button>
        </div>
      </div>
    `;
    this.wireButtons(s);
    s.querySelectorAll<HTMLInputElement>("input[data-set]").forEach((inp) => {
      inp.addEventListener("input", () => {
        if (inp.dataset.set === "volume") this.settings.volume = parseFloat(inp.value);
        if (inp.dataset.set === "music") this.settings.music = parseFloat(inp.value);
        if (inp.dataset.set === "shake") this.settings.shake = parseFloat(inp.value);
        if (inp.dataset.set === "brightness") this.settings.brightness = parseFloat(inp.value);
        if (inp.dataset.set === "fov") this.settings.fov = parseFloat(inp.value);
        this.applySettings();
      });
    });
    s.querySelectorAll<HTMLButtonElement>(".qbtn[data-q]").forEach((b) => {
      b.addEventListener("click", () => {
        this.settings.quality = b.dataset.q as Settings["quality"];
        this.applySettings();
        this.showSettings(back);
      });
    });
    s.querySelectorAll<HTMLButtonElement>(".qbtn[data-rm]").forEach((b) => {
      b.addEventListener("click", () => {
        this.settings.reduceMotion = b.dataset.rm === "on";
        this.applySettings();
        this.showSettings(back);
      });
    });
    s.querySelectorAll<HTMLButtonElement>(".qbtn[data-cb]").forEach((b) => {
      b.addEventListener("click", () => {
        this.settings.colorblind = b.dataset.cb === "on";
        this.applySettings();
        this.showSettings(back);
      });
    });
    s.querySelectorAll<HTMLButtonElement>(".qbtn[data-aa]").forEach((b) => {
      b.addEventListener("click", () => {
        this.settings.autoAim = b.dataset.aa === "on";
        this.applySettings();
        this.showSettings(back);
      });
    });
    s.querySelector('[data-act="controls"]')!.addEventListener("click", () => this.showControls(() => this.showSettings(back)));
    s.querySelector('[data-act="back"]')!.addEventListener("click", back);
  }

  // ---------------------------------------------------------------- pause
  showPause(): void {
    const s = this.screen();
    s.innerHTML = `
      <div class="panel" style="text-align:center">
        <h2 style="margin-bottom:34px">PAUSED</h2>
        <div class="menu-buttons" style="margin:0 auto">
          <button class="btn btn--primary" data-act="resume">Resume</button>
          <button class="btn" data-act="settings">Settings</button>
          <button class="btn" data-act="exit">Save &amp; Exit to Menu</button>
          <button class="btn btn--danger" data-act="abandon">Abandon Run</button>
          <button class="btn btn--danger" data-act="quit">Quit to Desktop</button>
        </div>
      </div>
    `;
    this.wireButtons(s);
    s.querySelector('[data-act="resume"]')!.addEventListener("click", () => this.cb.onResume());
    s.querySelector('[data-act="settings"]')!.addEventListener("click", () => this.showSettings(() => this.showPause()));
    s.querySelector('[data-act="exit"]')!.addEventListener("click", () => this.cb.onExitRun());
    s.querySelector('[data-act="abandon"]')!.addEventListener("click", () => this.cb.onAbandon());
    s.querySelector('[data-act="quit"]')!.addEventListener("click", () => this.confirm("Quit to desktop?", "Your run is saved — Continue Run will resume it.", () => this.cb.onQuit(), () => this.showPause()));
  }

  /** Generic yes/no confirmation overlay. */
  private confirm(title: string, sub: string, onYes: () => void, onNo: () => void): void {
    const s = this.screen();
    s.innerHTML = `
      <div class="panel" style="text-align:center">
        <h2 style="margin-bottom:10px">${title}</h2>
        <div style="color:var(--ui-dim);font-size:14px;letter-spacing:1px;margin-bottom:28px">${sub}</div>
        <div class="menu-buttons" style="margin:0 auto">
          <button class="btn btn--danger" data-act="yes">Yes</button>
          <button class="btn btn--primary" data-act="no">No, go back</button>
        </div>
      </div>
    `;
    this.wireButtons(s);
    s.querySelector('[data-act="yes"]')!.addEventListener("click", onYes);
    s.querySelector('[data-act="no"]')!.addEventListener("click", onNo);
  }

  // ---------------------------------------------------------------- draft
  showDraft(choices: CardDef[], onDone: () => void): void {
    const s = this.screen();
    let pool = choices;
    const renderPick = () => {
      const cost = REROLL_COST;
      const canReroll = this.ctx.stats.shards >= cost;
      s.innerHTML = `
        <div class="draft-title">CHOOSE A CARD</div>
        <div class="draft-sub">IT JOINS YOUR HAND FOR THE REST OF THE RUN &nbsp;·&nbsp; YOU HAVE ◆ ${this.ctx.stats.shards}</div>
        <div class="draft-row"></div>
        <div class="draft-actions">
          <button class="draft-reroll"${canReroll ? "" : " disabled"} data-act="reroll">↻ REROLL — ◆ ${cost}</button>
          <button class="draft-skip">SKIP — RESTORE 10 HP</button>
        </div>
      `;
      const row = s.querySelector(".draft-row")!;
      for (const card of pool) {
        row.appendChild(this.cardEl(card, () => {
          this.ctx.events.emit("UI_CLICK", {});
          if (this.ctx.deck.hasEmptySlot) {
            const slot = this.ctx.deck.slots.findIndex((x) => x === null);
            this.ctx.deck.equip(card, slot);
            onDone();
          } else {
            renderSwap(card);
          }
        }));
      }
      this.wireButtons(s);
      s.querySelector('[data-act="reroll"]')!.addEventListener("click", () => {
        if (this.ctx.stats.shards < cost) { this.ctx.sfx.deny(); return; }
        this.ctx.stats.shards -= cost;
        pool = this.ctx.deck.draftChoices();
        renderPick();
      });
      s.querySelector(".draft-skip")!.addEventListener("click", () => {
        this.ctx.events.emit("UI_CLICK", {});
        this.ctx.player.hp = Math.min(this.ctx.player.maxHp, this.ctx.player.hp + 10);
        this.ctx.events.emit("HEAL", { amount: 10 });
        onDone();
      });
    };

    const renderSwap = (incoming: CardDef) => {
      s.innerHTML = `
        <div class="draft-title">REPLACE WHICH CARD?</div>
        <div class="draft-sub">${incoming.name.toUpperCase()} TAKES ITS PLACE</div>
        <div class="draft-row"></div>
        <button class="draft-skip">BACK</button>
      `;
      const row = s.querySelector(".draft-row")!;
      this.ctx.deck.slots.forEach((slotCard, i) => {
        if (!slotCard) return;
        row.appendChild(this.cardEl(slotCard, () => {
          this.ctx.events.emit("UI_CLICK", {});
          this.ctx.deck.equip(incoming, i);
          onDone();
        }, true));
      });
      this.wireButtons(s);
      s.querySelector(".draft-skip")!.addEventListener("click", renderPick);
    };

    renderPick();
  }

  // ---------------------------------------------------------------- relic draft
  showRelicDraft(choices: RelicDef[], onDone: () => void): void {
    const s = this.screen();
    let pool = choices;
    const render = () => {
      const cost = REROLL_COST;
      const canReroll = this.ctx.stats.shards >= cost && this.ctx.relics.draftChoices().length > 0;
      s.innerHTML = `
        <div class="draft-title draft-title--relic">CHOOSE A RELIC</div>
        <div class="draft-sub">A PERMANENT BOON FOR THE REST OF THE RUN &nbsp;·&nbsp; YOU HAVE ◆ ${this.ctx.stats.shards}</div>
        <div class="draft-row"></div>
        <div class="draft-actions">
          <button class="draft-reroll"${canReroll ? "" : " disabled"} data-act="reroll">↻ REROLL — ◆ ${cost}</button>
          <button class="draft-skip">SKIP — RESTORE 10 HP</button>
        </div>
      `;
      const row = s.querySelector(".draft-row")!;
      for (const relic of pool) {
        row.appendChild(this.relicEl(relic, () => {
          this.ctx.events.emit("UI_CLICK", {});
          this.ctx.relics.add(relic);
          onDone();
        }));
      }
      this.wireButtons(s);
      s.querySelector('[data-act="reroll"]')!.addEventListener("click", () => {
        if (this.ctx.stats.shards < cost) { this.ctx.sfx.deny(); return; }
        this.ctx.stats.shards -= cost;
        pool = this.ctx.relics.draftChoices();
        render();
      });
      s.querySelector(".draft-skip")!.addEventListener("click", () => {
        this.ctx.events.emit("UI_CLICK", {});
        this.ctx.player.hp = Math.min(this.ctx.player.maxHp, this.ctx.player.hp + 10);
        this.ctx.events.emit("HEAL", { amount: 10 });
        onDone();
      });
    };
    render();
  }

  // ---------------------------------------------------------------- map (fork choice)
  showMap(options: MapNode[], position: number, total: number, onPick: (i: number) => void): void {
    const s = this.screen();
    const act = options[0]?.act ?? 1;
    // Path intel: peek at the kinds waiting one chamber deeper.
    const ahead = this.ctx.run.plan.forks[position + 1] ?? [];
    const aheadIcons = ahead.length
      ? `&nbsp;&nbsp;·&nbsp;&nbsp;AHEAD: ${[...new Set(ahead.map((n) => NODE_ICON[n.kind]))].join(" ")}`
      : "";
    s.innerHTML = `
      <div class="draft-title">CHOOSE YOUR PATH</div>
      <div class="draft-sub">ACT ${ROMAN[act - 1] ?? act} &nbsp;·&nbsp; CHAMBER ${position + 1} / ${total} — pick what you'll brave next${aheadIcons}</div>
      <div class="map-row"></div>
    `;
    const row = s.querySelector(".map-row")!;
    options.forEach((node, i) => {
      const el = document.createElement("div");
      el.className = `mapnode mapnode--${node.kind}`;
      el.innerHTML = `
        <div class="mapnode__icon">${NODE_ICON[node.kind]}</div>
        <div class="mapnode__name">${node.name}</div>
        <div class="mapnode__kind">${node.kind}</div>
        <div class="mapnode__blurb">${NODE_BLURB[node.kind]}</div>
      `;
      el.addEventListener("mouseenter", () => this.ctx.events.emit("UI_HOVER", {}));
      el.addEventListener("click", () => { this.ctx.events.emit("UI_CLICK", {}); onPick(i); });
      row.appendChild(el);
    });
    this.wireButtons(s);
  }

  // ---------------------------------------------------------------- treasure
  showTreasure(onDone: () => void): void {
    const s = this.screen();
    const relicOffer = this.ctx.relics.draftChoices()[0] ?? null;
    const cardOffer = this.ctx.deck.hasEmptySlot ? (this.ctx.deck.draftChoices()[0] ?? null) : null;
    s.innerHTML = `
      <div class="draft-title">HIDDEN CACHE</div>
      <div class="draft-sub">TAKE ONE — THE REST CRUMBLES TO DUST</div>
      <div class="draft-row"></div>
      <button class="draft-skip">TAKE ◆ 40 SHARDS</button>
    `;
    const row = s.querySelector(".draft-row")!;
    if (relicOffer) {
      row.appendChild(this.relicEl(relicOffer, () => {
        this.ctx.events.emit("UI_CLICK", {});
        this.ctx.relics.add(relicOffer);
        onDone();
      }));
    }
    if (cardOffer) {
      row.appendChild(this.cardEl(cardOffer, () => {
        this.ctx.events.emit("UI_CLICK", {});
        this.ctx.deck.equip(cardOffer, this.ctx.deck.slots.findIndex((x) => x === null));
        onDone();
      }));
    }
    this.wireButtons(s);
    s.querySelector(".draft-skip")!.addEventListener("click", () => {
      this.ctx.events.emit("UI_CLICK", {});
      this.ctx.stats.shards += 40;
      this.ctx.sfx.relicPickup();
      onDone();
    });
  }

  // ---------------------------------------------------------------- rest
  showRest(onDone: () => void): void {
    const render = () => {
      const honeCount = this.ctx.deck.upgradableSlots().length;
      const s = this.screen();
      s.innerHTML = `
        <div class="panel panel--progress" style="text-align:center">
          <h2>QUIET HOLLOW</h2>
          <div class="armory-shards">${Math.ceil(this.ctx.player.hp)} / ${this.ctx.player.maxHp} HP — a moment's respite from the Rift</div>
          <div class="menu-buttons" style="margin:8px auto 0">
            <button class="btn btn--primary" data-act="heal">Mend Wounds&nbsp;&nbsp;(+40 HP)</button>
            <button class="btn btn--primary" data-act="hone"${honeCount ? "" : " disabled"}>✦ Hone a Card${honeCount ? `&nbsp;&nbsp;(${honeCount} ready)` : ""}</button>
            <button class="btn" data-act="leave">Move On</button>
          </div>
        </div>
      `;
      this.wireButtons(s);
      s.querySelector('[data-act="heal"]')!.addEventListener("click", () => {
        const h = Math.min(40, this.ctx.player.maxHp - this.ctx.player.hp);
        this.ctx.player.hp += h;
        this.ctx.events.emit("HEAL", { amount: h });
        this.ctx.sfx.relicPickup();
        onDone();
      });
      s.querySelector('[data-act="hone"]')!.addEventListener("click", renderHone);
      s.querySelector('[data-act="leave"]')!.addEventListener("click", onDone);
    };
    const renderHone = () => {
      const s = this.screen();
      s.innerHTML = `
        <div class="panel panel--progress">
          <h2>HONE A CARD</h2>
          <div class="armory-shards">Forge a card into its honed form — faster, hotter, harder-hitting</div>
          <div class="draft-row"></div>
          <button class="btn" data-act="back">Back</button>
        </div>
      `;
      const row = s.querySelector(".draft-row")!;
      const slots = this.ctx.deck.upgradableSlots();
      if (!slots.length) {
        row.innerHTML = `<div class="hist-row hist-row--quit"><span class="hist-row__label">Every card is already honed.</span></div>`;
      }
      for (const i of slots) {
        const c = this.ctx.deck.slots[i]!;
        const wrap = document.createElement("div");
        wrap.className = "hone-pick";
        wrap.appendChild(this.cardEl(c, () => {
          this.ctx.deck.upgrade(i);
          this.ctx.sfx.relicPickup();
          onDone();
        }));
        const up = document.createElement("div");
        up.className = "hone-pick__up";
        up.innerHTML = `<span class="hone-pick__tag">HONED ✦</span> ${c.upDesc}`;
        wrap.appendChild(up);
        row.appendChild(wrap);
      }
      this.wireButtons(s);
      s.querySelector('[data-act="back"]')!.addEventListener("click", render);
    };
    render();
  }

  // ---------------------------------------------------------------- event
  showEvent(onDone: () => void): void {
    const c = this.ctx;
    interface Choice { label: string; run: () => void; }
    interface Vignette { title: string; text: string; choices: Choice[]; }
    const relicOffer = c.relics.draftChoices()[0] ?? null;
    const cardOffer = c.deck.hasEmptySlot ? (c.deck.draftChoices()[0] ?? null) : null;
    const hurt = (n: number) => { c.player.hp = Math.max(1, c.player.hp - n); };
    const mend = (n: number) => { const h = Math.min(n, c.player.maxHp - c.player.hp); c.player.hp += h; if (h > 0) c.events.emit("HEAL", { amount: h }); };

    const POOL: Vignette[] = [
      {
        title: "THE BLEEDING ALTAR",
        text: "A slab slick with old light. It wants a price paid in red.",
        choices: [
          ...(relicOffer ? [{ label: `Bleed for it — lose 12 HP, gain ${relicOffer.name}`, run: () => { hurt(12); c.relics.add(relicOffer); } }] : []),
          { label: "Refuse the altar", run: () => mend(6) },
        ],
      },
      {
        title: "GLITTERING CACHE",
        text: "A humming reliquary, half-swallowed by the dark.",
        choices: [
          { label: "Smash it open — ◆ 60 shards", run: () => { c.stats.shards += 60; } },
          { label: "Pry it gently — heal 18 HP", run: () => mend(18) },
        ],
      },
      {
        title: "FORGOTTEN ARMORY",
        text: "A rack of rift-forged arms, waiting a century for a hand.",
        choices: [
          ...(cardOffer ? [{ label: `Take up ${cardOffer.name}`, run: () => c.deck.equip(cardOffer, c.deck.slots.findIndex((x) => x === null)) }] : []),
          { label: "Melt it down — ◆ 30 shards", run: () => { c.stats.shards += 30; } },
        ],
      },
      {
        title: "THE GAMBLER'S COIN",
        text: "A coin spins on its edge, far too long. The Rift loves a wager.",
        choices: [
          { label: "Call it — ◆ 50 shards, or lose 8 HP", run: () => { if (c.rng.chance(0.5)) c.stats.shards += 50; else hurt(8); } },
          { label: "Pocket the coin and leave", run: () => { c.stats.shards += 8; } },
        ],
      },
      {
        title: "A WARDEN'S ECHO",
        text: "A flicker of one of the fallen lingers here, mouthing words it can no longer speak.",
        choices: [
          { label: "Listen — mend 14 HP and surge your rhythm", run: () => { mend(14); c.tempo.gain(30); } },
          { label: "It is not your grief to carry — walk on", run: () => { c.stats.shards += 12; } },
        ],
      },
      {
        title: "THE WHETSTONE SHRINE",
        text: "A blade-worn stone hums. Temper yourself against it, and bleed for the edge.",
        choices: [
          { label: "Temper — lose 10 HP, gain +14 MAX HP", run: () => { hurt(10); c.player.maxHp += 14; c.player.hp += 14; } },
          { label: "Leave the stone cold", run: () => mend(8) },
        ],
      },
      {
        title: "THE EMBER FONT",
        text: "Light pools in a cracked basin, warm as a heartbeat. It wants to be drunk.",
        choices: [
          { label: "Drink deep — ignite to Critical tempo", run: () => c.tempo.gain(100) },
          { label: "Cup it gently — mend 16 HP", run: () => mend(16) },
        ],
      },
      {
        title: "TWIN DOORS",
        text: "Two doors in the dark. One breathes warm; the other does not breathe at all.",
        choices: [
          { label: "The warm door — mend 22 HP", run: () => mend(22) },
          { label: "The dark door — likely ◆ 80, or lose 16 HP", run: () => { if (c.rng.chance(0.65)) c.stats.shards += 80; else hurt(16); } },
        ],
      },
      {
        title: "THE STARVED RELIQUARY",
        text: "A reliquary, mouth open, hungry for the shards you've gathered.",
        choices: [
          ...(relicOffer && c.stats.shards >= 50 ? [{ label: `Feed it ◆ 50 — take ${relicOffer.name}`, run: () => { c.stats.shards -= 50; c.relics.add(relicOffer); } }] : []),
          { label: "Keep your shards — mend 10 HP", run: () => mend(10) },
        ],
      },
    ];

    const v = c.rng.pick(POOL);
    const s = this.screen();
    s.innerHTML = `
      <div class="panel" style="text-align:center;max-width:620px">
        <h2>${v.title}</h2>
        <div style="color:var(--ui-dim);font-size:15px;line-height:1.7;letter-spacing:1px;margin:6px 0 26px">${v.text}</div>
        <div class="menu-buttons" style="margin:0 auto"></div>
      </div>
    `;
    const wrap = s.querySelector(".menu-buttons")!;
    v.choices.forEach((ch, i) => {
      const b = document.createElement("button");
      b.className = `btn${i === 0 ? " btn--primary" : ""}`;
      b.textContent = ch.label;
      b.addEventListener("click", () => { this.ctx.events.emit("UI_CLICK", {}); ch.run(); onDone(); });
      wrap.appendChild(b);
    });
    this.wireButtons(s);
  }

  // ---------------------------------------------------------------- shrine (pay in blood)
  showShrine(onDone: () => void): void {
    const c = this.ctx;
    const relicOffer = c.relics.draftChoices()[0] ?? null;
    const s = this.screen();
    s.innerHTML = `
      <div class="panel" style="text-align:center;max-width:620px">
        <h2>BLOODSTONE ALTAR</h2>
        <div style="color:var(--ui-dim);font-size:15px;line-height:1.7;letter-spacing:1px;margin:6px 0 26px">The altar drinks before it gives. Name your price.</div>
        <div class="menu-buttons" style="margin:0 auto"></div>
      </div>`;
    const wrap = s.querySelector(".menu-buttons")!;
    const choices: { label: string; run: () => void }[] = [];
    if (relicOffer) choices.push({ label: `Carve your strength — lose 20 HP, take ${relicOffer.name}`, run: () => { c.player.hp = Math.max(1, c.player.hp - 20); c.relics.add(relicOffer); } });
    choices.push({ label: "Trade 10 MAX HP for ◆ 130 shards", run: () => { c.player.maxHp = Math.max(40, c.player.maxHp - 10); c.player.hp = Math.min(c.player.hp, c.player.maxHp); c.stats.shards += 130; } });
    choices.push({ label: "Leave the altar cold", run: () => { const h = Math.min(8, c.player.maxHp - c.player.hp); c.player.hp += h; if (h > 0) c.events.emit("HEAL", { amount: h }); } });
    choices.forEach((ch, i) => {
      const b = document.createElement("button");
      b.className = `btn${i === 0 ? " btn--primary" : ""}`;
      b.textContent = ch.label;
      b.addEventListener("click", () => { this.ctx.events.emit("UI_CLICK", {}); ch.run(); onDone(); });
      wrap.appendChild(b);
    });
    this.wireButtons(s);
  }

  // ---------------------------------------------------------------- gamble (wager shards)
  showGamble(onDone: () => void): void {
    const c = this.ctx;
    const relicOffer = c.relics.draftChoices()[0] ?? null;
    const render = (result?: string) => {
      const s = this.screen();
      s.innerHTML = `
        <div class="panel" style="text-align:center;max-width:620px">
          <h2>THE RIFT'S WAGER</h2>
          <div style="color:var(--ui-dim);font-size:15px;line-height:1.7;letter-spacing:1px;margin:6px 0 22px">◆ ${c.stats.shards} shards in hand. ${result ?? "The Rift loves a wager — and rarely pays fair."}</div>
          <div class="menu-buttons" style="margin:0 auto"></div>
        </div>`;
      const wrap = s.querySelector(".menu-buttons")!;
      if (result) {
        const b = document.createElement("button");
        b.className = "btn btn--primary";
        b.textContent = "Move On";
        b.addEventListener("click", () => { this.ctx.events.emit("UI_CLICK", {}); onDone(); });
        wrap.appendChild(b);
        this.wireButtons(s);
        return;
      }
      const choices: { label: string; run: () => string }[] = [];
      if (relicOffer && c.stats.shards >= 60) choices.push({ label: `Wager ◆ 60 — 65% to win ${relicOffer.name}`, run: () => { c.stats.shards -= 60; if (c.rng.chance(0.65)) { c.relics.add(relicOffer); return `The dice land true — ${relicOffer.name} is yours.`; } return "The dice betray you. The shards are gone."; } });
      if (c.stats.shards >= 40) choices.push({ label: "Wager ◆ 40 — 50% to double it", run: () => { c.stats.shards -= 40; if (c.rng.chance(0.5)) { c.stats.shards += 80; return "Doubled! ◆ 80 clatters into your hand."; } return "Lost. The Rift swallows your wager."; } });
      choices.push({ label: "Pocket your shards and walk away", run: () => "You keep what you have. Wise, perhaps." });
      choices.forEach((ch, i) => {
        const b = document.createElement("button");
        b.className = `btn${i === 0 ? " btn--primary" : ""}`;
        b.textContent = ch.label;
        b.addEventListener("click", () => { this.ctx.events.emit("UI_CLICK", {}); render(ch.run()); });
        wrap.appendChild(b);
      });
      this.wireButtons(s);
    };
    render();
  }

  // ---------------------------------------------------------------- shop (between acts)
  showShop(onDone: () => void): void {
    const PRICE = { heal: 25, card: 40, relic: 65, hone: 55 };
    const cardOffer: CardDef | null = this.ctx.deck.buyableChoices(1)[0] ?? null;
    const relicPool = this.ctx.relics.draftChoices();
    const relicOffer: RelicDef | null = relicPool.length ? relicPool[0] : null;
    const sold = { heal: false, card: false, relic: false };
    const afford = (n: number) => this.ctx.stats.shards >= n;

    const render = (mode: "shop" | "hone" = "shop") => {
      const s = this.screen();
      if (mode === "hone") {
        s.innerHTML = `
          <div class="panel panel--progress">
            <h2>HONE A CARD</h2>
            <div class="armory-shards">◆ ${this.ctx.stats.shards} — forge a card into its honed form (◆ ${PRICE.hone})</div>
            <div class="draft-row"></div>
            <button class="btn" data-act="back">Back</button>
          </div>`;
        const row = s.querySelector(".draft-row")!;
        for (const i of this.ctx.deck.upgradableSlots()) {
          const c = this.ctx.deck.slots[i]!;
          const wrap = document.createElement("div");
          wrap.className = "hone-pick";
          wrap.appendChild(this.cardEl(c, () => {
            this.ctx.deck.upgrade(i);
            this.ctx.stats.shards -= PRICE.hone;
            this.ctx.sfx.relicPickup();
            render("shop");
          }));
          const up = document.createElement("div");
          up.className = "hone-pick__up";
          up.innerHTML = `<span class="hone-pick__tag">HONED ✦</span> ${c.upDesc}`;
          wrap.appendChild(up);
          row.appendChild(wrap);
        }
        this.wireButtons(s);
        s.querySelector('[data-act="back"]')!.addEventListener("click", () => render("shop"));
        return;
      }

      const deckFull = !this.ctx.deck.hasEmptySlot;
      const offer = (id: string, icon: string, name: string, desc: string, price: number, locked: boolean, soldFlag: boolean) => `
        <div class="shop-offer${soldFlag ? " shop-offer--sold" : ""}${locked && !soldFlag ? " shop-offer--locked" : ""}" data-buy="${id}">
          <div class="shop-offer__icon">${icon}</div>
          <div class="shop-offer__name">${name}</div>
          <div class="shop-offer__desc">${desc}</div>
          <div class="shop-offer__price">${soldFlag ? "SOLD" : `◆ ${price}`}</div>
        </div>`;
      const canHone = this.ctx.deck.upgradableSlots().length > 0;
      s.innerHTML = `
        <div class="panel panel--progress">
          <h2>THE RIFT MERCHANT</h2>
          <div class="armory-shards">◆ <b>${this.ctx.stats.shards}</b> rift shards — spend now, or bank them for the Armory</div>
          <div class="shop-offers">
            ${offer("heal", "✚", "Mend Wounds", "Restore 35 HP", PRICE.heal, !afford(PRICE.heal), sold.heal)}
            ${cardOffer ? offer("card", cardOffer.icon, cardOffer.name, deckFull ? "Deck full — hone or swap instead" : cardOffer.desc, PRICE.card, !afford(PRICE.card) || deckFull, sold.card) : ""}
            ${relicOffer ? offer("relic", relicOffer.icon, relicOffer.name, relicOffer.desc, PRICE.relic, !afford(PRICE.relic), sold.relic) : ""}
            ${offer("hone", "✦", "Hone a Card", "Forge a held card stronger", PRICE.hone, !afford(PRICE.hone) || !canHone, false)}
          </div>
          <button class="btn btn--primary" data-act="leave">Leave the Shop</button>
        </div>`;
      this.wireButtons(s);
      s.querySelectorAll<HTMLElement>(".shop-offer").forEach((el) => {
        el.addEventListener("click", () => {
          const id = el.dataset.buy!;
          if (id === "heal" && !sold.heal && afford(PRICE.heal)) {
            this.ctx.stats.shards -= PRICE.heal;
            const heal = Math.min(35, this.ctx.player.maxHp - this.ctx.player.hp);
            this.ctx.player.hp += heal;
            this.ctx.events.emit("HEAL", { amount: heal });
            sold.heal = true;
            this.ctx.sfx.relicPickup();
            render();
          } else if (id === "card" && cardOffer && !sold.card && afford(PRICE.card) && this.ctx.deck.hasEmptySlot) {
            this.ctx.deck.equip(cardOffer, this.ctx.deck.slots.findIndex((x) => x === null));
            this.ctx.stats.shards -= PRICE.card;
            sold.card = true;
            this.ctx.sfx.relicPickup();
            render();
          } else if (id === "relic" && relicOffer && !sold.relic && afford(PRICE.relic)) {
            this.ctx.relics.add(relicOffer);
            this.ctx.stats.shards -= PRICE.relic;
            sold.relic = true;
            render();
          } else if (id === "hone" && afford(PRICE.hone) && this.ctx.deck.upgradableSlots().length) {
            render("hone");
          } else {
            this.ctx.sfx.deny();
          }
        });
      });
      s.querySelector('[data-act="leave"]')!.addEventListener("click", onDone);
    };
    render();
  }

  private relicEl(relic: RelicDef, onClick: () => void): HTMLElement {
    const el = document.createElement("div");
    const tier = relic.cursed ? " card--cursed" : relic.rarity === "legendary" ? " card--legendary" : relic.rarity === "rare" ? " card--rare" : "";
    el.className = `card card--relic${tier}`;
    el.style.setProperty("--accent", relic.color);
    el.innerHTML = `
      <div class="card__meta">${relic.cursed ? "cursed" : relic.rarity} relic</div>
      <div class="card__icon">${relic.icon}</div>
      <div class="card__name">${relic.name}</div>
      <div class="card__desc">${relic.desc}</div>
      <div class="card__meta">PASSIVE</div>
    `;
    el.addEventListener("mouseenter", () => this.ctx.events.emit("UI_HOVER", {}));
    el.addEventListener("click", onClick);
    return el;
  }

  private cardEl(card: CardDef, onClick: () => void, mini = false): HTMLElement {
    const el = document.createElement("div");
    el.className = `card${card.rarity === "rare" ? " card--rare" : ""}${mini ? " card--mini" : ""}`;
    el.style.setProperty("--accent", card.color);
    el.innerHTML = `
      <div class="card__meta">${card.rarity}</div>
      <div class="card__icon">${card.icon}</div>
      <div class="card__name">${card.name}</div>
      ${mini ? "" : `<div class="card__desc">${card.desc}</div>`}
      <div class="card__meta">${card.cooldown}s cooldown</div>
    `;
    el.addEventListener("mouseenter", () => this.ctx.events.emit("UI_HOVER", {}));
    el.addEventListener("click", onClick);
    return el;
  }

  // ---------------------------------------------------------------- end screens
  private unlockToasts(unlocks: UnlockedItem[]): string {
    if (!unlocks.length) return "";
    return `
      <div class="unlock-row">
        ${unlocks.map((u) => `
          <div class="unlock-toast" style="--accent:${u.def.color}">
            <div class="unlock-toast__tag">NEW ${u.kind.toUpperCase()} UNLOCKED</div>
            <div class="unlock-toast__body"><span class="unlock-toast__icon">${u.def.icon}</span> ${u.def.name}</div>
          </div>`).join("")}
      </div>`;
  }

  showDeath(stats: RunStats, unlocks: UnlockedItem[] = []): void {
    const s = this.screen();
    s.innerHTML = `
      <div class="end-title end-title--death">YOU FELL</div>
      <div class="title-rule"><span class="subtitle" style="color:var(--ui-dim)">THE RIFT KEEPS WHAT IT TAKES</span></div>
      ${this.statsRow(stats)}
      ${this.loadoutRow()}
      ${this.unlockToasts(unlocks)}
      <div class="end-buttons">
        <button class="btn btn--primary" data-act="retry">Rise Again</button>
        <button class="btn" data-act="menu">Main Menu</button>
      </div>
    `;
    this.wireButtons(s);
    s.querySelector('[data-act="retry"]')!.addEventListener("click", () => this.cb.onRetry());
    s.querySelector('[data-act="menu"]')!.addEventListener("click", () => this.cb.onMenu());
  }

  showVictory(stats: RunStats, unlocks: UnlockedItem[] = [], mercy = false): void {
    const s = this.screen();
    const title = mercy ? "THE LIGHT ENDURES" : "THE RIFT IS SEALED";
    const sub = mercy ? "YOU CARRIED THE EMBER HOME" : "A GREY DAWN — AND THE WORLD GOES ON, A LITTLE DIMMER";
    s.innerHTML = `
      <div class="end-title end-title--victory">${title}</div>
      <div class="title-rule"><span class="subtitle">${sub}</span></div>
      ${this.statsRow(stats)}
      ${this.loadoutRow()}
      ${this.unlockToasts(unlocks)}
      <div class="end-buttons">
        <button class="btn btn--primary" data-act="retry">Run It Back</button>
        <button class="btn" data-act="menu">Main Menu</button>
      </div>
    `;
    this.wireButtons(s);
    s.querySelector('[data-act="retry"]')!.addEventListener("click", () => this.cb.onRetry());
    s.querySelector('[data-act="menu"]')!.addEventListener("click", () => this.cb.onMenu());
  }

  /** Run recap: the cards + relics you finished the run holding. */
  private loadoutRow(): string {
    const cards = this.ctx.deck.slots
      .map((c, i) => c ? `<span class="recap-chip" style="--accent:${c.color}">${c.icon}&nbsp;${c.name}${this.ctx.deck.upgraded[i] ? " ✦" : ""}</span>` : "")
      .join("");
    const relics = this.ctx.relics.owned
      .map((r) => `<span class="recap-chip recap-chip--relic" style="--accent:${r.color}">${r.icon}&nbsp;${r.name}</span>`)
      .join("");
    if (!cards && !relics) return "";
    return `
      <div class="recap">
        <div class="recap__label">YOUR FINAL KIT</div>
        <div class="recap__chips">${cards}${relics}</div>
      </div>`;
  }

  private statsRow(stats: RunStats): string {
    const mins = Math.floor(stats.time / 60);
    const secs = Math.floor(stats.time % 60).toString().padStart(2, "0");
    const depthStat = stats.depth > 0
      ? `<div class="stat"><div class="stat__value">${stats.depth}</div><div class="stat__label">Rift Depth</div></div>`
      : "";
    return `
      <div class="end-stats">
        ${depthStat}
        <div class="stat"><div class="stat__value">${stats.kills}</div><div class="stat__label">Kills</div></div>
        <div class="stat"><div class="stat__value">${stats.roomsCleared}</div><div class="stat__label">Chambers</div></div>
        <div class="stat"><div class="stat__value">${Math.round(stats.damageDealt)}</div><div class="stat__label">Damage</div></div>
        <div class="stat"><div class="stat__value">${stats.perfectDodges}</div><div class="stat__label">Perfect Dodges</div></div>
        <div class="stat"><div class="stat__value">${mins}:${secs}</div><div class="stat__label">Time</div></div>
      </div>
    `;
  }

  /** One-shot act title card over the gameplay (self-removing). */
  actIntro(act: string, name: string, flavor = ""): void {
    const el = document.createElement("div");
    el.className = "actcard";
    el.innerHTML = `
      <div class="actcard__act">${act}</div>
      <div class="actcard__name">${name}</div>
      ${flavor ? `<div class="actcard__flavor">${flavor}</div>` : ""}`;
    this.root.appendChild(el);
    window.setTimeout(() => el.remove(), 2700);
  }

  /**
   * Opening story crawl: lines advance on click (or auto), SKIP bails out.
   * Plays over the live arena before the first chamber loads.
   */
  storyIntro(lines: string[], onDone: () => void): void {
    const s = this.screen("");
    s.classList.add("story");
    let idx = 0;
    let autoTimer = 0;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(autoTimer);
      onDone();
    };
    const show = () => {
      if (idx >= lines.length) {
        finish();
        return;
      }
      const line = lines[idx];
      s.innerHTML = `
        <div class="story__line">${line}</div>
        <div class="story__hint">CLICK TO CONTINUE</div>
        <button class="story-skip">SKIP ▸</button>
      `;
      s.querySelector(".story-skip")!.addEventListener("click", (e) => {
        e.stopPropagation();
        finish();
      });
      idx++;
      window.clearTimeout(autoTimer);
      // Hold long enough to read comfortably (reading speed + a small buffer) but
      // not so long it feels like the game stalled — and a click always skips ahead.
      const readMs = Math.min(6000, Math.max(3400, 1400 + line.replace(/<[^>]*>/g, "").length * 42));
      autoTimer = window.setTimeout(show, readMs);
    };
    s.addEventListener("click", show);
    show();
  }
}
