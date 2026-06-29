import * as THREE from "three";
import { angleDelta } from "../core/math";
import type { Ctx } from "./ctx";
import type { Enemy } from "./enemies";

/** Release the GPU geometry + material of every mesh under a group (after scene.remove). */
function disposeGroup(group: THREE.Object3D): void {
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
}

export interface CardDef {
  id: string;
  name: string;
  desc: string;
  /** One-line description of the "honed" (upgraded) effect. */
  upDesc: string;
  cooldown: number;
  /** CSS accent for UI. */
  color: string;
  glow: number;
  icon: string;
  rarity: "common" | "uncommon" | "rare";
  tempo: number;
  /** Optional hero id ("bulwark"/"sparkmage"/"reaver"/"tempest"/"blade") — when set, this is a hero-signature card. */
  hero?: string;
  /** Build-archetype tags (fire/frost/lightning/bleed/force/arcane/guard/heal/mobility/summon). Drives synergy highlighting + tag relics. */
  tags?: string[];
}

export const CARDS: CardDef[] = [
  { id: "dash-strike", name: "Dash Strike", desc: "Lunge through enemies, carving everything in your path.", upDesc: "Dashes farther and bursts an AoE on landing.", cooldown: 5, color: "#5fe0ff", glow: 0x5fe0ff, icon: "➤", rarity: "common", tempo: 8 },
  { id: "arc-bolt", name: "Arc Bolt", desc: "A piercing lance of energy that punches through the pack.", upDesc: "Fires a 3-bolt spread.", cooldown: 3, color: "#7fa8ff", glow: 0x7fa8ff, icon: "✦", rarity: "common", tempo: 4 },
  { id: "cleave", name: "Cleave", desc: "A massive sweeping blow. Crowds are an invitation.", upDesc: "Becomes a full 360° sweep for more damage.", cooldown: 5, color: "#ffc266", glow: 0xffc266, icon: "⚔", rarity: "common", tempo: 6 },
  { id: "frost-nova", name: "Frost Nova", desc: "Detonate the cold. Damages and freezes everything nearby.", upDesc: "Bigger radius, harder hit, ~3s freeze.", cooldown: 9, color: "#9fd8ff", glow: 0x9fd8ff, icon: "❄", rarity: "uncommon", tempo: 5 },
  { id: "phase-step", name: "Phase Step", desc: "Blink to the cursor, leaving a phantom that detonates.", upDesc: "Leaves two phantoms that detonate.", cooldown: 7, color: "#c98fff", glow: 0xc98fff, icon: "⟡", rarity: "uncommon", tempo: 5 },
  { id: "mine-field", name: "Mine Field", desc: "Scatter four arc-mines around you. Herd them in.", upDesc: "Scatters six mines instead of four.", cooldown: 9, color: "#ff9a5f", glow: 0xff9a5f, icon: "✸", rarity: "uncommon", tempo: 8 },
  { id: "aegis", name: "Aegis", desc: "A 25-point barrier. Press again to detonate it early.", upDesc: "40-point barrier with a bigger blast.", cooldown: 12, color: "#7fc8ff", glow: 0x7fc8ff, icon: "⛨", rarity: "uncommon", tempo: 0 },
  { id: "chain-lightning", name: "Chain Lightning", desc: "A bolt that arcs between up to three foes.", upDesc: "Arcs to 6 foes for more damage.", cooldown: 7, color: "#ffe066", glow: 0xffe066, icon: "⚡", rarity: "rare", tempo: 7 },
  // --- Expansion set (most begin locked; milestones open them up)
  { id: "sunder", name: "Sunder", desc: "Four eruptions march down a line in front of you.", upDesc: "Six eruptions march down a longer line.", cooldown: 6, color: "#d8b25f", glow: 0xd8b25f, icon: "⫸", rarity: "common", tempo: 6 },
  { id: "charged-lance", name: "Charged Lance", desc: "One colossal piercing bolt. The recoil moves you.", upDesc: "Bigger bolt, more damage, harder recoil.", cooldown: 7, color: "#9fd0ff", glow: 0x9fd0ff, icon: "➹", rarity: "uncommon", tempo: 7 },
  { id: "meteor-call", name: "Meteor Call", desc: "Mark the cursor. A heartbeat later, the sky answers.", upDesc: "Calls a second meteor nearby.", cooldown: 9, color: "#ff8a4d", glow: 0xff8a4d, icon: "✴", rarity: "uncommon", tempo: 8 },
  { id: "bleeding-edge", name: "Bleeding Edge", desc: "A wide cleave that leaves deep, ticking wounds.", upDesc: "Inflicts a deeper, longer bleed.", cooldown: 6, color: "#ff6b7a", glow: 0xff6b7a, icon: "❖", rarity: "common", tempo: 6 },
  { id: "storm-conduit", name: "Storm Conduit", desc: "For 5s your sword hits arc sparks to a nearby foe.", upDesc: "Lasts 8s and sparks hit harder.", cooldown: 11, color: "#fff09f", glow: 0xfff09f, icon: "≋", rarity: "rare", tempo: 5 },
  { id: "gravity-well", name: "Gravity Well", desc: "Drag the pack into one point, then pop it.", upDesc: "Wider pull and a stronger pop.", cooldown: 9, color: "#b08fff", glow: 0xb08fff, icon: "◉", rarity: "rare", tempo: 6 },
  { id: "ward-pulse", name: "Ward Pulse", desc: "Mend 12 HP and hurl everything near you away.", upDesc: "Mends 24 HP and grants a small shield.", cooldown: 14, color: "#8fffc8", glow: 0x8fffc8, icon: "✚", rarity: "uncommon", tempo: 0 },
  { id: "ember-wave", name: "Ember Wave", desc: "A cone of fire that keeps burning after it lands.", upDesc: "Wider cone with a longer, fiercer burn.", cooldown: 8, color: "#ffb35f", glow: 0xffb35f, icon: "✺", rarity: "uncommon", tempo: 7 },
  // --- Expansion II
  { id: "blade-cyclone", name: "Blade Cyclone", desc: "Become the storm — three spinning shockwaves around you.", upDesc: "Adds a fourth, wider shockwave.", cooldown: 8, color: "#7fe8d8", glow: 0x7fe8d8, icon: "❋", rarity: "uncommon", tempo: 7 },
  { id: "riposte", name: "Riposte", desc: "Take a stance. The next hit is denied — and answered.", upDesc: "Longer stance and a fiercer counter.", cooldown: 12, color: "#ffe066", glow: 0xffe066, icon: "⌖", rarity: "rare", tempo: 0 },
  { id: "tempo-theft", name: "Tempo Theft", desc: "Rip the rhythm out of the nearest foe. Damage and heat.", upDesc: "Rips the two nearest foes.", cooldown: 7, color: "#c98fff", glow: 0xc98fff, icon: "♬", rarity: "uncommon", tempo: 12 },
  { id: "starfall", name: "Starfall", desc: "Five shards of sky rain down around the cursor.", upDesc: "Rains seven shards instead of five.", cooldown: 10, color: "#9fb8ff", glow: 0x9fb8ff, icon: "✧", rarity: "rare", tempo: 8 },
  // --- Expansion III
  { id: "spectral-volley", name: "Spectral Volley", desc: "Loose a fan of five piercing spectral bolts.", upDesc: "Fires seven bolts in a wider fan.", cooldown: 7, color: "#bfa8ff", glow: 0xbfa8ff, icon: "⁂", rarity: "rare", tempo: 8 },
  { id: "seismic-slam", name: "Seismic Slam", desc: "Smash the ground — a heavy shockwave hurls the pack back.", upDesc: "Larger blast that briefly freezes the caught.", cooldown: 8, color: "#d8a86a", glow: 0xd8a86a, icon: "⊛", rarity: "uncommon", tempo: 7 },
  { id: "glacial-lance", name: "Glacial Lance", desc: "A spear of frost down a line — damages and freezes all it crosses.", upDesc: "Longer, wider spear with a deeper freeze.", cooldown: 7, color: "#bfeaff", glow: 0xbfeaff, icon: "❆", rarity: "uncommon", tempo: 6 },
  { id: "soul-harvest", name: "Soul Harvest", desc: "Reap everything near you. Each soul reaped mends your wounds.", upDesc: "Bigger reap that mends 6 per soul.", cooldown: 9, color: "#ff6ba0", glow: 0xff6ba0, icon: "❣", rarity: "rare", tempo: 6 },
  { id: "warcry", name: "War Cry", desc: "Roar — surge tempo, raise a 12 barrier, and mend 8 HP.", upDesc: "Raises a 20 barrier, mends 16, shoves harder.", cooldown: 12, color: "#ffcf6a", glow: 0xffcf6a, icon: "✜", rarity: "common", tempo: 14 },
  // --- Expansion IV: the new batch
  { id: "seeker-swarm", name: "Seeker Swarm", desc: "Loose five homing motes that chase down the pack.", upDesc: "Looses eight harder-hitting motes.", cooldown: 7, color: "#9fffd0", glow: 0x9fffd0, icon: "⁕", rarity: "uncommon", tempo: 7 },
  { id: "singularity", name: "Singularity", desc: "Tear a black hole at the cursor — drag everything in, then crush it.", upDesc: "Wider, longer pull and a devastating crush.", cooldown: 11, color: "#9a6bff", glow: 0x9a6bff, icon: "⬤", rarity: "rare", tempo: 9, hero: "sparkmage" },
  { id: "tempest-storm", name: "Tempest", desc: "Call a storm — bolts hammer random nearby foes for 3s.", upDesc: "Stronger bolts strike for 5s.", cooldown: 10, color: "#bfe0ff", glow: 0xbfe0ff, icon: "⛆", rarity: "rare", tempo: 8, hero: "tempest" },
  { id: "flame-channel", name: "Flamethrower", desc: "Channel a roaring cone of fire that pours out in front of you.", upDesc: "Hotter, longer channel that leaves lingering burns.", cooldown: 9, color: "#ff7a33", glow: 0xff7a33, icon: "♨", rarity: "uncommon", tempo: 8 },
  { id: "decoy-totem", name: "Decoy Totem", desc: "Plant a totem that taunts the pack, then erupts.", upDesc: "Tougher totem with a bigger, freezing blast.", cooldown: 9, color: "#ffd24d", glow: 0xffd24d, icon: "⛾", rarity: "uncommon", tempo: 6 },
  { id: "leech-orb", name: "Leech Orb", desc: "A slow orb that saps the foes it passes and mends you.", upDesc: "Drains harder and heals more per soul.", cooldown: 9, color: "#ff5fa0", glow: 0xff5fa0, icon: "☣", rarity: "uncommon", tempo: 6 },
  { id: "shield-bash", name: "Shield Bash", desc: "Charge forward, slam a wall of force, and stun all you hit.", upDesc: "Farther charge, heavier slam, longer stun + a barrier.", cooldown: 8, color: "#7fd0ff", glow: 0x7fd0ff, icon: "⛊", rarity: "uncommon", tempo: 8, hero: "bulwark" },
  { id: "rend-boomerang", name: "Rend Blade", desc: "Hurl a blade that carves out and rips back, bleeding all it crosses.", upDesc: "Flies farther, hits harder, leaves deeper wounds.", cooldown: 7, color: "#ff5555", glow: 0xff5555, icon: "↺", rarity: "uncommon", tempo: 7, hero: "reaver" },
  { id: "tempo-edge", name: "Tempo Edge", desc: "A flurry of sweeping cuts — the hotter your Tempo, the more strikes land.", upDesc: "More strikes and a tempo-fed finishing burst.", cooldown: 7, color: "#5fe0ff", glow: 0x5fe0ff, icon: "≈", rarity: "rare", tempo: 6, hero: "blade" },
  // --- Expansion V: more cards + a signature for the Revenant
  { id: "grave-harvest", name: "Grave Harvest", desc: "Reap everything near you — every foe cut bleeds and feeds your wounds.", upDesc: "Wider reap, deeper bleed, more life per soul.", cooldown: 9, color: "#ff6ba0", glow: 0xff6ba0, icon: "⚰", rarity: "rare", tempo: 7, hero: "revenant" },
  { id: "bulwark-breaker", name: "Bulwark Breaker", desc: "Slam the ground — a heavy shock hurls the pack back and raises a barrier per foe hit.", upDesc: "Bigger shock, harder shove, a much stouter barrier.", cooldown: 9, color: "#7fd0ff", glow: 0x7fd0ff, icon: "⬢", rarity: "uncommon", tempo: 8, hero: "bulwark" },
  { id: "thunderclap", name: "Thunderclap", desc: "A point-blank shock that hammers and stuns everything around you.", upDesc: "Bigger blast, harder hit, a longer stun.", cooldown: 7, color: "#ffe066", glow: 0xffe066, icon: "↯", rarity: "uncommon", tempo: 7 },
  { id: "frost-lattice", name: "Frost Lattice", desc: "Spears of frost lance out in four directions, freezing all they cross.", upDesc: "An eight-point star with a deeper freeze.", cooldown: 8, color: "#bfeaff", glow: 0xbfeaff, icon: "❅", rarity: "uncommon", tempo: 6 },
];

