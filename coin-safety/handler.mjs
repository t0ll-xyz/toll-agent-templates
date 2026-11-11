// What one paid call does: ask Toll's free check first; only when Toll says its free quota is used up (429) and
// TOLL_PAYER_KEY is set, pay Toll's x402 check ($0.005 USDG). The key is never logged or returned.
import { json, payOf } from "./seller.mjs";

const TOLL = "https://t0ll.xyz";
const QUOTA = { error: "Toll's free quota is reached. Set TOLL_PAYER_KEY to keep answering.", code: "quota" };
// the fields of Toll's answer that are passed on
const PASS = ["token", "verdict", "tally", "reasons", "flags", "findings", "link"];

export async function handle(req, env, deps = {}) {
  const token = new URL(req.url).pathname.slice("/check/".length).toLowerCase();
  const get = deps.fetch ?? globalThis.fetch;
  const headers = { accept: "application/json" };
  const tollKey = (env.TOLL_KEY ?? "").trim();
  if (tollKey) headers["x-api-key"] = tollKey;

  let res;
  try {
    res = await get(`${TOLL}/api/check?addr=${token}`, { headers });
    if (res.status === 429) {
      const pay = payOf(env, deps);
      if (!pay) return json(QUOTA, 503);
      res = await pay(`${TOLL}/api/x402/check/${token}`, { headers: { accept: "application/json" } });
    }
  } catch {
    return json({ error: "Toll could not be reached. Nothing was charged.", code: "upstream" }, 502);
  }
  if (res.status === 429) return json(QUOTA, 503);
  if (!res.ok) return json({ error: `Toll answered ${res.status}. Nothing was charged.`, code: "upstream" }, 502);

  let body;
  try { body = await res.json(); } catch { body = null; }
  if (!body || typeof body !== "object" || body.verdict == null) {
    return json({ error: "Toll's answer had no verdict yet (the coin may still be read). Try again shortly. Nothing was charged.", code: "pending" }, 502);
  }
  const out = { source: "toll" };
  for (const k of PASS) if (body[k] !== undefined) out[k] = body[k];
  return json(out);
}
