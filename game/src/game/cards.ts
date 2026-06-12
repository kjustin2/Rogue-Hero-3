import * as THREE from "three";
import { angleDelta } from "../core/math";
import type { Ctx } from "./ctx";
import type { Enemy } from "./enemies";

export interface CardDef {
  id: string;
  name: string;
  desc: string;
  cooldown: number;
  /** CSS accent for UI. */
  color: string;
  glow: number;
  icon: string;
  rarity: "common" | "uncommon" | "rare";
  tempo: number;
}

export const CARDS: CardDef[] = [
  { id: "dash-strike", name: "Dash Strike", desc: "Lunge through enemies, carving everything in your path.", cooldown: 5, color: "#5fe0ff", glow: 0x5fe0ff, icon: "➤", rarity: "common", tempo: 8 },
  { id: "arc-bolt", name: "Arc Bolt", desc: "A piercing lance of energy that punches through the pack.", cooldown: 3, color: "#7fa8ff", glow: 0x7fa8ff, icon: "✦", rarity: "common", tempo: 4 },
  { id: "cleave", name: "Cleave", desc: "A massive sweeping blow. Crowds are an invitation.", cooldown: 5, color: "#ffc266", glow: 0xffc266, icon: "⚔", rarity: "common", tempo: 6 },
  { id: "frost-nova", name: "Frost Nova", desc: "Detonate the cold. Damages and freezes everything nearby.", cooldown: 9, color: "#9fd8ff", glow: 0x9fd8ff, icon: "❄", rarity: "uncommon", tempo: 5 },
  { id: "phase-step", name: "Phase Step", desc: "Blink to the cursor, leaving a phantom that detonates.", cooldown: 7, color: "#c98fff", glow: 0xc98fff, icon: "⟡", rarity: "uncommon", tempo: 5 },
  { id: "mine-field", name: "Mine Field", desc: "Scatter four arc-mines around you. Herd them in.", cooldown: 9, color: "#ff9a5f", glow: 0xff9a5f, icon: "✸", rarity: "uncommon", tempo: 8 },
  { id: "aegis", name: "Aegis", desc: "A 25-point barrier. Press again to detonate it early.", cooldown: 12, color: "#7fc8ff", glow: 0x7fc8ff, icon: "⛨", rarity: "uncommon", tempo: 0 },
  { id: "chain-lightning", name: "Chain Lightning", desc: "A bolt that arcs between up to three foes.", cooldown: 7, color: "#ffe066", glow: 0xffe066, icon: "⚡", rarity: "rare", tempo: 7 },
  // --- Expansion set (most begin locked; milestones open them up)
  { id: "sunder", name: "Sunder", desc: "Four eruptions march down a line in front of you.", cooldown: 6, color: "#d8b25f", glow: 0xd8b25f, icon: "⫸", rarity: "common", tempo: 6 },
  { id: "charged-lance", name: "Charged Lance", desc: "One colossal piercing bolt. The recoil moves you.", cooldown: 7, color: "#9fd0ff", glow: 0x9fd0ff, icon: "➹", rarity: "uncommon", tempo: 7 },
  { id: "meteor-call", name: "Meteor Call", desc: "Mark the cursor. A heartbeat later, the sky answers.", cooldown: 9, color: "#ff8a4d", glow: 0xff8a4d, icon: "✴", rarity: "uncommon", tempo: 8 },
  { id: "bleeding-edge", name: "Bleeding Edge", desc: "A wide cleave that leaves deep, ticking wounds.", cooldown: 6, color: "#ff6b7a", glow: 0xff6b7a, icon: "❖", rarity: "common", tempo: 6 },
  { id: "storm-conduit", name: "Storm Conduit", desc: "For 5s your sword hits arc sparks to a nearby foe.", cooldown: 11, color: "#fff09f", glow: 0xfff09f, icon: "≋", rarity: "rare", tempo: 5 },
  { id: "gravity-well", name: "Gravity Well", desc: "Drag the pack into one point, then pop it.", cooldown: 9, color: "#b08fff", glow: 0xb08fff, icon: "◉", rarity: "rare", tempo: 6 },
  { id: "ward-pulse", name: "Ward Pulse", desc: "Mend 12 HP and hurl everything near you away.", cooldown: 14, color: "#8fffc8", glow: 0x8fffc8, icon: "✚", rarity: "uncommon", tempo: 0 },
  { id: "ember-wave", name: "Ember Wave", desc: "A cone of fire that keeps burning after it lands.", cooldown: 8, color: "#ffb35f", glow: 0xffb35f, icon: "✺", rarity: "uncommon", tempo: 7 },
];

