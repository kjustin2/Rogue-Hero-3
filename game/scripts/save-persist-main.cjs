/* eslint-disable */
// One phase of the save-persistence regression probe (driven by smoke-save-persist.mjs).
// Run as TWO separate Electron processes that share a userData dir + the SAME loopback
// port — mirroring how electron-main.cjs keeps the renderer origin (and therefore
// localStorage) stable across launches. Phase "write" stores a value; phase "read"
// (a fresh process) reads it back. If the origin were unstable (random port, as the
// pre-fix code used), the read phase would see an empty store.
const { app, BrowserWindow } = require("electron");
const http = require("http");

const PHASE = process.env.SAVE_PHASE || "write";
const PORT = Number(process.env.SAVE_PORT || 41731);
if (process.env.SAVE_USERDATA) app.setPath("userData", process.env.SAVE_USERDATA);

const PAGE = "<!doctype html><meta charset=utf-8><title>persist</title><body>ok</body>";

function serve() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((_q, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(PAGE);
    });
    srv.once("listening", () => resolve(srv));
    srv.once("error", reject);
    srv.listen(PORT, "127.0.0.1");
  });
}

(async () => {
  await app.whenReady();
  let srv;
  try {
    srv = await serve();
  } catch (e) {
    console.log("PROBE_ERR server " + (e.code || e.message));
    app.exit(3);
    return;
  }

  const win = new BrowserWindow({ show: false });
  await win.loadURL("http://127.0.0.1:" + PORT + "/");

  let code = 0;
  if (PHASE === "write") {
    await win.webContents.executeJavaScript("localStorage.setItem('rh3-persist-probe','saved-v1'); true");
    win.webContents.session.flushStorageData(); // force DOM storage to disk
    await new Promise((r) => setTimeout(r, 1500)); // give leveldb time to flush before exit
    console.log("PROBE_WROTE");
  } else {
    const val = await win.webContents.executeJavaScript("localStorage.getItem('rh3-persist-probe')");
    if (val === "saved-v1") console.log("PROBE_READ_OK");
    else { console.log("PROBE_READ_FAIL got=" + JSON.stringify(val)); code = 1; }
  }

  try { srv.close(); } catch (_) { /* noop */ }
  app.exit(code);
})();
