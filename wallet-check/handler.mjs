// What one paid call does: read a wallet's live approvals and its deployer record from Toll's two free routes, and
// answer one line first, then the approvals worth a look and the deployer numbers. A part that was not read is null.
import { json, tollGet } from "./seller.mjs";

const TOLL = "https://t0ll.xyz";
const SHOWN = 8;
const n = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
const s = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const plural = (k, one, many) => `${k} ${k === 1 ? one : many}`;

/** the approvals part: how many, how many unlimited, and the ones Toll marks above low */
export function approvalsOf(body) {
  if (!body || body.state !== "ok" || !Array.isArray(body.rows)) return null;
  const look = body.rows.filter((r) => r && typeof r.risk === "string" && r.risk !== "low");
  return {
    count: body.rows.length, unlimited: body.rows.filter((r) => r?.unlimited === true).length,
    look: look.slice(0, SHOWN).map((r) => ({ token: s(r.symbol, 24) ?? s(r.token, 42), spender: s(r.spenderFacts?.name, 60) ?? s(r.spender, 42), risk: r.risk, why: s(r.why, 200) })),
    lookCount: look.length,
  };
}

/** the deployer part: launches, graduated, sold into */
export function deployerOf(body) {
  const launches = n(body?.launches);
  return launches === null ? null : { launches, graduated: n(body.graduated), soldInto: n(body.sold_into) };
}

export async function handle(req, env, deps = {}) {
  const wallet = new URL(req.url).pathname.slice("/wallet/".length).toLowerCase();
  const [a, d] = await Promise.all([tollGet(`${TOLL}/api/approvals/${wallet}`, env, deps), tollGet(`${TOLL}/api/deployer?addr=${wallet}`, env, deps)]);
  const full = approvalsOf(a.data), deployer = deployerOf(d.data);
  if (!full && !deployer) {
    return a.quota || d.quota
      ? json({ error: "Toll's free rate is reached. Try again in a minute. Nothing was charged.", code: "quota" }, 503)
      : json({ error: "Toll could not be read. Nothing was charged.", code: "upstream" }, 502);
  }
  const parts = [];
  if (full) parts.push(`${plural(full.count, "live approval", "live approvals")}, ${full.lookCount} worth a look.`);
  if (deployer) parts.push(deployer.launches === 0 ? "It has deployed no coin." : `Deployer of ${plural(deployer.launches, "coin", "coins")}: ${deployer.graduated ?? "?"} graduated, sold into ${deployer.soldInto ?? "?"}.`);
  const approvals = full ? { count: full.count, unlimited: full.unlimited, look: full.look } : null;
  return json({
    wallet, summary: parts.join(" "), approvals, deployer,
    notRead: [...(full ? [] : ["approvals"]), ...(deployer ? [] : ["deployer"])],
    links: { approvals: `${TOLL}/approvals/${wallet}`, deployer: `${TOLL}/deployer/${wallet}` }, source: "toll",
  });
}
