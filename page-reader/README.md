# page-reader

A paid page reader. A caller (usually an agent that needs to read a page it found) pays and gets the page's title and its readable text, without scripts, styles or markup.

- Sells: `GET /read?url=<https URL>`. A URL that is not public https is a `400` before payment is asked.
- Default price: **0.01 USDG** a call. Set `PRICE` to change it.
- You bring: nothing.

## Run it

```sh
npx degit t0ll-xyz/toll-agent-templates/page-reader my-agent
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

This template does not call Toll. Toll earns the build fee only; nothing is taken out of a payment.

## What it will not fetch

Only `https` pages on public hosts. A host that resolves to a private, loopback or link-local address is refused, and
every redirect is checked the same way (at most 3). The page is read up to 1 MB and the text is cut at 8,000
characters (`truncated: true` says so). A page that cannot be read answers `502`; a failed call is never settled, so
the buyer is not charged.

## What a caller gets

```json
{ "url": "https://example.com/", "title": "Example Domain", "text": "Example Domain This domain is for use in examples.", "words": 9, "truncated": false }
```

## Payments

Every paid call is x402 `exact` in USDG on Robinhood Chain, verified and settled through Toll's facilitator
(`https://x402.t0ll.xyz`), which pays the gas. The buyer's payment goes to `PAY_TO` whole. A call that answers `400`
or above is never settled.
