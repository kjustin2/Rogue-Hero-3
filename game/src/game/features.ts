import * as THREE from "three";
import { ARENA_RADIUS } from "../render/arena";
import type { Ctx } from "./ctx";
import type { MapNode } from "./mapgen";

interface Hazard {
  x: number; z: number; r: number;
  disc: THREE.Mesh; ring: THREE.Mesh;
  mat: THREE.MeshBasicMaterial; ringMat: THREE.MeshBasicMaterial;
}
interface Pad {
  x: number; z: number;
  mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial;
  beam: THREE.Mesh; beamMat: THREE.MeshBasicMaterial;
}
/** A floor trap that telegraphs, erupts spikes for a beat, then retracts — on a loop. */
interface SpikeTrap {
  x: number; z: number; r: number;
  plate: THREE.Mesh; plateMat: THREE.MeshBasicMaterial;
  spikes: THREE.Group; spikeMat: THREE.MeshStandardMaterial;
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
  x: number; z: number; len: number;
  angle: number; speed: number; half: number; cd: number;
}

const SPIKE_PERIOD = 3.2; // full cycle: dormant → warn → erupt → retract
const SPIKE_WARN = 0.75;   // telegraph window before the spikes are live
const SPIKE_LIVE = 0.95;   // window the spikes are up and biting

/**
 * Per-node arena mechanics: rift hazard patches that bite if you stand in them,
 * and teleporter pad pairs. Spawned by RunManager.loadCurrentNode from the node's
 * `feature`, ticked in the main loop, disposed on every room change.
 */
