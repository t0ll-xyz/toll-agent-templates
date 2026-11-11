import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../app.mjs";
import { PAY_TO, jsonRes, stub, paid, unpaid, commonTests, run } from "./kit.mjs";

const dir = new URL("../", import.meta.url);
const UP = "https://api.example.test/v1";
const env = { PAY_TO, PRICE: "0.02", UPSTREAM_URL: UP };
const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];
const deps = (s, extra = {}) => ({ fetch: s.fetch, lookup: publicLookup, ...extra });
const CALL = (rest) => `http://agent.test/call/${rest}`;

commonTests({ test, assert, dir, env: { PRICE: "0.02", UPSTREAM_URL: UP }, price: "0.02", atomic: "20000", sells: "ALL /call/*", unpaidUrl: "/call/anything" });

test("it does not start without PRICE (there is no default), and says what to set", async () => {
  const s = run(dir, { PAY_TO, UPSTREAM_URL: UP, PORT: "0" });
  assert.notEqual(await s.exited, 0);
  assert.match(s.err(), /PRICE/);
  assert.throws(() => createApp({ PAY_TO, UPSTREAM_URL: UP }), /PRICE/);
});

test("it does not start without UPSTREAM_URL", async () => {
  const s = run(dir, { PAY_TO, PRICE: "0.02", PORT: "0" });
  assert.notEqual(await s.exited, 0);
  assert.match(s.err(), /UPSTREAM_URL/);
});

test("it refuses an upstream that is not public https", () => {
  const bad = [
    "http://api.example.com/v1", "ftp://api.example.com", "not a url", "https://localhost/x", "https://app.localhost/x",
    "https://127.0.0.1/x", "https://127.1/x", "https://0.0.0.0/x", "https://10.1.2.3/x", "https://172.16.0.9/x", "https://172.31.255.1/x",
    "https://192.168.0.1/x", "https://169.254.169.254/latest/meta-data", "https://100.64.0.1/x", "https://[::1]/x", "https://[fd00::1]/x",
    "https://[::ffff:10.0.0.1]/x", "https://printer.local/x", "https://db.internal/x", "https://intranet/x", "https://user:pw@api.example.com/x",
  ];
  for (const u of bad) assert.throws(() => createApp({ ...env, UPSTREAM_URL: u }), /UPSTREAM_URL/, u);
  assert.doesNotThrow(() => createApp({ ...env, UPSTREAM_URL: "https://api.example.com" }));
  assert.doesNotThrow(() => createApp({ ...env, UPSTREAM_URL: "https://93.184.216.34/v1" }));
});

test("UPSTREAM_AUTH_HEADER must look like Name: value, and the message never repeats the value", () => {
  assert.throws(() => createApp({ ...env, UPSTREAM_AUTH_HEADER: "just-a-token-SECRET123" }), (e) => /UPSTREAM_AUTH_HEADER/.test(e.message) && !/SECRET123/.test(e.message));
});

test("a paid call forwards method, query and body to UPSTREAM_URL plus the rest of the path", async () => {
  const s = stub((url) => jsonRes({ ok: true, url }));
  const app = createApp(env, deps(s));
  const res = await paid(app, CALL("things/42?x=1&y=two"), { method: "POST", headers: { "content-type": "application/json", cookie: "a=b" }, body: JSON.stringify({ hello: "you" }) });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].url, `${UP}/things/42?x=1&y=two`);
  assert.equal(s.calls[0].method, "POST");
  assert.equal(s.calls[0].body, JSON.stringify({ hello: "you" }));
  assert.equal(s.calls[0].headers["content-type"], "application/json");
  assert.equal(s.calls[0].headers.cookie, undefined, "the buyer's headers are not forwarded");
  assert.equal(s.calls[0].headers["payment-signature"], undefined, "the payment is not forwarded");
  const g = await paid(app, CALL("ping"), { method: "GET" });
  assert.equal(g.status, 200);
  assert.equal(s.calls[1].url, `${UP}/ping`);
  assert.equal(s.calls[1].method, "GET");
});

