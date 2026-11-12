import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../app.mjs";
import { PAY_TO, jsonRes, stub, paid, commonTests } from "./kit.mjs";

const dir = new URL("../", import.meta.url);
const env = { PAY_TO };
const W = "0x00000000000000000000000000000000000000a2";
const URL_OF = `http://agent.test/wallet/${W}`;
const approvals = { state: "ok", wallet: W, rows: [
  { kind: "erc20", token: W, symbol: "PONS", spender: PAY_TO, unlimited: true, spenderFacts: { name: "Known Router" }, risk: "low", why: "an unlimited allowance to Known Router" },
  { kind: "erc20", token: W, symbol: "ABC", spender: PAY_TO, unlimited: false, spenderFacts: { name: null }, risk: "high", why: "an allowance to a contract with no name" },
] };
const deployer = { addr: W, launches: 3, graduated: 1, sold_into: 2, gated: { held: null } };
const toll = (a, d) => stub((url) => {
  if (url === `https://t0ll.xyz/api/approvals/${W}`) return a;
  if (url === `https://t0ll.xyz/api/deployer?addr=${W}`) return d;
  return undefined;
});

commonTests({ test, assert, dir, env: {}, price: "0.02", atomic: "20000", sells: "GET /wallet/:address", unpaidUrl: `/wallet/${W}` });

test("an address that is not 0x + 40 hex is a 400 before payment is asked", async () => {
  const s = stub(() => undefined);
  const app = createApp(env, { fetch: s.fetch });
  for (const bad of ["abc", "0x123", `${W}00`]) assert.equal((await app(new Request(`http://agent.test/wallet/${bad}`))).status, 400, bad);
  assert.equal(s.calls.length, 0);
});

test("a paid call reads both Toll routes and answers the line first, exactly these fields", async () => {
  const s = toll(jsonRes(approvals), jsonRes(deployer));
  const res = await paid(createApp(env, { fetch: s.fetch }), URL_OF.replace(W, W.toUpperCase().replace("0X", "0x")));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    wallet: W, summary: "2 live approvals, 1 worth a look. Deployer of 3 coins: 1 graduated, sold into 2.",
    approvals: { count: 2, unlimited: 1, look: [{ token: "ABC", spender: PAY_TO, risk: "high", why: "an allowance to a contract with no name" }] },
    deployer: { launches: 3, graduated: 1, soldInto: 2 }, notRead: [],
    links: { approvals: `https://t0ll.xyz/approvals/${W}`, deployer: `https://t0ll.xyz/deployer/${W}` }, source: "toll",
  });
  assert.equal(s.calls.length, 2);
  assert.ok(res.headers.get("payment-response"), "the payment settled");
});

test("one part not read: it is null and named, the other is answered and the call settles", async () => {
  const s = toll(jsonRes({ error: "slow down" }, 429), jsonRes({ ...deployer, launches: 0, graduated: 0, sold_into: 0 }));
  const res = await paid(createApp(env, { fetch: s.fetch }), URL_OF);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.approvals, null);
  assert.deepEqual(body.notRead, ["approvals"]);
  assert.equal(body.summary, "It has deployed no coin.");
});

test("neither part read: 503 when Toll's rate is reached, else 502; never settled", async () => {
  const quota = await paid(createApp(env, { fetch: toll(jsonRes({}, 429), jsonRes({}, 500)).fetch }), URL_OF);
  assert.equal(quota.status, 503);
  assert.equal(quota.headers.get("payment-response"), null);
  const down = await paid(createApp(env, { fetch: toll(jsonRes({ state: "reading" }), jsonRes({ nope: 1 })).fetch }), URL_OF);
  assert.equal(down.status, 502);
  assert.equal(down.headers.get("payment-response"), null);
});