export const STARTING_HAND = ["dash-strike", "arc-bolt"];

export function cardById(id: string): CardDef {
  const c = CARDS.find((c) => c.id === id);
  if (!c) throw new Error(`Unknown card: ${id}`);
  return c;
}

interface Mine {
  x: number;
  z: number;
  life: number;
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
}

interface Phantom {
  x: number;
  z: number;
  timer: number;
  group: THREE.Group;
}

/**
 * Routes card casts to handlers and owns lingering card entities
 * (mines, phantom decoys, aegis state). Casting returns false when the
 * card has no valid use right now (e.g. no targets for chain lightning).
 */
interface Bleed {
  enemy: Enemy;
  ticks: number;
  timer: number;
  dmg: number;
  color: number;
}

interface Meteor {
  x: number;
  z: number;
  timer: number;
  pulseAcc: number;
}

interface SunderPulse {
  x: number;
  z: number;
  timer: number;
}

interface Well {
  x: number;
  z: number;
  timer: number;
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
}

export class CardCaster {
  private mines: Mine[] = [];
  private phantoms: Phantom[] = [];
  private aegisTimer = 0;
  private fakeSwing = -1;
  private mineGeo = new THREE.ConeGeometry(0.28, 0.4, 4);
  private bleeds: Bleed[] = [];
  private meteors: Meteor[] = [];
  private pulses: SunderPulse[] = [];
  private wells: Well[] = [];
  private conduitTimer = 0;
  /** Re-entrancy latch: conduit sparks must never trigger more sparks. */
  private sparking = false;

  constructor(private ctx: Ctx) {
    ctx.events.on("ENEMY_HIT", ({ x, z, killed }) => {
      if (this.conduitTimer <= 0 || this.sparking || killed) return;
      // Arc a spark to the nearest OTHER enemy
      let best: Enemy | null = null;
      let bestD = 6;
      for (const e of this.ctx.enemies.living()) {
        const d = Math.hypot(e.pos.x - x, e.pos.z - z);
        if (d > 0.8 && d < bestD) {
          bestD = d;
          best = e;
        }
      }
      if (!best) return;
      this.sparking = true;
      this.ctx.combat.dealDamage(best, 4, { kb: 1 });
      this.sparking = false;
      this.lightningVisual([{ x, z }, { x: best.pos.x, z: best.pos.z }]);
    });
  }

  /** Apply a damage-over-time stack (Bleeding Edge, Ember Wave burns). */
  addBleed(enemy: Enemy, ticks: number, dmg: number, color = 0xff6b7a): void {
    this.bleeds.push({ enemy, ticks, timer: 0.5, dmg, color });
  }

  /** True if Aegis is up — pressing its slot again detonates it. */
  get aegisActive(): boolean {
    return this.aegisTimer > 0 && this.ctx.player.shield > 0;
  }

  cast(def: CardDef): boolean {
    const ok = this.dispatch(def);
    if (ok) {
      this.ctx.events.emit("CARD_CAST", { id: def.id });
      if (def.tempo > 0) this.ctx.tempo.gain(def.tempo);
      this.ctx.sfx.cast(def.id);
    }
    return ok;
  }

