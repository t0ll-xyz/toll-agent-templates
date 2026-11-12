import { makeApp, json } from "./seller.mjs";
import { handle, limitOf } from "./handler.mjs";

export function createApp(env = process.env, deps = {}) {
  return makeApp({
    sells: "GET /launches",
    description: "The newest coins on Robinhood Chain, newest first, each with the call Toll made on it at launch (clear, careful or against) and the one-line reason",
    defaultPrice: "0.01",
    methods: ["GET"],
    match: (p) => p === "/launches",
    // a limit that is not 1 to 20 is a 400 before any payment is asked
    precheck: (req, url) => (limitOf(url) === null ? json({ error: "limit is a whole number from 1 to 20." }, 400) : null),
    bazaar: {
      serviceName: "Launch feed",
      tags: ["robinhood-chain", "launches", "feed", "toll"],
      output: { example: {"count": 1, "launches": [{"token": "0x00000000000000000000000000000000000000a2", "sym": "EXM", "name": "Example", "call": "careful", "reason": "one wallet holds most of the main pool's liquidity", "dev": "0x00000000000000000000000000000000000000a1", "mcapUsd": 9917, "buyers": 22, "link": "https://t0ll.xyz/check/0x00000000000000000000000000000000000000a2"}], "source": "toll"} },
    },
    handle,
  }, env, deps);
}
