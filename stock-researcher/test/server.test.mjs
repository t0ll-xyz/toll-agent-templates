import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../app.mjs";
import { PAY_TO, jsonRes, stub, paid, unpaid, commonTests, run } from "./kit.mjs";

const dir = new URL("../", import.meta.url);
const UA = "Test Agent test@example.com";
const env = { PAY_TO, SEC_USER_AGENT: UA };
const URL_OF = (t) => `http://agent.test/brief/${t}`;
const STOCK = { ticker: "AAPL", price: 190.1, company: { state: "ok", name: "Apple Inc.", cik: 320193 } };
const FUND = { ticker: "AAPL", revenue: 1 };
const INSIDERS = { ticker: "AAPL", trades: [] };
const SEC = { name: "Apple Inc.", filings: { recent: { form: ["10-K", "8-K"], filingDate: ["2026-10-30", "2026-10-01"], accessionNumber: ["0000320193-26-000001", "0000320193-26-000002"], primaryDocument: ["a.htm", "b.htm"] } } };

const upstream = (over = {}) => (url) => {
  if (url in over) return over[url];
  if (url === "https://t0ll.xyz/api/markets/stock/AAPL") return jsonRes(STOCK);
  if (url === "https://t0ll.xyz/api/markets/fundamentals/AAPL") return jsonRes(FUND);
  if (url === "https://t0ll.xyz/api/markets/insiders/AAPL") return jsonRes(INSIDERS);
  if (url === "https://data.sec.gov/submissions/CIK0000320193.json") return jsonRes(SEC);
  return undefined;
};

commonTests({ test, assert, dir, env: { SEC_USER_AGENT: UA }, price: "0.05", atomic: "50000", sells: "GET /brief/:ticker", unpaidUrl: "/brief/AAPL" });

test("it does not start without SEC_USER_AGENT, and says why", async () => {
  const s = run(dir, { PAY_TO, PORT: "0" });
  assert.notEqual(await s.exited, 0);
  assert.match(s.err(), /SEC_USER_AGENT/);
  assert.throws(() => createApp({ PAY_TO }), /SEC_USER_AGENT/);
});

test("a ticker that is not 1-6 letters or dots is a 400 before payment is asked", async () => {
  const s = stub(() => undefined);
  const app = createApp(env, { fetch: s.fetch });
  for (const bad of ["TOOLONGX", "12", "A%20B", "AA-PL", "A1"]) assert.equal((await app(new Request(URL_OF(bad)))).status, 400, bad);
  assert.equal(s.calls.length, 0);
  assert.equal((await app(new Request(URL_OF("BRK.B")))).status, 402);
});

test("a paid call reads Toll's three markets routes and SEC (User-Agent to SEC only) and returns one brief", async () => {
  const s = stub(upstream());
  const res = await paid(createApp(env, { fetch: s.fetch }), URL_OF("aapl"));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ticker, "AAPL");
  assert.deepEqual(body.stock, STOCK);
  assert.deepEqual(body.fundamentals, FUND);
  assert.deepEqual(body.insiders, INSIDERS);
  assert.equal(body.filings.recent[0].form, "10-K");
  assert.equal(body.filings.recent[0].accession, "0000320193-26-000001");
  assert.equal(body.notRead, undefined);
  assert.deepEqual(s.calls.map((c) => c.url).sort(), [
    "https://data.sec.gov/submissions/CIK0000320193.json",
    "https://t0ll.xyz/api/markets/fundamentals/AAPL",
    "https://t0ll.xyz/api/markets/insiders/AAPL",
    "https://t0ll.xyz/api/markets/stock/AAPL",
  ]);
  for (const c of s.calls) {
    if (c.url.startsWith("https://data.sec.gov/")) assert.equal(c.headers["user-agent"], UA);
    else assert.equal(c.headers["user-agent"], undefined, "SEC_USER_AGENT never goes to Toll");
  }
});

