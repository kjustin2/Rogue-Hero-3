// Card visual identity smoke: every card should get a unique HUD-slot class
// and draft-card sigil layer. Needs the dev server running.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const EXE = join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1217/chrome-win64/chrome.exe");
const PORT = process.env.RH3_PORT || "5174";
const OUT = "shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errors = [];
let fail = 0;

page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));

const check = (name, ok, extra = "") => {
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " - " + extra : ""}`);
  if (!ok) fail++;
};

await page.goto(`http://localhost:${PORT}`, { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.removeItem("rh3v2-runsave"));
await page.waitForTimeout(1400);
await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
await page.waitForTimeout(600);
await page.locator(".hero-card").first().click();
await page.waitForTimeout(700);
if (await page.locator(".story-skip").count()) await page.locator(".story-skip").click();
await page.waitForTimeout(1700);

const hud = await page.evaluate(async () => {
  const c = window.__rh3;
  const cards = window.__rh3cards;
  const missing = [];
  window.__rh3menus.clear();
  for (const card of cards) {
    c.deck.slots[0] = card;
    c.deck.upgraded[0] = false;
    c.deck.cooldowns[0] = 0;
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const slot = document.querySelector(".slot[data-card-id]");
    const ok = !!slot
      && slot.dataset.cardId === card.id
      && slot.classList.contains(`slot--card-${card.id}`)
      && !!slot.querySelector(".slot__sigil");
    if (!ok) missing.push(card.id);
  }
  return { total: cards.length, missing };
});
check("all HUD card slots carry unique visual identity", hud.missing.length === 0, JSON.stringify(hud));

const draft = await page.evaluate(async () => {
  const cards = window.__rh3cards;
  const missing = [];
  for (let i = 0; i < cards.length; i += 3) {
    const chunk = cards.slice(i, i + 3);
    window.__rh3menus.showDraft(chunk, () => {});
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    for (const card of chunk) {
      const el = document.querySelector(`.card[data-card-id="${card.id}"]`);
      const ok = !!el
        && el.classList.contains(`card--id-${card.id}`)
        && !!el.querySelector(".card__sigil");
      if (!ok) missing.push(card.id);
    }
  }
  window.__rh3menus.clear();
  return { total: cards.length, missing };
});
check("all draft cards carry unique visual identity", draft.missing.length === 0, JSON.stringify(draft));

await page.evaluate(() => window.__rh3menus.showDraft(window.__rh3cards.slice(7, 10), () => {}));
await page.waitForTimeout(240);
await page.screenshot({ path: join(OUT, "card-visual-draft.png") });
await page.evaluate(() => window.__rh3menus.clear());
await page.screenshot({ path: join(OUT, "card-visual-identities.png") });

if (errors.length) {
  console.log(`CONSOLE ERRORS (${errors.length}):\n${errors.slice(0, 12).join("\n")}`);
}
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
