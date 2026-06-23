// Debug-scenario smoke: drives window.__rh3debug.scenario(...) to "cut to"
// scenarios and screenshot each — the system that lets automated tests jump
// straight to a situation and capture it. Prints PASS/FAIL per cut.
//
//   node scripts/loop/scenario-shots.mjs --out artifacts/loop/scenarios
import { join } from "node:path";
import { launchBrowser, bootGame, sleep, ensureDir, isServerUp, ARTIFACTS } from "./lib.mjs";

const argOut = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : null;
const OUT = argOut || join(ARTIFACTS, "scenarios");
const SHOTS = join(OUT, "shots");
ensureDir(SHOTS);
const log = (...a) => console.log("[scenarios]", ...a);

if (!(await isServerUp())) { console.error("[scenarios] dev server not on :5174"); process.exit(2); }

const { browser, page, errors } = await launchBrowser();
let fail = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? "  — " + extra : ""}`); if (!ok) fail++; };
const cut = (name, opts) => page.evaluate(([n, o]) => window.__rh3debug.scenario(n, o || {}), [name, opts]);
const probe = (fn) => page.evaluate(fn);

try {
  await bootGame(page);
  await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
  await sleep(700);
  await page.locator(".hero-card").first().click();
  await sleep(800);
  if (await page.locator(".story-skip").count()) await page.locator(".story-skip").click();
  await sleep(1800);

  // The API must be present.
  check("__rh3debug exposed", await probe(() => typeof window.__rh3debug?.scenario === "function"));
  log("scenarios: " + JSON.stringify(await probe(() => window.__rh3debug.list())));

  // 1) Boss + phase jump. The colossus has a long seismic entrance, so poll for the
  // phase to land rather than guessing a fixed wait.
  await cut("boss:colossus:p2");
  let bossInfo = null;
  for (let i = 0; i < 50; i++) {
    await sleep(200);
    bossInfo = await probe(() => { const b = window.__rh3debug.boss0(); return b ? { kind: window.__rh3.run.currentNode?.bossKind, phase: b.phase } : null; });
    if (bossInfo && bossInfo.phase >= 2) break;
  }
  check("boss:colossus:p2 → colossus at phase ≥2", !!bossInfo && bossInfo.kind === "colossus" && bossInfo.phase >= 2, JSON.stringify(bossInfo));
  await page.evaluate(() => window.__rh3debug.frame(window.__rh3debug.boss0()?.pos.x ?? 0, window.__rh3debug.boss0()?.pos.z ?? 0, 0.5));
  await page.evaluate(() => window.__rh3debug.godmode());
  await sleep(1200);
  await page.screenshot({ path: join(SHOTS, "boss-colossus-p2.png") });

  // 2) Single framed enemy.
  await cut("enemy:caster");
  await sleep(2600);
  const enemyInfo = await probe(() => { const e = window.__rh3.enemies.living().find((x) => x.kind === "caster"); return e ? { kind: e.kind } : null; });
  check("enemy:caster → a caster is present", !!enemyInfo, JSON.stringify(enemyInfo));
  await page.screenshot({ path: join(SHOTS, "enemy-caster.png") });

  // 3) A node kind.
  await cut("room:elite");
  await sleep(2600);
  check("room:elite → in a fight", await probe(() => window.__rh3.run.state === "fighting" || window.__rh3.enemies.living().length > 0));
  await page.evaluate(() => window.__rh3debug.godmode());
  await page.screenshot({ path: join(SHOTS, "room-elite.png") });

  // 4) UI cut.
  await cut("menu");
  await sleep(900);
  check("menu → back at the menu", await probe(() => window.__rh3debug.state() === "menu"));
  await page.screenshot({ path: join(SHOTS, "menu.png") });

  // 5) Unknown scenario is rejected, not thrown.
  check("unknown scenario returns false", (await cut("nope:nope")) === false);
} catch (err) {
  errors.push(`THREW: ${err.message}`);
  log("ERROR:", err.message);
  fail++;
} finally {
  console.log(errors.length ? `CONSOLE ERRORS (${errors.length}):\n${errors.slice(0, 8).join("\n")}` : "NO CONSOLE ERRORS");
  console.log(fail === 0 && errors.length === 0 ? "SCENARIOS: ALL PASS" : `SCENARIOS: ${fail} FAIL`);
  await browser.close();
  process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
}
