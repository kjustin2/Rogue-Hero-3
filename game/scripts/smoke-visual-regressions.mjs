import { guard } from "./lib/guard.cjs";
guard();
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const EXE = join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1217/chrome-win64/chrome.exe");
mkdirSync("shots", { recursive: true });
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errors = [];
let fail = 0;
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? ` - ${extra}` : ""}`);
  if (!ok) fail++;
};

await page.goto("http://localhost:5174", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.removeItem("rh3v2-runsave");
  localStorage.removeItem("rh3v2-profile");
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForFunction(() => window.__rh3boot?.ready === true, null, { timeout: 20000 });
await page.screenshot({ path: "shots/regression-main-menu.png" });

await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
await page.locator(".hero-confirm").waitFor({ state: "visible", timeout: 12000 });
const hero = await page.evaluate(() => ({
  cards: [...document.querySelectorAll(".hero-card")].filter((el) => getComputedStyle(el).display !== "none").length,
  active: [...document.querySelectorAll(".hero-card--active")].filter((el) => getComputedStyle(el).display !== "none").length,
  hudOpacity: Number(getComputedStyle(document.getElementById("hud")).opacity),
  backdrop: getComputedStyle(document.querySelector(".screen--dim")).backgroundImage,
}));
check("hero select has one focused hero and no stale combat HUD", hero.cards === 3 && hero.active === 1 && hero.hudOpacity === 0, JSON.stringify(hero));
check("hero select owns an opaque authored backdrop", hero.backdrop !== "none" && !/rgba\([^)]*,\s*0(?:\.\d+)?\)/.test(hero.backdrop), hero.backdrop);
// The full-size hero-selection plate is owned by the Act I presentation
// gallery; this regression validates its geometry/state without emitting a
// duplicate frame that weakens gallery freshness checks.

await page.locator(".hero-confirm").click();
await page.locator(".story-skip").waitFor({ state: "visible", timeout: 12000 });
await page.locator(".story-skip").click();
await page.waitForTimeout(900);
await page.evaluate(() => {
  const source = window.__rh3.run.forkOptions();
  const options = source.length > 1 ? source : [source[0], { ...source[0], id: `${source[0].id}-alignment-probe`, name: "Broken Ground" }];
  window.__rh3menus.showMap(options, window.__rh3.run.position, window.__rh3.run.plan.forks.length, () => {});
});
await page.waitForTimeout(120);
const map = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll(".mapnode")];
  const rects = nodes.map((node) => node.getBoundingClientRect());
  const spread = (values) => Math.max(...values) - Math.min(...values);
  return {
    nodes: nodes.length,
    topSpread: spread(rects.map((r) => r.top)),
    heightSpread: spread(rects.map((r) => r.height)),
    hudOpacity: Number(getComputedStyle(document.getElementById("hud")).opacity),
    backdrop: getComputedStyle(document.querySelector(".route-map"), "::before").backgroundImage,
  };
});
check("map choices are level and equal height", map.nodes >= 2 && map.topSpread <= 1 && map.heightSpread <= 1, JSON.stringify(map));
check("map hides the gameplay layer", map.hudOpacity === 0 && map.backdrop !== "none", JSON.stringify(map));
await page.screenshot({ path: "shots/regression-route-map.png" });

await page.evaluate(() => {
  window.__rh3menus.clear();
  window.__rh3debug.scenario("room:combat", { act: 1 });
});
await page.waitForTimeout(900);
const camera = await page.evaluate(() => ({
  framing: window.__rh3debug.cameraFraming(),
  actors: window.__rh3debug.actorFraming(),
}));
check(
  "gameplay uses the authored three-quarter lens",
  camera.framing.mode === "follow"
    && camera.framing.pitchDeg >= 34
    && camera.framing.pitchDeg <= 42
    && camera.framing.eyeDistance >= 17
    && camera.framing.eyeDistance <= 19,
  JSON.stringify(camera.framing),
);
check(
  "three-quarter gameplay lens keeps active actors framed",
  camera.actors.length >= 2 && camera.actors.every((actor) => actor.inFrame),
  JSON.stringify(camera.actors),
);
const action = await page.evaluate(async () => {
  const c = window.__rh3;
  document.querySelector(".banner")?.classList.remove("banner--show");
  document.querySelectorAll(".actcard").forEach((el) => el.remove());
  const ids = ["dash-strike", "arc-bolt", "warcry"];
  c.deck.slots = ids.map((id) => window.__rh3cards.find((card) => card.id === id));
  c.deck.upgraded = [false, false, false];
  c.deck.cooldowns = [0, 0, 0];
  c.player.hp = 16;
  c.player.spawnGhost();
  c.player.spawnGhost();
  c.player.spawnGhost();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  let ghostMeshes = 0;
  c.stage.scene.traverse((o) => {
    if (o.isMesh && o.geometry?.type === "TorusGeometry" && o.material?.transparent && o.userData?.dodgeEcho === true) ghostMeshes++;
  });
  const slots = [...document.querySelectorAll(".slot")].map((slot) => ({
    id: slot.dataset.cardId,
    name: slot.querySelector(".slot__name")?.textContent,
    sigilDisplay: getComputedStyle(slot.querySelector(".slot__sigil")).display,
  }));
  return {
    ghostMeshes,
    slots,
    flashBackground: getComputedStyle(document.querySelector(".screenflash")).backgroundColor,
    flashShadow: getComputedStyle(document.querySelector(".screenflash")).boxShadow,
    tempoTint: c.stage.tintAmtTarget,
  };
});
check("dodge uses three lightweight pooled ground echoes", action.ghostMeshes === 3, JSON.stringify(action));
check("HUD names remain visible and decorative sigils stay out of their way", action.slots.length === 3 && action.slots.every((s) => s.id && s.name && s.sigilDisplay === "none"), JSON.stringify(action.slots));
check("combat feedback is edge-only with no whole-frame tempo tint", action.flashBackground === "rgba(0, 0, 0, 0)" && action.flashShadow !== "none" && action.tempoTint === 0, JSON.stringify(action));
await page.screenshot({ path: "shots/regression-combat-hud.png" });

check("no console errors", errors.length === 0, errors.slice(0, 8).join("\n"));
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
