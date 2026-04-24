import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { GPUParticleSystem } from "@babylonjs/core/Particles/gpuParticleSystem";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { getQuality } from "../engine/Quality";

/**
 * Environment decoration layer — grass, rocks, mushrooms, vines, sky, mountains,
 * and ambient motes. Built as a single bundle so the arena can dispose the whole
 * thing on room transition.
 *
 * Perf strategy:
 *  - Props: one "master" mesh per prop type (grass/rock/etc), invisible, disabled
 *    from the draw list. Instances of that master are placed around the arena.
 *    Babylon batches instances into a single draw call per master.
 *  - Static instances have their world matrices frozen (freezeWorldMatrix) so
 *    we don't recompute them every frame.
 *  - Motes use a GPU particle system when available, falling back to CPU.
 *  - Sky + mountains are single meshes with frozen matrices.
 */

export interface EnvBundle {
  /** Root node — dispose to take everything down. */
  root: Mesh;
  motes: ParticleSystem | GPUParticleSystem;
  /** Per-frame tick for subtle wind animation on grass + other living props. */
  tick(dt: number): void;
  dispose(): void;
}

export interface EnvPalette {
  grass: Color3;
  grassTip: Color3;
  rock: Color3;
  mushroomCap: Color3;
  mushroomStem: Color3;
  mountain: Color3;
  skyTop: Color3;
  skyBottom: Color3;
  /** Small warm motes (Verdant) vs ember motes (Pit). */
  moteColor: Color3;
  /** Count caps — higher = denser biome feel, but more draw prep. */
  grassCount: number;
  rockCount: number;
  mushroomCount: number;
}

/** Deterministic RNG so props lay out the same for a given seed. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x85ebca6b) >>> 0;
    t = t ^ (t >>> 13);
    t = Math.imul(t, 0xc2b2ae35) >>> 0;
    return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
  };
}

/**
 * Build the full environment decor for an arena. Called from the arena builder.
 * `arenaSize` is the playable floor side length; props place in an annulus around
 * the player area but inside the walls. `pillars` is needed so props don't overlap
 * them. Mountains sit well outside the walls.
 */
