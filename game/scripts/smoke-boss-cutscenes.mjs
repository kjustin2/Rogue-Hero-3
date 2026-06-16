// Boss cutscene smoke: captures every boss entrance, verifies title styling,
// and exercises the skip cleanup path. Needs the dev server on :5174.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const EXE = join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1217/chrome-win64/chrome.exe");
const OUT = "shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));

let fail = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? "  - " + extra : ""}`);
  if (!ok) fail++;
};

await page.goto("http://localhost:5174", { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.removeItem("rh3v2-runsave"));
await page.waitForTimeout(1500);
await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
await page.waitForTimeout(600);
await page.locator(".hero-card").first().click();
await page.waitForTimeout(700);
if (await page.locator(".story-skip").count()) await page.locator(".story-skip").click();
await page.waitForTimeout(2200);

const bosses = [
  ["warden", 1, "boss-warden"],
  ["spire", 2, "boss-spire"],
  ["colossus", 3, "boss-colossus"],
  ["tyrant", 4, "boss-tyrant"],
  ["unmaker", 5, "boss-unmaker"],
  ["echo", 4, "boss-echo"],
];

for (const [kind, act, cls] of bosses) {
  await page.evaluate(({ kind, act }) => {
    window.__rh3menus.clear();
    window.__rh3.player.hp = window.__rh3.player.maxHp;
    window.__rh3.run.debugLoadBoss(kind, act, 424242, 0);
  }, { kind, act });
  await page.waitForTimeout(1050);
  await page.screenshot({ path: join(OUT, `boss-cutscene-${kind}-omen.png`) });
  const letterbox = await page.evaluate(() => document.querySelector(".letterbox--top")?.classList.contains("letterbox--on"));
  check(`${kind} letterbox during omen`, letterbox === true);

  await page.waitForTimeout(1900);
  await page.screenshot({ path: join(OUT, `boss-cutscene-${kind}-reveal.png`) });
  const banner = await page.evaluate((cls) => {
    const el = document.querySelector(".banner");
    return {
      shown: !!el?.classList.contains("banner--show"),
      themed: !!el?.classList.contains(`banner--${cls}`),
      text: document.querySelector(".banner__title")?.textContent ?? "",
    };
  }, cls);
  check(`${kind} themed title card`, banner.shown && banner.themed, banner.text);

  await page.waitForTimeout(kind === "unmaker" ? 2300 : 2000);
  await page.screenshot({ path: join(OUT, `boss-cutscene-${kind}-fight.png`) });
  const returned = await page.evaluate(() => !document.querySelector(".letterbox--top")?.classList.contains("letterbox--on"));
  check(`${kind} returns control`, returned === true);
}

// Skip path: start a fresh entrance, skip after grace, confirm cleanup.
await page.evaluate(() => {
  window.__rh3menus.clear();
  window.__rh3.run.debugLoadBoss("spire", 2, 909, 0);
});
await page.waitForTimeout(850);
await page.mouse.click(800, 450);
await page.waitForTimeout(500);
const skipped = await page.evaluate(() => {
  const letterboxOff = !document.querySelector(".letterbox--top")?.classList.contains("letterbox--on");
  const mode = window.__rh3.stage.camera ? window.__rh3.cam.mode : "missing";
  return { letterboxOff, mode, input: window.__rh3.input.enabled };
});
check("skip turns letterbox off", skipped.letterboxOff === true);
check("skip restores follow camera", skipped.mode === "follow", `mode=${skipped.mode}`);
check("skip restores input", skipped.input === true);

console.log(errors.length ? `CONSOLE ERRORS (${errors.length}):\n` + errors.slice(0, 12).join("\n") : "NO CONSOLE ERRORS");
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
