---
description: Scaffold a new enemy class with EnemyManager registration
argument-hint: [enemy-name-or-description]
---

# Add a new enemy

Enemies extend the `Enemy` base class, define their stats once as an `EnemyDef`, and implement `updateLogic(dt, player)` for AI behavior. The kind name routes through `EnemyManager.spawn()`.

User intent: $ARGUMENTS

## Step 1 — Create the type file

File: `game/src/enemies/types/<PascalName>.ts`

Skeleton:

```typescript
import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Enemy, EnemyDef } from "../Enemy";
import { Player } from "../../player/Player";

export const <UPPER>_DEF: EnemyDef = {
  name: "<lower_kind>",       // must match the EnemyKind literal
  hp: 30,
  speed: 3.0,
  radius: 0.55,
  contactDamage: 8,
  color: new Color3(0.7, 0.25, 0.25),
  aggroRange: 30,
};

export class <PascalName> extends Enemy {
  constructor(scene: Scene, shadow: ShadowGenerator, spawnPos: Vector3, idSuffix: string) {
    const body = MeshBuilder.CreateSphere(
      `<lower_kind>_${idSuffix}_body`,
      { diameter: <UPPER>_DEF.radius * 2, segments: 12 },
      scene,
    );
    body.position = new Vector3(0, <UPPER>_DEF.radius, 0);
    super(scene, shadow, <UPPER>_DEF, spawnPos, body, idSuffix);
    // (optional) addPart(...) for spikes / cores / cosmetic parts
  }

  updateLogic(dt: number, player: Player): void {
    if (!this.alive) return;
    this.tickCommon(dt);

    const dx = player.root.position.x - this.root.position.x;
    const dz = player.root.position.z - this.root.position.z;
    const distSq = dx * dx + dz * dz;
    const aggro = this.def.aggroRange;
    if (distSq > aggro * aggro) {
      this.state = "idle";
      return;
    }

    // State machine: idle → chase → telegraph → attack → recover.
    // See Chaser.ts (game/src/enemies/types/Chaser.ts) for a full reference.
  }
}
```

Conventions to match across existing types:
- AI uses **distance-squared comparisons**, not `Math.sqrt`, in tight loops.
- All enemies should **telegraph** before damaging — give the player a window to dodge. The Chaser draws a growing red ring during a 0.35s windup; the Caster draws a ground decal. Don't ship instant-damage contact.
- **Mutate Color3 in place** when flashing emissive — never allocate per frame (`this.material.emissiveColor.set(r, g, b)`, not `new Color3(...)`).
- Damage flows via `events.emit("DAMAGE_TAKEN", { amount, source: this.id })`; don't call `player.hp -=` directly.
- Override `dispose()` if you allocate scene meshes outside the body — call `super.dispose()` last.

Reference: `game/src/enemies/types/Chaser.ts` (telegraphed melee), `Shooter.ts` (ranged with `HostileProjectileSystem`), `Elite.ts` (armored charger).

## Step 2 — Register in EnemyManager

File: `game/src/enemies/EnemyManager.ts`

1. Add the import at the top: `import { <PascalName> } from "./types/<PascalName>";`
2. Add the kind literal to the `EnemyKind` union (lines 21–24).
3. Add a `case` in `spawn()` (around line 59):

```typescript
case "<lower_kind>":
  e = new <PascalName>(this.scene, this.shadow, pos, id);
  break;
```

If your enemy fires projectiles, take `this.hostileProjectiles` in the constructor too — see the Shooter case (line 64) for the pattern.

## Step 3 — Use it in a room (optional)

File: `game/src/run/RunManager.ts`

Reference the new kind in any `RoomDescriptor.spawns`:

```typescript
{ kind: "<lower_kind>", pos: new Vector3(8, 0, 6) },
```

## Step 4 — Verify

```
(cd /e/Storage/SAAS/Rogue-Hero-3/game && npm run verify)
```

The TypeScript exhaustiveness check on `EnemyKind` (the `never` branch in `spawn()`) will fail at compile time if the union and the switch drift. The integration test will catch runtime wiring issues.