export function buildEnvironment(
  scene: Scene,
  arenaSize: number,
  pillars: Mesh[],
  palette: EnvPalette,
  seed: number,
): EnvBundle {
  const root = new Mesh("envRoot", scene);
  const rng = makeRng(seed);
  const half = arenaSize / 2;
  const q = getQuality();
  // Quality-scaled instance counts — low tier gets half the props, mote system
  // gets proportionally fewer emits. Floor() avoids fractional counts slipping
  // through to createInstance() loops.
  const grassCount = Math.floor(palette.grassCount * q.envDensity);
  const rockCount = Math.floor(palette.rockCount * q.envDensity);
  const mushroomCount = Math.floor(palette.mushroomCount * q.envDensity);

  // ---------- Skybox ----------
  // Large inverted sphere with per-vertex colour — a cheap gradient sky without
  // needing an HDR or cubemap. infiniteDistance keeps it following the camera so
  // the player can't escape it by running.
  const sky = MeshBuilder.CreateSphere("envSky", { diameter: 400, segments: 12, sideOrientation: Mesh.BACKSIDE }, scene);
  sky.infiniteDistance = true;
  sky.applyFog = false;
  sky.isPickable = false;
  const skyMat = new StandardMaterial("envSkyMat", scene);
  skyMat.disableLighting = true;
  skyMat.backFaceCulling = false;
  skyMat.emissiveColor = Color3.White();
  sky.material = skyMat;
  // Vertex-colour the sphere top→bottom with the palette gradient.
  const pos = sky.getVerticesData(VertexBuffer.PositionKind);
  if (pos) {
    const n = pos.length / 3;
    const colors = new Float32Array(n * 4);
    // Vertex Y ranges [-diameter/2, diameter/2] — normalize to [0,1] with 0 at bottom.
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const y = pos[i * 3 + 1];
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const span = maxY - minY || 1;
    for (let i = 0; i < n; i++) {
      const y = pos[i * 3 + 1];
      const t = (y - minY) / span; // 0=bottom, 1=top
      const r = palette.skyBottom.r + (palette.skyTop.r - palette.skyBottom.r) * t;
      const g = palette.skyBottom.g + (palette.skyTop.g - palette.skyBottom.g) * t;
      const b = palette.skyBottom.b + (palette.skyTop.b - palette.skyBottom.b) * t;
      colors[i * 4 + 0] = r;
      colors[i * 4 + 1] = g;
      colors[i * 4 + 2] = b;
      colors[i * 4 + 3] = 1;
    }
    sky.setVerticesData(VertexBuffer.ColorKind, colors);
    skyMat.emissiveColor = Color3.White();
    // Tell the standard material to use vertex colours for the "emissive" path.
    (skyMat as StandardMaterial).useEmissiveAsIllumination = false;
    sky.useVertexColors = true;
  }
  sky.parent = root;
  sky.freezeWorldMatrix();

  // ---------- Horizon silhouette ring ----------
  // A single mesh with an array of triangular "mountains" around the arena at a
  // radius well past the walls. One draw call for the whole horizon.
  const mountain = buildMountainRing(scene, half * 4, palette.mountain, rng);
  mountain.parent = root;
  mountain.freezeWorldMatrix();

  // ---------- Prop master meshes (hidden templates) ----------
  // Each master has its own material; instances share both geometry and material.
  // Grass is split across 4 masters with staggered animation phases so blades
  // sway out of unison — reads as a real breeze instead of a single heartbeat.
  // Cost is still O(4) per frame regardless of instance count, since instances
  // inherit the master's transform.
  const GRASS_GROUPS = 4;
  const grassMasters: Mesh[] = [];
  for (let g = 0; g < GRASS_GROUPS; g++) {
    const m = makeGrassTuft(scene, palette.grass, palette.grassTip);
    m.parent = root;
    m.isVisible = false;
    m.name = `grassMaster_${g}`;
    grassMasters.push(m);
  }

  const rockMaster = makeRock(scene, palette.rock);
  rockMaster.parent = root;
  rockMaster.isVisible = false;

  const mushroomMaster = makeMushroom(scene, palette.mushroomCap, palette.mushroomStem);
  mushroomMaster.parent = root;
  mushroomMaster.isVisible = false;

  // ---------- Place instances ----------
  // Avoid the center (player's main fighting area) and anywhere that overlaps a
  // pillar or the walls. Props live in a band roughly from r=3 to r=half-1.
  const innerSafe = 3.5;
  const outerSafe = half - 1.0;
  const pillarAvoidR = 1.6;

  function pickSpot(): Vector3 | null {
    // Rejection sample within arena bounds, with pillar avoidance.
    for (let tries = 0; tries < 8; tries++) {
      const angle = rng() * Math.PI * 2;
      const r = innerSafe + rng() * (outerSafe - innerSafe);
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      let clear = true;
      for (const p of pillars) {
        const ddx = x - p.position.x;
        const ddz = z - p.position.z;
        if (ddx * ddx + ddz * ddz < pillarAvoidR * pillarAvoidR) {
          clear = false;
          break;
        }
      }
      if (clear) return new Vector3(x, 0, z);
    }
    return null;
  }

  for (let i = 0; i < grassCount; i++) {
    const spot = pickSpot();
    if (!spot) continue;
    // Round-robin which group's master each blade inherits from. Combined
    // with each master's animation phase below, this breaks the unison sway.
    const groupMaster = grassMasters[i % GRASS_GROUPS];
    const inst = groupMaster.createInstance(`grass_i${i}`);
    inst.position.copyFrom(spot);
    inst.rotation.y = rng() * Math.PI * 2;
    const s = 0.6 + rng() * 0.9;
    inst.scaling.set(s, 0.4 + rng() * 0.7, s);
    inst.isPickable = false;
    inst.doNotSyncBoundingInfo = true;
    inst.freezeWorldMatrix();
    inst.parent = root;
  }

  for (let i = 0; i < rockCount; i++) {
    const spot = pickSpot();
    if (!spot) continue;
    const inst = rockMaster.createInstance(`rock_i${i}`);
    inst.position.copyFrom(spot);
    inst.position.y = 0;
    inst.rotation.y = rng() * Math.PI * 2;
    const s = 0.4 + rng() * 0.9;
    inst.scaling.set(s * 1.1, s * 0.65, s * 1.1);
    inst.isPickable = false;
    inst.doNotSyncBoundingInfo = true;
    inst.freezeWorldMatrix();
    inst.parent = root;
  }

  for (let i = 0; i < mushroomCount; i++) {
    const spot = pickSpot();
    if (!spot) continue;
    const inst = mushroomMaster.createInstance(`mush_i${i}`);
    inst.position.copyFrom(spot);
    inst.rotation.y = rng() * Math.PI * 2;
    const s = 0.7 + rng() * 0.6;
    inst.scaling.set(s, s, s);
    inst.isPickable = false;
    inst.doNotSyncBoundingInfo = true;
    inst.freezeWorldMatrix();
    inst.parent = root;
  }

  // Freeze the masters (rock + mushroom stay frozen). The grass master is
  // animated by the `tick` hook below for a gentle wind effect.
  rockMaster.freezeWorldMatrix();
  mushroomMaster.freezeWorldMatrix();

  // ---------- Ambient motes ----------
  // Try GPU particles first; some WebGL contexts (older mobile) will fall back.
  const motes = makeAmbientMotes(scene, arenaSize, palette.moteColor);
  motes.start();

  // Grass wind — animate each of the 4 grass masters with a phase-offset sine
  // wave so blades from different groups sway at different times. Adds a
  // low-frequency global gust on top so the whole field surges occasionally.
  // Cost: O(GRASS_GROUPS) = 4 transform writes per frame regardless of blade count.
  let grassClock = 0;
  function tick(dt: number): void {
    grassClock += dt;
    // Slow envelope — gentle "gust" that modulates the sway amplitude across
    // all groups. Two periods (a fast and a slow) layered for organic-feeling
    // wind without a single dominant frequency.
    const gust = 0.7 + 0.3 * Math.sin(grassClock * 0.27);
    for (let g = 0; g < GRASS_GROUPS; g++) {
      const phaseY = (g / GRASS_GROUPS) * Math.PI * 2;
      const phaseZ = phaseY + 0.7;
      const m = grassMasters[g];
      m.scaling.y = 1 + Math.sin(grassClock * 1.6 + phaseY) * 0.06 * gust;
      m.rotation.z = Math.sin(grassClock * 1.1 + phaseZ) * 0.07 * gust;
    }
    // Masters are intentionally NOT frozen — we mutate their transforms per frame.
  }

  return {
    root,
    motes,
    tick,
    dispose() {
      motes.stop();
      motes.dispose();
      // Instances and masters all parented to root — dispose the tree.
      root.getChildMeshes(false).forEach((m) => m.dispose());
      skyMat.dispose();
      root.dispose();
    },
  };
}

