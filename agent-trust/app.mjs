import { makeApp, json } from "./seller.mjs";
import { handle } from "./handler.mjs";

const ID = /^\d{1,12}$/;

export function createApp(env = process.env, deps = {}) {
  return makeApp({
    sells: "GET /agent/:id",
    description: "Check one ERC-8004 agent on Robinhood Chain before paying it: whether its card loads, whether it answers over x402, and whether its payTo is its registered agent wallet",
    defaultPrice: "0.05",
    methods: ["GET"],
    match: (p) => p.startsWith("/agent/"),
    // an id that is not digits is a 400 before any payment is asked
    precheck: (req, url) => (ID.test(url.pathname.slice("/agent/".length)) ? null : json({ error: "Use /agent/<id> with the agent's ERC-8004 id (digits)." }, 400)),
    bazaar: {
      serviceName: "Agent check",
      tags: ["robinhood-chain", "erc-8004", "agent-check", "toll"],
      output: { example: {"id": 815, "name": "Example agent", "word": "MATCH", "summary": "MATCH: it answers over x402 and is paid at its registered agent wallet. Its card loads.", "card": true, "x402": "yes", "payTo": "0x00000000000000000000000000000000000000a2", "agentWallet": "0x00000000000000000000000000000000000000a2", "owner": "0x00000000000000000000000000000000000000a1", "walletSentTx": true, "class": "real service", "read": "2026-11-12T10:00:00Z", "link": "https://t0ll.xyz/agents/census?agent=815", "source": "toll"} },
    },
    handle,
  }, env, deps);
}