test("a part that cannot be read is null and named in notRead; the rest is still answered", async () => {
  const s = stub(upstream({ "https://t0ll.xyz/api/markets/insiders/AAPL": jsonRes({}, 500), "https://data.sec.gov/submissions/CIK0000320193.json": jsonRes({}, 503) }));
  const body = await (await paid(createApp(env, { fetch: s.fetch }), URL_OF("AAPL"))).json();
  assert.equal(body.insiders, null);
  assert.equal(body.filings, null);
  assert.deepEqual(body.notRead.sort(), ["filings", "insiders"]);
  assert.deepEqual(body.stock, STOCK);
});

test("no CIK in Toll's answer means no SEC call, and filings is named in notRead", async () => {
  const s = stub(upstream({ "https://t0ll.xyz/api/markets/stock/AAPL": jsonRes({ ticker: "AAPL" }) }));
  const body = await (await paid(createApp(env, { fetch: s.fetch }), URL_OF("AAPL"))).json();
  assert.equal(body.filings, null);
  assert.deepEqual(body.notRead, ["filings"]);
  assert.equal(s.calls.some((c) => c.url.includes("sec.gov")), false);
});

test("when nothing at all could be read it is a 502 and the payment is not settled", async () => {
  const s = stub(() => jsonRes({}, 500));
  const res = await paid(createApp(env, { fetch: s.fetch }), URL_OF("AAPL"));
  assert.equal(res.status, 502);
  assert.equal(s.facilitator.filter((u) => u.endsWith("/settle")).length, 0);
});

test("a 429 from Toll without TOLL_PAYER_KEY is a 503 quota and nothing is paid or settled", async () => {
  let payCalls = 0;
  const s = stub(upstream({ "https://t0ll.xyz/api/markets/fundamentals/AAPL": jsonRes({}, 429) }));
  const res = await paid(createApp(env, { fetch: s.fetch, pay: async () => { payCalls++; return jsonRes({}); } }), URL_OF("AAPL"));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, "quota");
  assert.equal(payCalls, 0);
  assert.equal(s.facilitator.filter((u) => u.endsWith("/settle")).length, 0);
});

test("a 429 with TOLL_PAYER_KEY pays the matching x402 route for that read only", async () => {
  const paidUrls = [];
  const s = stub(upstream({ "https://t0ll.xyz/api/markets/fundamentals/AAPL": jsonRes({}, 429), "https://t0ll.xyz/api/markets/stock/AAPL": jsonRes({}, 429) }));
  const pay = async (url) => { paidUrls.push(url); return jsonRes(url.includes("stock") ? STOCK : FUND); };
  const key = "0x" + "22".repeat(32);
  const res = await paid(createApp({ ...env, TOLL_PAYER_KEY: key }, { fetch: s.fetch, pay }), URL_OF("AAPL"));
  assert.equal(res.status, 200);
  assert.deepEqual(paidUrls.sort(), ["https://t0ll.xyz/api/x402/markets/fundamentals/AAPL", "https://t0ll.xyz/api/x402/stock/AAPL"]);
  const body = await res.json();
  assert.deepEqual(body.stock, STOCK);
  assert.doesNotMatch(JSON.stringify(body), new RegExp(key.slice(2)));
});

test("the CIK is also read from fundamentals.cik when the stock answer has no company", async () => {
  const s = stub(upstream({
    "https://t0ll.xyz/api/markets/stock/AAPL": jsonRes({ ticker: "AAPL", company: { state: "not-read" } }),
    "https://t0ll.xyz/api/markets/fundamentals/AAPL": jsonRes({ ticker: "AAPL", cik: "0000320193" }),
  }));
  const body = await (await paid(createApp(env, { fetch: s.fetch }), URL_OF("AAPL"))).json();
  assert.equal(body.filings.recent[0].form, "10-K");
  assert.ok(s.calls.some((c) => c.url === "https://data.sec.gov/submissions/CIK0000320193.json"));
});

test("AGENT_ID and PRICE are honoured", async () => {
  const { v2 } = await unpaid(createApp({ ...env, AGENT_ID: "7", PRICE: "0.1" }, {}), URL_OF("AAPL"));
  assert.equal(v2.accepts[0].extra.erc8004.agentId, "7");
  assert.equal(v2.accepts[0].amount, "100000");
});