// -------------------- prop builders --------------------

function makeGrassTuft(scene: Scene, base: Color3, tip: Color3): Mesh {
  // Three thin rectangular blades crossing at the base. Merged into one mesh
  // so each instance draws in ~one GPU call across the batch.
  const blades: Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const blade = MeshBuilder.CreatePlane(
      `grassBlade_${i}`,
      { width: 0.12, height: 0.45, sideOrientation: Mesh.DOUBLESIDE },
      scene,
    );
    blade.position.set(0, 0.22, 0);
    blade.rotation.y = (i / 3) * Math.PI;
    blades.push(blade);
  }
  const merged = Mesh.MergeMeshes(blades, true, true, undefined, false, true);
  if (!merged) return blades[0];
  merged.name = "envGrassMaster";
  const mat = new StandardMaterial("envGrassMat", scene);
  // Slight emissive lift so the grass doesn't go pitch-black in shadowed areas.
  mat.diffuseColor = base.clone();
  mat.emissiveColor = tip.clone().scale(0.18);
  mat.specularColor = new Color3(0.02, 0.04, 0.02);
  mat.backFaceCulling = false;
  merged.material = mat;
  return merged;
}

function makeRock(scene: Scene, base: Color3): Mesh {
  const rock = MeshBuilder.CreatePolyhedron(
    "envRockMaster",
    { type: 1, size: 0.4 }, // icosahedron-ish
    scene,
  );
  const mat = new StandardMaterial("envRockMat", scene);
  mat.diffuseColor = base.clone();
  mat.specularColor = new Color3(0.08, 0.08, 0.08);
  rock.material = mat;
  return rock;
}

function makeMushroom(scene: Scene, cap: Color3, stem: Color3): Mesh {
  // Cap (hemisphere-ish) + stem (short cylinder) merged into one master.
  const capMesh = MeshBuilder.CreateSphere("mushCap", { diameter: 0.4, segments: 10, slice: 0.5 }, scene);
  capMesh.position.set(0, 0.32, 0);
  const stemMesh = MeshBuilder.CreateCylinder("mushStem", { diameter: 0.14, height: 0.34, tessellation: 10 }, scene);
  stemMesh.position.set(0, 0.17, 0);
  // Multi-material merging is heavy — we bake both colours into a single material
  // that uses vertex colour to differentiate cap vs stem. Simpler: tint by
  // vertex colour here.
  const capColor = new Color4(cap.r, cap.g, cap.b, 1);
  const stemColor = new Color4(stem.r, stem.g, stem.b, 1);
  const capVerts = capMesh.getTotalVertices();
  const stemVerts = stemMesh.getTotalVertices();
  const capColors = new Float32Array(capVerts * 4);
  for (let i = 0; i < capVerts; i++) { capColors[i * 4] = capColor.r; capColors[i * 4 + 1] = capColor.g; capColors[i * 4 + 2] = capColor.b; capColors[i * 4 + 3] = 1; }
  capMesh.setVerticesData(VertexBuffer.ColorKind, capColors);
  const stemColors = new Float32Array(stemVerts * 4);
  for (let i = 0; i < stemVerts; i++) { stemColors[i * 4] = stemColor.r; stemColors[i * 4 + 1] = stemColor.g; stemColors[i * 4 + 2] = stemColor.b; stemColors[i * 4 + 3] = 1; }
  stemMesh.setVerticesData(VertexBuffer.ColorKind, stemColors);

  const merged = Mesh.MergeMeshes([capMesh, stemMesh], true, true, undefined, false, true);
  if (!merged) return capMesh;
  merged.name = "envMushMaster";
  const mat = new StandardMaterial("envMushMat", scene);
  mat.diffuseColor = Color3.White();
  mat.specularColor = new Color3(0.05, 0.05, 0.05);
  merged.material = mat;
  merged.useVertexColors = true;
  return merged;
}

