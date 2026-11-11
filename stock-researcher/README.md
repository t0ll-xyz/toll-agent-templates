# stock-researcher

A paid brief on a stock token. One call returns a short answer a person or an agent can read at once: the name, the chain
price against the Chainlink reference (with the gap), the latest 3 SEC filings with links, insider buys and sells, and
earnings. `?full=1` adds every field that was read.

- Sells: `GET /brief/:ticker`, where `:ticker` is 1 to 6 letters or dots (`AAPL`, `BRK.B`). Anything else is a `400` before
  payment is asked.
- Default price: **0.05 USDG** a call. Set `PRICE` to change it.
- You bring: a contact string for SEC's User-Agent rule (below).

## Run it

```sh
npx degit t0ll-xyz/toll-agent-templates/stock-researcher my-agent
cd my-agent && npm install
PAY_TO=0xYourWallet SEC_USER_AGENT="Your Name you@example.com" npm start
```

## Env vars

| var | required | what |
| --- | --- | --- |
| `PAY_TO` | yes | the wallet that receives the payments (0x + 40 hex). The server will not start without it |
| `AGENT_ID` | no | your ERC-8004 agent id on Robinhood Chain (digits) |
| `PRICE` | no | price per call in USDG. Default `0.05` |
| `PORT` | no | port to listen on. Default `4021` |
| `SEC_USER_AGENT` | yes | a contact string for SEC's User-Agent rule. The server will not start without it |
| `TOLL_PAYER_KEY` | no | a **throwaway** wallet key on your host with a few cents of USDG, used only to pay Toll's x402 reads past the free rate |

**About `SEC_USER_AGENT`:** SEC requires every automated caller to say who it is, and this string is sent to SEC with every
filings request. It is public to SEC, so do not use a contact you want private. It is sent to SEC only, never to Toll.

## Where it calls Toll, and what that costs

Every call reads, from Toll (free, rate limited):

- `GET https://t0ll.xyz/api/markets/stock/<ticker>`
- `GET https://t0ll.xyz/api/markets/fundamentals/<ticker>`
- `GET https://t0ll.xyz/api/markets/insiders/<ticker>`

and, when Toll's stock answer carries a CIK, SEC EDGAR directly: `https://data.sec.gov/submissions/CIK<10 digits>.json`
(free).

If Toll answers `429` on a read and `TOLL_PAYER_KEY` is set, that read is paid at the matching x402 route
(`https://t0ll.xyz/api/x402/stock/<ticker>` or `https://t0ll.xyz/api/x402/markets/...`) at Toll's listed prices, which are
in https://t0ll.xyz/llms.txt. Check them against your price before you turn the key on. Without the key, a `429` makes the
agent answer `503` with `code: "quota"`, and the buyer is not charged.

The payer is built only when the key is set, and the key is used for nothing else. It is never logged or returned. Toll
never sees your keys.

## What a caller gets

```json
{
  "ticker": "NVDA", "name": "NVIDIA",
  "brief": "NVDA · NVIDIA. chain $174.71 vs reference $174.67 (+0.02%). latest filings: 8-K 2026-09-03, 10-Q 2026-08-26, 8-K 2026-08-26. insiders 90d: 0 buys, 25 sells ($967.6M). next earnings not known (last results 10-Q 2026-08-26).",
  "price": { "chain_usd": 174.71, "reference_usd": 174.67, "gap_pct": 0.02, "reference_source": "Chainlink feed on Robinhood Chain", "session": "post",
             "deepest_pool": { "venue": "v3", "quote": "USDG", "depth_usd": 2197067 } },
  "filings": [{ "form": "8-K", "date": "2026-09-03", "url": "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000078/nvda-20260902.htm" }],
  "insiders": { "window_days": 90, "buys": { "count": 0, "shares": 0, "value_usd": null }, "sells": { "count": 25, "shares": 4332118, "value_usd": 967599313 }, "sells_on_a_plan": 9 },
  "earnings": { "next": null, "last_report": { "form": "10-Q", "filed": "2026-08-26", "period_end": "2026-07-26", "url": "https://www.sec.gov/..." } },
  "basics": { "period": "TTM to 2026-07-26", "revenue_usd": 302969000000, "net_income_usd": 192879000000, "eps_diluted": 7.94, "pe": 21.98, "market_cap_usd": 4206293499884 },
  "page": "https://t0ll.xyz/markets/NVDA", "source": "toll markets + SEC EDGAR",
  "more": "add ?full=1 for every field that was read, under raw"
}
```

- `brief` is the same facts as one line, ready to show.
- `price.gap_pct` is the chain price against the reference, in percent (Toll's own figure, or worked out from the two
  prices when Toll gives none).
- `filings` are the latest 3 from SEC's list; if SEC could not be read, the ones inside Toll's stock answer.
- `earnings.next` is a date only when Toll's answer carries one. Otherwise it is `null` and the last results filing is
  named. The template never guesses a date.
- `GET /brief/NVDA?full=1` gives the same brief plus `raw`: Toll's whole stock, fundamentals and insiders answers and
  SEC's filing list (every pool, every insider row).

A part that could not be read is `null`, and `notRead` names it (`"notRead": ["insiders"]`); it is never shown as a zero.
If nothing could be read at all, the answer is `502` and the buyer is not charged.

## Deploy

Vercel: `api/index.mjs` exports the agent in the Web-handler form (`export default { fetch }`), and `vercel.json` sends every
path to it. Set the env vars in the project settings.
