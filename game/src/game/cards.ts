import { cardSchool, schoolElement, type School } from "./specialties";
import { ARENA_RADIUS } from "../render/arena";
import * as THREE from "three";
import { angleDelta, segmentCircleContact } from "../core/math";
import { pursuitTarget } from "./navigation";
import { mineGeometry, rendBladeGeometry, seekerGeometry, spiritBladeGeometry, wardTotem } from "../render/spellModels";
import type { Ctx } from "./ctx";
import type { DamageOpts, Enemy } from "./enemies";
import type { MovementBurst } from "./controller";

/** Release the GPU geometry + material of every mesh under a group (after scene.remove). */
function disposeGroup(group: THREE.Object3D): void {
  const materials = new Set<THREE.Material>();
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      if (Array.isArray(o.material)) for (const material of o.material) materials.add(material);
      else materials.add(o.material);
    }
  });
  for (const material of materials) material.dispose();
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
  /** Element tags used by the Wound when it echoes a stolen ability. */
  tags?: string[];
}

export const CARDS: CardDef[] = [
  { id: "dash-strike", name: "Dash Strike", desc: "Lunge untouchable through the pack, carving everything near your path.", upDesc: "Dashes farther and bursts an AoE on landing.", cooldown: 5, color: "#5fe0ff", glow: 0x5fe0ff, icon: "➤", rarity: "common", tempo: 8 },
  { id: "arc-bolt", name: "Arc Bolt", desc: "A piercing lance of energy that punches through the pack.", upDesc: "Fires a 3-bolt spread.", cooldown: 3, color: "#7fa8ff", glow: 0x7fa8ff, icon: "✦", rarity: "common", tempo: 4 },
  { id: "cleave", name: "Cleave", desc: "A massive sweeping blow. Crowds are an invitation.", upDesc: "Becomes a full 360° sweep for more damage.", cooldown: 5, color: "#ffc266", glow: 0xffc266, icon: "⚔", rarity: "common", tempo: 6 },
  { id: "frost-nova", name: "Frost Nova", desc: "Detonate the cold. Damages and freezes everything nearby.", upDesc: "Bigger radius, harder hit, ~3s freeze.", cooldown: 9, color: "#9fd8ff", glow: 0x9fd8ff, icon: "❄", rarity: "uncommon", tempo: 5 },
  { id: "phase-step", name: "Phase Step", desc: "Blink to the cursor, leaving a phantom that detonates.", upDesc: "Leaves two phantoms that detonate.", cooldown: 7, color: "#c98fff", glow: 0xc98fff, icon: "⟡", rarity: "uncommon", tempo: 5 },
  { id: "mine-field", name: "Mine Field", desc: "Scatter four arc-mines around you. Herd them in.", upDesc: "Scatters six mines instead of four.", cooldown: 9, color: "#ff9a5f", glow: 0xff9a5f, icon: "✸", rarity: "uncommon", tempo: 8 },
  { id: "aegis", name: "Aegis", desc: "Raise 25 barrier. Recast within 4s to blast back — absorbed damage makes it stronger.", upDesc: "40-point barrier with a wider, stronger blast.", cooldown: 12, color: "#7fc8ff", glow: 0x7fc8ff, icon: "⛨", rarity: "uncommon", tempo: 0 },
  { id: "chain-lightning", name: "Chain Lightning", desc: "A bolt that arcs between up to three foes.", upDesc: "Arcs to 6 foes for more damage.", cooldown: 7, color: "#ffe066", glow: 0xffe066, icon: "⚡", rarity: "rare", tempo: 7 },
  { id: "sunder", name: "Sunder", desc: "Four eruptions march down a line in front of you.", upDesc: "Six eruptions march down a longer line.", cooldown: 6, color: "#d8b25f", glow: 0xd8b25f, icon: "⫸", rarity: "common", tempo: 6 },
  { id: "meteor-call", name: "Meteor Call", desc: "Mark the cursor. A heartbeat later, the sky answers.", upDesc: "A second impact strikes the marked center.", cooldown: 9, color: "#ff8a4d", glow: 0xff8a4d, icon: "✴", rarity: "uncommon", tempo: 8 },
  { id: "bleeding-edge", name: "Bleeding Edge", desc: "A wide cleave that leaves deep, ticking wounds.", upDesc: "Inflicts a deeper, longer bleed.", cooldown: 6, color: "#ff6b7a", glow: 0xff6b7a, icon: "❖", rarity: "common", tempo: 6 },
  { id: "storm-conduit", name: "Storm Conduit", desc: "For 5s your sword hits arc sparks to a nearby foe.", upDesc: "Lasts 8s and sparks hit harder.", cooldown: 11, color: "#fff09f", glow: 0xfff09f, icon: "≋", rarity: "rare", tempo: 5 },
  { id: "gravity-well", name: "Gravity Well", desc: "Drag the pack into one point, then pop it.", upDesc: "Wider pull and a stronger pop.", cooldown: 9, color: "#b08fff", glow: 0xb08fff, icon: "◉", rarity: "rare", tempo: 6 },
  { id: "blade-cyclone", name: "Blade Cyclone", desc: "Become the storm — three spinning shockwaves around you.", upDesc: "Adds a fourth, wider shockwave.", cooldown: 8, color: "#7fe8d8", glow: 0x7fe8d8, icon: "❋", rarity: "uncommon", tempo: 7 },
  { id: "riposte", name: "Riposte", desc: "Take a stance. The next hit is denied — and answered.", upDesc: "Longer stance and a fiercer counter.", cooldown: 12, color: "#ffe066", glow: 0xffe066, icon: "⌖", rarity: "rare", tempo: 0 },
  { id: "glacial-lance", name: "Glacial Lance", desc: "A spear of frost down a line — damages and freezes all it crosses.", upDesc: "Longer, wider spear with a deeper freeze.", cooldown: 7, color: "#bfeaff", glow: 0xbfeaff, icon: "❆", rarity: "uncommon", tempo: 6 },
  { id: "warcry", name: "War Cry", desc: "Roar — surge tempo, raise a 12 barrier, and mend 8 HP.", upDesc: "Raises a 20 barrier, mends 16, shoves harder.", cooldown: 12, color: "#ffcf6a", glow: 0xffcf6a, icon: "✜", rarity: "common", tempo: 14 },
  { id: "seeker-swarm", name: "Seeker Swarm", desc: "Loose five homing motes that chase down the pack.", upDesc: "Looses eight harder-hitting motes.", cooldown: 7, color: "#9fffd0", glow: 0x9fffd0, icon: "⁕", rarity: "uncommon", tempo: 7 },
  { id: "tempest-storm", name: "Tempest", desc: "Call a storm — bolts hammer random nearby foes for 3s.", upDesc: "Stronger bolts strike for 5s.", cooldown: 10, color: "#bfe0ff", glow: 0xbfe0ff, icon: "⛆", rarity: "rare", tempo: 8 },
  { id: "flame-channel", name: "Flamethrower", desc: "Channel a roaring cone of fire that pours out in front of you.", upDesc: "Hotter, longer channel that leaves lingering burns.", cooldown: 9, color: "#ff7a33", glow: 0xff7a33, icon: "♨", rarity: "uncommon", tempo: 8 },
  { id: "decoy-totem", name: "Decoy Totem", desc: "Plant a magnetic lure that drags the pack inward, then erupts.", upDesc: "Longer pull with a bigger, freezing blast.", cooldown: 9, color: "#ffd24d", glow: 0xffd24d, icon: "⛾", rarity: "uncommon", tempo: 6 },
  { id: "shield-bash", name: "Shield Bash", desc: "Charge forward, slam a wall of force, and stun all you hit.", upDesc: "Farther charge, heavier slam, longer stun + a barrier.", cooldown: 8, color: "#7fd0ff", glow: 0x7fd0ff, icon: "⛊", rarity: "uncommon", tempo: 8 },
  { id: "rend-boomerang", name: "Rend Blade", desc: "Hurl a blade that carves out and rips back, bleeding all it crosses.", upDesc: "Flies farther, hits harder, leaves deeper wounds.", cooldown: 7, color: "#ff5555", glow: 0xff5555, icon: "↺", rarity: "uncommon", tempo: 7 },
  { id: "rift-hook", name: "Rift Hook", desc: "Pull the pack into sword range. Bosses resist the pull but become vulnerable.", upDesc: "Hooks all around you, hits harder, and chills what arrives.", cooldown: 8, color: "#9a8fff", glow: 0x9a8fff, icon: "☍", rarity: "uncommon", tempo: 7 },
  { id: "blade-spirit", name: "Blade Spirit", desc: "Summon a spectral blade that orbits you, cutting all it crosses.", upDesc: "A faster, fiercer blade that lingers longer.", cooldown: 10, color: "#8fe8ff", glow: 0x8fe8ff, icon: "❂", rarity: "uncommon", tempo: 6 },
  { id: "hemorrhage", name: "Hemorrhage", desc: "Rupture nearby foes, cashing out their remaining bleeds and burns.", upDesc: "A wider rupture that hits harder per wound.", cooldown: 8, color: "#ff4d66", glow: 0xff4d66, icon: "❥", rarity: "rare", tempo: 6 },
  { id: "hammer-drop", name: "Hammer Drop", desc: "Leap to the cursor and crater the ground — a heavy blast, a hard knock-up, and a shield per foe caught.", upDesc: "Wider crater, harder launch, a stouter shield.", cooldown: 9, color: "#ffaa55", glow: 0xffaa55, icon: "⤓", rarity: "rare", tempo: 8 },
  { id: "soul-drain", name: "Soul Drain", desc: "Reap the souls around you — each one mends more the nearer you are to death.", upDesc: "A wider reap that mends far more when wounded.", cooldown: 9, color: "#6affb0", glow: 0x6affb0, icon: "⚱", rarity: "rare", tempo: 7 },
];

