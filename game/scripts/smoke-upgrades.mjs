// Card upgrade smoke: cast EVERY card both base and honed in a live combat node,
// asserting no dispatch path throws. Also screenshots the Hone-a-Card picker.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const EXE = join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1217/chrome-win64/chrome.exe");
mkdirSync("shots", { recursive: true });
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
await page.goto("http://localhost:5174", { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.removeItem("rh3v2-runsave"));
await page.waitForTimeout(2000);
await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
await page.waitForTimeout(700);
await page.locator(".hero-card").first().click();
await page.waitForTimeout(800);
if (await page.locator(".story-skip").count()) { await page.locator(".story-skip").click(); await page.waitForTimeout(600); }
await page.waitForTimeout(2600);

// Cast every card, base then honed, with the run live (enemies present, aim ahead).
const r = await page.evaluate(async () => {
  const c = window.__rh3;
  const cards = window.__rh3cards;
  let cast = 0;
  for (const card of cards) {
    c.player.hp = c.player.maxHp;
    c.input.aimPoint.set(c.player.pos.x + 4, 0, c.player.pos.z - 4);
    try { c.caster.cast(card, false); cast++; } catch (e) { return { ok: false, where: card.id + " base", msg: String(e) }; }
    await new Promise((res) => setTimeout(res, 30));
    try { c.caster.cast(card, true); cast++; } catch (e) { return { ok: false, where: card.id + " honed", msg: String(e) }; }
    await new Promise((res) => setTimeout(res, 30));
  }
  // let lingering entities (mines/meteors/bleeds/wells/cyclone) tick out
  await new Promise((res) => setTimeout(res, 1500));
  return { ok: true, cast, total: cards.length };
});

console.log(r.ok ? `CAST ALL: ${r.cast} casts across ${r.total} cards (base + honed) OK` : `THREW at ${r.where}: ${r.msg}`);
console.log(errors.length ? `CONSOLE ERRORS (${errors.length}):\n` + errors.slice(0, 8).join("\n") : "NO CONSOLE ERRORS");
await browser.close();
process.exit(r.ok && errors.length === 0 ? 0 : 1);
