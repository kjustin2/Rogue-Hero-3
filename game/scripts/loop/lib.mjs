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
import { guard, track, untrack } from "../lib/guard.cjs";

// Every script that imports this lib runs under the test-run governor: a hard
// 10-min watchdog, the machine-wide one-test-at-a-time lock, a low-memory
// sentinel, below-normal priority, and child cleanup on every exit path.
// Long-running consumers (orchestrate, perf-bench) re-call guard() with a
// bigger maxMinutes to extend. See lib/guard.cjs — the "never crash the
// computer again" layer.
guard({ maxMinutes: 10 });
export { guard };

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
  track(child); // guard tree-kills it if this script hangs/aborts
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
      untrack(child);
    },
  };
}

// ───────────────────────────────────────────────────────────────── browser ──

export async function launchBrowser() {
  // --mute-audio: never blast the soundtrack through the system during test runs.
  // --enable-unsafe-swiftshader: Chrome 139+ removed the automatic software-GL
  // fallback — without the opt-in, headless WebGL context creation can FAIL
  // (black canvas). Harmless when a real GPU/WARP path is used instead.
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ["--mute-audio", "--enable-unsafe-swiftshader"],
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));
  return { browser, page, errors };
}

/** Boot the game fresh (clears any saved run so we always start from the menu).
 *  `query` appends a URL query string, e.g. "?perf" to bake the perf overlay into
 *  every screenshot. */
