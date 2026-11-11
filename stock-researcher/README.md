# stock-researcher

A paid brief on a stock token. One call returns the price and basics, the fundamentals, the insider trades and the latest
SEC filings for a ticker, as one JSON answer.

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
{ "ticker": "AAPL", "stock": {}, "fundamentals": {}, "insiders": {}, "filings": { "cik": "320193", "name": "Apple Inc.", "recent": [] } }
```

A part that could not be read is `null`, and `notRead` names it (`"notRead": ["insiders"]`). If nothing could be read at all,
the answer is `502` and the buyer is not charged.

## Deploy

Vercel: `api/index.mjs` exports the agent in the Web-handler form (`export default { fetch }`), and `vercel.json` sends every
path to it. Set the env vars in the project settings.
