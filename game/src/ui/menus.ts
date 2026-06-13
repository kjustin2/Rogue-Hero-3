import type { Ctx, RunStats } from "../game/ctx";
import type { CardDef } from "../game/cards";
import type { RelicDef } from "../game/relics";
import { CARDS, cardById } from "../game/cards";
import { RELICS } from "../game/relics";
import { HEROES, type HeroDef } from "../game/heroes";
import { COSMETICS } from "../game/cosmetics";
import { ROMAN } from "../game/run";
import type { UnlockedItem } from "../game/profile";

export interface Settings {
  volume: number;
  shake: number;
  quality: "low" | "medium" | "high";
}

const SETTINGS_KEY = "rh3v2-settings";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { volume: 0.7, shake: 1, quality: "high", ...JSON.parse(raw) };
  } catch { /* fall through */ }
  return { volume: 0.7, shake: 1, quality: "high" };
}

export interface MenuCallbacks {
  onStartRun(hero: HeroDef): void;
  onContinueRun(): void;
  onResume(): void;
  onAbandon(): void;
  onRetry(): void;
  onMenu(): void;
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

  constructor(private ctx: Ctx, private cb: MenuCallbacks) {
    this.root = document.getElementById("overlay")!;
    this.settings = loadSettings();
  }

  applySettings(): void {
    this.ctx.sfx.setVolume(this.settings.volume);
    this.ctx.cam.shakeScale = this.settings.shake;
    this.ctx.stage.applyQuality(this.settings.quality);
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
    const s = this.screen("");
    const p = this.ctx.profile.data;
    const unlockedCount = p.unlocks.length;
    const totalCount = CARDS.length + RELICS.length;
    const strip = p.runs > 0
      ? `WINS ${p.wins} &nbsp;·&nbsp; RUNS ${p.runs} &nbsp;·&nbsp; FURTHEST: ACT ${ROMAN[Math.max(0, p.furthestAct - 1)]} &nbsp;·&nbsp; ARSENAL ${unlockedCount}/${totalCount} &nbsp;·&nbsp; ◆ ${p.shards}`
      : `THE RIFT AWAITS ITS FIRST CHALLENGER`;
    const hasSave = this.cb.hasSave();
    s.innerHTML = `
      <div class="title">ROGUE<br>HERO</div>
      <div class="title-rule"><span class="subtitle">III &nbsp;·&nbsp; The Ember Rift</span></div>
      <div class="menu-strip">${strip}</div>
      <div class="menu-buttons">
        ${hasSave ? '<button class="btn btn--primary" data-act="continue">Continue Run</button>' : ""}
        <button class="btn${hasSave ? "" : " btn--primary"}" data-act="start">${hasSave ? "New Run" : "Begin Run"}</button>
        <button class="btn" data-act="armory">Armory</button>
        <button class="btn" data-act="progress">Progress</button>
        <button class="btn" data-act="howto">How to Play</button>
        <button class="btn" data-act="settings">Settings</button>
      </div>
      <div class="menu-footer">THREE ACTS &nbsp;·&nbsp; FORGED IN THE RIFT</div>
    `;
    this.wireButtons(s);
    s.querySelector('[data-act="continue"]')?.addEventListener("click", () => this.cb.onContinueRun());
    s.querySelector('[data-act="start"]')!.addEventListener("click", () => this.showHeroSelect());
    s.querySelector('[data-act="armory"]')!.addEventListener("click", () => this.showArmory(() => this.showMain()));
    s.querySelector('[data-act="progress"]')!.addEventListener("click", () => this.showProgress(() => this.showMain()));
    s.querySelector('[data-act="howto"]')!.addEventListener("click", () => this.showHowTo(() => this.showMain()));
    s.querySelector('[data-act="settings"]')!.addEventListener("click", () => this.showSettings(() => this.showMain()));
  }

