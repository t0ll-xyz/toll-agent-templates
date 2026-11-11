import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../app.mjs";
import { PAY_TO, jsonRes, stub, paid, unpaid, commonTests, captureLogs } from "./kit.mjs";

const dir = new URL("../", import.meta.url);
const TOKEN = "0x00000000000000000000000000000000000000a2";
const URL_OF = (t) => `http://agent.test/check/${t}`;
const LINK = `https://t0ll.xyz/check/${TOKEN}`;
const t3 = (against, careful, clear) => ({ against, careful, clear });

// the shape of Toll's real check answer (top-level keys read live 2026-11-12), with the keys the agent must not leak
const answer = (over = {}) => ({
  token: TOKEN, name: "Test Coin", sym: "TST", headline: "one flag worth a look",
  tally: { launch: t3(0, 1, 3), now: t3(0, 1, 2), combined: t3(0, 2, 5) },
  flags: [{ text: "liquidity can be pulled", when: "now" }, { text: "dev sold nothing", good: true, when: "launch" }, { text: "young pool", note: true, when: "now" }],
  unread: [],
  curve: {}, dev: { wallet: "0xdev" }, dev_fees: 1, eth_usd: 3000, fees: {}, gated: false, head: "x", history: [], holders_line: "x",
  holdings: [], hooks: [], launch: {}, listed: true, market: { cap: 1 }, now: {}, pad: "pons", pad_tx: "0x", pool_note: "x",
  pools: [{ pool: "0xpool" }], pools_found: 1, quota: { left: 3 }, read_ts: 1, supply: 1, today: {}, v3early: {}, watch: { telegram: "https://t.me/x" },
  ...over,
});
const toll = (body, status = 200) => stub((url) => (url.startsWith("https://t0ll.xyz/api/check?addr=") ? jsonRes(body, status) : undefined));
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

test("a paid call asks Toll's free check first and answers exactly the agreed fields", async () => {
  const s = toll(answer());
  const res = await paid(createApp(env, { fetch: s.fetch }), URL_OF(TOKEN));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, {
    token: TOKEN, name: "Test Coin", sym: "TST", verdict: "CAREFUL", headline: "one flag worth a look",
    tally: answer().tally, flags: answer().flags, unread: [], link: LINK, source: "toll",
  });
  for (const leaked of ["pools", "market", "quota", "dev", "watch", "reasons", "findings"]) assert.equal(leaked in body, false, leaked);
  assert.deepEqual(s.calls.map((c) => c.url), [`https://t0ll.xyz/api/check?addr=${TOKEN}`]);
  assert.equal(s.calls[0].headers["x-api-key"], undefined, "no key header without TOLL_KEY");
  assert.ok(res.headers.get("payment-response"), "the payment settled");
});

test("the verdict word follows Toll's rule on the combined tally: AGAINST, INCOMPLETE, CAREFUL, CLEAR", async () => {
  const cases = [
    [answer({ tally: { combined: t3(1, 5, 0) }, unread: ["funder"] }), "AGAINST"],
    [answer({ tally: { combined: t3(0, 5, 0) }, unread: ["funder"] }), "INCOMPLETE"],
    [answer({ tally: { combined: t3(0, 1, 0) }, unread: [] }), "CAREFUL"],
    [answer({ tally: { combined: t3(0, 0, 7) }, unread: [] }), "CLEAR"],
    [answer({ tally: { combined: t3(0, 0, 7) }, unread: undefined }), "CLEAR"],
  ];
  for (const [body, word] of cases) {
    const res = await paid(createApp(env, { fetch: toll(body).fetch }), URL_OF(TOKEN));
    assert.equal(res.status, 200);
    const out = await res.json();
    assert.equal(out.verdict, word);
    assert.deepEqual(out.unread, body.unread ?? []);
  }
});

test("name, sym and headline are null when Toll sends none", async () => {
  const res = await paid(createApp(env, { fetch: toll(answer({ name: undefined, sym: undefined, headline: undefined })).fetch }), URL_OF(TOKEN));
  const out = await res.json();
  assert.equal(out.name, null);
  assert.equal(out.sym, null);
  assert.equal(out.headline, null);
});

test("a 200 without flags or without tally.combined is a 502 'pending' and is not charged", async () => {
  for (const body of [{ token: TOKEN, tally: { combined: t3(0, 0, 1) } }, { token: TOKEN, flags: [] }, answer({ tally: { launch: t3(0, 0, 0) } }), answer({ flags: "x" })]) {
    const s = toll(body);
    const res = await paid(createApp(env, { fetch: s.fetch }), URL_OF(TOKEN));
    assert.equal(res.status, 502);
    assert.equal((await res.json()).code, "pending");
    assert.equal(s.facilitator.filter((u) => u.endsWith("/settle")).length, 0);
  }
});

test("TOLL_KEY is sent to Toll as x-api-key", async () => {
  const s = toll(answer());
  await paid(createApp({ ...env, TOLL_KEY: "tk_test_123" }, { fetch: s.fetch }), URL_OF(TOKEN));
  assert.equal(s.calls[0].headers["x-api-key"], "tk_test_123");
});

test("on a 429 without TOLL_PAYER_KEY it answers 503 quota, never pays, and the payment is not settled", async () => {
  let payCalls = 0;
  const s = stub(() => jsonRes({ error: "quota" }, 429));
  const res = await paid(createApp(env, { fetch: s.fetch, pay: async () => { payCalls++; return jsonRes(answer()); } }), URL_OF(TOKEN));
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
  const pay = async (url) => { payCalls.push(url); return jsonRes(answer({ tally: { combined: t3(2, 0, 0) } })); };
  const logs = await captureLogs(async () => {
    const res = await paid(createApp({ ...env, TOLL_PAYER_KEY: key }, { fetch: s.fetch, pay }), URL_OF(TOKEN));
    assert.equal(res.status, 200);
    const out = await res.clone().json();
    assert.equal(out.verdict, "AGAINST");
    assert.doesNotMatch(JSON.stringify(out) + JSON.stringify([...res.headers]), new RegExp(key.slice(2)));
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
