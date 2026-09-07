// One short smoke: boot, enter a room, move, attack, pause, resume. No suite.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir, setPriority, constants } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createServer } from "vite";
import { _electron } from "playwright-core";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const started = performance.now();
const profile = mkdtempSync(join(tmpdir(), "rh3-smoke-"));
const lock = join(tmpdir(), "game-test-guard.lock");
let ownsLock = false, passed = false, server, app, child;
const errors = [];
const screenshots = process.argv.includes("--screenshots");
const production = process.argv.includes("--production");
let step = "launch";
function killChild() {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", timeout: 3000 });
  else child.kill("SIGKILL");
}
function unlock() {
  if (ownsLock) { rmSync(lock, { force: true }); ownsLock = false; }
}
const watchdog = setTimeout(() => {
  console.error("SMOKE FAIL: exceeded 30 seconds");
  killChild(); unlock(); process.exit(1);
}, 30000);
process.on("exit", () => { killChild(); unlock(); });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { killChild(); unlock(); process.exit(1); });

try {
  try { setPriority(constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* optional */ }
  try {
    const previous = JSON.parse(readFileSync(lock, "utf8"));
    let alive = false;
    try { process.kill(previous.pid, 0); alive = true; } catch { /* stale */ }
    if (alive) throw new Error(`Another game smoke is running (PID ${previous.pid}).`);
    rmSync(lock, { force: true });
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  writeFileSync(lock, JSON.stringify({ pid: process.pid, name: "rh3-smoke" }), { flag: "wx" });
  ownsLock = true;
  if (!production) {
    server = await createServer({ root, server: { host: "127.0.0.1", port: 5174, strictPort: true }, logLevel: "error" });
    await server.listen();
  }
  const env = { ...process.env, RH3_SMOKE: "1", RH3_USER_DATA: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  if (!production) env.RH3_SMOKE_URL = "http://127.0.0.1:5174";
  app = await _electron.launch({ args: [join(root, "electron-main.cjs")], env, timeout: 12000 });
  child = app.process();
  const page = await app.firstWindow({ timeout: 10000 });
  page.setDefaultTimeout(8000);
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", msg => { if (msg.type() === "error") errors.push(msg.text()); });
  await page.waitForFunction(() => window.__rh3boot?.ready === true, null, { timeout: 18000 });
  await page.locator(".screen--main").waitFor({ state: "visible" });
  const out = join(root, "shots", "smoke");
  if (screenshots) {
    mkdirSync(out, { recursive: true });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(out, "menu.png") });
  }
  await page.getByRole("button", { name: /Begin Run|New Run/i }).first().waitFor({ state: "visible" });
  // Manual testing owns the complete story/run flow. Smoke enters one real room.
  assert(await page.evaluate(() => {
    const loaded = window.__rh3debug.scenario("room:combat", { act: 1 });
    // One immediate actor keeps the check independent of entrance timing.
    const p = window.__rh3.player.pos;
    window.__rh3.enemies.spawn("husk", p.x + 3, p.z - 2, 0);
    return loaded;
  }), "Combat room failed to load");
  step = "movement";
  await page.waitForFunction(() => window.__rh3state() === "playing");
  assert(await page.evaluate(() => window.__rh3.cam.mode === "follow" && !!window.__rh3.deck.slots[0]), "Gameplay camera or starter hand missing");
  await page.waitForFunction(() => window.__rh3.enemies.living().length > 0);
  const before = await page.evaluate(() => ({ x: window.__rh3.player.pos.x, z: window.__rh3.player.pos.z }));
  await page.keyboard.down("KeyD");
  await page.mouse.move(800, 360);
  await page.mouse.down();
  await page.waitForTimeout(250);
  await page.mouse.up();
  await page.keyboard.up("KeyD");
  const after = await page.evaluate(() => ({ x: window.__rh3.player.pos.x, z: window.__rh3.player.pos.z, alive: window.__rh3.player.alive }));
  assert(Math.hypot(after.x - before.x, after.z - before.z) > 0.05 && after.alive, "Hero did not move in live gameplay");
  step = "first dash";
  await page.keyboard.press("Space");
  await page.waitForFunction(() => window.__rh3.controller.dashCharges === 1);
  await page.waitForTimeout(260);
  step = "second dash";
  await page.keyboard.press("Space");
  await page.waitForFunction(() => window.__rh3.controller.dashCharges === 0);
  step = "card";
  await page.keyboard.press("Digit1");
  await page.waitForFunction(() => window.__rh3.deck.cooldowns[0] > 0);
  await page.waitForTimeout(250);
  if (screenshots) {
    await page.locator(".actcard").waitFor({ state: "detached" });
    await page.screenshot({ path: join(out, "combat.png") });
  }
  await page.keyboard.press("Escape");
  step = "pause";
  await page.waitForFunction(() => window.__rh3state() === "paused");
  await page.keyboard.press("Escape");
  step = "resume";
  await page.waitForFunction(() => window.__rh3state() === "playing");
  errors.push(...await page.evaluate(() => window.__rh3debug.frameErrors().map(e => e.msg)));
  assert.deepEqual(errors, [], "Runtime errors");
  passed = true;
} catch (error) {
  console.error(`SMOKE FAIL (${step}):`, error.message);
  if (app) {
    const page = app.windows()[0];
    if (page) console.error(await page.evaluate(() => ({ boot: window.__rh3boot, state: window.__rh3state?.(), time: window.__rh3?.stats.time, errors: window.__rh3debug?.frameErrors(), text: document.body.innerText.slice(-500) })).catch(() => "Renderer unavailable"));
  }
  if (errors.length) console.error(errors);
  process.exitCode = 1;
} finally {
  if (app) await Promise.race([app.close().catch(() => {}), new Promise(resolve => setTimeout(resolve, 1500))]);
  killChild();
  if (server) await server.close();
  unlock();
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* OS may release cache handles later */ }
  clearTimeout(watchdog);
}
if (passed) console.log(`SMOKE PASS (${((performance.now() - started) / 1000).toFixed(1)}s including cleanup): boot, combat, movement, attack, dodge, card, pause/resume`);
