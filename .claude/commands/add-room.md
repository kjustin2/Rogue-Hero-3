---
description: Append a new room to ACT_ROOMS with arena + spawns
argument-hint: [room-name-or-description]
---

# Add a new room

A room is a `RoomDescriptor` in `ACT_ROOMS`. It defines the arena (size, palette, pillars), the spawn list, optional hazards, and whether it's a boss room.

User intent: $ARGUMENTS

## Step 1 — Append the RoomDescriptor

File: `game/src/run/RunManager.ts`

`RoomDescriptor` shape (lines 9–17):
```typescript
{
  name: string;
  arena: ArenaOptions;
  spawns: SpawnRequest[];
  hazards?: HazardTileSpec[];
  isBoss?: boolean;   // boss rooms get a card reward instead of a relic + intro phase
}
```

`ArenaOptions` controls the arena geometry and look. Common fields:
- `size` (meters, square)
- `wallHeight`
- `pillarCount` + `pillarFormation` — `"scatter" | "rows" | "ring"` (or 0 pillars for boss arenas)
- `paletteFloor`, `paletteWall`, `palettePillar` — `Color3` per act
- `paletteCeiling` (optional override; default uses wall palette)
- `envPalette` — controls grass / rocks / mushrooms / sky / motes
- `rngSeed` — deterministic placement; pick a unique seed per room
- `ceiling: true` — closed-off arena (set false for open-sky)
- `exitDoor: true` — animated exit when room clears

`SpawnRequest`: `{ kind: EnemyKind, pos: Vector3 }`. Kinds: `chaser | shooter | caster | elite | leaper | swarmer | lancer | wisp | boss_brawler | boss_spire_caster | boss_colossus`.

## Step 2 — Match the act palette

`ACT_ROOMS` is laid out as 3 acts × 3 rooms (2 fights + 1 boss). Reuse the existing constants:

| Act | Floor / Wall / Pillar | Env |
|---|---|---|
| **Verdant** (rooms 0–2) | `VERDANT_FLOOR` / `VERDANT_WALL` / `VERDANT_PILLAR` | `VERDANT_ENV_PALETTE` |
| **Spire** (rooms 3–5) | `SPIRE_FLOOR` / `SPIRE_WALL` / `SPIRE_PILLAR` | `SPIRE_ENV` |
| **Magma** (rooms 6–8) | `MAGMA_FLOOR` / `MAGMA_WALL` / `MAGMA_PILLAR` | `MAGMA_ENV` |

If you're inserting a room mid-act, keep the act's palette consistent — the player relies on the visual signature to read "this is still Act II". A new act needs its own palette block at the top of the file, following the existing pattern.

## Step 3 — Boss rooms

Set `isBoss: true` and use a single boss spawn:

```typescript
{ kind: "boss_brawler", pos: new Vector3(0, 0, -18) },
```

Boss rooms: trigger `BOSS_INTRO_START` (camera orbit + banner), reward a new card instead of a relic, and on phase 2 may spawn adds via the `BOSS_PHASE` event listener in `main.ts`.

## Step 4 — Verify

```
(cd /e/Storage/SAAS/Rogue-Hero-3/game && npm run verify)
```

The integration test plays through the full `ACT_ROOMS` list — if a spawn position is off-arena or a kind reference is broken, it'll surface there.

## Reference: Verdant Approach (Room 0)

```typescript
{
  name: "Verdant Approach",
  arena: {
    size: 40, wallHeight: 10, pillarCount: 4,
    pillarFormation: "scatter",
    paletteFloor: VERDANT_FLOOR, paletteWall: VERDANT_WALL, palettePillar: VERDANT_PILLAR,
    envPalette: VERDANT_ENV_PALETTE, rngSeed: 1337, ceiling: true, exitDoor: true,
  },
  spawns: [
    { kind: "chaser", pos: new Vector3(8, 0, 6) },
    { kind: "chaser", pos: new Vector3(-7, 0, 5) },
    { kind: "chaser", pos: new Vector3(0, 0, -10) },
  ],
},
```
