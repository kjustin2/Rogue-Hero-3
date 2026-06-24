// Verifies the standalone Electron app boots dist/ and renders the menu.
// Opens a real window briefly, screenshots it, then closes.
import { _electron } from "playwright-core";
import { mkdirSync } from "node:fs";

mkdirSync("shots", { recursive: true });
// RH3_SMOKE=1 makes electron-main.cjs show the window inactively (no focus/
// cursor theft from the editor). The window still paints, so screenshots work.
const app = await _electron.launch({ args: ["."], env: { ...process.env, RH3_SMOKE: "1" } });
const win = await app.firstWindow();
const errors = [];
win.on("console", (m) => m.type() === "error" && errors.push(m.text()));
win.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));

await win.waitForSelector(".title", { timeout: 15000 });
await win.waitForTimeout(2000);
await win.screenshot({ path: "shots/18-electron.png" });
console.log("TITLE:", await win.title());
console.log(errors.length ? `CONSOLE ERRORS:\n` + errors.join("\n") : "NO CONSOLE ERRORS");
await app.close();
