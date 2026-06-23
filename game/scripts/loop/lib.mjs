// Shared harness for the self-iterating improvement loop.
//
// Everything path-, browser-, git-, and claude-related lives here so the
// individual stages (capture / logic / observe / implement / orchestrate) stay
// small and declarative. Paths are derived from this file's location, NOT the
// cwd, so any stage can be run from anywhere.
import { chromium } from "playwright-core";
import { spawn, spawnSync } from "node:child_process";
import {
  mkdirSync, writeFileSync, readFileSync, existsSync, renameSync, rmSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const GAME_DIR = resolve(HERE, "..", "..");          // .../game
export const REPO_ROOT = resolve(GAME_DIR, "..");           // repo root
export const ARTIFACTS = join(GAME_DIR, "artifacts", "loop");
export const STATE_FILE = join(ARTIFACTS, "state.json");
export const GAME_URL = "http://localhost:5174";
const CHROME = join(
  process.env.LOCALAPPDATA ?? "",
  "ms-playwright/chromium-1217/chrome-win64/chrome.exe",
);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const ensureDir = (d) => mkdirSync(d, { recursive: true });

/** Atomic JSON write (temp file + rename) so a killed stage never leaves a
 *  half-written artifact — the "safe to stop / no corruption" guarantee. */
export function writeJSON(path, obj) {
  ensureDir(dirname(path));
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2));
  renameSync(tmp, path);
}
export function readJSON(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}
export function writeText(path, text) {
  ensureDir(dirname(path));
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

export function cycleDir(n) { return join(ARTIFACTS, "cycles", String(n)); }

// ────────────────────────────────────────────────────────────── dev server ──

/** Is the Vite dev server already answering on GAME_URL? */
export async function isServerUp(url = GAME_URL) {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 1500);
    const res = await fetch(url, { signal: c.signal });
    clearTimeout(t);
    return res.ok;
  } catch { return false; }
}

/** Ensure a dev server is running. Returns a handle; call .stop() to shut down
 *  ONLY a server this call started (a pre-existing one is left alone). */
export async function ensureServer({ log = console.log } = {}) {
  if (await isServerUp()) {
    log("[server] reusing dev server already on :5174");
    return { owned: false, stop() {} };
  }
  log("[server] starting `npm run dev` …");
  const child = spawn("npm", ["run", "dev"], {
    cwd: GAME_DIR, stdio: "ignore", shell: true, detached: false,
  });
  const pid = child.pid;
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    if (await isServerUp()) { log(`[server] up after ${i + 1}s`); break; }
    if (i === 59) throw new Error("dev server did not come up within 60s");
  }
  return {
    owned: true,
    stop() {
      try {
        if (process.platform === "win32" && pid) {
          spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
        } else { child.kill("SIGTERM"); }
      } catch { /* best effort */ }
    },
  };
}

// ───────────────────────────────────────────────────────────────── browser ──

export async function launchBrowser() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));
  return { browser, page, errors };
}

/** Boot the game fresh (clears any saved run so we always start from the menu). */
export async function bootGame(page) {
  await page.goto(GAME_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);              // boot loader + warm
  await page.evaluate(() => localStorage.removeItem("rh3v2-runsave"));
}

/** The live top-level UI screen, via the __rh3state accessor (fallback "?"). */
export async function uiState(page) {
  return page.evaluate(() => (window.__rh3state ? window.__rh3state() : "?"));
}

/** Click the first match if present; returns whether it clicked. */
export async function clickIf(page, selectorOrLocator, settle = 400) {
  const loc = typeof selectorOrLocator === "string"
    ? page.locator(selectorOrLocator) : selectorOrLocator;
  if (await loc.count()) { await loc.first().click(); await page.waitForTimeout(settle); return true; }
  return false;
}

/** A compact, JSON-safe snapshot of in-game state for the trace + assertions. */
export async function snapState(page) {
  return page.evaluate(() => {
    const c = window.__rh3;
    if (!c) return { ok: false };
    const ui = window.__rh3state ? window.__rh3state() : "?";
    const enemies = c.enemies?.living ? c.enemies.living() : [];
    return {
      ok: true,
      ui,
      run: { state: c.run?.state, position: c.run?.position, totalForks: c.run?.totalForks },
      player: { hp: c.player?.hp, maxHp: c.player?.maxHp, alive: c.player?.alive, hero: c.player?.hero?.id },
      tempo: { value: c.tempo?.value, zone: c.tempo?.zone?.zone, crashReady: c.tempo?.crashReady },
      enemyCount: enemies.length,
      enemyHp: enemies.slice(0, 8).map((e) => ({ kind: e.kind, hp: e.hp, maxHp: e.maxHp })),
      stats: c.stats ? {
        kills: c.stats.kills, damageDealt: c.stats.damageDealt,
        damageTaken: c.stats.damageTaken, roomsCleared: c.stats.roomsCleared,
        perfectDodges: c.stats.perfectDodges, depth: c.stats.depth,
      } : null,
    };
  });
}

// ───────────────────────────────────────────────────────────────────── git ──

