import * as THREE from "three";
import { ARENA_RADIUS } from "../render/arena";
import type { Ctx } from "./ctx";
import type { MapNode } from "./mapgen";

/** A burning rift pit: scorched ground, a molten core glow, a bright rim, and a
 *  cluster of flickering flame tongues that throw rising embers. Bites on contact. */
interface Hazard {
  x: number; z: number; r: number;
  base: THREE.Mesh; baseMat: THREE.MeshBasicMaterial;
  glow: THREE.Mesh; glowMat: THREE.MeshBasicMaterial;
  ring: THREE.Mesh; ringMat: THREE.MeshBasicMaterial;
  flames: THREE.Mesh[]; flameGeo: THREE.ConeGeometry; flameMat: THREE.MeshBasicMaterial;
  emberAcc: number;
}
interface Pad {
  x: number; z: number;
  group: THREE.Group;
  ring: THREE.Mesh; mat: THREE.MeshBasicMaterial;
  shards: THREE.Group;
  beam: THREE.Mesh; beamMat: THREE.MeshBasicMaterial;
}
/** A floor trap that telegraphs, erupts spikes for a beat, then retracts — on a loop. */
interface SpikeTrap {
  x: number; z: number; r: number;
  plate: THREE.Mesh; plateMat: THREE.MeshBasicMaterial;
  warn: THREE.Mesh; warnMat: THREE.MeshBasicMaterial;
  collar: THREE.Mesh; collarMat: THREE.MeshStandardMaterial;
  spikes: THREE.Group; spikeMat: THREE.MeshStandardMaterial; spikeGeo: THREE.ConeGeometry;
  phase: number; cd: number;
}
/** A glowing hazard orb that drifts across the arena and bounces off the rim. */
interface Drifter {
  x: number; z: number; vx: number; vz: number; r: number; cd: number;
  mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial;
}
/** A slow rotating beam sweeping the whole floor — dodge it or get clipped. */
interface Sweeper {
  bar: THREE.Mesh; mat: THREE.MeshBasicMaterial;
  core: THREE.Mesh; coreMat: THREE.MeshBasicMaterial;
  hub: THREE.Mesh; hubMat: THREE.MeshBasicMaterial;
  x: number; z: number; len: number;
  angle: number; speed: number; half: number; cd: number;
}
/** A fire geyser: a dark vent that telegraphs, then roars a column of flame upward. */
interface FlameVent {
  x: number; z: number; r: number;
  rim: THREE.Mesh; rimMat: THREE.MeshStandardMaterial;
  warn: THREE.Mesh; warnMat: THREE.MeshBasicMaterial;
  column: THREE.Mesh; colMat: THREE.MeshBasicMaterial;
  phase: number; cd: number; emberAcc: number;
}

const SPIKE_PERIOD = 3.2; // full cycle: dormant → warn → erupt → retract
const SPIKE_WARN = 0.75;   // telegraph window before the spikes are live
const SPIKE_LIVE = 0.95;   // window the spikes are up and biting

const VENT_PERIOD = 3.0; // full cycle: dormant → warn → erupt → cool
const VENT_WARN = 0.7;    // telegraph window before the geyser fires
const VENT_LIVE = 0.85;   // window the flame column is up and biting

/**
 * Per-node arena mechanics: burning rift pits, teleporter pads, spike traps, fire
 * geysers, drifting hazard orbs, and a sweeping beam. Spawned by RunManager from the
 * node's `feature`, ticked in the main loop, disposed on every room change.
 */
export class MapFeatures {
  private hazards: Hazard[] = [];
  private pads: Pad[] = [];
  private spikes: SpikeTrap[] = [];
  private drifters: Drifter[] = [];
  private sweepers: Sweeper[] = [];
  private vents: FlameVent[] = [];
  private hazardCd = 0;
  private teleCd = 0;
  private t = 0;

  constructor(private ctx: Ctx) {}

  setup(node: MapNode): void {
    this.clear();
    if (node.bossKind) return; // boss arenas stay clean
    if (node.feature === "hazard") this.makeHazards();
    else if (node.feature === "teleport") this.makeTeleporters();
    else if (node.feature === "spikes") this.makeSpikes();
    else if (node.feature === "drifters") this.makeDrifters();
    else if (node.feature === "sweeper") this.makeSweeper();
    else if (node.feature === "flamevent") this.makeFlameVents();
  }

