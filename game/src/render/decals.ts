import * as THREE from "three";

const MAX_PER_TYPE_DEFAULT = 12;
/** Fade-in time before a fresh mark reaches full opacity. */
const FADE_IN = 0.12;

interface DecalSlot {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  t: number;
  dur: number;
  peak: number;
}

/**
 * Ground impact decals (IDEAS-EXPANSION #29). A pool of flat floor quads — dark
 * radial SCORCH marks (heavy hits, crash novas, cold-crash) and jagged shattered
 * CRACK marks (kills, shatterglass) — that fade in, hold, fade out, then free
 * their slot. NORMAL-blended: it darkens the floor like a real burn/fracture,
 * never washes it additive-white (the no-screen-flash rule).
 *
 * One shared unit-quad geometry (rotateX baked in once, like Telegraphs' strip)
 * and two boot-baked canvas textures. Every pooled quad gets its own
 * MeshBasicMaterial (so per-slot fade is just `mat.opacity`, the same trick the
 * shockwave-ring pool in particles.ts uses) but all of them share the same
 * map/blending/side config, so they still compile down to one shared GPU
 * program — the pool doesn't grow `renderer.info.programs.length`.
 */
export class Decals {
  private scorchPool: DecalSlot[];
  private crackPool: DecalSlot[];

  constructor(scene: THREE.Scene, maxPerType = MAX_PER_TYPE_DEFAULT) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2); // lies flat, facing up

    this.scorchPool = buildPool(scene, geo, makeScorchTexture(), maxPerType);
    this.crackPool = buildPool(scene, geo, makeCrackTexture(), maxPerType);
  }

  /** Dark radial burn mark — heavy hits, crash novas, cold-crash. */
  scorch(x: number, z: number, radius = 1.6): void {
    spawn(this.scorchPool, x, z, radius * 2.2, 3.2 + Math.random() * 0.8);
  }

  /** Jagged shattered-ground mark — kills, shatterglass detonations. */
  crack(x: number, z: number, radius = 1.4): void {
    spawn(this.crackPool, x, z, radius * 2.4, 2.2 + Math.random() * 0.8);
  }

  /** Instantly hide every mark — call on room transitions if a clean floor matters. */
  clear(): void {
    hideAll(this.scorchPool);
    hideAll(this.crackPool);
  }

  update(dt: number): void {
    tick(this.scorchPool, dt);
    tick(this.crackPool, dt);
  }
}

function buildPool(scene: THREE.Scene, geo: THREE.BufferGeometry, tex: THREE.CanvasTexture, count: number): DecalSlot[] {
  const pool: DecalSlot[] = [];
  for (let i = 0; i < count; i++) {
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.NormalBlending,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    mesh.renderOrder = -2; // ground marks: under contact shadows (-1), well under everything else
    scene.add(mesh);
    pool.push({ mesh, mat, t: 0, dur: 0, peak: 0 });
  }
  return pool;
}

function spawn(pool: DecalSlot[], x: number, z: number, scale: number, dur: number): void {
  // A pool miss silently drops the mark (same contract as the ring/beam pools
  // in particles.ts) — a missed decal is invisible and unimportant.
  const slot = pool.find((s) => !s.mesh.visible);
  if (!slot) return;
  slot.mesh.visible = true;
  slot.mesh.position.set(x, 0.015, z);
  slot.mesh.rotation.y = Math.random() * Math.PI * 2; // vary orientation so repeats don't tile
  slot.mesh.scale.set(scale, scale, 1);
  slot.t = 0;
  slot.dur = dur;
  slot.peak = 0.8 + Math.random() * 0.15;
  slot.mat.opacity = 0;
}

function hideAll(pool: DecalSlot[]): void {
  for (const s of pool) {
    if (!s.mesh.visible) continue;
    s.mesh.visible = false;
    s.mat.opacity = 0;
  }
}

function tick(pool: DecalSlot[], dt: number): void {
  for (const s of pool) {
    if (!s.mesh.visible) continue;
    s.t += dt;
    if (s.t >= s.dur) {
      s.mesh.visible = false;
      s.mat.opacity = 0;
      continue;
    }
    if (s.t < FADE_IN) {
      s.mat.opacity = s.peak * (s.t / FADE_IN);
    } else {
      const holdEnd = s.dur * 0.55;
      s.mat.opacity = s.t < holdEnd ? s.peak : s.peak * (1 - (s.t - holdEnd) / (s.dur - holdEnd));
    }
  }
}

/** Dark, roughly-circular burn mark with a ragged crust so it doesn't read as a
 *  perfect disc. */
function makeScorchTexture(): THREE.CanvasTexture {
  const size = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const g = cv.getContext("2d")!;
  const c = size / 2;

  const grad = g.createRadialGradient(c, c, 0, c, c, c);
  grad.addColorStop(0, "rgba(8,7,7,0.95)");
  grad.addColorStop(0.35, "rgba(20,14,12,0.85)");
  grad.addColorStop(0.65, "rgba(32,20,14,0.4)");
  grad.addColorStop(1, "rgba(32,20,14,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);

  // Ragged crust blobs around the rim so the edge reads as scorched ground,
  // not a clean vector circle.
  for (let i = 0; i < 22; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = c * (0.55 + Math.random() * 0.35);
    const br = c * (0.12 + Math.random() * 0.16);
    const bx = c + Math.cos(a) * r;
    const by = c + Math.sin(a) * r;
    const bg = g.createRadialGradient(bx, by, 0, bx, by, br);
    bg.addColorStop(0, "rgba(6,5,5,0.55)");
    bg.addColorStop(1, "rgba(6,5,5,0)");
    g.fillStyle = bg;
    g.beginPath();
    g.arc(bx, by, br, 0, Math.PI * 2);
    g.fill();
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Small dark crater with jagged cracks radiating outward, tapering in width
 *  and alpha toward each tip — same jitter-per-step idiom as the arena floor
 *  texture's crack() painter, occasionally throwing a short branch line. */
function makeCrackTexture(): THREE.CanvasTexture {
  const size = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const g = cv.getContext("2d")!;
  const c = size / 2;

  const crater = g.createRadialGradient(c, c, 0, c, c, size * 0.14);
  crater.addColorStop(0, "rgba(6,5,6,0.85)");
  crater.addColorStop(1, "rgba(6,5,6,0)");
  g.fillStyle = crater;
  g.fillRect(0, 0, size, size);

  const spokes = 7 + Math.floor(Math.random() * 4);
  for (let i = 0; i < spokes; i++) {
    let angle = (i / spokes) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    let x = c;
    let y = c;
    const len = size * (0.32 + Math.random() * 0.16);
    const steps = 5 + Math.floor(Math.random() * 4);
    for (let s = 0; s < steps; s++) {
      angle += (Math.random() - 0.5) * 0.7;
      const nx = x + Math.cos(angle) * (len / steps);
      const ny = y + Math.sin(angle) * (len / steps);
      const a = 0.7 * (1 - s / steps);
      g.strokeStyle = `rgba(8,6,6,${a})`;
      g.lineWidth = Math.max(0.6, 2.4 * (1 - s / steps));
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(nx, ny);
      g.stroke();
      x = nx;
      y = ny;
      if (s > 1 && Math.random() < 0.25) {
        const ba = angle + (Math.random() - 0.5) * 1.6;
        const blen = len * 0.22;
        g.strokeStyle = `rgba(8,6,6,${a * 0.6})`;
        g.lineWidth = 0.8;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(ba) * blen, y + Math.sin(ba) * blen);
        g.stroke();
      }
    }
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
