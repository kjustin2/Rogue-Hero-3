// Fixed origin and legacy user-data location preserve the owner's existing saves.
const { app, BrowserWindow, Menu, dialog } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
app.setPath(
  "userData",
  path.join(
    app.getPath("appData"),
    app.isPackaged ? "Rogue Hero 3" : "rogue-hero-3",
  ),
);
app.setName("Lost Fiend");
const smoke = process.env.RH3_SMOKE === "1";
if (smoke && process.env.RH3_USER_DATA)
  app.setPath("userData", process.env.RH3_USER_DATA);
let window, server;
const dist = path.resolve(__dirname, "dist");
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (window) {
      window.restore();
      window.focus();
    }
  });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    server = http.createServer((request, response) => {
      let pathname;
      try {
        pathname = decodeURIComponent(
          new URL(request.url, "http://localhost").pathname,
        );
      } catch {
        response.writeHead(400).end();
        return;
      }
      const file = path.resolve(
        dist,
        "." + (pathname === "/" ? "/index.html" : pathname),
      );
      if (!file.startsWith(dist + path.sep)) {
        response.writeHead(403).end();
        return;
      }
      fs.readFile(file, (error, data) => {
        if (error) {
          response.writeHead(404).end();
          return;
        }
        response
          .writeHead(200, {
            "Content-Type":
              mime[path.extname(file)] || "application/octet-stream",
          })
          .end(data);
      });
    });
    server.on("error", (error) => {
      if (!smoke)
        dialog.showErrorBox("Lost Fiend could not start", error.message);
      app.exit(1);
    });
    server.listen(41730, "127.0.0.1", () => {
      window = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        show: false,
        useContentSize: true,
        paintWhenInitiallyHidden: true,
        title: "Lost Fiend",
        backgroundColor: "#111617",
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          backgroundThrottling: !smoke,
          // Hidden Windows surfaces need offscreen composition for real smoke frames.
          offscreen: smoke,
        },
      });
      window.webContents.setAudioMuted(smoke);
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event, url) => {
        if (!url.startsWith("http://127.0.0.1:41730/")) event.preventDefault();
      });
      window.webContents.on("before-input-event", (event, input) => {
        if (input.type === "keyDown" && input.key === "F11") {
          event.preventDefault();
          window.setFullScreen(!window.isFullScreen());
        }
      });
      window.once("ready-to-show", () => {
        if (!smoke) window.show();
      });
      window.loadURL("http://127.0.0.1:41730/");
    });
  });
}
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => server?.close());
