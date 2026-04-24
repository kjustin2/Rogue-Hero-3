import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { buildEnvironment, EnvBundle, EnvPalette } from "./Environment";

export interface Arena {
  root: Mesh;
  floor: Mesh;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  pillars: Mesh[];
  env: EnvBundle | null;
  dispose(): void;
}

export interface ArenaOptions {
  size?: number;            // floor side length, meters
  wallHeight?: number;
  pillarCount?: number;
  paletteFloor?: Color3;
  paletteWall?: Color3;
  palettePillar?: Color3;
  /** Optional env palette — when omitted, a Verdant default is used. */
  envPalette?: EnvPalette;
  rngSeed?: number;
}

/** Default env palette — verdant forest floor with warm horizon. Reused for all three rooms
 *  unless a room supplies its own. Boss arena typically wants a darker override. */
export const VERDANT_ENV_PALETTE: EnvPalette = {
  grass: new Color3(0.24, 0.48, 0.22),
  grassTip: new Color3(0.55, 0.8, 0.35),
  rock: new Color3(0.42, 0.40, 0.36),
  mushroomCap: new Color3(0.85, 0.25, 0.2),
  mushroomStem: new Color3(0.92, 0.88, 0.72),
  mountain: new Color3(0.22, 0.28, 0.35),
  skyTop: new Color3(0.38, 0.56, 0.82),
  skyBottom: new Color3(0.78, 0.72, 0.55),
  moteColor: new Color3(0.9, 1.0, 0.7),
  grassCount: 220,
  rockCount: 18,
  mushroomCount: 14,
};

export const PIT_ENV_PALETTE: EnvPalette = {
  grass: new Color3(0.14, 0.14, 0.10),
  grassTip: new Color3(0.35, 0.18, 0.10),
  rock: new Color3(0.14, 0.10, 0.08),
  mushroomCap: new Color3(0.35, 0.08, 0.04),
  mushroomStem: new Color3(0.22, 0.16, 0.12),
  mountain: new Color3(0.14, 0.08, 0.08),
  skyTop: new Color3(0.18, 0.08, 0.10),
  skyBottom: new Color3(0.42, 0.18, 0.08),
  moteColor: new Color3(1.0, 0.45, 0.2),
  grassCount: 90,
  rockCount: 34,
  mushroomCount: 2,
};

export function buildArena(scene: Scene, shadow: ShadowGenerator, opts: ArenaOptions = {}): Arena {
  const size = opts.size ?? 40;
  const half = size / 2;
  const wallHeight = opts.wallHeight ?? 4;
  const pillarCount = opts.pillarCount ?? 0;

  const root = new Mesh("arenaRoot", scene);

  // Floor
  const floor = MeshBuilder.CreateGround("arenaFloor", { width: size, height: size, subdivisions: 4 }, scene);
  const floorMat = new StandardMaterial("floorMat", scene);
  floorMat.diffuseColor = opts.paletteFloor ?? new Color3(0.18, 0.36, 0.20);
  floorMat.specularColor = new Color3(0.05, 0.05, 0.05);
  // Procedural biome texture — noise-mottled base color with the 1m grid baked
  // in as a subtle overlay. Gives the floor a "mossy" or "charred" feel while
  // preserving the spatial reference.
  const base = opts.paletteFloor ?? new Color3(0.18, 0.36, 0.20);
  const biomeTex = buildBiomeFloorTexture(scene, base, opts.rngSeed ?? 1337);
  biomeTex.wrapU = 1; // WRAP_ADDRESSMODE
  biomeTex.wrapV = 1;
  biomeTex.uScale = size / 4; // 4m per texture tile — balances detail vs reading the grid
  biomeTex.vScale = size / 4;
  floorMat.diffuseTexture = biomeTex;
  floor.material = floorMat;
  floor.receiveShadows = true;
  floor.parent = root;

  // Walls (4 boxes around floor)
  const wallMat = new StandardMaterial("wallMat", scene);
  wallMat.diffuseColor = opts.paletteWall ?? new Color3(0.22, 0.18, 0.14);
  wallMat.specularColor = new Color3(0.05, 0.05, 0.05);

  const wallThickness = 1;
  const makeWall = (name: string, w: number, d: number, x: number, z: number) => {
    const wall = MeshBuilder.CreateBox(name, { width: w, height: wallHeight, depth: d }, scene);
    wall.position = new Vector3(x, wallHeight / 2, z);
    wall.material = wallMat;
    wall.receiveShadows = true;
    wall.checkCollisions = true; // lets the ArcRotateCamera slide along arena walls
    wall.parent = root;
    wall.doNotSyncBoundingInfo = true;
    // Walls never move — freeze the world matrix so Babylon skips the recomputation.
    wall.freezeWorldMatrix();
    shadow.addShadowCaster(wall);
    return wall;
  };
  makeWall("wallN", size + wallThickness * 2, wallThickness, 0, half + wallThickness / 2);
  makeWall("wallS", size + wallThickness * 2, wallThickness, 0, -half - wallThickness / 2);
  makeWall("wallE", wallThickness, size, half + wallThickness / 2, 0);
  makeWall("wallW", wallThickness, size, -half - wallThickness / 2, 0);

  // Pillars
  const pillars: Mesh[] = [];
  if (pillarCount > 0) {
    const pillarMat = new StandardMaterial("pillarMat", scene);
    pillarMat.diffuseColor = opts.palettePillar ?? new Color3(0.35, 0.32, 0.28);
    pillarMat.specularColor = new Color3(0.08, 0.08, 0.08);

    // Simple seeded placement using opts.rngSeed if given, else Math.random
    const rng = opts.rngSeed != null ? makeMulberry(opts.rngSeed) : Math.random;
    const safeRadius = half - 4;
    for (let i = 0; i < pillarCount; i++) {
      const px = (rng() * 2 - 1) * safeRadius;
      const pz = (rng() * 2 - 1) * safeRadius;
      const pillar = MeshBuilder.CreateCylinder(`pillar_${i}`, { diameter: 1.6, height: wallHeight }, scene);
      pillar.position = new Vector3(px, wallHeight / 2, pz);
      pillar.material = pillarMat;
      pillar.receiveShadows = true;
      pillar.parent = root;
      pillar.doNotSyncBoundingInfo = true;
      pillar.freezeWorldMatrix();
      shadow.addShadowCaster(pillar);
      pillars.push(pillar);
    }
  }

  // Environment decor (grass/rocks/mushrooms/sky/mountains/motes) — placed around
  // the combat area and disposed with the arena. Uses instanced meshes + frozen
  // world matrices internally for minimal draw-call overhead.
  const env = buildEnvironment(
    scene,
    size,
    pillars,
    opts.envPalette ?? VERDANT_ENV_PALETTE,
    (opts.rngSeed ?? 1337) ^ 0x7f,
  );
  env.root.parent = root;

  // Freeze static material world state for a small render-loop win. Floor + walls
  // never change; the grid texture is already tiled via uScale/vScale. Pillars
  // share one material so freezing once is sufficient.
  floorMat.freeze();
  wallMat.freeze();
  // pillarMat only exists if we built any pillars — freeze via the first pillar's material.
  if (pillars.length > 0 && pillars[0].material) (pillars[0].material as StandardMaterial).freeze();

  return {
    root,
    floor,
    bounds: { minX: -half + 0.5, maxX: half - 0.5, minZ: -half + 0.5, maxZ: half - 0.5 },
    pillars,
    env,
    dispose() {
      env.dispose();
      // Dispose all descendants then root
      root.getChildMeshes(false).forEach((m) => m.dispose());
      root.dispose();
    },
  };
}

