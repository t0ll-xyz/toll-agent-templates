// What one paid call does: forward the JSON body to MODEL_BASE_URL/chat/completions with your key and give the answer back.
// The key goes only into the Authorization header of that one request. Everything that comes back (body, error text) has the
// key replaced before it leaves; nothing is logged.
import { json, redact } from "./seller.mjs";

export async function handle(req, env, deps = {}) {
  const key = env.MODEL_API_KEY.trim();
  const base = (env.MODEL_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
  const body = await req.json();
  if (env.MODEL?.trim()) body.model = env.MODEL.trim();
  body.stream = false; // the answer is returned whole
  const get = deps.fetch ?? globalThis.fetch;

  let res, text;
  try {
    res = await get(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    text = redact(await res.text(), [key]);
  } catch {
    return json({ error: "The model API could not be reached. Nothing was charged.", code: "upstream" }, 502);
  }
  if (!res.ok) {
    return json({ error: `The model API answered ${res.status}. Nothing was charged.`, code: "upstream", detail: text.slice(0, 1000) }, 502);
  }
  return new Response(text, { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
