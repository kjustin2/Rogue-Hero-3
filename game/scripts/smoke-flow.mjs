// Full-run smoke: walks all 9 rooms across 3 acts via the dev __rh3 hook,
// clicking through every draft, ending on the victory screen. Then a death.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const EXE = join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1217/chrome-win64/chrome.exe");
mkdirSync("shots", { recursive: true });

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));

await page.goto("http://localhost:5174", { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
await page.evaluate(() => localStorage.removeItem("rh3v2-runsave"));
await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
await page.waitForTimeout(700);
await page.locator(".hero-card").first().click();
await page.waitForTimeout(2500);

const ROOM_COUNT = await page.evaluate(() => window.__rh3.run.totalRooms);
console.log("rooms:", ROOM_COUNT);

for (let room = 0; room < ROOM_COUNT; room++) {
  // Kill everything (pending spawns take a few seconds to materialize)
  let st = null;
  for (let tries = 0; tries < 16; tries++) {
    st = await page.evaluate(() => {
      const c = window.__rh3;
      for (const e of c.enemies.living()) e.takeDamage(99999);
      return { state: c.run.state, idx: c.run.roomIndex };
    });
    if (st.state !== "fighting") break;
    await page.waitForTimeout(450);
  }
  console.log(`room ${room}: idx=${st.idx} state=${st.state}`);
  if (st.state === "victory") break;
  if (st.state !== "cleared") {
    console.log(`FAIL: room ${room} never cleared`);
    break;
  }

  await page.screenshot({ path: `shots/flow-${room}-cleared.png` });
  await page.waitForTimeout(1900); // draft opens at +1.5s

  // Click through the draft (pick → optional swap stage)
  if (await page.locator(".card").count()) {
    await page.screenshot({ path: `shots/flow-${room}-draft.png` });
    await page.locator(".card").first().click();
    await page.waitForTimeout(450);
    if (await page.locator(".card").count()) {
      await page.locator(".card").first().click();
      await page.waitForTimeout(450);
    }
  } else if (await page.locator(".draft-skip").count()) {
    await page.locator(".draft-skip").click();
  } else {
    console.log(`WARN: room ${room} no draft UI found`);
  }
  await page.waitForTimeout(2800); // room load + act intro card
}

await page.waitForTimeout(3500);
await page.screenshot({ path: "shots/flow-victory.png" });
const victoryShown = await page.locator(".end-title--victory").count();
console.log("VICTORY SCREEN:", victoryShown > 0 ? "OK" : "MISSING");

// Death screen path
const again = page.locator("button", { hasText: "Run It Back" });
if (await again.count()) {
  await again.click();
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__rh3.combat.damagePlayer(99999, 3, 3));
  await page.waitForTimeout(2400);
  const deathShown = await page.locator(".end-title--death").count();
  console.log("DEATH SCREEN:", deathShown > 0 ? "OK" : "MISSING");
}

console.log(errors.length ? `CONSOLE ERRORS (${errors.length}):\n` + errors.slice(0, 10).join("\n") : "NO CONSOLE ERRORS");
await browser.close();
