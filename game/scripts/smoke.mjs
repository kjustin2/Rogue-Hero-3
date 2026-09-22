// The only automated test: a brief real-input standalone loop, under 30 seconds.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { _electron } from "playwright-core";
import executablePath from "electron";
const root = resolve(import.meta.dirname, ".."),
  profile = mkdtempSync(join(tmpdir(), "rogue-smoke-"));
let app,
  pid,
  page,
  step = "launch";
const started = performance.now(),
  errors = [];
function kill() {
  if (pid)
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
      timeout: 2000,
    });
}
const deadline = setTimeout(() => {
  console.error(`SMOKE FAIL: 30-second deadline at ${step}`);
  kill();
  process.exit(1);
}, 30000);
try {
  app = await _electron.launch({
    executablePath: process.env.ROGUE_EXECUTABLE || executablePath,
    args: process.env.ROGUE_EXECUTABLE ? [] : [root],
    env: { ...process.env, RH3_SMOKE: "1", RH3_USER_DATA: profile },
    timeout: 12000,
  });
  pid = app.process().pid;
  page = await app.firstWindow();
  page.setDefaultTimeout(3000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page
    .getByRole("button", { name: "New run", exact: true })
    .waitFor();
  const shots = process.argv.includes("--screenshots");
  if (shots) {
    mkdirSync(join(root, "shots"), { recursive: true });
    await page.screenshot({ path: join(root, "shots/title.png") });
  }
  await page
    .getByRole("button", { name: "New run", exact: true })
    .click();
  await page.getByRole("button", { name: "Skip intro", exact: true }).click();
  await page.waitForFunction(() => window.__rogue?.state().phase === "fight");
  const before = await page.evaluate(() => window.__rogue.state());
  step = "move";
  await page.keyboard.down("KeyW");
  await page.waitForFunction(
    (before) => {
      const current = window.__rogue.state();
      return Math.hypot(current.x - before.x, current.z - before.z) > 0.3;
    },
    before,
    { timeout: 3000 },
  );
  await page.keyboard.up("KeyW");
  const moved = await page.evaluate(() => window.__rogue.state());
  assert(Math.hypot(moved.x - before.x, moved.z - before.z) > 0.3);
  step = "slash";
  await page.mouse.click(600, 280);
  await page.waitForFunction(() => window.__rogue.state().action === "slash");
  await page.waitForFunction(() => window.__rogue.state().action === "idle");
  step = "heavy";
  await page.mouse.click(600, 280, { button: "right" });
  await page.waitForFunction(() => window.__rogue.state().action === "heavy");
  await page.waitForFunction(() => window.__rogue.state().action === "idle");
  step = "dodge";
  await page.keyboard.press("Space");
  await page.waitForFunction(() => window.__rogue.state().action === "dodge");
  if (shots) {
    await page.waitForFunction(() =>
      window.__rogue
        .state()
        .threats.some((e) => e.kind === "hook" && e.action === "tell"),
    );
    await page.screenshot({ path: join(root, "shots/combat.png") });
  }
  step = "pause";
  await page.keyboard.down("Escape");
  await page.keyboard.down("Escape"); // Auto-repeat must not immediately unpause.
  await page.keyboard.up("Escape");
  assert((await page.evaluate(() => window.__rogue.state())).paused);
  const paused = await page.evaluate(() => window.__rogue.state());
  await page.waitForTimeout(100);
  assert.deepEqual(await page.evaluate(() => window.__rogue.state()), paused);
  await page
    .getByRole("button", { name: "Resume", exact: true })
    .click();
  assert(!(await page.evaluate(() => window.__rogue.state())).paused);
  // The same short run checks the new menu path and chamber checkpoint.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Options", exact: true }).click();
  const volume = page.getByRole("slider", { name: "Sound volume" });
  await volume.press("Home");
  await volume.press("ArrowRight");
  assert.equal(await volume.inputValue(), "5");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Exit run", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Options", exact: true }).click();
  assert.equal(await page.getByRole("slider", { name: "Sound volume" }).inputValue(), "5");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: /^Continue/ }).click();
  assert.equal((await page.evaluate(() => window.__rogue.state())).phase, "fight");
  assert.equal((await page.evaluate(() => window.__rogue.state())).hp, 100);
  assert.deepEqual(errors, []);
  console.log(
    `SMOKE PASS: move, slash, heavy, dodge, pause/resume, volume and continue (${((performance.now() - started) / 1000).toFixed(1)}s before cleanup)`,
  );
} catch (error) {
  console.error(step, error);
  if (page)
    console.error(
      await page.evaluate(() => window.__rogue?.state()).catch(() => null),
    );
  process.exitCode = 1;
} finally {
  if (app) await app.close().catch(() => {});
  kill();
  clearTimeout(deadline);
  rmSync(profile, { recursive: true, force: true });
}
