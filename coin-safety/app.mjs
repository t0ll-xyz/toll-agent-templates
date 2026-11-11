import { makeApp, json } from "./seller.mjs";
import { handle } from "./handler.mjs";

const TOKEN = /^0x[0-9a-fA-F]{40}$/;
const EXAMPLE = "0x0000000000000000000000000000000000000000";

export function createApp(env = process.env, deps = {}) {
  return makeApp({
    sells: "GET /check/:token",
    description: "A coin check on Robinhood Chain from Toll's check: the verdict word first, one line, the findings that are not good news; ?full=1 adds the tallies and every flag",
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
      output: { example: { token: EXAMPLE, name: "Example", sym: "EXM", verdict: "CAREFUL", summary: "CAREFUL: nothing against, some things to be careful about. 0 findings against, 1 to be careful about, 6 clear.", headline: "one flag worth a look", counts: { against: 0, careful: 1, clear: 6 }, concerns: ["liquidity can be pulled"], notes: [], clear: 6, unread: [], link: "https://t0ll.xyz/check/" + EXAMPLE, source: "toll", more: "add ?full=1 for Toll's tallies and every flag, under raw" } },
    },
    handle,
  }, env, deps);
}
