// Pure-logic smoke tests — no Babylon runtime needed. Validates that the
// vertical slice content + core systems are internally consistent so a bad
// config gets caught before a browser boot.
//
// Run via: `npx tsx scripts/test-smoke.ts` (also wired into `npm run verify`).

// Minimal node shim so we avoid pulling in @types/node just for `process.exit`.
declare const process: { exit(code?: number): never };

import { VERTICAL_SLICE_ROOMS } from "../src/run/RunManager";
import { CardDefinitions, STARTING_DECK } from "../src/deck/CardDefinitions";
import { ItemDefinitions, ALL_ITEM_IDS } from "../src/items/ItemDefinitions";
import { TempoSystem } from "../src/tempo/TempoSystem";
import { GameState, GamePhase } from "../src/state/GameState";
import { BLADE } from "../src/characters/Blade";

const VALID_ENEMY_KINDS = new Set(["chaser", "shooter", "caster", "elite", "boss_brawler"]);

let failures = 0;
function check(cond: unknown, label: string): void {
  if (cond) return;
  failures++;
  // eslint-disable-next-line no-console
  console.error(`  ✗ ${label}`);
}

function section(title: string): void {
  // eslint-disable-next-line no-console
  console.log(`\n[${title}]`);
}

// ---------------------------------------------------------- Rooms
section("Room layout");
check(VERTICAL_SLICE_ROOMS.length === 3, "exactly 3 rooms in the vertical slice");
for (const [i, room] of VERTICAL_SLICE_ROOMS.entries()) {
  check(typeof room.name === "string" && room.name.length > 0, `room[${i}] has a name`);
  check(room.arena.size != null && room.arena.size >= 20 && room.arena.size <= 80, `room[${i}] size is within sane bounds`);
  check(room.arena.wallHeight != null && room.arena.wallHeight >= 2, `room[${i}] has a non-trivial wall height`);
  check(Array.isArray(room.spawns) && room.spawns.length > 0, `room[${i}] has at least one spawn`);
  for (const [j, spawn] of room.spawns.entries()) {
    check(VALID_ENEMY_KINDS.has(spawn.kind), `room[${i}].spawns[${j}].kind is valid (${spawn.kind})`);
    // Spawn positions should be inside the arena bounds (size/2 minus a margin).
    const half = (room.arena.size ?? 40) / 2;
    const margin = 1.5;
    check(Math.abs(spawn.pos.x) < half - margin, `room[${i}].spawns[${j}].pos.x inside arena (${spawn.pos.x.toFixed(1)}, half=${half})`);
    check(Math.abs(spawn.pos.z) < half - margin, `room[${i}].spawns[${j}].pos.z inside arena (${spawn.pos.z.toFixed(1)}, half=${half})`);
  }
}
// The last room is the boss arena.
const lastRoom = VERTICAL_SLICE_ROOMS[VERTICAL_SLICE_ROOMS.length - 1];
check(
  lastRoom.spawns.some((s) => s.kind === "boss_brawler"),
  "final room contains a boss",
);

// ---------------------------------------------------------- Cards
section("Cards");
check(STARTING_DECK.length >= 4, "starting deck has enough cards to fill the hand");
for (const id of STARTING_DECK) {
  check(id in CardDefinitions, `starting deck card "${id}" exists in CardDefinitions`);
}
for (const [id, def] of Object.entries(CardDefinitions)) {
  check(def.id === id, `CardDefinitions["${id}"].id matches key`);
  check(def.cost > 0 && def.cost <= 4, `card "${id}" cost is within AP max`);
  check(def.damage > 0, `card "${id}" has non-zero damage`);
  check(def.range > 0, `card "${id}" has positive range`);
  check(["melee", "projectile", "dash"].includes(def.type), `card "${id}" type is a known handler`);
}

// ---------------------------------------------------------- Items
section("Items");
check(ALL_ITEM_IDS.length >= 3, "at least 3 relics defined");
for (const id of ALL_ITEM_IDS) {
  const def = ItemDefinitions[id];
  check(def != null, `ItemDefinitions["${id}"] exists`);
  check(typeof def.name === "string" && def.name.length > 0, `relic "${id}" has a name`);
  check(typeof def.desc === "string" && def.desc.length > 0, `relic "${id}" has a description`);
  check(["common", "uncommon", "rare", "legendary"].includes(def.rarity), `relic "${id}" has a valid rarity`);
}
// Berserker Heart is Blade-specific — the character picker must know about it.
check(
  ItemDefinitions.berserker_heart.charSpecific === BLADE.id,
  "berserker_heart is locked to the Blade character",
);

// ---------------------------------------------------------- TempoSystem
section("TempoSystem");
const t = new TempoSystem();
check(t.value === 50, "tempo starts at REST (50)");
check(t.stateName() === "FLOWING", "tempo at 50 reads FLOWING");
t.setValue(10);
check(t.stateName() === "COLD", "tempo at 10 reads COLD");
t.setValue(75);
check(t.stateName() === "HOT", "tempo at 75 reads HOT");
t.setValue(95);
check(t.stateName() === "CRITICAL", "tempo at 95 reads CRITICAL");
check(t.damageMultiplier() > 1, "damage multiplier > 1 in CRITICAL");
// Boundary — 89 is HOT, 90+ is CRITICAL.
t.setValue(89); check(t.stateName() === "HOT", "tempo 89 is HOT (< 90 boundary)");
t.setValue(90); check(t.stateName() === "CRITICAL", "tempo 90 is CRITICAL");
// Crash path — natural tempo gain caps at 99; only triggerCrash() (F key)
// fires a Crash. Cold-crash on hitting 0 stays automatic.
t.reset();
t.setValue(100);
check(!t.isCrashed, "natural tempo set to 100 no longer auto-crashes");
check(t.value <= 99, "tempo value caps at 99 from natural gain");
check(t.canCrash(), "tempo at cap reports canCrash() = true");
const fired = t.triggerCrash();
check(fired, "triggerCrash() returns true when ready");
check(t.isCrashed, "triggerCrash() puts the system into crashed state");
check(t.value !== 100, "tempo value reset below 100 after crash");
// Below threshold: triggerCrash() should be a no-op.
t.reset();
t.setValue(60);
check(!t.canCrash(), "below threshold canCrash() = false");
check(!t.triggerCrash(), "triggerCrash() returns false when below threshold");

// ---------------------------------------------------------- GameState
section("GameState");
const gs = new GameState();
check(gs.phase === "menu", "new GameState starts in 'menu'");
check(!gs.isInteractive(), "'menu' phase is non-interactive");
check(gs.isFrozen(), "'menu' phase freezes the gameplay tick");
gs.setPhase("playing");
check(gs.isInteractive(), "'playing' phase is interactive");
check(!gs.isFrozen(), "'playing' phase is not frozen");
const phases: GamePhase[] = ["reward", "transitioning", "victory", "dead"];
for (const p of phases) {
  gs.setPhase(p);
  check(gs.phase === p, `can transition to '${p}'`);
  check(!gs.isInteractive(), `'${p}' phase is non-interactive`);
}
gs.setPhase("paused");
check(!gs.isInteractive(), "'paused' phase is non-interactive");
check(gs.isFrozen(), "'paused' phase freezes the gameplay tick");
gs.setPhase("playing");
check(gs.isInteractive(), "can return to 'playing'");

// ---------------------------------------------------------- Summary
// eslint-disable-next-line no-console
console.log(`\n${failures === 0 ? "✓ all smoke tests passed" : `✗ ${failures} smoke test(s) failed`}`);
if (failures > 0) process.exit(1);
