import * as THREE from "three";
import type { Stage } from "./stage";

export const ARENA_RADIUS = 19;

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
}

export const THEMES: Record<string, ArenaTheme> = {
  rift: {
    name: "rift",
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
  private crystals: THREE.Group[] = [];
  private t = 0;
  private themeLerp = 1;
  private fromTheme: ArenaTheme = THEMES.rift;
  private toTheme: ArenaTheme = THEMES.rift;

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
        uniform float uTime;
        varying vec3 vPos;
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        void main() {
          float h = normalize(vPos).y * 0.5 + 0.5;
          vec3 col = mix(bottomColor, topColor, pow(h, 0.65));
          // Star field above the horizon
          vec2 sp = normalize(vPos).xz / max(0.12, normalize(vPos).y + 0.25) * 28.0;
          vec2 cell = floor(sp);
          float star = step(0.985, hash(cell));
          float tw = 0.5 + 0.5 * sin(uTime * (1.0 + hash(cell + 7.0) * 3.0) + hash(cell) * 50.0);
          col += vec3(0.9, 0.95, 1.0) * star * tw * smoothstep(0.0, 0.35, h) * 0.5;
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

    // --- Crystal monoliths around the edge
    const crystalGeo = new THREE.ConeGeometry(0.55, 3.2, 5);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.31;
      const group = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({
        color: 0x0a1420,
        emissive: new THREE.Color(THEMES.rift.crystal),
        emissiveIntensity: 1.3,
        roughness: 0.25,
        metalness: 0.1,
        flatShading: true,
      });
      this.crystalMats.push(mat);
      const n = 2 + (i % 3);
      for (let c = 0; c < n; c++) {
        const m = new THREE.Mesh(crystalGeo, mat);
        const s = 0.5 + Math.random() * 0.9;
        m.scale.set(s, s * (0.8 + Math.random() * 1.6), s);
        m.position.set((Math.random() - 0.5) * 1.6, m.scale.y * 1.4, (Math.random() - 0.5) * 1.6);
        m.rotation.set((Math.random() - 0.5) * 0.35, Math.random() * Math.PI, (Math.random() - 0.5) * 0.35);
        m.castShadow = true;
        group.add(m);
      }
      const r = ARENA_RADIUS + 2.6;
      group.position.set(Math.cos(a) * r, -0.4, Math.sin(a) * r);
      scene.add(group);
      this.crystals.push(group);
    }

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
  }

  private currentBlend(): ArenaTheme {
    const k = this.themeLerp;
    const mix = (a: number, b: number) =>
      new THREE.Color(a).lerp(new THREE.Color(b), k).getHex();
    const f = this.fromTheme;
    const t = this.toTheme;
    return {
      name: t.name,
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

  update(dt: number): void {
    this.t += dt;
    if (this.themeLerp < 1) this.themeLerp = Math.min(1, this.themeLerp + dt * 0.7);
    const b = this.currentBlend();

    this.stage.fog.color.set(b.fog);
    this.stage.scene.background = new THREE.Color(b.fog);
    (this.skyMat.uniforms.topColor.value as THREE.Color).set(b.skyTop);
    (this.skyMat.uniforms.bottomColor.value as THREE.Color).set(b.skyBottom);
    this.skyMat.uniforms.uTime.value = this.t;
    this.stage.hemiLight.color.set(b.hemiSky);
    this.stage.hemiLight.groundColor.set(b.hemiGround);
    this.stage.keyLight.color.set(b.key);
    this.rimMat.emissive.set(b.rim);
    this.floorMat.emissive.set(b.gridEmissive);
    for (const m of this.crystalMats) m.emissive.set(b.crystal);

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