export class MapFeatures {
  private hazards: Hazard[] = [];
  private pads: Pad[] = [];
  private spikes: SpikeTrap[] = [];
  private drifters: Drifter[] = [];
  private sweepers: Sweeper[] = [];
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
      const mat = new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false });
      const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 28), mat);
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(x, 0.04, z);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xff6a3a, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.2, r, 28), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, 0.05, z);
      this.ctx.stage.scene.add(disc, ring);
      this.hazards.push({ x, z, r, disc, ring, mat, ringMat });
    }
  }

  private makeTeleporters(): void {
    const a = this.spot(5);
    let b = this.spot(5);
    for (let i = 0; i < 12 && Math.hypot(a.x - b.x, a.z - b.z) < 11; i++) b = this.spot(5);
    for (const p of [a, b]) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x66e0ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(new THREE.RingGeometry(0.7, 1.3, 24), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(p.x, 0.05, p.z);
      const beamMat = new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false });
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 5, 16, 1, true), beamMat);
      beam.position.set(p.x, 2.5, p.z);
      this.ctx.stage.scene.add(mesh, beam);
      this.pads.push({ x: p.x, z: p.z, mesh, mat, beam, beamMat });
    }
    this.teleCd = 1; // don't trigger on the frame they appear
  }

  private makeSpikes(): void {
    const n = 3 + this.ctx.rng.int(0, 2);
    for (let i = 0; i < n; i++) {
      const { x, z } = this.spot(4);
      const r = 1.6 + this.ctx.rng.range(0, 0.6);
      const plateMat = new THREE.MeshBasicMaterial({ color: 0xffb33a, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const plate = new THREE.Mesh(new THREE.RingGeometry(r - 0.18, r, 26), plateMat);
      plate.rotation.x = -Math.PI / 2;
      plate.position.set(x, 0.045, z);
      // A cluster of cones that rises out of the floor when live.
      const spikes = new THREE.Group();
      const spikeMat = new THREE.MeshStandardMaterial({ color: 0x6a6f7a, metalness: 0.6, roughness: 0.35, emissive: 0x110000, emissiveIntensity: 0 });
      const geo = new THREE.ConeGeometry(0.22, 1.4, 5);
      for (let k = 0; k < 7; k++) {
        const a = this.ctx.rng.range(0, Math.PI * 2);
        const rr = this.ctx.rng.range(0, r - 0.5);
        const cone = new THREE.Mesh(geo, spikeMat);
        cone.position.set(Math.sin(a) * rr, 0.7, Math.cos(a) * rr);
        spikes.add(cone);
      }
      spikes.position.set(x, -1.6, z); // parked below the floor
      this.ctx.stage.scene.add(plate, spikes);
      this.spikes.push({ x, z, r, plate, plateMat, spikes, spikeMat, phase: (i / n) * SPIKE_PERIOD, cd: 0 });
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
    this.ctx.stage.scene.add(bar);
    const dir = this.ctx.rng.chance(0.5) ? 1 : -1;
    this.sweepers.push({ bar, mat, x, z, len, angle: this.ctx.rng.range(0, Math.PI), speed: dir * (0.75 + this.ctx.rng.range(0, 0.22)), half: 0.55, cd: 0 });
  }

  update(dt: number): void {
    this.t += dt;
    const p = this.ctx.player.pos;

    if (this.hazards.length) {
      this.hazardCd -= dt;
      const pulse = 0.26 + Math.abs(Math.sin(this.t * 3)) * 0.3;
      let inHazard = false, hx = 0, hz = 0;
      for (const h of this.hazards) {
        h.mat.opacity = pulse;
        h.ringMat.opacity = 0.5 + Math.abs(Math.sin(this.t * 3 + 1)) * 0.4;
        if (Math.hypot(p.x - h.x, p.z - h.z) < h.r) { inHazard = true; hx = h.x; hz = h.z; }
      }
      if (inHazard && this.hazardCd <= 0 && this.ctx.player.alive) {
        this.ctx.combat.damagePlayer(8, hx, hz);
        this.ctx.fx.burst({ x: p.x, y: 0.4, z: p.z, count: 6, color: [0xff5a2a, 0xffaa55], speed: [1, 4], up: 0.8, size: [0.3, 0.6], life: [0.2, 0.45], gravity: -2, drag: 3 });
        this.hazardCd = 0.7;
      }
    }

    if (this.pads.length === 2) {
      this.teleCd -= dt;
      for (const pad of this.pads) {
        pad.mat.opacity = 0.4 + Math.abs(Math.sin(this.t * 2.5)) * 0.35;
        pad.mesh.rotation.z += dt * 1.5;
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
      s.plateMat.opacity = live ? 0.55 : warning ? 0.16 + (c / SPIKE_WARN) * 0.34 : 0.12;
      const targetY = live ? 0.0 : warning && c > SPIKE_WARN - 0.16 ? -1.1 : -1.6;
      s.spikes.position.y += (targetY - s.spikes.position.y) * Math.min(1, dt * 18);
      s.spikeMat.emissive.setHex(live ? 0xff4422 : 0x000000);
      s.spikeMat.emissiveIntensity = live ? 0.9 : 0;
      if (live && s.cd <= 0 && this.ctx.player.alive && Math.hypot(p.x - s.x, p.z - s.z) < s.r) {
        this.ctx.combat.damagePlayer(11, s.x, s.z);
        this.ctx.fx.burst({ x: p.x, y: 0.4, z: p.z, count: 8, color: [0xffb33a, 0xffffff], speed: [1, 4], up: 1, size: [0.3, 0.6], life: [0.2, 0.5], gravity: -2, drag: 3 });
        s.cd = 0.6;
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
      this.ctx.stage.scene.remove(h.disc, h.ring);
      h.disc.geometry.dispose();
      h.ring.geometry.dispose();
      h.mat.dispose();
      h.ringMat.dispose();
    }
    for (const pad of this.pads) {
      this.ctx.stage.scene.remove(pad.mesh, pad.beam);
      pad.mesh.geometry.dispose();
      pad.beam.geometry.dispose();
      pad.mat.dispose();
      pad.beamMat.dispose();
    }
    for (const s of this.spikes) {
      this.ctx.stage.scene.remove(s.plate, s.spikes);
      s.plate.geometry.dispose();
      s.plateMat.dispose();
      s.spikeMat.dispose();
      s.spikes.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    }
    for (const d of this.drifters) {
      this.ctx.stage.scene.remove(d.mesh);
      d.mesh.geometry.dispose();
      d.mat.dispose();
    }
    for (const s of this.sweepers) {
      this.ctx.stage.scene.remove(s.bar);
      s.bar.geometry.dispose();
      s.mat.dispose();
    }
    this.hazards = [];
    this.pads = [];
    this.spikes = [];
    this.drifters = [];
    this.sweepers = [];
    this.hazardCd = 0;
    this.teleCd = 0;
  }
}
