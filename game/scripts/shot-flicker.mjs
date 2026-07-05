// FLICKER + BLOWOUT smoke. Stills miss motion glitches, so this captures two
// filmstrips and gates on an automated metric that console-only smokes can't see:
//   • pan   — slow camera pan over a frozen arena (z-fight / sweeping-additive / shafts)
//   • act   — the between-acts theme crossfade (rim blow-to-white was the "act-load flicker")
// GATE: per-frame fraction of near-WHITE pixels. A spike = additive-white screen-fill /
// bloom blow-out — the owner's single most-repeated complaint class. Decodes each frame
// in the browser (Image→canvas→getImageData), so no node PNG dependency.
//   → shots/flicker/pan-NN.png / act-NN.png  +  a PASS/FAIL brightness report.
import { launchBrowser, bootGame, enterRun, sleep } from "./loop/lib.mjs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = "shots/flicker";
// A frame is "blown out" past this fraction of bright-desaturated (washed-to-white) pixels.
// The rim-blowout + additive sweeper-bar bugs each covered several percent; a clean frame
// sits under ~0.4% (settled rim + small white HUD text). 2.5% catches a washout with wide
// headroom without masking a regression.
const WHITE_GATE = 0.025;
mkdirSync(OUT, { recursive: true });
const { browser, page, errors } = await launchBrowser();

// Capture a frame AND measure its near-white fraction (decoded in-page — no deps).
const grab = async (name) => {
  const buf = await page.screenshot({ path: join(OUT, `${name}.png`) });
  const b64 = Buffer.from(buf).toString("base64");
  const white = await page.evaluate(async (b) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b;
    await img.decode();
    const cv = document.createElement("canvas");
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const g = cv.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, cv.width, cv.height).data;
    // "Blown out" = bright AND desaturated (channels bunched near white). Catches an
    // additive FX washed toward white by bloom + ACES — including the pale ~200-227 bars a
    // strict >235 test misses — while ignoring bright SATURATED colors (a hot cyan/green FX
    // keeps a low min channel) and dark pixels.
    let w = 0;
    for (let i = 0; i < d.length; i += 4) {
      const mn = Math.min(d[i], d[i + 1], d[i + 2]);
      const mx = Math.max(d[i], d[i + 1], d[i + 2]);
      if (mn > 190 && mx - mn < 45) w++;
    }
    return w / (d.length / 4);
  }, b64);
  return { name, white };
};

await bootGame(page);
await enterRun(page);
await page.evaluate(() => window.__rh3debug?.godmode?.());
// FREEZE enemies (don't clear) — clearing empties the room, which pulls the camera back to
// the "cleared" framing; the beam blow-out only shows at CLOSE combat framing, so we keep
// the room in "fighting" state. Then force the sweeping-beam hazard in so the pan always
// exercises it — its additive blade washing to white is the class the gate must catch.
await page.evaluate(() => {
  const c = window.__rh3;
  for (const e of c.enemies.living()) e.freeze?.(9999);
  c.features.clear?.();
  c.features.setup({ feature: "sweeper" });
});
await sleep(400);
await page.evaluate(() => window.__rh3.fx.clear?.());

const samples = { pan: [], act: [] };

// --- Filmstrip A: slow camera pan over the arena.
for (let i = 0; i < 14; i++) {
  const a = (i / 14) * Math.PI * 0.85 - 0.4;
  const px = Math.sin(a) * 7, pz = Math.cos(a) * 5 - 1;
  await page.evaluate(([x, z]) => {
    const c = window.__rh3;
    c.player.pos.set(x, 0, z);
    c.cam.snapTo?.(x, z);
    c.fx.clear?.();
  }, [px, pz]);
  await sleep(130);
  await page.evaluate(() => window.__rh3.fx.clear?.());
  samples.pan.push(await grab(`pan-${String(i).padStart(2, "0")}`));
}

// --- Filmstrip B: act-loading theme crossfade (rim must not blow to white).
await page.evaluate(() => { window.__rh3menus?.clear?.(); window.__rh3debug?.interlude?.(3); });
for (let i = 0; i < 14; i++) {
  await sleep(120);
  samples.act.push(await grab(`act-${String(i).padStart(2, "0")}`));
}

// --- Report + gate.
let failed = false;
for (const [seq, arr] of Object.entries(samples)) {
  const worst = arr.reduce((m, s) => (s.white > m.white ? s : m), arr[0]);
  const pct = (x) => (x * 100).toFixed(1) + "%";
  const bad = worst.white > WHITE_GATE;
  failed = failed || bad;
  console.log(`${seq}: peak white ${pct(worst.white)} @ ${worst.name}  ${bad ? "✗ BLOWOUT" : "ok"}`);
}
console.log(errors.length ? `ERRORS: ${errors.slice(0, 5).join("\n")}` : "NO CONSOLE ERRORS");
console.log(failed ? "FLICKER GATE: FAIL (additive-white blow-out)" : "FLICKER GATE: PASS");
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
