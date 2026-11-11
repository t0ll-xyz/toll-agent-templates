import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../app.mjs";
import { PAY_TO, jsonRes, stub, paid, unpaid, commonTests, run } from "./kit.mjs";

const dir = new URL("../", import.meta.url);
const UA = "Test Agent test@example.com";
const env = { PAY_TO, SEC_USER_AGENT: UA };
const URL_OF = (t) => `http://agent.test/brief/${t}`;
const FULL = (t) => `${URL_OF(t)}?full=1`;
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

test("a paid call reads Toll's three markets routes and SEC (User-Agent to SEC only); ?full=1 carries every field under raw", async () => {
  const s = stub(upstream());
  const res = await paid(createApp(env, { fetch: s.fetch }), FULL("aapl"));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), "*", "a browser buyer can read the paid answer");
  assert.match(res.headers.get("access-control-expose-headers").toLowerCase(), /payment-response/);
  const body = await res.json();
  assert.equal(body.ticker, "AAPL");
  assert.deepEqual(body.raw.stock, STOCK);
  assert.deepEqual(body.raw.fundamentals, FUND);
  assert.deepEqual(body.raw.insiders, INSIDERS);
  assert.equal(body.raw.filings.recent[0].form, "10-K");
  assert.equal(body.raw.filings.recent[0].accession, "0000320193-26-000001");
  assert.equal(body.more, undefined);
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
  const body = await (await paid(createApp(env, { fetch: s.fetch }), FULL("AAPL"))).json();
  assert.equal(body.insiders, null);
  assert.equal(body.filings, null);
  assert.equal(body.raw.insiders, null);
  assert.equal(body.raw.filings, null);
  assert.deepEqual(body.notRead.sort(), ["filings", "insiders"]);
  assert.deepEqual(body.raw.stock, STOCK);
  assert.match(body.brief, /filings not read/);
  assert.match(body.brief, /insiders not read/);
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
  const res = await paid(createApp({ ...env, TOLL_PAYER_KEY: key }, { fetch: s.fetch, pay }), FULL("AAPL"));
  assert.equal(res.status, 200);
  assert.deepEqual(paidUrls.sort(), ["https://t0ll.xyz/api/x402/markets/fundamentals/AAPL", "https://t0ll.xyz/api/x402/stock/AAPL"]);
  const body = await res.json();
  assert.deepEqual(body.raw.stock, STOCK);
  assert.doesNotMatch(JSON.stringify(body), new RegExp(key.slice(2)));
});

test("the CIK is also read from fundamentals.cik when the stock answer has no company", async () => {
  const s = stub(upstream({
    "https://t0ll.xyz/api/markets/stock/AAPL": jsonRes({ ticker: "AAPL", company: { state: "not-read" } }),
    "https://t0ll.xyz/api/markets/fundamentals/AAPL": jsonRes({ ticker: "AAPL", cik: "0000320193" }),
  }));
  const body = await (await paid(createApp(env, { fetch: s.fetch }), URL_OF("AAPL"))).json();
  assert.equal(body.filings[0].form, "10-K");
  assert.ok(s.calls.some((c) => c.url === "https://data.sec.gov/submissions/CIK0000320193.json"));
});

test("AGENT_ID and PRICE are honoured", async () => {
  const { v2 } = await unpaid(createApp({ ...env, AGENT_ID: "7", PRICE: "0.1" }, {}), URL_OF("AAPL"));
  assert.equal(v2.accepts[0].extra.erc8004.agentId, "7");
  assert.equal(v2.accepts[0].amount, "100000");
});

// ---- the readable brief (the default answer). The fixture has the shape of Toll's live answers for NVDA, read 2026-11-11.
const NVDA_STOCK = {
  ticker: "NVDA", name: "NVIDIA", page: "https://t0ll.xyz/markets/NVDA", session: "post",
  prices: {
    reference: { usd: 174.6702924, status: "fresh", kind: "reference" },
    chain: { usd: 174.71297613221134, pool: { pid: "0xd4eb", venue: "v3", quote: "USDG", depth_usd: 2197067.13 },
      pools: Array.from({ length: 30 }, (_, i) => ({ pid: `0x${i}`, venue: "v3", quote: "WETH", price_usd: 174.67, depth_usd: 1000 })) },
    differences: { chain_vs_reference_pct: 0.02, note: null },
  },
  company: { state: "ok", cik: "0001045810", name: "NVIDIA CORP",
    filings: [{ form: "8-K", filed: "2026-09-03", url: "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000078/nvda-20260902.htm" }] },
  fundamentals: { state: "ok", ttm_label: "TTM to 2026-07-26", revenue: 302969000000, net_income: 192879000000, eps_diluted: 7.94, pe: 21.98, market_cap_usd: 4206293499884,
    last_filing: { form: "10-Q", filed: "2026-08-26", url: "https://www.sec.gov/x" } },
};
const NVDA_FUND = { ticker: "NVDA", name: "NVIDIA", cik: "0001045810", latest_filing: { form: "10-Q", filed: "2026-08-26", period_end: "2026-07-26", accession: "0001045810-26-000075", url: "https://www.sec.gov/q" }, ttm: { revenue: { value: 1 } } };
const NVDA_INS = { ticker: "NVDA", window: { days: 90 }, rows: Array.from({ length: 35 }, () => ({ code: "S" })),
  totals: { purchases: { count: 0, shares: 0, value_usd: null }, sales: { count: 25, shares: 4332118, value_usd: 967599313 }, sales_split: { plan: { count: 9 }, not_marked: { count: 16 } } } };
