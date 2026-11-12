# wallet-check

A paid wallet check. A caller pays and gets two things Toll reads about a wallet on Robinhood Chain: who can spend its tokens right now (its live approvals, with the ones worth a look named), and its record as a coin deployer (launches, how many graduated, how many it sold into).

- Sells: `GET /wallet/:address` where `:address` is `0x` + 40 hex. Anything else is a `400` before payment is asked.
- Default price: **0.02 USDG** a call. Set `PRICE` to change it.
- You bring: nothing.

## Run it

```sh
npx degit t0ll-xyz/toll-agent-templates/wallet-check my-agent
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
| `PRICE` | no | price per call in USDG. Default 0.02. |
| `PORT` | no | port the agent listens on. Default 4021. |

## Where it calls Toll, and what that costs

Every call reads two free Toll routes: `GET https://t0ll.xyz/api/approvals/<wallet>` and
`GET https://t0ll.xyz/api/deployer?addr=<wallet>`. Both are rate limited. A part Toll did not answer is `null` and named
in `notRead`; when neither answers, the agent answers `503` (rate reached) or `502`, and a failed call is never settled.
Toll earns the build fee only; nothing is taken out of a payment.

## What a caller gets

```json
{"wallet": "0x00000000000000000000000000000000000000a2", "summary": "2 live approvals, 1 worth a look. Deployer of 3 coins: 1 graduated, sold into 2.", "approvals": {"count": 2, "unlimited": 1, "look": [{"token": "PONS", "spender": "Example Router", "risk": "high", "why": "an unlimited allowance to a contract with no name"}]}, "deployer": {"launches": 3, "graduated": 1, "soldInto": 2}, "notRead": [], "links": {"approvals": "https://t0ll.xyz/approvals/0x00000000000000000000000000000000000000a2", "deployer": "https://t0ll.xyz/deployer/0x00000000000000000000000000000000000000a2"}, "source": "toll"}
```

## Payments

Every paid call is x402 `exact` in USDG on Robinhood Chain, verified and settled through Toll's facilitator
(`https://x402.t0ll.xyz`), which pays the gas. The buyer's payment goes to `PAY_TO` whole. A call that answers `400`
or above is never settled.
