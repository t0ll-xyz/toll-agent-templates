import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../app.mjs";
import { PAY_TO, jsonRes, stub, paid, unpaid, commonTests, captureLogs } from "./kit.mjs";

const dir = new URL("../", import.meta.url);
const TOKEN = "0x00000000000000000000000000000000000000a2";
const URL_OF = (t) => `http://agent.test/check/${t}`;
const TOLL_ANSWER = { token: TOKEN, verdict: "careful", tally: { against: 0, careful: 2, clear: 5 }, flags: [{ id: "lp", text: "liquidity can be pulled" }], link: `https://t0ll.xyz/check/${TOKEN}`, internal: "x" };
const env = { PAY_TO };

commonTests({ test, assert, dir, env: {}, price: "0.01", atomic: "10000", sells: "GET /check/:token", unpaidUrl: `/check/${TOKEN}` });

test("a token that is not 0x + 40 hex is a 400 before payment is asked", async () => {
  const s = stub(() => undefined);
  const app = createApp(env, { fetch: s.fetch });
  for (const bad of ["abc", "0x123", `${TOKEN}zz`, "0xGGGG0000000000000000000000000000000000a2"]) {
    const res = await app(new Request(URL_OF(bad)));
    assert.equal(res.status, 400, bad);
  }
  assert.equal(s.calls.length, 0);
});

test("a paid call asks Toll's free check first and passes on the verdict, tally, flags and link", async () => {
  const s = stub((url) => (url.startsWith("https://t0ll.xyz/api/check?addr=") ? jsonRes(TOLL_ANSWER) : undefined));
  const res = await paid(createApp(env, { fetch: s.fetch }), URL_OF(TOKEN));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.source, "toll");
  assert.equal(body.verdict, "careful");
  assert.deepEqual(body.tally, TOLL_ANSWER.tally);
  assert.equal(body.link, TOLL_ANSWER.link);
  assert.equal(body.internal, undefined);
  assert.deepEqual(s.calls.map((c) => c.url), [`https://t0ll.xyz/api/check?addr=${TOKEN}`]);
  assert.equal(s.calls[0].headers["x-api-key"], undefined, "no key header without TOLL_KEY");
  assert.ok(res.headers.get("payment-response"), "the payment settled");
});

test("TOLL_KEY is sent to Toll as x-api-key", async () => {
  const s = stub(() => jsonRes(TOLL_ANSWER));
  await paid(createApp({ ...env, TOLL_KEY: "tk_test_123" }, { fetch: s.fetch }), URL_OF(TOKEN));
  assert.equal(s.calls[0].headers["x-api-key"], "tk_test_123");
});

test("on a 429 without TOLL_PAYER_KEY it answers 503 quota, never pays, and the payment is not settled", async () => {
  let payCalls = 0;
  const s = stub(() => jsonRes({ error: "quota" }, 429));
  const res = await paid(createApp(env, { fetch: s.fetch, pay: async () => { payCalls++; return jsonRes(TOLL_ANSWER); } }), URL_OF(TOKEN));
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.code, "quota");
  assert.equal(body.error, "Toll's free quota is reached. Set TOLL_PAYER_KEY to keep answering.");
  assert.equal(payCalls, 0);
  assert.equal(s.calls.length, 1, "only the free check was asked");
  assert.equal(s.facilitator.filter((u) => u.endsWith("/settle")).length, 0, "nothing settled");
});

test("on a 429 with TOLL_PAYER_KEY it pays Toll's x402 check and answers from it", async () => {
  const payCalls = [];
  const key = "0x" + "11".repeat(32); // a made-up key, never used on chain
  const s = stub(() => jsonRes({ error: "quota" }, 429));
  const pay = async (url) => { payCalls.push(url); return jsonRes(TOLL_ANSWER); };
  const logs = await captureLogs(async () => {
    const res = await paid(createApp({ ...env, TOLL_PAYER_KEY: key }, { fetch: s.fetch, pay }), URL_OF(TOKEN));
    assert.equal(res.status, 200);
    const text = JSON.stringify(await res.json()) + JSON.stringify([...res.headers]);
    assert.doesNotMatch(text, new RegExp(key.slice(2)));
  });
  assert.deepEqual(payCalls, [`https://t0ll.xyz/api/x402/check/${TOKEN}`]);
  assert.doesNotMatch(logs, new RegExp(key.slice(2)));
});

test("a 429 on the paid route too is a 503 quota, and Toll's other errors are a 502 that is not charged", async () => {
  const key = "0x" + "11".repeat(32);
  const s = stub(() => jsonRes({}, 429));
  const a = await paid(createApp({ ...env, TOLL_PAYER_KEY: key }, { fetch: s.fetch, pay: async () => jsonRes({}, 429) }), URL_OF(TOKEN));
  assert.equal(a.status, 503);
  const s2 = stub(() => jsonRes({ error: "boom" }, 500));
  const b = await paid(createApp(env, { fetch: s2.fetch }), URL_OF(TOKEN));
  assert.equal(b.status, 502);
  assert.equal(s2.facilitator.filter((u) => u.endsWith("/settle")).length, 0);
});

test("AGENT_ID is passed as agentId in the 402", async () => {
  const { v2 } = await unpaid(createApp({ ...env, AGENT_ID: "42" }, { fetch: stub(() => undefined).fetch }), URL_OF(TOKEN));
  assert.equal(v2.accepts[0].extra.erc8004.agentId, "42");
  assert.equal(v2.extensions.bazaar.info.input.method, "GET");
  assert.equal(v2.resource.description.length > 10, true);
});

test("PRICE overrides the default", async () => {
  const { v2 } = await unpaid(createApp({ ...env, PRICE: "0.02" }, {}), URL_OF(TOKEN));
  assert.equal(v2.accepts[0].amount, "20000");
});
