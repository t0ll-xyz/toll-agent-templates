import { makeApp, json } from "./seller.mjs";
import { handle, txOf } from "./handler.mjs";

const MAX_BODY = 64 * 1024;

export function createApp(env = process.env, deps = {}) {
  return makeApp({
    sells: "POST /check",
    description: "Check a Robinhood Chain transaction before it is signed: ALLOW, WARN or BLOCK, with each warning in plain words",
    defaultPrice: "0.01",
    methods: ["POST"],
    match: (p) => p === "/check",
    maxBody: MAX_BODY,
    // a body that is not a transaction is a 400 before payment is asked
    precheck: async (req) => {
      let body;
      try { body = await req.clone().json(); } catch { body = null; }
      const tx = txOf(body);
      return typeof tx === "string" ? json({ error: tx }, 400) : null;
    },
    bazaar: {
      serviceName: "Pre-sign check",
      tags: ["robinhood-chain", "pre-sign", "transaction", "toll"],
      input: { example: { chainId: 4663, from: "0x00000000000000000000000000000000000000a1", to: "0x00000000000000000000000000000000000000a2", data: "0x", value: "0" } },
      output: { example: { action: "WARN", summary: "WARN: 1 warning. Read it before signing.", warnings: [{ code: "sim-reverted", severity: "medium", message: "Simulated, this transaction reverts. Signed as it is, it would fail and still cost gas." }], source: "toll" } },
    },
    handle,
  }, env, deps);
}
