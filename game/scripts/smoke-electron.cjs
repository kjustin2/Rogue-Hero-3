/* eslint-disable */
// Real-runtime playthrough smoke (Wall-of-Dead style). Boots the BUILT game in
// an Electron/Chromium window — the actual shipping renderer — serves dist/ over
// a loopback HTTP server, drives a full slice of the game, screenshots every
// scene to shots/electron-*.png, and captures every console/renderer error.
//
// This is the "looks right + actually works in the shipped runtime" net that the
// targeted Playwright smokes (which run the dev server) don't cover. READ the
// screenshots — a clean console over a black canvas is still a failure.
//
// Run:  npm run smoke        (after npm run build)
//       npm run test:play    (build + smoke)
// Uses Electron's bundled Chromium — no Playwright browser download.

const { app, BrowserWindow } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { guard, guardWindow } = require("./lib/guard.cjs");
guard({ name: "smoke-electron", maxMinutes: 10 });

const distDir = path.join(__dirname, "..", "dist");
const shotDir = path.join(__dirname, "..", "shots");
fs.mkdirSync(shotDir, { recursive: true });

if (!fs.existsSync(path.join(distDir, "index.html"))) {
  console.error("No dist/ build found. Run `npm run build` first.");
  process.exit(1);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
};

let server;
function startServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      let p = decodeURIComponent((req.url || "/").split("?")[0]);
      if (p === "/") p = "/index.html";
      const file = path.join(distDir, p);
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
let shotN = 0;

async function shot(win, name) {
  // A hidden native window can have current DOM state while its compositor is
  // still holding the previous frame (most visibly the loader over the menu).
  // Force two animation frames plus a full repaint before treating a capture as
  // shipping-runtime visual evidence.
  await win.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  win.webContents.invalidate();
  await sleep(120);
  const img = await win.webContents.capturePage();
  const file = `electron-${String(++shotN).padStart(2, "0")}-${name}.png`;
  fs.writeFileSync(path.join(shotDir, file), img.toPNG());
  console.log("  shot:", file);
}

