/* eslint-disable */
// REAL-GPU glitch hunt. Headless SwiftShader can't reproduce GPU-specific render bugs
// (unbound-sampler undefined behaviour, z-fighting precision) — this runs the BUILT game in
// a real Electron window on THIS machine's GPU, spawns a MIX of enemy kinds (many distinct
// material configs — the trigger for the rim-shader cache-key bug), orbits the camera over a
// FROZEN scene, and measures the mean consecutive-frame diff (a "blink" spikes it) while
// saving frames for eyeballing. Set GLABEL=fixed|buggy to A/B.
//   run:  npm run build && electron scripts/glitch-hunt-electron.cjs
const { app, BrowserWindow } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { guard, guardWindow } = require("./lib/guard.cjs");
guard({ name: "glitch-hunt", maxMinutes: 8 });

const distDir = path.join(__dirname, "..", "dist");
const outDir = path.join(__dirname, "..", "shots", "glitch-gpu");
fs.mkdirSync(outDir, { recursive: true });
if (!fs.existsSync(path.join(distDir, "index.html"))) { console.error("No dist/. Run npm run build first."); process.exit(1); }
const LABEL = process.env.GLABEL || "run";

const MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".woff": "font/woff", ".woff2": "font/woff2", ".mp3": "audio/mpeg", ".svg": "image/svg+xml" };
let server;
const startServer = () => new Promise((res) => {
  server = http.createServer((req, rs) => {
    let p = decodeURIComponent((req.url || "/").split("?")[0]); if (p === "/") p = "/index.html";
    const f = path.join(distDir, p);
    fs.readFile(f, (e, d) => { if (e) { rs.writeHead(404); rs.end(); return; } rs.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" }); rs.end(d); });
  });
  server.listen(0, "127.0.0.1", () => res(server.address().port));
});
const sleep = (t) => new Promise((r) => setTimeout(r, t));
const errors = [];
// mean abs per-channel diff between two BGRA bitmaps (skip alpha)
const bitmapDiff = (a, b) => { let s = 0; const n = a.length; for (let i = 0; i < n; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); return s / (n / 4 * 3); };

app.whenReady().then(async () => {
  const port = await startServer();
  const win = new BrowserWindow({ width: 1280, height: 720, show: false, paintWhenInitiallyHidden: true, backgroundColor: "#05070a", webPreferences: { backgroundThrottling: false, offscreen: false } });
  guardWindow(win); // hung/dead renderer under real-GPU load → abort, never hang
  win.webContents.setAudioMuted(true);
  win.showInactive();
  win.webContents.on("console-message", (_e, l, m) => { if (l >= 3) errors.push("CONSOLE: " + m); });
  const js = (s) => win.webContents.executeJavaScript(s);
  await win.loadURL(`http://127.0.0.1:${port}/`);
  await sleep(3800);

  // Enter a real run (menu → hero → skip intro) so a combat room + its enemy systems exist.
  const click = (sel) => js(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(el){el.click();return true;}return false;})()`);
  await js(`(()=>{const b=[...document.querySelectorAll("button")].find(x=>/Begin Run|New Run/i.test(x.textContent));if(b)b.click();})()`);
  await sleep(900);
  await click(".hero-card");
  await sleep(900);
  for (let i = 0; i < 16; i++) { if ((await js(`window.__rh3state?window.__rh3state():"?"`)) === "playing") break; await js(`window.__rh3debug&&window.__rh3debug.skipCutscene&&window.__rh3debug.skipCutscene()`); await click(".story-skip"); await sleep(260); }
  await js(`window.__rh3debug&&window.__rh3debug.room&&window.__rh3debug.room("combat", 1)`);
  for (let i = 0; i < 14; i++) { if ((await js(`window.__rh3state?window.__rh3state():"?"`)) === "playing") break; await js(`window.__rh3debug&&window.__rh3debug.skipCutscene&&window.__rh3debug.skipCutscene()`); await sleep(250); }
  await js(`window.__rh3debug&&window.__rh3debug.godmode&&window.__rh3debug.godmode(); window.__rh3.stage.applyQuality&&window.__rh3.stage.applyQuality("high")`);
  await sleep(800);
  // Spawn one of every enemy kind → maximally many distinct rim-material configs on screen.
  await js(`(()=>{const c=window.__rh3;const kinds=["husk","brute","wisp","leaper","tether","mirror","caster","bastion","shade","harrier","splitter","voidling","warper"];let a=0;for(const k of kinds){const ang=a/kinds.length*Math.PI*2;a++;try{c.enemies.spawn(k,Math.cos(ang)*6,0,Math.sin(ang)*6);}catch(e){}}for(const e of c.enemies.living()){e.hp=9e9;e.maxHp=9e9;if(e.freeze)e.freeze(9e5);}})()`);
  await sleep(1200);
  // Do not confuse ANGLE's still-running parallel shader links with a temporal
  // material fault. The shipped loader now awaits this same completion-aware path.
  await js(`window.__rh3.stage.warmUpAsync()`);
  await sleep(250);
  const nEnemies = await js(`window.__rh3.enemies.living().length`);

  // Freeze the world, orbit the camera slowly, capture + diff + save frames.
  await js(`window.__rh3debug.freezeForTest(true)`);
  await sleep(250);

  // (a) FIXED-CAMERA temporal BISECTION: with the world AND camera frozen, a correct render
  // is pixel-identical frame-to-frame. If it isn't, a render effect is varying per frame.
  // Cumulatively disable effects; the step where the temporal diff drops to ~0 is the cause.
  const temporalDiff = async (frames = 6) => {
    let p = null, t = 0, n = 0;
    for (let i = 0; i < frames; i++) { await sleep(55); const im = await win.webContents.capturePage(); const b = im.toBitmap(); if (p) { t += bitmapDiff(p, b); n++; } p = b; }
    return t / n;
  };
  const steps = [
    ["baseline", ""],
    ["-msaa", `window.__rh3.stage.setDebug("msaa",false)`],
    ["-smaa", `window.__rh3.stage.setDebug("smaa",false)`],
    ["-bloom", `window.__rh3.stage.setDebug("bloom",false)`],
    ["-grade", `window.__rh3.stage.setDebug("grade",false)`],
    ["-vignette", `window.__rh3.stage.setDebug("vignette",false)`],
    ["-env", `window.__rh3.stage.setDebug("env",false)`],
    ["-shadows", `window.__rh3.stage.setDebug("shadows",false)`],
  ];
  let baselineDiff = 0;
  for (const [name, setup] of steps) {
    if (setup) { await js(setup); await sleep(350); }
    const d = await temporalDiff();
    if (name === "baseline") baselineDiff = d;
    console.log(`temporal[${name}]: ${d.toFixed(3)} /255`);
  }
  // restore
  await js(`["bloom","grade","vignette","env","shadows"].forEach(n=>window.__rh3.stage.setDebug(n,true));window.__rh3.stage.setDebug("msaa",false);window.__rh3.stage.setDebug("smaa",false)`);
  await sleep(300);

  let prev = null, total = 0, pairs = 0, maxd = 0;
  const FRAMES = 12;
  for (let i = 0; i < FRAMES; i++) {
    const ang = (i / FRAMES) * Math.PI * 0.8 - 0.4;
    await js(`window.__rh3.cam.snapTo && window.__rh3.cam.snapTo(${(Math.cos(ang) * 3).toFixed(3)}, ${(Math.sin(ang) * 3 - 1).toFixed(3)})`);
    await sleep(80);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, `${LABEL}-${String(i).padStart(2, "0")}.png`), img.toPNG());
    const bm = img.toBitmap();
    if (prev) { const d = bitmapDiff(prev, bm); total += d; pairs++; if (d > maxd) maxd = d; }
    prev = bm;
  }
  const gpu = await js(`(()=>{try{const gl=window.__rh3.stage.renderer.getContext();const e=gl.getExtension("WEBGL_debug_renderer_info");return e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):"?";}catch(e){return "?";}})()`);
  console.log(`GPU: ${gpu}`);
  console.log(`enemies on screen: ${nEnemies}`);
  console.log(`${LABEL}: mean consecutive-frame diff ${(total / pairs).toFixed(2)} /255, max ${maxd.toFixed(2)}`);
  console.log(errors.length ? `ERRORS: ${errors.slice(0, 5).join(" | ")}` : "NO CONSOLE ERRORS");
  const failed = errors.length > 0 || baselineDiff > 0.5;
  if (baselineDiff > 0.5) console.error(`FLICKER GATE FAIL: frozen baseline ${baselineDiff.toFixed(3)} > 0.500`);
  server.close();
  app.quit();
  process.exit(failed ? 1 : 0);
});
