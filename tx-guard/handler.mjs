// What one paid call does: send the transaction to Toll's free pre-sign check; only when Toll says its free rate is used
// up (429) and TOLL_PAYER_KEY is set, pay Toll's x402 pre-sign check ($0.005 USDG). The key is never logged or returned.
import { json, payOf } from "./seller.mjs";

const TOLL = "https://t0ll.xyz";
const QUOTA = { error: "Toll's free rate is reached. Set TOLL_PAYER_KEY to keep answering.", code: "quota" };
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ACTIONS = new Set(["ALLOW", "WARN", "BLOCK"]);
const NEXT = { ALLOW: "Nothing to warn about.", WARN: "Read it before signing.", BLOCK: "Do not sign without the person's say." };
const SHOWN = 12;

/** the transaction to check, or the words that say why the body is refused */
export function txOf(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return 'Send a JSON object: { "chainId": 4663, "from": "0x...", "to": "0x...", "data": "0x...", "value": "0" }.';
  if (body.chainId !== 4663) return "chainId must be 4663 (Robinhood Chain).";
  if (typeof body.from !== "string" || !ADDRESS.test(body.from)) return "from must be an address (0x + 40 hex).";
  if (typeof body.to !== "string" || !ADDRESS.test(body.to)) return "to must be an address (0x + 40 hex).";
  const data = body.data ?? "0x";
  if (typeof data !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(data)) return "data must be hex (0x...).";
  const value = body.value ?? "0";
  if (!(typeof value === "string" || typeof value === "number") || !/^(0x[0-9a-fA-F]+|\d{1,78})$/.test(String(value))) return "value must be a whole number of wei, as a string.";
  return { chainId: 4663, from: body.from, to: body.to, data, value: String(value) };
}

export async function handle(req, env, deps = {}) {
  const tx = txOf(await req.json().catch(() => null));
  if (typeof tx === "string") return json({ error: tx }, 400);
  const get = deps.fetch ?? globalThis.fetch;
  const init = { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(tx) };
  let res;
  try {
    res = await get(`${TOLL}/api/tx/check`, init);
    if (res.status === 429) {
      const pay = payOf(env, deps);
      if (!pay) return json(QUOTA, 503);
      res = await pay(`${TOLL}/api/x402/tx`, init);
    }
  } catch {
    return json({ error: "Toll could not be reached. Nothing was charged.", code: "upstream" }, 502);
  }
  if (res.status === 429) return json(QUOTA, 503);
  if (!res.ok) return json({ error: `Toll answered ${res.status}. Nothing was charged.`, code: "upstream" }, 502);
  let body;
  try { body = await res.json(); } catch { body = null; }
  // an answer with no action is never passed on as ALLOW
  if (!body || !ACTIONS.has(body.action)) return json({ error: "Toll's check did not answer with an action. Nothing was charged.", code: "upstream" }, 502);
  const all = (Array.isArray(body.warnings) ? body.warnings : []).filter((w) => w && typeof w.message === "string");
  const warnings = all.slice(0, SHOWN).map((w) => ({ code: typeof w.code === "string" ? w.code : null, severity: typeof w.severity === "string" ? w.severity : null, message: w.message.slice(0, 500) }));
  return json({
    action: body.action,
    summary: `${body.action}: ${all.length} ${all.length === 1 ? "warning" : "warnings"}. ${NEXT[body.action]}`,
    warnings, ...(all.length > SHOWN ? { cut: `showing the first ${SHOWN} of ${all.length}` } : {}), source: "toll",
  });
}
