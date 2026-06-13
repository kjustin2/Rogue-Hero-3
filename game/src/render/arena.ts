import * as THREE from "three";
import type { Stage } from "./stage";

export const ARENA_RADIUS = 19;

export type Dressing = "rift" | "spire" | "forge";

export interface ArenaTheme {
  name: string;
  fog: number;
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
    fog: 0x0a0a18,
    skyTop: 0x0b0820,
    skyBottom: 0x251440,
    hemiSky: 0x8899ff,
    hemiGround: 0x140a18,
    key: 0xfff2e0,
    rim: 0x37e0ff,
    crystal: 0x46c8ff,
    ember: 0x55ccff,
    gridEmissive: 0x1c4a66,
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
    skyTop: 0x051210,
    skyBottom: 0x0e4038,
    hemiSky: 0x77ffdd,
    hemiGround: 0x07140f,
    key: 0xe0fff2,
    rim: 0x2affc8,
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
    skyTop: 0x130404,
    skyBottom: 0x6a2408,
    hemiSky: 0xffaa66,
    hemiGround: 0x180a05,
    key: 0xffe0c0,
    rim: 0xffaa33,
    crystal: 0xff9944,
    ember: 0xffaa44,
    gridEmissive: 0x5e2c0a,
  },
  core: {
    name: "core",
    dressing: "forge",
    fog: 0x180603,
    skyTop: 0x150303,
    skyBottom: 0x7a1205,
    hemiSky: 0xff8855,
    hemiGround: 0x1a0603,
    key: 0xffd0a8,
    rim: 0xff3300,
    crystal: 0xffcc66,
    ember: 0xff5522,
    gridEmissive: 0x661505,
  },
};

/**
 * The arena: a floating obsidian disc in a void — emissive grid floor,
 * glowing rim, crystal monoliths marking bounds, floating rocks, gradient sky.
 * `applyTheme` re-tints everything for act/boss transitions.
 */
export class Arena {
  private skyMat: THREE.ShaderMaterial;
  private rimMat: THREE.MeshStandardMaterial;
  private floorMat: THREE.MeshStandardMaterial;
  private crystalMats: THREE.MeshStandardMaterial[] = [];
  private rocks: { mesh: THREE.Mesh; baseY: number; spin: number; bob: number; phase: number }[] = [];
  private dressings: Record<Dressing, THREE.Group | null> = { rift: null, spire: null, forge: null };
  private sharedGeos = new Map<string, THREE.BufferGeometry>();
  private t = 0;
  private themeLerp = 1;
  private fromTheme: ArenaTheme = THEMES.rift;
  private toTheme: ArenaTheme = THEMES.rift;

