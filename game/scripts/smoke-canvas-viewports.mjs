import { guard } from "./lib/guard.cjs";
guard(); // test-run governor: watchdog + machine lock + memory sentinel (lib/guard.cjs)
// Canvas viewport smoke: verify the WebGL scene is nonblank on desktop and mobile.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const EXE = join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1217/chrome-win64/chrome.exe");
const OUT = "shots";
mkdirSync(OUT, { recursive: true });

const viewports = [
  { name: "desktop", width: 1600, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

let fail = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? "  - " + extra : ""}`);
  if (!ok) fail++;
};

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const errors = [];

for (const vp of viewports) {
  const page = await (await browser.newContext({ viewport: { width: vp.width, height: vp.height } })).newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(`[${vp.name}] ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`[${vp.name}] PAGEERROR: ${e.message}`));
  await page.goto("http://localhost:5174", { waitUntil: "networkidle" });
  await page.locator("#rift-loader").waitFor({ state: "hidden", timeout: 12000 });
  await page.waitForTimeout(500);
  const canvasInfo = await page.evaluate(async () => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return { ok: false, reason: "missing canvas" };
    const rect = canvas.getBoundingClientRect();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { ok: true, rectW: rect.width, rectH: rect.height };
  });
  // Reading the default WebGL backbuffer outside its render callback legitimately
  // returns zeroes when preserveDrawingBuffer=false. Inspect the composed canvas
  // pixels captured by Chromium instead—the same pixels the player actually sees.
  const png = await page.locator("canvas").screenshot({ path: join(OUT, `canvas-${vp.name}.png`) });
  const { data } = await sharp(png).resize(20, 20, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let nonBlack = 0, bright = 0;
  for (let i = 0; i < data.length; i += 3) {
    const value = data[i] + data[i + 1] + data[i + 2];
    if (value > 18) nonBlack++;
    if (value > 160) bright++;
  }
  const sample = { ...canvasInfo, ok: canvasInfo.ok && nonBlack >= 32 && bright >= 2, nonBlack, bright };
  check(`${vp.name} canvas is visible`, sample.rectW >= vp.width * 0.9 && sample.rectH >= vp.height * 0.9, JSON.stringify(sample));
  check(`${vp.name} canvas has rendered pixels`, sample.ok === true, JSON.stringify(sample));
  await page.close();
}

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join("\n")}` : "NO CONSOLE ERRORS");
console.log(fail === 0 && errors.length === 0 ? "CANVAS VIEWPORTS: ALL PASS" : `CANVAS VIEWPORTS: ${fail} FAILURES`);
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
