// Menu performance smoke: samples animation-frame deltas and browser long tasks
// across the initial flow. Set RH3_URL to override the dev-server URL and
// MENU_PERF_CPU=1 to disable the default stress throttle.
import { chromium } from "playwright-core";
import { join } from "node:path";

const EXE = join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1217/chrome-win64/chrome.exe");
const URL = process.env.RH3_URL ?? "http://localhost:5174";
const CPU = Number(process.env.MENU_PERF_CPU ?? "3");

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await context.newPage();
if (CPU > 1) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
}

await page.addInitScript(() => {
  const w = window;
  const perf = { frames: [], longTasks: [], last: 0 };
  w.__menuPerf = perf;
  const raf = (t) => {
    if (perf.last) perf.frames.push(t - perf.last);
    perf.last = t;
    requestAnimationFrame(raf);
  };
  requestAnimationFrame(raf);
  try {
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        perf.longTasks.push({ start: e.startTime, duration: e.duration, name: e.name });
      }
    });
    obs.observe({ type: "longtask", buffered: true });
  } catch {
    /* longtask unsupported */
  }
  w.__menuPerfReset = () => {
    perf.frames.length = 0;
    perf.longTasks.length = 0;
    perf.last = 0;
  };
  w.__menuPerfStats = () => {
    const frames = perf.frames.slice(1);
    const sorted = [...frames].sort((a, b) => a - b);
    const pct = (p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;
    return {
      count: frames.length,
      max: Math.round(pct(1)),
      p95: Math.round(pct(0.95)),
      p99: Math.round(pct(0.99)),
      over50: frames.filter((v) => v > 50).length,
      over100: frames.filter((v) => v > 100).length,
      longCount: perf.longTasks.length,
      longMax: Math.round(Math.max(0, ...perf.longTasks.map((e) => e.duration))),
      longTotal: Math.round(perf.longTasks.reduce((a, e) => a + e.duration, 0)),
    };
  };
});

const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

