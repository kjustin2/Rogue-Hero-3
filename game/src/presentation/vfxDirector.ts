import * as THREE from "three";
import { ParticleShape, type Particles } from "../render/particles";
import { ATTACK_PRESENTATION } from "./profiles";
import type { ImpactCue, ImpactElement, PresentationBudget } from "./types";

const MAX_GLYPHS = 48;
const _matrix = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _dark = new THREE.Color(0x000000);
const _fadeColor = new THREE.Color();

interface Glyph { active: boolean; t: number; life: number; x: number; y: number; z: number; angle: number; scale: number; color: THREE.Color; element: ImpactElement }

// Shape and motion carry the school even when several spells share the frame.
// These reuse the same bounded particle/glyph pools as sword contacts.
const ELEMENT_IMPACTS: Record<ImpactElement, { shapes: number[]; up: number; spread: number; speed: number; size: number; life: number; gravity: number; rays: number; width: number }> = {
  steel:     { shapes: [ParticleShape.streak, ParticleShape.shard], up: .12, spread: 1, speed: 1, size: 1, life: .24, gravity: -5, rays: 3, width: 1 },
  fire:      { shapes: [ParticleShape.shard, ParticleShape.mote], up: 1.1, spread: .7, speed: .65, size: .85, life: .34, gravity: 2, rays: 1, width: .8 },
  frost:     { shapes: [ParticleShape.shard], up: .3, spread: 1.6, speed: .8, size: 1.25, life: .28, gravity: -9, rays: 4, width: 1.6 },
  lightning: { shapes: [ParticleShape.streak], up: .04, spread: .55, speed: 1.5, size: .6, life: .12, gravity: 0, rays: 3, width: .5 },
  rift:      { shapes: [ParticleShape.ring], up: .1, spread: 2, speed: .45, size: 1.3, life: .28, gravity: 0, rays: 3, width: 1.3 },
  void:      { shapes: [ParticleShape.ring, ParticleShape.shard], up: .5, spread: 1.8, speed: .45, size: 1.4, life: .32, gravity: 1, rays: 3, width: 1.4 },
  blood:     { shapes: [ParticleShape.shard], up: .18, spread: 1.3, speed: .75, size: .8, life: .23, gravity: -12, rays: 2, width: 1.2 },
};

export class VfxDirector {
  private readonly glyphs: Glyph[] = Array.from({ length: MAX_GLYPHS }, () => ({
    active: false, t: 0, life: 0, x: 0, y: 0, z: 0, angle: 0, scale: 1, color: new THREE.Color(), element: "steel",
  }));
  private readonly mesh: THREE.InstancedMesh;
  private emitted = 0;
  private suppressed = 0;
  private lastCue: ImpactCue | null = null;
  private quality: "low" | "medium" | "high" = "high";

  readonly budgets: Record<"light" | "heavy" | "critical" | "execute", PresentationBudget> = {
    light: { priority: "action", maxActive: 18, maxParticles: 7, coverage: "tiny" },
    heavy: { priority: "critical", maxActive: 24, maxParticles: 12, coverage: "local" },
    critical: { priority: "critical", maxActive: 28, maxParticles: 14, coverage: "local" },
    execute: { priority: "critical", maxActive: 34, maxParticles: 18, coverage: "local" },
  };

  constructor(scene: THREE.Scene, private readonly particles: Particles) {
    const geo = new THREE.PlaneGeometry(1, 0.12);
    geo.translate(0.5, 0, 0);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.82,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_GLYPHS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.userData.solidity = "fx";
    for (let i = 0; i < MAX_GLYPHS; i++) {
      _matrix.makeTranslation(0, -999, 0);
      this.mesh.setMatrixAt(i, _matrix);
      this.mesh.setColorAt(i, _dark);
    }
    scene.add(this.mesh);
  }

  setQuality(q: "low" | "medium" | "high"): void { this.quality = q; }

