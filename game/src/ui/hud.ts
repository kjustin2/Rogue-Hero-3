import * as THREE from "three";
import type { Ctx } from "../game/ctx";
import { ZONES, CRASH_THRESHOLD } from "../game/tempo";
import { ROMAN } from "../game/run";
import type { RunPlan } from "../game/mapgen";

const STREAK_LABELS: [number, string][] = [
  [12, "UNSTOPPABLE"],
  [8, "RAMPAGE"],
  [5, "FRENZY"],
  [3, "KILL STREAK"],
];

/**
 * In-run DOM HUD: player plate, card slots with cooldown sweeps, the tempo
 * dial, boss bar, banners and streak popups. Built once; update() refreshes
 * values per frame, events drive the transient pieces.
 */
export class Hud {
  private root: HTMLElement;
  private hpFill!: HTMLElement;
  private hpGhost!: HTMLElement;
  private hpShield!: HTMLElement;
  private hpText!: HTMLElement;
  private roomName!: HTMLElement;
  private roomProgress!: HTMLElement;
  private pips: HTMLElement[] = [];
  private slotEls: { el: HTMLElement; icon: HTMLElement; name: HTMLElement; cd: HTMLElement; cdnum: HTMLElement }[] = [];
  private tempoDial!: HTMLElement;
  private tempoValue!: HTMLElement;
  private tempoZoneName!: HTMLElement;
  private tempoCrash!: HTMLElement;
  private bossBar!: HTMLElement;
  private bossName!: HTMLElement;
  private bossFill!: HTMLElement;
  private streakEl!: HTMLElement;
  private streakCount!: HTMLElement;
  private streakLabel!: HTMLElement;
  private bannerEl!: HTMLElement;
  private bannerTitle!: HTMLElement;
  private bannerSub!: HTMLElement;
  private edgeGlow!: HTMLElement;
  private lowHp!: HTMLElement;
  private shardsEl!: HTMLElement;
  private lastShards = 0;
  private flashRing!: HTMLElement;
  private hintsEl!: HTMLElement;
  private screenFlash!: HTMLElement;
  private objectiveEl!: HTMLElement;
  private comboEl!: HTMLElement;
  private comboNum!: HTMLElement;
  private hitArrow!: HTMLElement;
  private threatEls: HTMLElement[] = [];
  private threatVec = new THREE.Vector3();
  private combo = 0;
  private comboExpiry = 0;
  private lastComboMilestone = 0;
  private ghostHp = 1;
  private lastSlotIds: (string | null)[] = [null, null, null];
  private lastUpgraded = [false, false, false];
  private lastCds = [0, 0, 0];

  constructor(private ctx: Ctx) {
    this.root = document.getElementById("hud")!;
    this.build();
    this.subscribe();
    this.setVisible(false);
  }

