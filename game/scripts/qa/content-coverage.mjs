// PER-ID CONTENT COVERAGE — the completeness gate. The event bus already counts
// events by NAME (coverage()), but that can't tell you WHICH card cast, enemy
// died, or relic dropped — the ids live in the payloads and were discarded. This
// aggregates per-id: casts every catalog card (via caster.cast, which emits
// CARD_CAST.id only on a successful dispatch), spawns+kills every enemy kind, and
// diffs the fired ids against the catalogs. A card whose dispatch throws or
// returns false NEVER emits → shows as an id gap → that IS the bug.
//
//   node scripts/qa/content-coverage.mjs             audit card + enemy coverage
//   node scripts/qa/content-coverage.mjs --selftest  fault-proof: the gap-diff must
//                                                    flag a fabricated missing id,
//                                                    and stay quiet when complete
//
// Exit = gap count (a never-exercised catalog id = untested/broken content).
import { join } from "node:path";
import {
  launchBrowser, bootGame, enterRun, gotoScenario, writeJSON, ensureServer, guard, GAME_DIR,
} from "../loop/lib.mjs";
import cfg from "./qa.config.mjs";

guard({ name: "qa-content-coverage", maxMinutes: 8 });
const SELFTEST = process.argv.includes("--selftest");
const S = cfg.seam;
const CC = cfg.contentCoverage ?? {
  enemyKinds: ["husk", "spitter", "swarmer", "bomber", "sentinel", "wisp", "leaper",
    "tether", "mirror", "caster", "shade", "bastion", "brute", "harrier", "splitter", "voidling", "warper"],
};
const log = (...a) => console.log("[content-coverage]", ...a);

/** Pure gap-diff (proven directly in the selftest). */
const gaps = (catalog, fired) => catalog.filter((id) => !fired.includes(id));

const server = await ensureServer({ log });
const { browser, page } = await launchBrowser();
await bootGame(page);

let failures = 0;
const report = {};

if (!SELFTEST) {
  await enterRun(page);
  await gotoScenario(page, "room:combat", { settle: 1500 });

  // ── CARD coverage + integrity: cast every card base + honed ──────────────
  const cards = await page.evaluate(`(() => {
    const c = window.${S}, d = window.${S}debug;
    d.godmode();
    const fired = new Set(); const threw = [];
    const off = c.events.on("CARD_CAST", (p) => fired.add(p.id));
    for (const def of window.${S}cards) {
      // target-dependent cards (chain-lightning/tempo-theft/rift-hook) only emit
      // CARD_CAST when their dispatch finds a target IN RANGE (tempo-theft's is a
      // tight 9u). AoE cards knock husks out of range without killing them, so
      // re-park fresh husks right next to the player before EVERY cast.
      c.enemies.clearNonBosses();
      // Delayed effects from the previous catalog item must not consume the
      // fixed setup frames or kill this card's fresh targets.
      c.caster.clear();
      const px = c.player.pos.x, pz = c.player.pos.z;
      for (const [dx, dz] of [[1.5, 0], [-1.5, 1], [0, 2]]) { try { c.enemies.spawn("husk", px + dx, pz + dz, 0); } catch {} }
      d.frames(4, 1/60);
      try { c.caster.cast(def, false); } catch (e) { threw.push(def.id + ":base:" + String(e).slice(0, 60)); }
      try { c.caster.cast(def, true); } catch (e) { threw.push(def.id + ":honed:" + String(e).slice(0, 60)); }
      d.frames(2, 1/60);
    }
    off();
    return { catalog: window.${S}cards.map((d) => d.id), fired: [...fired], threw };
  })()`);
  const cardGaps = gaps(cards.catalog, cards.fired);
  report.cards = { total: cards.catalog.length, cast: cards.fired.length, gaps: cardGaps, threw: cards.threw };
  log(`cards: ${cards.fired.length}/${cards.catalog.length} cast${cardGaps.length ? `, GAP: ${cardGaps.join(", ")}` : ""}${cards.threw.length ? `, THREW: ${cards.threw.join(" | ")}` : ""}`);
  failures += cardGaps.length + cards.threw.length;

  // ── ENEMY coverage: spawn + kill each kind, expect KILL.kind ─────────────
  const enemies = await page.evaluate(`(async () => {
    const c = window.${S}, d = window.${S}debug;
    d.godmode();
    const killed = new Set();
    const off = c.events.on("KILL", (p) => killed.add(p.kind));
    for (const kind of ${JSON.stringify(CC.enemyKinds)}) {
      c.enemies.clearNonBosses();
      try { c.enemies.spawn(kind, 2, 0, 0); } catch {}
      d.frames(4, 1/60);
      for (const e of c.enemies.living()) if (e.kind !== "boss") e.takeDamage(1e9);
      d.frames(4, 1/60);
    }
    off();
    return { catalog: ${JSON.stringify(CC.enemyKinds)}, killed: [...killed] };
  })()`);
  const enemyGaps = gaps(enemies.catalog, enemies.killed);
  report.enemies = { total: enemies.catalog.length, killed: enemies.killed.length, gaps: enemyGaps };
  log(`enemies: ${enemies.killed.length}/${enemies.catalog.length} killed${enemyGaps.length ? `, GAP (unspawnable/unkillable): ${enemyGaps.join(", ")}` : ""}`);
  failures += enemyGaps.length;
} else {
  // Prove the gap-diff: a fabricated fired set missing one id must be flagged;
  // a complete set must be clean.
  const catalog = ["a", "b", "c", "d"];
  const complete = gaps(catalog, ["a", "b", "c", "d"]);
  const missing = gaps(catalog, ["a", "b", "d"]);
  log(`selftest: complete-gap=${complete.length} (must be 0), missing-'c' flagged=${missing.includes("c")}`);
  failures = (complete.length === 0 && missing.includes("c") && missing.length === 1) ? 0 : 1;
}

writeJSON(join(GAME_DIR, "artifacts", "qa", "content-coverage.json"), {
  at: new Date().toISOString(), selftest: SELFTEST, report, failures,
});

await browser.close();
server.stop();
if (failures) { log(`FAIL — ${failures} content gap(s)/throw(s)`); process.exit(Math.min(failures, 99)); }
log(SELFTEST ? "OK — the per-id gap-diff flags missing content and stays quiet when complete" : "OK — every card casts and every enemy kind spawns+dies; no content gaps");
