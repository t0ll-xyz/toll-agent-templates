import { makeApp, json } from "./seller.mjs";
import { handle } from "./handler.mjs";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function createApp(env = process.env, deps = {}) {
  return makeApp({
    sells: "GET /wallet/:address",
    description: "Check one wallet on Robinhood Chain: who can spend its tokens right now (live approvals, the ones worth a look named) and its record as a coin deployer",
    defaultPrice: "0.02",
    methods: ["GET"],
    match: (p) => p.startsWith("/wallet/"),
    // an address that is not 0x + 40 hex is a 400 before any payment is asked
    precheck: (req, url) => (ADDRESS.test(url.pathname.slice("/wallet/".length)) ? null : json({ error: "Use /wallet/0x... with the wallet's address (0x + 40 hex)." }, 400)),
    bazaar: {
      serviceName: "Wallet check",
      tags: ["robinhood-chain", "wallet", "approvals", "toll"],
      output: { example: {"wallet": "0x00000000000000000000000000000000000000a2", "summary": "2 live approvals, 1 worth a look. Deployer of 3 coins: 1 graduated, sold into 2.", "approvals": {"count": 2, "unlimited": 1, "look": [{"token": "PONS", "spender": "Example Router", "risk": "high", "why": "an unlimited allowance to a contract with no name"}]}, "deployer": {"launches": 3, "graduated": 1, "soldInto": 2}, "notRead": [], "links": {"approvals": "https://t0ll.xyz/approvals/0x00000000000000000000000000000000000000a2", "deployer": "https://t0ll.xyz/deployer/0x00000000000000000000000000000000000000a2"}, "source": "toll"} },
    },
    handle,
  }, env, deps);
}
