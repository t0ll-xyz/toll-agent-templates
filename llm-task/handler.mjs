// What one paid call does: turn { task, text, to? } into one chat request to MODEL_BASE_URL/chat/completions with your
// key, and answer { task, result, model }. The key goes only into that request's Authorization header; everything that
// comes back has the key replaced before it leaves; nothing is logged.
import { json, redact } from "./seller.mjs";

export const MAX_TEXT = 20_000;
const TASKS = {
  summarize: () => "Summarize the user's text in at most five plain sentences. Answer with the summary only.",
  translate: (to) => `Translate the user's text into ${to}. Answer with the translation only.`,
  points: () => "List the key points of the user's text, one per line, each starting with '- '. At most eight. Answer with the list only.",
};
const LANGUAGE = /^[\p{L}][\p{L} ()-]{1,39}$/u;

/** the task asked for, or the words that say why the body is refused */
export function askOf(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return 'Send a JSON object: { "task": "summarize" | "translate" | "points", "text": "..." }.';
  if (!Object.hasOwn(TASKS, body.task)) return 'task must be "summarize", "translate" or "points".';
  if (typeof body.text !== "string" || !body.text.trim()) return "text must be a string with something in it.";
  if (body.text.length > MAX_TEXT) return `text is at most ${MAX_TEXT} characters.`;
  if (body.task === "translate" && (typeof body.to !== "string" || !LANGUAGE.test(body.to.trim()))) return 'translate needs "to": the language, for example "French".';
  return { task: body.task, text: body.text, to: body.task === "translate" ? body.to.trim() : null };
}

export async function handle(req, env, deps = {}) {
  const ask = askOf(await req.json().catch(() => null));
  if (typeof ask === "string") return json({ error: ask }, 400);
  const key = env.MODEL_API_KEY.trim();
  const base = (env.MODEL_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = env.MODEL?.trim() || "gpt-4o-mini";
  const get = deps.fetch ?? globalThis.fetch;
  let res, text;
  try {
    res = await get(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      // the caller's text is the user message only: it never becomes part of the instruction
      body: JSON.stringify({ model, stream: false, messages: [{ role: "system", content: TASKS[ask.task](ask.to) }, { role: "user", content: ask.text }] }),
      signal: AbortSignal.timeout(60_000),
    });
    text = redact(await res.text(), [key]);
  } catch {
    return json({ error: "The model API could not be reached. Nothing was charged.", code: "upstream" }, 502);
  }
  if (!res.ok) return json({ error: `The model API answered ${res.status}. Nothing was charged.`, code: "upstream", detail: text.slice(0, 500) }, 502);
  let result;
  try { result = JSON.parse(text)?.choices?.[0]?.message?.content; } catch { result = null; }
  if (typeof result !== "string" || !result.trim()) return json({ error: "The model gave no answer. Nothing was charged.", code: "empty" }, 502);
  return json({ task: ask.task, ...(ask.to ? { to: ask.to } : {}), result: result.trim(), model });
}
