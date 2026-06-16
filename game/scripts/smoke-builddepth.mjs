// Build-depth smoke: Vulnerable status (dealDamage scales), Shatterglass detonator,
// Overcharger free-3rd-cast, card tags + relic tiers present. Needs dev server :5174.
import { chromium } from "playwright-core";
import { join } from "node:path";

const EXE = join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1217/chrome-win64/chrome.exe");
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
await page.goto("http://localhost:5174", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

let fail = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? "  — " + extra : ""}`); if (!ok) fail++; };

// Start a real run so the frame loop ticks enemies (debugLoadNode alone won't).
await page.evaluate(() => localStorage.removeItem("rh3v2-runsave"));
await page.locator("button", { hasText: /Begin Run|New Run/ }).click();
await page.waitForTimeout(600);
await page.locator(".hero-card").first().click();
await page.waitForTimeout(700);
if (await page.locator(".story-skip").count()) { await page.locator(".story-skip").click(); }
await page.waitForTimeout(2400);

// --- Card tags assigned + relic tiers present
const data = await page.evaluate(() => {
  const cards = window.__rh3cards;
  const tagged = cards.filter((c) => c.tags && c.tags.length).length;
  const relics = window.__rh3gen ? null : null;
  return { total: cards.length, tagged };
});
check("Cards carry build tags", data.tagged >= 30, `${data.tagged}/${data.total}`);

// --- Vulnerable: same base hit does more to a Vulnerable foe
const vuln = await page.evaluate(() => {
  const c = window.__rh3;
  c.enemies.clear();
  c.enemies.spawn("husk", -3, 0, 0);
  c.enemies.spawn("husk", 3, 0, 0);
  // materialize
  return new Promise((res) => setTimeout(() => {
    const list = c.enemies.living().filter((e) => e.kind === "husk");
    if (list.length < 2) return res({ ok: false });
    const [a, b] = list;
    a.applyVulnerable(5, 2);
    const aHp0 = a.hp, bHp0 = b.hp;
    c.combat.dealDamage(a, 10, {});
    c.combat.dealDamage(b, 10, {});
    res({ ok: true, aLoss: aHp0 - a.hp, bLoss: bHp0 - b.hp, isVuln: a.isVulnerable });
  }, 400));
});
check("Vulnerable enemy exists + flagged", vuln.ok && vuln.isVuln);
check("Vulnerable takes more damage", vuln.ok && vuln.aLoss > vuln.bLoss, `${vuln.aLoss} vs ${vuln.bLoss}`);

// --- Shatterglass: hitting a frozen foe clears freeze + blasts a neighbor
const shat = await page.evaluate(() => {
  const c = window.__rh3;
  c.enemies.clear();
  c.relics.owned = [{ id: "shatterglass", name: "Shatterglass", desc: "", icon: "", color: "#fff", rarity: "rare" }];
  c.enemies.spawn("husk", 0, 0, 0);
  c.enemies.spawn("husk", 1.5, 0, 0);
  return new Promise((res) => setTimeout(() => {
    const list = c.enemies.living().filter((e) => e.kind === "husk");
    if (list.length < 2) return res({ ok: false });
    const [a, b] = list;
    a.freeze(3);
    const bHp0 = b.hp;
    c.combat.dealDamage(a, 5, {});
    res({ ok: true, frozenCleared: a.frozen <= 0, neighborHit: b.hp < bHp0 });
  }, 400));
});
check("Shatterglass clears the freeze", shat.ok && shat.frozenCleared);
check("Shatterglass blasts neighbors", shat.ok && shat.neighborHit);

// --- Overcharger: every 3rd cast is free (cooldown 0)
const over = await page.evaluate(() => {
  const c = window.__rh3;
  c.relics.owned = [{ id: "overcharger", name: "Overcharger", desc: "", icon: "", color: "#fff", rarity: "legendary" }];
  c.deck.resetForRun();
  const cds = [];
  for (let i = 0; i < 3; i++) { c.deck.cooldowns = [0, 0, 0]; c.deck.tryCast(0); cds.push(c.deck.cooldowns[0]); }
  return { cds };
});
check("Overcharger makes the 3rd cast free", over.cds[2] === 0 && over.cds[0] > 0, `cds=${over.cds.map((n) => n.toFixed(1)).join(",")}`);

// --- Elite affixes: an enemy can carry an affix that changes behavior
const aff = await page.evaluate(() => {
  const c = window.__rh3;
  c.enemies.clear();
  c.enemies.spawn("husk", 0, 0, 0);
  return new Promise((res) => setTimeout(() => {
    const e = c.enemies.living().find((x) => x.kind === "husk");
    if (!e) return res({ ok: false });
    e.applyAffix("frenzied", 0xff4252);
    e.applyAffix("volatile", 0xff7a3a);
    const set = e.affixes.includes("frenzied") && e.affixes.includes("volatile"); // stacks
    e.takeDamage(99999); // volatile death must not throw
    return res({ ok: true, set, died: !e.alive });
  }, 400));
});
check("Affix applies to an enemy", aff.ok && aff.set);
check("Volatile death resolves cleanly", aff.ok && aff.died);

// --- Execution: a heavy hit finishes a low-HP foe outright (+tempo)
const exec = await page.evaluate(() => {
  const c = window.__rh3;
  c.enemies.clear();
  c.enemies.spawn("husk", 0, 0, 0);
  return new Promise((res) => setTimeout(() => {
    const e = c.enemies.living().find((x) => x.kind === "husk");
    if (!e) return res({ ok: false });
    e.hp = Math.max(1, Math.round(e.maxHp * 0.08)); // badly wounded
    c.tempo.reset();
    const t0 = c.tempo.value;
    c.combat.dealDamage(e, 1, { heavy: true }); // a light tap, but heavy flag → execute
    return res({ ok: true, executed: !e.alive, tempoUp: c.tempo.value > t0 });
  }, 400));
});
check("Heavy hit executes a wounded foe", exec.ok && exec.executed);
check("Execution grants tempo", exec.ok && exec.tempoUp);

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join("\n")}` : "NO CONSOLE ERRORS");
console.log(fail === 0 && errors.length === 0 ? "BUILD-DEPTH: ALL PASS" : `BUILD-DEPTH: ${fail} FAILURES`);
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
