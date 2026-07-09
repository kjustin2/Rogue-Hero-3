// CROSS-FAMILY VLM PROVIDER — a SECOND, genuinely-disjoint model family for the
// comprehension probe only (the one place a second opinion legitimately attacks
// self-preference bias; the research verdict is that a naive VLM jury does NOT
// transfer to game-frame vision, so this is NOT averaged into any localization
// score). Talks to a local Ollama server (qwen2.5vl) over its HTTP API — $0, local,
// temp 0. All-mock/skip by default: if Ollama isn't running or the model isn't
// pulled, every call SKIPS gracefully (never a hard failure), so the QA suite has
// zero dependency on it until the owner opts in by pulling the model.
import { readFileSync } from "node:fs";

const HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";

/** Is the Ollama server up and is `model` pulled? Never throws. */
export async function ollamaAvailable(model, timeoutMs = 2500) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${HOST}/api/tags`, { signal: ac.signal });
    if (!res.ok) return { available: false, reason: `server ${res.status}` };
    const body = await res.json();
    const names = (body.models || []).map((m) => m.name);
    const has = names.some((n) => n === model || n.startsWith(model.split(":")[0]));
    return has ? { available: true, models: names } : { available: false, reason: `model ${model} not pulled`, models: names };
  } catch (e) {
    return { available: false, reason: `no server (${String(e.message || e).slice(0, 40)})` };
  } finally { clearTimeout(t); }
}

/**
 * Ask the cross-family VLM one question about one image. Mirrors runClaude's
 * return shape ({ ok, result, ... }) plus `skipped` when Ollama is unavailable.
 * @param imagePath PNG on disk (embedded as base64 — the API takes raw base64).
 */
export async function runOllamaVLM(prompt, imagePath, { model = "qwen2.5vl:7b", timeoutMs = 120000 } = {}) {
  const avail = await ollamaAvailable(model);
  if (!avail.available) return { ok: false, skipped: true, reason: avail.reason, result: "" };
  let b64;
  try { b64 = readFileSync(imagePath).toString("base64"); }
  catch (e) { return { ok: false, skipped: false, result: "", error: `image read: ${String(e)}` }; }
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${HOST}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, images: [b64], stream: false, options: { temperature: 0, seed: 7 } }),
      signal: ac.signal,
    });
    if (!res.ok) return { ok: false, skipped: false, result: "", error: `api ${res.status}` };
    const body = await res.json();
    return { ok: true, skipped: false, result: body.response ?? "", model };
  } catch (e) {
    return { ok: false, skipped: false, result: "", error: String(e.message || e) };
  } finally { clearTimeout(t); }
}
