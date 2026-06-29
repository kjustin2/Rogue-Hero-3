// Performance stress smoke: loads a dense combat room, keeps many enemies,
// projectiles, particles, card effects, DOM floaters, and SFX events active,
// then samples animation-frame gaps for stall detection. Needs dev server.
import { chromium } from "playwright-core";
import { join } from "node:path";

const EXE = join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1217/chrome-win64/chrome.exe");
const PORT = process.env.RH3_PORT || "5174";

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));

let fail = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " - " + extra : ""}`);
  if (!ok) fail++;
};

await page.goto(`http://127.0.0.1:${PORT}`, { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.removeItem("rh3v2-runsave"));
await page.waitForTimeout(900);
await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
await page.waitForTimeout(500);
await page.locator(".hero-card").first().click();
await page.waitForTimeout(700);
if (await page.locator(".story-skip").count()) await page.locator(".story-skip").click();
await page.waitForTimeout(1700);

await page.evaluate(() => {
  const c = window.__rh3;
  window.__rh3menus.clear();
  c.run.debugLoadNode("combat", 3, 987654, 8);
  window.__rh3menus.clear();
  c.enemies.clear();
  c.projectiles.clear();
  c.hostiles.clear();
  c.caster.clear();
  c.player.hp = c.player.maxHp;
  c.player.pos.set(0, 0, 0);
  c.player.facing = 0;
  c.cam.mode = "follow";
  c.cam.snapTo(0, 0);

  const kinds = [
    "husk", "spitter", "swarmer", "bomber", "sentinel", "wisp",
    "leaper", "tether", "mirror", "caster", "shade", "bastion",
    "brute", "harrier", "splitter", "voidling", "warper",
  ];
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2;
    const r = 7 + (i % 4) * 2.2;
    c.enemies.spawn(kinds[i % kinds.length], Math.sin(a) * r, Math.cos(a) * r, 0);
  }
});
await page.waitForTimeout(900);

await page.evaluate(() => {
  const w = window;
  const c = w.__rh3;
  const cards = w.__rh3cards;
  const byId = (id) => cards.find((card) => card.id === id);
  const castIds = [
    "chain-lightning", "seeker-swarm", "gravity-well", "singularity",
    "meteor-call", "flame-channel", "rend-boomerang", "decoy-totem",
  ];
  const kinds = ["husk", "spitter", "swarmer", "bomber", "sentinel", "wisp", "leaper", "caster", "brute", "warper"];
  let tick = 0;

  w.__perfFrames = [];
  w.__perfHeap = [];
  w.__perfLast = performance.now();
  const probe = () => {
    const now = performance.now();
    w.__perfFrames.push(now - w.__perfLast);
    w.__perfLast = now;
    if (performance.memory) w.__perfHeap.push(performance.memory.usedJSHeapSize / 1048576);
    w.__perfRaf = requestAnimationFrame(probe);
  };
  w.__perfRaf = requestAnimationFrame(probe);

  w.__perfStress = setInterval(() => {
    tick++;
    c.player.hp = c.player.maxHp;
    c.player.pos.set(Math.sin(tick * 0.3) * 1.2, 0, Math.cos(tick * 0.27) * 1.2);
    c.player.facing = tick * 0.23;

    if (c.enemies.living().length < 24) {
      for (let i = 0; i < 8; i++) {
        const a = ((tick + i) / 8) * Math.PI * 2;
        const r = 9 + (i % 3) * 2;
        c.enemies.spawn(kinds[(tick + i) % kinds.length], Math.sin(a) * r, Math.cos(a) * r, 0);
      }
    }

    const card = byId(castIds[tick % castIds.length]);
    if (card) c.caster.cast(card, true);

    for (let i = 0; i < 10; i++) {
      const a = (tick * 0.37) + (i / 10) * Math.PI * 2;
      c.hostiles.fire(Math.sin(a) * 12, Math.cos(a) * 12, a + Math.PI, {
        speed: 10 + (i % 3) * 2, dmg: 2, color: 0xff6644, radius: 0.22, range: 30,
      });
      c.projectiles.fire(c.player.pos.x, c.player.pos.z, a, {
        speed: 14, dmg: 4, color: 0x66e8ff, radius: 0.2, range: 26, pierce: i % 3 === 0,
      });
    }

    c.combat.meleeSweep(c.player.facing, Math.PI * 2, 5.5, 6, 2, tick % 3 === 0);
  }, 140);
});

await page.waitForTimeout(9000);
const stats = await page.evaluate(() => {
  const w = window;
  clearInterval(w.__perfStress);
  cancelAnimationFrame(w.__perfRaf);
  const ft = w.__perfFrames.slice(3);
  const sorted = [...ft].sort((a, b) => a - b);
  const max = Math.max(...ft);
  const mean = ft.reduce((a, b) => a + b, 0) / Math.max(1, ft.length);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
  const over100 = ft.filter((d) => d > 100).length;
  const over200 = ft.filter((d) => d > 200).length;
  const heap = w.__perfHeap || [];
  const heapMin = heap.length ? Math.min(...heap) : 0;
  const heapMax = heap.length ? Math.max(...heap) : 0;
  return {
    count: ft.length,
    max: Math.round(max),
    mean: Math.round(mean),
    p95: Math.round(p95),
    p99: Math.round(p99),
    over100,
    over200,
    heapChurn: Math.round(heapMax - heapMin),
    heapMax: Math.round(heapMax),
    enemies: window.__rh3.enemies.living().length,
  };
});

console.log(`  frames: ${stats.count}, enemies ${stats.enemies}, mean ${stats.mean}ms, p95 ${stats.p95}ms, p99 ${stats.p99}ms, max ${stats.max}ms, >100ms ${stats.over100}, >200ms ${stats.over200}, heap churn ${stats.heapChurn}mb (peak ${stats.heapMax}mb)`);
check("stress test produced enough frame samples", stats.count > 300, `frames ${stats.count}`);
check("no full-stop frame over 240ms", stats.max < 240, `max ${stats.max}ms`);
check("no severe stutter cluster over 200ms", stats.over200 === 0, `${stats.over200} frames`);
check("stress p99 stays under 90ms", stats.p99 < 90, `p99 ${stats.p99}ms`);
// Heap-churn tripwire: a per-frame allocation regression inflates the GC sawtooth.
// Loose by design (headless GC timing is noisy) — only a gross leak/regression trips it.
check("heap churn under 250mb (per-frame alloc regression guard)", stats.heapChurn < 250, `churn ${stats.heapChurn}mb`);

if (errors.length) {
  console.log(`CONSOLE ERRORS (${errors.length}):\n${errors.slice(0, 12).join("\n")}`);
}
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