  private build(): void {
    this.root.innerHTML = `
      <div class="edgeglow"></div>
      <div class="lowhp"></div>
      <div class="screenflash"></div>
      <div class="hitarrow"></div>
      <div class="threatmarkers"></div>
      <div class="flashring"></div>
      <div class="letterbox letterbox--top"></div>
      <div class="letterbox letterbox--bottom"></div>
      <div class="plate">
        <div class="plate__name">THE BLADE</div>
        <div class="plate__hpwrap">
          <div class="plate__ghost"></div>
          <div class="plate__hp"></div>
          <div class="plate__shield" style="width:0"></div>
        </div>
        <div class="plate__hptext"></div>
        <div class="relicrow"></div>
      </div>
      <div class="roominfo">
        <div class="roominfo__name"></div>
        <div class="roominfo__progress"></div>
        <div class="roominfo__pips"></div>
        <div class="roominfo__shards">◆ 0</div>
        <div class="roominfo__depth"></div>
      </div>
      <div class="cards"></div>
      <div class="tempo">
        <div class="tempo__dial">
          <div class="tempo__tick"></div>
          <div class="tempo__value"><span class="num">50</span><span class="tempo__zonename">FLOWING</span></div>
        </div>
        <div class="tempo__crash">CRASH&nbsp;&nbsp;[F]</div>
      </div>
      <div class="bossbar">
        <div class="bossbar__name"></div>
        <div class="bossbar__wrap"><div class="bossbar__fill"></div></div>
      </div>
      <div class="streak"><div class="streak__count"></div><div class="streak__label"></div></div>
      <div class="combo"><span class="combo__n">0</span><span class="combo__x">HIT</span></div>
      <div class="banner"><div class="banner__title"></div><div class="banner__sub"></div></div>
      <div class="objective"></div>
      <div class="hints">
        <div><b>WASD</b> move&nbsp;&nbsp;<b>LMB</b> attack&nbsp;&nbsp;<b>SPACE</b> dodge</div>
        <div><b>1·2·3</b> cards&nbsp;&nbsp;<b>F</b> crash at 85+&nbsp;&nbsp;<b>ESC</b> pause</div>
      </div>
    `;
    const q = (sel: string) => this.root.querySelector(sel) as HTMLElement;
    this.hpFill = q(".plate__hp");
    this.hpGhost = q(".plate__ghost");
    this.hpShield = q(".plate__shield");
    this.hpText = q(".plate__hptext");
    this.roomName = q(".roominfo__name");
    this.roomProgress = q(".roominfo__progress");
    this.shardsEl = q(".roominfo__shards");
    this.tempoDial = q(".tempo__dial");
    this.tempoValue = q(".tempo__value .num");
    this.tempoZoneName = q(".tempo__zonename");
    this.tempoCrash = q(".tempo__crash");
    this.bossBar = q(".bossbar");
    this.bossName = q(".bossbar__name");
    this.bossFill = q(".bossbar__fill");
    this.streakEl = q(".streak");
    this.streakCount = q(".streak__count");
    this.streakLabel = q(".streak__label");
    this.bannerEl = q(".banner");
    this.bannerTitle = q(".banner__title");
    this.bannerSub = q(".banner__sub");
    this.edgeGlow = q(".edgeglow");
    this.lowHp = q(".lowhp");
    this.flashRing = q(".flashring");
    this.hintsEl = q(".hints");
    this.screenFlash = q(".screenflash");
    this.objectiveEl = q(".objective");
    this.comboEl = q(".combo");
    this.comboNum = q(".combo__n");
    this.hitArrow = q(".hitarrow");

    // Room pips are built per-run from the generated map (buildPips).

    // Card slots
    const cardsWrap = q(".cards");
    for (let i = 0; i < 3; i++) {
      const el = document.createElement("div");
      el.className = "slot slot--empty";
      el.innerHTML = `
        <div class="slot__key">${i + 1}</div>
        <div class="slot__icon"></div>
        <div class="slot__name"></div>
        <div class="slot__cd" style="--cd:0%"></div>
        <div class="slot__cdnum"></div>
      `;
      cardsWrap.appendChild(el);
      this.slotEls.push({
        el,
        icon: el.querySelector(".slot__icon") as HTMLElement,
        name: el.querySelector(".slot__name") as HTMLElement,
        cd: el.querySelector(".slot__cd") as HTMLElement,
        cdnum: el.querySelector(".slot__cdnum") as HTMLElement,
      });
    }

    const threats = q(".threatmarkers");
    for (let i = 0; i < 5; i++) {
      const el = document.createElement("div");
      el.className = "threat";
      el.innerHTML = `<span></span>`;
      threats.appendChild(el);
      this.threatEls.push(el);
    }
  }