const NVDA_SEC = { name: "NVIDIA CORP", filings: { recent: {
  form: ["8-K", "10-Q", "8-K", "4", "4"], filingDate: ["2026-09-03", "2026-08-26", "2026-08-26", "2026-08-20", "2026-08-19"],
  accessionNumber: ["0001045810-26-000078", "0001045810-26-000075", "0001045810-26-000074", "0001045810-26-000070", "0001045810-26-000069"],
  primaryDocument: ["nvda-20260902.htm", "nvda-20260726.htm", "nvda-20260826.htm", "x.xml", "y.xml"] } } };
const nvda = (over = {}) => (url) => {
  if (url in over) return over[url];
  if (url === "https://t0ll.xyz/api/markets/stock/NVDA") return jsonRes(NVDA_STOCK);
  if (url === "https://t0ll.xyz/api/markets/fundamentals/NVDA") return jsonRes(NVDA_FUND);
  if (url === "https://t0ll.xyz/api/markets/insiders/NVDA") return jsonRes(NVDA_INS);
  if (url === "https://data.sec.gov/submissions/CIK0001045810.json") return jsonRes(NVDA_SEC);
  return undefined;
};

test("the default answer is a short brief: name, chain price vs the Chainlink reference with the gap, 3 filings with links, insiders, earnings", async () => {
  const res = await paid(createApp(env, { fetch: stub(nvda()).fetch }), URL_OF("NVDA"));
  assert.equal(res.status, 200);
  const text = await res.text();
  const body = JSON.parse(text);
  assert.deepEqual(Object.keys(body), ["ticker", "name", "brief", "price", "filings", "insiders", "earnings", "basics", "page", "source", "more"]);
  assert.equal(body.ticker, "NVDA");
  assert.equal(body.name, "NVIDIA");
  assert.deepEqual(body.price, { chain_usd: 174.71, reference_usd: 174.67, gap_pct: 0.02, reference_source: "Chainlink feed on Robinhood Chain", session: "post",
    deepest_pool: { venue: "v3", quote: "USDG", depth_usd: 2197067 } });
  assert.deepEqual(body.filings, [
    { form: "8-K", date: "2026-09-03", url: "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000078/nvda-20260902.htm" },
    { form: "10-Q", date: "2026-08-26", url: "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000075/nvda-20260726.htm" },
    { form: "8-K", date: "2026-08-26", url: "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000074/nvda-20260826.htm" },
  ]);
  assert.deepEqual(body.insiders, { window_days: 90, buys: { count: 0, shares: 0, value_usd: null }, sells: { count: 25, shares: 4332118, value_usd: 967599313 }, sells_on_a_plan: 9 });
  assert.deepEqual(body.earnings, { next: null, last_report: { form: "10-Q", filed: "2026-08-26", period_end: "2026-07-26", url: "https://www.sec.gov/q" } });
  assert.deepEqual(body.basics, { period: "TTM to 2026-07-26", revenue_usd: 302969000000, net_income_usd: 192879000000, eps_diluted: 7.94, pe: 21.98, market_cap_usd: 4206293499884 });
  assert.equal(body.page, "https://t0ll.xyz/markets/NVDA");
  assert.equal(body.brief,
    "NVDA · NVIDIA. chain $174.71 vs reference $174.67 (+0.02%). latest filings: 8-K 2026-09-03, 10-Q 2026-08-26, 8-K 2026-08-26. "
    + "insiders 90d: 0 buys, 25 sells ($967.6M). next earnings not known (last results 10-Q 2026-08-26).");
  assert.equal(body.more, "add ?full=1 for every field that was read, under raw");
  // short: no pool list, no insider rows, no raw dump
  assert.equal("raw" in body, false);
  assert.equal("stock" in body, false);
  assert.doesNotMatch(text, /"pools"|"rows"/);
  assert.ok(text.length < 2500, `the brief is ${text.length} bytes`);
});

