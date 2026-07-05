// Verify the per-hero SIGNATURE level on hero-select. Unlocks every hero + a partial
// spread of cards so the pip rows show real partial progress, then captures the screen.
import { launchBrowser, bootGame, sleep } from "./loop/lib.mjs";
import { mkdirSync } from "node:fs";

mkdirSync("shots", { recursive: true });
const { browser, page, errors } = await launchBrowser();
await bootGame(page);

await page.evaluate(() => {
  const p = window.__rh3.profile;
  // Unlock all heroes + ~half the signature cards so pip rows show partial progress.
  const HEROES = ["blade", "bulwark", "sparkmage", "reaver", "tempest", "revenant"];
  const someCards = ["tempo-edge", "shield-bash", "bulwark-breaker", "singularity",
    "storm-conduit", "rend-boomerang", "bleeding-edge", "tempest-storm", "frost-lattice",
    "grave-harvest", "soul-harvest", "seismic-slam"];
  for (const h of HEROES) if (!p.data.unlocks.includes(`hero:${h}`)) p.data.unlocks.push(`hero:${h}`);
  for (const c of someCards) if (!p.data.unlocks.includes(`card:${c}`)) p.data.unlocks.push(`card:${c}`);
  p.data.heroWins = { blade: 3, reaver: 1 };
  p.data.heroBestWinDepth = { blade: 6 };
  window.__rh3menus.warmHeroSelect();
  window.__rh3menus.showHeroSelect();
});
await sleep(700);
await page.screenshot({ path: "shots/hero-levels.png" });
// Zoom into the first two hero cards for a legible read of the pip row.
const row = await page.$(".hero-row");
if (row) await row.screenshot({ path: "shots/hero-levels-row.png" });

console.log(errors.length ? `ERRORS: ${errors.slice(0, 4).join("\n")}` : "NO CONSOLE ERRORS");
await browser.close();
process.exit(0);
