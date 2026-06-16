// Balance + UX smoke: boss HP raised, synergy badge removed, shard balance shown on
// drafts, blessing description shown, gamepad layout documented. Needs dev server :5174.
import { chromium } from "playwright-core";
import { join } from "node:path";

const EXE = join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1217/chrome-win64/chrome.exe");
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
await page.goto("http://localhost:5174", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

let fail = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? "  — " + extra : ""}`); if (!ok) fail++; };

// --- Blessings start LOCKED on a fresh profile and are earned through play.
await page.evaluate(() => localStorage.removeItem("rh3v2-runsave"));
await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
await page.waitForTimeout(700);
const desc0 = (await page.locator(".blessing-desc").textContent().catch(() => "")) || "";
const lockedCount = await page.locator(".blessing-chip--locked").count();
check("Blessing description is shown", desc0.length > 0);
check("Blessings start locked on a fresh profile", lockedCount >= 1, `${lockedCount} locked`);
// Clicking a locked blessing reveals how to unlock it (doesn't select it).
await page.locator(".blessing-chip--locked").first().click();
await page.waitForTimeout(150);
const lockedDesc = (await page.locator(".blessing-desc").textContent().catch(() => "")) || "";
check("Locked blessing shows its unlock condition", /unlock/i.test(lockedDesc), lockedDesc.slice(0, 50));
// Earn Vigor, re-open hero select → now selectable, and shows its effect.
await page.evaluate(() => { const u = window.__rh3.profile.data.unlocks; if (!u.includes("blessing:vigor")) u.push("blessing:vigor"); window.__rh3menus.showHeroSelect(); });
await page.waitForTimeout(250);
await page.locator(".blessing-chip", { hasText: "Vigor" }).click();
await page.waitForTimeout(200);
const descVigor = (await page.locator(".blessing-desc").textContent().catch(() => "")) || "";
check("Selecting an unlocked blessing updates the description", /maximum hp/i.test(descVigor), descVigor.slice(0, 40));

// --- Enter a run, then check drafts + boss HP.
await page.locator(".hero-card").first().click();
await page.waitForTimeout(700);
if (await page.locator(".story-skip").count()) await page.locator(".story-skip").click();
await page.waitForTimeout(2400);
for (let i = 0; i < 24; i++) { if (await page.evaluate(() => window.__rh3.playing)) break; await page.waitForTimeout(300); }

// Shard balance shown + synergy badge gone on the card draft.
await page.evaluate(() => { window.__rh3.stats.shards = 99; window.__rh3menus.showDraft(window.__rh3.deck.draftChoices(), () => {}); });
await page.waitForTimeout(300);
const subText = (await page.locator(".draft-sub").first().textContent().catch(() => "")) || "";
check("Draft shows shard balance", /YOU HAVE ◆\s*99/.test(subText.replace(/ /g, " ")), subText.slice(0, 60));
check("No synergy badge on cards", (await page.locator(".card__synergy").count()) === 0);

// Boss HP raised (Warden was 380 → now far higher).
const wardenHp = await page.evaluate(() => {
  window.__rh3menus.clear();
  window.__rh3.run.debugLoadBoss("warden", 1, 424242, 3);
  return new Promise((res) => setTimeout(() => {
    const b = window.__rh3.enemies.living().find((e) => e.kind === "boss");
    res(b ? b.maxHp : 0);
  }, 3200));
});
check("Boss HP raised (Warden ≥ 600)", wardenHp >= 600, `maxHp=${wardenHp}`);

// --- Gamepad layout documented in How to Play.
await page.goto("http://localhost:5174", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.locator("button", { hasText: "How to Play" }).click();
await page.waitForTimeout(400);
const howto = (await page.locator(".panel").textContent().catch(() => "")) || "";
check("How to Play documents the gamepad", /GAMEPAD/.test(howto) && /L STICK/i.test(howto) && /Overdrive/i.test(howto));

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join("\n")}` : "NO CONSOLE ERRORS");
console.log(fail === 0 && errors.length === 0 ? "BALANCE: ALL PASS" : `BALANCE: ${fail} FAILURES`);
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
