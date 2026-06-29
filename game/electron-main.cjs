/* eslint-disable */
// Electron entry — wraps the Vite production build (dist/) in a standalone
// native window. No browser, no separate server console.
//
// We serve dist/ over http://127.0.0.1:<random-port> rather than loading via
// file:// because:
//   1. Vite's production output uses absolute base paths (/assets/...) that
//      file:// resolves wrong.
//   2. ES-module chunks use dynamic import() and import.meta.url — those break
//      under file:// in some Chromium builds.
// A tiny built-in HTTP server side-steps both. The port is bound to loopback
// only so it isn't reachable from the network.

const { app, BrowserWindow, screen, Menu } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { registerNativeIpc } = require("./electron-ipc.cjs");

const distDir = path.join(__dirname, "dist");

// The live window, so the IPC handlers (Display settings → real OS window) can
// reach it without threading it through every call.
let mainWindow = null;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".mjs":  "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".webp": "image/webp",
  ".ico":  "image/x-icon",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf":  "font/ttf",
  ".map":  "application/json; charset=utf-8",
};

let server = null;
let serverPort = 0;

// A FIXED loopback port keeps the renderer's origin stable across launches.
// localStorage — where ALL saved progress lives (run checkpoints, profile,
// unlocks, cosmetics, dailies) — is partitioned by origin, and the origin
// includes the port. Binding a random port every launch (listen(0)) would
// silently boot the game on a brand-new, empty store every time, throwing away
// the player's saves. The single-instance lock below stops our own prior
// instance from squatting on this port.
const PREFERRED_PORT = 41730;

function startServer() {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      // Strip the query string and decode percent-encoded segments.
      let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      if (urlPath === "/" || urlPath === "") urlPath = "/index.html";
      const filePath = path.join(distDir, urlPath);
      // Prevent directory traversal — reject any resolved path that escapes dist/.
      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(path.resolve(distDir))) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      fs.readFile(resolved, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end(`Not found: ${urlPath}`);
          return;
        }
        const ext = path.extname(resolved).toLowerCase();
        // Only /assets/ files are content-hashed (a byte change => new URL), so
        // only they are safe to cache forever. index.html, music, and icons keep
        // a stable URL across app updates — with a now-stable port the disk cache
        // persists between launches, so caching those immutably would serve a
        // stale index.html after an update and break the app. Revalidate them.
        const immutable = urlPath.startsWith("/assets/");
        res.writeHead(200, {
          "Content-Type": MIME[ext] || "application/octet-stream",
          "Cache-Control": immutable
            ? "public, max-age=31536000, immutable"
            : "no-cache",
        });
        res.end(data);
      });
    });
    server.once("listening", () => {
      serverPort = server.address().port;
      resolve(serverPort);
    });

    let triedFallback = false;
    server.on("error", (err) => {
      // Preferred port taken (a stale instance, or some other app). Fall back to
      // an ephemeral port ONCE so the game still launches; warn loudly because
      // saved progress lives under the usual origin and won't be visible here.
      if (err && err.code === "EADDRINUSE" && !triedFallback) {
        triedFallback = true;
        console.warn(
          `[rh3] port ${PREFERRED_PORT} is in use — falling back to a random port. ` +
          `Saved progress may not appear this session.`,
        );
        server.listen(0, "127.0.0.1");
        return;
      }
      reject(err);
    });

    server.listen(PREFERRED_PORT, "127.0.0.1");
  });
}

function createWindow() {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;
  // Open at ~80% of the available work area, capped at 1920x1080 so the
  // window doesn't exceed full-HD on giant monitors. F11 inside the window
  // (handled by Chromium) toggles true fullscreen.
  const w = Math.min(1920, Math.floor(width * 0.8));
  const h = Math.min(1080, Math.floor(height * 0.8));

  const win = new BrowserWindow({
    width: w,
    height: h,
    minWidth: 960,
    minHeight: 600,
    autoHideMenuBar: true,
    backgroundColor: "#000000",
    title: "Rogue Hero 3",
    show: false, // shown after first paint to avoid white flash
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Bridge for the in-game Display settings (true fullscreen + window resize).
      preload: path.join(__dirname, "preload.cjs"),
      // Backbuffer alpha would let the OS desktop bleed through transparent
      // pixels; the canvas paints to fully-opaque black so we want it off.
      backgroundThrottling: false,
    },
  });

  mainWindow = win;

  // Disable the application menu entirely so Alt doesn't summon a phantom
  // File/Edit menu over a fullscreen game.
  Menu.setApplicationMenu(null);

  // Keep the in-game Display toggle in sync with fullscreen changes from ANY
  // source — our toggle, the F11 accelerator, or the OS window chrome.
  // Emit the explicit boolean for each event rather than reading isFullScreen():
  // on Windows that getter can still report the PRE-transition value inside the
  // event handler, which would tell the renderer "windowed" right after entering
  // fullscreen (the Display toggle then needed a second click to correct itself).
  const sendFs = (on) => {
    if (!win.isDestroyed()) win.webContents.send("rh3:fullscreen-changed", on);
  };
  win.on("enter-full-screen", () => sendFs(true));
  win.on("leave-full-screen", () => sendFs(false));
  win.on("closed", () => { if (mainWindow === win) mainWindow = null; });

  win.once("ready-to-show", () => {
    // During the Playwright smoke (smoke-electron.mjs sets RH3_SMOKE=1) show the
    // window WITHOUT activating it — showInactive paints a real, screenshottable
    // surface but never steals OS focus / the cursor from the editor. Real users
    // get the normal focused window.
    if (process.env.RH3_SMOKE === "1") win.showInactive();
    else win.show();
  });
  win.loadURL(`http://127.0.0.1:${serverPort}/`);

  // Optional devtools — set RH3_DEVTOOLS=1 to enable.
  if (process.env.RH3_DEVTOOLS === "1") {
    win.webContents.openDevTools({ mode: "detach" });
  }
}

// Single-player desktop game: enforce one instance. A second launch just
// focuses the running window. This also guarantees our own prior instance is
// never holding the fixed loopback port (which would force the save-losing
// fallback above).
const gotPrimaryLock = app.requestSingleInstanceLock();
if (!gotPrimaryLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    // Handlers backing window.rh3native (preload.cjs) — the in-game Display options.
    registerNativeIpc(() => mainWindow);
    await startServer();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (server) {
      try { server.close(); } catch (_) { /* noop */ }
      server = null;
    }
    if (process.platform !== "darwin") app.quit();
  });
}
