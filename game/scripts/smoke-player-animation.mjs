import { guard } from "./lib/guard.cjs";
guard(); // test-run governor: watchdog + machine lock + memory sentinel (lib/guard.cjs)
// Player visual smoke: walking should keep a grounded stride without side sway,
// and the hero body should not contain the old glowing back torus.
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
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

let fail = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " - " + extra : ""}`);
  if (!ok) fail++;
};

await page.goto("http://localhost:5174", { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.removeItem("rh3v2-runsave"));
await page.waitForTimeout(1200);
await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
await page.waitForTimeout(600);
await page.locator(".hero-card").first().click();
await page.waitForTimeout(700);
if (await page.locator(".story-skip").count()) await page.locator(".story-skip").click();
await page.waitForTimeout(2200);

await page.evaluate(() => {
  const c = window.__rh3;
  c.enemies.clear();
  c.hostiles.clear();
  c.run.state = "idle";
  c.player.hp = c.player.maxHp;
});
await page.mouse.move(1180, 260);
await page.keyboard.down("w");
await page.keyboard.down("d");
await page.waitForTimeout(900);
await page.screenshot({ path: join(OUT, "player-walk-layered.png") });
const moving = await page.evaluate(() => {
  const p = window.__rh3.player;
  let torusCount = 0;
  let meshCount = 0;
  let vertexCount = 0;
  p.body.traverse((o) => {
    if (o?.isMesh) {
      meshCount++;
      vertexCount += o.geometry?.attributes?.position?.count ?? 0;
    }
    if (o?.geometry?.type === "TorusGeometry") torusCount++;
  });
  return {
    move: p.animMoveAmount,
    bodyZ: p.body.rotation.z,
    bodyX: p.body.rotation.x,
    torsoY: p.torso.rotation.y,
    torsoZ: p.torso.rotation.z,
    capeY: p.cape.rotation.y,
    capeZ: p.cape.rotation.z,
    legDelta: Math.abs(p.legR.rotation.x - p.legL.rotation.x),
    side: p.moveSide,
    forward: p.moveForward,
    torusCount,
    meshCount,
    vertexCount,
  };
});
await page.keyboard.up("w");
await page.keyboard.up("d");

check("walk input drives movement animation", moving.move > 0.35, JSON.stringify(moving));
check("walk pose has visible leg stride", moving.legDelta > 0.15, JSON.stringify(moving));
check("walk pose keeps body side sway restrained", Math.abs(moving.bodyZ) + Math.abs(moving.torsoZ) + Math.abs(moving.torsoY) < 0.035, JSON.stringify(moving));
check("walk pose still has controlled forward lean", Math.abs(moving.bodyX) > 0.015 && Math.abs(moving.bodyX) < 0.08, JSON.stringify(moving));
check("cape stays visually stable while moving", Math.abs(moving.capeY) + Math.abs(moving.capeZ) < 0.025, JSON.stringify(moving));
check(
  "hero keeps layered detail within a sane draw budget",
  moving.meshCount >= 20 && moving.meshCount <= 40 && moving.vertexCount >= 2500,
  `meshCount=${moving.meshCount}, vertexCount=${moving.vertexCount}`,
);
check("hero body has no back torus arc", moving.torusCount === 0, `torusCount=${moving.torusCount}`);

// Deterministic authored contacts: pose through the debug presentation seam, freeze
// the world, and assert the normalized timing contract before capturing each cut.
await page.evaluate(() => {
  const p = window.__rh3.player.pos;
  window.__rh3debug.frame(p.x, p.z, 0.42);
});
await page.waitForTimeout(700);
await page.evaluate(() => window.__rh3debug.freezeForTest(true));
for (const [action, stage, family, phase] of [
  ["combo1", 1, "blade-opener", 0.29],
  ["combo2", 2, "blade-return", 0.33],
  ["combo3", 3, "blade-finisher", 0.44],
]) {
  const pose = await page.evaluate(({ action, phase }) => window.__rh3debug.playerPose(action, phase), { action, phase });
  check(`combo ${stage} has distinct identity`, pose.action === `attack${stage}` && pose.attackFamily === family && pose.segment === "active", JSON.stringify(pose));
  await page.screenshot({ path: join(OUT, `player-combo-${stage}-contact.png`) });
}
const comboJoins = await page.evaluate(() => {
  const sample = (action, phase) => {
    window.__rh3debug.playerPose(action, phase);
    const p = window.__rh3.player;
    return [p.armR.rotation.x, p.armR.rotation.y, p.armR.rotation.z,
      p.armL.rotation.x, p.armL.rotation.z, p.torso.rotation.x,
      p.torso.rotation.y, p.torso.rotation.z];
  };
  const delta = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
  return {
    openerToReturn: delta(sample("combo1", 0.999), sample("combo2", 0.001)),
    returnToFinisher: delta(sample("combo2", 0.999), sample("combo3", 0.001)),
    finisherToOpener: delta(sample("combo3", 0.999), sample("combo1", 0.001)),
  };
});
check(
  "buffered combo pose joins do not snap",
  Math.max(comboJoins.openerToReturn, comboJoins.returnToFinisher, comboJoins.finisherToOpener) < 0.12,
  JSON.stringify(comboJoins),
);
const dodge = await page.evaluate(() => window.__rh3debug.playerPose("dodge", 0.5));
check("dodge exposes authored action", dodge.action === "dodge", JSON.stringify(dodge));
await page.screenshot({ path: join(OUT, "player-dodge-contact.png") });
const rollTravel = await page.evaluate(() => {
  const at = (phase) => {
    window.__rh3debug.playerPose("dodge", phase);
    return window.__rh3.player.rollGroup.rotation.x;
  };
  return [at(0.05), at(0.25), at(0.5), at(0.75), at(0.95)];
});
check(
  "dodge performs a complete forward roll",
  rollTravel[0] < 0.08 && rollTravel[2] > 3.0 && rollTravel[4] > 6.15,
  JSON.stringify(rollTravel),
);

const heroFamilies = {
  blade: "blade-finisher", bulwark: "bulwark-cleave", sparkmage: "sparkmage-conduit",
  reaver: "reaver-hook", tempest: "tempest-cyclone", revenant: "revenant-reap",
};
for (const [hero, family] of Object.entries(heroFamilies)) {
  const contact = await page.evaluate(({ hero }) => window.__rh3debug.heroPose(hero, "combo3", 0.44), { hero });
  check(`${hero} has authored contact family`, contact.action === "attack3" && contact.attackFamily === family && contact.segment === "active", JSON.stringify(contact));
  await page.screenshot({ path: join(OUT, `hero-${hero}-contact.png`) });
  const heroDodge = await page.evaluate(({ hero }) => window.__rh3debug.heroPose(hero, "dodge", hero === "blade" ? 0.34 : 0.5), { hero });
  check(`${hero} has authored dodge`, heroDodge.action === "dodge", JSON.stringify(heroDodge));
  await page.screenshot({ path: join(OUT, `hero-${hero}-dodge.png`) });
  const victory = await page.evaluate(({ hero }) => window.__rh3debug.heroPose(hero, "victory", 0.5), { hero });
  check(`${hero} has authored victory`, victory.action === "victory", JSON.stringify(victory));
  await page.screenshot({ path: join(OUT, `hero-${hero}-victory.png`) });
}
await page.evaluate(() => { window.__rh3debug.playerPose("idle", 0); window.__rh3debug.freezeForTest(false); });

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join("\n")}` : "NO CONSOLE ERRORS");
console.log(fail === 0 && errors.length === 0 ? "PLAYER ANIMATION: ALL PASS" : `PLAYER ANIMATION: ${fail} FAILURES`);
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
