# wrap-api

Put a price on any API. A caller pays per request and the call is forwarded to the API you name.

- Sells: any method on `/call/*`. `GET /call/things/42?x=1` is forwarded to `UPSTREAM_URL/things/42?x=1`, with the same
  method and body.
- Price: **you set it.** There is no default and the server will not start without `PRICE`.
- You bring: the API.

## Run it

```sh
npx degit t0ll-xyz/toll-agent-templates/wrap-api my-agent
cd my-agent && npm install
PAY_TO=0xYourWallet PRICE=0.02 UPSTREAM_URL=https://api.example.com/v1 npm start
```

## Env vars

| var | required | what |
| --- | --- | --- |
| `PAY_TO` | yes | the wallet that receives the payments (0x + 40 hex). The server will not start without it |
| `AGENT_ID` | no | your ERC-8004 agent id on Robinhood Chain (digits) |
| `PRICE` | yes | price per call in USDG, for example `0.02`. No default |
| `PORT` | no | port to listen on. Default `4021` |
| `UPSTREAM_URL` | yes | the https URL of the API to wrap |
| `UPSTREAM_AUTH_HEADER` | no | an auth header added to every upstream call, written `Name: value` (for example `Authorization: Bearer abc`) |

## What it will and will not forward

- `UPSTREAM_URL` must be `https:` and a public host. The server refuses to start for `http:`, `localhost`, private or
  link-local addresses (10.x, 172.16-31.x, 192.168.x, 169.254.x and the like), IPv6 addresses, names ending in `.local` or
  `.internal`, or a URL with a user and password. A name that resolves to a private address is refused at call time too.
- Forwarded: the method, the query, the body (up to 1 MB) and the caller's `content-type` and `accept`. Nothing else the
  caller sent goes along, and the payment header never does.
- The upstream's redirects are not followed. The answer (status, body, content type) comes back as it is, up to 5 MB.
- An upstream error status (4xx, 5xx) is passed on and the payment is not settled, so the buyer is not charged. If the
  upstream cannot be reached the answer is `502`, also not charged.
- `UPSTREAM_AUTH_HEADER` goes only to the upstream and is never echoed: its value is replaced in anything that comes back.

To wrap a function instead of a URL, use the `blank` template and put your code in its `handler.mjs`.

## Where it calls Toll

Nowhere. Settlement through the facilitator is free. Toll never sees your keys.

## Deploy

Vercel: `api/index.mjs` exports the agent in the Web-handler form (`export default { fetch }`), and `vercel.json` sends every
path to it. Set the env vars in the project settings.