/** Build-archetype tags per card — assigned once below so the literals stay readable. */
const CARD_TAGS: Record<string, string[]> = {
  "dash-strike": ["mobility", "force"], "arc-bolt": ["arcane"], "cleave": ["force"],
  "frost-nova": ["frost"], "phase-step": ["mobility", "arcane"], "mine-field": ["force"],
  "aegis": ["guard"], "chain-lightning": ["lightning"], "sunder": ["force"],
  "meteor-call": ["fire"], "bleeding-edge": ["bleed"],
  "storm-conduit": ["lightning"], "gravity-well": ["arcane", "force"], "blade-cyclone": ["force"], "riposte": ["guard"],
  "glacial-lance": ["frost"], "warcry": ["guard", "heal"], "seeker-swarm": ["arcane"], "tempest-storm": ["lightning"], "flame-channel": ["fire"], "decoy-totem": ["summon"],
  "shield-bash": ["guard", "force"], "rend-boomerang": ["bleed"],
  "rift-hook": ["force", "arcane"], "blade-spirit": ["summon", "force"], "hemorrhage": ["bleed"],
  "hammer-drop": ["force", "guard"], "soul-drain": ["heal", "bleed"],
};
for (const c of CARDS) c.tags = CARD_TAGS[c.id] ?? [];
const CARD_IMPACTS = Object.fromEntries(CARDS.map(card => [card.id, {
  attackFamily: "card", element: schoolElement(cardSchool(card)), impactColor: card.glow,
} satisfies DamageOpts]));

/** Save compatibility for the consolidated ability roster. */
const LEGACY_CARDS: Record<string, string> = {
  "charged-lance": "arc-bolt",
  "ward-pulse": "warcry",
  "ember-wave": "flame-channel",
  "tempo-theft": "rift-hook",
  "starfall": "meteor-call",
  "spectral-volley": "arc-bolt",
  "seismic-slam": "sunder",
  "soul-harvest": "soul-drain",
  "singularity": "gravity-well",
  "leech-orb": "soul-drain",
  "tempo-edge": "blade-cyclone",
  "grave-harvest": "soul-drain",
  "bulwark-breaker": "shield-bash",
  "thunderclap": "chain-lightning",
  "frost-lattice": "frost-nova",
  "tempo-surge": "blade-cyclone",
  "arc-overload": "tempest-storm",
  "feral-leap": "hammer-drop",
  "gale-burst": "phase-step"
};

export function cardById(id: string): CardDef {
  const c = CARDS.find((c) => c.id === (LEGACY_CARDS[id] ?? id));
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
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
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
  damage: number;
  burnDamage: number;
  fxAcc: number;
}

/** A magnetic decoy that gathers nearby enemies before erupting. */
interface Totem {
  x: number;
  z: number;
  timer: number;
  blastR: number;
  blastDmg: number;
  freeze: boolean;
  group: THREE.Group;
  crown: THREE.Group;
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
  prevX: number;
  prevZ: number;
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
}

/** An enemy being reeled to the player's feet (Rift Hook). */
interface Yank {
  e: Enemy;
  t: number;
  /** Honed hooks chill what arrives. */
  chill: boolean;
}

/** A spectral blade orbiting the player (Blade Spirit). */
interface SpiritBlade {
  angle: number;
  life: number;
  dmg: number;
  spin: number;
  tickAcc: number;
  trailAcc: number;
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
}