/** Build-archetype tags per card — assigned once below so the literals stay readable. */
const CARD_TAGS: Record<string, string[]> = {
  "dash-strike": ["mobility", "force"], "arc-bolt": ["arcane"], "cleave": ["force"],
  "frost-nova": ["frost"], "phase-step": ["mobility", "arcane"], "mine-field": ["force"],
  "aegis": ["guard"], "chain-lightning": ["lightning"], "sunder": ["force"],
  "charged-lance": ["arcane"], "meteor-call": ["fire"], "bleeding-edge": ["bleed"],
  "storm-conduit": ["lightning"], "gravity-well": ["arcane", "force"], "ward-pulse": ["heal", "guard"],
  "ember-wave": ["fire"], "blade-cyclone": ["force"], "riposte": ["guard"],
  "tempo-theft": ["arcane"], "starfall": ["arcane"], "spectral-volley": ["arcane"],
  "seismic-slam": ["force"], "glacial-lance": ["frost"], "soul-harvest": ["bleed", "heal"],
  "warcry": ["guard", "heal"], "seeker-swarm": ["arcane"], "singularity": ["arcane"],
  "tempest-storm": ["lightning"], "flame-channel": ["fire"], "decoy-totem": ["summon"],
  "leech-orb": ["bleed", "heal"], "shield-bash": ["guard", "force"], "rend-boomerang": ["bleed"],
  "tempo-edge": ["force"],
  "grave-harvest": ["bleed", "heal"], "bulwark-breaker": ["guard", "force"],
  "thunderclap": ["lightning", "force"], "frost-lattice": ["frost"],
};
for (const c of CARDS) c.tags = CARD_TAGS[c.id] ?? [];

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
  r: number;
  dmg: number;
  /** Starfall shards skip the warning pulses. */
  quiet?: boolean;
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
  /** Honed wells pull from farther and pop harder. */
  upgraded: boolean;
}

/** A homing mote (Seeker Swarm) that curves toward the nearest foe. */
interface Seeker {
  x: number;
  z: number;
  vx: number;
  vz: number;
  life: number;
  dmg: number;
  trailAcc: number;
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
}

/** The collapsing black hole (Singularity) — pulls hard, then crushes. */
interface BlackHole {
  x: number;
  z: number;
  timer: number;
  pull: number;
  crushDmg: number;
  crushR: number;
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
}

/** A live lightning storm (Tempest) — strikes random nearby foes over its life. */
interface Storm {
  x: number;
  z: number;
  timer: number;
  strikeAcc: number;
  r: number;
  dmg: number;
}

/** A channelled flame cone (Flamethrower) that pours out while it runs. */
interface FlameJet {
  timer: number;
  tickAcc: number;
  range: number;
  arc: number;
  burn: boolean;
}

/** A taunting decoy totem that erupts when its timer runs out (Decoy Totem). */
interface Totem {
  x: number;
  z: number;
  timer: number;
  blastR: number;
  blastDmg: number;
  freeze: boolean;
  group: THREE.Group;
}

/** A drifting leech orb (Leech Orb) that saps foes it crosses and heals you. */
interface LeechOrb {
  x: number;
  z: number;
  vx: number;
  vz: number;
  life: number;
  dmg: number;
  heal: number;
  hitAcc: number;
  trailAcc: number;
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
}

/** A thrown blade that flies out, returns (Rend Blade), and bleeds what it crosses. */
interface Boomerang {
  ox: number;
  oz: number;
  nx: number;
  nz: number;
  t: number;
  dur: number;
  reach: number;
  dmg: number;
  bleedTicks: number;
  hit: Set<number>;
  /** Cleared once at the apex so foes can be cut again on the return leg. */
  clearedReturn: boolean;
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
}

export class CardCaster {
  private mines: Mine[] = [];
  private phantoms: Phantom[] = [];
  private aegisTimer = 0;
  /** Whether the live Aegis barrier was cast honed (bigger detonation). */
  private aegisUpgraded = false;
  private fakeSwing = -1;
  private mineGeo = new THREE.ConeGeometry(0.28, 0.4, 4);
  private seekerGeo = new THREE.IcosahedronGeometry(0.22, 0);
  private boomerangGeo = new THREE.TorusGeometry(0.42, 0.12, 6, 12, Math.PI * 1.3);
  private bleeds: Bleed[] = [];
  private meteors: Meteor[] = [];
  private pulses: SunderPulse[] = [];
  private wells: Well[] = [];
  private conduitTimer = 0;
  /** Per-spark damage for the active Storm Conduit (honed sparks hit harder). */
  private conduitDmg = 4;
  /** Re-entrancy latch: conduit sparks must never trigger more sparks. */
  private sparking = false;
  private cycloneTimers: number[] = [];
  /** Radius of the active Blade Cyclone pulses (honed is wider). */
  private cycloneRadius = 3.2;
  private riposteTimer = 0;
  /** Whether the armed Riposte was cast honed (fiercer counter). */
  private riposteUpgraded = false;
  private seekers: Seeker[] = [];
  private holes: BlackHole[] = [];
  private storms: Storm[] = [];
  private jets: FlameJet[] = [];
  private totems: Totem[] = [];
  private leeches: LeechOrb[] = [];
  private boomerangs: Boomerang[] = [];

  get riposteActive(): boolean {
    return this.riposteTimer > 0;
  }

  /** True if the armed Riposte was honed — combat reads this for the counter. */
  get riposteUpgradedActive(): boolean {
    return this.riposteUpgraded;
  }

  /** True while a card is driving the swing pose (Cleave, Bleeding Edge, Cyclone). */
  get swinging(): boolean {
    return this.fakeSwing >= 0 || this.cycloneTimers.length > 0;
  }

