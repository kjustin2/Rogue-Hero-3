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

  win.webContents.on("console-message", (_e, level, message) => {
    if (level >= 3) errors.push("CONSOLE: " + message);
  });
  win.webContents.on("render-process-gone", (_e, d) => errors.push("RENDERER GONE: " + d.reason));
  win.webContents.on("unresponsive", () => errors.push("UNRESPONSIVE"));

  const js = (s) => win.webContents.executeJavaScript(s);
  const has = async (sel) => js(`!!document.querySelector(${JSON.stringify(sel)})`);
  const click = async (sel) => js(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(e){e.click(); return true;} return false;})()`);
  const clickText = async (re) => js(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>${JSON.stringify(re)}.split('|').some(t=>x.textContent.includes(t))); if(b){b.click(); return true;} return false;})()`);
  const clearScreens = () => js(`document.querySelectorAll('.screen').forEach(s=>s.remove())`);
  const expect = (cond, msg) => { if (!cond) errors.push("FLOW: " + msg); };

  const run = async () => {
    try {
      await win.loadURL(`http://127.0.0.1:${port}/`);
      await sleep(2600);
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

      // --- Interstitial screens (drive directly for deterministic shots)
      await js(`window.__rh3menus.showShop(()=>{})`); await sleep(500); await shot(win, "shop");
      await js(`window.__rh3menus.clear(); window.__rh3menus.showRest(()=>{})`); await sleep(400); await shot(win, "rest");
      if (await clickText("Hone a Card")) { await sleep(450); await shot(win, "rest-hone"); }
      await js(`window.__rh3menus.clear(); window.__rh3menus.showTreasure(()=>{})`); await sleep(400); await shot(win, "treasure");
      await js(`window.__rh3menus.clear(); window.__rh3menus.showEvent(()=>{})`); await sleep(400); await shot(win, "event");
      await js(`window.__rh3menus.clear();`);

      // --- Every boss entrance cutscene (jump straight to each act's boss)
      const bosses = ["warden", "spire", "colossus", "tyrant", "unmaker"];
      for (let act = 1; act <= 5; act++) {
        const ok = await js(`window.__rh3.run.debugLoadNode("boss", ${act}, 424242, 5)`);
        expect(ok, "debugLoadNode boss act " + act + " failed");
        await clearScreens();
        await sleep(2800); // materialize / title-card beat
        await clearScreens();
        await shot(win, `boss-${bosses[act - 1]}`);
      }

      // --- Final boss: fading phase → collapse → bittersweet ending → victory
      await js(`window.__rh3.run.debugLoadNode("boss", 5, 424242, 5)`);
      await clearScreens();
      await sleep(2900);
      await js(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space'}))`); // skip entrance
      await sleep(500); await clearScreens();
      await js(`(()=>{const z=window.__rh3.enemies.living().find(e=>e.kind==='boss'); if(z) z.takeDamage(z.maxHp*0.9);})()`);
      await sleep(1000); await clearScreens();
      await shot(win, "unmaker-fading");
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
