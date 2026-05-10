---
description: Scaffold a new card following the CardDefinitions + CardCaster + UI pattern
argument-hint: [card-id-or-description]
---

# Add a new card

You are adding a new playable card to Rogue Hero 3. Cards are drafted into the player's hand each room and cast with LMB / 1–4 keys.

User intent: $ARGUMENTS

## Step 1 — Add the CardDef entry

File: `game/src/deck/CardDefinitions.ts`

The `CardDef` interface (lines 19–42) defines the card. Required fields:
- `id` (string, snake_case, must be unique in the `CardDefinitions` record)
- `name` (display string)
- `cost` (AP cost, integer)
- `tempoShift` (added to Tempo on cast — usually 4–10)
- `damage`
- `range` (meters; arc reach for melee, projectile travel, dash distance)
- `type` — one of `"melee" | "projectile" | "dash" | "aoe" | "aerial" | "utility"`
- `rarity` — `"common" | "uncommon" | "rare"`
- `desc` (short tooltip — include the tempo gain and key mechanics)
- `glyph` (single Unicode symbol)

Type-specific optional fields:
- `aoeRadius` for `"aoe" | "aerial"`
- `chainCount` for chain projectiles
- `effect: "freeze" | "shield"` for utility branches
- `requiresAirborne: true` for aerial cards
- `arcDegrees` for melee (default 140°)
- `iframeOnly: true` for dash cards that only grant i-frames

Reference style — Cleave (melee) at lines 46–58; Bolt is a clean projectile example.

## Step 2 — Confirm CardCaster routes the type

File: `game/src/combat/CardCaster.ts`

`CardCaster.cast()` switches on `card.type` (around line 99). The six existing types each have a handler method (`castMelee`, `castProjectile`, `castDash`, `castAoe`, `castAerial`, `castUtility`). If your card uses an existing type, no change is needed here.

If you're introducing a **new** card type:
1. Add the literal to the `CardType` union in `CardDefinitions.ts:17`.
2. Add a `case` in `CardCaster.cast()` that calls a new private handler.
3. Implement the handler — follow the shape of an existing one (read AP cost via `itemHooks.cardCostOverride` first, apply `damageMultiplier(card)`, emit `CARD_FX` for visuals, return `true` on success / `false` on a fail with `events.emit("CARD_FAIL", {...})`).

## Step 3 — Verify UI coverage

File: `game/src/ui/HandPicker.ts`

The `TYPE_COLOR` map paints card slots by type. If you added a new `CardType`, add a hex color for it.

Card art is generated from `glyph` + type color — no asset files to add.

## Step 4 — Verify

```
(cd /e/Storage/SAAS/Rogue-Hero-3/game && npm run verify)
```

The integration test (`scripts/test-integration-run.ts`) plays through a full run; if your card breaks anything in the cast/draw pipeline it'll surface there.

## Reference: Bolt (projectile)

```typescript
bolt: {
  id: "bolt",
  name: "Bolt",
  cost: 1,
  tempoShift: 4,
  damage: 14,
  range: 22,
  type: "projectile",
  rarity: "common",
  desc: "Fire a fast bolt at the cursor. First enemy hit takes damage. +4 Tempo.",
  glyph: "➶",
},
```
