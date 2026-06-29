/* eslint-disable */
// Hidden Electron smoke for the NATIVE display bridge (preload.cjs + electron-ipc.cjs).
// Boots the BUILT game in a hidden window WITH the production preload, then drives
// window.rh3native to prove the IPC round-trips work in the real desktop runtime:
// the bridge is exposed, getDisplay returns metrics, an exact-resolution resize
// takes effect, the fullscreen channel answers, and the Settings panel shows the
// Electron-only Window Resolution picker.
//
// show:false the whole time — never shows a window, never enters real fullscreen,
// so it can't steal OS focus or take over the screen during a smoke.
// Run: npm run smoke:display-electron   (after npm run build)
const { app, BrowserWindow } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { registerNativeIpc } = require("../electron-ipc.cjs");

const distDir = path.join(__dirname, "..", "dist");
const shotDir = path.join(__dirname, "..", "shots");
fs.mkdirSync(shotDir, { recursive: true });

if (!fs.existsSync(path.join(distDir, "index.html"))) {
  console.error("No dist/ build found. Run `npm run build` first.");
  process.exit(1);
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff": "font/woff",
  ".woff2": "font/woff2", ".mp3": "audio/mpeg",
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
const fails = [];
const expect = (cond, msg) => { if (!cond) fails.push(msg); else console.log(`  ✓ ${msg}`); };

app.whenReady().then(async () => {
  let win = null;
  registerNativeIpc(() => win); // the REAL production handlers
  const port = await startServer();

  win = new BrowserWindow({
    width: 1600, height: 900,
    show: false, paintWhenInitiallyHidden: true,
    backgroundColor: "#05070a",
    webPreferences: {
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      preload: path.join(__dirname, "..", "preload.cjs"), // the REAL bridge
      backgroundThrottling: false,
    },
  });

  win.webContents.on("console-message", (_e, level, message) => { if (level >= 3) fails.push("CONSOLE: " + message); });
  win.webContents.on("render-process-gone", (_e, d) => fails.push("RENDERER GONE: " + d.reason));

  const js = (s) => win.webContents.executeJavaScript(s);

  try {
    await win.loadURL(`http://127.0.0.1:${port}/`);
    await sleep(2600);

    expect(await js(`!!window.__rh3`), "renderer booted (window.__rh3 present)");
    expect(await js(`!!(window.rh3native && window.rh3native.isElectron === true)`), "native bridge exposed via preload");

    const disp = await js(`window.rh3native.getDisplay()`);
    expect(disp && disp.width > 0 && disp.height > 0, `getDisplay returns metrics (${disp && disp.width}×${disp && disp.height})`);

    // Exact-resolution resize round-trips through IPC (hidden window: never shown).
    // electron-ipc clamps the request to the work area (and a 960×600 floor), so on a
    // small/headless display 1280×720 lands clamped — assert the clamped expectation,
    // not a bare 1280, so the probe is correct on any display size.
    await js(`window.rh3native.setWindowSize(1280, 720)`);
    await sleep(450);
    const sz = win.getSize();
    const expW = Math.max(960, Math.min(1280, disp.width));
    const expH = Math.max(600, Math.min(720, disp.height));
    expect(sz[0] === expW && sz[1] === expH, `setWindowSize resized the window (${sz.join("×")}, expected ${expW}×${expH})`);

    // Fullscreen channel answers (read-only — we never enter fullscreen in the smoke).
    const fsState = await js(`window.rh3native.isFullscreen()`);
    expect(fsState === false, "isFullscreen channel responds");

    // Settings UI exposes the Electron-only Window Resolution picker.
    await js(`window.__rh3menus.showSettings(() => window.__rh3menus.showMain())`);
    await sleep(500);
    expect(await js(`!!document.querySelector("select[data-set='windowSize']")`), "Window Resolution picker shown (native path)");

    // Regression: the Display toggle must follow the native fullscreen-changed
    // event. The bug was the main process sending a STALE boolean from
    // isFullScreen() during the transition, so entering fullscreen reported
    // "windowed" and the toggle needed a second click. Push the event through the
    // real preload channel and assert the chip flips — without entering fullscreen.
    win.webContents.send("rh3:fullscreen-changed", true);
    await sleep(300);
    expect(await js(`document.querySelector(".qbtn[data-dm='fullscreen']")?.classList.contains("qbtn--on") === true`),
      "fullscreen-changed=true flips Display toggle to FULLSCREEN");
    win.webContents.send("rh3:fullscreen-changed", false);
    await sleep(300);
    expect(await js(`document.querySelector(".qbtn[data-dm='windowed']")?.classList.contains("qbtn--on") === true`),
      "fullscreen-changed=false flips Display toggle back to WINDOWED");

    // Drop the boot loader (it can still be lifting under SwiftShader) so the
    // captured shot actually shows the settings panel, then re-assert it's up.
    await js(`document.getElementById('rift-loader')?.remove(); window.__rh3menus.showSettings(() => window.__rh3menus.showMain());`);
    await sleep(500);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(shotDir, "display-settings-electron.png"), img.toPNG());
    console.log("  shot: display-settings-electron.png");

    // Native-only "Exit Game" button: present on the main menu in the desktop build
    // (a browser tab can't be script-closed, so it's hidden there). Verify + capture.
    await js(`window.__rh3menus.showMain()`);
    await sleep(400);
    expect(await js(`!!document.querySelector("[data-act='exit-game']")`), "Exit Game button shown on native main menu");
    const menuImg = await win.webContents.capturePage();
    fs.writeFileSync(path.join(shotDir, "main-menu-electron.png"), menuImg.toPNG());
    console.log("  shot: main-menu-electron.png");
  } catch (e) {
    fails.push("EXCEPTION: " + (e && e.message ? e.message : String(e)));
  }

  console.log(fails.length
    ? `\nDISPLAY-ELECTRON SMOKE FAILED (${fails.length}):\n` + fails.slice(0, 20).map((f) => `  ✗ ${f}`).join("\n")
    : "\nDISPLAY-ELECTRON SMOKE OK — native bridge round-trips in the shipped runtime.");
  try { server.close(); } catch (_) {}
  win.destroy();
  app.exit(fails.length ? 1 : 0);
});