export class CardCaster {
  private mines: Mine[] = [];
  private phantoms: Phantom[] = [];
  private aegisTimer = 0;
  private aegisReserve = 0;
  private aegisAbsorbed = 0;
  /** Whether the live Aegis barrier was cast honed (bigger detonation). */
  private aegisUpgraded = false;
  private fakeSwing = -1;
  private fakeSwingHeavy = true;
  private fakeSwingDur = 0.34;
  private delayed: { remaining: number; run: () => void }[] = [];
  private leap: { motion: MovementBurst; t: number; upgraded: boolean } | null = null;
  get travelActive(): boolean { return !!this.leap || !!this.dashCut; }
  private dashCut: { motion: MovementBurst; x: number; z: number; hits: Set<number>; damage: number; upgraded: boolean; shieldBash: boolean; stun: number } | null = null;
  private mineGeo = mineGeometry();
  private seekerGeo = seekerGeometry();
  private boomerangGeo = rendBladeGeometry();
  private spiritGeo = spiritBladeGeometry();
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
  private cycloneTime = 0;
  private cycloneDuration = 0;
  private riposteTimer = 0;
  /** Whether the armed Riposte was cast honed (fiercer counter). */
  private riposteUpgraded = false;
  private seekers: Seeker[] = [];
  private storms: Storm[] = [];
  private jets: FlameJet[] = [];
  private totems: Totem[] = [];
  private boomerangs: Boomerang[] = [];
  private yanks: Yank[] = [];
  private spirits: SpiritBlade[] = [];

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
    ctx.events.on("ENEMY_HIT", ({ x, z, killed, sword }) => {
      const { deck, player } = this.ctx;
      if (killed && player.alive && deck.specialty?.id === "blood") this.heal(3);
      if (sword && deck.specialty?.id === "storm") deck.slots.forEach((card, slot) => {
        if (card && cardSchool(card) === "storm") deck.cooldowns[slot] = Math.max(0, deck.cooldowns[slot] - 0.15);
      });
      if (this.conduitTimer <= 0 || this.sparking || !sword) return;
      // Arc a spark to the nearest OTHER enemy
      let best: Enemy | null = null;
      let bestD = 6;
      for (const e of this.ctx.enemies.living()) {
        const d = Math.hypot(e.pos.x - x, e.pos.z - z);
        if (d > 0.8 && d < bestD && !this.ctx.arena.blocksSegment(x, z, e.pos.x, e.pos.z)) {
          bestD = d;
          best = e;
        }
      }
      if (!best) return;
      this.sparking = true;
      try { this.hit(best, this.conduitDmg, "storm-conduit", { kb: 1 }); }
      finally { this.sparking = false; } // a throw here must not latch the conduit off for the run
      this.lightningVisual([{ x, z }, { x: best.pos.x, z: best.pos.z }]);
    });
  }

  private effectsWarmed = false;
  /** Prime shared effect materials once; repeated room loads must not leak dummies. */
  precompile(): void {
    if (this.effectsWarmed) return;
    this.effectsWarmed = true;
    const scene = this.ctx.stage.scene;
    const root = new THREE.Group();
    // The warm meshes must be INSIDE the camera frustum for the composer warm frame:
    // renderer.compile() only builds the canvas-target program variant (srgb+ACES);
    // the in-combat variant (composer target: srgb-linear, no tonemap) compiles only
    // when the object is actually DRAWN through the composer — culled = not warmed.
    // The player is always centered in frame, whatever camera mode is active.
    root.position.set(this.ctx.player.pos.x, 1.1, this.ctx.player.pos.z);
    root.scale.setScalar(0.02); // sub-pixel for the one warm frame
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
    // Sprite program (projectile glow halos): no Sprite is drawn until the first
    // shot, so its GL program would otherwise compile mid-fight.
    const spriteCv = document.createElement("canvas");
    spriteCv.width = spriteCv.height = 2;
    add(new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(spriteCv), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
    })));
    // Slash-arc program: flash one REAL pooled slash arc through the warm frame —
    // its double-sided additive program is distinct, and the pooled material lives
    // forever in Combat, so warming the actual mesh keeps the program pinned.
    this.ctx.combat.slashVisual(Math.PI / 2, 1.6, false);
    // Sword-trail ribbon: a custom ShaderMaterial that's invisible until the first
    // swing — prime it so its program compiles now instead of mid-combo.
    this.ctx.trail.warm(this.ctx.player.pos.x, this.ctx.player.pos.z);

    this.ctx.stage.warmUp();
    // Keep the warm meshes alive (hidden): disposing them would release the
    // just-compiled GL programs, and the first real cast of a card whose material
    // archetype lives only here (lightning lines, additive orbs, sprites, emissive
    // totems) would pay the synchronous compile again — the "card hitch" class.
    root.visible = false;
    root.position.set(0, -1000, 0);
    // The warm slash/trail only fade while PLAYING — at the boot menu they'd
    // freeze mid-swing over the idle hero. Hide them now; programs stay compiled.
    this.ctx.combat.clearSlashVisuals();
    this.ctx.trail.clear();
  }

  /** Bleeds stack; a sustained flame refreshes its existing burn. */
  addBleed(enemy: Enemy, ticks: number, dmg: number, color = 0xff6b7a): void {
    if (!enemy.alive || enemy.warded) return;
    const existing = this.bleeds.find(b => b.enemy === enemy && b.color === color);
    if (existing && color !== 0xff6b7a) { existing.ticks = Math.max(existing.ticks, ticks); existing.dmg = Math.max(existing.dmg, dmg); return; }
    this.bleeds.push({ enemy, ticks, timer: 0.5, dmg, color });
  }

  /** True if Aegis is up — pressing its slot again detonates it. */
  get aegisActive(): boolean {
    return this.aegisTimer > 0 && (this.aegisReserve > 0 || this.aegisAbsorbed > 0);
  }
  get aegisRemaining(): number { return this.aegisTimer; }

  /** Damage consumes Aegis first. Later barrier grants survive its detonation. */
  absorbAegisBarrier(amount: number): void {
    if (this.aegisTimer <= 0) return;
    const absorbed = Math.min(amount,this.aegisReserve);
    this.aegisReserve -= absorbed;
    this.aegisAbsorbed += absorbed;
  }

  cast(def: CardDef, upgraded = false): boolean {
    // "Honed" cards each get a bespoke upgrade (the dispatch branches on `upgraded`),
    // plus a 50% tempo bonus and the −30% cooldown applied in the deck.
    if (this.travelActive) return false;
    const detonating = def.id === "aegis" && this.aegisActive;
    const ok = this.dispatch(def, upgraded);
    if (ok) {
      this.castFlourish(def, upgraded);
      const school = cardSchool(def);
      if (!detonating && this.ctx.deck.specialty?.id === school) {
        if (school === "veil") this.ctx.controller.grantIframes(0.2);
        if (school === "guard" && this.ctx.player.shield < 60) {
          const amount = Math.min(6, 60 - this.ctx.player.shield);
          this.ctx.player.shield += amount;
          this.ctx.events.emit("SHIELD_GAINED", { amount });
        }
      }
      this.ctx.events.emit("CARD_CAST", { id: def.id });
      if (def.tempo > 0) this.ctx.tempo.gain(Math.round(def.tempo * (upgraded ? 1.5 : 1)));
      this.ctx.sfx.cast(def.id);
    }
    return ok;
  }

  /** Drive the player's swing pose from a card (heavy sweep vs quick cast flick). */
  private castPose(heavy: boolean): void {
    this.fakeSwing = 0;
    this.fakeSwingHeavy = heavy;
    this.fakeSwingDur = heavy ? 0.34 : 0.22;
  }

  /** Delayed spell impacts keep their own school while the sword is swinging. */
  private hit(enemy: Enemy, damage: number, card: string, opts: DamageOpts = {}): void {
    this.ctx.combat.dealDamage(enemy, damage, { ...CARD_IMPACTS[card], ...opts });
  }

  private castFlourish(def: CardDef, upgraded: boolean): void {
    if (this.fakeSwing < 0 && !this.ctx.combat.swinging && this.cycloneTimers.length === 0 && !this.leap) {
      const school = cardSchool(def);
      const kind = school === "guard" ? "guard" : ["meteor-call", "tempest-storm", "gravity-well", "blade-spirit"].includes(def.id) ? "invoke" : "project";
      this.ctx.player.castGesture = { kind, time: 0, duration: 0.38 };
    }
    const p = this.ctx.player;
    const fx = Math.sin(p.facing);
    const fz = Math.cos(p.facing);
    const x = p.pos.x + fx * 0.65;
    const z = p.pos.z + fz * 0.65;
    this.ctx.fx.burst({
      x, y: 1.15, z,
      count: upgraded ? 7 : 5,
      color: [def.glow, 0xffffff],
      speed: [1.2, 3.5],
      up: 0.45,
      size: [0.07, upgraded ? 0.2 : 0.16],
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
        const dx = aim.x - player.pos.x, dz = aim.z - player.pos.z;
        const len = Math.hypot(dx, dz);
        const nx = len > 0.01 ? dx / len : Math.sin(player.facing);
        const nz = len > 0.01 ? dz / len : Math.cos(player.facing);
        const dist = Math.min(upgraded ? 9 : 6, Math.max(3, len));
        this.ctx.controller.grantIframes(0.35);
        this.castPose(true);
        const motion = this.ctx.controller.moveBurst(nx, nz, dist, 0.18);
        this.dashCut = { motion, x: player.pos.x, z: player.pos.z, hits: new Set(), damage: upgraded ? 46 : 34, upgraded, shieldBash: false, stun: 0 };
        player.spawnGhost();
        this.delay(() => { if (player.alive) player.spawnGhost(); }, 60);
        this.delay(() => { if (player.alive) player.spawnGhost(); }, 120);
        fx.burst({x:player.pos.x,y:0.6,z:player.pos.z,count:10,color:0x8dc9db,speed:[2,6],up:0.25,size:[0.12,0.3],life:[0.12,0.3],gravity:-2,drag:3});
        this.ctx.cam.pulseFov(0.45);
        return true;
      }

      case "arc-bolt": {
        if (upgraded) {
          const spread = (16 * Math.PI) / 180;
          for (let i = -1; i <= 1; i++) {
            this.ctx.projectiles.fire(player.pos.x, player.pos.z, player.facing + i * spread, {
              speed: 30, dmg: 20, color: 0x7fa8ff, radius: 0.36, range: 24, pierce: true, element: "rift", shape: "blade",
            });
          }
        } else {
          this.ctx.projectiles.fire(player.pos.x, player.pos.z, player.facing, {
            speed: 30, dmg: 20, color: 0x7fa8ff, radius: 0.36, range: 24, pierce: true, element: "rift", shape: "blade",
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
        this.castPose(true);
        this.delay(() => {
          if (!player.alive || this.ctx.controller.dodging) return;
          const hits = combat.meleeSweep(player.facing, arc, 3.6, upgraded ? 56 : 42, 7, true);
          combat.slashVisual(arc, 3.6, true);
          if (hits > 0) {
            this.ctx.cam.addTrauma(0.3);
            this.ctx.cam.kick(Math.sin(player.facing), Math.cos(player.facing), 4);
          }
        }, 100);
        return true;
      }

      case "hammer-drop": {
        const dx = aim.x - player.pos.x, dz = aim.z - player.pos.z;
        const len = Math.hypot(dx, dz);
        const nx = len > 0.01 ? dx / len : Math.sin(player.facing);
        const nz = len > 0.01 ? dz / len : Math.cos(player.facing);
        const dist = Math.min(upgraded ? 8 : 6, len);
        this.ctx.combat.cancelSwing();
        player.castGesture = null;
        const motion = this.ctx.controller.moveBurst(nx, nz, dist, 0.44);
        this.leap = { motion, t: 0, upgraded };
        player.abilityLeap = 0;
        this.ctx.controller.grantIframes(0.5);
        fx.ring(player.pos.x, player.pos.z, { radius: 1.2, color: 0xffaa55, duration: 0.24 });
        return true;
      }

      case "soul-drain": {
        // Revenant: reap nearby foes; each mends more the nearer you are to death.
        const R = upgraded ? 5.5 : 4.2, dmg = upgraded ? 26 : 18;
        const missing = 1 - (player.maxHp > 0 ? player.hp / player.maxHp : 1);
        const healPer = Math.round((upgraded ? 5 : 3) * (1 + missing * 1.5));
        let reaped = 0;
        for (const e of enemies.living()) {
          const dx = e.pos.x - player.pos.x, dz = e.pos.z - player.pos.z;
          if (Math.hypot(dx, dz) < R + e.radius && !e.warded) {
            if (this.ctx.arena.blocksSegment(player.pos.x, player.pos.z, e.pos.x, e.pos.z)) continue;
            this.hit(e, dmg, "soul-drain", { kbX: dx, kbZ: dz, kb: 3 });
            if (e.lastBodyDamage > 0) { reaped++; this.lightningVisual([{ x: e.pos.x, z: e.pos.z }, { x: player.pos.x, z: player.pos.z }], 0x6affb0); }
          }
        }
        if (!reaped) return false;
        this.heal(healPer * Math.min(4, reaped));
        fx.ring(player.pos.x, player.pos.z, { radius: R, color: 0x6affb0, duration: 0.5 });
        fx.burst({ x: player.pos.x, y: 1, z: player.pos.z, count: 26, color: [0x6affb0, 0xffffff], speed: [3, 9], up: 0.6, size: [0.3, 0.7], life: [0.3, 0.7], gravity: -2, drag: 2.8 });
        this.ctx.cam.addTrauma(0.16);
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
            if (this.ctx.arena.blocksSegment(player.pos.x, player.pos.z, e.pos.x, e.pos.z)) continue;
            this.hit(e, dmg, "frost-nova", { kbX: dx, kbZ: dz, kb: 3 });
            if (e.lastBodyDamage > 0) e.freeze(freeze);
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
        this.resolveLanding();
        this.ctx.controller.grantIframes(0.25);
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
          const {x:mx,z:mz}=this.groundPoint(player.pos.x+Math.sin(a)*r,player.pos.z+Math.cos(a)*r,.4);
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
        const gained = Math.max(0, amount - player.shield);
        this.aegisUpgraded = upgraded;
        player.shield += gained;
        this.aegisReserve = Math.min(amount,player.shield);
        this.aegisAbsorbed = 0;
        this.aegisTimer = 4;
        if (gained > 0) this.ctx.events.emit("SHIELD_GAINED", { amount: gained });
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
            if (d < bestD && !this.ctx.arena.blocksSegment(cur.x, cur.z, e.pos.x, e.pos.z)) {
              bestD = d;
              best = e;
            }
          }
          if (!best) break;
          hit.add(best.id);
          targets.push({ x: best.pos.x, z: best.pos.z });
          this.hit(best, boltDmg, "chain-lightning", { kb: 2, kbX: best.pos.x - cur.x, kbZ: best.pos.z - cur.z });
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
        let placed=0;
        for (let i = 0; i < count; i++) {
          const d = 2.0 + i * 1.9;
          const x=player.pos.x+Math.sin(player.facing)*d,z=player.pos.z+Math.cos(player.facing)*d;
          if(!this.ctx.arena.containsPoint(x,z,.25)||this.ctx.arena.blocksSegment(player.pos.x,player.pos.z,x,z))break;
          this.pulses.push({
            x,z,
            timer: 0.1 + i * 0.12,
          });
          placed++;
        }
        if(!placed)return false;
        this.castPose(true);
        this.ctx.cam.kick(Math.sin(player.facing), Math.cos(player.facing), 2.5);
        return true;
      }

      case "meteor-call": {
        const dx = aim.x - player.pos.x;
        const dz = aim.z - player.pos.z;
        const len = Math.hypot(dx, dz);
        const dist = Math.min(12, len);
        const nx = len > 0.01 ? dx / len : Math.sin(player.facing);
        const nz = len > 0.01 ? dz / len : Math.cos(player.facing);
        const {x:tx,z:tz}=this.groundPoint(player.pos.x+nx*dist,player.pos.z+nz*dist);
        // Friendly mark — fx ring, not the enemy-threat telegraph language
        fx.ring(tx, tz, { radius: 3.2, color: 0xff8a4d, duration: 0.72 });
        this.spawnMeteor(tx, tz, 0.72, 3.2, 42);
        // Honed: the follow-up strikes the marked center, rewarding a setup.
        if (upgraded) {
          const ox = tx;
          const oz = tz;
          fx.ring(ox, oz, { radius: 3.2, color: 0xff8a4d, duration: 1.0 });
          this.spawnMeteor(ox, oz, 1.0, 3.2, 42);
        }
        return true;
      }

      case "bleeding-edge": {
        const arc = (150 * Math.PI) / 180;
        const range = 3.4;
        this.castPose(true);
        this.delay(() => {
          if (!player.alive || this.ctx.controller.dodging) return;
          let hits = 0;
          for (const e of enemies.living()) {
            const dx = e.pos.x - player.pos.x;
            const dz = e.pos.z - player.pos.z;
            const d = Math.hypot(dx, dz);
            if (d > range + e.radius) continue;
            if (Math.abs(angleDelta(player.facing, Math.atan2(dx, dz))) > arc / 2) continue;
            if (this.ctx.arena.blocksSegment(player.pos.x, player.pos.z, e.pos.x, e.pos.z)) continue;
            this.hit(e, upgraded ? 31 : 24, "bleeding-edge", { kbX: dx, kbZ: dz, kb: 4 });
            if (e.lastBodyDamage > 0) this.addBleed(e, upgraded ? 8 : 5, upgraded ? 5 : 3);
            hits++;
          }
          combat.slashVisual(arc, range, false);
          if (hits > 0) this.ctx.cam.addTrauma(0.18);
        }, 100);
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
        const {x:wx,z:wz}=this.groundPoint(player.pos.x+nx*dist,player.pos.z+nz*dist,.7);
        const mat = new THREE.MeshBasicMaterial({
          color: 0x151125,
        });
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 10), mat);
        for (const tilt of [-.7, .8]) {
          const orbit = new THREE.Mesh(new THREE.TorusGeometry(.68, .025, 4, 40), new THREE.MeshBasicMaterial({ color: 0xb08fff, transparent: true, opacity: .6, depthWrite: false }));
          orbit.rotation.set(tilt, .4, 0); mesh.add(orbit);
        }
        mesh.position.set(wx, 1.0, wz);
        this.ctx.stage.scene.add(mesh);
        this.wells.push({ x: wx, z: wz, timer: 1.2, mesh, upgraded });
        fx.ring(wx, wz, { radius: upgraded ? 6.5 : 5, color: 0xb08fff, duration: 0.6 });
        return true;
      }

      case "blade-cyclone": {
        this.cycloneRadius = upgraded ? 4.0 : 3.2;
        this.cycloneTimers = upgraded ? [0.12, 0.34, 0.56, 0.78] : [0.12, 0.34, 0.56];
        this.cycloneTime = 0;
        this.cycloneDuration = upgraded ? 0.88 : 0.66;
        player.abilitySpin = 0;
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

      case "glacial-lance": {
        const nx = Math.sin(player.facing);
        const nz = Math.cos(player.facing);
        let range = upgraded ? 17 : 13;
        const wall=this.ctx.arena.firstSolidHit(player.pos.x,player.pos.z,player.pos.x+nx*range,player.pos.z+nz*range,.16);
        if(wall!==Infinity)range*=wall;
        if(range<.4)return false;
        const width = upgraded ? 1.8 : 1.2;
        for (const e of enemies.living()) {
          const ex = e.pos.x - player.pos.x;
          const ez = e.pos.z - player.pos.z;
          const along = ex * nx + ez * nz;
          if (along < -0.5 || along > range) continue;
          const perp = Math.abs(ex * nz - ez * nx);
          if (perp < width + e.radius) {
            this.hit(e, upgraded ? 28 : 20, "glacial-lance", { kbX: nx, kbZ: nz, kb: 2 });
            if(e.lastBodyDamage>0)e.freeze(upgraded ? 3.2 : 2.2);
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

      case "warcry": {
        const heal = Math.min(upgraded ? 16 : 8, player.maxHp - player.hp);
        if (heal > 0) {
          player.hp += heal;
          this.ctx.events.emit("HEAL", { amount: heal });
        }
        const barrier = upgraded ? 20 : 12;
        const before = player.shield;
        player.shield = Math.max(player.shield, barrier);
        if (player.shield > before) this.ctx.events.emit("SHIELD_GAINED", { amount: player.shield - before });
        const shove = upgraded ? 10 : 6;
        for (const e of enemies.living()) {
          const dx = e.pos.x - player.pos.x;
          const dz = e.pos.z - player.pos.z;
          if (Math.hypot(dx, dz) < 4 + e.radius && !this.ctx.arena.blocksSegment(player.pos.x, player.pos.z, e.pos.x, e.pos.z)) e.shove(dx, dz, shove);
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

      case "tempest-storm": {
        const dx = aim.x - player.pos.x;
        const dz = aim.z - player.pos.z;
        const len = Math.hypot(dx, dz);
        const dist = Math.min(10, len);
        const nx = len > 0.01 ? dx / len : Math.sin(player.facing);
        const nz = len > 0.01 ? dz / len : Math.cos(player.facing);
        const {x:sx,z:sz}=this.groundPoint(player.pos.x+nx*dist,player.pos.z+nz*dist);
        this.storms.push({
          x: sx, z: sz, timer: upgraded ? 5 : 3, strikeAcc: 0.2,
          r: upgraded ? 7 : 5.5, dmg: upgraded ? 22 : 15,
        });
        fx.ring(sx, sz, { radius: upgraded ? 7 : 5.5, color: 0xbfe0ff, duration: 0.6 });
        return true;
      }

      case "flame-channel": {
        this.jets.length = 0;
        this.jets.push({
          timer: upgraded ? 1.8 : 1.3, tickAcc: 0, fxAcc: 0,
          range: upgraded ? 6.2 : 5, arc: (upgraded ? 70 : 55) * Math.PI / 180,
          damage: upgraded ? 11 : 8, burnDamage: upgraded ? 3 : 2,
        });
        this.ctx.cam.addTrauma(0.06);
        return true;
      }

      case "decoy-totem": {
        const {x:tx,z:tz}=this.groundPoint(player.pos.x+Math.sin(player.facing)*2.2,player.pos.z+Math.cos(player.facing)*2.2,.5);
        const { group, crown } = wardTotem(upgraded);
        group.position.set(tx, 0, tz);
        this.ctx.stage.scene.add(group);
        this.totems.push({
          x: tx, z: tz, timer: upgraded ? 3 : 2.4,
          blastR: upgraded ? 5 : 3.6, blastDmg: upgraded ? 42 : 28, freeze: upgraded, group, crown,
        });
        fx.ring(tx, tz, { radius: 2, color: 0xffd24d, duration: 0.5 });
        return true;
      }

      case "shield-bash": {
        const nx = Math.sin(player.facing), nz = Math.cos(player.facing);
        const motion = this.ctx.controller.moveBurst(nx, nz, upgraded ? 7 : 5, 0.16);
        this.dashCut = { motion, x: player.pos.x, z: player.pos.z, hits: new Set(), damage: upgraded ? 44 : 32, upgraded, shieldBash: true, stun: upgraded ? 1.2 : 0.7 };
        player.spawnGhost();
        this.castPose(true);
        if (upgraded) {
          const gained = Math.max(0, 15 - player.shield);
          player.shield += gained;
          if (gained > 0) this.ctx.events.emit("SHIELD_GAINED", { amount: gained });
        }
        this.ctx.cam.kick(nx, nz, 2);
        return true;
      }

      case "rend-boomerang": {
        const nx = Math.sin(player.facing);
        const nz = Math.cos(player.facing);
        const mat = new THREE.MeshStandardMaterial({
          color: 0x8c5559, emissive: 0xe96974, emissiveIntensity: .55, metalness:.6,roughness:.4,
        });
        const mesh = new THREE.Mesh(this.boomerangGeo, mat);
        mesh.position.set(player.pos.x, 1.0, player.pos.z);
        this.ctx.stage.scene.add(mesh);
        this.boomerangs.push({
          ox: player.pos.x, oz: player.pos.z, nx, nz, prevX: player.pos.x, prevZ: player.pos.z,
          t: 0, dur: upgraded ? 1.0 : 0.85, reach: upgraded ? 11 : 8.5,
          dmg: upgraded ? 34 : 24, bleedTicks: upgraded ? 6 : 4, hit: new Set(), clearedReturn: false, mesh, mat,
        });
        this.castPose(true);
        this.ctx.cam.kick(nx, nz, 2.4);
        return true;
      }

      case "rift-hook": {
        // The pull verb: tether the pack and reel it to your feet — arrivals land
        // Vulnerable, primed for point-blank novas and Shatterglass setups.
        const range = upgraded ? 11 : 9;
        const arc = upgraded ? Math.PI * 2 : (110 * Math.PI) / 180;
        const dmg = upgraded ? 14 : 8;
        let hooked = 0;
        for (const e of enemies.living()) {
          const dx = e.pos.x - player.pos.x;
          const dz = e.pos.z - player.pos.z;
          const d = Math.hypot(dx, dz);
          if (d > range + e.radius || d < 1.6 || e.warded) continue;
          if(this.ctx.arena.blocksSegment(player.pos.x,player.pos.z,e.pos.x,e.pos.z))continue;
          if (arc < Math.PI * 2 && Math.abs(angleDelta(player.facing, Math.atan2(dx, dz))) > arc / 2) continue;
          this.hit(e, dmg, "rift-hook", { kbX: -dx, kbZ: -dz, kb: 2 });
          if (e.lastBodyDamage <= 0) continue;
          if (e.kind === "boss") e.applyVulnerable(2.5, 1.15);
          else { e.setSpawnGrace(0.5); this.yanks.push({ e, t: 0.5, chill: upgraded }); }
          this.lightningVisual([{ x: player.pos.x, z: player.pos.z }, { x: e.pos.x, z: e.pos.z }], 0x9a8fff);
          hooked++;
        }
        if (!hooked) return false; // nothing to hook — don't burn the cooldown
        fx.ring(player.pos.x, player.pos.z, { radius: 2.4, color: 0x9a8fff, duration: 0.4 });
        this.ctx.cam.kick(-Math.sin(player.facing), -Math.cos(player.facing), 2.6);
        this.ctx.cam.addTrauma(0.14);
        return true;
      }

      case "blade-spirit": {
        const mat = new THREE.MeshBasicMaterial({
          color: 0x8fe8ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const mesh = new THREE.Mesh(this.spiritGeo, mat);
        mesh.position.set(player.pos.x, 1.1, player.pos.z);
        this.ctx.stage.scene.add(mesh);
        this.spirits.push({
          angle: player.facing, life: upgraded ? 9 : 6, dmg: upgraded ? 13 : 9,
          spin: upgraded ? 3.4 : 2.6, tickAcc: 0, trailAcc: 0, mesh, mat,
        });
        fx.ring(player.pos.x, player.pos.z, { radius: 2.7, color: 0x8fe8ff, duration: 0.45 });
        return true;
      }

      case "hemorrhage": {
        // Consume remaining wounds and burns for one immediate rupture.
        const R = upgraded ? 7 : 5.5;
        const mult = upgraded ? 1.6 : 1.2;
        for (const e of enemies.living()) {
          const dx = e.pos.x - player.pos.x;
          const dz = e.pos.z - player.pos.z;
          if (Math.hypot(dx, dz) > R + e.radius || e.warded || this.ctx.arena.blocksSegment(player.pos.x, player.pos.z, e.pos.x, e.pos.z)) continue;
          let pooled = 0;
          for (let i = this.bleeds.length - 1; i >= 0; i--) {
            const b = this.bleeds[i];
            if (b.enemy !== e) continue;
            pooled += b.ticks * b.dmg;
            this.bleeds.splice(i, 1);
          }
          const ruptured = pooled > 0;
          this.hit(e, (upgraded ? 16 : 10) + Math.round(pooled * mult), "hemorrhage", {
            kbX: dx, kbZ: dz, kb: ruptured ? 6 : 3, heavy: ruptured,
          });
          if (ruptured) {
            fx.burst({
              x: e.pos.x, y: 1.0, z: e.pos.z,
              count: 18, color: [0xff4d66, 0xb8203a, 0xffffff],
              speed: [3, 10], up: 0.6, size: [0.35, 0.8], life: [0.2, 0.5], gravity: -3, drag: 3,
            });
            fx.ring(e.pos.x, e.pos.z, { radius: 1.8, color: 0xff4d66, duration: 0.35 });
          }
        }
        fx.ring(player.pos.x, player.pos.z, { radius: R, color: 0xff4d66, duration: 0.5 });
        this.ctx.stage.punch(0.18);
        this.ctx.cam.addTrauma(0.18);
        return true;
      }
    }
    return false;
  }

  /** Each specialty turns the same earned Crash into a different combat payoff.
   * Uses the ordinary ability machinery, so pause, room cleanup and wards apply. */
  specialtyCrash(school: School, perfect: boolean, x: number, z: number, radius: number, caught: Enemy[]): void {
    const { player, fx } = this.ctx;
    if (school === "steel") {
      for (const offset of [-0.2, 0, 0.2]) this.ctx.projectiles.fire(x, z, player.facing + offset, {
        speed: 25, dmg: perfect ? 20 : 14, color: 0xe6bf79, radius: 0.3, range: 15, pierce: true, shape: "blade", attackFamily: "crash",
      });
    } else if (school === "storm") {
      const points = [{ x, z }], struck = new Set<number>();
      for (let i = 0; i < (perfect ? 6 : 4); i++) {
        const last = points[points.length - 1];
        let target: Enemy | null = null, distance = 7.5;
        for (const e of this.ctx.enemies.living()) {
          if (!e.alive || e.warded || struck.has(e.id)) continue;
          const d = Math.hypot(e.pos.x-last.x,e.pos.z-last.z);
          if (d < distance && !this.ctx.arena.blocksSegment(last.x,last.z,e.pos.x,e.pos.z)) { target = e; distance = d; }
        }
        if (!target) break;
        struck.add(target.id); points.push({ x: target.pos.x, z: target.pos.z });
        this.hit(target, perfect ? 22 : 16, "chain-lightning", { attackFamily: "crash" });
      }
      if (points.length > 1) this.lightningVisual(points, 0xe4d982);
    } else if (school === "rime") {
      for (const e of caught) if (e.alive && !e.warded) {
        e.freeze(perfect ? 2.8 : 1.8); e.applyVulnerable(3, 1.25);
        fx.burst({ x:e.pos.x,y:0.65,z:e.pos.z,count:5,color:0xa7d8ef,speed:[1,3],size:[0.08,0.22],life:[0.2,0.5],gravity:-2 });
      }
    } else if (school === "ember") {
      for (const e of caught) if (e.alive) this.addBleed(e, perfect ? 8 : 6, 4, 0xffa33d);
      fx.ring(x,z,{radius:radius*0.72,color:0xed9d68,duration:0.65});
      this.spawnMeteor(x,z,0.65,radius*0.72,perfect ? 30 : 22);
    } else if (school === "veil") {
      this.ctx.controller.grantIframes(perfect ? 1 : 0.8);
      for (const e of caught) if (e.alive && !e.warded) {
        e.applyVulnerable(3,1.25);
        if (e.kind !== "boss") { e.setSpawnGrace(0.5); this.yanks.push({e,t:0.5,chill:false}); }
        this.lightningVisual([{x,z},{x:e.pos.x,z:e.pos.z}],0xb0a1df);
      }
    } else if (school === "blood") {
      for (const e of caught) {
        let wound = 0;
        for (let i=this.bleeds.length-1;i>=0;i--) if (this.bleeds[i].enemy===e) {
          wound += this.bleeds[i].ticks*this.bleeds[i].dmg; this.bleeds.splice(i,1);
        }
        if (e.alive && wound>0) this.hit(e,wound*(perfect?1.3:1),"hemorrhage",{heavy:true,attackFamily:"crash"});
      }
      this.heal(Math.min(12,caught.length*(perfect?3:2)));
    } else if (school === "guard") {
      this.ctx.hostiles.reflectNear(x,z,radius+2,perfect?18:12);
      const before = player.shield;
      player.shield = Math.min(60,player.shield+(perfect?22:15));
      if (player.shield>before) this.ctx.events.emit("SHIELD_GAINED",{amount:player.shield-before});
    }
  }

  private groundPoint(x: number, z: number, radius=.3): { x: number; z: number } {
    const point={x,z};this.ctx.arena.resolveObstacles(point,radius);return point;
  }

  private spawnMine(x: number, z: number): void {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x795438, emissive: 0xff9a5f, emissiveIntensity: .55, metalness:.5,roughness:.65,
    });
    const mesh = new THREE.Mesh(this.mineGeo, mat);
    mesh.position.set(x, 0.22, z);
    this.ctx.stage.scene.add(mesh);
    this.mines.push({ x, z, life: 8, mesh, mat });
  }

  private spawnPhantom(x: number, z: number): void {
    ({x,z}=this.groundPoint(x,z,.35));
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: 0xb79ace, transparent: true, opacity: 0.42, depthWrite: true,
    });
    const m = new THREE.Mesh(this.ctx.player.echoGeometry(), mat);
    m.userData.solidity = "fx";
    group.add(m);
    group.position.set(x, 0, z);
    this.ctx.stage.scene.add(group);
    this.phantoms.push({ x, z, timer: 0.8, group });
  }

  private detonateAegis(): void {
    const { player, fx } = this.ctx;
    player.shield = Math.max(0, player.shield - this.aegisReserve);
    this.aegisTimer = 0;
    const R = this.aegisUpgraded ? 4.4 : 3;
    const dmg = (this.aegisUpgraded ? 34 : 22) + this.aegisAbsorbed*.8;
    const absorbed = this.aegisAbsorbed;
    this.aegisReserve = this.aegisAbsorbed = 0;
    for (const e of this.ctx.enemies.living()) {
      const dx = e.pos.x - player.pos.x;
      const dz = e.pos.z - player.pos.z;
      if (Math.hypot(dx, dz) < R + e.radius) {
        if (this.ctx.arena.blocksSegment(player.pos.x, player.pos.z, e.pos.x, e.pos.z)) continue;
        this.hit(e, dmg, "aegis", { kbX: dx, kbZ: dz, kb: 8, heavy: true });
      }
    }
    fx.ring(player.pos.x, player.pos.z, { radius: R, color: 0x7fc8ff, duration: 0.45 });
    fx.burst({
      x: player.pos.x, y: 1, z: player.pos.z,
      count: 18, color: [0x7fc8ff, 0xd4e9ed],
      speed: [4, 10], up: 0.5, size: [0.12, 0.36], life: [0.22, 0.45], gravity: -5, drag: 3,
    });
    if (absorbed > 0) this.ctx.floaters.spawn(player.pos.x,2,player.pos.z,"REPRISAL","tempo");
    this.ctx.sfx.shieldBreak();
    if (player.shield <= 0) this.ctx.events.emit("SHIELD_BROKEN", {});
  }

  private lightningVisual(points: { x: number; z: number }[], color = 0xffe066): void {
    const scene = this.ctx.stage.scene;
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 });
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
        count: 10, color, speed: [2, 6], up: 0.6, size: [0.3, 0.6], life: [0.15, 0.35], gravity: -3, drag: 3,
      });
    }
    const geo = new THREE.BufferGeometry().setFromPoints(verts);
    const line = new THREE.Line(geo, mat);
    line.userData.solidity = "fx";
    scene.add(line);
    // dt-driven fade (advanced in update()) — a private rAF + wall-clock loop
    // here defeated freezeForTest/frames(n,dt) and made captures nondeterministic.
    this.lineFades.push({ line, geo, mat, t: 0 });
  }

  /** Live lightning-line fades — advanced by update(dt) on the threaded clock. */
  private lineFades: { line: THREE.Line; geo: THREE.BufferGeometry; mat: THREE.LineBasicMaterial; t: number }[] = [];

  private updateLineFades(dt: number): void {
    for (let i = this.lineFades.length - 1; i >= 0; i--) {
      const f = this.lineFades[i];
      f.t += dt;
      const k = f.t / 0.18;
      if (k >= 1) {
        this.ctx.stage.scene.remove(f.line);
        f.geo.dispose();
        f.mat.dispose();
        this.lineFades.splice(i, 1);
      } else {
        f.mat.opacity = 1 - k;
      }
    }
  }

  clear(): void {
    for (const f of this.lineFades) { this.ctx.stage.scene.remove(f.line); f.geo.dispose(); f.mat.dispose(); }
    this.lineFades = [];
    for (const m of this.mines) { this.ctx.stage.scene.remove(m.mesh); m.mat.dispose(); }
    for (const p of this.phantoms) { this.ctx.stage.scene.remove(p.group); disposeGroup(p.group); }
    for (const w of this.wells) {
      this.ctx.stage.scene.remove(w.mesh);
      disposeGroup(w.mesh);
    }
    for (const s of this.seekers) {
      this.ctx.stage.scene.remove(s.mesh);
      s.mat.dispose();
    }
    for (const tm of this.totems) {
      this.ctx.stage.scene.remove(tm.group);
      disposeGroup(tm.group);
    }
    for (const b of this.boomerangs) {
      this.ctx.stage.scene.remove(b.mesh);
      b.mat.dispose();
    }
    for (const sp of this.spirits) {
      this.ctx.stage.scene.remove(sp.mesh);
      sp.mat.dispose();
    }
    this.mines = [];
    this.phantoms = [];
    this.wells = [];
    this.bleeds = [];
    for (const m of this.meteors) { this.ctx.stage.scene.remove(m.mesh); m.mesh.geometry.dispose(); m.mat.dispose(); }
    this.meteors = [];
    this.pulses = [];
    this.cycloneTimers = [];
    this.cycloneDuration = 0;
    this.ctx.player.abilitySpin = null;
    this.seekers = [];
    this.storms = [];
    this.jets = [];
    this.totems = [];
    this.boomerangs = [];
    this.yanks = [];
    this.spirits = [];
    this.riposteTimer = 0;
    this.conduitTimer = 0;
    this.aegisTimer = 0;
    this.aegisReserve = this.aegisAbsorbed = 0;
    this.fakeSwing = -1; // no card swing-pose bleeds into the next room
    this.delayed.length = 0;
    this.dashCut = null;
    this.leap = null;
    this.ctx.player.abilityLeap = null;
    this.ctx.player.castGesture = null;
    this.ctx.player.shield = 0;
  }

  private spawnMeteor(x: number, z: number, timer: number, r: number, dmg: number): void {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffc37f });
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.38, 1), mat);
    mesh.position.set(x, 0.4 + timer * 14, z);
    this.ctx.stage.scene.add(mesh);
    this.meteors.push({ x, z, timer, pulseAcc: 0, r, dmg, mesh, mat });
  }

  private heal(amount: number): void {
    const p = this.ctx.player;
    const healed = Math.min(Math.max(0, p.maxHp - p.hp), amount);
    if (!p.alive || healed <= 0) return;
    p.hp += healed;
    this.ctx.events.emit("HEAL", { amount: healed });
  }

  private resolveLanding(): void {
    const p = this.ctx.player;
    const limit = ARENA_RADIUS - p.radius;
    for (let i = 0; i < 3; i++) {
      const r = Math.hypot(p.pos.x, p.pos.z);
      if (r > limit) { p.pos.x *= limit / r; p.pos.z *= limit / r; }
      this.ctx.arena.resolveObstacles(p.pos, p.radius);
    }
  }

  private updateLeap(dt: number): void {
    const leap = this.leap;
    if (!leap) return;
    const { player, enemies, fx } = this.ctx;
    leap.t += dt;
    player.abilityLeap = Math.min(1, leap.t / 0.44);
    if (!leap.motion.finished && player.alive) return;
    this.leap = null;
    player.abilityLeap = null;
    if (leap.motion.cancelled || !player.alive) return;
    this.resolveLanding();
    const radius = leap.upgraded ? 5.2 : 4.0;
    let hits = 0;
    for (const enemy of enemies.living()) {
      const dx = enemy.pos.x - player.pos.x, dz = enemy.pos.z - player.pos.z;
      if (Math.hypot(dx, dz) > radius + enemy.radius) continue;
      if (this.ctx.arena.blocksSegment(player.pos.x, player.pos.z, enemy.pos.x, enemy.pos.z)) continue;
      this.hit(enemy, leap.upgraded ? 54 : 40, "hammer-drop", { kbX: dx, kbZ: dz, kb: 9, heavy: true });
      if (enemy.lastBodyDamage > 0) hits++;
    }
    const amount = Math.max(0, (leap.upgraded ? 16 : 10) + Math.min(5, hits) * 4 - player.shield);
    player.shield += amount;
    if (amount) this.ctx.events.emit("SHIELD_GAINED", { amount });
    this.castPose(true);
    fx.ring(player.pos.x, player.pos.z, { radius, color: 0xffaa55, duration: 0.4 });
    fx.burst({ x: player.pos.x, y: 0.3, z: player.pos.z, count: 20, color: [0xffaa55, 0x8a7164], speed: [3, 9], up: 1.6, size: [0.12, 0.4], life: [0.2, 0.5], gravity: -8, drag: 2 });
    this.ctx.decals.crack(player.pos.x, player.pos.z, radius * 0.55);
    this.ctx.cam.addTrauma(0.28);
    this.ctx.sfx.explosion();
  }

  /** Deferred attacks follow game time and are discarded at room teardown. */
  private delay(run: () => void, milliseconds: number): void {
    this.delayed.push({ remaining: milliseconds / 1000, run });
  }

  private updateDashCut(): void {
    const cut = this.dashCut;
    if (!cut) return;
    const p = this.ctx.player;
    if (!p.alive || cut.motion.cancelled) { this.dashCut = null; return; }
    if (!cut.motion.started) return;
    const dx = p.pos.x - cut.x, dz = p.pos.z - cut.z, lengthSq = dx * dx + dz * dz;
    for (const e of this.ctx.enemies.living()) {
      if (cut.hits.has(e.id)) continue;
      const t = lengthSq > 0.0001 ? Math.max(0, Math.min(1, ((e.pos.x-cut.x)*dx+(e.pos.z-cut.z)*dz)/lengthSq)) : 0;
      const x = cut.x + dx*t, z = cut.z + dz*t;
      if (Math.hypot(e.pos.x-x,e.pos.z-z) > (cut.shieldBash ? 1.8 : 1.25) + e.radius) continue;
      if (this.ctx.arena.blocksSegment(x, z, e.pos.x, e.pos.z)) continue;
      cut.hits.add(e.id);
      this.hit(e,cut.damage,cut.shieldBash?"shield-bash":"dash-strike",{kbX:e.pos.x-x,kbZ:e.pos.z-z,kb:cut.shieldBash?11:2.2,heavy:cut.shieldBash,allowShieldStagger:cut.shieldBash});
      if (cut.stun > 0 && (e.lastBodyDamage > 0 || e.lastHitShielded)) e.freeze(cut.stun);
      this.ctx.fx.burst({x:e.pos.x,y:1,z:e.pos.z,count:9,color:[0xc5e3e8,0xffffff],speed:[3,8],up:0.3,size:[0.1,0.25],life:[0.1,0.23],gravity:-2,drag:3});
      this.ctx.cam.addTrauma(0.08);
    }
    cut.x=p.pos.x;cut.z=p.pos.z;
    if (!cut.motion.finished) return;
    this.dashCut=null;
    if (cut.shieldBash) {
      this.ctx.fx.ring(p.pos.x,p.pos.z,{radius:cut.upgraded?3:2.2,color:0x7fd0ff,duration:0.26});
      this.ctx.cam.addTrauma(0.16);
      return;
    }
    if (!cut.upgraded) return;
    const radius=2.6;
    for(const e of this.ctx.enemies.living()) {
      const ex=e.pos.x-p.pos.x,ez=e.pos.z-p.pos.z;
      if(Math.hypot(ex,ez)<radius+e.radius&&!this.ctx.arena.blocksSegment(p.pos.x,p.pos.z,e.pos.x,e.pos.z))this.hit(e,30,"dash-strike",{kbX:ex,kbZ:ez,kb:6,heavy:true});
    }
    this.ctx.fx.ring(p.pos.x,p.pos.z,{radius,color:0xa6d6df,duration:0.28});
    this.ctx.sfx.swing(2);
  }

  update(dt: number): void {
    if (dt <= 0) return;
    for (const action of this.delayed) action.remaining -= dt;
    while (true) {
      const index = this.delayed.findIndex(action => action.remaining <= 0);
      if (index < 0) break;
      const [action] = this.delayed.splice(index, 1);
      action.run();
    }
    this.updateLeap(dt);
    this.updateDashCut();
    this.updateLineFades(dt);
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
        this.hit(b.enemy, Math.round(b.dmg * this.ctx.relics.dotMult() * (this.ctx.deck.specialty?.id === "ember" && b.color !== 0xff6b7a ? 1.35 : 1)), b.color === 0xff6b7a ? "bleeding-edge" : "flame-channel", { impactColor: b.color, sustained: true });
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
          if (this.ctx.arena.blocksSegment(pu.x, pu.z, e.pos.x, e.pos.z)) continue;
          this.hit(e, 15, "sunder", { kbX: dx, kbZ: dz, kb: 3 });
        }
      }
    }

    // Falling impacts from Meteor Call and Funeral Pyre.
    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const m = this.meteors[i];
      m.timer -= dt;
      m.mesh.position.y = 0.4 + Math.max(0, m.timer) * 14;
      m.mesh.rotation.x += dt * 3;
      {
        m.pulseAcc -= dt;
        if (m.pulseAcc <= 0 && m.timer > 0.15) {
          m.pulseAcc = 0.3;
          this.ctx.fx.ring(m.x, m.z, { radius: m.r, color: 0xff8a4d, duration: 0.28 });
        }
      }
      if (m.timer > 0) continue;
      this.meteors.splice(i, 1);
      this.ctx.stage.scene.remove(m.mesh); m.mesh.geometry.dispose(); m.mat.dispose();
      const big = m.r > 2;
      this.ctx.fx.burst({
        x: m.x, y: 1.2, z: m.z,
        count: big ? 24 : 12, color: big ? [0xff8a4d, 0xffcc66, 0xffffff] : [0x9fb8ff, 0xffffff],
        speed: [4, big ? 14 : 9], up: 0.9, size: [0.12, big ? 0.5 : 0.3], life: [0.3, 0.7], gravity: -7, drag: 2.3,
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
          if (this.ctx.arena.blocksSegment(m.x, m.z, e.pos.x, e.pos.z)) continue;
          this.hit(e, m.dmg, "meteor-call", { kbX: dx, kbZ: dz, kb: big ? 8 : 3, heavy: big });
        }
      }
    }

    // Blade Cyclone pulses (centered on the player as they move)
    if (this.cycloneDuration > 0) {
      this.cycloneTime += dt;
      if (this.cycloneTime >= this.cycloneDuration || this.ctx.controller.dodging) {
        this.cycloneDuration = 0;
        this.cycloneTimers.length = 0;
        this.ctx.player.abilitySpin = null;
      } else this.ctx.player.abilitySpin = this.cycloneTime / 0.22 * Math.PI * 2;
    }
    for (let i = this.cycloneTimers.length - 1; i >= 0; i--) {
      this.cycloneTimers[i] -= dt;
      if (this.cycloneTimers[i] > 0) continue;
      this.cycloneTimers.splice(i, 1);
      const p = this.ctx.player;
      const cr = this.cycloneRadius;
      this.ctx.combat.slashVisual(Math.PI * 2, cr, false);
      this.ctx.fx.ring(p.pos.x, p.pos.z, { radius: cr, color: 0x7fe8d8, duration: 0.3 });
      this.ctx.sfx.swing(2);
      for (const e of this.ctx.enemies.living()) {
        const dx = e.pos.x - p.pos.x;
        const dz = e.pos.z - p.pos.z;
        if (Math.hypot(dx, dz) < cr + e.radius) {
          if (this.ctx.arena.blocksSegment(p.pos.x, p.pos.z, e.pos.x, e.pos.z)) continue;
          this.hit(e, 20, "blade-cyclone", { kbX: dx, kbZ: dz, kb: 3 });
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
      w.mesh.scale.setScalar(.65 + .35 * Math.min(1, w.timer / .25));
      w.mesh.children[0].rotation.z += dt * 2.4;
      w.mesh.children[1].rotation.y -= dt * 1.8;
      const pull = w.upgraded ? 7.5 : 5.5;
      for (const e of this.ctx.enemies.living()) {
        const dx = w.x - e.pos.x;
        const dz = w.z - e.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < pull && d > 0.6 && !e.warded && !this.ctx.arena.blocksSegment(w.x, w.z, e.pos.x, e.pos.z)) e.shove(dx, dz, 72 * dt);
      }
      if (w.timer > 0) continue;
      this.wells.splice(i, 1);
      this.ctx.stage.scene.remove(w.mesh);
      disposeGroup(w.mesh);
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
          if (this.ctx.arena.blocksSegment(w.x, w.z, e.pos.x, e.pos.z)) continue;
          this.hit(e, w.upgraded ? 28 : 16, "gravity-well", { kbX: dx, kbZ: dz, kb: 2 });
          if (e.lastBodyDamage > 0) e.applyVulnerable(w.upgraded ? 5 : 3.5, 1.3);
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
      const ax=s.x,az=s.z;
      s.x += s.vx * dt;
      s.z += s.vz * dt;
      let first=this.ctx.arena.firstSolidHit(ax,az,s.x,s.z,.2),hit:Enemy|null=null;
      for(const e of this.ctx.enemies.living()) {
        const at=segmentCircleContact(ax,az,s.x,s.z,e.pos.x,e.pos.z,e.radius+.3);
        if(at<first){first=at;hit=e;}
      }
      if(first!==Infinity){s.x=ax+(s.x-ax)*first;s.z=az+(s.z-az)*first;}
      s.mesh.position.set(s.x, 1.0, s.z);
      s.mesh.rotation.y = Math.atan2(s.vx,s.vz);
      s.trailAcc += dt;
      if (s.trailAcc > 0.04) {
        s.trailAcc = 0;
        this.ctx.fx.burst({
          x: s.x, y: 1.0, z: s.z, count: 1, color: 0x9fffd0,
          speed: [0.2, 0.8], up: 0.2, size: [0.25, 0.45], life: [0.12, 0.28], gravity: 0, drag: 2, jitter: 0.1,
        });
      }
      const popped = s.life <= 0 || first!==Infinity;
      if(hit)this.hit(hit,s.dmg,"seeker-swarm",{kbX:s.vx,kbZ:s.vz,kb:3});
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
          this.hit(tgt, st.dmg, "tempest-storm", { kb: 1 });
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
        const a = Math.random() * Math.PI * 2; // cosmetic drizzle
        const r = Math.random() * st.r;
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
      j.fxAcc -= dt;
      // Stable emission rate; cosmetic placement never consumes gameplay RNG.
      if (j.fxAcc <= 0) {
      j.fxAcc += 1 / 30;
      for (let ring = 1; ring <= 3; ring++) {
        const r = (j.range / 3) * ring;
        const a = p.facing + (Math.random() - 0.5) * j.arc; // cosmetic fire
        const x = p.pos.x + Math.sin(a) * r, z = p.pos.z + Math.cos(a) * r;
        if (this.ctx.arena.blocksSegment(p.pos.x, p.pos.z, x, z)) continue;
        this.ctx.fx.burst({
          x, y: 0.6, z,
          count: 2, color: [0xff7a33, 0xffd24d], speed: [1, 4], up: 1.0, size: [0.4, 0.8], life: [0.2, 0.5], gravity: -1.5, drag: 2,
        });
      }
      }
      p.castGesture = { kind: "project", time: 0.15, duration: 0.4 };
      if (j.tickAcc <= 0 && j.timer > 0) {
        j.tickAcc = 0.18;
        for (const e of this.ctx.enemies.living()) {
          const dx = e.pos.x - p.pos.x;
          const dz = e.pos.z - p.pos.z;
          const d = Math.hypot(dx, dz);
          if (d > j.range + e.radius) continue;
          if (Math.abs(angleDelta(p.facing, Math.atan2(dx, dz))) > j.arc / 2) continue;
          if (this.ctx.arena.blocksSegment(p.pos.x, p.pos.z, e.pos.x, e.pos.z)) continue;
          this.hit(e, j.damage, "flame-channel", { kbX: dx, kbZ: dz, kb: 0.5, sustained: true });
          if (e.lastBodyDamage > 0) this.addBleed(e, 3, j.burnDamage, 0xff7a33);
        }
      }
      if (j.timer <= 0) this.jets.splice(i, 1);
    }

    // Decoy totems: gather the pack, then erupt
    for (let i = this.totems.length - 1; i >= 0; i--) {
      const tm = this.totems[i];
      tm.timer -= dt;
      tm.crown.rotation.y += dt * .8;
      tm.crown.position.y = 1.56 + Math.sin(tm.timer * 3) * .04;
      // Lure nearby foes toward the totem
      for (const e of this.ctx.enemies.living()) {
        const dx = tm.x - e.pos.x;
        const dz = tm.z - e.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 9 && d > 1.2 && e.kind !== "boss" && !e.warded && !this.ctx.arena.blocksSegment(tm.x, tm.z, e.pos.x, e.pos.z)) e.shove(dx, dz, 48 * dt);
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
          if (this.ctx.arena.blocksSegment(tm.x, tm.z, e.pos.x, e.pos.z)) continue;
          this.hit(e, tm.blastDmg, "decoy-totem", { kbX: dx, kbZ: dz, kb: 9, heavy: true, ...(tm.freeze ? { element: "frost", impactColor: 0xbfeaff } : {}) });
          if (tm.freeze && e.lastBodyDamage > 0) e.freeze(1.5);
        }
      }
    }

    // Rend blades: fly out then return, bleeding what they cross
    for (let i = this.boomerangs.length - 1; i >= 0; i--) {
      const b = this.boomerangs[i];
      const wasReturning = b.clearedReturn;
      b.t += dt;
      const k = b.t / b.dur;
      if (!b.clearedReturn && k >= .5) { b.clearedReturn = true; b.hit.clear(); }
      let bx:number,bz:number;
      if(b.clearedReturn) {
        const p=this.ctx.player.pos;
        const target=pursuitTarget(b.prevX,b.prevZ,p.x,p.z,.26,this.ctx.arena.obstacles,1);
        this.ctx.arena.boundary?.resolve(target,.3);
        const dx=target.x-b.prevX,dz=target.z-b.prevZ,d=Math.hypot(dx,dz)||1,step=Math.min(d,dt*24);
        const point=this.groundPoint(b.prevX+dx/d*step,b.prevZ+dz/d*step,.26);
        bx=point.x;bz=point.z;
      } else {
        const out=Math.sin(Math.min(.5,k)*Math.PI);
        bx=b.ox+b.nx*b.reach*out;bz=b.oz+b.nz*b.reach*out;
        const wall=this.ctx.arena.firstSolidHit(b.prevX,b.prevZ,bx,bz,.26);
        if(wall!==Infinity) {
          bx=b.prevX+(bx-b.prevX)*Math.max(0,wall-.001);bz=b.prevZ+(bz-b.prevZ)*Math.max(0,wall-.001);
          b.clearedReturn=true;
        }
      }
      b.mesh.position.set(bx, 1.0, bz);
      b.mesh.rotation.y += dt * 22;
      for (const e of this.ctx.enemies.living()) {
        if (b.hit.has(e.id)) continue;
        const dx = bx - b.prevX, dz = bz - b.prevZ;
        const lengthSq = dx * dx + dz * dz;
        const along = lengthSq > 0 ? Math.max(0, Math.min(1, ((e.pos.x - b.prevX) * dx + (e.pos.z - b.prevZ) * dz) / lengthSq)) : 0;
        if (Math.hypot(e.pos.x - b.prevX - dx * along, e.pos.z - b.prevZ - dz * along) < 0.8 + e.radius) {
          if (this.ctx.arena.blocksSegment(bx, bz, e.pos.x, e.pos.z)) continue;
          b.hit.add(e.id);
          this.hit(e, b.dmg, "rend-boomerang", { kbX: e.pos.x - bx, kbZ: e.pos.z - bz, kb: 3 });
          if (e.lastBodyDamage > 0) this.addBleed(e, b.bleedTicks, 3);
        }
      }
      // A cover contact ends the outbound leg; that contact still uses the
      // outbound hit set. The next frame starts the return with fresh contacts.
      if (!wasReturning && b.clearedReturn && k < .5) b.hit.clear();
      b.prevX = bx; b.prevZ = bz;
      this.ctx.fx.burst({
        x: bx, y: 1.0, z: bz, count: 1, color: 0xff5555,
        speed: [0.3, 0.9], up: 0.2, size: [0.3, 0.5], life: [0.12, 0.26], gravity: 0, drag: 2, jitter: 0.12,
      });
      if ((b.clearedReturn&&Math.hypot(bx-this.ctx.player.pos.x,bz-this.ctx.player.pos.z)<.55)||b.t>b.dur+1.8) {
        this.boomerangs.splice(i, 1);
        this.ctx.stage.scene.remove(b.mesh);
        b.mat.dispose();
      }
    }

    // Rift Hook: reel hooked foes to the player's feet; arrivals land Vulnerable
    for (let i = this.yanks.length - 1; i >= 0; i--) {
      const y = this.yanks[i];
      y.t -= dt;
      const p = this.ctx.player;
      const dx = p.pos.x - y.e.pos.x;
      const dz = p.pos.z - y.e.pos.z;
      const arrived = Math.hypot(dx, dz) < 2.0;
      if (!y.e.alive || arrived || y.t <= 0) {
        this.yanks.splice(i, 1);
        if (y.e.alive && arrived) {
          y.e.applyVulnerable(3, 1.25);
          if (y.chill) y.e.freeze(1.2);
          this.ctx.fx.burst({
            x: y.e.pos.x, y: 1, z: y.e.pos.z, count: 8, color: [0x9a8fff, 0xffffff],
            speed: [2, 6], up: 0.4, size: [0.3, 0.6], life: [0.15, 0.35], gravity: -2, drag: 3,
          });
        }
        continue;
      }
      // Travel the tether in a bounded time. Incremental collision resolution
      // prevents the hook pulling bodies through pillars or across the player.
      const distance = Math.hypot(dx, dz);
      const travel = Math.min(Math.max(0, distance - 1.8), 30 * dt);
      const steps = Math.max(1, Math.ceil(travel / 0.3));
      for (let step = 0; step < steps; step++) {
        y.e.pos.x += dx / distance * travel / steps;
        y.e.pos.z += dz / distance * travel / steps;
        this.ctx.arena.resolveObstacles(y.e.pos, y.e.radius);
      }
    }

    // Blade Spirits: orbit the player, cutting everything they cross
    for (let i = this.spirits.length - 1; i >= 0; i--) {
      const sp = this.spirits[i];
      sp.life -= dt;
      sp.angle += dt * sp.spin;
      const p = this.ctx.player;
      const bx = p.pos.x + Math.sin(sp.angle) * 2.7;
      const bz = p.pos.z + Math.cos(sp.angle) * 2.7;
      const blocked=!this.ctx.arena.containsPoint(bx,bz,.15)||this.ctx.arena.blocksSegment(p.pos.x,p.pos.z,bx,bz);
      sp.mesh.visible=!blocked;
      sp.mesh.position.set(bx, 1.1, bz);
      sp.mesh.rotation.set(-Math.PI/2,sp.angle,Math.PI/2);
      sp.mat.opacity = sp.life < 1 ? 0.9 * sp.life : 0.9;
      sp.trailAcc += dt;
      if (sp.trailAcc > 0.05 && !blocked) {
        sp.trailAcc = 0;
        this.ctx.fx.burst({
          x: bx, y: 1.1, z: bz, count: 1, color: 0x8fe8ff,
          speed: [0.2, 0.8], up: 0.2, size: [0.25, 0.45], life: [0.12, 0.28], gravity: 0, drag: 2, jitter: 0.1,
        });
      }
      sp.tickAcc -= dt;
      if (sp.tickAcc <= 0 && !blocked) {
        sp.tickAcc = 0.25;
        for (const e of this.ctx.enemies.living()) {
          const dx = e.pos.x - bx;
          const dz = e.pos.z - bz;
          if (Math.hypot(dx, dz) < 1.3 + e.radius) {
            if (this.ctx.arena.blocksSegment(bx, bz, e.pos.x, e.pos.z)) continue;
            this.hit(e, sp.dmg, "blade-spirit", { kbX: dx, kbZ: dz, kb: 2, sustained: true });
          }
        }
      }
      if (sp.life <= 0) {
        this.spirits.splice(i, 1);
        this.ctx.stage.scene.remove(sp.mesh);
        sp.mat.dispose();
        this.ctx.fx.burst({
          x: bx, y: 1.1, z: bz, count: 10, color: [0x8fe8ff, 0xffffff],
          speed: [2, 6], up: 0.5, size: [0.3, 0.6], life: [0.15, 0.35], gravity: -1, drag: 3,
        });
      }
    }

    // Card-driven swing pose: heavy sweep for melee cards, quick light flick for casts
    if (this.fakeSwing >= 0) {
      this.fakeSwing += dt;
      const phase = Math.min(1, this.fakeSwing / this.fakeSwingDur);
      if (!this.ctx.combat.swinging) this.ctx.player.animSwing = { phase, heavy: this.fakeSwingHeavy, stage: this.fakeSwingHeavy ? 2 : 0 };
      if (phase >= 1) {
        this.fakeSwing = -1;
        if (!this.ctx.combat.swinging) this.ctx.player.animSwing = null;
      }
    }

    this.aegisTimer = Math.max(0, this.aegisTimer - dt);
    if (this.aegisTimer <= 0) this.aegisReserve = this.aegisAbsorbed = 0;

    // Mines
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      m.life -= dt;
      m.mat.emissiveIntensity = .55;
      let boom = m.life <= 0;
      let victim: Enemy | null = null;
      for (const e of this.ctx.enemies.living()) {
        if (Math.hypot(e.pos.x - m.x, e.pos.z - m.z) < 1.2 + e.radius && !this.ctx.arena.blocksSegment(m.x, m.z, e.pos.x, e.pos.z)) {
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
              if (this.ctx.arena.blocksSegment(m.x, m.z, e.pos.x, e.pos.z)) continue;
              this.hit(e, 22, "mine-field", { kbX: dx, kbZ: dz, kb: 5, heavy: true });
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
      const collapse = Math.max(0, (.22 - p.timer) / .22);
      p.group.scale.set(1 - collapse * .75, 1 + collapse * .2, 1 - collapse * .75);
      if (p.timer <= 0) {
        this.phantoms.splice(i, 1);
        this.ctx.stage.scene.remove(p.group);
        disposeGroup(p.group);
        const R = 2.5;
        for (const e of this.ctx.enemies.living()) {
          const dx = e.pos.x - p.x;
          const dz = e.pos.z - p.z;
          if (Math.hypot(dx, dz) < R + e.radius) {
            if (this.ctx.arena.blocksSegment(p.x, p.z, e.pos.x, e.pos.z)) continue;
            this.hit(e, 26, "phase-step", { kbX: dx, kbZ: dz, kb: 6, heavy: true });
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
