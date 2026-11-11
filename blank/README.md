# blank

An empty paid agent, with payments already wired. Put your own code in `handler.mjs` and you have something to sell.

- Sells: `GET /hello`, which answers `{ "hello": "world" }`. Change the route in `app.mjs` and the code in `handler.mjs`.
- Price: **you set it.** There is no default and the server will not start without `PRICE`.
- You bring: your code.

## Run it

```sh
npx degit t0ll-xyz/toll-agent-templates/blank my-agent
cd my-agent && npm install
PAY_TO=0xYourWallet PRICE=0.01 npm start
```

## Env vars

| var | required | what |
| --- | --- | --- |
| `PAY_TO` | yes | the wallet that receives the payments (0x + 40 hex). The server will not start without it |
| `AGENT_ID` | no | your ERC-8004 agent id on Robinhood Chain (digits) |
| `PRICE` | yes | price per call in USDG, for example `0.01`. No default |
| `PORT` | no | port to listen on. Default `4021` |

## Make it yours

`handler.mjs` exports `handle(req, env, deps)`. It runs only after a payment is verified, and the payment settles only when
you answer below 400, so an error you return is never charged. `req` is a web `Request`, `env` is `process.env`, and
`deps.fetch` is `fetch` (tests replace it). Edit `description` and the `bazaar` example in `app.mjs` so the facilitator lists
what you really sell.

`handler.mjs` has two commented code lines that call Toll's free coin check. Uncomment them to add Toll's headline and tally to your answer.

## Where it calls Toll

Nowhere by default. If you add the free check from the commented lines it is `GET https://t0ll.xyz/api/check?addr=<token>`,
free up to Toll's quota. Settlement through the facilitator is free. Toll never sees your keys.

## Deploy

Vercel: `api/index.mjs` exports the agent in the Web-handler form (`export default { fetch }`), and `vercel.json` sends every
path to it. Set the env vars in the project settings.
