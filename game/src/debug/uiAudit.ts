// DETERMINISTIC UI AUDIT — the DOM-side "words never overlap / text never
// clips / nothing dead" gate that runs BEFORE any AI judge. Three-free,
// portable, exposed on the debug seam so the harness calls it via page.evaluate
// at multiple viewports. Spec: /game-presentation (auditUI). Every finding is
// {rule, sel, detail, rect}; the harness asserts the list is empty (minus an
// allowlist). Real-browser only — jsdom has no layout, so scrollWidth/
// getBoundingClientRect return 0.

export interface UiFinding {
  rule: string;
  sel: string;
  detail: string;
  rect?: { x: number; y: number; w: number; h: number };
}

const RAW_TEXT = /\b(undefined|null|NaN|\[object Object\])\b/;

function selectorOf(el: Element): string {
  const id = el.id ? `#${el.id}` : "";
  const cls = typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/).join(".")}` : "";
  return `${el.tagName.toLowerCase()}${id}${cls}`.slice(0, 80);
}

function rectOf(el: Element): { x: number; y: number; w: number; h: number } {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
}

/** WCAG relative luminance of an "r,g,b" triple. */
function luminance(r: number, g: number, b: number): number {
  const f = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** Walk ancestors compositing background-color alpha until an opaque surface. */
function effectiveBg(el: Element): [number, number, number] | null {
  let node: Element | null = el;
  let r = 0, g = 0, b = 0, remaining = 1;
  while (node && node !== document.documentElement) {
    const bg = getComputedStyle(node).backgroundColor;
    const m = bg.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    if (m) {
      const a = m[4] === undefined ? 1 : parseFloat(m[4]);
      if (a > 0) {
        r += remaining * a * parseFloat(m[1]);
        g += remaining * a * parseFloat(m[2]);
        b += remaining * a * parseFloat(m[3]);
        remaining *= 1 - a;
        if (remaining < 0.15) return [r, g, b]; // effectively opaque
      }
    }
    node = node.parentElement;
  }
  return remaining < 0.5 ? [r, g, b] : null; // never reached an opaque enough surface
}

/** True if the element (or an ancestor) supplies its own dark halo/scrim/shadow
 *  so it stays legible over the canvas without an opaque background. */
function hasOwnedHalo(el: Element): boolean {
  for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (s.textShadow && s.textShadow !== "none") return true;
    if (s.webkitTextStroke && s.webkitTextStroke !== "0px" && !/^0px/.test(s.webkitTextStroke)) return true;
  }
  return false;
}

const isVisible = (el: Element): boolean => {
  const s = getComputedStyle(el);
  if (s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity) === 0) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

/** True if any ancestor scrolls — content below the fold there is intended, not
 *  offscreen (a settings panel taller than the viewport is not a bug). */
function inScrollable(el: Element): boolean {
  for (let n: Element | null = el.parentElement; n && n !== document.body; n = n.parentElement) {
    const o = getComputedStyle(n).overflowY;
    if ((o === "auto" || o === "scroll") && n.scrollHeight > n.clientHeight + 2) return true;
  }
  return false;
}

/** Gradient/clipped text reports its `color` as a meaningless fallback (often the
 *  page's near-black), so contrast can't be measured from computed color. */
function isGradientText(el: Element): boolean {
  const s = getComputedStyle(el) as CSSStyleDeclaration & { webkitBackgroundClip?: string };
  const clip = s.webkitBackgroundClip || (s as unknown as { backgroundClip?: string }).backgroundClip || "";
  if (/text/.test(clip)) return true;
  if (s.color === "transparent" || /rgba\([^)]*,\s*0\)/.test(s.color)) return true;
  return false;
}

const leafText = (el: Element): boolean =>
  !!el.textContent && el.textContent.trim().length > 0 &&
  Array.from(el.children).every((c) => !c.textContent || !c.textContent.trim());

/**
 * Audit a UI root (default #hud + #overlay) for the deterministic UI-defect
 * classes. `opts.allow` is a set of rule:sel strings to skip (intended overlaps,
 * by-design low-contrast flavor text). Returns findings; empty = clean.
 */
export function auditUI(opts: { roots?: string[]; allow?: string[] } = {}): UiFinding[] {
  const roots = (opts.roots ?? ["#hud", "#overlay"])
    .map((s) => document.querySelector(s))
    .filter((r): r is Element => !!r);
  const allow = new Set(opts.allow ?? []);
  const findings: UiFinding[] = [];
  const push = (rule: string, el: Element, detail: string) => {
    const sel = selectorOf(el);
    if (allow.has(`${rule}:${sel}`)) return;
    findings.push({ rule, sel, detail, rect: rectOf(el) });
  };

  const vw = window.innerWidth, vh = window.innerHeight;
  const all: Element[] = [];
  for (const root of roots) all.push(...Array.from(root.querySelectorAll("*")));
  const visible = all.filter(isVisible);

  for (const el of visible) {
    const r = el.getBoundingClientRect();

    // offscreen — laid out beyond the viewport (±1px slack), UNLESS it lives in a
    // scrollable panel (settings below the fold is intended, not lost).
    if ((r.right < -1 || r.bottom < -1 || r.left > vw + 1 || r.top > vh + 1) && !inScrollable(el)) {
      push("offscreen", el, `rect ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}×${Math.round(r.height)} outside ${vw}×${vh}`);
    }

    if (leafText(el)) {
      const cs = getComputedStyle(el);
      // truncated — content overflows its box without an intended ellipsis/clamp
      const clips = cs.overflow !== "visible" || cs.overflowX !== "visible";
      const ellipsis = cs.textOverflow === "ellipsis" || cs.webkitLineClamp !== "none";
      if (clips && !ellipsis && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) {
        push("truncated", el, `scroll ${el.scrollWidth}×${el.scrollHeight} > client ${el.clientWidth}×${el.clientHeight} with no ellipsis/clamp`);
      }
      // raw-text-leak — an unformatted sentinel reached the screen
      const txt = (el.textContent || "").trim();
      if (RAW_TEXT.test(txt)) push("raw-text-leak", el, `text contains a debug sentinel: "${txt.slice(0, 40)}"`);
      // contrast — against the effective background, or the halo carve-out.
      // Gradient/clipped text can't be read from computed color — skip (its
      // legibility is a job for the pixel-contrast pass in /game-perception).
      const fg = getComputedStyle(el).color.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
      if (fg && !isGradientText(el)) {
        const bg = effectiveBg(el);
        if (bg) {
          const lf = luminance(+fg[1], +fg[2], +fg[3]);
          const lb = luminance(bg[0], bg[1], bg[2]);
          const ratio = (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05);
          const big = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && +cs.fontWeight >= 700);
          if (ratio < (big ? 3 : 4.5)) push("contrast", el, `contrast ${ratio.toFixed(2)}:1 vs effective bg rgb(${bg.map(Math.round).join(",")}) (need ${big ? 3 : 4.5})`);
        } else if (!hasOwnedHalo(el)) {
          // text floating over the canvas with no opaque backing AND no halo/stroke
          push("no-owned-surface", el, `text over the canvas with no opaque panel and no text-shadow/stroke halo — unmeasurable, likely unreadable`);
        }
      }
    }

    // invisible-interactive — pointer-events active but checkVisibility() false
    if ((el.tagName === "BUTTON" || (el as HTMLElement).getAttribute?.("role") === "button" || el.classList.contains("btn"))) {
      const cs = getComputedStyle(el);
      const interactive = cs.pointerEvents !== "none";
      const seen = (el as unknown as { checkVisibility?: (o?: object) => boolean }).checkVisibility?.() ?? isVisible(el);
      if (interactive && !seen) push("invisible-interactive", el, `pointer-events active but checkVisibility() is false`);
    }
  }

  // overlap — leaf-text pairs whose rects intersect by >2px on both axes
  const texts = visible.filter(leafText);
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], b = texts[j];
      if (a.contains(b) || b.contains(a)) continue; // nested, not a collision
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (ox > 2 && oy > 2) {
        const sel = `${selectorOf(a)} ∥ ${selectorOf(b)}`;
        if (!allow.has(`overlap:${sel}`)) findings.push({ rule: "overlap", sel, detail: `text boxes intersect ${Math.round(ox)}×${Math.round(oy)}px`, rect: rectOf(a) });
      }
    }
  }

  return findings;
}

/** Occlusion hit-test for a set of interactive controls: each control's centre
 *  (and corners) must resolve to itself or a descendant, else it's covered/dead.
 *  Kept separate from auditUI so callers can temporarily force pointer-events. */
export function auditOcclusion(selector = "#overlay .btn, #hud .hit, [data-focusable]"): UiFinding[] {
  const out: UiFinding[] = [];
  for (const el of Array.from(document.querySelectorAll(selector))) {
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    const pts: [number, number][] = [
      [r.left + r.width / 2, r.top + r.height / 2],
      [r.left + 3, r.top + 3], [r.right - 3, r.bottom - 3],
    ];
    for (const [x, y] of pts) {
      const hit = document.elementFromPoint(x, y);
      if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) {
        out.push({ rule: "occluded", sel: selectorOf(el), detail: `point (${Math.round(x)},${Math.round(y)}) hits ${selectorOf(hit)} instead`, rect: rectOf(el) });
        break;
      }
    }
  }
  return out;
}