app.whenReady().then(async () => {
  const port = await startServer();
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    // Never show a real window: a visible Electron window grabs OS focus (and
    // the cursor) away from the editor/terminal, then dumps it back on close.
    // `capturePage()` still renders real frames from a hidden window as long as
    // it keeps painting — hence paintWhenInitiallyHidden + backgroundThrottling
    // off below. (Was `show: true`, which is what stole focus during smokes.)
    show: false,
    paintWhenInitiallyHidden: true,
    backgroundColor: "#05070a",
    webPreferences: { backgroundThrottling: false, offscreen: false },
  });
  win.webContents.setAudioMuted(true); // no soundtrack during test runs

  win.webContents.on("console-message", (_e, level, message) => {
    if (level >= 3) errors.push("CONSOLE: " + message);
  });
  guardWindow(win); // dead/hung renderer → abort, never hang on the next await

  const js = (s) => win.webContents.executeJavaScript(s);
  const has = async (sel) => js(`!!document.querySelector(${JSON.stringify(sel)})`);
  const click = async (sel) => js(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(e){e.click(); return true;} return false;})()`);
  const clickText = async (re) => js(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>${JSON.stringify(re)}.split('|').some(t=>x.textContent.includes(t))); if(b){b.click(); return true;} return false;})()`);
  const clearScreens = () => js(`document.querySelectorAll('.screen, .actcard').forEach(s=>s.remove())`);
  const expect = (cond, msg) => { if (!cond) errors.push("FLOW: " + msg); };
  const waitForJs = async (expr, timeout = 15000) => {
    const started = Date.now();
    let stable = 0;
    while (Date.now() - started < timeout) {
      try {
        stable = await js(`!!(${expr})`) ? stable + 1 : 0;
      } catch (_) {
        // A saved display-mode application may recreate the renderer once.
        stable = 0;
      }
      if (stable >= 5) return true;
      await sleep(100);
    }
    return false;
  };

  const run = async () => {
    try {
      await win.loadURL(`http://127.0.0.1:${port}/`);
      // The shipping boot intentionally waits for real-GPU shader linking. Await
      // the explicit readiness contract with a bounded first-attempt budget;
      // elapsed-time guessing at 15s made healthy cold NVIDIA launches flaky.
      const bootReady = await waitForJs(`window.__rh3boot?.ready === true && !document.querySelector('#rift-loader') && !!document.querySelector('.screen--main')`, 30000);
      expect(bootReady, "explicit boot-ready state missed its Electron deadline");
      if (!bootReady) throw new Error(`boot did not become ready: ${JSON.stringify(await js(`window.__rh3boot ?? null`))}`);
      const bootState = await js(`window.__rh3boot`);
      console.log(`  boot-ready: ${Math.round(bootState.completedAt - bootState.startedAt)}ms (${bootState.phase})`);
      expect(await js(`!!window.__rh3`), "window.__rh3 hook missing in prod build");
      await shot(win, "menu");

      // --- New run → hero select
      await js(`localStorage.removeItem('rh3v2-runsave')`);
      await clickText("Begin Run|New Run");
      await sleep(800);
      expect(await has(".hero-card"), "hero select did not appear");
      await shot(win, "heroselect");

      // --- Pick a hero → opening story
      await click(".hero-card");
      await sleep(1200);
      expect(await has(".story"), "opening story did not appear");
      await shot(win, "opening-story");
      // Skip the opening
      while (await has(".story-skip")) { await click(".story-skip"); await sleep(300); }
      await sleep(2400);

      // --- First chamber: combat
      const st1 = await js(`window.__rh3.run.state`);
      expect(st1 === "fighting", "expected fighting after opening, got " + st1);
      await shot(win, "combat");

      // --- Clear the room → draft
      await js(`for (const e of window.__rh3.enemies.living()) e.takeDamage(99999);`);
      await sleep(2200);
      // act intro + room-clear flow settle; the draft (or a map) should be up
      if (await has(".draft-row, .card")) await shot(win, "card-draft");
      if (await has(".card")) { await click(".card"); await sleep(500); if (await has(".card")) await click(".card"); }
      await sleep(900);

      // --- Map fork
      if (await has(".mapnode")) await shot(win, "map-fork");

      // --- Final boss: fading phase → collapse → bittersweet ending → victory
      // Use the normal-ending depth for this flow assertion. Depth 3+ correctly
      // branches from the Unmaker into the Wound true-final encounter, so asking
      // for depth 5 here can never reach the victory screen this test expects.
      await js(`window.__rh3.run.debugLoadNode("boss", 5, 424242, 1)`);
      await clearScreens();
      await sleep(2900);
      await js(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space'}))`); // skip entrance
      await js(`window.__rh3debug.frames(180, 1/60)`); // advance pending boss materialization on the game clock
      // The boss materializes at 2.4s; do not race the pending spawn while the
      // cinematic skip and a hidden native window are settling.
      for (let i = 0; i < 30; i++) {
        if (await js(`window.__rh3.run.currentNode?.bossKind === 'unmaker' && window.__rh3.enemies.living().some(e=>e.kind==='boss')`)) break;
        await sleep(100);
      }
      await js(`(()=>{
        window.__rh3debug.skipCutscene();
        window.__rh3debug.frames(120, 1/60);
      })()`);
      expect(await waitForJs(`!window.__rh3debug.presentation().cinematic.active && window.__rh3debug.qaManifest().state === 'playing'`, 12000), "Unmaker entrance did not hand off");
      await clearScreens();
      await js(`(()=>{const z=window.__rh3.enemies.living().find(e=>e.kind==='boss'); if(z) z.takeDamage(z.maxHp*0.9);})()`);
      const fadingReady = await waitForJs(`window.__rh3debug.presentation().cinematic.id === 'boss-phase:unmaker:4'`, 12000);
      expect(fadingReady, "Unmaker fading phase did not stage");
      await clearScreens();
      // Finish the deterministic fading handoff before applying the execution.
      // If the star entered its defensive ward immediately before the forced
      // phase cut, the cinematic correctly pauses that timer; attempting the
      // lethal hit inside the cut therefore deflects it and never tests victory.
      await js(`window.__rh3debug.skipCutscene()`);
      await sleep(1800);
      await js(`(()=>{const z=window.__rh3.enemies.living().find(e=>e.kind==='boss'); if(z) z.takeDamage(99999);})()`);
      await sleep(3400);
      if (await has(".story")) await shot(win, "ending");
      for (let i = 0; i < 14; i++) { if (await has(".story-skip")) await click(".story-skip"); if (await has(".end-title--victory")) break; await sleep(300); }
      expect(await has(".end-title--victory"), "victory screen never appeared");
      await shot(win, "victory");

      // --- Death screen (retry, then a lethal hit)
      await clickText("Run It Back|Rise Again");
      await sleep(1800);
      while (await has(".story-skip")) { await click(".story-skip"); await sleep(300); }
      await sleep(2200);
      await js(`window.__rh3.combat.damagePlayer(99999, 3, 3)`);
      await sleep(2400);
      expect(await has(".end-title--death"), "death screen never appeared");
      await shot(win, "death");
    } catch (e) {
      errors.push("EXCEPTION: " + (e && e.message ? e.message : String(e)));
    }
  };

  await run();

  console.log(
    errors.length ? `\nERRORS (${errors.length}):\n` + errors.slice(0, 25).join("\n") : "\nNO ERRORS — full slice rendered through to victory + death."
  );
  try { server.close(); } catch (_) {}
  win.destroy();
  app.exit(errors.length ? 1 : 0);
});
