// Clean contact-sheet capture for before/after visual audits (NO perf overlay).
// Boots the game, visits a fixed set of scenarios spanning menu / combat / atmosphere
// / bosses, and screenshots each into the target dir (arg 1, default shots/contact).
//   node scripts/shot-contact.mjs shots/baseline
// Reused by the graphics glow-up audit — same scenes each run so visual:diff lines up.
import { launchBrowser, bootGame, enterRun, gotoScenario, sleep } from "./loop/lib.mjs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = process.argv[2] || "shots/contact";
mkdirSync(OUT, { recursive: true });

const { browser, page, errors } = await launchBrowser();
const shot = (name) => page.screenshot({ path: join(OUT, `${name}.png`) });

await bootGame(page);
// 1) Main menu (fresh, pre-run)
await sleep(800);
await shot("01-menu");

// 2) Live combat, act 1 (rift)
await enterRun(page);
await page.evaluate(() => window.__rh3debug?.godmode?.());
await sleep(600);
await shot("02-combat-act1");

// 3) Atmosphere variety — a mid-act combat room per act family
const acts = [
  ["03-act2-spire", 2],
  ["04-act3-forge", 3],
  ["05-act4-abyss", 4],
];
for (const [name, act] of acts) {
  await gotoScenario(page, `room:combat`, { settle: 1200 });
  await page.evaluate((a) => window.__rh3debug?.room?.("combat", a), act);
  await page.evaluate(() => window.__rh3debug?.godmode?.());
  await sleep(1600);
  await shot(name);
}

// 4) Enemy portraits (silhouette / material read)
for (const [name, kind] of [["06-enemy-brute", "brute"], ["07-enemy-caster", "caster"]]) {
  await gotoScenario(page, `enemy:${kind}`, { settle: 2200 });
  await sleep(800);
  await shot(name);
}

// 5) Bosses (scale, phase drama)
for (const [name, scen] of [["08-boss-colossus", "boss:colossus:p2"], ["09-boss-unmaker", "boss:unmaker"], ["10-boss-tyrant", "boss:tyrant"]]) {
  await gotoScenario(page, scen, { settle: 2600 });
  await sleep(900);
  await shot(name);
}

console.log(`contact sheet → ${OUT}`);
console.log(errors.length ? `CONSOLE ERRORS (${errors.length}):\n${errors.slice(0, 6).join("\n")}` : "NO CONSOLE ERRORS");
await browser.close();
process.exit(0);
