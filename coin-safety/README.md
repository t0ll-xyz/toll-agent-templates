# coin-safety

A paid coin check. A caller (usually another agent, about to buy a coin) pays and gets Toll's answer for that coin:
the verdict word first, one line that sums it up, the findings that are not good news and the link to the full page.

- Sells: `GET /check/:token` where `:token` is `0x` + 40 hex. Anything else is a `400` before payment is asked.
- Default price: **0.01 USDG** a call. Set `PRICE` to change it.
- You bring: nothing. A Toll API key and a payer wallet are optional (below).

## Run it

```sh
npx degit t0ll-xyz/toll-agent-templates/coin-safety my-agent
cd my-agent && npm install
PAY_TO=0xYourWallet npm start
```

## Env vars

| var | required | what |
| --- | --- | --- |
| `PAY_TO` | yes | the wallet that receives the payments (0x + 40 hex). The server will not start without it |
| `AGENT_ID` | no | your ERC-8004 agent id on Robinhood Chain (digits). Lets buyers check who gets paid |
| `PRICE` | no | price per call in USDG. Default `0.01` |
| `PORT` | no | port to listen on. Default `4021` |
| `TOLL_KEY` | no | a Toll API key, if you have one. Sent to Toll as `x-api-key` on the free check |
| `TOLL_PAYER_KEY` | no | a **throwaway** wallet key on your host with a few cents of USDG, used only to pay Toll's x402 check past the free quota |

## Where it calls Toll, and what that costs

1. Every call first asks Toll's free check: `GET https://t0ll.xyz/api/check?addr=<token>`. It is free, and counts against
   Toll's free quota for the caller (10 new coins a day when the quota is on; with `TOLL_KEY`, the key's tier).
2. If Toll answers `429` (quota reached) and `TOLL_PAYER_KEY` is set, it pays `GET https://t0ll.xyz/api/x402/check/<token>`
   instead. That costs **$0.005 USDG to Toll per check**. Your default price of $0.01 leaves you a margin of $0.005.
3. If Toll answers `429` and `TOLL_PAYER_KEY` is not set, the agent answers `503` with `code: "quota"`. A failed call is
   never settled, so the buyer is not charged.

The payer is built only when the key is set, and the key is used for nothing else. It is never logged or returned. Use a
throwaway wallet and keep only a few cents in it. Toll never sees your wallet key or your payer key.

## What a caller gets

```json
{ "token": "0x...", "name": "Example", "sym": "EXM", "verdict": "CAREFUL",
  "summary": "CAREFUL: nothing against, some things to be careful about. 0 findings against, 1 to be careful about, 6 clear.",
  "headline": "one flag worth a look",
  "counts": { "against": 0, "careful": 1, "clear": 6 },
  "concerns": ["liquidity can be pulled"], "notes": [], "clear": 6,
  "unread": [], "link": "https://t0ll.xyz/check/0x...", "source": "toll",
  "more": "add ?full=1 for Toll's tallies and every flag, under raw" }
```

The verdict comes first. The `verdict` word is worked out from Toll's combined tally with Toll's rule: `AGAINST` if any
finding is against, else `INCOMPLETE` if something could not be read (`unread` is not empty), else `CAREFUL` if any finding
says careful, else `CLEAR`. `summary` says the same in one line. `counts` is Toll's combined tally. `concerns` and `notes`
are the texts of Toll's flags that are not good news (a plain flag is a concern, a flag Toll marks `note` is a note), at most
8 of each; `clear` is how many flags are good news. `name`, `sym`, `headline` and `unread` are Toll's own (`null` when Toll
sends none). `source` is always `"toll"`.

`GET /check/0x...?full=1` adds `raw`: Toll's three tallies (launch, now, combined) and every flag as Toll sent it.

If Toll has not finished reading the coin, the answer is `502` with `code: "pending"` and the buyer is not charged.

## Deploy

Vercel: `api/index.mjs` exports the agent in the Web-handler form (`export default { fetch }`), and `vercel.json` sends every
path to it. Set the env vars in the project settings.
