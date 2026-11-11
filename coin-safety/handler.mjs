// What one paid call does: ask Toll's free check first; only when Toll says its free quota is used up (429) and
// TOLL_PAYER_KEY is set, pay Toll's x402 check ($0.005 USDG). The key is never logged or returned.
// The default answer is short: the verdict word, one line, and the findings that are not good news. ?full=1 adds
// Toll's tallies and every flag under "raw".
import { json, payOf } from "./seller.mjs";

const TOLL = "https://t0ll.xyz";
const QUOTA = { error: "Toll's free quota is reached. Set TOLL_PAYER_KEY to keep answering.", code: "quota" };
const SHOWN = 8;
const WORDS = { AGAINST: "at least one finding is against this coin", INCOMPLETE: "nothing against, but part of the check was not read",
  CAREFUL: "nothing against, some things to be careful about", CLEAR: "nothing against and nothing to be careful about" };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** the flags that are not good news, split the way Toll marks them: a plain flag is a concern, `note` is a note, `good` is clear */
export function findings(flags) {
  const text = (f) => (typeof f?.text === "string" ? f.text : null);
  const concerns = flags.filter((f) => f && f.good !== true && f.note !== true).map(text).filter(Boolean);
  const notes = flags.filter((f) => f && f.note === true && f.good !== true).map(text).filter(Boolean);
  const clear = flags.filter((f) => f && f.good === true).length;
  return { concerns, notes, clear };
}

export async function handle(req, env, deps = {}) {
  const here = new URL(req.url);
  const token = here.pathname.slice("/check/".length).toLowerCase();
  const full = here.searchParams.get("full") === "1";
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
  const combined = body?.tally?.combined;
  if (!body || !Array.isArray(body.flags) || !combined || typeof combined !== "object") {
    return json({ error: "Toll's answer is not ready yet (the coin may still be read). Try again shortly. Nothing was charged.", code: "pending" }, 502);
  }
  const unread = Array.isArray(body.unread) ? body.unread : [];
  // Toll's own rule for the word, on the combined tally
  const verdict = combined.against > 0 ? "AGAINST" : unread.length ? "INCOMPLETE" : combined.careful > 0 ? "CAREFUL" : "CLEAR";
  const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const counts = { against: n(combined.against), careful: n(combined.careful), clear: n(combined.clear) };
  const { concerns, notes, clear } = findings(body.flags);
  const summary = `${verdict}: ${WORDS[verdict]}. ${plural(counts.against, "finding", "findings")} against, ${counts.careful} to be careful about, ${counts.clear} clear`
    + (unread.length ? `; ${plural(unread.length, "part", "parts")} not read (${unread.join(", ")}).` : ".");
  return json({
    token, name: body.name ?? null, sym: body.sym ?? null, verdict, summary, headline: body.headline ?? null,
    counts,
    concerns: concerns.slice(0, SHOWN), notes: notes.slice(0, SHOWN), clear,
    ...(concerns.length > SHOWN || notes.length > SHOWN ? { cut: `showing the first ${SHOWN} of each; ?full=1 has all` } : {}),
    unread, link: `https://t0ll.xyz/check/${token}`, source: "toll",
    ...(full ? { raw: { tally: body.tally, flags: body.flags } } : { more: "add ?full=1 for Toll's tallies and every flag, under raw" }),
  });
}