// -------------------- horizon --------------------

function buildMountainRing(scene: Scene, radius: number, color: Color3, rng: () => number): Mesh {
  // ~36 triangular mountains spaced around the arena at `radius`. Built as
  // individual triangle meshes then merged into one for a single draw call.
  const count = 36;
  const tris: Mesh[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + rng() * 0.1;
    const ox = Math.cos(angle) * radius;
    const oz = Math.sin(angle) * radius;
    const h = 18 + rng() * 24; // tall, far away
    const w = 14 + rng() * 12;
    // Isosceles triangle pointing up, facing the arena center.
    const tri = MeshBuilder.CreateDisc(
      `mt_${i}`,
      { radius: 1, tessellation: 3 },
      scene,
    );
    tri.rotation.x = -Math.PI / 2;
    tri.scaling.set(w * 0.6, h * 0.5, 1);
    // Disc builds in the XY plane — after rotation.x it lies on XZ. Rotate Y to
    // face the origin.
    tri.rotation.y = Math.atan2(-ox, -oz);
    tri.position.set(ox, h * 0.5 - 2, oz);
    tris.push(tri);
  }
  const merged = Mesh.MergeMeshes(tris, true, true, undefined, false, true);
  if (!merged) return tris[0];
  merged.name = "envMountains";
  const mat = new StandardMaterial("envMountainMat", scene);
  mat.diffuseColor = color.clone();
  mat.emissiveColor = color.clone().scale(0.25);
  mat.specularColor = new Color3(0, 0, 0);
  mat.backFaceCulling = false;
  merged.material = mat;
  merged.applyFog = true;
  merged.isPickable = false;
  return merged;
}

// -------------------- ambient motes --------------------

function makeAmbientMotes(scene: Scene, arenaSize: number, color: Color3): ParticleSystem | GPUParticleSystem {
  const q = getQuality();
  // Cap scales with quality — 56 on low, 112 on medium, 140 on high. Emit rate
  // follows below. The GPU-particle path is still preferred when available.
  const cap = Math.max(24, Math.floor(140 * q.moteDensity));
  const supportsGpu = GPUParticleSystem.IsSupported;
  const ps: ParticleSystem | GPUParticleSystem = supportsGpu
    ? new GPUParticleSystem("envMotes", { capacity: cap }, scene)
    : new ParticleSystem("envMotes", cap, scene);

  // Shared tiny soft-glow sprite — rebuilt if not already cached on the scene.
  const texKey = "__envMoteTex";
  // Using `any` because Scene has no typed slot for custom caches.
  const sceneAny = scene as unknown as { [k: string]: Texture };
  let tex = sceneAny[texKey];
  if (!tex) {
    const dt = new DynamicTexture("envMoteTex", { width: 32, height: 32 }, scene, false);
    const ctx = dt.getContext();
    const grad = ctx.createRadialGradient(16, 16, 1, 16, 16, 14);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);
    dt.update();
    sceneAny[texKey] = dt;
    tex = dt;
  }
  ps.particleTexture = tex;

  const half = arenaSize / 2;
  ps.emitter = new Vector3(0, 1.5, 0);
  ps.minEmitBox = new Vector3(-half, 0, -half);
  ps.maxEmitBox = new Vector3(half, 5, half);
  ps.color1 = new Color4(color.r, color.g, color.b, 0.75);
  ps.color2 = new Color4(color.r * 0.7, color.g * 0.7, color.b * 0.85, 0.45);
  ps.colorDead = new Color4(color.r, color.g, color.b, 0);
  ps.minSize = 0.04;
  ps.maxSize = 0.1;
  ps.minLifeTime = 3.5;
  ps.maxLifeTime = 7;
  ps.emitRate = Math.max(10, Math.floor(28 * q.moteDensity));
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  ps.gravity = new Vector3(0, 0.25, 0);
  ps.direction1 = new Vector3(-0.1, 0.15, -0.1);
  ps.direction2 = new Vector3(0.1, 0.35, 0.1);
  ps.minEmitPower = 0.1;
  ps.maxEmitPower = 0.4;
  ps.updateSpeed = 0.02;
  return ps;
}
