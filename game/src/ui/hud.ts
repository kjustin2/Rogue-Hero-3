import type { Ctx } from "../game/ctx";
import { ZONES, CRASH_THRESHOLD } from "../game/tempo";
import { ROOMS, ROMAN } from "../game/run";

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
  private ghostHp = 1;
  private lastSlotIds: (string | null)[] = [null, null, null];
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
      <div class="flashring"></div>
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
      <div class="banner"><div class="banner__title"></div><div class="banner__sub"></div></div>
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

    // Room pips, grouped by act
    const pipsWrap = q(".roominfo__pips");
    for (let i = 0; i < ROOMS.length; i++) {
      if (i > 0 && ROOMS[i].act !== ROOMS[i - 1].act) {
        const sep = document.createElement("div");
        sep.className = "pip-sep";
        pipsWrap.appendChild(sep);
      }
      const pip = document.createElement("div");
      pip.className = "pip" + (ROOMS[i].bossKind ? " pip--boss" : "");
      pipsWrap.appendChild(pip);
      this.pips.push(pip);
    }

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
  }

  private subscribe(): void {
    const { events } = this.ctx;
    events.on("KILL_STREAK", ({ count }) => {
      this.streakCount.textContent = `${count}×`;
      this.streakLabel.textContent = STREAK_LABELS.find(([n]) => count >= n)?.[1] ?? "KILL STREAK";
      this.replay(this.streakEl, "streak--show");
    });
    events.on("ROOM_CLEARED", () => this.banner("ROOM CLEARED", "", "banner--clear"));
    events.on("BOSS_INTRO", ({ name, title }) => {
      this.banner(name, title, "banner--boss");
      this.bossName.textContent = name;
      this.bossFill.style.width = "100%";
      window.setTimeout(() => this.bossBar.classList.add("bossbar--show"), 1300);
    });
    events.on("BOSS_PHASE", ({ line }) => this.banner(line, "", "banner--boss"));
    events.on("BOSS_HP", ({ hp, maxHp }) => {
      this.bossFill.style.width = `${(hp / maxHp) * 100}%`;
    });
    events.on("BOSS_DEFEATED", () => this.bossBar.classList.remove("bossbar--show"));
    events.on("ROOM_START", ({ index, name, isBoss }) => {
      const room = ROOMS[index];
      const roman = ROMAN[room.act - 1];
      const firstOfAct = ROOMS.findIndex((r) => r.act === room.act);
      const actSize = ROOMS.filter((r) => r.act === room.act).length;
      this.roomName.textContent = name;
      this.roomProgress.textContent = isBoss
        ? `ACT ${roman} · BOSS`
        : `ACT ${roman} · CHAMBER ${index - firstOfAct + 1} / ${actSize}`;
      this.pips.forEach((p, i) => {
        p.classList.toggle("pip--done", i < index);
        p.classList.toggle("pip--current", i === index);
      });
      if (!isBoss) {
        this.bossBar.classList.remove("bossbar--show");
        // Boss rooms announce via BOSS_INTRO; act openers via ACT_START
        if (index !== firstOfAct) this.banner(name, `ACT ${roman}`, "");
      }
    });
    events.on("PERFECT_DODGE", () => this.replay(this.flashRing, "flashring--go"));
    events.on("RELIC_ADDED", () => this.rebuildRelicRow());
    events.on("CARD_FAIL", ({ slot }) => {
      const s = this.slotEls[slot];
      if (s) this.replay(s.el, "slot--shake");
    });
  }

  private replay(el: HTMLElement, cls: string): void {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
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

  update(): void {
    const { player, tempo, deck } = this.ctx;

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
      if (id !== this.lastSlotIds[i]) {
        this.lastSlotIds[i] = id;
        s.el.classList.toggle("slot--empty", !card);
        s.icon.textContent = card?.icon ?? "";
        s.name.textContent = card?.name ?? "";
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
  }
}