test("every method is sold: PUT, PATCH and DELETE reach the upstream with their method", async () => {
  const s = stub(() => jsonRes({ ok: 1 }));
  const app = createApp(env, deps(s));
  for (const m of ["PUT", "PATCH", "DELETE"]) {
    const res = await paid(app, CALL("r"), { method: m, ...(m === "DELETE" ? {} : { body: "{}", headers: { "content-type": "application/json" } }) });
    assert.equal(res.status, 200, m);
  }
  assert.deepEqual(s.calls.map((c) => c.method), ["PUT", "PATCH", "DELETE"]);
});

test("UPSTREAM_AUTH_HEADER is added to the upstream call and never echoed", async () => {
  const secret = "Bearer up-SECRET-token-999";
  const s = stub((url, init) => jsonRes({ echoed: init.headers.Authorization ?? init.headers.authorization }, 200, { "x-echo": secret }));
  const res = await paid(createApp({ ...env, UPSTREAM_AUTH_HEADER: `Authorization: ${secret}` }, deps(s)), CALL("x"));
  assert.equal(s.calls[0].headers.authorization, secret);
  const all = JSON.stringify(await res.json()) + JSON.stringify([...res.headers]);
  assert.doesNotMatch(all, /up-SECRET-token-999/);
  const err = stub((url, init) => jsonRes({ detail: `bad credentials ${init.headers.Authorization ?? init.headers.authorization}` }, 401));
  const e = await paid(createApp({ ...env, UPSTREAM_AUTH_HEADER: `Authorization: ${secret}` }, deps(err)), CALL("x"));
  assert.equal(e.status, 401);
  assert.doesNotMatch(await e.text(), /up-SECRET-token-999/);
});

test("an upstream error status is passed on and the payment is not settled", async () => {
  const s = stub(() => jsonRes({ error: "nope" }, 404));
  const res = await paid(createApp(env, deps(s)), CALL("missing"));
  assert.equal(res.status, 404);
  assert.equal(s.facilitator.filter((u) => u.endsWith("/settle")).length, 0);
});

test("a host that resolves to a private address is refused at call time (502, not charged)", async () => {
  const s = stub(() => jsonRes({}));
  const res = await paid(createApp(env, deps(s, { lookup: async () => [{ address: "10.0.0.8", family: 4 }] })), CALL("x"));
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /^The upstream host resolves to a private address./);
  assert.equal(s.calls.length, 0);
  assert.equal(s.facilitator.filter((u) => u.endsWith("/settle")).length, 0);
});

test("a redirect from the upstream is not followed", async () => {
  const s = stub(() => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } }));
  const res = await paid(createApp(env, deps(s)), CALL("x"));
  assert.equal(res.status, 502);
  assert.equal(s.calls.length, 1);
});

test("a path that climbs out of /call/ never reaches the upstream", async () => {
  const s = stub(() => jsonRes({}));
  const app = createApp(env, deps(s));
  assert.equal((await app(new Request(CALL("%2e%2e/admin")))).status, 404);
  assert.equal(s.calls.length, 0);
});

test("a path with an encoded slash or backslash is a 400 before payment is asked", async () => {
  const s = stub(() => jsonRes({}));
  const app = createApp(env, deps(s));
  for (const rest of ["a%2f..%2f..%2fadmin", "a%2Fb", "a%5cb", "x/%5C..%5Cy"]) assert.equal((await app(new Request(CALL(rest)))).status, 400, rest);
  assert.equal(s.calls.length, 0);
  assert.equal((await app(new Request(CALL("a/b%20c")))).status, 402, "other encodings are fine");
});

test("AGENT_ID is passed as agentId in the 402", async () => {
  const { v2 } = await unpaid(createApp({ ...env, AGENT_ID: "5" }, {}), CALL("x"));
  assert.equal(v2.accepts[0].extra.erc8004.agentId, "5");
});