export async function bootGame(page, { query = "" } = {}) {
  await page.goto(GAME_URL + query, { waitUntil: "networkidle" });
  // The portrait/material warm path varies by GPU; wait for the real readiness
  // signal instead of photographing the loader on slower machines.
  await page.locator("#rift-loader").waitFor({ state: "hidden", timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(250);
  await page.evaluate(() => localStorage.removeItem("rh3v2-runsave"));
  // Stamp which rasterizer produced this run's evidence (SwiftShader vs WARP vs
  // real GPU) — perf numbers and shot baselines only compare within one renderer.
  const glr = await page.evaluate(() => {
    try {
      const gl = window.__rh3.stage.renderer.getContext();
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    } catch { return "?"; }
  });
  console.log(`[boot] GL_RENDERER: ${glr}`);
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

// ───────────────────────────────────────────────────── scenario navigation ──

/** Menu → hero select → first live combat room, intro skipped. Leaves the game in
 *  `playing` with a run context so __rh3debug.scenario/room/boss can be used next. */
export async function enterRun(page, { hero = 0, settle = 3000 } = {}) {
  await clickIf(page, page.locator("button", { hasText: /Begin Run|New Run/ }), 700);
  const cards = page.locator(".hero-card");
  if (await cards.count()) { await cards.nth(hero).click(); await sleep(700); }
  await clickIf(page, page.locator(".story-skip"), 500);
  await sleep(settle);
}

/** Cut to a named __rh3debug scenario ("boss:colossus:p2", "room:elite", "enemy:caster",
 *  "menu"/"victory"/"death") and settle on the live frame, skipping any cutscene.
 *  Assumes a run is already active (call enterRun first). Returns the landed ui state. */
export async function gotoScenario(page, name, { settle = 2600, skip = true, godmode = true } = {}) {
  const known = await page.evaluate((n) => !!window.__rh3debug?.scenario(n), name);
  if (!known) return { ok: false, ui: await uiState(page) };
  if (skip) {
    for (let i = 0; i < 16; i++) {
      if ((await uiState(page)) === "playing") break;
      await page.evaluate(() => window.__rh3debug?.skipCutscene?.());
      try { await page.keyboard.press("Space"); } catch { /* ignore */ }
      await sleep(250);
    }
  }
  await sleep(settle);
  if (godmode) await page.evaluate(() => window.__rh3debug?.godmode?.());
  return { ok: true, ui: await uiState(page) };
}

// ───────────────────────────────────────────────────────────────── perf ──

/** Sample frame pacing + GPU load over a window. Prefers the in-engine
 *  window.__rh3perf instrument (accurate per-frame draw calls, marks, snapshot);
 *  falls back to a raw rAF probe for older bundles that lack the hook.
 *
 *  opts.action(page) — optional async fn run DURING the window (e.g. spam attacks);
 *  if omitted, simply waits opts.ms. Returns a PerfStats-shaped object (+ snap, marks). */
export async function samplePerf(page, { ms = 4000, label = "", action = null } = {}) {
  const hasPerf = await page.evaluate(() => !!window.__rh3perf);
  if (hasPerf) {
    await page.evaluate((l) => window.__rh3perf.start(l), label);
    if (action) await action(page); else await sleep(ms);
    return page.evaluate(() => window.__rh3perf.stop());
  }
  // Fallback: rAF probe (frame pacing only; no GPU-load snapshot).
  await page.evaluate(() => {
    const w = window; w.__ftp = []; w.__ftl = performance.now();
    const probe = () => { const n = performance.now(); w.__ftp.push(n - w.__ftl); w.__ftl = n; w.__ftpR = requestAnimationFrame(probe); };
    w.__ftpR = requestAnimationFrame(probe);
  });
  if (action) await action(page); else await sleep(ms);
  return page.evaluate(() => {
    const w = window; cancelAnimationFrame(w.__ftpR);
    const ft = w.__ftp.length > 4 ? w.__ftp.slice(2) : w.__ftp;
    const n = ft.length || 1, sum = ft.reduce((a, b) => a + b, 0), mean = sum / n;
    const sorted = [...ft].sort((a, b) => a - b);
    const pct = (p) => sorted[Math.min(n - 1, Math.floor(n * p))] || 0;
    const r2 = (x) => Math.round(x * 100) / 100;
    return {
      ms: Math.round(sum), frames: ft.length, fps: mean > 0 ? r2(1000 / mean) : 0,
      mean: r2(mean), p50: r2(pct(0.5)), p95: r2(pct(0.95)), p99: r2(pct(0.99)),
      min: r2(Math.min(...ft, 0)), max: r2(Math.max(...ft, 0)),
      long16: ft.filter((d) => d > 16.7).length, long33: ft.filter((d) => d > 33.4).length,
      long50: ft.filter((d) => d > 50).length, long100: ft.filter((d) => d > 100).length,
      over250: ft.filter((d) => d > 250).length,
      snap: { calls: 0, triangles: 0, programs: 0, geometries: 0, textures: 0, heapMB: 0, enemies: 0, state: "?" },
      marks: [], _fallback: true,
    };
  });
}

/** Latest rolling perf report (no window). */
export async function perfReport(page) {
  return page.evaluate(() => (window.__rh3perf ? window.__rh3perf.report() : null));
}

// ───────────────────────────────────────────────────────────── shot gates ──

/** Decode a PNG in-page (detached canvases; touches nothing) and return
 *  objective frame stats — the cheap gate that catches broken frames before a
 *  human or a paid AI judge reads them. Pair with shotFlags(). */
export async function shotStats(page, absPath) {
  const url = `data:image/png;base64,${readFileSync(absPath).toString("base64")}`;
  return page.evaluate(async (src) => {
    const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("decode")); i.src = src; });
    const c = document.createElement("canvas"); c.width = im.width; c.height = im.height;
    const g = c.getContext("2d"); g.drawImage(im, 0, 0);
    const d = g.getImageData(0, 0, im.width, im.height).data;
    let black = 0, blow = 0, sum = 0, sumSq = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], gg = d[i + 1], b = d[i + 2];
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      const lum = (r + gg + b) / 3;
      if (mx < 8) black++;
      if (mn > 190 && mx - mn < 45) blow++; // bright-desat: the additive-white washout class
      sum += lum; sumSq += lum * lum;
    }
    // 8×8 average-hash — cheap pixel-identity signature for duplicate detection.
    const t = document.createElement("canvas"); t.width = 8; t.height = 8;
    const tg = t.getContext("2d"); tg.drawImage(im, 0, 0, 8, 8);
    const td = tg.getImageData(0, 0, 8, 8).data;
    let sig = "";
    for (let i = 0; i < td.length; i += 4) sig += Math.round((td[i] + td[i + 1] + td[i + 2]) / 48).toString(36);
    const mean = sum / n;
    return {
      w: im.width, h: im.height,
      pctBlack: Math.round((10000 * black) / n) / 100,
      pctBlowout: Math.round((10000 * blow) / n) / 100,
      meanLum: Math.round(mean * 10) / 10,
      stdLum: Math.round(Math.sqrt(Math.max(0, sumSq / n - mean * mean)) * 10) / 10,
      sig,
    };
  }, url);
}

/** Objective failure flags for a shotStats() result. Empty array = frame OK. */
export function shotFlags(s) {
  const flags = [];
  if (s.pctBlack > 98) flags.push("BLACK");
  else if (s.pctBlowout > 2.5) flags.push("BLOWOUT");
  else if (s.stdLum < 4) flags.push("FLAT"); // uniform non-black frame (dead composer / stuck fill)
  // Portrait QA is intentionally 390px wide; reject genuinely broken capture
  // surfaces while accepting supported narrow layouts down to 300x240.
  if (s.w < 300 || s.h < 240) flags.push("TINY");
  return flags;
}

/** Compare stats against a budget of MAX values. Keys may be dotted to reach the
 *  GPU snapshot, e.g. { p95: 120, max: 350, over250: 0, "snap.calls": 900 }.
 *  Returns { pass, fails:[ "p95=140 > 120", … ] }. */
export function assertBudget(stats, budget) {
  const fails = [];
  for (const [key, max] of Object.entries(budget)) {
    const v = key.includes(".") ? key.split(".").reduce((o, p) => (o == null ? o : o[p]), stats) : stats[key];
    if (typeof v === "number" && v > max) fails.push(`${key}=${v} > ${max}`);
  }
  return { pass: fails.length === 0, fails };
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
    cwd: GAME_DIR, encoding: "utf8", shell: true, timeout: 10 * 60_000,
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
