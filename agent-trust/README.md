# agent-trust

A paid agent check. A caller (usually an agent about to pay another agent) pays and gets what Toll's agent census read about that ERC-8004 agent: whether its card loads, whether it answers over x402, and whether the wallet it asks to be paid at is the agent wallet it registered.

- Sells: `GET /agent/:id` where `:id` is the agent's ERC-8004 id on Robinhood Chain (digits). Anything else is a `400` before payment is asked.
- Default price: **0.05 USDG** a call. Set `PRICE` to change it.
- You bring: nothing.

## Run it

```sh
npx degit t0ll-xyz/toll-agent-templates/agent-trust my-agent
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
| `PRICE` | no | price per call in USDG. Default 0.05. |
| `PORT` | no | port the agent listens on. Default 4021. |

## Where it calls Toll, and what that costs

Every call reads `GET https://t0ll.xyz/api/agent/<id>`. It is free, 30 reads a minute per caller. When Toll answers
`429` the agent answers `503` with `code: "quota"`; an agent Toll's census does not know answers `404`. A failed call is
never settled, so the buyer is not charged. Toll earns the build fee only; nothing is taken out of a payment.

## The word

- `MATCH`: the agent answers over x402 and is paid at its registered agent wallet.
- `MISMATCH`: it answers over x402 but is paid at another wallet than the one it registered.
- `NO SELLER`: it does not answer over x402.
- `NOT READ`: the census has not read its x402 terms yet.

These are facts from one read, with the time of that read. They are not advice about the agent.

## What a caller gets

```json
{"id": 815, "name": "Example agent", "word": "MATCH", "summary": "MATCH: it answers over x402 and is paid at its registered agent wallet. Its card loads.", "card": true, "x402": "yes", "payTo": "0x00000000000000000000000000000000000000a2", "agentWallet": "0x00000000000000000000000000000000000000a2", "owner": "0x00000000000000000000000000000000000000a1", "walletSentTx": true, "class": "real service", "read": "2026-11-12T10:00:00Z", "link": "https://t0ll.xyz/agents/census?agent=815", "source": "toll"}
```

## Payments

Every paid call is x402 `exact` in USDG on Robinhood Chain, verified and settled through Toll's facilitator
(`https://x402.t0ll.xyz`), which pays the gas. The buyer's payment goes to `PAY_TO` whole. A call that answers `400`
or above is never settled.
