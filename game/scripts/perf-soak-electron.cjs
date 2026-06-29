/* eslint-disable */
// REAL-GPU performance soak — the detailed lag hunt.
//
// The headless harness (SwiftShader) can't reproduce the player's "random lag
// spots": a real GPU driver and real V8 GC behave differently. This runs the BUILT
// game in a hidden Electron window — the actual shipping renderer on THIS machine's
// real GPU — drives a long, realistic battery (every act's combat under heavy load,
// every boss entrance/phase/fight, all card VFX, interstitials, plus a sustained
// soak so GC cycles many times), and reports every frame spike CLASSIFIED as a
// shader compile (fixable via warm-up) or a GC pause / stall, attributed to the
// exact activity that caused it.
//
// Run:  npm run perf:soak                 (builds, then soaks ~3 min)
//       SOAK=quick npm run perf:soak      (~1 min smoke of the harness)
//       SOAK=deep  npm run perf:soak      (longer windows, more GC coverage)
// Hidden window (show:false) so it never steals editor focus. Real frames still
// render (paintWhenInitiallyHidden + backgroundThrottling:false), same as the
// smoke-electron net. Reads the structured spike log from window.__rh3perf.

const { app, BrowserWindow } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");

const distDir = path.join(__dirname, "..", "dist");
const outDir = path.join(__dirname, "..", "artifacts", "perf");
const shotDir = path.join(__dirname, "..", "shots");
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(shotDir, { recursive: true });

if (!fs.existsSync(path.join(distDir, "index.html"))) {
  console.error("No dist/ build found. Run `npm run build` first (npm run perf:soak does this).");
  process.exit(1);
}

const MODE = process.env.SOAK || "full"; // quick | full | deep
const SCALE = MODE === "quick" ? 0.4 : MODE === "deep" ? 1.8 : 1;
const ms = (base) => Math.round(base * SCALE);

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff": "font/woff",
  ".woff2": "font/woff2", ".mp3": "audio/mpeg",
};

let server;
function startServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      let p = decodeURIComponent((req.url || "/").split("?")[0]);
      if (p === "/") p = "/index.html";
      const file = path.join(distDir, p);
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

const sleep = (t) => new Promise((r) => setTimeout(r, t));
const errors = [];
const phases = []; // { name, stats }

