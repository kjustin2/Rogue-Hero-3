import type { Ctx, RunStats } from "../game/ctx";
import type { CardDef } from "../game/cards";

export interface Settings {
  volume: number;
  shake: number;
}

const SETTINGS_KEY = "rh3v2-settings";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { volume: 0.7, shake: 1, ...JSON.parse(raw) };
  } catch { /* fall through */ }
  return { volume: 0.7, shake: 1 };
}

export interface MenuCallbacks {
  onStartRun(): void;
  onResume(): void;
  onAbandon(): void;
  onRetry(): void;
  onMenu(): void;
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
    s.innerHTML = `
      <div class="title">ROGUE<br>HERO</div>
      <div class="title-rule"><span class="subtitle">III &nbsp;·&nbsp; The Ember Rift</span></div>
      <div class="menu-buttons">
        <button class="btn btn--primary" data-act="start">Begin Run</button>
        <button class="btn" data-act="howto">How to Play</button>
        <button class="btn" data-act="settings">Settings</button>
      </div>
      <div class="menu-footer">A VERTICAL SLICE &nbsp;·&nbsp; FORGED IN THE RIFT</div>
    `;
    this.wireButtons(s);
    s.querySelector('[data-act="start"]')!.addEventListener("click", () => this.cb.onStartRun());
    s.querySelector('[data-act="howto"]')!.addEventListener("click", () => this.showHowTo(() => this.showMain()));
    s.querySelector('[data-act="settings"]')!.addEventListener("click", () => this.showSettings(() => this.showMain()));
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
  showDeath(stats: RunStats): void {
    const s = this.screen();
    s.innerHTML = `
      <div class="end-title end-title--death">YOU FELL</div>
      <div class="title-rule"><span class="subtitle" style="color:var(--ui-dim)">THE RIFT KEEPS WHAT IT TAKES</span></div>
      ${this.statsRow(stats)}
      <div class="end-buttons">
        <button class="btn btn--primary" data-act="retry">Rise Again</button>
        <button class="btn" data-act="menu">Main Menu</button>
      </div>
    `;
    this.wireButtons(s);
    s.querySelector('[data-act="retry"]')!.addEventListener("click", () => this.cb.onRetry());
    s.querySelector('[data-act="menu"]')!.addEventListener("click", () => this.cb.onMenu());
  }

  showVictory(stats: RunStats): void {
    const s = this.screen();
    s.innerHTML = `
      <div class="end-title end-title--victory">RIFT SEALED</div>
      <div class="title-rule"><span class="subtitle">THE PIT WARDEN IS NO MORE</span></div>
      ${this.statsRow(stats)}
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
  actIntro(act: string, name: string): void {
    const el = document.createElement("div");
    el.className = "actcard";
    el.innerHTML = `<div class="actcard__act">${act}</div><div class="actcard__name">${name}</div>`;
    this.root.appendChild(el);
    window.setTimeout(() => el.remove(), 2700);
  }
}
