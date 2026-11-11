import { makeApp, json } from "./seller.mjs";
import { handle } from "./handler.mjs";

const TICKER = /^[A-Za-z.]{1,6}$/;

export function createApp(env = process.env, deps = {}) {
  return makeApp({
    sells: "GET /brief/:ticker",
    description: "One brief on a Robinhood Chain stock token: price, fundamentals, insider trades and recent SEC filings",
    defaultPrice: "0.05",
    methods: ["GET"],
    match: (p) => p.startsWith("/brief/"),
    check: (e) => {
      if (!(e.SEC_USER_AGENT ?? "").trim()) {
        throw new Error("Set SEC_USER_AGENT to a contact string for SEC's User-Agent rule, for example: SEC_USER_AGENT=\"Your Name you@example.com\". SEC sees it, so use a contact you are fine making public.");
      }
    },
    precheck: (req, url) => (TICKER.test(url.pathname.slice("/brief/".length))
      ? null
      : json({ error: "Use /brief/AAPL with a ticker of 1 to 6 letters or dots." }, 400)),
    bazaar: {
      serviceName: "Stock token brief",
      tags: ["robinhood-chain", "stocks", "sec", "toll"],
      output: { example: { ticker: "AAPL", stock: {}, fundamentals: {}, insiders: {}, filings: { recent: [] } } },
    },
    handle,
  }, env, deps);
}
