# tx-guard

A paid pre-sign check. A caller (an agent or a wallet about to sign) pays, sends the transaction, and gets one word to act on: `ALLOW`, `WARN` or `BLOCK`, with each warning in plain words. The reading is done by Toll's pre-sign check.

- Sells: `POST /check` with a JSON body `{ "chainId": 4663, "from": "0x...", "to": "0x...", "data": "0x...", "value": "0" }`. A body that is not that is a `400` before payment is asked.
- Default price: **0.01 USDG** a call. Set `PRICE` to change it.
- You bring: nothing (a payer wallet is optional, below).

## Run it

```sh
npx degit t0ll-xyz/toll-agent-templates/tx-guard my-agent
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
| `TOLL_PAYER_KEY` | no | a THROWAWAY wallet key on your host, used only to pay Toll's x402 pre-sign check past the free rate |

## Where it calls Toll, and what that costs

1. Every call first asks Toll's free pre-sign check: `POST https://t0ll.xyz/api/tx/check` with the same body. It is
   free and rate limited.
2. If Toll answers `429` and `TOLL_PAYER_KEY` is set, it pays `POST https://t0ll.xyz/api/x402/tx` instead. That costs
   **$0.005 USDG to Toll per check**. Your default price of $0.01 leaves you a margin of $0.005.
3. If Toll answers `429` and `TOLL_PAYER_KEY` is not set, the agent answers `503` with `code: "quota"`. A failed call is
   never settled, so the buyer is not charged.

The payer is built only when the key is set, and the key is used for nothing else. It is never logged or returned. Use a
throwaway wallet and keep only a few cents in it.

## What the word means

`ALLOW`: Toll found nothing to warn about. `WARN`: read the warnings before signing. `BLOCK`: do not sign without the
person's say. The word is what one read found; it is not a promise about the transaction.

## What a caller gets

```json
{ "action": "WARN", "summary": "WARN: 1 warning. Read it before signing.", "warnings": [{ "code": "sim-reverted", "severity": "medium", "message": "Simulated, this transaction reverts. Signed as it is, it would fail and still cost gas." }], "source": "toll" }
```

## Building on Hookr

[Hookr](https://hookr.fun) is a Uniswap v4 hook builder and launchpad on Robinhood Chain. Its MCP server
(`https://hookr.fun/api/mcp`) builds unsigned calls. Check each one before the wallet signs:

1. **Build** the call with Hookr's MCP for your wallet: `hookr_build_swap`, `hookr_build_launch`, `hookr_build_claim`,
   `hookr_build_agent_link`, `hookr_build_fill`, or the liquidity builders.
2. **Check** it: send what Hookr returned (`to`, `data`, `value`) to `POST /check` with `from` set to that wallet.
3. **Sign** only on `ALLOW`. Pass every warning on; on `BLOCK` do not sign without the person's say.

Toll reads HookrRouter swaps, HookrLauncher launches (the token, the pools, who holds the liquidity, a dev buy), a
launch's own withdrawal and fee collection, a pool core's claim, the Agent gate link and the order book fill. Each is
named as Hookr's contract, not audited. An unknown hook, rules contract or add-on, or a payout to anyone but `from`,
is a warning. Any other function of those contracts is not decoded: `WARN`, never `ALLOW`.

[`examples/hookr-build.mjs`](examples/hookr-build.mjs) does steps 2 and 3 for a real call Hookr's
`hookr_build_agent_link` built on 2026-11-13:

```sh
node examples/hookr-build.mjs
```

Steps for agents: <https://t0ll.xyz/hooks/hookr#agents>

## Payments

Every paid call is x402 `exact` in USDG on Robinhood Chain, verified and settled through Toll's facilitator
(`https://x402.t0ll.xyz`), which pays the gas. The buyer's payment goes to `PAY_TO` whole. A call that answers `400`
or above is never settled.
