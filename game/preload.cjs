/* eslint-disable */
// Preload bridge — exposes a tiny, safe native window API to the renderer so the
// in-game Settings → Display options can drive the REAL OS window (true fullscreen,
// exact-resolution window resize) instead of only the in-page Fullscreen API.
//
// Sandbox-safe: a sandboxed preload (sandbox: true in electron-main.cjs) may only
// require a small allow-list of Electron modules — `ipcRenderer` and `contextBridge`
// are both on it. We expose nothing else; the renderer can't reach Node or the
// window object directly, only these vetted IPC calls.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rh3native", {
  isElectron: true,
  setFullscreen: (on) => ipcRenderer.invoke("rh3:set-fullscreen", !!on),
  isFullscreen: () => ipcRenderer.invoke("rh3:is-fullscreen"),
  setWindowSize: (w, h) => ipcRenderer.invoke("rh3:set-window-size", { w, h }),
  maximize: () => ipcRenderer.invoke("rh3:maximize"),
  getDisplay: () => ipcRenderer.invoke("rh3:get-display"),
  quit: () => ipcRenderer.invoke("rh3:quit"),
  onFullscreenChange: (cb) => {
    const handler = (_e, v) => cb(!!v);
    ipcRenderer.on("rh3:fullscreen-changed", handler);
    return () => ipcRenderer.removeListener("rh3:fullscreen-changed", handler);
  },
});
