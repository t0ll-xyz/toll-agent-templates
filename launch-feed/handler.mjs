// What one paid call does: read Toll's newest launches (free, 30 reads a minute) and answer the fields a trading agent
// uses: the coin, the call Toll made at launch, the reason, the dev, the market cap and the buyers.
import { json, tollGet } from "./seller.mjs";

const TOLL = "https://t0ll.xyz";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const CALLS = new Set(["clear", "careful", "against"]);
const s = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** ?limit= as a number from 1 to 20 (10 when absent); null for anything else */
export function limitOf(url) {
  const raw = url.searchParams.get("limit");
  if (raw === null || raw === "") return 10;
  return /^\d{1,2}$/.test(raw) && Number(raw) >= 1 && Number(raw) <= 20 ? Number(raw) : null;
}

/** one launch as this agent answers it; null for a row with no token address */
export function rowOf(r) {
  if (!r || typeof r.token !== "string" || !ADDRESS.test(r.token)) return null;
  const token = r.token.toLowerCase();
  return {
    token, sym: s(r.sym, 24), name: s(r.name, 60), call: CALLS.has(r.call) ? r.call : null, reason: s(r.reason, 240),
    dev: typeof r.dev === "string" && ADDRESS.test(r.dev) ? r.dev.toLowerCase() : null, mcapUsd: n(r.mcap_usd), buyers: n(r.buyers),
    link: `${TOLL}/check/${token}`,
  };
}

export async function handle(req, env, deps = {}) {
  const limit = limitOf(new URL(req.url));
  if (limit === null) return json({ error: "limit is a whole number from 1 to 20." }, 400);
  const r = await tollGet(`${TOLL}/api/launches?limit=${limit}`, env, deps);
  if (r.quota) return json({ error: "Toll's free rate is reached. Try again in a minute. Nothing was charged.", code: "quota" }, 503);
  if (!r.data || !Array.isArray(r.data.rows)) return json({ error: "Toll could not be read. Nothing was charged.", code: "upstream" }, 502);
  const launches = r.data.rows.map(rowOf).filter(Boolean).slice(0, limit);
  return json({ count: launches.length, launches, source: "toll" });
}