  private shareGeo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let g = this.sharedGeos.get(key);
    if (!g) {
      g = make();
      this.sharedGeos.set(key, g);
    }
    return g;
  }

  /** Ten clusters on the boundary ring, built by a per-act callback. */
  private buildDressing(
    scene: THREE.Scene,
    build: (group: THREE.Group, accent: THREE.MeshStandardMaterial, dark: THREE.MeshStandardMaterial) => void
  ): THREE.Group {
    const root = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x10131c, roughness: 0.85, flatShading: true });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.31;
      const group = new THREE.Group();
      const accent = new THREE.MeshStandardMaterial({
        color: 0x0a1420,
        emissive: new THREE.Color(THEMES.rift.crystal),
        emissiveIntensity: 1.3,
        roughness: 0.25,
        metalness: 0.1,
        flatShading: true,
      });
      this.crystalMats.push(accent);
      build(group, accent, dark);
      const r = ARENA_RADIUS + 2.6;
      group.position.set(Math.cos(a) * r, -0.4, Math.sin(a) * r);
      root.add(group);
    }
    root.visible = false;
    scene.add(root);
    return root;
  }

  private setDressing(kind: Dressing): void {
    for (const [k, g] of Object.entries(this.dressings)) {
      if (g) g.visible = k === kind;
    }
  }

  /** Per-room blocking pillars — collision circles consulted by movement + projectiles. */
  obstacles: { x: number; z: number; r: number }[] = [];
  private obstacleGroup: THREE.Group | null = null;

  setObstacles(defs: { x: number; z: number; r: number }[], accentColor: number): void {
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
    this.obstacles = defs;
    if (!defs.length) return;

    this.obstacleGroup = new THREE.Group();
    for (const d of defs) {
      const h = 2.4 + d.r;
      const rock = new THREE.MeshStandardMaterial({ color: 0x191523, roughness: 0.85, flatShading: true });
      const band = new THREE.MeshStandardMaterial({
        color: 0x0c0a14, emissive: accentColor, emissiveIntensity: 1.4, roughness: 0.3, flatShading: true,
      });
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(d.r * 0.82, d.r, h, 7), rock);
      pillar.position.set(d.x, h / 2, d.z);
      pillar.rotation.y = Math.random() * Math.PI;
      pillar.castShadow = true;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(d.r * 0.92, 0.07, 8, 24), band);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(d.x, h * 0.72, d.z);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(d.r * 0.5, 0.9, 5), band);
      cap.position.set(d.x, h + 0.4, d.z);
      this.obstacleGroup.add(pillar, ring, cap);
    }
    this.stage.scene.add(this.obstacleGroup);
  }

  /** Push a circle (entity) out of any obstacle it overlaps. */
  resolveObstacles(pos: THREE.Vector3, radius: number): void {
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
  }

  constructor(private stage: Stage) {
    const scene = stage.scene;

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
        varying vec3 vPos;
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        void main() {
          vec3 dir = normalize(vPos);
          float h = dir.y * 0.5 + 0.5;
          vec3 col = mix(bottomColor, topColor, pow(h, 0.65));
          // Star field above the horizon
          vec2 sp = dir.xz / max(0.12, dir.y + 0.25) * 28.0;
          vec2 cell = floor(sp);
          float star = step(0.985, hash(cell));
          float tw = 0.5 + 0.5 * sin(uTime * (1.0 + hash(cell + 7.0) * 3.0) + hash(cell) * 50.0);
          col += vec3(0.9, 0.95, 1.0) * star * tw * smoothstep(0.0, 0.35, h) * 0.5;
          // Aurora bands drifting through the upper sky, act-colored
          float band = sin(dir.x * 3.2 + uTime * 0.16 + sin(dir.z * 2.4 - uTime * 0.11) * 1.4);
          float band2 = sin(dir.z * 2.7 - uTime * 0.09 + dir.x * 1.6);
          float aur = smoothstep(0.5, 0.72, h) * smoothstep(0.98, 0.78, h);
          col += auroraColor * aur * (max(0.0, band) * 0.30 + max(0.0, band2) * 0.18);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(160, 32, 16), this.skyMat);
    scene.add(sky);

    // --- Floor: obsidian disc with painted grid texture
    const floorTex = this.makeFloorTexture();
    this.floorMat = new THREE.MeshStandardMaterial({
      map: floorTex,
      emissiveMap: floorTex,
      emissive: new THREE.Color(THEMES.rift.gridEmissive),
      emissiveIntensity: 1.6,
      roughness: 0.85,
      metalness: 0.15,
      color: 0xbbbbcc,
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
    scene.add(disc);
    // Top cap material slot: cylinder material order is [side, top, bottom]
    disc.geometry.groups.forEach((g, i) => (g.materialIndex = i === 1 ? 1 : i === 2 ? 2 : 0));

    // --- Glowing rim ring at the arena edge
    this.rimMat = new THREE.MeshStandardMaterial({
      color: 0x111122,
      emissive: new THREE.Color(THEMES.rift.rim),
      emissiveIntensity: 2.2,
      roughness: 0.4,
    });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(ARENA_RADIUS + 0.9, 0.16, 12, 96), this.rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.1;
    scene.add(rim);

    // --- Edge dressing: one group per act silhouette, toggled by theme
    this.dressings.rift = this.buildDressing(scene, (group, mat) => {
      // Act I: clustered crystal shards
      const crystalGeo = this.shareGeo("cone", () => new THREE.ConeGeometry(0.55, 3.2, 5));
      const n = 2 + Math.floor(Math.random() * 3);
      for (let c = 0; c < n; c++) {
        const m = new THREE.Mesh(crystalGeo, mat);
        const s = 0.5 + Math.random() * 0.9;
        m.scale.set(s, s * (0.8 + Math.random() * 1.6), s);
        m.position.set((Math.random() - 0.5) * 1.6, m.scale.y * 1.4, (Math.random() - 0.5) * 1.6);
        m.rotation.set((Math.random() - 0.5) * 0.35, Math.random() * Math.PI, (Math.random() - 0.5) * 0.35);
        m.castShadow = true;
        group.add(m);
      }
    });
    this.dressings.spire = this.buildDressing(scene, (group, mat, dark) => {
      // Act II: tall glass pillars with glowing caps
      const pillarGeo = this.shareGeo("hex", () => new THREE.CylinderGeometry(0.42, 0.55, 1, 6));
      const capGeo = this.shareGeo("oct", () => new THREE.OctahedronGeometry(0.5));
      const n = 1 + Math.floor(Math.random() * 2);
      for (let c = 0; c < n; c++) {
        const h = 4.5 + Math.random() * 3.5;
        const pillar = new THREE.Mesh(pillarGeo, dark);
        pillar.scale.set(1, h, 1);
        pillar.position.set((Math.random() - 0.5) * 1.8, h / 2 - 0.4, (Math.random() - 0.5) * 1.8);
        pillar.rotation.y = Math.random() * Math.PI;
        pillar.castShadow = true;
        const cap = new THREE.Mesh(capGeo, mat);
        cap.position.set(pillar.position.x, h - 0.2, pillar.position.z);
        cap.rotation.y = Math.random() * Math.PI;
        group.add(pillar, cap);
      }
    });
    this.dressings.forge = this.buildDressing(scene, (group, mat, dark) => {
      // Act III: low jagged slag anvils with molten tips
      const slabGeo = this.shareGeo("slab", () => new THREE.BoxGeometry(1, 1, 1));
      const tipGeo = this.shareGeo("tip", () => new THREE.ConeGeometry(0.22, 1.0, 4));
      const n = 2 + Math.floor(Math.random() * 3);
      for (let c = 0; c < n; c++) {
        const slab = new THREE.Mesh(slabGeo, dark);
        slab.scale.set(0.9 + Math.random() * 1.3, 0.8 + Math.random() * 1.8, 0.9 + Math.random() * 1.3);
        slab.position.set((Math.random() - 0.5) * 2.2, slab.scale.y / 2 - 0.3, (Math.random() - 0.5) * 2.2);
        slab.rotation.set((Math.random() - 0.5) * 0.3, Math.random() * Math.PI, (Math.random() - 0.5) * 0.3);
        slab.castShadow = true;
        const tip = new THREE.Mesh(tipGeo, mat);
        tip.position.set(slab.position.x, slab.scale.y + 0.2, slab.position.z);
        tip.rotation.z = (Math.random() - 0.5) * 0.6;
        group.add(slab, tip);
      }
    });
    this.setDressing("rift");

    // --- Floating rocks drifting in the void
    const rockGeo = new THREE.IcosahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x15151f, roughness: 0.9, flatShading: true });
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(rockGeo, rockMat);
      const a = Math.random() * Math.PI * 2;
      const r = ARENA_RADIUS + 8 + Math.random() * 26;
      const y = -6 + Math.random() * 14;
      m.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      m.scale.setScalar(0.8 + Math.random() * 2.8);
      m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      scene.add(m);
      this.rocks.push({
        mesh: m,
        baseY: y,
        spin: (Math.random() - 0.5) * 0.25,
        bob: 0.4 + Math.random() * 0.8,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  private makeFloorTexture(): THREE.CanvasTexture {
    const size = 1024;
    const cv = document.createElement("canvas");
    cv.width = cv.height = size;
    const g = cv.getContext("2d")!;
    const c = size / 2;

    g.fillStyle = "#181b2e";
    g.fillRect(0, 0, size, size);

    // Subtle noise speckle
    for (let i = 0; i < 2600; i++) {
      const a = Math.random() * 0.05;
      g.fillStyle = `rgba(255,255,255,${a})`;
      g.fillRect(Math.random() * size, Math.random() * size, 1.5, 1.5);
    }

    // Concentric rings
    for (let r = 60; r < c; r += 74) {
      g.strokeStyle = `rgba(120, 200, 255, ${0.11 + (r === 60 ? 0.06 : 0)})`;
      g.lineWidth = r % 222 < 80 ? 2.5 : 1;
      g.beginPath();
      g.arc(c, c, r, 0, Math.PI * 2);
      g.stroke();
    }

    // Radial spokes
    g.strokeStyle = "rgba(120, 200, 255, 0.08)";
    g.lineWidth = 1;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * 70, c + Math.sin(a) * 70);
      g.lineTo(c + Math.cos(a) * c, c + Math.sin(a) * c);
      g.stroke();
    }

    // Central sigil — bright inner ring pair
    g.strokeStyle = "rgba(150, 220, 255, 0.16)";
    g.lineWidth = 3;
    g.beginPath();
    g.arc(c, c, 46, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(c, c, 34, 0, Math.PI * 2);
    g.stroke();

    // Edge glow band
    const grad = g.createRadialGradient(c, c, c * 0.82, c, c, c);
    grad.addColorStop(0, "rgba(80,160,255,0)");
    grad.addColorStop(0.92, "rgba(90,180,255,0.13)");
    grad.addColorStop(1, "rgba(120,210,255,0.25)");
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);

    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }

  applyTheme(theme: ArenaTheme, instant = false): void {
    this.fromTheme = instant ? theme : this.currentBlend();
    this.toTheme = theme;
    this.themeLerp = instant ? 1 : 0;
    this.blendSettled = false;
    // Silhouettes swap instantly — theme changes happen behind the spawn flash
    this.setDressing(theme.dressing);
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
    if (this.stage.scene.background instanceof THREE.Color) {
      this.stage.scene.background.copy(this.stage.fog.color);
    }
    this.mixTo(this.skyMat.uniforms.topColor.value as THREE.Color, f.skyTop, t.skyTop, k);
    this.mixTo(this.skyMat.uniforms.bottomColor.value as THREE.Color, f.skyBottom, t.skyBottom, k);
    this.mixTo(this.skyMat.uniforms.auroraColor.value as THREE.Color, f.ember, t.ember, k);
    this.mixTo(this.stage.hemiLight.color, f.hemiSky, t.hemiSky, k);
    this.mixTo(this.stage.hemiLight.groundColor, f.hemiGround, t.hemiGround, k);
    this.mixTo(this.stage.keyLight.color, f.key, t.key, k);
    this.mixTo(this.rimMat.emissive, f.rim, t.rim, k);
    this.mixTo(this.floorMat.emissive, f.gridEmissive, t.gridEmissive, k);
    if (this.crystalMats.length) {
      this.mixTo(this.crystalMats[0].emissive, f.crystal, t.crystal, k);
      for (let i = 1; i < this.crystalMats.length; i++) {
        this.crystalMats[i].emissive.copy(this.crystalMats[0].emissive);
      }
    }
  }

  update(dt: number): void {
    this.t += dt;
    this.skyMat.uniforms.uTime.value = this.t;

    if (this.themeLerp < 1) {
      this.themeLerp = Math.min(1, this.themeLerp + dt * 0.7);
      this.applyBlendColors();
      this.blendSettled = this.themeLerp >= 1;
    } else if (!this.blendSettled) {
      this.applyBlendColors();
      this.blendSettled = true;
    }

    // Breathing rim + crystals
    const breathe = 1.9 + Math.sin(this.t * 1.4) * 0.5;
    this.rimMat.emissiveIntensity = breathe;
    for (let i = 0; i < this.crystalMats.length; i++) {
      this.crystalMats[i].emissiveIntensity = 1.1 + Math.sin(this.t * 1.1 + i * 1.7) * 0.45;
    }

    for (const r of this.rocks) {
      r.mesh.rotation.y += r.spin * dt;
      r.mesh.position.y = r.baseY + Math.sin(this.t * 0.4 + r.phase) * r.bob;
    }
  }
}