  private dispatch(def: CardDef): boolean {
    const { player, input, combat, enemies, fx } = this.ctx;
    const aim = input.aimPoint;

    switch (def.id) {
      case "dash-strike": {
        const dx = aim.x - player.pos.x;
        const dz = aim.z - player.pos.z;
        const len = Math.hypot(dx, dz) || 1;
        const dist = Math.min(6, Math.max(3, len));
        const nx = dx / len;
        const nz = dz / len;
        // Damage everything along the path
        for (const e of enemies.living()) {
          const ex = e.pos.x - player.pos.x;
          const ez = e.pos.z - player.pos.z;
          const along = ex * nx + ez * nz;
          if (along < -0.5 || along > dist + 1) continue;
          const perp = Math.abs(ex * nz - ez * nx);
          if (perp < 1.3 + e.radius) {
            combat.dealDamage(e, 18, { kbX: ex - along * nx, kbZ: ez - along * nz, kb: 5, heavy: false, countCombo: true });
          }
        }
        this.ctx.controller.push(nx * dist * 9, nz * dist * 9);
        this.ctx.controller.externalMoveTimer = 0.16;
        player.spawnGhost();
        window.setTimeout(() => player.alive && player.spawnGhost(), 60);
        window.setTimeout(() => player.alive && player.spawnGhost(), 120);
        fx.burst({
          x: player.pos.x, y: 0.7, z: player.pos.z,
          count: 18, color: 0x5fe0ff, speed: [2, 7], up: 0.4, size: [0.35, 0.7], life: [0.2, 0.5], gravity: -2, drag: 3,
        });
        fx.ring(player.pos.x, player.pos.z, { radius: 2.2, color: 0x5fe0ff, duration: 0.3 });
        this.ctx.cam.pulseFov(0.7);
        this.ctx.cam.addTrauma(0.12);
        return true;
      }

      case "arc-bolt": {
        this.ctx.projectiles.fire(player.pos.x, player.pos.z, player.facing, {
          speed: 30, dmg: 16, color: 0x7fa8ff, radius: 0.36, range: 24, pierce: true,
        });
        // Muzzle flash + recoil sell the shot
        const mx = player.pos.x + Math.sin(player.facing) * 1.2;
        const mz = player.pos.z + Math.cos(player.facing) * 1.2;
        fx.burst({
          x: mx, y: 1.0, z: mz,
          count: 12, color: [0x7fa8ff, 0xffffff],
          speed: [3, 8], up: 0.3, size: [0.3, 0.65], life: [0.12, 0.3], gravity: -2, drag: 4,
        });
        this.ctx.cam.kick(-Math.sin(player.facing), -Math.cos(player.facing), 2.2);
        return true;
      }

      case "cleave": {
        const arc = (170 * Math.PI) / 180;
        const hits = combat.meleeSweep(player.facing, arc, 3.6, 26, 7, true);
        combat.slashVisual(arc, 3.6, true);
        this.fakeSwing = 0;
        if (hits > 0) {
          this.ctx.cam.addTrauma(0.3);
          this.ctx.cam.kick(Math.sin(player.facing), Math.cos(player.facing), 4);
        }
        return true;
      }

      case "frost-nova": {
        const R = 5.5;
        for (const e of enemies.living()) {
          const dx = e.pos.x - player.pos.x;
          const dz = e.pos.z - player.pos.z;
          if (Math.hypot(dx, dz) < R + e.radius) {
            combat.dealDamage(e, 12, { kbX: dx, kbZ: dz, kb: 3 });
            e.freeze(1.8);
          }
        }
        fx.ring(player.pos.x, player.pos.z, { radius: R, color: 0x9fd8ff, duration: 0.6 });
        fx.burst({
          x: player.pos.x, y: 0.8, z: player.pos.z,
          count: 36, color: [0x9fd8ff, 0xffffff],
          speed: [4, 11], up: 0.4, size: [0.4, 0.8], life: [0.3, 0.7], gravity: -3, drag: 3,
        });
        this.ctx.stage.punch(0.2);
        return true;
      }

      case "phase-step": {
        const from = player.pos.clone();
        const dx = aim.x - player.pos.x;
        const dz = aim.z - player.pos.z;
        const len = Math.hypot(dx, dz) || 1;
        const dist = Math.min(7, len);
        // Phantom stays behind
        this.spawnPhantom(from.x, from.z);
        player.pos.x += (dx / len) * dist;
        player.pos.z += (dz / len) * dist;
        player.spawnGhost();
        this.ctx.cam.pulseFov(0.5);
        fx.burst({
          x: from.x, y: 1, z: from.z,
          count: 16, color: 0xc98fff, speed: [1, 5], up: 0.7, size: [0.35, 0.7], life: [0.25, 0.5], gravity: -1, drag: 3,
        });
        fx.burst({
          x: player.pos.x, y: 1, z: player.pos.z,
          count: 16, color: 0xc98fff, speed: [1, 5], up: 0.7, size: [0.35, 0.7], life: [0.25, 0.5], gravity: -1, drag: 3,
        });
        return true;
      }

      case "mine-field": {
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + this.ctx.rng.range(0, 0.8);
          const r = 2.2 + this.ctx.rng.range(0, 1.2);
          const mx = player.pos.x + Math.sin(a) * r;
          const mz = player.pos.z + Math.cos(a) * r;
          this.spawnMine(mx, mz);
          fx.ring(mx, mz, { radius: 1.2, color: 0xff9a5f, duration: 0.35 });
        }
        return true;
      }

      case "aegis": {
        if (this.aegisActive) {
          this.detonateAegis();
          return true;
        }
        player.shield = 25;
        this.aegisTimer = 4;
        this.ctx.events.emit("SHIELD_GAINED", { amount: 25 });
        fx.ring(player.pos.x, player.pos.z, { radius: 2, color: 0x7fc8ff, duration: 0.5 });
        fx.burst({
          x: player.pos.x, y: 1.2, z: player.pos.z,
          count: 18, color: [0x7fc8ff, 0xffffff],
          speed: [1, 4], up: 0.8, size: [0.3, 0.6], life: [0.3, 0.6], gravity: 1, drag: 2,
        });
        return true;
      }

      case "chain-lightning": {
        const targets: { x: number; z: number }[] = [{ x: player.pos.x, z: player.pos.z }];
        const pool = enemies.living();
        const hit = new Set<number>();
        let cur = { x: player.pos.x, z: player.pos.z };
        const maxChain = this.ctx.relics.has("chain-amulet") ? 5 : 3;
        for (let n = 0; n < maxChain; n++) {
          let best: (typeof pool)[number] | null = null;
          let bestD = n === 0 ? 12 : 7;
          for (const e of pool) {
            if (hit.has(e.id)) continue;
            const d = Math.hypot(e.pos.x - cur.x, e.pos.z - cur.z);
            if (d < bestD) {
              bestD = d;
              best = e;
            }
          }
          if (!best) break;
          hit.add(best.id);
          targets.push({ x: best.pos.x, z: best.pos.z });
          this.ctx.combat.dealDamage(best, 14, { kb: 2, kbX: best.pos.x - cur.x, kbZ: best.pos.z - cur.z });
          cur = { x: best.pos.x, z: best.pos.z };
        }
        if (targets.length < 2) return false; // no targets — don't burn the cooldown
        this.lightningVisual(targets);
        this.ctx.stage.punch(0.15);
        this.ctx.cam.addTrauma(0.12);
        return true;
      }

      case "sunder": {
        for (let i = 0; i < 4; i++) {
          const d = 2.0 + i * 1.9;
          this.pulses.push({
            x: player.pos.x + Math.sin(player.facing) * d,
            z: player.pos.z + Math.cos(player.facing) * d,
            timer: 0.1 + i * 0.12,
          });
        }
        this.fakeSwing = 0;
        this.ctx.cam.kick(Math.sin(player.facing), Math.cos(player.facing), 2.5);
        return true;
      }

      case "charged-lance": {
        this.ctx.projectiles.fire(player.pos.x, player.pos.z, player.facing, {
          speed: 34, dmg: 34, color: 0x9fd0ff, radius: 0.55, range: 26, pierce: true,
        });
        const mx = player.pos.x + Math.sin(player.facing) * 1.3;
        const mz = player.pos.z + Math.cos(player.facing) * 1.3;
        fx.burst({
          x: mx, y: 1.0, z: mz,
          count: 20, color: [0x9fd0ff, 0xffffff],
          speed: [4, 11], up: 0.3, size: [0.4, 0.8], life: [0.15, 0.35], gravity: -2, drag: 4,
        });
        // The recoil is real
        this.ctx.controller.push(-Math.sin(player.facing) * 7, -Math.cos(player.facing) * 7);
        this.ctx.cam.kick(-Math.sin(player.facing), -Math.cos(player.facing), 5);
        this.ctx.cam.addTrauma(0.2);
        return true;
      }

      case "meteor-call": {
        const dx = aim.x - player.pos.x;
        const dz = aim.z - player.pos.z;
        const len = Math.hypot(dx, dz);
        const dist = Math.min(12, len);
        const nx = len > 0.01 ? dx / len : Math.sin(player.facing);
        const nz = len > 0.01 ? dz / len : Math.cos(player.facing);
        const tx = player.pos.x + nx * dist;
        const tz = player.pos.z + nz * dist;
        // Friendly mark — fx ring, not the enemy-threat telegraph language
        fx.ring(tx, tz, { radius: 3.2, color: 0xff8a4d, duration: 0.9 });
        this.meteors.push({ x: tx, z: tz, timer: 0.9, pulseAcc: 0 });
        return true;
      }

      case "bleeding-edge": {
        const arc = (150 * Math.PI) / 180;
        const range = 3.4;
        let hits = 0;
        for (const e of enemies.living()) {
          const dx = e.pos.x - player.pos.x;
          const dz = e.pos.z - player.pos.z;
          const d = Math.hypot(dx, dz);
          if (d > range + e.radius) continue;
          if (Math.abs(angleDelta(player.facing, Math.atan2(dx, dz))) > arc / 2) continue;
          combat.dealDamage(e, 14, { kbX: dx, kbZ: dz, kb: 4, countCombo: true });
          this.addBleed(e, 5, 2);
          hits++;
        }
        combat.slashVisual(arc, range, false);
        this.fakeSwing = 0;
        if (hits > 0) this.ctx.cam.addTrauma(0.18);
        return true;
      }

      case "storm-conduit": {
        this.conduitTimer = 5;
        fx.ring(player.pos.x, player.pos.z, { radius: 2.2, color: 0xfff09f, duration: 0.5 });
        fx.burst({
          x: player.pos.x, y: 1.4, z: player.pos.z,
          count: 22, color: [0xfff09f, 0xffffff],
          speed: [1, 5], up: 1.0, size: [0.3, 0.6], life: [0.3, 0.6], gravity: 0.5, drag: 2,
        });
        return true;
      }

      case "gravity-well": {
        const dx = aim.x - player.pos.x;
        const dz = aim.z - player.pos.z;
        const len = Math.hypot(dx, dz);
        const dist = Math.min(10, len);
        const nx = len > 0.01 ? dx / len : Math.sin(player.facing);
        const nz = len > 0.01 ? dz / len : Math.cos(player.facing);
        const wx = player.pos.x + nx * dist;
        const wz = player.pos.z + nz * dist;
        const mat = new THREE.MeshBasicMaterial({
          color: 0xb08fff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 10), mat);
        mesh.position.set(wx, 1.0, wz);
        this.ctx.stage.scene.add(mesh);
        this.wells.push({ x: wx, z: wz, timer: 1.2, mesh, mat });
        fx.ring(wx, wz, { radius: 5, color: 0xb08fff, duration: 0.6 });
        return true;
      }

      case "ward-pulse": {
        const heal = Math.min(12, player.maxHp - player.hp);
        player.hp += heal;
        if (heal > 0) this.ctx.events.emit("HEAL", { amount: heal });
        for (const e of enemies.living()) {
          const dx = e.pos.x - player.pos.x;
          const dz = e.pos.z - player.pos.z;
          if (Math.hypot(dx, dz) < 4 + e.radius) e.shove(dx, dz, 11);
        }
        fx.ring(player.pos.x, player.pos.z, { radius: 4, color: 0x8fffc8, duration: 0.5 });
        fx.burst({
          x: player.pos.x, y: 1.0, z: player.pos.z,
          count: 28, color: [0x8fffc8, 0xffffff],
          speed: [3, 8], up: 0.7, size: [0.35, 0.7], life: [0.3, 0.6], gravity: -1, drag: 3,
        });
        this.ctx.stage.punch(0.12);
        return true;
      }

      case "ember-wave": {
        const arc = (90 * Math.PI) / 180;
        const range = 4.6;
        for (const e of enemies.living()) {
          const dx = e.pos.x - player.pos.x;
          const dz = e.pos.z - player.pos.z;
          const d = Math.hypot(dx, dz);
          if (d > range + e.radius) continue;
          if (Math.abs(angleDelta(player.facing, Math.atan2(dx, dz))) > arc / 2) continue;
          combat.dealDamage(e, 18, { kbX: dx, kbZ: dz, kb: 3, heavy: true, countCombo: true });
          this.addBleed(e, 4, 2, 0xffb35f);
        }
        // Fire cone read: bursts marching out along the arc
        for (let ring = 1; ring <= 3; ring++) {
          const r = (range / 3) * ring;
          for (let i = -2; i <= 2; i++) {
            const a = player.facing + (i / 2) * (arc / 2) * 0.9;
            fx.burst({
              x: player.pos.x + Math.sin(a) * r, y: 0.4, z: player.pos.z + Math.cos(a) * r,
              count: 4, color: [0xffb35f, 0xff7733],
              speed: [1, 4], up: 1.2, size: [0.4, 0.8], life: [0.25, 0.55], gravity: -1, drag: 2,
            });
          }
        }
        this.ctx.cam.kick(Math.sin(player.facing), Math.cos(player.facing), 3);
        this.ctx.stage.punch(0.12);
        return true;
      }
    }
    return false;
  }

  private spawnMine(x: number, z: number): void {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x331505, emissive: 0xff9a5f, emissiveIntensity: 1.4, flatShading: true,
    });
    const mesh = new THREE.Mesh(this.mineGeo, mat);
    mesh.position.set(x, 0.22, z);
    this.ctx.stage.scene.add(mesh);
    this.mines.push({ x, z, life: 8, mesh, mat });
  }

  private spawnPhantom(x: number, z: number): void {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: 0xc98fff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.9, 4, 8), mat);
    m.position.y = 1;
    group.add(m);
    group.position.set(x, 0, z);
    this.ctx.stage.scene.add(group);
    this.phantoms.push({ x, z, timer: 0.8, group });
  }

  private detonateAegis(): void {
    const { player, fx } = this.ctx;
    player.shield = 0;
    this.aegisTimer = 0;
    const R = 3;
    for (const e of this.ctx.enemies.living()) {
      const dx = e.pos.x - player.pos.x;
      const dz = e.pos.z - player.pos.z;
      if (Math.hypot(dx, dz) < R + e.radius) {
        this.ctx.combat.dealDamage(e, 15, { kbX: dx, kbZ: dz, kb: 8, heavy: true });
      }
    }
    fx.ring(player.pos.x, player.pos.z, { radius: R, color: 0x7fc8ff, duration: 0.45 });
    fx.burst({
      x: player.pos.x, y: 1, z: player.pos.z,
      count: 30, color: [0x7fc8ff, 0xffffff],
      speed: [4, 10], up: 0.5, size: [0.4, 0.8], life: [0.25, 0.55], gravity: -3, drag: 3,
    });
    this.ctx.sfx.shieldBreak();
    this.ctx.events.emit("SHIELD_BROKEN", {});
  }

  private lightningVisual(points: { x: number; z: number }[]): void {
    const scene = this.ctx.stage.scene;
    const mat = new THREE.LineBasicMaterial({ color: 0xffe066, transparent: true, opacity: 1 });
    const verts: THREE.Vector3[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const segs = 6;
      for (let s = 0; s <= segs; s++) {
        const t = s / segs;
        const jx = s === 0 || s === segs ? 0 : (Math.random() - 0.5) * 0.7;
        const jz = s === 0 || s === segs ? 0 : (Math.random() - 0.5) * 0.7;
        verts.push(new THREE.Vector3(a.x + (b.x - a.x) * t + jx, 1.1 + Math.random() * 0.4, a.z + (b.z - a.z) * t + jz));
      }
      this.ctx.fx.burst({
        x: b.x, y: 1, z: b.z,
        count: 10, color: 0xffe066, speed: [2, 6], up: 0.6, size: [0.3, 0.6], life: [0.15, 0.35], gravity: -3, drag: 3,
      });
    }
    const geo = new THREE.BufferGeometry().setFromPoints(verts);
    const line = new THREE.Line(geo, mat);
    scene.add(line);
    const start = performance.now();
    const fade = () => {
      const k = (performance.now() - start) / 180;
      if (k >= 1) {
        scene.remove(line);
        geo.dispose();
        mat.dispose();
        return;
      }
      mat.opacity = 1 - k;
      requestAnimationFrame(fade);
    };
    requestAnimationFrame(fade);
  }

  clear(): void {
    for (const m of this.mines) this.ctx.stage.scene.remove(m.mesh);
    for (const p of this.phantoms) this.ctx.stage.scene.remove(p.group);
    for (const w of this.wells) {
      this.ctx.stage.scene.remove(w.mesh);
      w.mat.dispose();
    }
    this.mines = [];
    this.phantoms = [];
    this.wells = [];
    this.bleeds = [];
    this.meteors = [];
    this.pulses = [];
    this.conduitTimer = 0;
    this.aegisTimer = 0;
    this.ctx.player.shield = 0;
  }

  update(dt: number): void {
    this.conduitTimer = Math.max(0, this.conduitTimer - dt);
    // Conduit aura while active
    if (this.conduitTimer > 0 && Math.random() < dt * 8) {
      const p = this.ctx.player;
      this.ctx.fx.burst({
        x: p.pos.x, y: 1.6, z: p.pos.z, count: 1, color: 0xfff09f,
        speed: [0.5, 2], up: 1.2, size: [0.25, 0.5], life: [0.2, 0.4], gravity: 0, drag: 2, jitter: 0.5,
      });
    }

    // Bleed / burn ticks (each tick flows through the dealDamage pipeline)
    for (let i = this.bleeds.length - 1; i >= 0; i--) {
      const b = this.bleeds[i];
      if (!b.enemy.alive || b.ticks <= 0) {
        this.bleeds.splice(i, 1);
        continue;
      }
      b.timer -= dt;
      if (b.timer <= 0) {
        b.timer = 0.5;
        b.ticks--;
        this.ctx.combat.dealDamage(b.enemy, b.dmg, {});
      }
    }

    // Sunder pulses marching down their line
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const pu = this.pulses[i];
      pu.timer -= dt;
      if (pu.timer > 0) continue;
      this.pulses.splice(i, 1);
      this.ctx.fx.ring(pu.x, pu.z, { radius: 1.5, color: 0xd8b25f, duration: 0.3 });
      this.ctx.fx.burst({
        x: pu.x, y: 0.4, z: pu.z,
        count: 12, color: [0xd8b25f, 0xfff0c0],
        speed: [2, 7], up: 1.3, size: [0.35, 0.7], life: [0.2, 0.45], gravity: -5, drag: 2.5,
      });
      this.ctx.sfx.explosion();
      for (const e of this.ctx.enemies.living()) {
        const dx = e.pos.x - pu.x;
        const dz = e.pos.z - pu.z;
        if (Math.hypot(dx, dz) < 1.5 + e.radius) {
          this.ctx.combat.dealDamage(e, 10, { kbX: dx, kbZ: dz, kb: 3, countCombo: true });
        }
      }
    }

    // Meteors
    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const m = this.meteors[i];
      m.timer -= dt;
      m.pulseAcc -= dt;
      if (m.pulseAcc <= 0 && m.timer > 0.15) {
        m.pulseAcc = 0.3;
        this.ctx.fx.ring(m.x, m.z, { radius: 3.2, color: 0xff8a4d, duration: 0.28 });
      }
      if (m.timer > 0) continue;
      this.meteors.splice(i, 1);
      const R = 3.2;
      this.ctx.fx.burst({
        x: m.x, y: 1.2, z: m.z,
        count: 50, color: [0xff8a4d, 0xffcc66, 0xffffff],
        speed: [4, 14], up: 0.9, size: [0.5, 1.2], life: [0.3, 0.8], gravity: -7, drag: 2.3,
      });
      this.ctx.fx.ring(m.x, m.z, { radius: R, color: 0xff8a4d, duration: 0.5 });
      this.ctx.fx.ring(m.x, m.z, { radius: R * 0.55, color: 0xffffff, duration: 0.35 });
      this.ctx.cam.addTrauma(0.35);
      this.ctx.stage.punch(0.2);
      this.ctx.sfx.explosion();
      for (const e of this.ctx.enemies.living()) {
        const dx = e.pos.x - m.x;
        const dz = e.pos.z - m.z;
        if (Math.hypot(dx, dz) < R + e.radius) {
          this.ctx.combat.dealDamage(e, 30, { kbX: dx, kbZ: dz, kb: 8, heavy: true, countCombo: true });
        }
      }
    }

    // Gravity wells: pull, then pop
    for (let i = this.wells.length - 1; i >= 0; i--) {
      const w = this.wells[i];
      w.timer -= dt;
      w.mesh.scale.setScalar(1 + Math.sin(w.timer * 20) * 0.15);
      w.mat.opacity = 0.45 + Math.sin(w.timer * 14) * 0.2;
      for (const e of this.ctx.enemies.living()) {
        const dx = w.x - e.pos.x;
        const dz = w.z - e.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 5.5 && d > 0.4) e.shove(dx, dz, 22 * dt);
      }
      if (w.timer > 0) continue;
      this.wells.splice(i, 1);
      this.ctx.stage.scene.remove(w.mesh);
      w.mesh.geometry.dispose();
      w.mat.dispose();
      this.ctx.fx.ring(w.x, w.z, { radius: 2.6, color: 0xb08fff, duration: 0.4 });
      this.ctx.fx.burst({
        x: w.x, y: 1.0, z: w.z,
        count: 30, color: [0xb08fff, 0xffffff],
        speed: [3, 9], up: 0.6, size: [0.4, 0.8], life: [0.25, 0.55], gravity: -3, drag: 3,
      });
      this.ctx.sfx.phantomBoom();
      for (const e of this.ctx.enemies.living()) {
        const dx = e.pos.x - w.x;
        const dz = e.pos.z - w.z;
        if (Math.hypot(dx, dz) < 2.6 + e.radius) {
          this.ctx.combat.dealDamage(e, 10, { kbX: dx, kbZ: dz, kb: 2, countCombo: true });
        }
      }
    }

    // Fake heavy-swing pose for Cleave
    if (this.fakeSwing >= 0) {
      this.fakeSwing += dt;
      const phase = Math.min(1, this.fakeSwing / 0.34);
      if (!this.ctx.combat.swinging) this.ctx.player.animSwing = { phase, heavy: true };
      if (phase >= 1) {
        this.fakeSwing = -1;
        if (!this.ctx.combat.swinging) this.ctx.player.animSwing = null;
      }
    }

    // Aegis duration
    if (this.aegisTimer > 0) {
      this.aegisTimer -= dt;
      if (this.aegisTimer <= 0 && this.ctx.player.shield > 0) {
        this.ctx.player.shield = 0;
        this.ctx.events.emit("SHIELD_BROKEN", {});
      }
    }

    // Mines
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      m.life -= dt;
      m.mesh.rotation.y += dt * 3;
      m.mat.emissiveIntensity = 1.4 + Math.sin(m.life * 8) * 0.6;
      let boom = m.life <= 0;
      let victim: Enemy | null = null;
      for (const e of this.ctx.enemies.living()) {
        if (Math.hypot(e.pos.x - m.x, e.pos.z - m.z) < 1.2 + e.radius) {
          boom = true;
          victim = e;
          break;
        }
      }
      if (boom) {
        this.mines.splice(i, 1);
        this.ctx.stage.scene.remove(m.mesh);
        if (victim || m.life <= 0) {
          const R = 2.4;
          for (const e of this.ctx.enemies.living()) {
            const dx = e.pos.x - m.x;
            const dz = e.pos.z - m.z;
            if (Math.hypot(dx, dz) < R + e.radius) {
              this.ctx.combat.dealDamage(e, 14, { kbX: dx, kbZ: dz, kb: 5, heavy: true, countCombo: true });
            }
          }
          this.ctx.fx.ring(m.x, m.z, { radius: R, color: 0xff9a5f, duration: 0.4 });
          this.ctx.fx.burst({
            x: m.x, y: 0.4, z: m.z,
            count: 20, color: [0xff9a5f, 0xffd29f],
            speed: [3, 9], up: 0.8, size: [0.4, 0.8], life: [0.2, 0.5], gravity: -6, drag: 3,
          });
          this.ctx.sfx.explosion();
          this.ctx.cam.addTrauma(0.18);
        }
      }
    }

    // Phantoms
    for (let i = this.phantoms.length - 1; i >= 0; i--) {
      const p = this.phantoms[i];
      p.timer -= dt;
      p.group.scale.setScalar(1 + (0.8 - p.timer) * 0.4);
      if (p.timer <= 0) {
        this.phantoms.splice(i, 1);
        this.ctx.stage.scene.remove(p.group);
        const R = 2.5;
        for (const e of this.ctx.enemies.living()) {
          const dx = e.pos.x - p.x;
          const dz = e.pos.z - p.z;
          if (Math.hypot(dx, dz) < R + e.radius) {
            this.ctx.combat.dealDamage(e, 16, { kbX: dx, kbZ: dz, kb: 6, heavy: true, countCombo: true });
          }
        }
        this.ctx.fx.ring(p.x, p.z, { radius: R, color: 0xc98fff, duration: 0.45 });
        this.ctx.fx.burst({
          x: p.x, y: 1, z: p.z,
          count: 24, color: [0xc98fff, 0xffffff],
          speed: [3, 9], up: 0.6, size: [0.4, 0.8], life: [0.25, 0.5], gravity: -3, drag: 3,
        });
        this.ctx.sfx.phantomBoom();
      }
    }
  }
}
