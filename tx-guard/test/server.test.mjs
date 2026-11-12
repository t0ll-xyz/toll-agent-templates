import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../app.mjs";
import { PAY_TO, jsonRes, stub, paid, commonTests, captureLogs } from "./kit.mjs";

const dir = new URL("../", import.meta.url);
const env = { PAY_TO };
const TO = "0x00000000000000000000000000000000000000a2";
const TX = { chainId: 4663, from: PAY_TO, to: TO, data: "0x", value: "0" };
const post = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
const warn = { action: "WARN", warnings: [{ code: "sim-reverted", severity: "medium", message: "Simulated, this transaction reverts.", "x-toll-evidence": { block: 1 } }], scanners: {} };
const toll = (body, status = 200) => stub((url) => (url === "https://t0ll.xyz/api/tx/check" ? jsonRes(body, status) : undefined));

commonTests({ test, assert, dir, env: {}, price: "0.01", atomic: "10000", sells: "POST /check", unpaidUrl: "/check", unpaidInit: post(TX) });

test("a body that is not a transaction is a 400 before payment is asked", async () => {
  const s = stub(() => undefined);
  const app = createApp(env, { fetch: s.fetch });
  for (const bad of ["not json", [], { ...TX, chainId: 1 }, { ...TX, from: "0x12" }, { ...TX, to: null }, { ...TX, data: "0xzz" }, { ...TX, data: "0x123" }, { ...TX, value: "-1" }, { ...TX, value: 1.5 }]) {
    assert.equal((await app(new Request("http://agent.test/check", post(bad)))).status, 400, JSON.stringify(bad).slice(0, 70));
  }
  assert.equal(s.calls.length, 0);
});

test("a paid call sends exactly the transaction to Toll's free check and answers the word, the line and the warnings", async () => {
  const s = toll(warn);
  const res = await paid(createApp(env, { fetch: s.fetch }), "http://agent.test/check", post({ ...TX, extra: "dropped" }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    action: "WARN", summary: "WARN: 1 warning. Read it before signing.",
    warnings: [{ code: "sim-reverted", severity: "medium", message: "Simulated, this transaction reverts." }], source: "toll",
  });
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].method, "POST");
  assert.deepEqual(JSON.parse(s.calls[0].body), TX);
  assert.ok(res.headers.get("payment-response"), "the payment settled");
});

test("an answer with no action is never an ALLOW: 502, not settled", async () => {
  for (const body of [{ warnings: [] }, { action: "MAYBE" }, { action: "allow" }, "not json"]) {
    const res = await paid(createApp(env, { fetch: toll(body).fetch }), "http://agent.test/check", post(TX));
    assert.equal(res.status, 502);
    assert.equal(res.headers.get("payment-response"), null);
  }
  const ok = await (await paid(createApp(env, { fetch: toll({ action: "ALLOW", warnings: [] }).fetch }), "http://agent.test/check", post(TX))).json();
  assert.equal(ok.summary, "ALLOW: 0 warnings. Nothing to warn about.");
});

test("Toll's 429 without a payer key is a 503 quota; with one, Toll's x402 check is paid and the key never leaves", async () => {
  const none = await paid(createApp(env, { fetch: toll({ error: "slow" }, 429).fetch }), "http://agent.test/check", post(TX));
  assert.equal(none.status, 503);
  assert.equal(none.headers.get("payment-response"), null);

  const KEY = "payer-key-value-for-the-test";
  const paidCalls = [];
  const pay = async (url, init) => { paidCalls.push({ url, body: init.body }); return jsonRes({ action: "BLOCK", warnings: [{ code: "x", severity: "high", message: "do not" }] }); };
  let res;
  const logs = await captureLogs(async () => {
    res = await paid(createApp({ ...env, TOLL_PAYER_KEY: KEY }, { fetch: toll({ error: "slow" }, 429).fetch, pay }), "http://agent.test/check", post(TX));
  });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.equal(JSON.parse(text).summary, "BLOCK: 1 warning. Do not sign without the person's say.");
  assert.equal(paidCalls.length, 1);
  assert.equal(paidCalls[0].url, "https://t0ll.xyz/api/x402/tx");
  assert.deepEqual(JSON.parse(paidCalls[0].body), TX);
  assert.equal(text.includes(KEY), false);
  assert.equal(logs.includes(KEY), false);
});
