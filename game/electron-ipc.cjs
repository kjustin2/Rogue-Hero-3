/* eslint-disable */
// Shared IPC handlers backing window.rh3native (see preload.cjs) — the in-game
// Display options (true fullscreen, exact-resolution window resize, display info).
// Extracted so the production entry (electron-main.cjs) and the native-bridge smoke
// (scripts/smoke-display-electron.cjs) register the EXACT same handlers — the smoke
// tests the real code, not a copy. `getWin()` returns the live BrowserWindow or null.
const { ipcMain, screen, app } = require("electron");

function registerNativeIpc(getWin) {
  const win = () => getWin();

  ipcMain.handle("rh3:set-fullscreen", (_e, on) => {
    const w = win();
    if (w) w.setFullScreen(!!on);
    return w ? w.isFullScreen() : false;
  });

  ipcMain.handle("rh3:is-fullscreen", () => {
    const w = win();
    return w ? w.isFullScreen() : false;
  });

  ipcMain.handle("rh3:set-window-size", (_e, { w: rw, h: rh }) => {
    const w = win();
    if (!w) return;
    // Exact-resolution window: leave fullscreen/maximized first, clamp to the work
    // area so the chosen size always fits on screen, then center it.
    if (w.isFullScreen()) w.setFullScreen(false);
    if (w.isMaximized()) w.unmaximize();
    const area = screen.getPrimaryDisplay().workAreaSize;
    const cw = Math.max(960, Math.min(Math.round(rw) || 0, area.width));
    const ch = Math.max(600, Math.min(Math.round(rh) || 0, area.height));
    w.setSize(cw, ch);
    w.center();
  });

  ipcMain.handle("rh3:maximize", () => {
    const w = win();
    if (!w) return;
    if (w.isFullScreen()) w.setFullScreen(false);
    w.maximize();
  });

  ipcMain.handle("rh3:get-display", () => {
    const w = win();
    const d = screen.getPrimaryDisplay();
    return {
      width: d.workAreaSize.width,
      height: d.workAreaSize.height,
      scaleFactor: d.scaleFactor,
      fullscreen: w ? w.isFullScreen() : false,
      maximized: w ? w.isMaximized() : false,
    };
  });

  ipcMain.handle("rh3:quit", () => app.quit());
}

module.exports = { registerNativeIpc };
