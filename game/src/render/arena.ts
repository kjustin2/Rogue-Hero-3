import * as THREE from "three";
import type { Stage } from "./stage";
import { Cathedral } from "./cathedral";
import { WorldSetDirector } from "./worldSets";
import { actSetFor } from "../presentation/profiles";
import type { ActComposition, ActSetId } from "../presentation/types";
import { damp, lerp, segmentCircleContact } from "../core/math";
import { stoneTexture } from "./surfaces";
import { chamberFloor } from "./chamberFloor";
import { forgeCover } from "./coverForge";
import { chamberArchitecture } from "./chamberArchitecture";
import { ENCOUNTERS, type EncounterKind } from "../game/encounters";
import { ChamberBounds } from "../game/chamberBounds";

export const ARENA_RADIUS = 19;

export type Dressing = "rift" | "spire" | "forge" | "void";

/** Default FogExp2 density when a theme doesn't specify its own (IDEAS-GRAPHICS #4). */
export const FOG_DEFAULT = 0.016;

export interface ArenaTheme {
  name: string;
  fog: number;
  /** Per-act FogExp2 density — thicker = more oppressive/enclosed, thinner = vast/airless. */
  fogDensity?: number;
  skyTop: number;
  skyBottom: number;
  hemiSky: number;
  hemiGround: number;
  key: number;
  rim: number;
  crystal: number;
  ember: number;
  gridEmissive: number;
  /** Which edge-silhouette set this theme shows. */
  dressing: Dressing;
}

export const THEMES: Record<string, ArenaTheme> = {
  rift: {
    name: "rift",
    dressing: "rift",
    fog: 0x101a23,
    fogDensity: 0.017,
    skyTop: 0x06070b,
    skyBottom: 0x101c2a,
    hemiSky: 0x8197ae,
    hemiGround: 0x191a20,
    key: 0xffe8cd,
    rim: 0x83b0d5,
    crystal: 0x795044,
    ember: 0xc88047,
    gridEmissive: 0x30261f,
  },
  dusk: {
    name: "dusk",
    dressing: "rift",
    fog: 0x120a18,
    skyTop: 0x140626,
    skyBottom: 0x4a1840,
    hemiSky: 0xbb88ff,
    hemiGround: 0x180a14,
    key: 0xffe2d0,
    rim: 0xc36bff,
    crystal: 0xb86bff,
    ember: 0xcc66ff,
    gridEmissive: 0x40235e,
  },
  ember: {
    name: "ember",
    dressing: "rift",
    fog: 0x180a08,
    fogDensity: 0.02,
    skyTop: 0x190505,
    skyBottom: 0x571a08,
    hemiSky: 0xff9966,
    hemiGround: 0x1a0805,
    key: 0xffd8b0,
    rim: 0xff5522,
    crystal: 0xff7733,
    ember: 0xff7733,
    gridEmissive: 0x66220c,
  },
  // --- Act II: The Shattered Spire — cold jade glass, then storm-charged crown
  spire: {
    name: "spire",
    dressing: "spire",
    fog: 0x081414,
    fogDensity: 0.013,
    skyTop: 0x051210,
    skyBottom: 0x12262c,
    hemiSky: 0x9cbab9,
    hemiGround: 0x07140f,
    key: 0xe0fff2,
    rim: 0x89bfb9,
    crystal: 0x3effd2,
    ember: 0x55ffcc,
    gridEmissive: 0x0e4a40,
  },
  tempest: {
    name: "tempest",
    dressing: "spire",
    fog: 0x0a0e1c,
    skyTop: 0x060a1a,
    skyBottom: 0x16306a,
    hemiSky: 0x88bbff,
    hemiGround: 0x0a0e18,
    key: 0xe8f2ff,
    rim: 0x55aaff,
    crystal: 0x7fc4ff,
    ember: 0x66bbff,
    gridEmissive: 0x16335e,
  },
  // --- Act III: The Molten Core — crimson forge, then white-hot heart
  forge: {
    name: "forge",
    dressing: "forge",
    fog: 0x140805,
    fogDensity: 0.019,
    skyTop: 0x130404,
    skyBottom: 0x301d18,
    hemiSky: 0xbca393,
    hemiGround: 0x180a05,
    key: 0xffe0c0,
    rim: 0xd9a16e,
    crystal: 0xff9944,
    ember: 0xffaa44,
    gridEmissive: 0x5e2c0a,
  },
  core: {
    name: "core",
    dressing: "forge",
    fog: 0x180603,
    fogDensity: 0.021,
    skyTop: 0x150303,
    skyBottom: 0x341914,
    hemiSky: 0xbf9a87,
    hemiGround: 0x1a0603,
    key: 0xffd0a8,
    rim: 0xdd7954,
    crystal: 0xffcc66,
    ember: 0xff5522,
    gridEmissive: 0x661505,
  },
  // --- Act IV: The Sundered Abyss — a starless void shot through with rift light
  abyss: {
    name: "abyss",
    dressing: "void",
    fog: 0x05060f,
    fogDensity: 0.0075,
    skyTop: 0x03030a,
    skyBottom: 0x140a2e,
    hemiSky: 0x9b9db6,
    hemiGround: 0x0a0814,
    key: 0xd8d0ff,
    rim: 0xaaa0d2,
    crystal: 0x9a7cff,
    ember: 0x8a6cff,
    gridEmissive: 0x281a4a,
  },
  // --- Act V: The Hollow Star — the last pale-gold starlight guttering in a black
  // void (distinct from Act IV's violet abyss; the boss room's white-violet
  // "starfall" then reads as the star itself finally reached).
  hollow: {
    name: "hollow",
    dressing: "void",
    fog: 0x070506,
    fogDensity: 0.006,
    skyTop: 0x030204,
    skyBottom: 0x241408,
    hemiSky: 0xf2e0c0,
    hemiGround: 0x0c0a08,
    key: 0xfff4e0,
    rim: 0xf2d8a0,
    crystal: 0xffe8b8,
    ember: 0xe8c890,
    gridEmissive: 0x4a3a1c,
  },
  starfall: {
    name: "starfall",
    dressing: "void",
    fog: 0x06060f,
    fogDensity: 0.007,
    skyTop: 0x03030c,
    skyBottom: 0x1a1838,
    hemiSky: 0xeae6ff,
    hemiGround: 0x0a0a16,
    key: 0xd9d1e8,
    rim: 0xe8e0ff,
    crystal: 0xb8acc9,
    ember: 0xd8ccff,
    gridEmissive: 0x33305e,
  },
  // The Wound — beneath the floor of the world: raw crimson light in torn black
  wound: {
    name: "wound",
    dressing: "void",
    fog: 0x0a0305,
    fogDensity: 0.02,
    skyTop: 0x060102,
    skyBottom: 0x2e060e,
    hemiSky: 0xbea0a5,
    hemiGround: 0x120406,
    key: 0xffd8dc,
    rim: 0xd88792,
    crystal: 0xff5a6e,
    ember: 0xff3a52,
    gridEmissive: 0x4e0e1a,
  },
  voidcrown: {
    name: "voidcrown",
    dressing: "void",
    fog: 0x06080f,
    skyTop: 0x02040a,
    skyBottom: 0x0a2a4a,
    hemiSky: 0x9fe8ff,
    hemiGround: 0x080a14,
    key: 0xe8f6ff,
    rim: 0x37e0ff,
    crystal: 0x6fe0ff,
    ember: 0x5fd0ff,
    gridEmissive: 0x123a52,
  },
};

