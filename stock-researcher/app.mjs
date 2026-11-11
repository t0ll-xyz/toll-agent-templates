import { makeApp, json } from "./seller.mjs";
import { handle } from "./handler.mjs";

const TICKER = /^[A-Za-z.]{1,6}$/;

export function createApp(env = process.env, deps = {}) {
  return makeApp({
    sells: "GET /brief/:ticker",
    description: "A short brief on a Robinhood Chain stock token: chain price vs the Chainlink reference, the latest 3 SEC filings, insider buys and sells, earnings; ?full=1 adds every field",
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
      output: { example: {
        ticker: "NVDA", name: "NVIDIA",
        brief: "NVDA · NVIDIA. chain $174.71 vs reference $174.67 (+0.02%). latest filings: 8-K 2026-09-03, 10-Q 2026-08-26, 8-K 2026-08-26. insiders 90d: 0 buys, 25 sells ($967.6M). next earnings not known (last results 10-Q 2026-08-26).",
        price: { chain_usd: 174.71, reference_usd: 174.67, gap_pct: 0.02, reference_source: "Chainlink feed on Robinhood Chain" },
        filings: [{ form: "8-K", date: "2026-09-03", url: "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000078/nvda-20260902.htm" }],
        insiders: { window_days: 90, buys: { count: 0, shares: 0, value_usd: null }, sells: { count: 25, shares: 4332118, value_usd: 967599313 } },
        earnings: { next: null, last_report: { form: "10-Q", filed: "2026-08-26", period_end: "2026-07-26", url: null } },
        page: "https://t0ll.xyz/markets/NVDA", source: "toll markets + SEC EDGAR", more: "add ?full=1 for every field that was read, under raw",
      } },
    },
    handle,
  }, env, deps);
}