app.whenReady().then(async () => {
  const port = await startServer();
  const win = new BrowserWindow({
    width: 1280, height: 720,
    show: false, backgroundColor: "#05070a",
    webPreferences: { backgroundThrottling: false, offscreen: false },
  });
  // A hidden window throttles the render loop to ~1fps, making perf meaningless. We
  // need real frames at full rate, so show the window WITHOUT focusing it: it paints
  // exactly like the player's session but never grabs editor focus or the cursor.
  // (The sanctioned Electron-test pattern — see CLAUDE.md "tests must not steal focus".)
  win.showInactive();
  console.log("[soak] a small game window will appear (unfocused) — it must stay visible to render real frames.");
  win.webContents.on("console-message", (_e, level, message) => {
    if (level >= 3) errors.push("CONSOLE: " + message);
    else if (/rh3perf\] frame spike/.test(message)) { /* captured structurally below */ }
  });
  let rendererGone = null, unresponsive = false;
  win.webContents.on("render-process-gone", (_e, d) => { rendererGone = d.reason; errors.push("RENDERER GONE: " + d.reason); });
  win.webContents.on("unresponsive", () => { unresponsive = true; errors.push("UNRESPONSIVE"); });

  const js = (s) => win.webContents.executeJavaScript(s);
  const capture = async (name) => {
    try { const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(shotDir, `soak-${name}.png`), img.toPNG()); } catch { /* ignore */ }
  };

  // Run a labeled, measured phase. `setup` runs first; `load` true starts the combat
  // load driver for the window. Returns the phase frame stats.
  const phase = async (name, dur, { setup, load = false, loadCfg = null } = {}) => {
    // Fire-and-forget: async setups (the card-cast loop, theme crossfades) must run
    // DURING the measured window, not be awaited before it. The trailing `;undefined`
    // also keeps the IPC result cloneable regardless of what the setup evaluates to.
    if (setup) { try { await js(setup + "\n;undefined"); } catch (e) { errors.push(`SETUP ${name}: ${e.message}`); } }
    await js(`window.__rh3perf.setSpikeLabel(${JSON.stringify(name)}); window.__rh3perf.start(${JSON.stringify(name)});`);
    if (load) await js(`window.__soakStart(${JSON.stringify(loadCfg || loadCfgFor(name))})`);
    // Force a paint partway so the compositor keeps ticking while hidden.
    await sleep(Math.round(dur / 2));
    await capture(name);
    await sleep(dur - Math.round(dur / 2));
    if (load) await js(`window.__soakStop()`);
    const stats = await js(`window.__rh3perf.stop()`);
    phases.push({ name, stats });
    const long = stats.long50 + (stats.over250 || 0);
    console.log(`  ${name.padEnd(22)} mean ${String(Math.round(stats.mean)).padStart(3)}ms  p99 ${String(Math.round(stats.p99)).padStart(3)}ms  max ${String(Math.round(stats.max)).padStart(4)}ms  >50ms:${long}  draws ${stats.snap.calls}`);
    return stats;
  };

  // Per-phase combat-load knobs (enemy roster differs by act for real material load).
  const ROSTER = {
    1: ["husk", "spitter", "swarmer", "bomber", "sentinel"],
    2: ["wisp", "leaper", "tether", "mirror", "caster", "shade", "bastion"],
    3: ["husk", "caster", "shade", "bastion", "sentinel", "swarmer"],
    4: ["brute", "harrier", "splitter", "caster", "bomber"],
    5: ["voidling", "warper", "brute", "harrier", "caster"],
  };
  function loadCfgFor(name) {
    const m = name.match(/act(\d)/);
    const act = m ? Number(m[1]) : 3;
    return {
      kinds: ROSTER[act] || ROSTER[3],
      maxEnemies: 22, spawnPerTick: 8, projPerTick: 10, intervalMs: 140,
      castCards: true,
      castIds: ["chain-lightning", "seeker-swarm", "gravity-well", "singularity", "meteor-call", "flame-channel", "rend-boomerang", "decoy-totem"],
    };
  }

  try {
    await win.loadURL(`http://127.0.0.1:${port}/?perf`);
    await sleep(3000); // boot loader + warm-up
    if (!(await js(`!!window.__rh3 && !!window.__rh3perf`))) { errors.push("hooks missing in prod build"); throw new Error("no hooks"); }

    // Lower the spike threshold so micro-stalls are captured, and start clean.
    await js(`window.__rh3perf.setSpikeThreshold(50); window.__rh3perf.clearSpikes();`);

    // Inject the combat load driver + an all-cards VFX caster into the renderer.
    await js(`
      window.__soakStart = (cfg) => {
        const c = window.__rh3, cards = window.__rh3cards; let tick = 0;
        window.__soakTimer = setInterval(() => {
          tick++;
          c.player.hp = c.player.maxHp;
          c.player.pos.set(Math.sin(tick*0.3)*1.2, 0, Math.cos(tick*0.27)*1.2);
          c.player.facing = tick*0.23;
          const live = c.enemies.living().filter(e => e.kind !== 'boss').length;
          if (live < cfg.maxEnemies) for (let i=0;i<cfg.spawnPerTick;i++){ const a=((tick+i)/cfg.spawnPerTick)*Math.PI*2, r=8+(i%3)*2; try{ c.enemies.spawn(cfg.kinds[(tick+i)%cfg.kinds.length], Math.sin(a)*r, Math.cos(a)*r, 0); }catch(e){} }
          if (cfg.castCards && cards){ const card = cards.find(k => k.id === cfg.castIds[tick % cfg.castIds.length]); if (card) try{ c.caster.cast(card, tick%4===0); }catch(e){} }
          for (let i=0;i<cfg.projPerTick;i++){ const a=(tick*0.37)+(i/cfg.projPerTick)*Math.PI*2; try{ c.hostiles.fire(Math.sin(a)*12,Math.cos(a)*12,a+Math.PI,{speed:10,dmg:2,color:0xff6644,radius:0.22,range:30}); c.projectiles.fire(c.player.pos.x,c.player.pos.z,a,{speed:14,dmg:4,color:0x66e8ff,radius:0.2,range:26,pierce:i%3===0}); }catch(e){} }
          try{ c.combat.meleeSweep(c.player.facing, Math.PI*2, 5.5, 6, 2, tick%3===0); }catch(e){}
        }, cfg.intervalMs || 140);
      };
      window.__soakStop = () => clearInterval(window.__soakTimer);
      window.__castAllCards = async () => {
        const c = window.__rh3, cards = window.__rh3cards;
        // Both forms: a card's HONED (upgraded) VFX can be a distinct material the
        // base cast never warms — a prime "first time I cast my honed card" hitch.
        for (const up of [false, true]) for (const card of cards){ try { c.caster.cast(card, up); } catch(e){} await new Promise(r=>setTimeout(r,70)); }
      };
      true;
    `);

    // 1) Menu / hero-select baselines.
    await phase("menu-idle", ms(2500), { setup: `window.__rh3debug.scenario("menu")` });

    // 2) Enter a run so the debug scenarios have a live context.
    await js(`localStorage.removeItem('rh3v2-runsave')`);
    await js(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/Begin Run|New Run/.test(x.textContent)); if(b)b.click();})()`);
    await sleep(700);
    await js(`(()=>{const h=document.querySelector('.hero-card'); if(h)h.click();})()`);
    await sleep(900);
    await js(`(()=>{const s=document.querySelector('.story-skip'); if(s)s.click();})()`);
    await sleep(2600);

    // 3) Every card's first-use VFX (prime compile suspects), in a live combat room.
    await js(`window.__rh3debug.room("combat", 1); window.__rh3menus.clear();`);
    await sleep(900);
    // Fixed window (NOT scaled): must span the full base+honed cast loop (2×34 casts
    // at 70ms) to catch every first-use VFX compile, honed forms included.
    await phase("cards-allvfx", 34 * 2 * 70 + 1800, { setup: `window.__castAllCards()` });

    // 4) Every act's combat under heavy sustained load (real roster + theme).
    for (let act = 1; act <= 5; act++) {
      await phase(`combat-act${act}`, ms(7000), {
        setup: `window.__rh3debug.room("combat", ${act}); window.__rh3menus.clear(); window.__rh3.player.hp = window.__rh3.player.maxHp;`,
        load: true,
      });
    }

    // 4b) Per-enemy ISOLATION (cards OFF) — spawn only one kind under fire so any
    //     first-use compile attributes to THAT enemy's visuals (hit/shield/beam/death),
    //     not to a card. This is how the act-2 compile gets pinned to an exact type.
    const KIND_ACT = { husk:1,spitter:1,swarmer:1,bomber:1,sentinel:1, wisp:2,leaper:2,tether:2,mirror:2,caster:2,shade:2,bastion:2, brute:4,harrier:4,splitter:4, voidling:5,warper:5 };
    for (const kind of Object.keys(KIND_ACT)) {
      await phase(`solo-${kind}`, ms(1800), {
        setup: `window.__rh3debug.room("combat", ${KIND_ACT[kind]}); window.__rh3menus.clear(); window.__rh3.enemies.clear(); window.__rh3.player.hp = window.__rh3.player.maxHp;`,
        load: true,
        loadCfg: { kinds: [kind], maxEnemies: 9, spawnPerTick: 3, projPerTick: 8, intervalMs: 150, castCards: false, castIds: [] },
      });
    }

    // 5) Theme crossfades (each act look) — arena.applyTheme path.
    await phase("theme-crossfades", ms(4000), {
      setup: `(async()=>{ for (let a=1;a<=5;a++){ window.__rh3debug.room("combat", a); window.__rh3menus.clear(); await new Promise(r=>setTimeout(r,600)); } })()`,
    });

    // 6) Interstitials (DOM-heavy overlays).
    for (const [name, call] of [
      ["draft", `window.__rh3menus.clear(); window.__rh3.events.emit("ROOM_CLEARED", { index: 0 })`],
      ["shop", `window.__rh3menus.clear(); window.__rh3menus.showShop(()=>{})`],
      ["rest", `window.__rh3menus.clear(); window.__rh3menus.showRest(()=>{})`],
      ["treasure", `window.__rh3menus.clear(); window.__rh3menus.showTreasure(()=>{})`],
      ["event", `window.__rh3menus.clear(); window.__rh3menus.showEvent(()=>{})`],
    ]) {
      await phase(`ui-${name}`, ms(1800), { setup: call });
    }
    await js(`window.__rh3menus.clear();`);

    // 7) Every boss: entrance cutscene → phase transition → fight under load.
    for (const kind of ["warden", "spire", "colossus", "tyrant", "unmaker", "echo"]) {
      await phase(`boss-${kind}-entrance`, ms(4500), {
        setup: `window.__rh3menus.clear(); window.__rh3.player.hp = window.__rh3.player.maxHp; window.__rh3debug.scenario("boss:${kind}");`,
      });
      await phase(`boss-${kind}-phase`, ms(3500), {
        setup: `window.__rh3debug.skipCutscene(); window.__rh3debug.setBossPhase(0.55);`,
      });
      await phase(`boss-${kind}-fight`, ms(3500), {
        setup: `window.__rh3debug.skipCutscene(); window.__rh3debug.godmode();`,
        load: true,
      });
    }

    // 8) Sustained soak — long continuous heavy combat so GC cycles many times.
    await js(`window.__rh3debug.room("combat", 4); window.__rh3menus.clear(); window.__rh3.player.hp = window.__rh3.player.maxHp;`);
    await sleep(600);
    await phase("sustained-soak", ms(22000), { load: true });

    // ── Collect + analyze ─────────────────────────────────────────────────────
    const spikes = await js(`window.__rh3perf.spikes()`);
    const finalReport = await js(`window.__rh3perf.report()`);
    writeReport(spikes, finalReport);
  } catch (e) {
    errors.push("EXCEPTION: " + (e && e.message ? e.message : String(e)));
    console.error(e);
  }

  if (rendererGone) console.log(`\n*** RENDERER PROCESS GONE: ${rendererGone} (a real crash) ***`);
  if (unresponsive) console.log(`\n*** WINDOW WENT UNRESPONSIVE (a real hang) ***`);
  const realErrors = errors.filter((e) => !/frame spike/.test(e));
  console.log(realErrors.length ? `\nERRORS (${realErrors.length}):\n` + realErrors.slice(0, 20).join("\n") : "\nNO RENDERER ERRORS.");
  try { server.close(); } catch (_) {}
  win.destroy();
  app.exit(realErrors.length || rendererGone ? 1 : 0);
});

function writeReport(spikes, finalReport) {
  const byLabel = {};
  const byClass = { compile: 0, "gc/stall": 0 };
  for (const s of spikes) {
    byClass[s.klass] = (byClass[s.klass] || 0) + 1;
    const b = (byLabel[s.label] ||= { label: s.label || "(none)", count: 0, max: 0, compile: 0, gc: 0, maxDProg: 0 });
    b.count++; b.max = Math.max(b.max, s.dt);
    if (s.klass === "compile") { b.compile++; b.maxDProg = Math.max(b.maxDProg, s.dProg); } else b.gc++;
  }
  const labelRows = Object.values(byLabel).sort((a, b) => b.max - a.max);
  const worst = [...spikes].sort((a, b) => b.dt - a.dt).slice(0, 25);
  const compiles = spikes.filter((s) => s.klass === "compile").sort((a, b) => b.dt - a.dt);

  console.log("\n══════════════════════ SOAK RESULT ══════════════════════");
  console.log(`mode=${MODE}  phases=${phases.length}  total spikes(>${"50"}ms)=${spikes.length}  [compile ${byClass.compile} | gc/stall ${byClass["gc/stall"]}]`);

  console.log("\n── Worst phases by max frame (ms) ──");
  [...phases].sort((a, b) => b.stats.max - a.stats.max).slice(0, 10)
    .forEach((p) => console.log(`  ${p.name.padEnd(22)} max ${String(Math.round(p.stats.max)).padStart(4)}ms  p99 ${String(Math.round(p.stats.p99)).padStart(3)}ms  mean ${String(Math.round(p.stats.mean)).padStart(3)}ms`));

  if (compiles.length) {
    console.log("\n── FIRST-USE SHADER COMPILES (fixable: extend warm-up) ──");
    compiles.slice(0, 20).forEach((s) => console.log(`  ${String(s.dt).padStart(4)}ms  +${s.dProg} prog  @${s.label || s.state}  (total ${s.programs})`));
  } else {
    console.log("\n── No first-use compile spikes captured (warm-up is covering them) ──");
  }

  console.log("\n── Spikes by activity (max ms, count, class split) ──");
  labelRows.forEach((b) => console.log(`  ${(b.label).padEnd(22)} max ${String(b.max).padStart(4)}ms  n=${String(b.count).padStart(3)}  [compile ${b.compile} gc ${b.gc}]${b.maxDProg ? `  +${b.maxDProg}prog` : ""}`));

  console.log("\n── 25 worst individual spikes ──");
  worst.forEach((s) => console.log(`  ${String(s.dt).padStart(4)}ms  ${s.klass.padEnd(8)}  @${(s.label || s.state).padEnd(22)}  enemies ${s.enemies}  draws ${s.draws}  Δprog ${s.dProg}  Δheap ${s.dHeapMB}mb`));

  const out = { mode: MODE, generatedBy: "perf-soak-electron", byClass, phases, labels: labelRows, worst, compiles, finalReport };
  const file = path.join(outDir, "soak.json");
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`\nFull data → artifacts/perf/soak.json`);
  console.log("Reading the result: 'compile' spikes are fixable by extending the boot warm-up to cover that activity; 'gc/stall' spikes mean per-frame allocation in that activity — reduce churn there. A phase with high max but zero spikes-by-class was a one-off (first entry / theme load).");
}
