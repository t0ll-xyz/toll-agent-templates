import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../app.mjs";
import { limitOf } from "../handler.mjs";
import { PAY_TO, jsonRes, stub, paid, commonTests } from "./kit.mjs";

const dir = new URL("../", import.meta.url);
const env = { PAY_TO };
const T2 = "0x00000000000000000000000000000000000000a2";
const row = (over = {}) => ({ "token": "0x00000000000000000000000000000000000000a2", "sym": "EXM", "name": "Example", "call": "careful", "reason": "one wallet holds most of the main pool's liquidity", "dev": "0x00000000000000000000000000000000000000a1", "mcap_usd": 9917, "buyers": 22, "chain": "rh", "groups": [{"pct": 43.8, "wallets": 17}], "level": "F", ...over });
const toll = (body, status = 200) => stub((url) => (url.startsWith("https://t0ll.xyz/api/launches?limit=") ? jsonRes(body, status) : undefined));

commonTests({ test, assert, dir, env: {}, price: "0.01", atomic: "10000", sells: "GET /launches", unpaidUrl: "/launches" });

test("a limit that is not 1 to 20 is a 400 before payment is asked", async () => {
  const s = stub(() => undefined);
  const app = createApp(env, { fetch: s.fetch });
  for (const bad of ["0", "21", "abc", "-3", "1.5", "100"]) assert.equal((await app(new Request(`http://agent.test/launches?limit=${bad}`))).status, 400, bad);
  assert.equal(s.calls.length, 0);
  assert.equal(limitOf(new URL("http://x/launches")), 10);
  assert.equal(limitOf(new URL("http://x/launches?limit=20")), 20);
});

test("a paid call answers the newest launches with exactly these fields, and passes the limit on", async () => {
  const s = toll({ rows: [row(), row({ token: "not an address" }), row({ token: T2.toUpperCase().replace("0X", "0x"), call: "moon", sym: null, mcap_usd: "big" })], next: "x" });
  const res = await paid(createApp(env, { fetch: s.fetch }), "http://agent.test/launches?limit=5");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.count, 2);
  assert.deepEqual(body.launches[0], {
    token: T2, sym: "EXM", name: "Example", call: "careful", reason: "one wallet holds most of the main pool's liquidity",
    dev: PAY_TO, mcapUsd: 9917, buyers: 22, link: `https://t0ll.xyz/check/${T2}`,
  });
  assert.deepEqual([body.launches[1].call, body.launches[1].sym, body.launches[1].mcapUsd], [null, null, null], "a value that is not what it should be is null, never passed on");
  for (const leaked of ["groups", "level", "chain"]) assert.equal(leaked in body.launches[0], false, leaked);
  assert.equal(s.calls[0].url, "https://t0ll.xyz/api/launches?limit=5");
  assert.ok(res.headers.get("payment-response"), "the payment settled");
});

test("Toll's 429 is a 503 quota and a broken answer a 502: neither settles", async () => {
  for (const [body, status, want] of [[{ error: "slow" }, 429, 503], [{ rows: "no" }, 200, 502], [{ error: "x" }, 503, 502]]) {
    const res = await paid(createApp(env, { fetch: toll(body, status).fetch }), "http://agent.test/launches");
    assert.equal(res.status, want);
    assert.equal(res.headers.get("payment-response"), null);
  }
});
