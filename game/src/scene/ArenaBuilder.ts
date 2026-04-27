import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { buildEnvironment, EnvBundle, EnvPalette } from "./Environment";

export interface Door {
  /** The plank mesh that visually fills the doorway when locked. */
  mesh: Mesh;
  /** Trim around the opening — purely cosmetic. */
  frame: Mesh;
  /** The threshold Z plane on the -Z wall (doorway lives here). */
  zPlane: number;
  /** X-range of the open passage. */
  xMin: number;
  xMax: number;
  /** Animate the door open + flip the unlocked state (emissive on, mesh slides up). */
  setLocked(locked: boolean): void;
  isLocked(): boolean;
  /** Per-frame animation tick so the door can lerp open after unlock. */
  tick(dt: number): void;
}

export interface DoorPass {
  active: boolean;
  xMin: number;
  xMax: number;
}

export interface Arena {
  root: Mesh;
  floor: Mesh;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  pillars: Mesh[];
  env: EnvBundle | null;
  /** Ceiling slab if the arena was built enclosed; null otherwise. */
  ceiling: Mesh | null;
  /** Exit door on the -Z wall if the arena has one; null for the final room. */
  door: Door | null;
  /** Mutable bound override allowing the player to step past minZ when active. */
  doorPass: DoorPass;
  dispose(): void;
}