  private subscribe(): void {
    const { events } = this.ctx;
    events.on("KILL_STREAK", ({ count }) => {
      this.streakCount.textContent = `${count}×`;
      this.streakLabel.textContent = STREAK_LABELS.find(([n]) => count >= n)?.[1] ?? "KILL STREAK";
      this.replay(this.streakEl, "streak--show");
    });
    events.on("ROOM_CLEARED", () => this.banner("ROOM CLEARED", "", "banner--clear"));
    events.on("BOSS_INTRO", ({ name }) => {
      // The name slams in as a title card at the cutscene's materialize beat (main.ts);
      // here we just prime the boss bar to reveal once the boss has formed.
      this.bossName.textContent = name;
      this.bossFill.style.width = "100%";
      window.setTimeout(() => this.bossBar.classList.add("bossbar--show"), 2600);
    });
    events.on("BOSS_PHASE", ({ line }) => this.banner(line, "", "banner--boss"));
    events.on("BOSS_HP", ({ hp, maxHp }) => {
      this.bossFill.style.width = `${(hp / maxHp) * 100}%`;
    });
    events.on("BOSS_DEFEATED", () => this.bossBar.classList.remove("bossbar--show"));
    events.on("ROOM_START", ({ index, name, isBoss, act }) => {
      const roman = ROMAN[act - 1] ?? `${act}`;
      const forks = this.ctx.run.plan.forks;
      const actForks = forks.map((f, i) => ({ a: f[0]?.act ?? 0, i })).filter((x) => x.a === act).map((x) => x.i);
      const within = actForks.indexOf(index) + 1;
      this.roomName.textContent = name;
      this.roomProgress.textContent = isBoss
        ? `ACT ${roman} · BOSS`
        : `ACT ${roman} · NODE ${within} / ${actForks.length}`;
      this.pips.forEach((p, i) => {
        p.classList.toggle("pip--done", i < index);
        p.classList.toggle("pip--current", i === index);
      });
      if (!isBoss) {
        this.bossBar.classList.remove("bossbar--show");
        // Boss rooms announce via BOSS_INTRO; act openers via ACT_START
        if (index !== actForks[0]) this.banner(name, `ACT ${roman}`, "banner--long");
      }
    });
    events.on("PERFECT_DODGE", () => {
      this.replay(this.flashRing, "flashring--go");
      this.flash("#7df3ff", 0.32);
    });
    // Screen flashes on the big beats — additive 'screen' blend, fast fade.
    events.on("CRASH", () => this.flash("#ff5a4a", 0.5));
    events.on("COLD_CRASH", () => this.flash("#6cc4ff", 0.42));
    events.on("BOSS_DEFEATED", () => this.flash("#ffe39a", 0.55));
    events.on("RUN_VICTORY", () => this.flash("#ffffff", 0.72));
    // Combo counter — climbs on every enemy hit, resets when the player is hit.
    events.on("ENEMY_HIT", () => this.bumpCombo());
    events.on("PLAYER_HIT", ({ srcX, srcZ }) => {
      this.resetCombo();
      this.showHitDir(srcX, srcZ);
    });
    events.on("RELIC_ADDED", () => this.rebuildRelicRow());
    events.on("CARD_FAIL", ({ slot }) => {
      const s = this.slotEls[slot];
      if (s) this.replay(s.el, "slot--shake");
    });
    events.on("CARD_PRIME", ({ slot, color }) => {
      const s = this.slotEls[slot];
      if (!s) return;
      s.el.style.setProperty("--accent", color);
      this.replay(s.el, "slot--cast");
    });
  }

