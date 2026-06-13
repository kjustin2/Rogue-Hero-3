// Meta-progression: fresh profile → locked drafts; win a run → unlock toasts,
// persisted profile, progress screen shows stats.
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
await page.evaluate(() => localStorage.removeItem("rh3v2-profile"));
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1800);

// Fresh profile: locked cards must not appear in drafts
const lockedOk = await page.evaluate(() => {
  const c = window.__rh3;
  const ids = new Set();
  for (let i = 0; i < 40; i++) c.deck.draftChoices().forEach((x) => ids.add(x.id));
  const lockedSeen = ["sunder", "meteor-call", "ember-wave", "charged-lance"].filter((id) => ids.has(id));
  return { lockedSeen, sample: [...ids] };
});
console.log("LOCKED CARDS IN DRAFT:", lockedOk.lockedSeen.length === 0 ? "NONE (OK)" : `LEAK: ${lockedOk.lockedSeen}`);

// Win a full run quickly
await page.evaluate(() => localStorage.removeItem("rh3v2-runsave"));
await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
await page.waitForTimeout(700);
await page.locator(".hero-card").first().click();
await page.waitForTimeout(2500);
const N = await page.evaluate(() => window.__rh3.run.totalRooms);
for (let room = 0; room < N; room++) {
  let st = null;
  for (let tries = 0; tries < 16; tries++) {
    st = await page.evaluate(() => {
      const c = window.__rh3;
      for (const e of c.enemies.living()) e.takeDamage(99999);
      return c.run.state;
    });
    if (st !== "fighting") break;
    await page.waitForTimeout(450);
  }
  if (st === "victory") break;
  await page.waitForTimeout(1900);
  if (await page.locator(".card").count()) {
    await page.locator(".card").first().click();
    await page.waitForTimeout(450);
    if (await page.locator(".card").count()) await page.locator(".card").first().click();
  } else if (await page.locator(".draft-skip").count()) {
    await page.locator(".draft-skip").click();
  }
  await page.waitForTimeout(2800);
}
await page.waitForTimeout(3500);
const toasts = await page.locator(".unlock-toast").count();
console.log("UNLOCK TOASTS ON VICTORY:", toasts, toasts > 0 ? "OK" : "FAIL");
await page.screenshot({ path: "shots/meta-victory.png" });

// Profile persisted?
const profile = await page.evaluate(() => JSON.parse(localStorage.getItem("rh3v2-profile") || "{}"));
console.log("PROFILE:", `wins=${profile.wins} runs=${profile.runs} kills=${profile.kills} unlocks=${profile.unlocks?.length}`);
console.log("PERSISTED:", profile.wins === 1 ? "OK" : "FAIL");

// Progress screen from the main menu
await page.locator("button", { hasText: "Main Menu" }).click();
await page.waitForTimeout(900);
await page.screenshot({ path: "shots/meta-menu.png" });
await page.locator("button", { hasText: "Progress" }).click();
await page.waitForTimeout(700);
const items = await page.locator(".prog-item").count();
const lockedItems = await page.locator(".prog-item--locked").count();
console.log(`PROGRESS GRID: ${items} items (${lockedItems} locked)`, items === 39 ? "OK" : "CHECK");
await page.screenshot({ path: "shots/meta-progress.png" });

console.log(errors.length ? `CONSOLE ERRORS:\n` + errors.join("\n") : "NO CONSOLE ERRORS");
await browser.close();