/**
 * The arena: a consistent combat footprint framed by authored architectural sets.
 * `applyTheme` re-tints everything for act/boss transitions.
 */
export class Arena {
  private skyMat: THREE.ShaderMaterial;
  private floorMat: THREE.MeshStandardMaterial;
  private readonly masonry = stoneTexture();
  private t = 0;
  private themeLerp = 1;
  // True only while crossfading between DIFFERENT themes (act boundaries) — same-theme
  // room loads still crossfade colors (a no-op) but must NOT trigger the emissive dip.
  private themeChanging = false;
  private fromTheme: ArenaTheme = THEMES.rift;
  private toTheme: ArenaTheme = THEMES.rift;
  private readonly basilica: Cathedral;
  private readonly worldSets: WorldSetDirector;
  private activeSetId: ActSetId = "rift";
  /** Per-room blocking pillars — collision circles consulted by movement + projectiles. */
  obstacles: { x: number; z: number; r: number }[] = [];
  private obstacleGroup: THREE.Group | null = null;
  private chamber: ReturnType<typeof chamberFloor> | null = null;
  private chamberWalls: THREE.Group | null = null;
  boundary: ChamberBounds | null = null;

  setChamber(kind: EncounterKind | null, act: number, boss?: string): void {
    this.boundary = kind ? new ChamberBounds(ENCOUNTERS[kind].boundary) : null;
    if (this.chamberWalls) {
      this.stage.scene.remove(this.chamberWalls);
      const materials = new Set<THREE.Material>();
      this.chamberWalls.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});
      for(const material of materials)material.dispose();
      this.chamberWalls=null;
    }
    if (this.chamber) {
      this.stage.scene.remove(this.chamber);
      this.chamber.geometry.dispose();
      this.chamber.material.map?.dispose();
      this.chamber.material.bumpMap?.dispose();
      this.chamber.material.dispose();
      this.chamber = null;
    }
    if (kind && this.boundary) {
      this.chamber = chamberFloor(kind, act, this.obstacles);
      this.chamberWalls = chamberArchitecture(this.boundary,act,this.masonry);
      this.stage.scene.add(this.chamber,this.chamberWalls);
    } else if(boss) {
      this.chamber=chamberFloor(null,act,[],boss);this.stage.scene.add(this.chamber);
    }
  }
  private obstacleVisuals: {
    x: number;
    z: number;
    r: number;
    fade: number;
    materials: THREE.MeshStandardMaterial[];
    shadowCasters: THREE.Mesh[];
  }[] = [];

  setObstacles(defs: { x: number; z: number; r: number }[], accentColor: number): void {
    this.setChamber(null, 1);
    if (this.obstacleGroup) {
      this.stage.scene.remove(this.obstacleGroup);
      this.obstacleGroup.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      this.obstacleGroup = null;
    }
    this.obstacleVisuals.length = 0;
    this.obstacles = defs;
    if (!defs.length) return;

    this.obstacleGroup = new THREE.Group();
    // Collision-truth audit: every mesh under this group is backed by a collider circle.
    this.obstacleGroup.userData.solidity = "solid";
    for (let i = 0; i < defs.length; i++) {
      const d = defs[i];
      const cover = forgeCover(d.r, i % 4, accentColor, this.masonry);
      cover.root.position.set(d.x,0,d.z);
      cover.root.rotation.y = (i % 2 ? -.12 : .16);
      this.obstacleGroup.add(cover.root);
      this.obstacleVisuals.push({ x:d.x, z:d.z, r:d.r, fade:0, materials:cover.materials, shadowCasters:cover.shadowCasters });
    }
    this.stage.scene.add(this.obstacleGroup);
  }

  /**
   * Fade only the blocking architecture that lies on the camera-to-hero sight
   * line. Collision stays authoritative and the translucent silhouette remains
   * visible, but a lower isometric camera can never lose the hero behind a
   * solid foreground pillar.
   */
  updateForegroundOcclusion(dt: number, camera: THREE.Camera, target: THREE.Vector3, enabled: boolean): void {
    const ax = camera.position.x;
    const az = camera.position.z;
    const bx = target.x;
    const bz = target.z;
    const dx = bx - ax;
    const dz = bz - az;
    const lengthSq = dx * dx + dz * dz;
    for (const visual of this.obstacleVisuals) {
      let blocked = false;
      if (enabled && lengthSq > 0.0001) {
        const t = ((visual.x - ax) * dx + (visual.z - az) * dz) / lengthSq;
        if (t > 0.08 && t < 0.96) {
          const nearestX = ax + dx * t;
          const nearestZ = az + dz * t;
          const clearance = visual.r + 0.72;
          blocked = (visual.x - nearestX) ** 2 + (visual.z - nearestZ) ** 2 < clearance * clearance;
        }
      }
      visual.fade = damp(visual.fade, blocked ? 1 : 0, blocked ? 12 : 8, dt);
      const opacity = lerp(1, 0.14, visual.fade);
      for (const material of visual.materials) {
        material.opacity = opacity;
        material.depthWrite = visual.fade < 0.02;
      }
      for (const mesh of visual.shadowCasters) mesh.castShadow = visual.fade < 0.05;
    }
  }

  foregroundOcclusion(): { active: number; maxFade: number; obstacles: number } {
    let active = 0;
    let maxFade = 0;
    for (const visual of this.obstacleVisuals) {
      if (visual.fade >= 0.5) active++;
      maxFade = Math.max(maxFade, visual.fade);
    }
    return { active, maxFade: Number(maxFade.toFixed(3)), obstacles: this.obstacleVisuals.length };
  }

  /** Solid pillars block direct weapon contact across their footprint. */
  blocksSegment(ax: number, az: number, bx: number, bz: number): boolean {
    if (this.boundary && (this.boundary.clearance(ax,az)<-.01 || this.boundary.clearance(bx,bz)<-.01)) return true;
    const dx = bx - ax, dz = bz - az, lengthSq = dx * dx + dz * dz;
    for (const o of this.obstacles) {
      const along = lengthSq > 0 ? Math.max(0, Math.min(1, ((o.x - ax) * dx + (o.z - az) * dz) / lengthSq)) : 0;
      const x = ax + dx * along - o.x, z = az + dz * along - o.z;
      if (x * x + z * z < o.r * o.r) return true;
    }
    return false;
  }

  containsPoint(x: number, z: number, radius = 0): boolean {
    return Math.hypot(x,z) <= ARENA_RADIUS-radius && (!this.boundary || this.boundary.clearance(x,z) >= radius);
  }

  firstBoundaryHit(ax: number, az: number, bx: number, bz: number, radius: number): number {
    return this.boundary?.firstHit(ax,az,bx,bz,radius) ?? Infinity;
  }

  firstSolidHit(ax: number, az: number, bx: number, bz: number, radius: number): number {
    let first=this.firstBoundaryHit(ax,az,bx,bz,radius);
    for(const o of this.obstacles)first=Math.min(first,segmentCircleContact(ax,az,bx,bz,o.x,o.z,o.r+radius));
    return first;
  }

  /** Push a circle out of furniture and inside the visible chamber walls. */
  resolveObstacles(pos: { x: number; z: number }, radius: number): void {
    const distance=Math.hypot(pos.x,pos.z),limit=ARENA_RADIUS-radius;
    if(distance>limit){pos.x*=limit/distance;pos.z*=limit/distance;}
    this.boundary?.resolve(pos,radius);
    for (const o of this.obstacles) {
      const dx = pos.x - o.x;
      const dz = pos.z - o.z;
      const d = Math.hypot(dx, dz);
      const min = o.r + radius;
      if (d >= min) continue;
      if (d > 0.0001) {
        pos.x = o.x + (dx / d) * min;
        pos.z = o.z + (dz / d) * min;
      } else {
        // Dead center (teleports, spawns) — eject toward the arena middle
        const a = Math.atan2(-o.x, -o.z) || 0;
        pos.x = o.x + Math.sin(a) * min;
        pos.z = o.z + Math.cos(a) * min;
      }
    }
    this.boundary?.resolve(pos,radius);
  }

  constructor(private stage: Stage) {
    const scene = stage.scene;
    this.basilica = new Cathedral(scene);
    this.worldSets = new WorldSetDirector(scene);

    // --- Sky dome: vertical gradient + procedural stars
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        topColor: { value: new THREE.Color(THEMES.rift.skyTop) },
        bottomColor: { value: new THREE.Color(THEMES.rift.skyBottom) },
        auroraColor: { value: new THREE.Color(THEMES.rift.ember) },
        uTime: { value: 0 },
        // Per-act sky: 0 rift-tears, 1 spire storm, 2 molten core, 3 hollow star, 4 sundered abyss.
        uStyle: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform vec3 auroraColor;
        uniform float uTime;
        uniform float uStyle;
        varying vec3 vPos;
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float vnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          float a = hash(i), b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }
        float fbm(vec2 p) {
          float v = 0.0, amp = 0.55;
          for (int i = 0; i < 4; i++) { v += amp * vnoise(p); p = p * 2.03 + 7.1; amp *= 0.5; }
          return v;
        }
        // One stable star layer at a given density + grid scale. Per-star time
        // modulation looked like random background pixels changing colour while
        // the player was moving, especially after bloom.
        float starLayer(vec2 dirxz, float gscale, float thresh) {
          vec2 cell = floor(dirxz * gscale);
          float s = step(thresh, hash(cell));
          float brightness = 0.62 + hash(cell + 7.0) * 0.38;
          vec2 point = fract(dirxz * gscale) - 0.5;
          float radius = length(point);
          float aa = max(fwidth(radius), 0.025);
          return s * brightness * (1.0 - smoothstep(0.045, 0.045 + aa, radius));
        }
        void main() {
          vec3 dir = normalize(vPos);
          float h = dir.y * 0.5 + 0.5;
          vec3 col = mix(bottomColor, topColor, pow(h, 0.65));
          vec2 proj = dir.xz / max(0.12, dir.y + 0.25);
          // The planar projection's max() clamp creates a hard scale change just below
          // the horizon (dir.y≈-0.13) that reads as a "split" line. Fade every projected
          // feature (nebula/stars/per-act FX) to nothing BEFORE that seam so the sky
          // merges smoothly into the plain gradient at the horizon — no visible division.
          float horizonFade = smoothstep(-0.06, 0.26, dir.y);

          // Two drifting nebula layers at different scales + drift speeds, the base one
          // domain-warped — parallax depth and a softer, less blotchy cloud than a
          // single octave gives. Concentrated in the mid-upper sky.
          vec2 np = proj * 1.4;
          float warp = vnoise(np * 0.8 + uTime * 0.02) - 0.5;
          float neb = fbm(np + warp * 0.6 + vec2(uTime * 0.012, uTime * 0.006));
          float neb2 = fbm(np * 2.05 + vec2(-uTime * 0.017, uTime * 0.009) + 23.0);
          neb = smoothstep(0.40, 0.96, neb) * 0.72 + smoothstep(0.54, 1.0, neb2) * 0.4;
          float nebMask = smoothstep(0.14, 0.52, h) * smoothstep(1.05, 0.62, h) * horizonFade;
          vec3 nebCol = mix(auroraColor, topColor * 2.2 + bottomColor, 0.45);
          col += nebCol * neb * nebMask * 0.5;

          // Two star layers (bright sparse + faint dense) for parallax depth. The
          // Sundered Abyss (style 4) is near-starless — only its rift-cracks light it.
          float hmask = smoothstep(0.0, 0.32, h) * horizonFade;
          float starAmt = uStyle > 3.5 ? 0.08 : uStyle > 0.5 ? 0.52 : 0.72;
          col += vec3(0.92, 0.96, 1.0) * starLayer(proj, 28.0, 0.987) * hmask * 0.52 * starAmt;
          col += vec3(0.8, 0.86, 1.0) * starLayer(proj + 3.3, 52.0, 0.978) * hmask * 0.18 * starAmt;

          // --- The depths below the disc ---
          // The arena floats over a rift. Mirror the upper sky's planar projection
          // downward so this content fades to nothing exactly at the horizon (no seam),
          // then fill the lower sky with slowly spiralling abyssal cloud, deep stars and
          // a luminous well far below — so looking down is never an empty gradient.
          float belowFade = smoothstep(-0.05, -0.5, dir.y);
          vec2 fproj = dir.xz / max(0.12, -dir.y + 0.22);
          float fr = length(fproj);
          float fa = atan(fproj.y, fproj.x) + uTime * 0.05 + fr * 0.3; // spiral toward the nadir
          vec2 swp = vec2(cos(fa), sin(fa)) * fr;
          float depths = smoothstep(0.40, 0.96, fbm(swp * 1.15 + vec2(uTime * 0.012, -uTime * 0.015))) * 0.85;
          vec3 depthsCol = mix(bottomColor * 1.6 + topColor * 0.3, auroraColor, 0.4);
          col += depthsCol * depths * belowFade * 0.42;
          // Deep stars — the cosmos continues beneath the disc.
          col += vec3(0.72, 0.8, 1.0) * starLayer(fproj * 0.9 + 17.0, 40.0, 0.966) * belowFade * 0.4;
          col += vec3(0.62, 0.7, 1.0) * starLayer(fproj * 1.7 + 31.0, 66.0, 0.95) * belowFade * 0.18;
          // A soft luminous well far below — a hint of where the rift leads, gently breathing.
          float well = smoothstep(-0.25, -0.95, dir.y);
          col += depthsCol * well * (0.1 + 0.05 * sin(uTime * 0.5));

          // Aurora bands drifting through the upper sky, act-colored. Strongest in
          // the rift act; dimmed elsewhere so each act's signature effect leads.
          float band = sin(dir.x * 3.2 + uTime * 0.16 + sin(dir.z * 2.4 - uTime * 0.11) * 1.4);
          float band2 = sin(dir.z * 2.7 - uTime * 0.09 + dir.x * 1.6);
          float aur = smoothstep(0.5, 0.72, h) * smoothstep(0.98, 0.78, h);
          float auroraAmt = uStyle < 0.5 ? 1.0 : uStyle > 3.5 ? 0.0 : 0.32; // abyss: no aurora, only cracks
          col += auroraColor * aur * (max(0.0, band) * 0.36 + max(0.0, band2) * 0.22) * auroraAmt;

          // --- Per-act signature atmosphere (uStyle is a uniform, so this branch is
          // coherent across the whole draw — each act pays only for its own effect) ---
          if (uStyle < 0.5) {
            // Ember Rift: one restrained, stable wound high in the sky. Noise-
            // threshold "tears" previously produced dozens of orange/black bands
            // that looked exactly like corrupted scanlines as the camera moved.
            float woundAxis = abs(dir.x + 0.18 + sin(dir.y * 8.0) * 0.025);
            float wound = smoothstep(0.018, 0.0, woundAxis)
                        * smoothstep(0.52, 0.7, h) * smoothstep(0.98, 0.82, h);
            col += auroraColor * wound * 0.52;
          } else if (uStyle < 1.5) {
            // Shattered Spire: charged clouds and a persistent distant lightning
            // vein. The old stochastic whole-sky flashes were indistinguishable
            // from a renderer/color glitch and could fire during dense combat.
            float roil = fbm(np * 1.6 + vec2(uTime * 0.06, -uTime * 0.04));
            col += vec3(0.18, 0.32, 0.6) * smoothstep(0.5, 1.0, roil) * nebMask * 0.55;
            float bolt = smoothstep(0.028, 0.0, abs(fbm(np * vec2(0.9, 0.32) + 7.0) - 0.5))
                       * smoothstep(0.45, 0.96, h);
            col += vec3(0.7, 0.82, 1.0) * bolt * 0.34;
          } else if (uStyle < 2.5) {
            // Molten Core: a furnace sky — a hot glowing horizon, slow lava-lit cloud
            // rolling with the heat, and embers streaming upward.
            float horizon = smoothstep(0.46, 0.0, h);
            col += auroraColor * horizon * 0.6;
            col += vec3(1.0, 0.5, 0.18) * pow(horizon, 3.0) * 0.7;
            float lava = fbm(np * 1.3 + vec2(uTime * 0.03, -uTime * 0.05));
            col += vec3(1.0, 0.42, 0.12) * smoothstep(0.55, 1.0, lava) * nebMask
                   * (0.6 + 0.4 * sin(uTime * 0.7 + lava * 6.0));
            col += vec3(0.34, 0.14, 0.06) * smoothstep(0.5, 1.0, lava) * nebMask * 0.4;
            vec2 ep = proj - vec2(uTime * 0.02, uTime * 0.35);
            float em = starLayer(ep, 34.0, 0.984) + starLayer(ep + 5.0, 48.0, 0.99);
            col += vec3(1.0, 0.6, 0.25) * em * smoothstep(0.06, 0.5, h) * horizonFade * 0.9;
          } else if (uStyle < 3.5) {
            // Hollow Star (the end of all light): a dense violet cosmos, a faint galactic
            // band, and the dying Hollow Star low on the horizon — collapsing accretion
            // rings spiral inward to a blinding white core.
            col += vec3(0.85, 0.85, 1.0) * starLayer(proj + 11.0, 80.0, 0.982) * hmask * 0.16;
            float galaxy = fbm(proj * 0.85 + 7.0);
            float gcenter = dir.y - dir.x * 0.3 + 0.06 + (galaxy - 0.5) * 0.5;
            float gband = smoothstep(0.5, 1.0, galaxy) * smoothstep(0.62, 0.0, abs(gcenter));
            col += vec3(0.6, 0.5, 0.9) * gband * horizonFade * 0.25;
            vec3 starDir = normalize(vec3(0.32, 0.18, 1.0));
            float sd = max(0.0, dot(dir, starDir));
            float ang = acos(clamp(sd, 0.0, 1.0));
            float pulse = 0.85 + 0.15 * sin(uTime * 1.1);
            float rings = (sin(ang * 58.0 - uTime * 2.2) * 0.5 + 0.5)
                        * smoothstep(0.42, 0.04, ang) * smoothstep(0.015, 0.1, ang);
            col += vec3(0.8, 0.6, 1.0) * rings * 0.5 * pulse;
            col += auroraColor * (pow(sd, 11.0) * 0.45 + pow(sd, 48.0) * 0.6) * pulse;
            col += vec3(1.0, 0.97, 1.0) * (pow(sd, 240.0) * 1.5 + pow(sd, 1100.0) * 1.9) * pulse;
          } else {
            // Sundered Abyss: a starless black void shot through with rift-light. Jagged
            // violet fractures crack across the dark, pulsing with an unstable inner glow —
            // no stars, only the wound's light leaking through.
            float crackN = fbm(np * 1.1 + vec2(uTime * 0.015, -uTime * 0.01));
            float crack = smoothstep(0.045, 0.0, abs(crackN - 0.5));
            float unstable = 0.82 + 0.08 * sin(uTime * 0.7 + crackN * 8.0);
            col += vec3(0.55, 0.3, 1.0) * crack * nebMask * 1.4 * unstable;
            col += vec3(0.72, 0.46, 1.0) * smoothstep(0.03, 0.0, abs(fbm(np * 2.1 + 13.0) - 0.5)) * nebMask * 0.7 * unstable;
            col += vec3(0.16, 0.08, 0.28) * smoothstep(0.45, 1.0, crackN) * nebMask * 0.5;
          }
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(160, 32, 16), this.skyMat);
    sky.userData.solidity = "nonsolid";
    scene.add(sky);

    // Dark stone beneath the separate paving meshes keeps seams and worn edges quiet.
    const floorTex = this.masonry;
    this.floorMat = new THREE.MeshStandardMaterial({
      map: floorTex,
      emissive: new THREE.Color(THEMES.rift.gridEmissive),
      emissiveIntensity: 0.035,
      bumpMap: floorTex,
      bumpScale: 0.012,
      roughness: 0.85,
      metalness: 0.15,
      color: 0x343c44,
    });
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(ARENA_RADIUS + 1.6, ARENA_RADIUS - 1.5, 2.4, 64),
      [
        new THREE.MeshStandardMaterial({ color: 0x0c0c16, roughness: 0.95 }),
        this.floorMat,
        new THREE.MeshStandardMaterial({ color: 0x07070d }),
      ]
    );
    disc.position.y = -1.2;
    disc.receiveShadow = true;
    disc.userData.solidity = "ground"; // the walkable floor — never a blocker
    scene.add(disc);
    // Top cap material slot: cylinder material order is [side, top, bottom]
    disc.geometry.groups.forEach((g, i) => (g.materialIndex = i === 1 ? 1 : i === 2 ? 2 : 0));

  }

  applyTheme(theme: ArenaTheme, instant = false): void {
    this.themeChanging = !instant && this.toTheme.name !== theme.name;
    this.fromTheme = instant ? theme : this.currentBlend();
    this.toTheme = theme;
    this.themeLerp = instant ? 1 : 0;
    this.blendSettled = false;
    // Env IBL is baked ONCE at boot (stage.ts) and never rebaked per act: swapping
    // scene.environment mid-crossfade popped reflections (read as an act-load flicker).
    // Silhouettes swap instantly — theme changes happen behind the spawn flash
    this.activeSetId = theme.name === "spire" || theme.name === "tempest" ? "spire"
      : theme.name === "forge" || theme.name === "core" ? "forge"
      : theme.name === "hollow" || theme.name === "starfall" ? "hollow"
      : theme.name === "abyss" || theme.name === "voidcrown" ? "abyss"
      : theme.name === "wound" ? "wound" : "rift";
    this.basilica.setVisible(this.activeSetId === "rift");
    this.worldSets.set(this.activeSetId, "combat");
    // Sky style is per-act, not per-dressing: abyss + hollow share the "void" dressing
    // (silhouettes) but get distinct skies (4 vs 3) so no two acts look the same.
    const n = theme.name;
    this.skyMat.uniforms.uStyle.value =
      n === "spire" || n === "tempest" ? 1 :
      n === "forge" || n === "core" ? 2 :
      n === "hollow" || n === "starfall" ? 3 :
      n === "abyss" || n === "voidcrown" ? 4 : 0;
  }

  /** Act I authored dressing only. Collision and obstacle topology are unchanged. */
  setBasilicaComposition(kind: "nave" | "reliquary" | "courtyard"): void {
    this.basilica.setComposition(kind);
  }

  /** Select the authored presentation set for the loaded node. This changes no
   * collision, obstacle or movement data; it only toggles seeded decoration. */
  setActComposition(act: number, composition: ActComposition, bossKind?: string): void {
    this.activeSetId = actSetFor(act, bossKind);
    this.basilica.setVisible(this.activeSetId === "rift");
    if (this.activeSetId === "rift") {
      this.basilica.setComposition(composition === "boss" ? "courtyard" : composition === "elite" ? "reliquary" : "nave");
      this.worldSets.set("rift", composition);
    } else {
      this.worldSets.set(this.activeSetId, composition);
    }
  }

  setPresentationQuality(quality: "low" | "medium" | "high", reduceMotion: boolean): void {
    this.worldSets.setPresentationQuality(quality, reduceMotion);
  }

  private currentBlend(): ArenaTheme {
    const k = this.themeLerp;
    const mix = (a: number, b: number) =>
      new THREE.Color(a).lerp(new THREE.Color(b), k).getHex();
    const f = this.fromTheme;
    const t = this.toTheme;
    return {
      name: t.name,
      dressing: t.dressing,
      fog: mix(f.fog, t.fog),
      fogDensity: (f.fogDensity ?? FOG_DEFAULT) + ((t.fogDensity ?? FOG_DEFAULT) - (f.fogDensity ?? FOG_DEFAULT)) * k,
      skyTop: mix(f.skyTop, t.skyTop),
      skyBottom: mix(f.skyBottom, t.skyBottom),
      hemiSky: mix(f.hemiSky, t.hemiSky),
      hemiGround: mix(f.hemiGround, t.hemiGround),
      key: mix(f.key, t.key),
      rim: mix(f.rim, t.rim),
      crystal: mix(f.crystal, t.crystal),
      ember: mix(f.ember, t.ember),
      gridEmissive: mix(f.gridEmissive, t.gridEmissive),
    };
  }

  get emberColor(): number {
    return this.currentBlend().ember;
  }

  // Reusable scratch colors — the blend runs only while a theme transition is
  // in flight, and never allocates (this used to create ~12 Colors per frame).
  private cA = new THREE.Color();
  private cB = new THREE.Color();
  private blendSettled = false;

  private mixTo(target: THREE.Color, a: number, b: number, k: number): void {
    this.cA.set(a);
    this.cB.set(b);
    target.copy(this.cA).lerp(this.cB, k);
  }

  private applyBlendColors(): void {
    const f = this.fromTheme;
    const t = this.toTheme;
    const k = this.themeLerp;
    this.mixTo(this.stage.fog.color, f.fog, t.fog, k);
    // Per-act fog density lerp (IDEAS-GRAPHICS #4) — a plain number alongside the colors.
    const fd = f.fogDensity ?? FOG_DEFAULT;
    this.stage.fog.density = fd + ((t.fogDensity ?? FOG_DEFAULT) - fd) * k;
    // Kicker/rim light tracks the theme rim color (IDEAS-GRAPHICS #6).
    this.mixTo(this.stage.rimLight.color, f.rim, t.rim, k);
    if (this.stage.scene.background instanceof THREE.Color) {
      this.stage.scene.background.copy(this.stage.fog.color);
    }
    this.mixTo(this.skyMat.uniforms.topColor.value as THREE.Color, f.skyTop, t.skyTop, k);
    this.mixTo(this.skyMat.uniforms.bottomColor.value as THREE.Color, f.skyBottom, t.skyBottom, k);
    this.mixTo(this.skyMat.uniforms.auroraColor.value as THREE.Color, f.ember, t.ember, k);
    this.mixTo(this.stage.hemiLight.color, f.hemiSky, t.hemiSky, k);
    this.mixTo(this.stage.hemiLight.groundColor, f.hemiGround, t.hemiGround, k);
    this.mixTo(this.stage.keyLight.color, f.key, t.key, k);
    this.mixTo(this.floorMat.emissive, f.gridEmissive, t.gridEmissive, k);

  }

  /** Target 0/1 — set by the tempo system while the player holds Critical. */
  criticalHeat = 0;
  /** Target 0/1 — boss cutscenes dim the arena ("the room holds its breath"),
   *  snapping back fast at the reveal. */
  cutsceneDim = 0;
  private dim = 0;

  update(dt: number): void {
    this.t += dt;
    this.skyMat.uniforms.uTime.value = this.t;
    // Dim eases in slowly, releases fast — darkness → impact at the name-drop.
    this.dim += (this.cutsceneDim - this.dim) * Math.min(1, dt * (this.cutsceneDim > this.dim ? 1.8 : 7));
    this.basilica.update(dt, this.dim);
    this.worldSets.update(dt, this.dim);

    if (this.themeLerp < 1) {
      this.themeLerp = Math.min(1, this.themeLerp + dt * 0.7);
      this.applyBlendColors();
      this.blendSettled = this.themeLerp >= 1;
    } else if (!this.blendSettled) {
      this.applyBlendColors();
      this.blendSettled = true;
    }

    // Keep the room itself chromatically stable. Tempo already reads on the
    // player, HUD, and attacks; driving every world light and the fog from it
    // created distracting background colour/brightness pumping in combat.
    // A theme cross-lerp desaturates the bright emissives (rim goes cyan→periwinkle→
    // magenta) and at full breathe intensity that midpoint blooms to pure WHITE — the
    // "act-loading flicker". Hold the emissives down through the crossfade (deepest at
    // the start, easing back to full) so the rim rotates hue cleanly instead of blowing
    // out. Hidden behind the spawn flash, so no visible step when the crossfade begins.
    const xf = (this.blendSettled || !this.themeChanging) ? 1 : 0.5 + 0.5 * this.themeLerp;
    const lit = (1 - this.dim * 0.62) * xf;
    this.stage.keyLight.intensity = 3.0 * (1 - this.dim * 0.25);
    this.stage.hemiLight.intensity = 0.48;
    this.stage.rimLight.intensity = 1.35;
    if (this.blendSettled) {
      const baseFog = this.toTheme.fogDensity ?? FOG_DEFAULT;
      this.stage.fog.density = baseFog * (1 + this.dim * 0.35);
    }
    // Keep large world surfaces photometrically stable. Ambient motion belongs
    // in geometry/particles; pulsing the floor, rim and every crystal together
    // reads as a synchronized render fault beside emissive enemies.
    this.floorMat.emissiveIntensity = 0.035 * lit;
  }
}
