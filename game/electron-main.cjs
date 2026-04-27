/* eslint-disable */
// Electron entry — wraps the Vite production build (dist/) in a standalone
// native window. No browser, no separate server console.
//
// We serve dist/ over http://127.0.0.1:<random-port> rather than loading via
// file:// because:
//   1. Vite's production output uses absolute base paths (/assets/...) that
//      file:// resolves wrong.
//   2. Babylon.js modules use dynamic import() and import.meta.url for
//      shaders/workers — those break under file:// in some Chromium builds.
// A tiny built-in HTTP server side-steps both. The port is bound to loopback
// only so it isn't reachable from the network.

const { app, BrowserWindow, screen, Menu } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");

const distDir = path.join(__dirname, "dist");

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
        res.writeHead(200, {
          "Content-Type": MIME[ext] || "application/octet-stream",
          // Cache aggressively — assets/ filenames are content-hashed, so
          // any byte change produces a new URL anyway.
          "Cache-Control": "public, max-age=31536000, immutable",
        });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      serverPort = server.address().port;
      resolve(serverPort);
    });
    server.on("error", reject);
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
      // Backbuffer alpha would let the OS desktop bleed through transparent
      // pixels; the canvas paints to fully-opaque black so we want it off.
      backgroundThrottling: false,
    },
  });

  // Disable the application menu entirely so Alt doesn't summon a phantom
  // File/Edit menu over a fullscreen game.
  Menu.setApplicationMenu(null);

  win.once("ready-to-show", () => win.show());
  win.loadURL(`http://127.0.0.1:${serverPort}/`);

  // Optional devtools — set RH3_DEVTOOLS=1 to enable.
  if (process.env.RH3_DEVTOOLS === "1") {
    win.webContents.openDevTools({ mode: "detach" });
  }
}

app.whenReady().then(async () => {
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
