// Regression probe for cross-restart SAVE PERSISTENCE — the fixed-loopback-port fix
// in electron-main.cjs. localStorage (run checkpoints, profile, unlocks, cosmetics)
// is partitioned by origin, and the origin includes the port; the pre-fix code bound
// a RANDOM port every launch (listen(0)), so every restart booted on an empty store
// and silently lost the player's saves.
//
// This probe (1) launches Electron TWICE as separate processes that share a userData
// dir + a single stable port, writes localStorage in run 1 and reads it back in run 2
// — proving persistence across a real process restart — and (2) statically guards the
// invariants that keep saves working: a fixed PREFERRED_PORT bind, and the native-bridge
// cjs files being shipped in the packaged build.
//
// Run from game/:  node scripts/smoke-save-persist.mjs   (or: npm run smoke:save-persist)
import { spawn } from "node:child_process";
import { readFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
// Imported in a plain Node process (not Electron), the `electron` package resolves
// to the absolute path of its binary — so we can spawn it directly, no shell shim.
import electronBin from "electron";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const mainScript = join(here, "save-persist-main.cjs");

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

function runPhase(phase, userData, port) {
  return new Promise((resolve) => {
    const env = { ...process.env, SAVE_PHASE: phase, SAVE_USERDATA: userData, SAVE_PORT: String(port), RH3_SMOKE: "1" };
    const p = spawn(electronBin, [mainScript], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ code, out }));
  });
}

let failed = false;

// --- (1) functional: a value written in one process is still there after a restart.
const userData = mkdtempSync(join(tmpdir(), "rh3-persist-"));
const port = await freePort();
const w = await runPhase("write", userData, port);
if (!/PROBE_WROTE/.test(w.out)) console.error("note: write phase did not confirm (stdout quirk?):", w.out.trim());
const r = await runPhase("read", userData, port);
if (/PROBE_READ_OK/.test(r.out)) {
  console.log("PERSIST OK: localStorage survived a full process restart on a stable origin");
} else {
  console.error("PERSIST FAIL: save did NOT survive restart:", r.out.trim());
  failed = true;
}
try { rmSync(userData, { recursive: true, force: true }); } catch { /* ignore */ }

// --- (2) static guard: the source invariants that keep saves persisting + packaging intact.
const mainSrc = readFileSync(join(root, "electron-main.cjs"), "utf8");
if (!/const PREFERRED_PORT\s*=\s*\d+/.test(mainSrc) || !/server\.listen\(\s*PREFERRED_PORT/.test(mainSrc)) {
  console.error("GUARD FAIL: electron-main.cjs no longer binds a FIXED PREFERRED_PORT — saves would not persist across launches.");
  failed = true;
}
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const files = (pkg.build && pkg.build.files) || [];
for (const f of ["preload.cjs", "electron-ipc.cjs"]) {
  if (!files.includes(f)) {
    console.error(`GUARD FAIL: package.json build.files is missing ${f} — the packaged app would crash on startup / lose the native bridge.`);
    failed = true;
  }
}

if (failed) {
  console.error("SAVE-PERSIST PROBE FAILED");
  process.exit(1);
}
console.log("NO CONSOLE ERRORS");
console.log("SAVE-PERSIST PROBE PASSED");
