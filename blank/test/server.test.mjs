import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createApp } from "../app.mjs";
import { PAY_TO, stub, paid, unpaid, commonTests, run } from "./kit.mjs";

const dir = new URL("../", import.meta.url);
const env = { PAY_TO, PRICE: "0.01" };
const HELLO = "http://agent.test/hello";

commonTests({ test, assert, dir, env: { PRICE: "0.01" }, price: "0.01", atomic: "10000", sells: "GET /hello", unpaidUrl: "/hello" });

test("it does not start without PRICE (there is no default), and says what to set", async () => {
  const s = run(dir, { PAY_TO, PORT: "0" });
  assert.notEqual(await s.exited, 0);
  assert.match(s.err(), /PRICE/);
});

test("a paid GET /hello answers { hello: 'world' } and settles", async () => {
  const s = stub(() => undefined);
  const res = await paid(createApp(env, { fetch: s.fetch }), HELLO);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { hello: "world" });
  assert.equal(s.facilitator.filter((u) => u.endsWith("/settle")).length, 1);
  assert.equal(s.calls.length, 0, "no Toll call by default");
});

test("other paths and methods are not sold", async () => {
  const app = createApp(env, {});
  assert.equal((await app(new Request("http://agent.test/nope"))).status, 404);
  assert.equal((await app(new Request(HELLO, { method: "POST" }))).status, 405);
});

test("handler.mjs carries two commented lines that show a call to Toll's free check", () => {
  const src = readFileSync(new URL("../handler.mjs", import.meta.url), "utf8");
  const lines = src.split("\n").filter((l) => /^\s*\/\/\s*(const|return) /.test(l));
  assert.equal(lines.length, 2);
  assert.match(lines[0], /https:\/\/t0ll\.xyz\/api\/check\?addr=/);
  assert.match(lines[1], /check\.headline/);
  assert.match(lines[1], /check\.tally\?\.combined/);
  assert.doesNotMatch(src, /check\.verdict/);
});

test("AGENT_ID is passed as agentId in the 402", async () => {
  const { v2 } = await unpaid(createApp({ ...env, AGENT_ID: "3" }, {}), HELLO);
  assert.equal(v2.accepts[0].extra.erc8004.agentId, "3");
});
