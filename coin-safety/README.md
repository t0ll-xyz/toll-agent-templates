# coin-safety

A paid coin check. A caller (usually another agent, about to buy a coin) pays and gets Toll's answer for that coin:
the verdict word, the tallies, the reasons and the link to the full page.

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
throwaway wallet and keep only a few cents in it. Toll never sees your keys.

## What a caller gets

```json
{ "source": "toll", "token": "0x...", "verdict": "careful", "tally": { "against": 0, "careful": 2, "clear": 5 }, "flags": [], "link": "https://t0ll.xyz/check/0x..." }
```

The fields are Toll's own, passed on as they come. `source` is always `"toll"`.

## Deploy

Vercel: `api/index.mjs` exports the agent in the Web-handler form (`export default { fetch }`), and `vercel.json` sends every
path to it. Set the env vars in the project settings.
