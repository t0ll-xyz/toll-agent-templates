import { makeApp, json } from "./seller.mjs";
import { handle } from "./handler.mjs";

const TOKEN = /^0x[0-9a-fA-F]{40}$/;
const EXAMPLE = "0x0000000000000000000000000000000000000000";

export function createApp(env = process.env, deps = {}) {
  return makeApp({
    sells: "GET /check/:token",
    description: "A coin check on Robinhood Chain: a verdict word, the tallies and the reasons, read from Toll's check",
    defaultPrice: "0.01",
    methods: ["GET"],
    match: (p) => p.startsWith("/check/"),
    // a bad token is a 400 before any payment is asked
    precheck: (req, url) => (TOKEN.test(url.pathname.slice("/check/".length))
      ? null
      : json({ error: "Use /check/0x... with the coin's contract address (0x + 40 hex)." }, 400)),
    bazaar: {
      serviceName: "Coin check",
      tags: ["robinhood-chain", "coin-check", "toll"],
      output: { example: { source: "toll", token: EXAMPLE, verdict: "careful", tally: { against: 0, careful: 1, clear: 6 }, link: "https://t0ll.xyz/check/" + EXAMPLE } },
    },
    handle,
  }, env, deps);
}
