import { guard } from "./lib/guard.cjs";
guard(); // test-run governor: watchdog + machine lock + memory sentinel (lib/guard.cjs)
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
    const icon = slot?.querySelector(".slot__icon");
    const name = slot?.querySelector(".slot__name");
    const sigil = slot?.querySelector(".slot__sigil");
    const ok = !!slot
      && slot.dataset.cardId === card.id
      && slot.classList.contains(`slot--card-${card.id}`)
      && icon?.textContent === card.icon
      && name?.textContent?.startsWith(card.name)
      && getComputedStyle(icon).display !== "none"
      && getComputedStyle(sigil).display === "none";
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

const hudReadability = await page.evaluate(async () => {
  const c = window.__rh3;
  const ids = ["dash-strike", "arc-bolt", "warcry"];
  c.deck.slots = ids.map((id) => window.__rh3cards.find((card) => card.id === id));
  c.deck.upgraded = [false, false, false];
  c.deck.cooldowns = [0, 0, 0];
  window.__rh3menus.clear();
  await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  return [...document.querySelectorAll(".slot")].map((slot) => {
    const icon = slot.querySelector(".slot__icon");
    const name = slot.querySelector(".slot__name");
    const key = slot.querySelector(".slot__key");
    const sr = slot.getBoundingClientRect();
    const ir = icon.getBoundingClientRect();
    const nr = name.getBoundingClientRect();
    const kr = key.getBoundingClientRect();
    return {
      card: slot.dataset.cardId,
      iconNameGap: Math.round(nr.left - ir.right),
      nameFits: name.scrollWidth <= name.clientWidth + 1 && name.scrollHeight <= name.clientHeight + 1,
      keyContained: kr.left >= sr.left && kr.top >= sr.top && kr.right <= sr.right && kr.bottom <= sr.bottom,
    };
  });
});
check(
  "HUD cards keep command names clear of icon art",
  hudReadability.length === 3 && hudReadability.every((slot) => slot.card && slot.iconNameGap >= 4 && slot.nameFits && slot.keyContained),
  JSON.stringify(hudReadability),
);

await page.evaluate(() => window.__rh3menus.showDraft(window.__rh3cards.slice(7, 10), () => {}));
await page.waitForTimeout(240);
await page.screenshot({ path: join(OUT, "card-visual-draft.png") });
await page.evaluate(() => window.__rh3menus.clear());
await page.waitForTimeout(120);
await page.screenshot({ path: join(OUT, "card-visual-identities.png") });

if (errors.length) {
  console.log(`CONSOLE ERRORS (${errors.length}):\n${errors.slice(0, 12).join("\n")}`);
}
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