  consumeRiposte(): void {
    this.riposteTimer = 0;
    this.riposteUpgraded = false;
  }

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
      this.ctx.combat.dealDamage(best, this.conduitDmg, { kb: 1 });
      this.sparking = false;
      this.lightningVisual([{ x, z }, { x: best.pos.x, z: best.pos.z }]);
    });
  }

  /** Warm representative dynamic card-effect materials before combat can cast them. */
  precompile(): void {
    const scene = this.ctx.stage.scene;
    const root = new THREE.Group();
    root.position.set(0, -1000, 0);
    scene.add(root);
    const add = (mesh: THREE.Object3D): void => {
      mesh.visible = true;
      root.add(mesh);
    };

    add(new THREE.Mesh(
      new THREE.SphereGeometry(0.7, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x9a6bff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }),
    ));
    add(new THREE.Mesh(
      new THREE.CapsuleGeometry(0.35, 0.9, 4, 8),
      new THREE.MeshBasicMaterial({ color: 0xc98fff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }),
    ));
    add(new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.22, 1.4, 6),
      new THREE.MeshStandardMaterial({ color: 0x4a3a12, emissive: 0xffd24d, emissiveIntensity: 0.8, flatShading: true }),
    ));
    add(new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.32, 0),
      new THREE.MeshStandardMaterial({ color: 0x664400, emissive: 0xffd24d, emissiveIntensity: 1.6, flatShading: true }),
    ));
    add(new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.12, 6, 12, Math.PI * 1.3),
      new THREE.MeshStandardMaterial({ color: 0x551515, emissive: 0xff5555, emissiveIntensity: 1.5, flatShading: true }),
    ));
    add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-1, 1, 0), new THREE.Vector3(1, 1.2, 0)]),
      new THREE.LineBasicMaterial({ color: 0xffe066, transparent: true, opacity: 1 }),
    ));

    this.ctx.stage.warmUp();
    scene.remove(root);
    root.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
        o.geometry.dispose();
        const mat = o.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat.dispose();
      }
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

  cast(def: CardDef, upgraded = false): boolean {
    // "Honed" cards each get a bespoke upgrade (the dispatch branches on `upgraded`),
    // plus a 50% tempo bonus and the −30% cooldown applied in the deck.
    const ok = this.dispatch(def, upgraded);
    if (ok) {
      this.castFlourish(def, upgraded);
      this.ctx.events.emit("CARD_CAST", { id: def.id });
      if (def.tempo > 0) this.ctx.tempo.gain(Math.round(def.tempo * (upgraded ? 1.5 : 1)));
      this.ctx.sfx.cast(def.id);
    }
    return ok;
  }

  private castFlourish(def: CardDef, upgraded: boolean): void {
    const p = this.ctx.player;
    const fx = Math.sin(p.facing);
    const fz = Math.cos(p.facing);
    const x = p.pos.x + fx * 0.65;
    const z = p.pos.z + fz * 0.65;
    this.ctx.fx.ring(p.pos.x, p.pos.z, { radius: upgraded ? 1.75 : 1.35, color: def.glow, duration: 0.22 });
    this.ctx.fx.burst({
      x, y: 1.15, z,
      count: upgraded ? 18 : 12,
      color: [def.glow, 0xffffff],
      speed: [1.5, upgraded ? 8 : 6],
      up: 0.45,
      size: [0.22, upgraded ? 0.72 : 0.55],
      life: [0.16, 0.36],
      gravity: -2,
      drag: 3.8,
      jitter: 0.35,
    });
  }

  private dispatch(def: CardDef, upgraded: boolean): boolean {
    const { player, input, combat, enemies, fx } = this.ctx;
    const aim = input.aimPoint;

    switch (def.id) {
      case "dash-strike": {
        const dx = aim.x - player.pos.x;
        const dz = aim.z - player.pos.z;
        const len = Math.hypot(dx, dz) || 1;
        const dist = Math.min(upgraded ? 9 : 6, Math.max(3, len));
        const dmg = upgraded ? 36 : 26;
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
            combat.dealDamage(e, dmg, { kbX: ex - along * nx, kbZ: ez - along * nz, kb: 2.2, heavy: false, countCombo: true, allowShieldStagger: false });
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
        // Honed: detonate a small AoE where you land
        if (upgraded) {
          const landX = player.pos.x + nx * dist;
          const landZ = player.pos.z + nz * dist;
          const R = 2.6;
          for (const e of enemies.living()) {
            const ex = e.pos.x - landX;
            const ez = e.pos.z - landZ;
            if (Math.hypot(ex, ez) < R + e.radius) {
              combat.dealDamage(e, 24, { kbX: ex, kbZ: ez, kb: 6, heavy: true, countCombo: true });
            }
          }
          window.setTimeout(() => {
            if (!player.alive) return;
            fx.ring(landX, landZ, { radius: R, color: 0x5fe0ff, duration: 0.35 });
            fx.burst({
              x: landX, y: 0.6, z: landZ,
              count: 22, color: [0x5fe0ff, 0xffffff], speed: [3, 9], up: 0.6, size: [0.4, 0.8], life: [0.2, 0.5], gravity: -4, drag: 3,
            });
          }, 110);
        }
        return true;
      }

      case "arc-bolt": {
        if (upgraded) {
          const spread = (16 * Math.PI) / 180;
          for (let i = -1; i <= 1; i++) {
            this.ctx.projectiles.fire(player.pos.x, player.pos.z, player.facing + i * spread, {
              speed: 30, dmg: 20, color: 0x7fa8ff, radius: 0.36, range: 24, pierce: true,
            });
          }
        } else {
          this.ctx.projectiles.fire(player.pos.x, player.pos.z, player.facing, {
            speed: 30, dmg: 20, color: 0x7fa8ff, radius: 0.36, range: 24, pierce: true,
          });
        }
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
        const arc = upgraded ? Math.PI * 2 : (170 * Math.PI) / 180;
        const hits = combat.meleeSweep(player.facing, arc, 3.6, upgraded ? 56 : 42, 7, true);
        combat.slashVisual(arc, 3.6, true);
        this.fakeSwing = 0;
        if (hits > 0) {
          this.ctx.cam.addTrauma(0.3);
          this.ctx.cam.kick(Math.sin(player.facing), Math.cos(player.facing), 4);
        }
        return true;
      }

      case "tempo-edge": {
        // Blade's signature: a flurry whose strike count scales with current Tempo.
        const heat = this.ctx.tempo.value;
        const swings = (upgraded ? 3 : 2) + Math.floor(heat / 25); // 2–6 (3–7 honed)
        const perHit = upgraded ? 16 : 13;
        const arc = (150 * Math.PI) / 180;
        for (let i = 0; i < swings; i++) {
          const last = i === swings - 1;
          window.setTimeout(() => {
            if (!player.alive) return;
            combat.meleeSweep(player.facing, arc, 3.3, perHit, last ? 7 : 3, last);
            combat.slashVisual(arc, 3.3, last);
            this.ctx.cam.addTrauma(last ? 0.22 : 0.08);
            if (last) this.ctx.cam.kick(Math.sin(player.facing), Math.cos(player.facing), 3);
          }, i * 65);
        }
        fx.ring(player.pos.x, player.pos.z, { radius: 2.4, color: 0x5fe0ff, duration: 0.3 });
        this.ctx.cam.pulseFov(0.4);
        // Honed: a tempo-fed nova caps the flurry.
        if (upgraded) {
          window.setTimeout(() => {
            if (!player.alive) return;
            const R = 3.2;
            const dmg = 18 + Math.round(heat * 0.28);
            for (const e of enemies.living()) {
              const ex = e.pos.x - player.pos.x;
              const ez = e.pos.z - player.pos.z;
              if (Math.hypot(ex, ez) < R + e.radius) combat.dealDamage(e, dmg, { kbX: ex, kbZ: ez, kb: 8, heavy: true });
            }
            fx.ring(player.pos.x, player.pos.z, { radius: R, color: 0x9fe8ff, duration: 0.4 });
            fx.burst({ x: player.pos.x, y: 1, z: player.pos.z, count: 26, color: [0x5fe0ff, 0xffffff], speed: [3, 11], up: 0.6, size: [0.4, 0.9], life: [0.25, 0.6], gravity: -3, drag: 2.6 });
          }, swings * 65 + 40);
        }
        return true;
      }

      case "frost-nova": {
        const R = upgraded ? 7 : 5.5;
        const dmg = upgraded ? 24 : 16;
        const freeze = upgraded ? 3 : 1.8;
        for (const e of enemies.living()) {
          const dx = e.pos.x - player.pos.x;
          const dz = e.pos.z - player.pos.z;
          if (Math.hypot(dx, dz) < R + e.radius) {
            combat.dealDamage(e, dmg, { kbX: dx, kbZ: dz, kb: 3 });
            e.freeze(freeze);
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
        // Honed: a second phantom near the origin
        if (upgraded) {
          const a = this.ctx.rng.range(0, Math.PI * 2);
          this.spawnPhantom(from.x + Math.sin(a) * 1.6, from.z + Math.cos(a) * 1.6);
        }
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
        const count = upgraded ? 6 : 4;
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2 + this.ctx.rng.range(0, 0.8);
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
        const amount = upgraded ? 40 : 25;
        this.aegisUpgraded = upgraded;
        player.shield = amount;
        this.aegisTimer = 4;
        this.ctx.events.emit("SHIELD_GAINED", { amount });
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
        const maxChain = upgraded ? 6 : this.ctx.relics.has("chain-amulet") ? 5 : 3;
        const boltDmg = upgraded ? 24 : 18;
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
          this.ctx.combat.dealDamage(best, boltDmg, { kb: 2, kbX: best.pos.x - cur.x, kbZ: best.pos.z - cur.z });
          cur = { x: best.pos.x, z: best.pos.z };
        }
        if (targets.length < 2) return false; // no targets — don't burn the cooldown
        this.lightningVisual(targets);
        this.ctx.stage.punch(0.15);
        this.ctx.cam.addTrauma(0.12);
        return true;
      }

      case "sunder": {
        const count = upgraded ? 6 : 4;
        for (let i = 0; i < count; i++) {
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
          speed: 34, dmg: upgraded ? 60 : 44, color: 0x9fd0ff, radius: upgraded ? 0.78 : 0.55, range: 26, pierce: true,
        });
        const mx = player.pos.x + Math.sin(player.facing) * 1.3;
        const mz = player.pos.z + Math.cos(player.facing) * 1.3;
        fx.burst({
          x: mx, y: 1.0, z: mz,
          count: upgraded ? 28 : 20, color: [0x9fd0ff, 0xffffff],
          speed: [4, 11], up: 0.3, size: [0.4, 0.8], life: [0.15, 0.35], gravity: -2, drag: 4,
        });
        // The recoil is real
        const recoil = upgraded ? 10 : 7;
        this.ctx.controller.push(-Math.sin(player.facing) * recoil, -Math.cos(player.facing) * recoil);
        this.ctx.cam.kick(-Math.sin(player.facing), -Math.cos(player.facing), upgraded ? 7 : 5);
        this.ctx.cam.addTrauma(upgraded ? 0.3 : 0.2);
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
        this.meteors.push({ x: tx, z: tz, timer: 0.9, pulseAcc: 0, r: 3.2, dmg: 38 });
        // Honed: a second meteor lands beside the first
        if (upgraded) {
          const a = this.ctx.rng.range(0, Math.PI * 2);
          const ox = tx + Math.sin(a) * 3.2;
          const oz = tz + Math.cos(a) * 3.2;
          fx.ring(ox, oz, { radius: 3.2, color: 0xff8a4d, duration: 1.1 });
          this.meteors.push({ x: ox, z: oz, timer: 1.1, pulseAcc: 0, r: 3.2, dmg: 38 });
        }
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
          combat.dealDamage(e, upgraded ? 31 : 24, { kbX: dx, kbZ: dz, kb: 4, countCombo: true });
          this.addBleed(e, upgraded ? 8 : 5, upgraded ? 5 : 3);
          hits++;
        }
        combat.slashVisual(arc, range, false);
        this.fakeSwing = 0;
        if (hits > 0) this.ctx.cam.addTrauma(0.18);
        return true;
      }

      case "storm-conduit": {
        this.conduitTimer = upgraded ? 8 : 5;
        this.conduitDmg = upgraded ? 10 : 6;
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
        this.wells.push({ x: wx, z: wz, timer: 1.2, mesh, mat, upgraded });
        fx.ring(wx, wz, { radius: upgraded ? 6.5 : 5, color: 0xb08fff, duration: 0.6 });
        return true;
      }

      case "ward-pulse": {
        const heal = Math.min(upgraded ? 24 : 12, player.maxHp - player.hp);
        player.hp += heal;
        if (heal > 0) this.ctx.events.emit("HEAL", { amount: heal });
        if (upgraded) {
          player.shield = Math.max(player.shield, 10);
          this.ctx.events.emit("SHIELD_GAINED", { amount: 10 });
        }
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
        const arc = (upgraded ? 130 : 90) * Math.PI / 180;
        const range = 4.6;
        for (const e of enemies.living()) {
          const dx = e.pos.x - player.pos.x;
          const dz = e.pos.z - player.pos.z;
          const d = Math.hypot(dx, dz);
          if (d > range + e.radius) continue;
          if (Math.abs(angleDelta(player.facing, Math.atan2(dx, dz))) > arc / 2) continue;
          combat.dealDamage(e, upgraded ? 34 : 28, { kbX: dx, kbZ: dz, kb: 3, heavy: true, countCombo: true });
          this.addBleed(e, upgraded ? 7 : 4, upgraded ? 5 : 3, 0xffb35f);
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

      case "blade-cyclone": {
        this.cycloneRadius = upgraded ? 4.0 : 3.2;
        if (upgraded) this.cycloneTimers.push(0.05, 0.25, 0.45, 0.65);
        else this.cycloneTimers.push(0.05, 0.25, 0.45);
        this.fakeSwing = 0;
        this.ctx.cam.pulseFov(0.5);
        return true;
      }

      case "riposte": {
        this.riposteTimer = upgraded ? 4 : 2.5;
        this.riposteUpgraded = upgraded;
        fx.ring(player.pos.x, player.pos.z, { radius: 1.6, color: 0xffe066, duration: 0.4 });
        this.ctx.floaters.spawn(player.pos.x, 2.0, player.pos.z, "EN GARDE", "label");
        return true;
      }

      case "tempo-theft": {
        const taken = new Set<number>();
        let ripped = 0;
        const rips = upgraded ? 2 : 1;
        for (let r = 0; r < rips; r++) {
          let best: Enemy | null = null;
          let bestD = 9;
          for (const e of enemies.living()) {
            if (taken.has(e.id)) continue;
            const d = Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z);
            if (d < bestD) {
              bestD = d;
              best = e;
            }
          }
          if (!best) break;
          taken.add(best.id);
          combat.dealDamage(best, 18, { kbX: best.pos.x - player.pos.x, kbZ: best.pos.z - player.pos.z, kb: 3 });
          this.lightningVisual([{ x: best.pos.x, z: best.pos.z }, { x: player.pos.x, z: player.pos.z }]);
          ripped++;
        }
        if (ripped === 0) return false; // nothing to steal from
        fx.burst({
          x: player.pos.x, y: 1.4, z: player.pos.z,
          count: 14, color: 0xc98fff, speed: [1, 4], up: 1.0, size: [0.3, 0.6], life: [0.25, 0.5], gravity: 0, drag: 2,
        });
        return true;
      }

      case "starfall": {
        const dx = aim.x - player.pos.x;
        const dz = aim.z - player.pos.z;
        const len = Math.hypot(dx, dz);
        const dist = Math.min(12, len);
        const nx = len > 0.01 ? dx / len : Math.sin(player.facing);
        const nz = len > 0.01 ? dz / len : Math.cos(player.facing);
        const cx = player.pos.x + nx * dist;
        const cz = player.pos.z + nz * dist;
        fx.ring(cx, cz, { radius: 3.5, color: 0x9fb8ff, duration: 0.6 });
        const shards = upgraded ? 7 : 5;
        for (let i = 0; i < shards; i++) {
          const a = this.ctx.rng.range(0, Math.PI * 2);
          const r = this.ctx.rng.range(0, 3.2);
          this.meteors.push({
            x: cx + Math.sin(a) * r, z: cz + Math.cos(a) * r,
            timer: 0.45 + i * 0.16, pulseAcc: 99, r: 1.6, dmg: 14, quiet: true,
          });
        }
        return true;
      }

      case "spectral-volley": {
        const spread = (upgraded ? 48 : 30) * Math.PI / 180;
        const half = upgraded ? 3 : 2;
        for (let i = -half; i <= half; i++) {
          const a = player.facing + (i / half) * spread;
          this.ctx.projectiles.fire(player.pos.x, player.pos.z, a, {
            speed: 28, dmg: 16, color: 0xbfa8ff, radius: 0.32, range: 22, pierce: true,
          });
        }
        const mx = player.pos.x + Math.sin(player.facing) * 1.2;
        const mz = player.pos.z + Math.cos(player.facing) * 1.2;
        fx.burst({
          x: mx, y: 1.0, z: mz,
          count: 18, color: [0xbfa8ff, 0xffffff],
          speed: [3, 9], up: 0.3, size: [0.3, 0.7], life: [0.12, 0.32], gravity: -2, drag: 4,
        });
        this.ctx.cam.kick(-Math.sin(player.facing), -Math.cos(player.facing), 2.6);
        return true;
      }

      case "seismic-slam": {
        const R = upgraded ? 6.5 : 5;
        for (const e of enemies.living()) {
          const dx = e.pos.x - player.pos.x;
          const dz = e.pos.z - player.pos.z;
          if (Math.hypot(dx, dz) < R + e.radius) {
            combat.dealDamage(e, upgraded ? 46 : 34, { kbX: dx, kbZ: dz, kb: 13, heavy: true, countCombo: true });
            if (upgraded) e.freeze(0.6);
          }
        }
        fx.ring(player.pos.x, player.pos.z, { radius: R, color: 0xd8a86a, duration: 0.5 });
        fx.ring(player.pos.x, player.pos.z, { radius: R * 0.6, color: 0xfff0c0, duration: 0.4 });
        fx.burst({
          x: player.pos.x, y: 0.5, z: player.pos.z,
          count: 40, color: [0xd8a86a, 0xfff0c0, 0xffffff],
          speed: [4, 13], up: 0.7, size: [0.5, 1.1], life: [0.3, 0.7], gravity: -6, drag: 2.5,
        });
        this.ctx.cam.addTrauma(0.4);
        this.ctx.stage.punch(0.45);
        this.fakeSwing = 0;
        return true;
      }

      case "glacial-lance": {
        const nx = Math.sin(player.facing);
        const nz = Math.cos(player.facing);
        const range = upgraded ? 17 : 13;
        const width = upgraded ? 1.8 : 1.2;
        for (const e of enemies.living()) {
          const ex = e.pos.x - player.pos.x;
          const ez = e.pos.z - player.pos.z;
          const along = ex * nx + ez * nz;
          if (along < -0.5 || along > range) continue;
          const perp = Math.abs(ex * nz - ez * nx);
          if (perp < width + e.radius) {
            combat.dealDamage(e, upgraded ? 28 : 20, { kbX: nx, kbZ: nz, kb: 2, countCombo: true });
            e.freeze(upgraded ? 3.2 : 2.2);
          }
        }
        for (let i = 1; i <= 6; i++) {
          const d = (range / 6) * i;
          fx.burst({
            x: player.pos.x + nx * d, y: 0.8, z: player.pos.z + nz * d,
            count: 5, color: [0xbfeaff, 0xffffff],
            speed: [1, 4], up: 0.6, size: [0.3, 0.7], life: [0.2, 0.5], gravity: -2, drag: 3,
          });
        }
        fx.ring(player.pos.x + nx * range * 0.5, player.pos.z + nz * range * 0.5, { radius: 1.4, color: 0xbfeaff, duration: 0.4 });
        return true;
      }

      case "soul-harvest": {
        const R = upgraded ? 6.5 : 5;
        let reaped = 0;
        for (const e of enemies.living()) {
          const dx = e.pos.x - player.pos.x;
          const dz = e.pos.z - player.pos.z;
          if (Math.hypot(dx, dz) < R + e.radius) {
            combat.dealDamage(e, upgraded ? 34 : 24, { kbX: dx, kbZ: dz, kb: 3, countCombo: true });
            reaped++;
          }
        }
        const heal = Math.min(player.maxHp - player.hp, reaped * (upgraded ? 6 : 4));
        if (heal > 0) {
          player.hp += heal;
          this.ctx.events.emit("HEAL", { amount: heal });
        }
        fx.ring(player.pos.x, player.pos.z, { radius: R, color: 0xff6ba0, duration: 0.55 });
        fx.burst({
          x: player.pos.x, y: 1.0, z: player.pos.z,
          count: 30, color: [0xff6ba0, 0xffffff],
          speed: [3, 9], up: 0.6, size: [0.4, 0.8], life: [0.3, 0.6], gravity: -2, drag: 3,
        });
        this.ctx.stage.punch(0.18);
        return true;
      }

      case "warcry": {
        const heal = Math.min(upgraded ? 16 : 8, player.maxHp - player.hp);
        if (heal > 0) {
          player.hp += heal;
          this.ctx.events.emit("HEAL", { amount: heal });
        }
        const barrier = upgraded ? 20 : 12;
        player.shield = Math.max(player.shield, barrier);
        this.ctx.events.emit("SHIELD_GAINED", { amount: barrier });
        const shove = upgraded ? 10 : 6;
        for (const e of enemies.living()) {
          const dx = e.pos.x - player.pos.x;
          const dz = e.pos.z - player.pos.z;
          if (Math.hypot(dx, dz) < 4 + e.radius) e.shove(dx, dz, shove);
        }
        fx.ring(player.pos.x, player.pos.z, { radius: 3, color: 0xffcf6a, duration: 0.5 });
        fx.burst({
          x: player.pos.x, y: 1.0, z: player.pos.z,
          count: 24, color: [0xffcf6a, 0xffffff],
          speed: [2, 7], up: 0.9, size: [0.35, 0.8], life: [0.3, 0.6], gravity: -1, drag: 2.5,
        });
        this.ctx.cam.addTrauma(0.2);
        this.ctx.floaters.spawn(player.pos.x, 2.2, player.pos.z, "WAR CRY", "tempo");
        return true;
      }

      case "seeker-swarm": {
        const count = upgraded ? 8 : 5;
        const dmg = upgraded ? 18 : 12;
        for (let i = 0; i < count; i++) {
          const a = player.facing + this.ctx.rng.range(-Math.PI, Math.PI);
          const sp = this.ctx.rng.range(7, 11);
          const mat = new THREE.MeshBasicMaterial({
            color: 0x9fffd0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false,
          });
          const mesh = new THREE.Mesh(this.seekerGeo, mat);
          mesh.position.set(player.pos.x, 1.0, player.pos.z);
          this.ctx.stage.scene.add(mesh);
          this.seekers.push({
            x: player.pos.x, z: player.pos.z,
            vx: Math.sin(a) * sp, vz: Math.cos(a) * sp,
            life: 2.6, dmg, trailAcc: 0, mesh, mat,
          });
        }
        fx.burst({
          x: player.pos.x, y: 1.1, z: player.pos.z,
          count: 16, color: [0x9fffd0, 0xffffff], speed: [2, 7], up: 0.6, size: [0.3, 0.6], life: [0.15, 0.35], gravity: 0, drag: 3,
        });
        this.ctx.cam.pulseFov(0.4);
        return true;
      }

      case "singularity": {
        const dx = aim.x - player.pos.x;
        const dz = aim.z - player.pos.z;
        const len = Math.hypot(dx, dz);
        const dist = Math.min(11, len);
        const nx = len > 0.01 ? dx / len : Math.sin(player.facing);
        const nz = len > 0.01 ? dz / len : Math.cos(player.facing);
        const hx = player.pos.x + nx * dist;
        const hz = player.pos.z + nz * dist;
        const mat = new THREE.MeshBasicMaterial({
          color: 0x9a6bff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 12), mat);
        mesh.position.set(hx, 1.1, hz);
        this.ctx.stage.scene.add(mesh);
        this.holes.push({
          x: hx, z: hz, timer: upgraded ? 1.8 : 1.3,
          pull: upgraded ? 11 : 8, crushDmg: upgraded ? 54 : 36, crushR: upgraded ? 4.2 : 3.2, mesh, mat,
        });
        fx.ring(hx, hz, { radius: upgraded ? 9 : 7, color: 0x9a6bff, duration: 0.7 });
        this.ctx.cam.addTrauma(0.15);
        return true;
      }

      case "tempest-storm": {
        const dx = aim.x - player.pos.x;
        const dz = aim.z - player.pos.z;
        const len = Math.hypot(dx, dz);
        const dist = Math.min(10, len);
        const nx = len > 0.01 ? dx / len : Math.sin(player.facing);
        const nz = len > 0.01 ? dz / len : Math.cos(player.facing);
        const sx = player.pos.x + nx * dist;
        const sz = player.pos.z + nz * dist;
        this.storms.push({
          x: sx, z: sz, timer: upgraded ? 5 : 3, strikeAcc: 0.2,
          r: upgraded ? 7 : 5.5, dmg: upgraded ? 22 : 15,
        });
        fx.ring(sx, sz, { radius: upgraded ? 7 : 5.5, color: 0xbfe0ff, duration: 0.6 });
        return true;
      }

      case "flame-channel": {
        this.jets.push({
          timer: upgraded ? 1.8 : 1.3, tickAcc: 0,
          range: upgraded ? 6.2 : 5, arc: (upgraded ? 70 : 55) * Math.PI / 180, burn: upgraded,
        });
        this.ctx.cam.addTrauma(0.06);
        return true;
      }

      case "decoy-totem": {
        const tx = player.pos.x + Math.sin(player.facing) * 2.2;
        const tz = player.pos.z + Math.cos(player.facing) * 2.2;
        const group = new THREE.Group();
        const poleMat = new THREE.MeshStandardMaterial({ color: 0x4a3a12, emissive: 0xffd24d, emissiveIntensity: 0.8, flatShading: true });
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 1.4, 6), poleMat);
        pole.position.y = 0.7;
        const orbMat = new THREE.MeshStandardMaterial({ color: 0x664400, emissive: 0xffd24d, emissiveIntensity: 1.6, flatShading: true });
        const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 0), orbMat);
        orb.position.y = 1.5;
        group.add(pole, orb);
        group.position.set(tx, 0, tz);
        this.ctx.stage.scene.add(group);
        this.totems.push({
          x: tx, z: tz, timer: upgraded ? 3 : 2.4,
          blastR: upgraded ? 5 : 3.6, blastDmg: upgraded ? 42 : 28, freeze: upgraded, group,
        });
        fx.ring(tx, tz, { radius: 2, color: 0xffd24d, duration: 0.5 });
        return true;
      }

      case "leech-orb": {
        const a = player.facing;
        const mat = new THREE.MeshBasicMaterial({
          color: 0xff5fa0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), mat);
        mesh.position.set(player.pos.x, 1.0, player.pos.z);
        this.ctx.stage.scene.add(mesh);
        this.leeches.push({
          x: player.pos.x, z: player.pos.z,
          vx: Math.sin(a) * 5.5, vz: Math.cos(a) * 5.5,
          life: 2.4, dmg: upgraded ? 11 : 8, heal: upgraded ? 4 : 2, hitAcc: 0, trailAcc: 0, mesh, mat,
        });
        fx.ring(player.pos.x, player.pos.z, { radius: 1.6, color: 0xff5fa0, duration: 0.4 });
        return true;
      }

      case "shield-bash": {
        const nx = Math.sin(player.facing);
        const nz = Math.cos(player.facing);
        const dist = upgraded ? 7 : 5;
        const dmg = upgraded ? 44 : 32;
        const stun = upgraded ? 1.2 : 0.7;
        for (const e of enemies.living()) {
          const ex = e.pos.x - player.pos.x;
          const ez = e.pos.z - player.pos.z;
          const along = ex * nx + ez * nz;
          if (along < -0.5 || along > dist + 1.5) continue;
          const perp = Math.abs(ex * nz - ez * nx);
          if (perp < 1.8 + e.radius) {
            combat.dealDamage(e, dmg, { kbX: nx, kbZ: nz, kb: 11, heavy: true, countCombo: true });
            e.freeze(stun);
          }
        }
        this.ctx.controller.push(nx * dist * 9, nz * dist * 9);
        this.ctx.controller.externalMoveTimer = 0.16;
        player.spawnGhost();
        if (upgraded) {
          player.shield = Math.max(player.shield, 15);
          this.ctx.events.emit("SHIELD_GAINED", { amount: 15 });
        }
        const fx2x = player.pos.x + nx * dist * 0.8;
        const fx2z = player.pos.z + nz * dist * 0.8;
        fx.ring(fx2x, fx2z, { radius: upgraded ? 3 : 2.2, color: 0x7fd0ff, duration: 0.4 });
        fx.burst({
          x: fx2x, y: 0.8, z: fx2z,
          count: 26, color: [0x7fd0ff, 0xffffff], speed: [3, 10], up: 0.5, size: [0.4, 0.8], life: [0.2, 0.5], gravity: -3, drag: 3,
        });
        this.ctx.cam.addTrauma(0.28);
        this.ctx.cam.kick(nx, nz, 4);
        this.ctx.stage.punch(0.3);
        return true;
      }

      case "rend-boomerang": {
        const nx = Math.sin(player.facing);
        const nz = Math.cos(player.facing);
        const mat = new THREE.MeshStandardMaterial({
          color: 0x551515, emissive: 0xff5555, emissiveIntensity: 1.5, flatShading: true,
        });
        const mesh = new THREE.Mesh(this.boomerangGeo, mat);
        mesh.position.set(player.pos.x, 1.0, player.pos.z);
        this.ctx.stage.scene.add(mesh);
        this.boomerangs.push({
          ox: player.pos.x, oz: player.pos.z, nx, nz,
          t: 0, dur: upgraded ? 1.0 : 0.85, reach: upgraded ? 11 : 8.5,
          dmg: upgraded ? 34 : 24, bleedTicks: upgraded ? 6 : 4, hit: new Set(), clearedReturn: false, mesh, mat,
        });
        this.fakeSwing = 0;
        this.ctx.cam.kick(nx, nz, 2.4);
        return true;
      }

      case "grave-harvest": {
        // Revenant signature: reap + bleed everything near you, leeching life per soul —
        // bleeds finishing foes also stoke the Revenant's kill-heal passive.
        const R = upgraded ? 6.5 : 5;
        let reaped = 0;
        for (const e of enemies.living()) {
          const dx = e.pos.x - player.pos.x;
          const dz = e.pos.z - player.pos.z;
          if (Math.hypot(dx, dz) < R + e.radius) {
            combat.dealDamage(e, upgraded ? 30 : 22, { kbX: dx, kbZ: dz, kb: 2, countCombo: true });
            this.addBleed(e, upgraded ? 6 : 4, upgraded ? 5 : 3, 0xff6ba0);
            reaped++;
          }
        }
        const heal = Math.min(player.maxHp - player.hp, reaped * (upgraded ? 7 : 5));
        if (heal > 0) { player.hp += heal; this.ctx.events.emit("HEAL", { amount: heal }); }
        fx.ring(player.pos.x, player.pos.z, { radius: R, color: 0xff6ba0, duration: 0.55 });
        fx.burst({
          x: player.pos.x, y: 1.0, z: player.pos.z,
          count: 32, color: [0xff6ba0, 0xb83a6a, 0xffffff], speed: [3, 9], up: 0.6, size: [0.4, 0.85], life: [0.3, 0.65], gravity: -2, drag: 3,
        });
        this.ctx.stage.punch(0.16);
        return true;
      }

      case "bulwark-breaker": {
        // Bulwark signature: a stationary shock that hurls the pack out and converts
        // each foe struck into barrier — the more you're swarmed, the stouter you stand.
        const R = upgraded ? 6 : 4.6;
        let struck = 0;
        for (const e of enemies.living()) {
          const dx = e.pos.x - player.pos.x;
          const dz = e.pos.z - player.pos.z;
          if (Math.hypot(dx, dz) < R + e.radius) {
            combat.dealDamage(e, upgraded ? 30 : 22, { kbX: dx, kbZ: dz, kb: 12, heavy: true, countCombo: true });
            struck++;
          }
        }
        const barrier = Math.min(upgraded ? 50 : 32, (upgraded ? 12 : 8) + struck * (upgraded ? 9 : 6));
        player.shield = Math.max(player.shield, barrier);
        this.ctx.events.emit("SHIELD_GAINED", { amount: barrier });
        fx.ring(player.pos.x, player.pos.z, { radius: R, color: 0x7fd0ff, duration: 0.45 });
        fx.ring(player.pos.x, player.pos.z, { radius: R * 0.55, color: 0xffffff, duration: 0.32 });
        fx.burst({
          x: player.pos.x, y: 0.6, z: player.pos.z,
          count: 32, color: [0x7fd0ff, 0xffffff], speed: [4, 12], up: 0.7, size: [0.45, 1.0], life: [0.25, 0.6], gravity: -4, drag: 2.6,
        });
        this.ctx.cam.addTrauma(0.34);
        this.ctx.stage.punch(0.32);
        return true;
      }

      case "thunderclap": {
        // A point-blank shock that hammers and briefly stuns (freeze) everything around you.
        const R = upgraded ? 6 : 4.6;
        for (const e of enemies.living()) {
          const dx = e.pos.x - player.pos.x;
          const dz = e.pos.z - player.pos.z;
          if (Math.hypot(dx, dz) < R + e.radius) {
            combat.dealDamage(e, upgraded ? 26 : 18, { kbX: dx, kbZ: dz, kb: 6, heavy: true, countCombo: true });
            e.freeze(upgraded ? 1.4 : 0.9);
          }
        }
        fx.ring(player.pos.x, player.pos.z, { radius: R, color: 0xffe066, duration: 0.4 });
        fx.ring(player.pos.x, player.pos.z, { radius: R * 0.5, color: 0xffffff, duration: 0.28 });
        fx.burst({
          x: player.pos.x, y: 1.0, z: player.pos.z,
          count: 28, color: [0xffe066, 0xffffff], speed: [4, 13], up: 0.5, size: [0.35, 0.8], life: [0.2, 0.5], gravity: -2, drag: 3,
        });
        this.ctx.cam.addTrauma(0.32);
        this.ctx.stage.punch(0.3);
        return true;
      }

      case "frost-lattice": {
        // Spears of frost lance out in a cross (honed: an 8-point star), freezing all
        // they cross. A foe at an intersection is only struck once (dedup by id).
        const range = upgraded ? 14 : 11;
        const width = upgraded ? 1.5 : 1.1;
        const dirs = upgraded ? 8 : 4;
        const hit = new Set<number>();
        for (let d = 0; d < dirs; d++) {
          const ang = player.facing + (d / dirs) * Math.PI * 2;
          const nx = Math.sin(ang), nz = Math.cos(ang);
          for (const e of enemies.living()) {
            if (hit.has(e.id)) continue;
            const ex = e.pos.x - player.pos.x;
            const ez = e.pos.z - player.pos.z;
            const along = ex * nx + ez * nz;
            if (along < -0.5 || along > range) continue;
            if (Math.abs(ex * nz - ez * nx) < width + e.radius) {
              combat.dealDamage(e, upgraded ? 22 : 16, { kbX: nx, kbZ: nz, kb: 2, countCombo: true });
              e.freeze(upgraded ? 2.6 : 1.8);
              hit.add(e.id);
            }
          }
          for (let i = 1; i <= 5; i++) {
            const dd = (range / 5) * i;
            fx.burst({
              x: player.pos.x + nx * dd, y: 0.8, z: player.pos.z + nz * dd,
              count: 3, color: [0xbfeaff, 0xffffff], speed: [1, 3], up: 0.5, size: [0.3, 0.6], life: [0.2, 0.45], gravity: -2, drag: 3,
            });
          }
        }
        fx.ring(player.pos.x, player.pos.z, { radius: 2.2, color: 0xbfeaff, duration: 0.4 });
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
    const R = this.aegisUpgraded ? 4.4 : 3;
    const dmg = this.aegisUpgraded ? 34 : 22;
    for (const e of this.ctx.enemies.living()) {
      const dx = e.pos.x - player.pos.x;
      const dz = e.pos.z - player.pos.z;
      if (Math.hypot(dx, dz) < R + e.radius) {
        this.ctx.combat.dealDamage(e, dmg, { kbX: dx, kbZ: dz, kb: 8, heavy: true });
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
    for (const m of this.mines) { this.ctx.stage.scene.remove(m.mesh); m.mat.dispose(); }
    for (const p of this.phantoms) { this.ctx.stage.scene.remove(p.group); disposeGroup(p.group); }
    for (const w of this.wells) {
      this.ctx.stage.scene.remove(w.mesh);
      w.mat.dispose();
    }
    for (const s of this.seekers) {
      this.ctx.stage.scene.remove(s.mesh);
      s.mat.dispose();
    }
    for (const h of this.holes) {
      this.ctx.stage.scene.remove(h.mesh);
      h.mesh.geometry.dispose();
      h.mat.dispose();
    }
    for (const tm of this.totems) {
      this.ctx.stage.scene.remove(tm.group);
      tm.group.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    }
    for (const lo of this.leeches) {
      this.ctx.stage.scene.remove(lo.mesh);
      lo.mesh.geometry.dispose();
      lo.mat.dispose();
    }
    for (const b of this.boomerangs) {
      this.ctx.stage.scene.remove(b.mesh);
      b.mat.dispose();
    }
    this.mines = [];
    this.phantoms = [];
    this.wells = [];
    this.bleeds = [];
    this.meteors = [];
    this.pulses = [];
    this.cycloneTimers = [];
    this.seekers = [];
    this.holes = [];
    this.storms = [];
    this.jets = [];
    this.totems = [];
    this.leeches = [];
    this.boomerangs = [];
    this.riposteTimer = 0;
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
        this.ctx.combat.dealDamage(b.enemy, Math.round(b.dmg * this.ctx.relics.dotMult()), {});
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
          this.ctx.combat.dealDamage(e, 15, { kbX: dx, kbZ: dz, kb: 3, countCombo: true });
        }
      }
    }

    // Meteors (Meteor Call + Starfall shards)
    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const m = this.meteors[i];
      m.timer -= dt;
      if (!m.quiet) {
        m.pulseAcc -= dt;
        if (m.pulseAcc <= 0 && m.timer > 0.15) {
          m.pulseAcc = 0.3;
          this.ctx.fx.ring(m.x, m.z, { radius: m.r, color: 0xff8a4d, duration: 0.28 });
        }
      }
      if (m.timer > 0) continue;
      this.meteors.splice(i, 1);
      const big = m.r > 2;
      this.ctx.fx.burst({
        x: m.x, y: 1.2, z: m.z,
        count: big ? 50 : 18, color: big ? [0xff8a4d, 0xffcc66, 0xffffff] : [0x9fb8ff, 0xffffff],
        speed: [4, big ? 14 : 9], up: 0.9, size: [0.5, big ? 1.2 : 0.8], life: [0.3, 0.7], gravity: -7, drag: 2.3,
      });
      this.ctx.fx.ring(m.x, m.z, { radius: m.r, color: big ? 0xff8a4d : 0x9fb8ff, duration: 0.45 });
      if (big) this.ctx.fx.ring(m.x, m.z, { radius: m.r * 0.55, color: 0xffffff, duration: 0.35 });
      this.ctx.cam.addTrauma(big ? 0.35 : 0.12);
      if (big) this.ctx.stage.punch(0.2);
      this.ctx.sfx.explosion();
      for (const e of this.ctx.enemies.living()) {
        const dx = e.pos.x - m.x;
        const dz = e.pos.z - m.z;
        if (Math.hypot(dx, dz) < m.r + e.radius) {
          this.ctx.combat.dealDamage(e, m.dmg, { kbX: dx, kbZ: dz, kb: big ? 8 : 3, heavy: big, countCombo: true });
        }
      }
    }

    // Blade Cyclone pulses (centered on the player as they move)
    for (let i = this.cycloneTimers.length - 1; i >= 0; i--) {
      this.cycloneTimers[i] -= dt;
      if (this.cycloneTimers[i] > 0) continue;
      this.cycloneTimers.splice(i, 1);
      const p = this.ctx.player;
      const cr = this.cycloneRadius;
      this.ctx.combat.slashVisual(Math.PI * 2, cr, false);
      this.ctx.fx.ring(p.pos.x, p.pos.z, { radius: cr, color: 0x7fe8d8, duration: 0.3 });
      this.ctx.sfx.swing(2, true);
      for (const e of this.ctx.enemies.living()) {
        const dx = e.pos.x - p.pos.x;
        const dz = e.pos.z - p.pos.z;
        if (Math.hypot(dx, dz) < cr + e.radius) {
          this.ctx.combat.dealDamage(e, 20, { kbX: dx, kbZ: dz, kb: 3, countCombo: true });
        }
      }
    }

    // Riposte stance: golden shimmer while armed
    if (this.riposteTimer > 0) {
      this.riposteTimer -= dt;
      if (Math.random() < dt * 10) {
        const p = this.ctx.player;
        this.ctx.fx.burst({
          x: p.pos.x, y: 1.0, z: p.pos.z, count: 1, color: 0xffe066,
          speed: [0.5, 1.5], up: 1.3, size: [0.25, 0.5], life: [0.25, 0.45], gravity: 0, drag: 2, jitter: 0.5,
        });
      }
    }

    // Gravity wells: pull, then pop
    for (let i = this.wells.length - 1; i >= 0; i--) {
      const w = this.wells[i];
      w.timer -= dt;
      w.mesh.scale.setScalar(1 + Math.sin(w.timer * 20) * 0.15);
      w.mat.opacity = 0.45 + Math.sin(w.timer * 14) * 0.2;
      const pull = w.upgraded ? 7.5 : 5.5;
      for (const e of this.ctx.enemies.living()) {
        const dx = w.x - e.pos.x;
        const dz = w.z - e.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < pull && d > 0.4) e.shove(dx, dz, 22 * dt);
      }
      if (w.timer > 0) continue;
      this.wells.splice(i, 1);
      this.ctx.stage.scene.remove(w.mesh);
      w.mesh.geometry.dispose();
      w.mat.dispose();
      const popR = w.upgraded ? 3.4 : 2.6;
      this.ctx.fx.ring(w.x, w.z, { radius: popR, color: 0xb08fff, duration: 0.4 });
      this.ctx.fx.burst({
        x: w.x, y: 1.0, z: w.z,
        count: 30, color: [0xb08fff, 0xffffff],
        speed: [3, 9], up: 0.6, size: [0.4, 0.8], life: [0.25, 0.55], gravity: -3, drag: 3,
      });
      this.ctx.sfx.phantomBoom();
      for (const e of this.ctx.enemies.living()) {
        const dx = e.pos.x - w.x;
        const dz = e.pos.z - w.z;
        if (Math.hypot(dx, dz) < popR + e.radius) {
          this.ctx.combat.dealDamage(e, w.upgraded ? 28 : 16, { kbX: dx, kbZ: dz, kb: 2, countCombo: true });
          e.applyVulnerable(w.upgraded ? 5 : 3.5, 1.3); // the crush leaves them exposed
        }
      }
    }

    // Seeker Swarm: homing motes that curve toward the nearest foe
    for (let i = this.seekers.length - 1; i >= 0; i--) {
      const s = this.seekers[i];
      s.life -= dt;
      // Steer toward nearest living enemy
      let best: Enemy | null = null;
      let bestD = 18;
      for (const e of this.ctx.enemies.living()) {
        const d = Math.hypot(e.pos.x - s.x, e.pos.z - s.z);
        if (d < bestD) {
          bestD = d;
          best = e;
        }
      }
      if (best) {
        const tx = best.pos.x - s.x;
        const tz = best.pos.z - s.z;
        const tl = Math.hypot(tx, tz) || 1;
        const steer = 26 * dt;
        s.vx += (tx / tl) * steer;
        s.vz += (tz / tl) * steer;
        const sp = Math.hypot(s.vx, s.vz);
        const cap = 13;
        if (sp > cap) {
          s.vx = (s.vx / sp) * cap;
          s.vz = (s.vz / sp) * cap;
        }
      }
      s.x += s.vx * dt;
      s.z += s.vz * dt;
      s.mesh.position.set(s.x, 1.0, s.z);
      s.mesh.rotation.y += dt * 9;
      s.trailAcc += dt;
      if (s.trailAcc > 0.04) {
        s.trailAcc = 0;
        this.ctx.fx.burst({
          x: s.x, y: 1.0, z: s.z, count: 1, color: 0x9fffd0,
          speed: [0.2, 0.8], up: 0.2, size: [0.25, 0.45], life: [0.12, 0.28], gravity: 0, drag: 2, jitter: 0.1,
        });
      }
      let popped = s.life <= 0;
      if (best && bestD < best.radius + 0.5) {
        this.ctx.combat.dealDamage(best, s.dmg, { kbX: s.vx, kbZ: s.vz, kb: 3, countCombo: true });
        popped = true;
      }
      if (popped) {
        this.seekers.splice(i, 1);
        this.ctx.stage.scene.remove(s.mesh);
        s.mat.dispose();
        this.ctx.fx.burst({
          x: s.x, y: 1.0, z: s.z, count: 8, color: [0x9fffd0, 0xffffff],
          speed: [2, 6], up: 0.4, size: [0.3, 0.6], life: [0.15, 0.35], gravity: -2, drag: 3,
        });
      }
    }

    // Singularity: pull while alive, then a heavy crush on collapse
    for (let i = this.holes.length - 1; i >= 0; i--) {
      const h = this.holes[i];
      h.timer -= dt;
      h.mesh.rotation.y += dt * 6;
      h.mesh.scale.setScalar(0.6 + Math.max(0, h.timer) * 0.5 + Math.sin(h.timer * 18) * 0.08);
      for (const e of this.ctx.enemies.living()) {
        const dx = h.x - e.pos.x;
        const dz = h.z - e.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < h.pull && d > 0.3) e.shove(dx, dz, 30 * dt);
      }
      if (h.timer > 0) continue;
      this.holes.splice(i, 1);
      this.ctx.stage.scene.remove(h.mesh);
      h.mesh.geometry.dispose();
      h.mat.dispose();
      this.ctx.fx.ring(h.x, h.z, { radius: h.crushR, color: 0x9a6bff, duration: 0.45 });
      this.ctx.fx.ring(h.x, h.z, { radius: h.crushR * 0.5, color: 0xffffff, duration: 0.35 });
      this.ctx.fx.burst({
        x: h.x, y: 1.0, z: h.z,
        count: 40, color: [0x9a6bff, 0xc9a8ff, 0xffffff],
        speed: [4, 13], up: 0.5, size: [0.4, 0.9], life: [0.25, 0.6], gravity: -4, drag: 2.6,
      });
      this.ctx.sfx.phantomBoom();
      this.ctx.cam.addTrauma(0.35);
      this.ctx.stage.punch(0.3);
      for (const e of this.ctx.enemies.living()) {
        const dx = e.pos.x - h.x;
        const dz = e.pos.z - h.z;
        if (Math.hypot(dx, dz) < h.crushR + e.radius) {
          this.ctx.combat.dealDamage(e, h.crushDmg, { kbX: dx, kbZ: dz, kb: 6, heavy: true, countCombo: true });
        }
      }
    }

    // Tempest storm: random strikes on nearby foes over its life
    for (let i = this.storms.length - 1; i >= 0; i--) {
      const st = this.storms[i];
      st.timer -= dt;
      st.strikeAcc -= dt;
      if (st.strikeAcc <= 0 && st.timer > 0) {
        st.strikeAcc = 0.3;
        const inRange: Enemy[] = [];
        for (const e of this.ctx.enemies.living()) {
          if (Math.hypot(e.pos.x - st.x, e.pos.z - st.z) < st.r) inRange.push(e);
        }
        if (inRange.length) {
          const tgt = inRange[Math.floor(this.ctx.rng.range(0, inRange.length)) % inRange.length];
          this.ctx.combat.dealDamage(tgt, st.dmg, { kb: 1 });
          this.lightningVisual([{ x: tgt.pos.x, z: tgt.pos.z - 0.01 }, { x: tgt.pos.x, z: tgt.pos.z }]);
          this.ctx.fx.burst({
            x: tgt.pos.x, y: 1.4, z: tgt.pos.z, count: 10, color: [0xbfe0ff, 0xffffff],
            speed: [2, 7], up: 0.3, size: [0.3, 0.6], life: [0.1, 0.3], gravity: -3, drag: 3,
          });
          this.ctx.sfx.cast("chain-lightning");
        }
      }
      // Ambient drizzle read
      if (st.timer > 0 && Math.random() < dt * 14) {
        const a = this.ctx.rng.range(0, Math.PI * 2);
        const r = this.ctx.rng.range(0, st.r);
        this.ctx.fx.burst({
          x: st.x + Math.sin(a) * r, y: 2.4, z: st.z + Math.cos(a) * r, count: 1, color: 0xbfe0ff,
          speed: [0.2, 0.6], up: -1.5, vertical: 1, size: [0.2, 0.4], life: [0.25, 0.45], gravity: -6, drag: 0.5,
        });
      }
      if (st.timer <= 0) this.storms.splice(i, 1);
    }

    // Flamethrower channel: pours damage in a cone in front of the player
    for (let i = this.jets.length - 1; i >= 0; i--) {
      const j = this.jets[i];
      j.timer -= dt;
      j.tickAcc -= dt;
      const p = this.ctx.player;
      // Continuous fire cone visual
      for (let ring = 1; ring <= 3; ring++) {
        const r = (j.range / 3) * ring;
        const a = p.facing + this.ctx.rng.range(-j.arc / 2, j.arc / 2);
        this.ctx.fx.burst({
          x: p.pos.x + Math.sin(a) * r, y: 0.6, z: p.pos.z + Math.cos(a) * r,
          count: 2, color: [0xff7a33, 0xffd24d], speed: [1, 4], up: 1.0, size: [0.4, 0.8], life: [0.2, 0.5], gravity: -1.5, drag: 2,
        });
      }
      if (j.tickAcc <= 0 && j.timer > 0) {
        j.tickAcc = 0.18;
        for (const e of this.ctx.enemies.living()) {
          const dx = e.pos.x - p.pos.x;
          const dz = e.pos.z - p.pos.z;
          const d = Math.hypot(dx, dz);
          if (d > j.range + e.radius) continue;
          if (Math.abs(angleDelta(p.facing, Math.atan2(dx, dz))) > j.arc / 2) continue;
          this.ctx.combat.dealDamage(e, 8, { kbX: dx, kbZ: dz, kb: 0.5, countCombo: true });
          if (j.burn) this.addBleed(e, 3, 2, 0xff7a33);
        }
      }
      if (j.timer <= 0) this.jets.splice(i, 1);
    }

    // Decoy totems: taunt the pack, then erupt
    for (let i = this.totems.length - 1; i >= 0; i--) {
      const tm = this.totems[i];
      tm.timer -= dt;
      tm.group.rotation.y += dt * 2.5;
      tm.group.children[1].position.y = 1.5 + Math.sin(tm.timer * 8) * 0.1;
      // Lure nearby foes toward the totem
      for (const e of this.ctx.enemies.living()) {
        const dx = tm.x - e.pos.x;
        const dz = tm.z - e.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 9 && d > 1.2) e.shove(dx, dz, 6 * dt);
      }
      if (tm.timer > 0) continue;
      this.totems.splice(i, 1);
      this.ctx.stage.scene.remove(tm.group);
      disposeGroup(tm.group);
      this.ctx.fx.ring(tm.x, tm.z, { radius: tm.blastR, color: 0xffd24d, duration: 0.45 });
      this.ctx.fx.burst({
        x: tm.x, y: 0.8, z: tm.z,
        count: 34, color: [0xffd24d, 0xff9a33, 0xffffff],
        speed: [4, 12], up: 0.6, size: [0.4, 0.9], life: [0.25, 0.6], gravity: -5, drag: 2.6,
      });
      this.ctx.sfx.explosion();
      this.ctx.cam.addTrauma(0.3);
      for (const e of this.ctx.enemies.living()) {
        const dx = e.pos.x - tm.x;
        const dz = e.pos.z - tm.z;
        if (Math.hypot(dx, dz) < tm.blastR + e.radius) {
          this.ctx.combat.dealDamage(e, tm.blastDmg, { kbX: dx, kbZ: dz, kb: 9, heavy: true, countCombo: true });
          if (tm.freeze) e.freeze(1.5);
        }
      }
    }

    // Leech orbs: drift, sap foes on contact, mend the player
    for (let i = this.leeches.length - 1; i >= 0; i--) {
      const lo = this.leeches[i];
      lo.life -= dt;
      lo.hitAcc -= dt;
      lo.x += lo.vx * dt;
      lo.z += lo.vz * dt;
      lo.mesh.position.set(lo.x, 1.0, lo.z);
      lo.mat.opacity = 0.6 + Math.sin(lo.life * 12) * 0.25;
      lo.trailAcc += dt;
      if (lo.trailAcc > 0.05) {
        lo.trailAcc = 0;
        this.ctx.fx.burst({
          x: lo.x, y: 1.0, z: lo.z, count: 1, color: 0xff5fa0,
          speed: [0.2, 0.7], up: 0.2, size: [0.3, 0.5], life: [0.15, 0.3], gravity: 0, drag: 2, jitter: 0.1,
        });
      }
      if (lo.hitAcc <= 0) {
        for (const e of this.ctx.enemies.living()) {
          if (Math.hypot(e.pos.x - lo.x, e.pos.z - lo.z) < 1.4 + e.radius) {
            lo.hitAcc = 0.25;
            this.ctx.combat.dealDamage(e, lo.dmg, { kbX: e.pos.x - lo.x, kbZ: e.pos.z - lo.z, kb: 1, countCombo: true });
            const heal = Math.min(this.ctx.player.maxHp - this.ctx.player.hp, lo.heal);
            if (heal > 0) {
              this.ctx.player.hp += heal;
              this.ctx.events.emit("HEAL", { amount: heal });
            }
            this.lightningVisual([{ x: e.pos.x, z: e.pos.z }, { x: this.ctx.player.pos.x, z: this.ctx.player.pos.z }]);
            break;
          }
        }
      }
      const r = Math.hypot(lo.x, lo.z);
      if (lo.life <= 0 || r > 40) {
        this.leeches.splice(i, 1);
        this.ctx.stage.scene.remove(lo.mesh);
        lo.mesh.geometry.dispose();
        lo.mat.dispose();
      }
    }

    // Rend blades: fly out then return, bleeding what they cross
    for (let i = this.boomerangs.length - 1; i >= 0; i--) {
      const b = this.boomerangs[i];
      b.t += dt;
      const k = Math.min(1, b.t / b.dur);
      const out = Math.sin(k * Math.PI); // 0 → 1 → 0 (out and back)
      const bx = b.ox + b.nx * b.reach * out;
      const bz = b.oz + b.nz * b.reach * out;
      b.mesh.position.set(bx, 1.0, bz);
      b.mesh.rotation.y += dt * 22;
      for (const e of this.ctx.enemies.living()) {
        if (b.hit.has(e.id)) continue;
        if (Math.hypot(e.pos.x - bx, e.pos.z - bz) < 1.0 + e.radius) {
          b.hit.add(e.id);
          this.ctx.combat.dealDamage(e, b.dmg, { kbX: e.pos.x - bx, kbZ: e.pos.z - bz, kb: 3, countCombo: true });
          this.addBleed(e, b.bleedTicks, 3);
        }
      }
      if (!b.clearedReturn && b.t > b.dur * 0.5) {
        b.clearedReturn = true;
        b.hit.clear(); // allow a second cut on the return leg
      }
      this.ctx.fx.burst({
        x: bx, y: 1.0, z: bz, count: 1, color: 0xff5555,
        speed: [0.3, 0.9], up: 0.2, size: [0.3, 0.5], life: [0.12, 0.26], gravity: 0, drag: 2, jitter: 0.12,
      });
      if (k >= 1) {
        this.boomerangs.splice(i, 1);
        this.ctx.stage.scene.remove(b.mesh);
        b.mat.dispose();
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
        m.mat.dispose();
        if (victim || m.life <= 0) {
          const R = 2.4;
          for (const e of this.ctx.enemies.living()) {
            const dx = e.pos.x - m.x;
            const dz = e.pos.z - m.z;
            if (Math.hypot(dx, dz) < R + e.radius) {
              this.ctx.combat.dealDamage(e, 22, { kbX: dx, kbZ: dz, kb: 5, heavy: true, countCombo: true });
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
        disposeGroup(p.group);
        const R = 2.5;
        for (const e of this.ctx.enemies.living()) {
          const dx = e.pos.x - p.x;
          const dz = e.pos.z - p.z;
          if (Math.hypot(dx, dz) < R + e.radius) {
            this.ctx.combat.dealDamage(e, 26, { kbX: dx, kbZ: dz, kb: 6, heavy: true, countCombo: true });
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