test("?full=1 keeps the brief on top and adds the raw reads; any other value of full is the short answer", async () => {
  const app = () => createApp(env, { fetch: stub(nvda()).fetch });
  const full = await (await paid(app(), FULL("NVDA"))).json();
  assert.equal(Object.keys(full)[2], "brief");
  assert.equal(full.raw.stock.prices.chain.pools.length, 30);
  assert.equal(full.raw.insiders.rows.length, 35);
  assert.equal(full.raw.filings.recent.length, 5);
  for (const q of ["?full=0", "?full=true", "?full", "?raw=1"]) {
    const b = await (await paid(app(), URL_OF("NVDA") + q)).json();
    assert.equal("raw" in b, false, q);
  }
});

test("the gap is worked out when Toll gives none; a price that was not read is said, never a zero", async () => {
  const noDiff = { ...NVDA_STOCK, prices: { reference: { usd: 100 }, chain: { usd: 103 } } };
  const a = await (await paid(createApp(env, { fetch: stub(nvda({ "https://t0ll.xyz/api/markets/stock/NVDA": jsonRes(noDiff) })).fetch }), URL_OF("NVDA"))).json();
  assert.equal(a.price.gap_pct, 3);
  assert.match(a.brief, /chain \$103\.00 vs reference \$100\.00 \(\+3%\)/);
  const noRef = { ...NVDA_STOCK, prices: { chain: { usd: 103 } } };
  const b = await (await paid(createApp(env, { fetch: stub(nvda({ "https://t0ll.xyz/api/markets/stock/NVDA": jsonRes(noRef) })).fetch }), URL_OF("NVDA"))).json();
  assert.deepEqual([b.price.chain_usd, b.price.reference_usd, b.price.gap_pct], [103, null, null]);
  assert.match(b.brief, /chain \$103\.00, reference not read/);
  const below = { ...NVDA_STOCK, prices: { reference: { usd: 200 }, chain: { usd: 190 } } };
  const c = await (await paid(createApp(env, { fetch: stub(nvda({ "https://t0ll.xyz/api/markets/stock/NVDA": jsonRes(below) })).fetch }), URL_OF("NVDA"))).json();
  assert.match(c.brief, /\(-5%\)/);
});

test("when SEC cannot be read the filings come from Toll's stock answer and are not named in notRead; the stock read missing is said", async () => {
  const s = stub(nvda({ "https://data.sec.gov/submissions/CIK0001045810.json": jsonRes({}, 503) }));
  const a = await (await paid(createApp(env, { fetch: s.fetch }), URL_OF("NVDA"))).json();
  assert.deepEqual(a.filings, [{ form: "8-K", date: "2026-09-03", url: "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000078/nvda-20260902.htm" }]);
  assert.equal(a.notRead, undefined);
  const b = await (await paid(createApp(env, { fetch: stub(nvda({ "https://t0ll.xyz/api/markets/stock/NVDA": jsonRes({}, 500) })).fetch }), URL_OF("NVDA"))).json();
  assert.equal(b.price, null);
  assert.match(b.brief, /^NVDA · NVIDIA\. price not read\./);
  assert.deepEqual(b.notRead, ["stock"]);
  assert.equal(b.filings.length, 3, "SEC was still read through the CIK in fundamentals");
});

test("a next earnings date is shown only when an answer carries one", async () => {
  const withDate = { ...NVDA_STOCK, earnings: { next: "2026-11-19" } };
  const a = await (await paid(createApp(env, { fetch: stub(nvda({ "https://t0ll.xyz/api/markets/stock/NVDA": jsonRes(withDate) })).fetch }), URL_OF("NVDA"))).json();
  assert.equal(a.earnings.next, "2026-11-19");
  assert.match(a.brief, /next earnings 2026-11-19\.$/);
});

test("money and filing links: the helpers", async () => {
  const { money, filingUrl } = await import("../handler.mjs");
  assert.deepEqual([money(174.713), money(967599313), money(4206293499884), money(20971680), money(null), money(0)], ["$174.71", "$967.6M", "$4.21T", "$20.97M", "not read", "$0.00"]);
  assert.equal(filingUrl("0001045810", "0001045810-26-000078", "a.htm"), "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000078/a.htm");
  for (const bad of [[null, "0001045810-26-000078", "a.htm"], ["1", "bad", "a.htm"], ["1", "0001045810-26-000078", null], ["1", "0001045810-26-000078", "../x"], ["1", "0001045810-26-000078", "a b"]]) {
    assert.equal(filingUrl(...bad), null, JSON.stringify(bad));
  }
});
