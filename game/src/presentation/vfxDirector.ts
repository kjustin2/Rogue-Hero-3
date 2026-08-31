import * as THREE from "three";
import { ParticleShape, type Particles } from "../render/particles";
import { ATTACK_PRESENTATION } from "./profiles";
import type { ImpactCue, PresentationBudget } from "./types";

const MAX_GLYPHS = 48;
const _matrix = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _dark = new THREE.Color(0x000000);
const _fadeColor = new THREE.Color();

interface Glyph { active: boolean; t: number; life: number; x: number; y: number; z: number; angle: number; scale: number; color: THREE.Color }

export class VfxDirector {
  private readonly glyphs: Glyph[] = Array.from({ length: MAX_GLYPHS }, () => ({
    active: false, t: 0, life: 0, x: 0, y: 0, z: 0, angle: 0, scale: 1, color: new THREE.Color(),
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
    const budget = this.budgets[cue.strength];
    const active = this.glyphs.reduce((n, g) => n + (g.active ? 1 : 0), 0);
    if (active >= budget.maxActive) { this.suppressed++; return; }
    this.emitted++;
    const weight = cue.strength === "light" ? 1 : cue.strength === "heavy" ? 1.35 : cue.strength === "critical" ? 1.55 : 1.8;
    const countScale = this.quality === "low" ? 0.55 : this.quality === "medium" ? 0.78 : 1;
    const count = Math.max(3, Math.round(budget.maxParticles * countScale * profile.particleScale));
    const angle = Math.atan2(cue.dirZ, cue.dirX);

    this.particles.directionalBurst({
      x: cue.x, y: cue.y, z: cue.z, count,
      color: cue.strength === "light" ? [cue.color, 0xffffff] : [0xffffff, cue.color, 0xffd27a],
      dirX: cue.dirX, dirY: 0.12, dirZ: cue.dirZ,
      spread: (cue.strength === "light" ? 0.46 : 0.7) * profile.shardSpread,
      speed: [3.5, 7.5 * weight], size: [0.16, 0.38 * weight], life: [0.1, 0.24],
      gravity: -5, drag: 5, shape: [ParticleShape.streak, ParticleShape.shard],
    });

    const rays = cue.strength === "light" ? 2 : cue.killed ? 5 : 3;
    for (let i = 0; i < rays; i++) {
      const slot = this.glyphs.find((g) => !g.active);
      if (!slot) break;
      slot.active = true;
      slot.t = 0;
      slot.life = cue.strength === "light" ? 0.11 : 0.17;
      slot.x = cue.x;
      slot.y = cue.y + 0.02 + i * 0.015;
      slot.z = cue.z;
      slot.angle = angle + (i - (rays - 1) * 0.5) * 0.32 * profile.shardSpread;
      slot.scale = (0.65 + i * 0.12) * weight;
      slot.color.set(i === 0 ? 0xffffff : cue.color);
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
      const reach = g.scale * (0.55 + k * 0.75);
      _pos.set(g.x, g.y, g.z);
      _euler.set(-Math.PI / 2, 0, g.angle);
      _quat.setFromEuler(_euler);
      _scale.set(reach, Math.max(0.02, g.scale * 0.16 * (1 - k)), 1);
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
