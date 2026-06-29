// Ambient types for the optional Electron native bridge (see preload.cjs).
// Present only when running inside the desktop (Electron) build; `window.rh3native`
// is undefined in the browser/Vite builds, so every consumer must guard on it.
export {};

declare global {
  interface RH3DisplayInfo {
    /** Usable work area (excludes taskbar), in DIPs. */
    width: number;
    height: number;
    /** OS display scale factor (e.g. 1.5 on a 150% display). */
    scaleFactor: number;
    /** True when the OS window is currently fullscreen. */
    fullscreen: boolean;
    /** True when the OS window is currently maximized. */
    maximized: boolean;
  }

  interface RH3Native {
    readonly isElectron: true;
    /** Toggle true OS fullscreen; resolves to the resulting state. */
    setFullscreen(on: boolean): Promise<boolean>;
    isFullscreen(): Promise<boolean>;
    /** Resize the (windowed) OS window to an exact pixel size and re-center it. */
    setWindowSize(w: number, h: number): Promise<void>;
    /** Maximize the OS window to fill the work area. */
    maximize(): Promise<void>;
    /** Primary-display metrics + current window state. */
    getDisplay(): Promise<RH3DisplayInfo>;
    /** Quit the desktop app. */
    quit(): Promise<void>;
    /** Subscribe to fullscreen-state changes from ANY source (toggle, F11, OS).
     *  Returns an unsubscribe function. */
    onFullscreenChange(cb: (on: boolean) => void): () => void;
  }

  interface Window {
    rh3native?: RH3Native;
  }
}