let fail = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " - " + extra : ""}`);
  if (!ok) fail++;
};

async function resetPerf() {
  await page.evaluate(() => window.__menuPerfReset());
}

async function readPerf() {
  return page.evaluate(() => window.__menuPerfStats());
}

function budgetFor(name) {
  if (/quality/i.test(name)) return { max: 900, p95: 190, longMax: 750 };
  if (/boot/i.test(name)) return { max: 900, p95: 190, longMax: 750 };
  if (/dwell/i.test(name)) return { max: 900, p95: 190, longMax: 750 };
  return { max: 750, p95: 180, longMax: 650 };
}

async function measure(name, fn, settleMs = 650) {
  await resetPerf();
  const t0 = performance.now();
  await fn();
  await page.waitForTimeout(settleMs);
  const s = await readPerf();
  const wall = Math.round(performance.now() - t0);
  const b = budgetFor(name);
  console.log(`  ${name}: wall=${wall}ms frames=${s.count} max=${s.max}ms p95=${s.p95}ms longMax=${s.longMax}ms longTotal=${s.longTotal}ms`);
  check(`${name} stays under stall budget`, s.max < b.max && s.longMax < b.longMax, JSON.stringify(s));
  check(`${name} keeps p95 frame pacing reasonable`, s.p95 < b.p95, JSON.stringify(s));
  return s;
}

async function backToMain() {
  if (await page.locator(".draft-skip", { hasText: "BACK" }).count()) {
    await page.locator(".draft-skip", { hasText: "BACK" }).click();
    await page.waitForTimeout(250);
    return;
  }
  const dataBack = page.locator('[data-act="back"]');
  if (await dataBack.count()) {
    await dataBack.last().click();
    await page.waitForTimeout(250);
    return;
  }
  const textBack = page.locator("button", { hasText: /^Back$/i });
  if (await textBack.count()) {
    await textBack.last().click();
    await page.waitForTimeout(250);
  }
}

await page.goto(URL, { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.removeItem("rh3v2-runsave");
  localStorage.removeItem("rh3v2-profile");
  localStorage.removeItem("rh3v2-settings");
});
await resetPerf();
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1100);
const boot = await readPerf();
console.log(`  boot main: frames=${boot.count} max=${boot.max}ms p95=${boot.p95}ms longMax=${boot.longMax}ms longTotal=${boot.longTotal}ms`);
check("boot reaches main menu", await page.locator(".screen--main").count() === 1);
check("boot stays under stall budget", boot.max < 900 && boot.longMax < 750, JSON.stringify(boot));
check("boot keeps p95 frame pacing reasonable", boot.p95 < 190, JSON.stringify(boot));

await measure("main to fresh hero select", async () => {
  await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
  await page.locator(".hero-card").first().waitFor();
}, 700);
check("fresh hero select renders heroes", await page.locator(".hero-card").count() >= 1);

await measure("quick sweep over hero cards", async () => {
  const cards = await page.locator(".hero-card").count();
  for (let i = 0; i < cards; i++) {
    await page.locator(".hero-card").nth(i).hover();
    await page.waitForTimeout(40);
  }
}, 500);

await measure("rerender full unlocked hero select", async () => {
  await page.evaluate(() => {
    const unlocks = window.__rh3.profile.data.unlocks;
    for (const h of window.__rh3heroes) {
      const key = `hero:${h.id}`;
      if (!unlocks.includes(key)) unlocks.push(key);
    }
    for (const key of ["blessing:vigor", "blessing:fortune", "blessing:arsenal"]) {
      if (!unlocks.includes(key)) unlocks.push(key);
    }
    window.__rh3menus.showHeroSelect();
  });
  await page.locator(".hero-card").nth(1).waitFor();
}, 700);

await measure("dwell preview alternate hero", async () => {
  await page.locator(".hero-card").nth(1).hover();
  await page.waitForTimeout(320);
}, 500);

await measure("click blessing chips", async () => {
  const chips = await page.locator(".blessing-chip:not(.blessing-chip--locked)").count();
  for (let i = 0; i < chips; i++) {
    await page.locator(".blessing-chip:not(.blessing-chip--locked)").nth(i).click();
    await page.waitForTimeout(60);
  }
}, 500);
check("blessing selection remains visible", await page.locator(".blessing-chip--on").count() === 1);

await backToMain();
await measure("main to daily hero select", async () => {
  await page.locator("button", { hasText: /Daily Challenge/i }).click();
  await page.locator(".draft-title", { hasText: /Daily Challenge/i }).waitFor();
}, 650);
await backToMain();

await measure("main to settings", async () => {
  await page.locator("button", { hasText: "Settings" }).click();
  await page.locator(".panel", { hasText: "SETTINGS" }).waitFor();
}, 550);
await measure("settings quality toggles", async () => {
  await page.locator('.qbtn[data-q="low"]').click();
  await page.waitForTimeout(90);
  await page.locator('.qbtn[data-q="high"]').click();
  await page.waitForTimeout(90);
}, 900);
await backToMain();

await measure("main to progress", async () => {
  await page.locator("button", { hasText: "Progress" }).click();
  await page.locator(".panel", { hasText: "PROGRESS" }).waitFor();
}, 650);
await backToMain();

await measure("main to armory", async () => {
  await page.locator("button", { hasText: "Armory" }).click();
  await page.locator(".panel", { hasText: "ARMORY" }).waitFor();
}, 650);
await backToMain();

await measure("main to how to play", async () => {
  await page.locator("button", { hasText: "How to Play" }).click();
  await page.locator(".panel", { hasText: "HOW TO PLAY" }).waitFor();
}, 650);
await backToMain();

await measure("hero select to opening story", async () => {
  await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
  await page.locator(".hero-card").first().click();
  await page.locator(".story-skip").waitFor();
}, 900);
await measure("skip opening story to next screen", async () => {
  await page.locator(".story-skip").click();
  await page.waitForSelector(".story-skip", { state: "detached", timeout: 10000 }).catch(() => {});
}, 1100);
const storyTarget = await page.evaluate(() => ({
  playing: !!window.__rh3.playing,
  mapNodes: document.querySelectorAll(".mapnode").length,
  title: document.querySelector(".draft-title")?.textContent ?? "",
}));
check("skip opening story reaches map or fight", storyTarget.playing || storyTarget.mapNodes > 0 || /CHOOSE YOUR PATH/i.test(storyTarget.title), JSON.stringify(storyTarget));

check("no console errors", errors.length === 0, errors.slice(0, 5).join("\n"));
console.log(fail === 0 ? "MENU-PERF: ALL PASS" : `MENU-PERF: ${fail} FAILURES`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