function makeMulberry(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Procedural biome floor texture — noise-mottled base color with a faint 1m
 * grid on top. One allocation per arena load, so the random per-pixel fill
 * cost is absorbed at boot rather than per frame.
 *
 * The noise is "value noise" — random spots smeared together with a blur —
 * not true Perlin, but cheap and looks organic at the resolution we use.
 */
function buildBiomeFloorTexture(scene: Scene, base: Color3, seed: number): DynamicTexture {
  const texSize = 256;
  const tex = new DynamicTexture("biomeFloorTex", { width: texSize, height: texSize }, scene, false);
  const ctx = tex.getContext();
  const rng = makeMulberry(seed);

  // Base fill — the palette color.
  const br = Math.round(base.r * 255);
  const bg = Math.round(base.g * 255);
  const bb = Math.round(base.b * 255);
  ctx.fillStyle = `rgb(${br},${bg},${bb})`;
  ctx.fillRect(0, 0, texSize, texSize);

  // Mottle — 400 translucent circles at random positions with small color perturbations.
  // Additive-ish bright/dark splotches break up the flat fill and read as moss / char.
  for (let i = 0; i < 400; i++) {
    const x = rng() * texSize;
    const y = rng() * texSize;
    const r = 4 + rng() * 14;
    const dark = rng() < 0.5;
    const amt = 0.18 + rng() * 0.22;
    const ir = Math.round(br * (dark ? 1 - amt : 1 + amt * 0.4));
    const ig = Math.round(bg * (dark ? 1 - amt : 1 + amt * 0.4));
    const ib = Math.round(bb * (dark ? 1 - amt : 1 + amt * 0.4));
    const a = 0.35 + rng() * 0.35;
    ctx.fillStyle = `rgba(${Math.max(0, Math.min(255, ir))},${Math.max(0, Math.min(255, ig))},${Math.max(0, Math.min(255, ib))},${a.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Faint 1m grid — 4 tiles across the texture map to 4m in world, so each
  // quarter of the texture is 1m. Draws at low alpha so it's a rhythmic hint,
  // not a dominant feature.
  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    const p = Math.round((i * texSize) / 4);
    ctx.beginPath();
    ctx.moveTo(p, 0); ctx.lineTo(p, texSize);
    ctx.moveTo(0, p); ctx.lineTo(texSize, p);
    ctx.stroke();
  }

  tex.update();
  return tex;
}
