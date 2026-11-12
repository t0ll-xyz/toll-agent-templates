// What one paid call does: read Toll's agent census for one ERC-8004 agent (free, 30 reads a minute) and answer the
// facts another agent needs before it pays: the word first, one line, then the wallets.
import { json, tollGet } from "./seller.mjs";

const TOLL = "https://t0ll.xyz";
const lc = (v) => (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v) ? v.toLowerCase() : null);
const WORDS = {
  MATCH: "it answers over x402 and is paid at its registered agent wallet",
  MISMATCH: "it answers over x402 but is paid at another wallet than the one it registered",
  "NO SELLER": "it does not answer over x402",
  "NOT READ": "the census has not read its x402 terms yet",
};

/** the word for what the census read: only a read that says so is a MATCH */
export function wordOf(a) {
  const x = a?.x402 ?? {};
  if (x.answer === "yes") return x.pay_to_is_agent_wallet === true ? "MATCH" : x.pay_to_is_agent_wallet === false ? "MISMATCH" : "NOT READ";
  return x.answer === "no" || x.answer === "none" ? "NO SELLER" : "NOT READ";
}

export async function handle(req, env, deps = {}) {
  const id = new URL(req.url).pathname.slice("/agent/".length);
  const r = await tollGet(`${TOLL}/api/agent/${id}`, env, deps);
  if (r.quota) return json({ error: "Toll's free rate is reached. Try again in a minute. Nothing was charged.", code: "quota" }, 503);
  if (r.status === 404) return json({ error: `Toll's census has no agent #${id}. Nothing was charged.`, code: "unknown" }, 404);
  const a = r.data;
  if (!a || typeof a !== "object" || typeof a.id !== "number") return json({ error: "Toll could not be read. Nothing was charged.", code: "upstream" }, 502);
  const word = wordOf(a);
  const card = a.card?.ok === true;
  return json({
    id: a.id, name: typeof a.name === "string" ? a.name.slice(0, 120) : null, word,
    summary: `${word}: ${WORDS[word]}. Its card ${card ? "loads" : "does not load"}.`,
    card, x402: typeof a.x402?.answer === "string" ? a.x402.answer : null,
    payTo: lc(a.x402?.pay_to), agentWallet: lc(a.agent_wallet), owner: lc(a.owner),
    walletSentTx: typeof a.wallet?.sent_tx === "boolean" ? a.wallet.sent_tx : null,
    class: typeof a.class === "string" ? a.class : null,
    read: typeof a.source?.read === "string" ? a.source.read : null,
    link: `${TOLL}/agents/census?agent=${a.id}`, source: "toll",
  });
}