  // ---------------------------------------------------------------- hero select
  showHeroSelect(): void {
    const s = this.screen();
    s.innerHTML = `
      <div class="draft-title">CHOOSE YOUR HERO</div>
      <div class="draft-sub">EACH FIGHTS THE RIFT THEIR OWN WAY</div>
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
          this.cb.onStartRun(hero);
        });
      }
      row.appendChild(el);
    }
    this.wireButtons(s);
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
        const hex = `#${c.color.toString(16).padStart(6, "0")}`;
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

    const gridItem = (kind: "card" | "relic" | "hero", def: { id: string; icon: string; name: string; color: string }): string => {
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
        </div>
        <h3 class="prog-h3">HEROES</h3>
        <div class="prog-grid">${HEROES.map((h) => gridItem("hero", h)).join("")}</div>
        <h3 class="prog-h3">CARDS</h3>
        <div class="prog-grid">${CARDS.map((c) => gridItem("card", c)).join("")}</div>
        <h3 class="prog-h3">RELICS</h3>
        <div class="prog-grid">${RELICS.map((r) => gridItem("relic", r)).join("")}</div>
        <h3 class="prog-h3">RECENT RUNS</h3>
        <div class="prog-history">${p.history.length ? p.history.map(historyRow).join("") : '<div class="hist-row hist-row--quit"><span class="hist-row__label">No runs yet — the Rift awaits.</span></div>'}</div>
        <button class="btn">Back</button>
      </div>
    `;
    this.wireButtons(s);
    s.querySelector(".btn")!.addEventListener("click", back);
  }

  showHowTo(back: () => void): void {
    const s = this.screen();
    s.innerHTML = `
      <div class="panel">
        <h2>HOW TO PLAY</h2>
        <div class="controls-grid">
          <b>W A S D</b><span>Move</span>
          <b>MOUSE</b><span>Aim — you always face the cursor</span>
          <b>LMB</b><span>Sword combo — third hit is a 360° finisher</span>
          <b>SPACE</b><span>Dodge roll — invulnerable; dodge <i>through</i> an attack at the last instant for a <span style="color:#66ffee">PERFECT DODGE</span></span>
          <b>1 · 2 · 3</b><span>Cast cards — drafted after each chamber</span>
          <b>F</b><span>CRASH — at 85+ tempo, detonate your heat as a nova</span>
        </div>
        <div style="margin-top:26px;font-size:14px;line-height:1.7;color:var(--ui-dim);letter-spacing:1px">
          <span style="color:var(--ui-text)">TEMPO</span> is everything. Aggression heats you up — more damage, more speed.
          Getting hit or hiding bleeds you cold. Stay hot. Crash big.
        </div>
        <button class="btn">Back</button>
      </div>
    `;
    this.wireButtons(s);
    s.querySelector(".btn")!.addEventListener("click", back);
  }

  showSettings(back: () => void): void {
    const s = this.screen();
    s.innerHTML = `
      <div class="panel">
        <h2>SETTINGS</h2>
        <div class="setting-row">
          <span>MASTER VOLUME</span>
          <input type="range" min="0" max="1" step="0.05" value="${this.settings.volume}" data-set="volume">
        </div>
        <div class="setting-row">
          <span>SCREEN SHAKE</span>
          <input type="range" min="0" max="1.5" step="0.1" value="${this.settings.shake}" data-set="shake">
        </div>
        <div class="setting-row">
          <span>GRAPHICS QUALITY</span>
          <div class="quality-row">
            ${(["low", "medium", "high"] as const).map((q) =>
              `<button class="qbtn${this.settings.quality === q ? " qbtn--on" : ""}" data-q="${q}">${q.toUpperCase()}</button>`
            ).join("")}
          </div>
        </div>
        <button class="btn">Back</button>
      </div>
    `;
    this.wireButtons(s);
    s.querySelectorAll<HTMLInputElement>("input[data-set]").forEach((inp) => {
      inp.addEventListener("input", () => {
        if (inp.dataset.set === "volume") this.settings.volume = parseFloat(inp.value);
        if (inp.dataset.set === "shake") this.settings.shake = parseFloat(inp.value);
        this.applySettings();
      });
    });
    s.querySelectorAll<HTMLButtonElement>(".qbtn").forEach((b) => {
      b.addEventListener("click", () => {
        this.settings.quality = b.dataset.q as Settings["quality"];
        this.applySettings();
        this.showSettings(back);
      });
    });
    s.querySelector(".btn")!.addEventListener("click", back);
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
          <button class="btn btn--danger" data-act="abandon">Abandon Run</button>
        </div>
      </div>
    `;
    this.wireButtons(s);
    s.querySelector('[data-act="resume"]')!.addEventListener("click", () => this.cb.onResume());
    s.querySelector('[data-act="settings"]')!.addEventListener("click", () => this.showSettings(() => this.showPause()));
    s.querySelector('[data-act="abandon"]')!.addEventListener("click", () => this.cb.onAbandon());
  }

  // ---------------------------------------------------------------- draft
  showDraft(choices: CardDef[], onDone: () => void): void {
    const s = this.screen();
    const renderPick = () => {
      s.innerHTML = `
        <div class="draft-title">CHOOSE A CARD</div>
        <div class="draft-sub">IT JOINS YOUR HAND FOR THE REST OF THE RUN</div>
        <div class="draft-row"></div>
        <button class="draft-skip">SKIP — RESTORE 10 HP</button>
      `;
      const row = s.querySelector(".draft-row")!;
      for (const card of choices) {
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
    s.innerHTML = `
      <div class="draft-title draft-title--relic">CHOOSE A RELIC</div>
      <div class="draft-sub">A PERMANENT BOON FOR THE REST OF THE RUN</div>
      <div class="draft-row"></div>
      <button class="draft-skip">SKIP — RESTORE 10 HP</button>
    `;
    const row = s.querySelector(".draft-row")!;
    for (const relic of choices) {
      row.appendChild(this.relicEl(relic, () => {
        this.ctx.events.emit("UI_CLICK", {});
        this.ctx.relics.add(relic);
        onDone();
      }));
    }
    this.wireButtons(s);
    s.querySelector(".draft-skip")!.addEventListener("click", () => {
      this.ctx.events.emit("UI_CLICK", {});
      this.ctx.player.hp = Math.min(this.ctx.player.maxHp, this.ctx.player.hp + 10);
      this.ctx.events.emit("HEAL", { amount: 10 });
      onDone();
    });
  }

  private relicEl(relic: RelicDef, onClick: () => void): HTMLElement {
    const el = document.createElement("div");
    el.className = `card card--relic${relic.rarity === "rare" ? " card--rare" : ""}`;
    el.style.setProperty("--accent", relic.color);
    el.innerHTML = `
      <div class="card__meta">${relic.rarity} relic</div>
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

  showVictory(stats: RunStats, unlocks: UnlockedItem[] = []): void {
    const s = this.screen();
    s.innerHTML = `
      <div class="end-title end-title--victory">RIFT SEALED</div>
      <div class="title-rule"><span class="subtitle">THE CORE LIES SILENT</span></div>
      ${this.statsRow(stats)}
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

  private statsRow(stats: RunStats): string {
    const mins = Math.floor(stats.time / 60);
    const secs = Math.floor(stats.time % 60).toString().padStart(2, "0");
    return `
      <div class="end-stats">
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
      s.innerHTML = `
        <div class="story__line">${lines[idx]}</div>
        <div class="story__hint">CLICK TO CONTINUE</div>
        <button class="story-skip">SKIP ▸</button>
      `;
      s.querySelector(".story-skip")!.addEventListener("click", (e) => {
        e.stopPropagation();
        finish();
      });
      idx++;
      window.clearTimeout(autoTimer);
      autoTimer = window.setTimeout(show, 3400);
    };
    s.addEventListener("click", show);
    show();
  }
}
