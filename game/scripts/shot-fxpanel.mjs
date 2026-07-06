// Verify the effect-bisection panel + the raised near plane. Captures a normal combat frame
// (near-plane must not clip), opens the panel, STRIP ALL, RESTORE, checking no errors.
import { launchBrowser, bootGame, enterRun, sleep } from "./loop/lib.mjs";
import { mkdirSync } from "node:fs";

const OUT = "shots/fx";
mkdirSync(OUT, { recursive: true });
const { browser, page, errors } = await launchBrowser();
await bootGame(page);
await enterRun(page);
await page.evaluate(() => window.__rh3.stage.applyQuality?.("high"));
await sleep(600);
await page.evaluate(() => window.__rh3debug?.godmode?.());
await sleep(1000);
await page.screenshot({ path: `${OUT}/1-combat-nearplane.png` }); // near plane must not clip the floor/hero

await page.evaluate(() => window.__rh3fx.toggleOpen());
await sleep(300);
await page.screenshot({ path: `${OUT}/2-panel-open.png` });

const has = await page.evaluate(() => !!document.querySelector('.fxpanel__btns button[data-fx-all="off"]'));
console.log("panel present:", has);
await page.click('.fxpanel__btns button[data-fx-all="off"]'); // STRIP ALL
await sleep(600);
await page.screenshot({ path: `${OUT}/3-all-off.png` });

await page.click('.fxpanel__btns button[data-fx-all="on"]'); // RESTORE ALL
await sleep(600);
await page.screenshot({ path: `${OUT}/4-all-on.png` });

console.log(errors.length ? `ERRORS: ${errors.slice(0, 6).join("\n")}` : "NO CONSOLE ERRORS");
await browser.close();
process.exit(errors.length ? 1 : 0);
