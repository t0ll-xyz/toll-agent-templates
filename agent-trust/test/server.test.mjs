import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../app.mjs";
import { wordOf } from "../handler.mjs";
import { PAY_TO, jsonRes, stub, paid, commonTests } from "./kit.mjs";

const dir = new URL("../", import.meta.url);
const env = { PAY_TO };
const A2 = "0x00000000000000000000000000000000000000a2";
const agent = (over = {}) => ({ "chain": "rh", "id": 815, "name": "Example agent", "class": "real service", "card": {"ok": true, "host": "agent.example", "error": null}, "mcp": {"answer": "none"}, "x402": {"answer": "yes", "claimed": true, "pay_to": "0x00000000000000000000000000000000000000a2", "pay_to_is_agent_wallet": true}, "owner": "0x00000000000000000000000000000000000000a1", "agent_wallet": "0x00000000000000000000000000000000000000a2", "wallet": {"checked": "agent_wallet", "sent_tx": true}, "platform": null, "source": {"kind": "live", "read": "2026-11-12T10:00:00Z"}, ...over });
const toll = (body, status = 200) => stub((url) => (url === "https://t0ll.xyz/api/agent/815" ? jsonRes(body, status) : undefined));

commonTests({ test, assert, dir, env: {}, price: "0.05", atomic: "50000", sells: "GET /agent/:id", unpaidUrl: "/agent/815" });

test("an id that is not digits is a 400 before payment is asked", async () => {
  const s = stub(() => undefined);
  const app = createApp(env, { fetch: s.fetch });
  for (const bad of ["abc", "8 15", "0x815", "-1", "1234567890123"]) assert.equal((await app(new Request(`http://agent.test/agent/${bad}`))).status, 400, bad);
  assert.equal(s.calls.length, 0);
});

test("a paid call answers the word first, one line, the wallets and the time of the read, exactly these fields", async () => {
  const s = toll(agent());
  const res = await paid(createApp(env, { fetch: s.fetch }), "http://agent.test/agent/815");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, {
    id: 815, name: "Example agent", word: "MATCH",
    summary: "MATCH: it answers over x402 and is paid at its registered agent wallet. Its card loads.",
    card: true, x402: "yes", payTo: A2, agentWallet: A2, owner: PAY_TO, walletSentTx: true, class: "real service",
    read: "2026-11-12T10:00:00Z", link: "https://t0ll.xyz/agents/census?agent=815", source: "toll",
  });
  assert.deepEqual(Object.keys(body).slice(0, 4), ["id", "name", "word", "summary"]);
  assert.ok(res.headers.get("payment-response"), "the payment settled");
});

test("the word is MATCH only when the read says the payTo is the agent wallet", () => {
  assert.equal(wordOf({ x402: { answer: "yes", pay_to_is_agent_wallet: true } }), "MATCH");
  assert.equal(wordOf({ x402: { answer: "yes", pay_to_is_agent_wallet: false } }), "MISMATCH");
  assert.equal(wordOf({ x402: { answer: "yes", pay_to_is_agent_wallet: null } }), "NOT READ");
  assert.equal(wordOf({ x402: { answer: "no" } }), "NO SELLER");
  assert.equal(wordOf({ x402: { answer: "none" } }), "NO SELLER");
  assert.equal(wordOf({}), "NOT READ");
  assert.equal(wordOf(null), "NOT READ");
});

test("a mismatch and a card that does not load are said in the line", async () => {
  const s = toll(agent({ card: { ok: false }, x402: { answer: "yes", pay_to: PAY_TO, pay_to_is_agent_wallet: false } }));
  const body = await (await paid(createApp(env, { fetch: s.fetch }), "http://agent.test/agent/815")).json();
  assert.equal(body.summary, "MISMATCH: it answers over x402 but is paid at another wallet than the one it registered. Its card does not load.");
});

test("Toll's 429 is a 503 quota, an unknown agent a 404, a broken answer a 502: none of them settles", async () => {
  for (const [body, status, want] of [[{ error: "slow down" }, 429, 503], [{ error: "no such agent" }, 404, 404], [{ nope: true }, 200, 502], ["not json", 500, 502]]) {
    const s = toll(body, status);
    const res = await paid(createApp(env, { fetch: s.fetch }), "http://agent.test/agent/815");
    assert.equal(res.status, want, String(status));
    assert.equal(res.headers.get("payment-response"), null);
  }
});
