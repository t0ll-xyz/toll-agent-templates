import { makeApp, json } from "./seller.mjs";
import { handle } from "./handler.mjs";

const TOKEN = /^0x[0-9a-fA-F]{40}$/;
const EXAMPLE = "0x0000000000000000000000000000000000000000";

export function createApp(env = process.env, deps = {}) {
  return makeApp({
    sells: "GET /check/:token",
    description: "A coin check on Robinhood Chain: a verdict word, the tallies and the flags, read from Toll's check",
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
      output: { example: { token: EXAMPLE, name: "Example", sym: "EXM", verdict: "CAREFUL", headline: "one flag worth a look", tally: { launch: { against: 0, careful: 1, clear: 3 }, now: { against: 0, careful: 0, clear: 3 }, combined: { against: 0, careful: 1, clear: 6 } }, flags: [{ text: "liquidity can be pulled", when: "now" }], unread: [], link: "https://t0ll.xyz/check/" + EXAMPLE, source: "toll" } },
    },
    handle,
  }, env, deps);
}