  private replay(el: HTMLElement, cls: string): void {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  /** Brief full-screen additive flash (screen blend), fades out fast. */
  flash(color: string, intensity: number): void {
    const k = this.ctx.cam.shakeScale <= 0 ? 0.35 : 1; // reduce-motion-friendly
    const el = this.screenFlash;
    el.style.transition = "none";
    el.style.background = color;
    el.style.opacity = String(intensity * k);
    void el.offsetWidth;
    el.style.transition = "opacity 0.45s ease-out";
    el.style.opacity = "0";
  }

  private bumpCombo(): void {
    this.combo++;
    this.comboExpiry = performance.now() + 2200;
    this.comboNum.textContent = String(this.combo);
    this.comboEl.classList.add("combo--show");
    this.comboEl.classList.toggle("combo--hot", this.combo >= 10);
    this.replay(this.comboEl, "combo--bump");
    if (this.combo >= this.lastComboMilestone + 10) {
      this.lastComboMilestone += 10;
      this.ctx.sfx.comboMilestone(this.combo);
    }
  }

  private resetCombo(): void {
    this.combo = 0;
    this.lastComboMilestone = 0;
    this.comboEl.classList.remove("combo--show", "combo--hot");
  }

  /** Directional damage glow at the screen edge the blow came from. */
  private showHitDir(srcX: number, srcZ: number): void {
    const p = this.ctx.player.pos;
    const cam = this.ctx.stage.camera;
    const from = new THREE.Vector3(srcX, 1, srcZ).project(cam);
    const at = new THREE.Vector3(p.x, 1, p.z).project(cam);
    const ang = Math.atan2(from.y - at.y, from.x - at.x); // NDC: +y up
    const deg = (-ang * 180) / Math.PI; // CSS: +y down, clockwise
    const el = this.hitArrow;
    el.style.setProperty("--ang", `${deg}deg`);
    el.style.transition = "none";
    el.style.opacity = "0.85";
    void el.offsetWidth;
    el.style.transition = "opacity 0.55s ease-out";
    el.style.opacity = "0";
  }

  banner(title: string, sub: string, cls = ""): void {
    this.bannerTitle.textContent = title;
    this.bannerSub.textContent = sub;
    this.bannerEl.className = `banner ${cls}`;
    this.replay(this.bannerEl, "banner--show");
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? "block" : "none";
    if (v) {
      this.ghostHp = this.ctx.player.hp / this.ctx.player.maxHp;
      this.rebuildRelicRow();
      // Nameplate follows the chosen hero
      const plateName = this.root.querySelector(".plate__name") as HTMLElement;
      plateName.textContent = this.ctx.player.hero.name.toUpperCase();
    }
  }

  private rebuildRelicRow(): void {
    const row = this.root.querySelector(".relicrow") as HTMLElement;
    row.innerHTML = "";
    for (const r of this.ctx.relics.owned) {
      const chip = document.createElement("div");
      chip.className = "relic";
      chip.style.setProperty("--accent", r.color);
      chip.textContent = r.icon;
      chip.title = `${r.name} — ${r.desc}`;
      row.appendChild(chip);
    }
  }

  /** Hide movement hints once the player has cleared a room — they know. */
  fadeHints(): void {
    this.hintsEl.style.transition = "opacity 1.5s";
    this.hintsEl.style.opacity = "0";
  }

  /** Rebuild the room pips for a freshly generated run map (one pip per fork). */
  buildPips(plan: RunPlan): void {
    const depth = this.ctx.stats.depth;
    (this.root.querySelector(".roominfo__depth") as HTMLElement).textContent = depth > 0 ? `◈ RIFT DEPTH ${depth}` : "";
    const wrap = this.root.querySelector(".roominfo__pips") as HTMLElement;
    wrap.innerHTML = "";
    this.pips = [];
    const forks = plan.forks;
    for (let i = 0; i < forks.length; i++) {
      if (i > 0 && (forks[i][0]?.act ?? 0) !== (forks[i - 1][0]?.act ?? 0)) {
        const sep = document.createElement("div");
        sep.className = "pip-sep";
        wrap.appendChild(sep);
      }
      const pip = document.createElement("div");
      pip.className = "pip" + (forks[i].some((n) => n.kind === "boss") ? " pip--boss" : "");
      wrap.appendChild(pip);
      this.pips.push(pip);
    }
  }

  /** Persistent objective line (tutorial / training). Pass null to hide. */
  setObjective(text: string | null): void {
    this.objectiveEl.textContent = text ?? "";
    this.objectiveEl.classList.toggle("objective--on", !!text);
  }

  /** Cinematic letterbox bars for cutscenes. */
  setLetterbox(on: boolean): void {
    this.root.querySelectorAll(".letterbox").forEach((el) => el.classList.toggle("letterbox--on", on));
  }

  private spareEl: HTMLElement | null = null;
  /** The Hollow Star's mercy prompt: show with a hold-progress fill (frac 0–1). */
  setSparePrompt(show: boolean, frac = 0): void {
    if (!this.spareEl) {
      this.spareEl = document.createElement("div");
      this.spareEl.className = "spareprompt";
      this.spareEl.innerHTML = `<div class="spareprompt__text">HOLD&nbsp;[Q]&nbsp;TO SPARE THE STAR<br><span>— or strike it down —</span></div><div class="spareprompt__bar"><div class="spareprompt__fill"></div></div>`;
      this.root.appendChild(this.spareEl);
    }
    this.spareEl.classList.toggle("spareprompt--on", show);
    (this.spareEl.querySelector(".spareprompt__fill") as HTMLElement).style.width = `${Math.round(Math.min(1, frac) * 100)}%`;
  }

  update(): void {
    const { player, tempo, deck } = this.ctx;

    // Combo decays if you go too long without landing a hit
    if (this.combo > 0 && performance.now() > this.comboExpiry) this.resetCombo();

    // HP
    const frac = Math.max(0, player.hp / player.maxHp);
    this.hpFill.style.width = `${frac * 100}%`;
    this.hpGhost.style.width = `${Math.max(frac, this.ghostHp) * 100}%`;
    if (this.ghostHp > frac) this.ghostHp = Math.max(frac, this.ghostHp - 0.0045);
    else this.ghostHp = frac;
    this.hpFill.classList.toggle("plate__hp--low", frac < 0.3);
    this.hpText.textContent = `${Math.ceil(player.hp)} / ${player.maxHp}${player.shield > 0 ? `  ·  ${Math.ceil(player.shield)} SHIELD` : ""}`;
    this.hpShield.style.width = `${Math.min(1, player.shield / player.maxHp) * 100}%`;
    this.lowHp.classList.toggle("lowhp--on", frac < 0.3 && player.alive);

    // Tempo dial: 0–100 maps onto a 280° sweep (77.7% of the conic)
    const zone = tempo.zone;
    const pct = (tempo.value / 100) * 77.7;
    this.tempoDial.style.setProperty("--pct", `${pct}%`);
    this.tempoDial.style.setProperty("--zone", zone.css);
    this.tempoValue.textContent = String(Math.round(tempo.value));
    this.tempoValue.parentElement!.style.setProperty("--zone", zone.css);
    this.tempoZoneName.textContent = zone.zone.toUpperCase();
    this.tempoCrash.classList.toggle("tempo__crash--ready", tempo.value >= CRASH_THRESHOLD);
    // Shard counter (pulse on gain)
    const shards = this.ctx.stats.shards;
    if (shards !== this.lastShards) {
      this.shardsEl.textContent = `◆ ${shards}`;
      this.replay(this.shardsEl, "shards--pulse");
      this.lastShards = shards;
    }

    // Edge glow at hot/critical
    const hotIdx = ZONES.findIndex((z) => z.zone === zone.zone);
    this.edgeGlow.style.setProperty("--zone", zone.css);
    this.edgeGlow.style.opacity = hotIdx >= 2 ? (hotIdx === 3 ? "0.55" : "0.28") : "0";

    // Card slots
    for (let i = 0; i < 3; i++) {
      const s = this.slotEls[i];
      const card = deck.slots[i];
      const id = card?.id ?? null;
      const up = deck.upgraded[i];
      if (id !== this.lastSlotIds[i] || up !== this.lastUpgraded[i]) {
        this.lastSlotIds[i] = id;
        this.lastUpgraded[i] = up;
        s.el.classList.toggle("slot--empty", !card);
        s.el.classList.toggle("slot--honed", !!card && up);
        s.icon.textContent = card?.icon ?? "";
        s.name.textContent = card ? (up ? `${card.name} +` : card.name) : "";
        s.el.style.setProperty("--accent", card?.color ?? "rgba(255,255,255,0.2)");
      }
      if (card) {
        const cd = deck.cooldowns[i];
        const fracCd = Math.max(0, cd / card.cooldown);
        // The dark sweep covers only the *remaining* cooldown — a ready card
        // is fully bright (--cd marks where the bright wedge ends).
        s.cd.style.setProperty("--cd", `${(1 - fracCd) * 100}%`);
        s.cdnum.textContent = cd > 0.05 ? cd.toFixed(cd > 1 ? 0 : 1) : "";
        // Aegis stays "pressable" while the shield is up (re-press detonates)
        const pressable = cd <= 0 || (card.id === "aegis" && this.ctx.caster.aegisActive);
        s.el.classList.toggle("slot--ready", pressable);
        if (this.lastCds[i] > 0 && cd <= 0) this.replay(s.el, "slot--ready-flash");
        this.lastCds[i] = cd;
      } else {
        s.cd.style.setProperty("--cd", "100%");
        s.cdnum.textContent = "";
        s.el.classList.remove("slot--ready");
      }
    }
    this.updateThreatMarkers();
  }

  private updateThreatMarkers(): void {
    const p = this.ctx.player;
    if (!p.alive || this.root.style.display === "none") {
      for (const el of this.threatEls) el.classList.remove("threat--on", "threat--boss");
      return;
    }
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    const cam = this.ctx.stage.camera;
    const enemies = this.ctx.enemies.living()
      .map((e) => ({ e, d: Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z) }))
      .filter(({ d }) => d > 5)
      .sort((a, b) => (a.e.kind === "boss" ? -1 : b.e.kind === "boss" ? 1 : a.d - b.d));
    let shown = 0;
    for (const { e, d } of enemies) {
      if (shown >= this.threatEls.length) break;
      const v = this.threatVec.set(e.pos.x, e.pos.y + 1.0, e.pos.z).project(cam);
      const behind = v.z > 1;
      const off = behind || v.x < -0.88 || v.x > 0.88 || v.y < -0.8 || v.y > 0.8;
      if (!off) continue;
      let sx = (v.x * 0.5 + 0.5) * w;
      let sy = (-v.y * 0.5 + 0.5) * h;
      if (!Number.isFinite(sx) || !Number.isFinite(sy) || behind) {
        const ang = Math.atan2(e.pos.x - p.pos.x, e.pos.z - p.pos.z) - this.ctx.player.facing;
        sx = w * 0.5 + Math.sin(ang) * w * 0.45;
        sy = h * 0.5 - Math.cos(ang) * h * 0.38;
      }
      sx = Math.min(w - 58, Math.max(58, sx));
      sy = Math.min(h - 58, Math.max(58, sy));
      const ang = Math.atan2(sy - h * 0.5, sx - w * 0.5);
      const el = this.threatEls[shown++];
      el.style.left = `${sx}px`;
      el.style.top = `${sy}px`;
      el.style.setProperty("--ang", `${ang}rad`);
      el.style.setProperty("--scale", `${Math.max(0.72, 1.15 - Math.min(1, d / 20) * 0.32)}`);
      el.classList.add("threat--on");
      el.classList.toggle("threat--boss", e.kind === "boss");
    }
    for (let i = shown; i < this.threatEls.length; i++) {
      this.threatEls[i].classList.remove("threat--on", "threat--boss");
    }
  }
}