function git(args, opts = {}) {
  const r = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", ...opts });
  return { code: r.status ?? 0, out: (r.stdout || "").trim(), err: (r.stdout || "") + (r.stderr || "") };
}

/** Snapshot the working tree into a dangling commit (does NOT touch the tree or
 *  the index). Returns a ref usable as a diff base, so `git diff <base>` after an
 *  edit shows ONLY that edit, leaving any pre-existing WIP out of the picture.
 *
 *  `git stash create` returns empty on a clean tree (then HEAD is the correct
 *  base). If it returns empty on a DIRTY tree it failed — we throw rather than
 *  fall back to HEAD, because HEAD would wrongly attribute all the pre-existing
 *  WIP to this cycle (the bug that let a cycle "own" the whole working tree). */
export function gitSnapshot() {
  const created = git(["stash", "create"]);
  if (created.out) return created.out;
  const dirty = git(["status", "--porcelain", "--", "game/"]).out;
  if (dirty) throw new Error("gitSnapshot: stash create failed on a dirty tree — " + created.err.slice(0, 200));
  return git(["rev-parse", "HEAD"]).out;
}

/** Files changed (relative to repo root) since a snapshot base, under game/src. */
export function gitChangedFiles(base) {
  const r = git(["diff", "--name-only", base, "--", "game/"]);
  return r.out ? r.out.split(/\r?\n/).filter(Boolean) : [];
}

/** Unified diff of everything changed since `base` (the cycle's own edits). */
export function gitCycleDiff(base) {
  return git(["diff", base, "--", "game/"]).out;
}

/** Revert exactly the cycle's edits (since `base`), leaving any pre-existing
 *  working-tree changes intact. Used when a cycle fails its build gate.
 *
 *  Uses `git checkout <base> -- <files>` (byte-exact restore from the snapshot)
 *  rather than `git apply -R`, which on Windows can reintroduce CRLF/EOL noise.
 *  We then unstage so the restored files keep their original staging state. */
export function gitRevertCycle(base) {
  const files = gitChangedFiles(base);
  if (!files.length) return true;
  const co = spawnSync("git", ["checkout", base, "--", ...files], { cwd: REPO_ROOT, encoding: "utf8" });
  spawnSync("git", ["reset", "-q", "--", ...files], { cwd: REPO_ROOT, encoding: "utf8" });
  return (co.status ?? 1) === 0;
}

/** tsc --noEmit && vite build — the build gate. */
export function runVerify({ log = console.log } = {}) {
  log("[verify] tsc --noEmit && vite build …");
  const r = spawnSync("npm", ["run", "verify"], {
    cwd: GAME_DIR, encoding: "utf8", shell: true,
  });
  const ok = (r.status ?? 1) === 0;
  log(`[verify] ${ok ? "PASS" : "FAIL"}`);
  return { ok, out: (r.stdout || "") + (r.stderr || "") };
}

// ──────────────────────────────────────────────────────────────────── claude ──

/** Invoke headless Claude Code (`claude -p`). Prompt goes via stdin to dodge
 *  arg-length/escaping limits. Returns { ok, result, raw, cost, durationMs }. */
export function runClaude(prompt, {
  allowedTools = ["Read", "Grep", "Glob"],
  permissionMode = "acceptEdits",
  model,
  timeoutMs = 240000,
  cwd = GAME_DIR,
  log = console.log,
} = {}) {
  const args = ["-p", "--output-format", "json", "--permission-mode", permissionMode];
  if (model) args.push("--model", model);
  // --allowedTools is variadic; keep it last so it can't swallow other flags.
  args.push("--allowedTools", ...allowedTools);
  log(`[claude] ${permissionMode} tools=[${allowedTools.join(",")}] (timeout ${Math.round(timeoutMs / 1000)}s)`);
  const r = spawnSync("claude", args, {
    cwd, input: prompt, encoding: "utf8", timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024, shell: false,
  });
  if (r.error) return { ok: false, result: "", raw: String(r.error), error: String(r.error) };
  let envelope = null;
  try { envelope = JSON.parse(r.stdout); } catch { /* not json */ }
  const result = envelope?.result ?? r.stdout ?? "";
  const isErr = envelope?.is_error === true || (r.status ?? 0) !== 0;
  return {
    ok: !isErr,
    result,
    raw: r.stdout,
    cost: envelope?.total_cost_usd,
    durationMs: envelope?.duration_ms,
    numTurns: envelope?.num_turns,
  };
}

/** Pull the first balanced JSON object/array out of an LLM reply (tolerates
 *  ```json fences and surrounding prose). Returns null if none parses. */
export function extractJSON(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [];
  if (fence) candidates.push(fence[1]);
  candidates.push(text);
  for (const c of candidates) {
    const s = c.indexOf("{"), e = c.lastIndexOf("}");
    if (s >= 0 && e > s) {
      try { return JSON.parse(c.slice(s, e + 1)); } catch { /* keep trying */ }
    }
  }
  return null;
}

export { rmSync, existsSync };
