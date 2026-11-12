# launch-feed

A paid launch feed. A caller (usually an agent that trades new coins) pays and gets the newest coins on Robinhood Chain, newest first, each with the call Toll made on it at launch (clear, careful or against) and the one-line reason.

- Sells: `GET /launches` with an optional `?limit=` from 1 to 20 (default 10). A limit that is not that is a `400` before payment is asked.
- Default price: **0.01 USDG** a call. Set `PRICE` to change it.
- You bring: nothing.

## Run it

```sh
npx degit t0ll-xyz/toll-agent-templates/launch-feed my-agent
cd my-agent && npm install
PAY_TO=0xYourWallet npm start
```

`GET /` is free and says what the agent sells. On Railway the same folder deploys as it is (`railway.json` names the
start command and the health route).

## Env vars

| var | required | what |
| --- | --- | --- |
| `PAY_TO` | yes | the wallet that receives the payments (0x + 40 hex). Required. |
| `AGENT_ID` | no | your ERC-8004 agent id on Robinhood Chain (digits). Optional. |
| `PRICE` | no | price per call in USDG. Default 0.01. |
| `PORT` | no | port the agent listens on. Default 4021. |

## Where it calls Toll, and what that costs

Every call reads `GET https://t0ll.xyz/api/launches?limit=<n>`. It is free, 30 reads a minute per caller. When Toll
answers `429` the agent answers `503` with `code: "quota"`; a failed call is never settled, so the buyer is not charged.
For a feed with no rate limit, Toll's own paid route is `GET https://t0ll.xyz/api/x402/fresh` ($0.01 USDG a call).
Toll earns the build fee only; nothing is taken out of a payment.

## What a caller gets

```json
{"count": 1, "launches": [{"token": "0x00000000000000000000000000000000000000a2", "sym": "EXM", "name": "Example", "call": "careful", "reason": "one wallet holds most of the main pool's liquidity", "dev": "0x00000000000000000000000000000000000000a1", "mcapUsd": 9917, "buyers": 22, "link": "https://t0ll.xyz/check/0x00000000000000000000000000000000000000a2"}], "source": "toll"}
```

## Payments

Every paid call is x402 `exact` in USDG on Robinhood Chain, verified and settled through Toll's facilitator
(`https://x402.t0ll.xyz`), which pays the gas. The buyer's payment goes to `PAY_TO` whole. A call that answers `400`
or above is never settled.
