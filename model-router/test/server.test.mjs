import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../app.mjs";
import { PAY_TO, jsonRes, stub, paid, unpaid, commonTests, run, captureLogs } from "./kit.mjs";

const dir = new URL("../", import.meta.url);
const KEY = "sk-test-NOT-A-REAL-KEY-1234567890";
const env = { PAY_TO, MODEL_API_KEY: KEY };
const CHAT = "http://agent.test/chat";
const post = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
const REPLY = { id: "c1", choices: [{ message: { role: "assistant", content: "hi" } }] };

commonTests({ test, assert, dir, env: { MODEL_API_KEY: KEY }, price: "0.001", atomic: "1000", sells: "POST /chat", unpaidUrl: "/chat", unpaidInit: post({ messages: [] }) });

test("it does not start without MODEL_API_KEY, and says what to set", async () => {
  const s = run(dir, { PAY_TO, PORT: "0" });
  assert.notEqual(await s.exited, 0);
  assert.match(s.err(), /MODEL_API_KEY/);
  assert.doesNotMatch(s.err(), new RegExp(KEY));
});

test("POST /chat forwards the body to MODEL_BASE_URL/chat/completions with the bearer key", async () => {
  const s = stub(() => jsonRes(REPLY));
  const res = await paid(createApp({ ...env, MODEL_BASE_URL: "https://models.test/v1/" }, { fetch: s.fetch }), CHAT, post({ model: "x", messages: [{ role: "user", content: "yo" }] }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), REPLY);
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].url, "https://models.test/v1/chat/completions");
  assert.equal(s.calls[0].method, "POST");
  assert.equal(s.calls[0].headers.authorization, `Bearer ${KEY}`);
  assert.equal(JSON.parse(s.calls[0].body).messages[0].content, "yo");
  assert.equal(JSON.parse(s.calls[0].body).model, "x", "the caller's model stays when MODEL is not set");
});

test("MODEL forces the model name; the default base URL is OpenAI's", async () => {
  const s = stub(() => jsonRes(REPLY));
  await paid(createApp({ ...env, MODEL: "gpt-test" }, { fetch: s.fetch }), CHAT, post({ model: "other", messages: [] }));
  assert.equal(s.calls[0].url, "https://api.openai.com/v1/chat/completions");
  assert.equal(JSON.parse(s.calls[0].body).model, "gpt-test");
});

test("only POST /chat is sold, and a body that is not a JSON object is a 400 before payment", async () => {
  const app = createApp(env, { fetch: stub(() => undefined).fetch });
  assert.equal((await app(new Request(CHAT))).status, 405);
  assert.equal((await app(new Request("http://agent.test/other", post({})))).status, 404);
  assert.equal((await app(new Request(CHAT, post("not json")))).status, 400);
  assert.equal((await app(new Request(CHAT, post("[1]")))).status, 400);
});

test("a body over 64 KB is a 413 before payment is asked", async () => {
  const s = stub(() => undefined);
  const app = createApp(env, { fetch: s.fetch });
  const res = await app(new Request(CHAT, post({ messages: [{ role: "user", content: "x".repeat(65 * 1024) }] })));
  assert.equal(res.status, 413);
  assert.equal(s.calls.length, 0);
  const ok = await app(new Request(CHAT, post({ messages: [{ role: "user", content: "x".repeat(60 * 1024) }] })));
  assert.equal(ok.status, 402);
});

test("the key never appears in a response body, a header or a log line, even when the upstream echoes it", async () => {
  let all = "";
  const logs = await captureLogs(async () => {
    const echo = stub((url, init) => jsonRes({ error: { message: `Incorrect API key provided: ${KEY}. Authorization: ${init.headers.authorization}` } }, 401, { "x-echo": KEY }));
    const bad = await paid(createApp(env, { fetch: echo.fetch }), CHAT, post({ messages: [] }));
    assert.equal(bad.status, 502);
    assert.equal(echo.facilitator.filter((u) => u.endsWith("/settle")).length, 0, "an upstream failure is not charged");
    all += JSON.stringify(await bad.json()) + JSON.stringify([...bad.headers]);
    const good = stub(() => jsonRes({ ...REPLY, note: `the key is ${KEY}` }, 200, { "x-echo": KEY }));
    const ok = await paid(createApp(env, { fetch: good.fetch }), CHAT, post({ messages: [] }));
    all += JSON.stringify(await ok.json()) + JSON.stringify([...ok.headers]);
    const down = stub(() => { throw new Error(`connect failed for ${KEY}`); });
    const dead = await paid(createApp(env, { fetch: down.fetch }), CHAT, post({ messages: [] }));
    assert.equal(dead.status, 502);
    all += JSON.stringify(await dead.json());
  });
  assert.doesNotMatch(all, new RegExp(KEY));
  assert.match(all, /redacted/);
  assert.doesNotMatch(logs, new RegExp(KEY));
});

test("the running server never prints the key", async () => {
  const s = run(dir, { PAY_TO, MODEL_API_KEY: KEY, PORT: "0" });
  try {
    const port = await s.boundPort();
    await fetch(`http://127.0.0.1:${port}/chat`, post({ messages: [] }));
    assert.doesNotMatch(s.out() + s.err(), new RegExp(KEY));
  } finally { await s.stop(); }
});

test("AGENT_ID and PRICE are honoured", async () => {
  const { v2 } = await unpaid(createApp({ ...env, AGENT_ID: "9", PRICE: "0.002" }, {}), CHAT, post({ messages: [] }));
  assert.equal(v2.accepts[0].extra.erc8004.agentId, "9");
  assert.equal(v2.accepts[0].amount, "2000");
  assert.equal(v2.extensions.bazaar.info.input.method, "POST");
});
