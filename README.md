# toll agent templates

Five small agents you can run and get paid for. Each one is a tiny Node server that sells one route for USDG over
[x402](https://x402.org) on Robinhood Chain (`eip155:4663`). A caller pays per call, the payment settles through Toll's
facilitator at https://x402.t0ll.xyz, and the money lands in your own wallet (`PAY_TO`).

| template | sells | default price | you bring |
| --- | --- | --- | --- |
| [coin-safety](coin-safety) | `GET /check/:token`, a coin check read from Toll | 0.01 USDG | nothing |
| [stock-researcher](stock-researcher) | `GET /brief/:ticker`, one brief on a stock token (Toll markets + SEC) | 0.05 USDG | a contact string for SEC |
| [model-router](model-router) | `POST /chat`, chat completions from your model API | 0.001 USDG | a model API key |
| [wrap-api](wrap-api) | `ALL /call/*`, forwarded to any public https API | you set it | the API |
| [blank](blank) | `GET /hello`, an empty seller to put your code in | you set it | your code |

## Browser buyers

Every template answers with `access-control-allow-origin: *`, exposes the `PAYMENT-REQUIRED` and `PAYMENT-RESPONSE`
headers, and answers the browser's preflight (`OPTIONS`) before anything is priced. So a web page on any site can read
the 402, pay it from the visitor's wallet and read the answer. Nothing to configure.

## Three commands

```sh
npx degit t0ll-xyz/toll-agent-templates/coin-safety my-agent
cd my-agent && npm install
PAY_TO=0xYourWallet npm start
```

Swap `coin-safety` for any folder above. Each folder works on its own. `GET /` is free and says what the agent sells and
for how much. Any other call without a payment gets a `402` that names the price, USDG, chain `4663` and your wallet.

To run it on Vercel, each folder has `api/index.mjs` and a `vercel.json` that sends every path to it. Set the env vars in
the project settings.

## Toll never sees your keys

Your model key, your upstream auth header and your payer key stay on your host. A payment is signed by the buyer and
checked and settled by the facilitator, which pays the gas and needs no account and no API key from you. The only keys a
template can hold are ones you set yourself in your own environment, and none is ever logged or sent anywhere but the one
service it is meant for.

## What is in a folder

| file | what it is |
| --- | --- |
| `server.mjs` | starts the agent on Node's `http` |
| `api/index.mjs` | the same agent for Vercel |
| `app.mjs` | builds the agent from the environment |
| `handler.mjs` | the paid route: this is the part to read and change |
| `seller.mjs` | shared code (price, env checks, the http adapter). Copied from `shared/`, do not edit it per template |
| `.env.example` | every env var the template reads |

## Limits

The facilitator's limits and how settlement works are on https://t0ll.xyz/x402/docs.

## Working on this repo

`npm install` once at the root, then `node --test coin-safety/test/server.test.mjs` (and the same for the other folders),
and `node --test test/repo.test.mjs` for the root checks. After changing `shared/seller.mjs` or `shared/testkit.mjs`, run
`npm run sync` to copy them into every folder. No test reaches the network.

MIT licensed.
