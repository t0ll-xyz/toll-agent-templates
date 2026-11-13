import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../app.mjs";
import { PAY_TO, jsonRes, stub, paid, commonTests, captureLogs } from "./kit.mjs";
import { HOOKR_AGENT_LINK, checkBody, checkBuilt, maySign } from "../examples/hookr-build.mjs";

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

// examples/hookr-build.mjs: a call Hookr's MCP built goes to the check with from = the wallet it was built for
test("a hookr_build_* answer: each call is sent as { chainId, from: the wallet, to, data, value }; sign only when every one is ALLOW", async () => {
  const [call] = HOOKR_AGENT_LINK.calls;
  const body = checkBody(HOOKR_AGENT_LINK.wallet, call);
  assert.deepEqual(body, { chainId: 4663, from: HOOKR_AGENT_LINK.wallet, to: call.to, data: call.data, value: "0" });
  // link(uint256 agentId) for agent 20030 (0x4e3e), as Hookr built it
  assert.equal(call.data, "0xb1a867d5" + (20030).toString(16).padStart(64, "0"));

  const low = { code: "hookr-contract", severity: "low", message: "This call goes to one of Hookr's contracts: named, not audited." };
  const s = toll({ action: "ALLOW", warnings: [low], scanners: {} });
  const answers = await checkBuilt(HOOKR_AGENT_LINK, { get: s.fetch });
  assert.deepEqual(answers, [{ to: call.to, action: "ALLOW", warnings: [low] }]);
  assert.deepEqual(JSON.parse(s.calls[0].body), body);
  assert.equal(maySign(answers), true);
  assert.equal(maySign([{ action: "ALLOW" }, { action: "WARN" }]), false);
  assert.equal(maySign([]), false);

  // the same call through this template's own paid route: Toll gets exactly that body
  const t = toll({ action: "WARN", warnings: [{ code: "hookr-pays-other", severity: "high", message: "This call pays another wallet." }] });
  const res = await paid(createApp(env, { fetch: t.fetch }), "http://agent.test/check", post(body));
  assert.equal((await res.json()).action, "WARN");
  assert.deepEqual(JSON.parse(t.calls[0].body), body);
});

test("a check that does not answer with an action is thrown, never read as ALLOW", async () => {
  for (const [b, status] of [[{ warnings: [] }, 200], [{ action: "ALLOW" }, 500], [{ error: "slow" }, 429]]) {
    await assert.rejects(checkBuilt(HOOKR_AGENT_LINK, { get: toll(b, status).fetch }), /do not sign/);
  }
});
