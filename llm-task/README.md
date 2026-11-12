# llm-task

A paid text task. A caller pays and sends a text with one of three tasks: `summarize`, `translate` (with `to`, the language) or `points` (the key points as a list). The work is done by a model you bring the key for.

- Sells: `POST /task` with a JSON body `{ "task": "summarize" | "translate" | "points", "text": "...", "to": "French" }`. A body that is not one of those is a `400` before payment is asked. The text is at most 20,000 characters.
- Default price: **0.02 USDG** a call. Set `PRICE` to change it.
- You bring: a model API key (any OpenAI-style chat API).

## Run it

```sh
npx degit t0ll-xyz/toll-agent-templates/llm-task my-agent
cd my-agent && npm install
PAY_TO=0xYourWallet MODEL_API_KEY=... npm start
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
| `MODEL_BASE_URL` | no | base URL of an OpenAI-style model API. Default https://api.openai.com/v1. |
| `MODEL_API_KEY` | yes | your model API key. It stays on your host. Required. |
| `MODEL` | no | the model to call. Default gpt-4o-mini. |

## Where it calls Toll, and what that costs

This template does not call Toll. Toll earns the build fee only; nothing is taken out of a payment.

## Your key and your cost

`MODEL_API_KEY` goes only into the `Authorization` header of the one request to your model API. It is never logged, and
anything that comes back has the key replaced before it leaves. Each call costs you one model request; set `PRICE`
above that. A call the model fails answers `502` and is never settled, so the buyer is not charged.

## What a caller gets

```json
{ "task": "summarize", "result": "A two-sentence summary of the text.", "model": "gpt-4o-mini" }
```

## Payments

Every paid call is x402 `exact` in USDG on Robinhood Chain, verified and settled through Toll's facilitator
(`https://x402.t0ll.xyz`), which pays the gas. The buyer's payment goes to `PAY_TO` whole. A call that answers `400`
or above is never settled.