  impact(cue: ImpactCue): void {
    this.lastCue = cue;
    const profile = ATTACK_PRESENTATION[cue.attackFamily];
    const strength = cue.sustained && !cue.killed ? "light" : cue.strength;
    const budget = this.budgets[strength];
    const active = this.glyphs.reduce((n, g) => n + (g.active ? 1 : 0), 0);
    if (active >= budget.maxActive) { this.suppressed++; return; }
    this.emitted++;
    const weight = strength === "light" ? 1 : strength === "heavy" ? 1.35 : strength === "critical" ? 1.55 : 1.8;
    const countScale = this.quality === "low" ? 0.55 : this.quality === "medium" ? 0.78 : 1;
    const count = Math.max(3, Math.round(budget.maxParticles * countScale * profile.particleScale));
    const angle = Math.atan2(cue.dirZ, cue.dirX);
    const element = ELEMENT_IMPACTS[cue.element];

    this.particles.directionalBurst({
      x: cue.x, y: cue.y, z: cue.z, count,
      color: cue.element === "blood" ? [cue.color] : [cue.color, cue.color, 0xffffff],
      dirX: cue.dirX, dirY: element.up, dirZ: cue.dirZ,
      spread: (cue.strength === "light" ? 0.46 : 0.7) * profile.shardSpread * element.spread,
      speed: [3.5 * element.speed, 7.5 * weight * element.speed], size: [0.12, 0.38 * weight * element.size], life: [0.08, element.life],
      gravity: element.gravity, drag: 5, shape: element.shapes,
    });

    const rays = Math.min(cue.strength === "light" ? 2 : cue.killed ? 5 : 4, element.rays + (cue.killed ? 1 : 0));
    for (let i = 0; i < rays; i++) {
      const slot = this.glyphs.find((g) => !g.active);
      if (!slot) break;
      slot.active = true;
      slot.t = 0;
      slot.life = cue.element === "lightning" ? .09 : cue.strength === "light" ? .13 : .2;
      slot.x = cue.x;
      slot.y = cue.y + 0.02 + i * 0.015;
      slot.z = cue.z;
      slot.angle = angle + (i - (rays - 1) * 0.5) * 0.32 * profile.shardSpread;
      if (cue.element === "rift" || cue.element === "void") slot.angle = angle + i / rays * Math.PI * 2;
      slot.scale = (0.65 + i * 0.12) * weight;
      slot.color.set(i === 0 && cue.element !== "blood" ? 0xffffff : cue.color);
      slot.element = cue.element;
    }
  }

  update(dt: number): void {
    let dirty = false;
    for (let i = 0; i < this.glyphs.length; i++) {
      const g = this.glyphs[i];
      if (!g.active) continue;
      dirty = true;
      g.t += dt;
      const k = Math.min(1, g.t / g.life);
      if (k >= 1) {
        g.active = false;
        _matrix.makeTranslation(0, -999, 0);
        this.mesh.setMatrixAt(i, _matrix);
        this.mesh.setColorAt(i, _dark);
        continue;
      }
      const collapse = g.element === "rift" || g.element === "void";
      const reach = g.scale * (collapse ? 1 - k * .8 : 0.55 + k * 0.75);
      _pos.set(g.x, g.y, g.z);
      if (collapse) { _pos.x += Math.cos(g.angle) * (1 - k) * .45; _pos.z += Math.sin(g.angle) * (1 - k) * .45; }
      if (g.element === "fire") _pos.y += k * .45;
      _euler.set(-Math.PI / 2, 0, g.angle);
      _quat.setFromEuler(_euler);
      _scale.set(reach, Math.max(0.02, g.scale * 0.16 * (1 - k) * ELEMENT_IMPACTS[g.element].width), 1);
      _matrix.compose(_pos, _quat, _scale);
      this.mesh.setMatrixAt(i, _matrix);
      _fadeColor.copy(g.color).multiplyScalar(1 - k);
      this.mesh.setColorAt(i, _fadeColor);
    }
    if (dirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }

  clear(): void {
    for (let i = 0; i < this.glyphs.length; i++) {
      const glyph = this.glyphs[i];
      glyph.active = false;
      glyph.t = glyph.life;
      _matrix.makeTranslation(0, -999, 0);
      this.mesh.setMatrixAt(i, _matrix);
      this.mesh.setColorAt(i, _dark);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.lastCue = null;
  }

  stats(): { active: number; emitted: number; suppressed: number; max: number } {
    return { active: this.glyphs.reduce((n, g) => n + (g.active ? 1 : 0), 0), emitted: this.emitted, suppressed: this.suppressed, max: MAX_GLYPHS };
  }

  lastImpact(): ImpactCue | null { return this.lastCue; }
}