export interface ArenaOptions {
  size?: number;            // floor side length, meters
  wallHeight?: number;
  pillarCount?: number;
  paletteFloor?: Color3;
  paletteWall?: Color3;
  palettePillar?: Color3;
  paletteCeiling?: Color3;
  /** Optional env palette — when omitted, a Verdant default is used. */
  envPalette?: EnvPalette;
  rngSeed?: number;
  /** When true (default), build a stone ceiling on top of the walls. */
  ceiling?: boolean;
  /** When true (default), cut a doorway opening into the south (-Z) wall and
   *  attach a Door mesh that can be unlocked on room clear. */
  exitDoor?: boolean;
  /**
   * Layout pattern for the pillars. "scatter" (default) keeps the existing
   * RNG placement; "ring" wraps them around the player's spawn-side; "rows"
   * lines them down the centerline; "throne_back" hugs them against the
   * north wall to frame an elevated boss platform.
   */
  pillarFormation?: "scatter" | "ring" | "rows" | "throne_back";
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

// Doorway opening dimensions on the -Z wall — kept as constants so PlayerController
// and main.ts can reference the same canonical width when wiring the trigger zone.
export const DOOR_OPENING_WIDTH = 3.5;
export const DOOR_OPENING_HEIGHT = 4.5;

export function buildArena(scene: Scene, shadow: ShadowGenerator, opts: ArenaOptions = {}): Arena {
  const size = opts.size ?? 40;
  const half = size / 2;
  const wallHeight = opts.wallHeight ?? 4;
  const pillarCount = opts.pillarCount ?? 0;
  const buildCeiling = opts.ceiling !== false;
  const buildExitDoor = opts.exitDoor !== false;

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
  // Floor never moves — freeze the world matrix so Babylon skips recomputation
  // (same treatment as walls/pillars below). doNotSyncBoundingInfo is safe too
  // since the floor never deforms or reparents.
  floor.freezeWorldMatrix();
  floor.doNotSyncBoundingInfo = true;

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
  makeWall("wallE", wallThickness, size, half + wallThickness / 2, 0);
  makeWall("wallW", wallThickness, size, -half - wallThickness / 2, 0);

  // South wall — when the room has an exit door, split it into two side
  // segments + a lintel above the opening. Otherwise build a solid box like
  // the other walls. The doorway sits centered on x=0.
  const southZ = -half - wallThickness / 2;
  if (buildExitDoor) {
    const opening = DOOR_OPENING_WIDTH;
    const lintelStart = DOOR_OPENING_HEIGHT;
    const sideWallW = (size + wallThickness * 2 - opening) / 2;
    const totalW = size + wallThickness * 2;
    // Left segment: from -totalW/2 to -opening/2.
    const leftCenter = -totalW / 2 + sideWallW / 2;
    makeWall("wallS_left", sideWallW, wallThickness, leftCenter, southZ);
    // Right segment: from +opening/2 to +totalW/2.
    const rightCenter = totalW / 2 - sideWallW / 2;
    makeWall("wallS_right", sideWallW, wallThickness, rightCenter, southZ);
    // Lintel — spans the opening above the door, sits between DOOR_OPENING_HEIGHT
    // and wallHeight. We build it as a separate makeWall variant inline since the
    // shared helper places centered at wallHeight/2.
    if (wallHeight > lintelStart) {
      const lintelH = wallHeight - lintelStart;
      const lintel = MeshBuilder.CreateBox(
        "wallS_lintel",
        { width: opening, height: lintelH, depth: wallThickness },
        scene,
      );
      lintel.position = new Vector3(0, lintelStart + lintelH / 2, southZ);
      lintel.material = wallMat;
      lintel.receiveShadows = true;
      lintel.checkCollisions = true;
      lintel.parent = root;
      lintel.doNotSyncBoundingInfo = true;
      lintel.freezeWorldMatrix();
      shadow.addShadowCaster(lintel);
    }
  } else {
    makeWall("wallS", size + wallThickness * 2, wallThickness, 0, southZ);
  }

  // Pillars
  const pillars: Mesh[] = [];
  if (pillarCount > 0) {
    const pillarMat = new StandardMaterial("pillarMat", scene);
    pillarMat.diffuseColor = opts.palettePillar ?? new Color3(0.35, 0.32, 0.28);
    pillarMat.specularColor = new Color3(0.08, 0.08, 0.08);

    const rng = opts.rngSeed != null ? makeMulberry(opts.rngSeed) : Math.random;
    const safeRadius = half - 4;
    const formation = opts.pillarFormation ?? "scatter";
    const positions: { x: number; z: number }[] = [];
    if (formation === "scatter") {
      for (let i = 0; i < pillarCount; i++) {
        positions.push({
          x: (rng() * 2 - 1) * safeRadius,
          z: (rng() * 2 - 1) * safeRadius,
        });
      }
    } else if (formation === "ring") {
      // Even ring centered on the arena, radius safeRadius * 0.7.
      const r = safeRadius * 0.7;
      for (let i = 0; i < pillarCount; i++) {
        const a = (i / pillarCount) * Math.PI * 2;
        positions.push({ x: Math.cos(a) * r, z: Math.sin(a) * r });
      }
    } else if (formation === "rows") {
      // Two parallel rows running North-South, splitting the arena into a hall.
      const rowsX = [-safeRadius * 0.45, safeRadius * 0.45];
      const perRow = Math.ceil(pillarCount / 2);
      const span = safeRadius * 1.4;
      for (let i = 0; i < pillarCount; i++) {
        const x = rowsX[i % 2];
        const t = (Math.floor(i / 2)) / Math.max(1, perRow - 1);
        positions.push({ x, z: -span / 2 + t * span });
      }
    } else if (formation === "throne_back") {
      // Curved row hugging the north (-Z) wall — frames an elevated platform.
      const arc = Math.PI * 0.55;
      const start = -arc / 2;
      const r = safeRadius * 0.85;
      for (let i = 0; i < pillarCount; i++) {
        const t = pillarCount === 1 ? 0.5 : i / (pillarCount - 1);
        const a = start + t * arc + Math.PI; // shift to point toward -Z
        positions.push({ x: Math.cos(a) * r, z: Math.sin(a) * r * 0.6 - safeRadius * 0.3 });
      }
    }

    for (let i = 0; i < positions.length; i++) {
      const { x: px, z: pz } = positions[i];
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

  // Ceiling — a single thin slab on top of the walls. Not a shadow caster
  // (would tank perf with no visible gain since the sun shines down through
  // it onto a mesh nobody sees from above), and receiveShadows off because
  // the floor below is the only surface that needs them.
  let ceiling: Mesh | null = null;
  if (buildCeiling) {
    ceiling = MeshBuilder.CreateBox(
      "ceiling",
      { width: size + wallThickness * 2, height: 0.5, depth: size + wallThickness * 2 },
      scene,
    );
    ceiling.position = new Vector3(0, wallHeight + 0.25, 0);
    const ceilingMat = new StandardMaterial("ceilingMat", scene);
    ceilingMat.diffuseColor = opts.paletteCeiling ?? new Color3(0.18, 0.16, 0.14);
    ceilingMat.specularColor = new Color3(0.04, 0.04, 0.04);
    ceiling.material = ceilingMat;
    ceiling.receiveShadows = false;
    // checkCollisions on so the orbit camera can't pop above the roof at
    // extreme pitch — same treatment we already use on walls.
    ceiling.checkCollisions = true;
    ceiling.parent = root;
    ceiling.doNotSyncBoundingInfo = true;
    ceiling.freezeWorldMatrix();
    ceilingMat.freeze();
  }

  // Door — the visible plank that fills the opening while locked. Slides up
  // into the lintel when unlocked. Only built when exitDoor is enabled.
  let door: Door | null = null;
  if (buildExitDoor) {
    const opening = DOOR_OPENING_WIDTH;
    const doorH = DOOR_OPENING_HEIGHT - 0.2;
    const doorMesh = MeshBuilder.CreateBox(
      "doorPlank",
      { width: opening - 0.1, height: doorH, depth: 0.18 },
      scene,
    );
    const closedY = doorH / 2 + 0.05;
    doorMesh.position = new Vector3(0, closedY, southZ);
    const doorMat = new StandardMaterial("doorMat", scene);
    doorMat.diffuseColor = new Color3(0.32, 0.20, 0.10);
    doorMat.specularColor = new Color3(0.08, 0.06, 0.04);
    doorMat.emissiveColor = new Color3(0, 0, 0);
    doorMesh.material = doorMat;
    doorMesh.receiveShadows = true;
    doorMesh.checkCollisions = true;
    doorMesh.parent = root;
    doorMesh.doNotSyncBoundingInfo = true;
    shadow.addShadowCaster(doorMesh);

    // Frame — a thin bright trim around the opening so the door reads even
    // before unlock. One narrow box per side; merged would be cheaper but
    // three boxes is already negligible for a single arena.
    const frameThickness = 0.18;
    const sideHeight = DOOR_OPENING_HEIGHT;
    const frameMat = new StandardMaterial("doorFrameMat", scene);
    frameMat.diffuseColor = new Color3(0.45, 0.36, 0.22);
    frameMat.emissiveColor = new Color3(0.05, 0.04, 0.02);
    frameMat.specularColor = new Color3(0.05, 0.05, 0.05);
    const frameLeft = MeshBuilder.CreateBox(
      "doorFrameL",
      { width: frameThickness, height: sideHeight, depth: 0.4 },
      scene,
    );
    frameLeft.position = new Vector3(-opening / 2 - frameThickness / 2, sideHeight / 2, southZ);
    frameLeft.material = frameMat;
    frameLeft.parent = root;
    frameLeft.checkCollisions = true;
    frameLeft.freezeWorldMatrix();
    frameLeft.doNotSyncBoundingInfo = true;
    const frameRight = MeshBuilder.CreateBox(
      "doorFrameR",
      { width: frameThickness, height: sideHeight, depth: 0.4 },
      scene,
    );
    frameRight.position = new Vector3(opening / 2 + frameThickness / 2, sideHeight / 2, southZ);
    frameRight.material = frameMat;
    frameRight.parent = root;
    frameRight.checkCollisions = true;
    frameRight.freezeWorldMatrix();
    frameRight.doNotSyncBoundingInfo = true;
    const frameTop = MeshBuilder.CreateBox(
      "doorFrameT",
      { width: opening + frameThickness * 2, height: frameThickness, depth: 0.4 },
      scene,
    );
    frameTop.position = new Vector3(0, sideHeight + frameThickness / 2, southZ);
    frameTop.material = frameMat;
    frameTop.parent = root;
    frameTop.freezeWorldMatrix();
    frameTop.doNotSyncBoundingInfo = true;
    shadow.addShadowCaster(frameLeft);
    shadow.addShadowCaster(frameRight);
    shadow.addShadowCaster(frameTop);
    frameMat.freeze();

    // Light shaft — a faint warm vertical "beam" inside the doorway, made
    // visible only when the door unlocks. Single emissive plane, billboarded
    // so it always reads from the player's POV. Hidden until setLocked(false).
    const shaft = MeshBuilder.CreatePlane(
      "doorShaft",
      { width: opening * 0.85, height: DOOR_OPENING_HEIGHT * 1.1, sideOrientation: Mesh.DOUBLESIDE },
      scene,
    );
    shaft.position = new Vector3(0, DOOR_OPENING_HEIGHT * 0.55, southZ - 0.05);
    const shaftMat = new StandardMaterial("doorShaftMat", scene);
    shaftMat.disableLighting = true;
    shaftMat.emissiveColor = new Color3(1.0, 0.78, 0.35);
    shaftMat.diffuseColor = new Color3(0, 0, 0);
    shaftMat.alpha = 0;
    shaftMat.alphaMode = 1; // ALPHA_ADD
    shaft.material = shaftMat;
    shaft.applyFog = false;
    shaft.isPickable = false;
    shaft.parent = root;
    shaft.doNotSyncBoundingInfo = true;

    // Dust mote particle system — drifts upward inside the doorway when open.
    // Reuse a soft white sprite procedurally so we don't ship a texture file.
    let dustTex: Texture;
    {
      const dt = new DynamicTexture("doorDustTex", { width: 16, height: 16 }, scene, false);
      const ctx = dt.getContext();
      const grad = ctx.createRadialGradient(8, 8, 0.5, 8, 8, 7);
      grad.addColorStop(0, "rgba(255,240,200,1)");
      grad.addColorStop(1, "rgba(255,240,200,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 16, 16);
      dt.update();
      dt.hasAlpha = true;
      dustTex = dt;
    }
    const dust = new ParticleSystem("doorDust", 50, scene);
    dust.particleTexture = dustTex;
    dust.emitter = new Vector3(0, 0.2, southZ);
    dust.minEmitBox = new Vector3(-opening / 2 + 0.4, 0, -0.1);
    dust.maxEmitBox = new Vector3(opening / 2 - 0.4, 0.4, 0.2);
    dust.color1 = new Color4(1.0, 0.85, 0.55, 0.7);
    dust.color2 = new Color4(0.95, 0.75, 0.45, 0.5);
    dust.colorDead = new Color4(0.9, 0.7, 0.4, 0);
    dust.minSize = 0.04;
    dust.maxSize = 0.10;
    dust.minLifeTime = 1.8;
    dust.maxLifeTime = 3.4;
    dust.emitRate = 0; // off until door unlocks
    dust.gravity = new Vector3(0, 0.4, 0);
    dust.direction1 = new Vector3(-0.1, 0.2, -0.05);
    dust.direction2 = new Vector3(0.1, 0.5, 0.05);
    dust.minEmitPower = 0.05;
    dust.maxEmitPower = 0.2;
    dust.blendMode = ParticleSystem.BLENDMODE_ADD;
    dust.start();

    // Bundle into one container so we can add controls + share state.
    let locked = true;
    let openProgress = 0; // 0 = closed, 1 = fully retracted
    let shaftTargetAlpha = 0;
    const openTargetY = closedY + doorH + 0.2; // slid up into the lintel
    door = {
      mesh: doorMesh,
      frame: frameTop,
      zPlane: southZ,
      xMin: -opening / 2,
      xMax: opening / 2,
      setLocked(b: boolean) {
        locked = b;
        if (!b) {
          // Glowing rune effect — emissive ramps up while the door slides open.
          doorMat.emissiveColor = new Color3(0.85, 0.55, 0.20);
          // Beam fades in to ~0.65 over the door slide; dust starts emitting.
          shaftTargetAlpha = 0.65;
          dust.emitRate = 18;
        } else {
          doorMat.emissiveColor = new Color3(0, 0, 0);
          openProgress = 0;
          doorMesh.position.y = closedY;
          doorMesh.checkCollisions = true;
          shaftTargetAlpha = 0;
          dust.emitRate = 0;
        }
      },
      isLocked() { return locked; },
      tick(dt: number) {
        if (!locked && openProgress < 1) {
          openProgress = Math.min(1, openProgress + dt * 1.2);
          // Ease-out so the slide settles softly into the lintel.
          const eased = 1 - (1 - openProgress) * (1 - openProgress);
          doorMesh.position.y = closedY + (openTargetY - closedY) * eased;
          if (openProgress >= 0.6) doorMesh.checkCollisions = false;
        }
        // Lerp shaft alpha — fades in/out over ~0.5s, with a slight breathing
        // pulse on top so the light feels alive instead of static.
        const breath = 0.85 + 0.15 * Math.sin(performance.now() * 0.003);
        const target = shaftTargetAlpha * breath;
        shaftMat.alpha += (target - shaftMat.alpha) * Math.min(1, dt * 4);
      },
    };

    // Solid black slab behind the door. Without this the camera can drift
    // close enough to the doorway that it sees past the thin (0.18m) plank
    // and into the void outside the south wall. The slab fills that gap so
    // the unlocked doorway reads as a dark recess, not skybox.
    const backSlab = MeshBuilder.CreateBox(
      "doorBackSlab",
      {
        width: opening + frameThickness * 2 + 0.4,
        height: DOOR_OPENING_HEIGHT + 1.0,
        depth: 0.3,
      },
      scene,
    );
    backSlab.position = new Vector3(0, (DOOR_OPENING_HEIGHT + 1.0) / 2, southZ - 0.6);
    const slabMat = new StandardMaterial("doorBackSlabMat", scene);
    slabMat.diffuseColor = new Color3(0.02, 0.02, 0.02);
    slabMat.specularColor = new Color3(0, 0, 0);
    slabMat.emissiveColor = new Color3(0, 0, 0);
    backSlab.material = slabMat;
    backSlab.parent = root;
    backSlab.applyFog = true;
    backSlab.isPickable = false;
    backSlab.freezeWorldMatrix();
    backSlab.doNotSyncBoundingInfo = true;
    slabMat.freeze();
  }

  // Wall sconces — emissive billboards near the top of each side wall to give
  // the enclosed rooms a warm interior glow without adding real lights (which
  // would force a shadow-map rebuild + cost a draw call). Pure additive
  // sprites; they don't illuminate anything but they read as torches.
  if (buildCeiling) {
    const sconceMat = new StandardMaterial("sconceMat", scene);
    sconceMat.disableLighting = true;
    sconceMat.emissiveColor = new Color3(1.0, 0.55, 0.18);
    sconceMat.diffuseColor = new Color3(0, 0, 0);
    sconceMat.alpha = 0.85;
    sconceMat.alphaMode = 1; // ALPHA_ADD
    const sconceY = wallHeight - 1.6;
    // 6 sconces: 2 on each side wall (E/W), 2 on the north wall.
    type Sconce = { x: number; z: number };
    const placements: Sconce[] = [
      { x: half - 0.6, z: -half / 2 + 2 },
      { x: half - 0.6, z: half / 2 - 2 },
      { x: -half + 0.6, z: -half / 2 + 2 },
      { x: -half + 0.6, z: half / 2 - 2 },
      { x: -half / 3, z: half - 0.6 },
      { x: half / 3, z: half - 0.6 },
    ];
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      const sconce = MeshBuilder.CreatePlane(
        `sconce_${i}`,
        { size: 0.9, sideOrientation: Mesh.DOUBLESIDE },
        scene,
      );
      sconce.position.set(p.x, sconceY, p.z);
      sconce.material = sconceMat;
      sconce.billboardMode = Mesh.BILLBOARDMODE_ALL;
      sconce.applyFog = false;
      sconce.isPickable = false;
      sconce.parent = root;
      sconce.doNotSyncBoundingInfo = true;
    }
    sconceMat.freeze();
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
    { wallHeight, enclosed: buildCeiling },
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
    ceiling,
    door,
    doorPass: { active: false, xMin: door ? door.xMin : 0, xMax: door ? door.xMax : 0 },
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