  /** A spot away from the player's south spawn. */
  private spot(minR = 5): { x: number; z: number } {
    const { rng } = this.ctx;
    for (let i = 0; i < 24; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(minR, ARENA_RADIUS - 4);
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      if (Math.hypot(x - 0, z - ARENA_RADIUS * 0.55) > 6.5) return { x, z };
    }
    return { x: 0, z: -6 };
  }

  private makeHazards(): void {
    const n = 2 + this.ctx.rng.int(0, 1);
    for (let i = 0; i < n; i++) {
      const { x, z } = this.spot();
      const r = 2 + this.ctx.rng.range(0, 1.3);
      // Scorched dark base so the pit reads as burnt ground, not a flat decal.
      const baseMat = new THREE.MeshBasicMaterial({ color: 0x190a06, transparent: true, opacity: 0.82, depthWrite: false });
      const base = new THREE.Mesh(new THREE.CircleGeometry(r * 1.1, 30), baseMat);
      base.rotation.x = -Math.PI / 2;
      base.position.set(x, 0.025, z);
      // Molten inner glow, animated each frame.
      const glowMat = new THREE.MeshBasicMaterial({ color: 0xff5a1e, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false });
      const glow = new THREE.Mesh(new THREE.CircleGeometry(r, 30), glowMat);
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(x, 0.05, z);
      // Bright molten rim.
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.24, r + 0.1, 30), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, 0.06, z);
      this.ctx.stage.scene.add(base, glow, ring);
      // Flickering flame tongues clustered in the pit (shared geo/mat per pit).
      const flameMat = new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.72, blending: THREE.AdditiveBlending, depthWrite: false });
      const flameGeo = new THREE.ConeGeometry(0.34, 1.25, 6);
      const flames: THREE.Mesh[] = [];
      const fc = 4 + this.ctx.rng.int(0, 2);
      for (let k = 0; k < fc; k++) {
        const a = this.ctx.rng.range(0, Math.PI * 2);
        const rr = this.ctx.rng.range(0, r * 0.62);
        const fl = new THREE.Mesh(flameGeo, flameMat);
        fl.position.set(x + Math.sin(a) * rr, 0.6, z + Math.cos(a) * rr);
        this.ctx.stage.scene.add(fl);
        flames.push(fl);
      }
      this.hazards.push({ x, z, r, base, baseMat, glow, glowMat, ring, ringMat, flames, flameGeo, flameMat, emberAcc: 0 });
    }
  }

  private makeTeleporters(): void {
    const a = this.spot(5);
    let b = this.spot(5);
    for (let i = 0; i < 12 && Math.hypot(a.x - b.x, a.z - b.z) < 11; i++) b = this.spot(5);
    for (const p of [a, b]) {
      const group = new THREE.Group();
      group.position.set(p.x, 0, p.z);
      // A dark stone collar sunk into the floor anchors the pad as a built structure.
      const collarMat = new THREE.MeshStandardMaterial({ color: 0x10202c, emissive: 0x123040, emissiveIntensity: 0.8, metalness: 0.5, roughness: 0.5 });
      const collar = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.16, 6, 24), collarMat);
      collar.rotation.x = Math.PI / 2;
      collar.position.y = 0.07;
      group.add(collar);
      // The glowing portal disc (animated) + an inner bright ring.
      const mat = new THREE.MeshBasicMaterial({ color: 0x66e0ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 1.25, 28), mat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.05;
      const inner = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.4, 20), mat);
      inner.rotation.x = -Math.PI / 2;
      inner.position.y = 0.06;
      group.add(ring, inner);
      // Rune glyphs around the collar.
      const glyphMat = new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
      for (let g = 0; g < 8; g++) {
        const ga = (g / 8) * Math.PI * 2;
        const glyph = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.34), glyphMat);
        glyph.position.set(Math.sin(ga) * 1.5, 0.06, Math.cos(ga) * 1.5);
        glyph.rotation.y = ga;
        group.add(glyph);
      }
      // Floating shards orbiting the column.
      const shards = new THREE.Group();
      const shardMat = new THREE.MeshStandardMaterial({ color: 0x123040, emissive: 0x66e0ff, emissiveIntensity: 1.6, flatShading: true });
      for (let s = 0; s < 4; s++) {
        const sa = (s / 4) * Math.PI * 2;
        const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), shardMat);
        shard.position.set(Math.sin(sa) * 1.05, 1.1 + (s % 2) * 0.5, Math.cos(sa) * 1.05);
        shards.add(shard);
      }
      group.add(shards);
      // The light column.
      const beamMat = new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.95, 5, 16, 1, true), beamMat);
      beam.position.y = 2.5;
      group.add(beam);
      this.ctx.stage.scene.add(group);
      this.pads.push({ x: p.x, z: p.z, group, ring, mat, shards, beam, beamMat });
    }
    this.teleCd = 1; // don't trigger on the frame they appear
  }

  private makeSpikes(): void {
    const n = 3 + this.ctx.rng.int(0, 2);
    for (let i = 0; i < n; i++) {
      const { x, z } = this.spot(4);
      const r = 1.7 + this.ctx.rng.range(0, 0.7);
      // Outline ring marking the bite zone.
      const plateMat = new THREE.MeshBasicMaterial({ color: 0xffb33a, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const plate = new THREE.Mesh(new THREE.RingGeometry(r - 0.2, r, 28), plateMat);
      plate.rotation.x = -Math.PI / 2;
      plate.position.set(x, 0.045, z);
      // Filled warning glow that floods in during the telegraph window.
      const warnMat = new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const warn = new THREE.Mesh(new THREE.CircleGeometry(r - 0.2, 26), warnMat);
      warn.rotation.x = -Math.PI / 2;
      warn.position.set(x, 0.05, z);
      // A glowing iron collar that rises with the spikes.
      const collarMat = new THREE.MeshStandardMaterial({ color: 0x3a3038, metalness: 0.7, roughness: 0.35, emissive: 0x000000, emissiveIntensity: 0 });
      const collar = new THREE.Mesh(new THREE.TorusGeometry(r * 0.7, 0.1, 6, 22), collarMat);
      collar.rotation.x = Math.PI / 2;
      collar.position.set(x, -1.6, z);
      // A tight cluster of sharp metal cones — a big central fang plus a ring of smaller ones.
      const spikes = new THREE.Group();
      const spikeMat = new THREE.MeshStandardMaterial({ color: 0x70757f, metalness: 0.65, roughness: 0.3, emissive: 0x110000, emissiveIntensity: 0 });
      const spikeGeo = new THREE.ConeGeometry(0.2, 1.7, 6);
      const center = new THREE.Mesh(spikeGeo, spikeMat);
      center.scale.set(1.25, 1.5, 1.25);
      center.position.set(0, 1.1, 0);
      spikes.add(center);
      const ring = 6 + this.ctx.rng.int(0, 2);
      for (let k = 0; k < ring; k++) {
        const a = (k / ring) * Math.PI * 2 + this.ctx.rng.range(0, 0.4);
        const rr = r * (0.35 + this.ctx.rng.range(0, 0.4));
        const cone = new THREE.Mesh(spikeGeo, spikeMat);
        const s = 0.6 + this.ctx.rng.range(0, 0.6);
        cone.scale.set(s, 0.7 + s, s);
        cone.position.set(Math.sin(a) * rr, 0.75, Math.cos(a) * rr);
        cone.rotation.set(Math.cos(a) * 0.18, a, -Math.sin(a) * 0.18);
        spikes.add(cone);
      }
      spikes.position.set(x, -1.7, z); // parked below the floor
      this.ctx.stage.scene.add(plate, warn, collar, spikes);
      this.spikes.push({ x, z, r, plate, plateMat, warn, warnMat, collar, collarMat, spikes, spikeMat, spikeGeo, phase: (i / n) * SPIKE_PERIOD, cd: 0 });
    }
  }

  private makeDrifters(): void {
    const n = 2 + this.ctx.rng.int(0, 1);
    for (let i = 0; i < n; i++) {
      const { x, z } = this.spot(6);
      const a = this.ctx.rng.range(0, Math.PI * 2);
      const sp = 3.2 + this.ctx.rng.range(0, 1.6);
      const mat = new THREE.MeshBasicMaterial({ color: 0xc24bff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
      const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 0), mat);
      // A bright inner pip so the orb reads as a charged core, not a flat shell.
      const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 0), coreMat);
      mesh.add(core);
      // Outward spikes turn the orb into a menacing spiked mine, not a soft ball.
      const spikeMat = new THREE.MeshBasicMaterial({ color: 0xe09bff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
      const spikeGeo = new THREE.ConeGeometry(0.16, 0.62, 5);
      const UP = new THREE.Vector3(0, 1, 0);
      const addSpike = (nx: number, ny: number, nz: number) => {
        const n = new THREE.Vector3(nx, ny, nz).normalize();
        const spike = new THREE.Mesh(spikeGeo, spikeMat);
        spike.position.copy(n).multiplyScalar(0.78);
        spike.quaternion.setFromUnitVectors(UP, n);
        mesh.add(spike);
      };
      for (let s = 0; s < 6; s++) { const sa = (s / 6) * Math.PI * 2; addSpike(Math.sin(sa), (s % 2 ? -0.25 : 0.25), Math.cos(sa)); }
      addSpike(0, 1, 0); addSpike(0, -1, 0);
      mesh.position.set(x, 1.1, z);
      this.ctx.stage.scene.add(mesh);
      this.drifters.push({ x, z, vx: Math.sin(a) * sp, vz: Math.cos(a) * sp, r: 1.15, cd: 0, mesh, mat });
    }
  }

  private makeSweeper(): void {
    const { x, z } = this.spot(4);
    const len = 5.8;
    const mat = new THREE.MeshBasicMaterial({ color: 0x49d0ff, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false });
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.45, len), mat);
    bar.position.set(x, 0.5, z);
    // A hot white core down the spine of the beam so it reads as a charged blade.
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xeaffff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, len), coreMat);
    bar.add(core);
    // A glowing emitter hub the beam pivots around so it reads as a powered turret.
    const hubMat = new THREE.MeshBasicMaterial({ color: 0xbfeeff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    const hub = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), hubMat);
    hub.position.set(x, 0.5, z);
    this.ctx.stage.scene.add(bar, hub);
    const dir = this.ctx.rng.chance(0.5) ? 1 : -1;
    this.sweepers.push({ bar, mat, core, coreMat, hub, hubMat, x, z, len, angle: this.ctx.rng.range(0, Math.PI), speed: dir * (0.75 + this.ctx.rng.range(0, 0.22)), half: 0.55, cd: 0 });
  }

  private makeFlameVents(): void {
    const n = 3 + this.ctx.rng.int(0, 1);
    for (let i = 0; i < n; i++) {
      const { x, z } = this.spot(4);
      const r = 1.5 + this.ctx.rng.range(0, 0.5);
      // The vent mouth: a dark iron rim flush with the floor that glows as it heats.
      const rimMat = new THREE.MeshStandardMaterial({ color: 0x241008, emissive: 0x140600, emissiveIntensity: 1, metalness: 0.6, roughness: 0.5 });
      const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.15, 6, 22), rimMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.set(x, 0.08, z);
      // Floor glow that floods in as the geyser charges.
      const warnMat = new THREE.MeshBasicMaterial({ color: 0xff6a1e, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false });
      const warn = new THREE.Mesh(new THREE.CircleGeometry(r * 0.92, 24), warnMat);
      warn.rotation.x = -Math.PI / 2;
      warn.position.set(x, 0.05, z);
      // The flame column itself — parked flat, roars upward on the erupt beat.
      const colMat = new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const column = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.85, 4.4, 16, 1, true), colMat);
      column.position.set(x, 2.2, z);
      column.scale.y = 0.001;
      this.ctx.stage.scene.add(rim, warn, column);
      this.vents.push({ x, z, r, rim, rimMat, warn, warnMat, column, colMat, phase: (i / n) * VENT_PERIOD, cd: 0, emberAcc: 0 });
    }
  }

  update(dt: number): void {
    this.t += dt;
    const p = this.ctx.player.pos;

    if (this.hazards.length) {
      this.hazardCd -= dt;
      let inHazard = false, hx = 0, hz = 0;
      for (const h of this.hazards) {
        h.glowMat.opacity = 0.36 + Math.abs(Math.sin(this.t * 5 + h.x)) * 0.32 + Math.random() * 0.08;
        h.ringMat.opacity = 0.5 + Math.abs(Math.sin(this.t * 4 + h.z + 1)) * 0.4;
        // Flame tongues flicker tall and thin, swaying with the heat.
        for (let k = 0; k < h.flames.length; k++) {
          const fl = h.flames[k];
          const tall = 0.6 + Math.abs(Math.sin(this.t * (7 + k) + k * 1.7)) * 0.7 + Math.random() * 0.12;
          fl.scale.set(0.7 + Math.sin(this.t * 9 + k) * 0.14, tall, 0.7 + Math.cos(this.t * 8 + k) * 0.14);
          fl.position.y = 0.35 + tall * 0.4;
          fl.rotation.y += dt * 2.2;
        }
        h.emberAcc -= dt;
        if (h.emberAcc <= 0) {
          h.emberAcc = 0.1;
          const a = Math.random() * Math.PI * 2;
          const rr = Math.random() * h.r * 0.7;
          this.ctx.fx.burst({ x: h.x + Math.sin(a) * rr, y: 0.3, z: h.z + Math.cos(a) * rr, count: 1, color: [0xff8a3a, 0xffcc66], speed: [0.2, 1], up: 2.3, size: [0.18, 0.4], life: [0.6, 1.3], gravity: 0.3, drag: 1.2, jitter: 0.5 });
        }
        if (Math.hypot(p.x - h.x, p.z - h.z) < h.r) { inHazard = true; hx = h.x; hz = h.z; }
      }
      if (inHazard && this.hazardCd <= 0 && this.ctx.player.alive) {
        this.ctx.combat.damagePlayer(8, hx, hz);
        this.ctx.fx.burst({ x: p.x, y: 0.4, z: p.z, count: 8, color: [0xff5a2a, 0xffaa55], speed: [1, 4], up: 1, size: [0.3, 0.6], life: [0.2, 0.45], gravity: -2, drag: 3 });
        this.hazardCd = 0.7;
      }
    }

    if (this.pads.length === 2) {
      this.teleCd -= dt;
      for (const pad of this.pads) {
        pad.mat.opacity = 0.4 + Math.abs(Math.sin(this.t * 2.5)) * 0.35;
        pad.ring.rotation.z += dt * 1.5;
        pad.shards.rotation.y += dt * 0.9;
        pad.beamMat.opacity = 0.12 + Math.abs(Math.sin(this.t * 2.2)) * 0.12;
      }
      if (this.teleCd <= 0 && this.ctx.player.alive) {
        for (let i = 0; i < 2; i++) {
          if (Math.hypot(p.x - this.pads[i].x, p.z - this.pads[i].z) < 1.2) {
            this.teleport(this.pads[1 - i].x, this.pads[1 - i].z);
            this.teleCd = 1.6;
            break;
          }
        }
      }
    }

    // Spike traps: telegraph → erupt → retract, each on its own offset cycle.
    for (const s of this.spikes) {
      s.cd -= dt;
      const c = (this.t + s.phase) % SPIKE_PERIOD;
      const warning = c < SPIKE_WARN;
      const live = c >= SPIKE_WARN && c < SPIKE_WARN + SPIKE_LIVE;
      s.plateMat.opacity = live ? 0.6 : warning ? 0.16 + (c / SPIKE_WARN) * 0.3 : 0.12;
      s.warnMat.opacity = warning ? (c / SPIKE_WARN) * 0.4 : live ? 0.35 : 0;
      const targetY = live ? 0.0 : warning && c > SPIKE_WARN - 0.16 ? -1.1 : -1.7;
      s.spikes.position.y += (targetY - s.spikes.position.y) * Math.min(1, dt * 18);
      s.collar.position.y = s.spikes.position.y + 1.55;
      s.spikeMat.emissive.setHex(live ? 0xff4422 : 0x000000);
      s.spikeMat.emissiveIntensity = live ? 0.9 : 0;
      s.collarMat.emissive.setHex(live ? 0xff5a22 : 0x000000);
      s.collarMat.emissiveIntensity = live ? 1.4 : 0;
      if (live && s.cd <= 0 && this.ctx.player.alive && Math.hypot(p.x - s.x, p.z - s.z) < s.r) {
        this.ctx.combat.damagePlayer(11, s.x, s.z);
        this.ctx.fx.burst({ x: p.x, y: 0.4, z: p.z, count: 8, color: [0xffb33a, 0xffffff], speed: [1, 4], up: 1, size: [0.3, 0.6], life: [0.2, 0.5], gravity: -2, drag: 3 });
        s.cd = 0.6;
      }
    }

    // Fire geysers: telegraph → roaring flame column → cool, each on its own cycle.
    for (const v of this.vents) {
      v.cd -= dt;
      const c = (this.t + v.phase) % VENT_PERIOD;
      const warning = c < VENT_WARN;
      const live = c >= VENT_WARN && c < VENT_WARN + VENT_LIVE;
      v.warnMat.opacity = live ? 0.5 : warning ? 0.1 + (c / VENT_WARN) * 0.42 : 0.08;
      v.column.scale.y += ((live ? 1 : 0.001) - v.column.scale.y) * Math.min(1, dt * 16);
      v.colMat.opacity = live ? 0.55 + Math.abs(Math.sin(this.t * 20)) * 0.32 : Math.max(0, v.colMat.opacity - dt * 3);
      v.column.rotation.y += dt * 3;
      v.rimMat.emissive.setHex(live ? 0xff3a08 : warning ? 0x511700 : 0x140600);
      v.rimMat.emissiveIntensity = live ? 2.2 : warning ? 0.6 + (c / VENT_WARN) * 1.2 : 1;
      if (live) {
        v.emberAcc -= dt;
        if (v.emberAcc <= 0) {
          v.emberAcc = 0.05;
          this.ctx.fx.burst({ x: v.x + (Math.random() - 0.5) * v.r, y: 0.4, z: v.z + (Math.random() - 0.5) * v.r, count: 1, color: [0xffaa44, 0xff6a1e], speed: [0.3, 1.4], up: 4.5, size: [0.2, 0.5], life: [0.4, 0.9], gravity: 0.4, drag: 0.9, jitter: 0.6 });
        }
        if (v.cd <= 0 && this.ctx.player.alive && Math.hypot(p.x - v.x, p.z - v.z) < v.r) {
          this.ctx.combat.damagePlayer(12, v.x, v.z);
          this.ctx.fx.burst({ x: p.x, y: 0.5, z: p.z, count: 8, color: [0xffaa44, 0xffffff], speed: [1, 4], up: 1.2, size: [0.3, 0.6], life: [0.2, 0.5], gravity: -1, drag: 3 });
          v.cd = 0.5;
        }
      }
    }

    // Drifting hazard orbs: float across the floor, bounce off the rim, bite on touch.
    if (this.drifters.length) {
      const maxR = ARENA_RADIUS - 2;
      for (const d of this.drifters) {
        d.cd -= dt;
        d.x += d.vx * dt; d.z += d.vz * dt;
        const rr = Math.hypot(d.x, d.z);
        if (rr > maxR) {
          const nx = d.x / rr, nz = d.z / rr;
          const dot = d.vx * nx + d.vz * nz;
          d.vx -= 2 * dot * nx; d.vz -= 2 * dot * nz;
          d.x = nx * maxR; d.z = nz * maxR;
        }
        d.mesh.position.set(d.x, 1.1 + Math.sin(this.t * 3 + d.x) * 0.15, d.z);
        d.mesh.rotation.x += dt * 1.5; d.mesh.rotation.y += dt * 2;
        d.mat.opacity = 0.5 + Math.abs(Math.sin(this.t * 4 + d.z)) * 0.3;
        if (Math.random() < dt * 7) this.ctx.fx.burst({ x: d.x, y: 1.1, z: d.z, count: 1, color: 0xc24bff, speed: [0.2, 1], up: 0.4, size: [0.25, 0.5], life: [0.3, 0.6], gravity: 0.4, drag: 2, jitter: 0.6 });
        if (d.cd <= 0 && this.ctx.player.alive && Math.hypot(p.x - d.x, p.z - d.z) < d.r + this.ctx.player.radius) {
          this.ctx.combat.damagePlayer(10, d.x, d.z);
          d.cd = 0.8;
          const ang = Math.atan2(d.x - p.x, d.z - p.z);
          const sp = Math.hypot(d.vx, d.vz) || 3.5;
          d.vx = Math.sin(ang) * sp; d.vz = Math.cos(ang) * sp;
        }
      }
    }

    // Sweeping beam: a slow diameter that rotates the whole floor — dodge across it.
    for (const s of this.sweepers) {
      s.cd -= dt;
      s.angle += s.speed * dt;
      s.bar.rotation.y = s.angle;
      s.mat.opacity = 0.26 + Math.abs(Math.sin(this.t * 4)) * 0.12;
      s.coreMat.opacity = 0.7 + Math.abs(Math.sin(this.t * 8)) * 0.25;
      s.hub.rotation.y += dt * 1.6;
      s.hubMat.opacity = 0.65 + Math.abs(Math.sin(this.t * 6)) * 0.28;
      const rx = p.x - s.x;
      const rz = p.z - s.z;
      const along = rx * Math.sin(s.angle) + rz * Math.cos(s.angle);
      const perp = Math.abs(rx * Math.cos(s.angle) - rz * Math.sin(s.angle));
      if (Math.abs(along) < s.len * 0.5 + this.ctx.player.radius && perp < s.half + this.ctx.player.radius && s.cd <= 0 && this.ctx.player.alive) {
        this.ctx.combat.damagePlayer(10, s.x, s.z);
        this.ctx.fx.burst({ x: p.x, y: 0.5, z: p.z, count: 8, color: [0x49d0ff, 0xffffff], speed: [1, 5], up: 0.8, size: [0.3, 0.6], life: [0.2, 0.5], gravity: -1, drag: 3 });
        s.cd = 0.7;
      }
    }
  }

  private teleport(x: number, z: number): void {
    const p = this.ctx.player;
    this.ctx.fx.ring(p.pos.x, p.pos.z, { radius: 1.6, color: 0x66e0ff, duration: 0.4 });
    this.ctx.fx.burst({ x: p.pos.x, y: 1, z: p.pos.z, count: 18, color: [0x66e0ff, 0xffffff], speed: [2, 6], up: 0.6, size: [0.35, 0.7], life: [0.25, 0.5], gravity: -1, drag: 3 });
    p.pos.x = x;
    p.pos.z = z;
    this.ctx.cam.snapTo(x, z);
    this.ctx.fx.ring(x, z, { radius: 2, color: 0x9fe8ff, duration: 0.45 });
    this.ctx.fx.burst({ x, y: 1, z, count: 22, color: [0x9fe8ff, 0xffffff], speed: [2, 7], up: 0.6, size: [0.35, 0.8], life: [0.25, 0.55], gravity: -1, drag: 3 });
    this.ctx.sfx.cast("phase-step"); // reuse the blink whoosh
  }

  clear(): void {
    for (const h of this.hazards) {
      this.ctx.stage.scene.remove(h.base, h.glow, h.ring, ...h.flames);
      h.base.geometry.dispose();
      h.glow.geometry.dispose();
      h.ring.geometry.dispose();
      h.flameGeo.dispose();
      h.baseMat.dispose();
      h.glowMat.dispose();
      h.ringMat.dispose();
      h.flameMat.dispose();
    }
    for (const pad of this.pads) {
      this.ctx.stage.scene.remove(pad.group);
      pad.group.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });
    }
    for (const s of this.spikes) {
      this.ctx.stage.scene.remove(s.plate, s.warn, s.collar, s.spikes);
      s.plate.geometry.dispose();
      s.warn.geometry.dispose();
      s.collar.geometry.dispose();
      s.spikeGeo.dispose();
      s.plateMat.dispose();
      s.warnMat.dispose();
      s.collarMat.dispose();
      s.spikeMat.dispose();
    }
    for (const v of this.vents) {
      this.ctx.stage.scene.remove(v.rim, v.warn, v.column);
      v.rim.geometry.dispose();
      v.warn.geometry.dispose();
      v.column.geometry.dispose();
      v.rimMat.dispose();
      v.warnMat.dispose();
      v.colMat.dispose();
    }
    for (const d of this.drifters) {
      this.ctx.stage.scene.remove(d.mesh);
      d.mesh.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });
    }
    for (const s of this.sweepers) {
      this.ctx.stage.scene.remove(s.bar, s.hub);
      s.bar.geometry.dispose();
      s.core.geometry.dispose();
      s.hub.geometry.dispose();
      s.mat.dispose();
      s.coreMat.dispose();
      s.hubMat.dispose();
    }
    this.hazards = [];
    this.pads = [];
    this.spikes = [];
    this.drifters = [];
    this.sweepers = [];
    this.vents = [];
    this.hazardCd = 0;
    this.teleCd = 0;
  }
}
