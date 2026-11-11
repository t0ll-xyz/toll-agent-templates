# model-router

A paid chat endpoint. A caller pays per request and gets an answer from the model API you point it at.

- Sells: `POST /chat` with an OpenAI-style JSON body (`{ "messages": [...] }`).
- Default price: **0.001 USDG** a call. Set `PRICE` to change it.
- You bring: a model API key.

## Run it

```sh
npx degit t0ll-xyz/toll-agent-templates/model-router my-agent
cd my-agent && npm install
PAY_TO=0xYourWallet MODEL_API_KEY=sk-... npm start
```

## Env vars

| var | required | what |
| --- | --- | --- |
| `PAY_TO` | yes | the wallet that receives the payments (0x + 40 hex). The server will not start without it |
| `AGENT_ID` | no | your ERC-8004 agent id on Robinhood Chain (digits) |
| `PRICE` | no | price per call in USDG. Default `0.001` |
| `PORT` | no | port to listen on. Default `4021` |
| `MODEL_BASE_URL` | no | base URL of an OpenAI-style API. Default `https://api.openai.com/v1`. Must be https |
| `MODEL_API_KEY` | yes | your model API key. The server will not start without it |
| `MODEL` | no | the model name. When set, every call uses it, whatever the caller asked for |

## How it works

The JSON body is forwarded to `MODEL_BASE_URL/chat/completions` with `Authorization: Bearer MODEL_API_KEY`, and the answer
comes back as it is. The answer is returned whole (`stream` is always off). Price it above what one call costs you: set
`MODEL` to a model you know the cost of, since a caller can otherwise ask for any model your key can reach.

- A body over 64 KB is refused with `413` before payment is asked. A body that is not a JSON object gets `400`.
- If the model API fails, the agent answers `502` and the buyer is not charged.
- Your key stays on your host. It goes only into the one upstream request. It never appears in an answer, a header or a log
  line, and if the upstream's error text echoes it, it is replaced with `[redacted]`.

## Where it calls Toll

Nowhere. Settlement through the facilitator is free. Toll never sees your keys.

## Deploy

Vercel: `api/index.mjs` exports the agent in the Web-handler form (`export default { fetch }`), and `vercel.json` sends every
path to it. Set the env vars in the project settings. Model calls can be slow: raise the function's max duration if you need
to.
