// Canvas viewport smoke: verify the WebGL scene is nonblank on desktop and mobile.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

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
  await page.waitForTimeout(1800);
  await page.screenshot({ path: join(OUT, `canvas-${vp.name}.png`) });
  const sample = await page.evaluate(async () => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return { ok: false, reason: "missing canvas" };
    const rect = canvas.getBoundingClientRect();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return { ok: false, reason: "missing webgl context", rectW: rect.width, rectH: rect.height };
    const xs = [0.18, 0.32, 0.5, 0.68, 0.82];
    const ys = [0.2, 0.36, 0.52, 0.68, 0.84];
    const pixel = new Uint8Array(4);
    let nonBlack = 0;
    let bright = 0;
    for (const xPct of xs) {
      for (const yPct of ys) {
        const x = Math.max(0, Math.min(canvas.width - 1, Math.floor(canvas.width * xPct)));
        const y = Math.max(0, Math.min(canvas.height - 1, Math.floor(canvas.height * (1 - yPct))));
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        const v = pixel[0] + pixel[1] + pixel[2];
        if (v > 18) nonBlack++;
        if (v > 160) bright++;
      }
    }
    return { ok: nonBlack >= 8 && bright >= 1, nonBlack, bright, rectW: rect.width, rectH: rect.height };
  });
  check(`${vp.name} canvas is visible`, sample.rectW >= vp.width * 0.9 && sample.rectH >= vp.height * 0.9, JSON.stringify(sample));
  check(`${vp.name} canvas has rendered pixels`, sample.ok === true, JSON.stringify(sample));
  await page.close();
}

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join("\n")}` : "NO CONSOLE ERRORS");
console.log(fail === 0 && errors.length === 0 ? "CANVAS VIEWPORTS: ALL PASS" : `CANVAS VIEWPORTS: ${fail} FAILURES`);
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
