// Verify the visual-fix round on clean scenes: normal combat (glitch hunt), the act
// interlude (locked words + released choice with badges), and a boss phase transition.
import { launchBrowser, bootGame, enterRun, gotoScenario, sleep } from "./loop/lib.mjs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = "shots/verify";
mkdirSync(OUT, { recursive: true });
const { browser, page, errors } = await launchBrowser();
const shot = (n) => page.screenshot({ path: join(OUT, `${n}.png`) });

await bootGame(page);
await enterRun(page);
await page.evaluate(() => window.__rh3debug?.godmode?.());
await sleep(1200);
await shot("01-combat-clean"); // normal act-1 combat — hunt the white-disc glitch here

// Interlude: locked (words) state — badges should be visible above both lights.
await page.evaluate(() => { window.__rh3menus?.clear?.(); window.__rh3debug?.interlude?.(2); });
await sleep(1500);
await shot("02-interlude-locked");
// Click to skip the words → released state (STEP INTO A LIGHT + bright lights).
await page.mouse.click(800, 450);
await sleep(900);
await shot("03-interlude-released");

// Boss phase transition drama — trigger, then drop to phase 2 and grab the burst.
await page.evaluate(() => window.__rh3debug?.interlude && window.__rh3?.run); // no-op guard
await gotoScenario(page, "boss:spire", { settle: 2600 });
await page.evaluate(() => window.__rh3debug?.godmode?.());
await page.evaluate(() => window.__rh3debug?.setBossPhase?.(0.6)); // cross into phase 2
await sleep(250);
await shot("04-boss-phase-a");
await sleep(400);
await shot("05-boss-phase-b");

console.log(errors.length ? `ERRORS: ${errors.slice(0, 5).join("\n")}` : "NO CONSOLE ERRORS");
await browser.close();
process.exit(0);
