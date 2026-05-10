---
description: Scaffold a new relic with the right ItemManager hook
argument-hint: [relic-id-or-description]
---

# Add a new relic

Relics (called "items" in code) are equipped between rooms and modify combat/tempo via hooks. Adding one is two files: the def + the hook.

User intent: $ARGUMENTS

## Step 1 — Add the ItemDef

File: `game/src/items/ItemDefinitions.ts`

`ItemDef` shape (lines 8–16):
- `id` (snake_case, unique)
- `name` (display string)
- `rarity` — `"common" | "uncommon" | "rare" | "legendary"`
- `color` (hex string `"#ffdd44"` for UI tint — match the relic's vibe)
- `desc` (one-line tooltip; include the numeric effect)
- `charSpecific?: string` — set to a hero id (e.g. `"blade"`) if the relic only drops for that hero

Append the entry to the `ItemDefinitions` record. `ALL_ITEM_IDS` is auto-generated at the bottom (line 86) — no manual list to update.

Reference style — Berserker Heart (rare, char-specific), Bloodthirst (uncommon, kill-heal), Kinetic Core (uncommon, dash buff).

## Step 2 — Implement the hook(s) in ItemManager

File: `game/src/items/ItemManager.ts`

This is the **only** place per-relic effects live. Pick the hook(s) matching the effect:

| Hook | Signature | When it fires |
|---|---|---|
| `shouldDecay(tempoValue: number): boolean` | gate Tempo decay | Each frame |
| `crashResetOverride(): number \| null` | override post-crash Tempo (default null = use system default) | On crash |
| `damageMultiplier(card: CardDef): number` | multiply card damage (default 1.0) | Per cast |
| `cardCostOverride(card: CardDef): number \| null` | override AP cost (null = use card.cost) | Per cast |
| `onCardCast(card: CardDef, hits: Enemy[]): void` | post-cast reactions (shield refresh, self-buff stacking) | Per cast, after damage |
| `onEnemyHit(enemy: Enemy, dmg: number, card: CardDef): void` | per-target effects (chain, DoT, status) | Per damaged enemy |
| `onKill(enemy: Enemy, card: CardDef): void` | kill rewards (heal, AP refund) | When a card kills |
| `onPlayerDamaged(amount: number): number` | reduce incoming damage; return adjusted amount | Before HP deduction |

Pattern: gate the effect on `this.has("your_relic_id")` before applying it. Read other relic state via `this.has()` if there are stacking interactions.

Reference style — Ironclad (lines 125–132, conditional damage reduction), Kinetic Core (lines 102–111, dash burn DoT), Frost Chord (lines 74–79, conditional cost reduction).

## Step 3 — Verify

```
(cd /e/Storage/SAAS/Rogue-Hero-3/game && npm run verify)
```

The integration test equips relics during the simulated run; if your hook breaks the cast pipeline it'll fail there.

## Reference: Berserker Heart

```typescript
// ItemDefinitions.ts
berserker_heart: {
  id: "berserker_heart",
  name: "Berserker Heart",
  rarity: "rare",
  color: "#ff4422",
  desc: "[BLADE] Each crash resets Tempo to 80 instead of the default.",
  charSpecific: "blade",
},

// ItemManager.ts
crashResetOverride(): number | null {
  return this.has("berserker_heart") ? 80 : null;
}
```
