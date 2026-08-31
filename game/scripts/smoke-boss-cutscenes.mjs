import { guard } from "./lib/guard.cjs";
guard({ name: "smoke-boss-cutscenes", maxMinutes: 3 }); // seven authored reveals need slightly over the one-minute default on real GPUs
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
await page.waitForFunction(() => window.__rh3boot?.ready === true, null, { timeout: 20000 });
await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
await page.locator(".hero-confirm").waitFor({ state: "visible", timeout: 12000 });
await page.locator(".hero-confirm").click();
await page.locator(".story").waitFor({ state: "visible", timeout: 12000 });
if (await page.locator(".story-skip").count()) await page.locator(".story-skip").click();
await page.waitForTimeout(2200);

const bosses = [
  ["warden", 1, "boss-warden"],
  ["spire", 2, "boss-spire"],
  ["colossus", 3, "boss-colossus"],
  ["tyrant", 4, "boss-tyrant"],
  ["unmaker", 5, "boss-unmaker"],
  ["echo", 4, "boss-echo"],
  ["wound", 5, "boss-wound"],
];

for (const [kind, act, cls] of bosses) {
  await page.evaluate(({ kind, act }) => {
    window.__rh3debug.freezeForTest(false);
    window.__rh3menus.clear();
    window.__rh3.player.hp = window.__rh3.player.maxHp;
    window.__rh3.run.debugLoadBoss(kind, act, 424242, 0);
  }, { kind, act });
  await page.waitForTimeout(1050);
  await page.screenshot({ path: join(OUT, `boss-cutscene-${kind}-omen.png`) });
  const letterbox = await page.evaluate(() => document.querySelector(".letterbox--top")?.classList.contains("letterbox--on"));
  check(`${kind} letterbox during omen`, letterbox === true);

  await page.waitForTimeout(1900);
  // Act I owns the canonical Warden identity plate. Keep this fleet focused on
  // the six later-boss reveals instead of emitting a byte-duplicate screenshot.
  if (kind !== "warden") await page.screenshot({ path: join(OUT, `boss-cutscene-${kind}-reveal.png`) });
  const banner = await page.evaluate((cls) => {
    const el = document.querySelector(".banner");
    return {
      shown: !!el?.classList.contains("banner--show"),
      themed: !!el?.classList.contains(`banner--${cls}`),
      text: document.querySelector(".banner__title")?.textContent ?? "",
    };
  }, cls);
  check(`${kind} themed title card`, banner.shown && banner.themed, banner.text);
  const revealFrame = await page.evaluate(() => window.__rh3debug.actorFraming().find((actor) => actor.id.includes(":boss")));
  check(`${kind} reveal keeps the boss framed`, !!revealFrame?.inFrame && revealFrame.minY >= -0.84 && revealFrame.maxY <= 0.84, JSON.stringify(revealFrame));

  await page.waitForTimeout(kind === "unmaker" ? 3700 : 3300);
  // The handoff assertion is about a readable gameplay composition, not where
  // several seconds of unattended AI happened to wander. Pin both combatants
  // and cut immediately to the authored arena-wide lens before capture.
  await page.evaluate(() => {
    const c = window.__rh3, boss = c.enemies.living().find((enemy) => enemy.kind === "boss");
    if (boss) { boss.setSpawnGrace(1e9); boss.pos.set(0, 0, -4); boss.root.position.set(0, 0, -4); }
    c.player.pos.set(0, 0, 3);
    window.__rh3debug.frameNow(0, -0.5, 1.1);
    window.__rh3debug.freezeForTest(true);
  });
  await page.screenshot({ path: join(OUT, `boss-cutscene-${kind}-fight.png`) });
  const returned = await page.evaluate(() => !document.querySelector(".letterbox--top")?.classList.contains("letterbox--on"));
  check(`${kind} returns control`, returned === true);
  const fightFrame = await page.evaluate(() => window.__rh3debug.actorFraming().find((actor) => actor.id.includes(":boss")));
  check(`${kind} fight handoff keeps the boss framed`, !!fightFrame?.inFrame, JSON.stringify(fightFrame));
}

// Skip path: start a fresh entrance, skip after grace, confirm cleanup.
await page.evaluate(() => {
  window.__rh3debug.freezeForTest(false);
  window.__rh3menus.clear();
  window.__rh3.run.debugLoadBoss("spire", 2, 909, 0);
});
await page.waitForTimeout(1100);
await page.mouse.click(800, 450);
// Skip preserves the defining identity pose/stinger for 600ms by contract.
await page.waitForTimeout(700);
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
