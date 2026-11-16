import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { COPIES, TEMPLATES } from "../scripts/sync.mjs";
import {
  guardOn, guardOptions, guarded, guardStop, guardAnswer, payerFor,
  GUARD_TIMEOUT_MS, GUARD_ROUND_TRIP_MS, GUARD_BUDGET_MS,
} from "../shared/seller.mjs";
import { stub, paid, jsonRes, PAY_TO } from "../shared/testkit.mjs";
import { createApp as coinApp } from "../coin-safety/app.mjs";
import { createApp as stockApp } from "../stock-researcher/app.mjs";
import { createApp as txApp } from "../tx-guard/app.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

test("every synced copy equals its shared source (run: npm run sync)", () => {
  for (const c of COPIES) {
    assert.ok(existsSync(join(root, c.to)), `${c.to} exists`);
    assert.equal(readFileSync(join(root, c.to), "utf8"), readFileSync(join(root, c.from), "utf8"), `${c.to} differs from ${c.from}`);
  }
});

const ENV = {
  "coin-safety": ["PAY_TO", "AGENT_ID", "PRICE", "PORT", "TOLL_KEY", "TOLL_PAYER_KEY", "TOLL_GUARD"],
  "stock-researcher": ["PAY_TO", "AGENT_ID", "PRICE", "PORT", "SEC_USER_AGENT", "TOLL_PAYER_KEY", "TOLL_GUARD"],
  "model-router": ["PAY_TO", "AGENT_ID", "PRICE", "PORT", "MODEL_BASE_URL", "MODEL_API_KEY", "MODEL"],
  "wrap-api": ["PAY_TO", "AGENT_ID", "PRICE", "PORT", "UPSTREAM_URL", "UPSTREAM_AUTH_HEADER"],
  blank: ["PAY_TO", "AGENT_ID", "PRICE", "PORT"],
  "page-reader": ["PAY_TO", "AGENT_ID", "PRICE", "PORT"],
  "agent-trust": ["PAY_TO", "AGENT_ID", "PRICE", "PORT"],
  "llm-task": ["PAY_TO", "AGENT_ID", "PRICE", "PORT", "MODEL_BASE_URL", "MODEL_API_KEY", "MODEL"],
  "wallet-check": ["PAY_TO", "AGENT_ID", "PRICE", "PORT"],
  "launch-feed": ["PAY_TO", "AGENT_ID", "PRICE", "PORT"],
  "tx-guard": ["PAY_TO", "AGENT_ID", "PRICE", "PORT", "TOLL_PAYER_KEY", "TOLL_GUARD"],
};

test("each template has its files and its .env.example names exactly its env vars, in order", () => {
  for (const t of TEMPLATES) {
    for (const f of ["server.mjs", "app.mjs", "handler.mjs", "seller.mjs", "package.json", ".env.example", "vercel.json", "railway.json", "README.md", "api/index.mjs", "test/server.test.mjs"]) {
      assert.ok(existsSync(join(root, t, f)), `${t}/${f}`);
    }
    const names = readFileSync(join(root, t, ".env.example"), "utf8").split("\n")
      .map((l) => /^#?\s*([A-Z_]+)=/.exec(l)?.[1]).filter(Boolean);
    assert.deepEqual(names, ENV[t], `${t} .env.example`);
    const pkg = JSON.parse(readFileSync(join(root, t, "package.json"), "utf8"));
    assert.equal(pkg.dependencies["@tollxyz/x402-seller"], "^0.3.1");
    assert.equal(pkg.name, t);
  }
});

function* files(dir) {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n === ".git" || n === "package-lock.json") continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) yield* files(p);
    else yield p;
  }
}

test("no file names the launcher, a private key or an address that is not on the allowlist", () => {
  const banned = new RegExp("AGENT" + "BOX", "i");
  const allowed = new Set([
    "0x5fc5360d0400a0fd4f2af552add042d716f1d168", // USDG
    "0x00000000000000000000000000000000000000a1", // the made-up PAY_TO of the tests
    "0x00000000000000000000000000000000000000a2",
    "0x00000000000000000000000000000000000000a3",
    "0x0000000000000000000000000000000000000000", // the example token in the bazaar listing
    // tx-guard/examples/hookr-build.mjs: a real call Hookr's MCP built (hookr_build_agent_link, 2026-11-13)
    "0xf95e6c8eeda88b4d8dfd43a087d153059a5107b0", // Hookr's Agent gate (its `to`)
    "0xdc36d51963d08862c525045ccfd39fae6a0c7f40", // Toll's own agent wallet, ERC-8004 agent #20030 (its `from`)
  ]);
  for (const f of files(root)) {
    if (f.endsWith("repo.test.mjs")) continue;
    const text = readFileSync(f, "utf8");
    const where = relative(root, f);
    assert.doesNotMatch(text, banned, where);
    assert.doesNotMatch(text, /0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/, `${where} has a 64-hex value (a key?)`);
    for (const m of text.matchAll(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g)) assert.ok(allowed.has(m[0].toLowerCase()), `${where}: ${m[0]}`);
    // the two template names are allowed; everywhere else these words are not used
    const words = text.replaceAll("coin-safety", "").replaceAll(/coin safety checker/gi, "");
    assert.doesNotMatch(words, /\b(safe|safely|safety|guarantee[sd]?|protects?|enforces?)\b/i, `${where} uses a word we do not use`);
  }
});

/* ------------------------------------------------------------------ Toll's guard: on by default wherever a template signs or pays */

// THE MAP (2026-11-16). A template is a seller: the buyer signs, the facilitator settles. The one thing a template can
// sign is an x402 payment from the optional payer key (TOLL_PAYER_KEY), built in shared/seller.mjs (payerFor) and used
// by these three; the other eight never sign and never pay.
const PAYS = ["coin-safety", "stock-researcher", "tx-guard"];

// what a signing or paying call looks like in code
const SIGNING = [
  /\bprivateKeyToAccount\b/, /\bmnemonicToAccount\b/, /\bhdKeyToAccount\b/, /\bcreateWalletClient\b/, /\bnew\s+(?:ethers\.)?Wallet\s*\(/,
  /\.(?:signMessage|signTypedData|signTransaction|signAuthorization|sendTransaction|sendRawTransaction|writeContract|sendCalls|sendUserOperation)\s*\(/,
  /\beth_(?:sign|signTypedData_v4|sendTransaction|sendRawTransaction)\b/, /\bpersonal_sign\b/, /\bwallet_sendCalls\b/,
  /\bwrapFetchWithPayment\b/, /\bx402Client\b/, /\bwithPaymentInterceptor\b/, /\bcreatePaymentHeader\b/,
  /["'](?:@x402\/(?:fetch|axios|evm)[^"']*|x402-fetch|x402-axios|viem\/accounts|ethers)["']/,
];
const signsOrPays = (text) => SIGNING.filter((re) => re.test(text)).map(String);
const isCode = (f) => /\.(mjs|cjs|js|ts)$/.test(f);
const slash = (f) => relative(root, f).split("\\").join("/");

test("the scan knows a signing or paying call when it sees one", () => {
  for (const line of [
    'const account = privateKeyToAccount(key);', 'const w = createWalletClient({ account });', 'await wallet.sendTransaction(tx);',
    'await signer.signTypedData(domain, types, value);', 'const s = new Wallet(key);', 'const pay = wrapFetchWithPayment(fetch, client);',
    'import { x402Client } from "@x402/fetch";', 'await provider.request({ method: "personal_sign", params });', "import { Wallet } from 'ethers';",
  ]) assert.ok(signsOrPays(line).length > 0, line);
  for (const line of ['headers.set("payment-signature", header);', "const pay = payOf(env, deps);", "res = await pay(url, init);", 'summary: "Read it before signing."'])
    assert.deepEqual(signsOrPays(line), [], line);
});

test("the only code that signs or pays is the shared payer, and it goes through the guard", () => {
  const shared = readFileSync(join(root, "shared/seller.mjs"), "utf8");
  assert.ok(signsOrPays(shared).length > 0, "shared/seller.mjs holds the payer");
  assert.match(shared, /import\("@tollxyz\/guard"\)/);
  assert.match(shared, /\.guardX402Fetch\(inner, guardOptions\(deps\)\)/);
  assert.match(shared, /TOLL_GUARD/);
  // every payer is built on the guarded fetch, never on a bare one
  const built = [...shared.matchAll(/wrapFetchWithPayment\(([^)]*)/g)].map((m) => m[1]);
  assert.ok(built.length > 0);
  for (const arg of built) assert.match(arg, /^await guarded\(/, `a payer is built on a fetch that skips the guard: wrapFetchWithPayment(${arg}`);

  const copies = new Set(["shared/seller.mjs", ...TEMPLATES.map((t) => `${t}/seller.mjs`)]); // the copies equal shared (first test)
  for (const f of files(root)) {
    const where = slash(f);
    if (!isCode(where) || copies.has(where) || where.startsWith("test/") || where.includes("/test/")) continue;
    assert.deepEqual(signsOrPays(readFileSync(f, "utf8")), [],
      `${where} signs or pays on its own. Use payOf from seller.mjs (it goes through Toll's guard), or put the new signer in shared/seller.mjs behind @tollxyz/guard with guardOptions() and guardOn(env).`);
  }
});

test("the three templates with a payer take the guard as an optional package and say so; the others say they never sign or pay", () => {
  for (const t of TEMPLATES) {
    const pkg = JSON.parse(readFileSync(join(root, t, "package.json"), "utf8"));
    const readme = readFileSync(join(root, t, "README.md"), "utf8");
    const handler = readFileSync(join(root, t, "handler.mjs"), "utf8");
    if (PAYS.includes(t)) {
      assert.equal(pkg.optionalDependencies?.["@tollxyz/guard"], "^0.7.1", t);
      assert.match(handler, /payOf\(env, deps\)/, t);
      assert.match(handler, /guard(?:Answer|Stop)\(e\)/, `${t} answers what the guard stopped`);
      assert.match(readme, /\*\*Toll's guard is on\.\*\*[^]*`TOLL_GUARD=off`/, t);
    } else {
      assert.equal(pkg.optionalDependencies, undefined, t);
      assert.doesNotMatch(handler, /payOf|payerFor/, t);
      assert.match(readme, /never signs and never pays[^]*`TOLL_GUARD=off`/, t);
    }
  }
  assert.match(readFileSync(join(root, "README.md"), "utf8"), /\*\*Toll's guard is on in every template\.\*\*[^]*`TOLL_GUARD=off`/);
});

test("TOLL_GUARD: on by default, and only \"off\" turns it off", () => {
  for (const env of [{}, { TOLL_GUARD: "" }, { TOLL_GUARD: "on" }, { TOLL_GUARD: "1" }, { TOLL_GUARD: "0" }, { TOLL_GUARD: "false" }, { TOLL_GUARD: "no" }])
    assert.equal(guardOn(env), true, JSON.stringify(env));
  for (const v of ["off", "OFF", " Off "]) assert.equal(guardOn({ TOLL_GUARD: v }), false, v);
});

test("the guard runs strict, with a time budget of the timeout minus the round trip", () => {
  const o = guardOptions();
  assert.equal(o.strict, true);
  assert.equal(o.timeoutMs, GUARD_TIMEOUT_MS);
  assert.equal(o.budgetMs, GUARD_TIMEOUT_MS - GUARD_ROUND_TRIP_MS);
  assert.equal(GUARD_BUDGET_MS, o.budgetMs);
  assert.ok(Number.isInteger(o.budgetMs) && o.budgetMs >= 300 && o.budgetMs <= 30_000, "inside what check_tx takes (300 to 30000 ms)");
  assert.ok(GUARD_ROUND_TRIP_MS > 0);
  // nothing here loosens the preset
  for (const k of ["onWarn", "onBlock", "onUnavailable", "onUnsupported", "failOpen"]) assert.equal(k in o, false, k);
});

test("guarded(): on, the fetch is wrapped by the guard with those options; off, it is the fetch itself and the guard is not loaded", async () => {
  const inner = async () => jsonRes({});
  const seen = [];
  const guard = { guardX402Fetch: (f, o) => { seen.push([f, o]); return async () => jsonRes({ wrapped: true }); } };
  const on = await guarded(inner, {}, { guard });
  assert.notEqual(on, inner);
  assert.equal(seen.length, 1);
  assert.equal(seen[0][0], inner);
  assert.deepEqual(seen[0][1], guardOptions());
  const off = await guarded(inner, { TOLL_GUARD: "off" }, { guard: { get guardX402Fetch() { throw new Error("the guard was loaded"); } } });
  assert.equal(off, inner);
});

// ---- the real payer (@x402/fetch + viem), the real @tollxyz/guard, no network: the paid route and Toll are stubbed
const KEY = "0x" + "11".repeat(32); // a made-up key, never used on chain
const A2 = "0x00000000000000000000000000000000000000a2";
const USDG_ASSET = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const PAID_URL = "https://t0ll.xyz/api/x402/check/0x00000000000000000000000000000000000000a3";
const required = () => ({
  x402Version: 2, error: "Payment required", resource: { url: PAID_URL, description: "a paid read", mimeType: "application/json" },
  accepts: [{ scheme: "exact", network: "eip155:4663", asset: USDG_ASSET, amount: "5000", payTo: A2, maxTimeoutSeconds: 300, extra: { name: "Global Dollar", version: "1" } }],
});
/** the paid route: a 402 until the request carries a payment */
function paidRoute(body = { ok: true }) {
  const calls = [];
  const payFetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const withPayment = req.headers.has("payment-signature") || req.headers.has("x-payment");
    calls.push({ url: req.url, withPayment });
    if (withPayment) return jsonRes(body);
    return jsonRes(required(), 402, { "payment-required": Buffer.from(JSON.stringify(required())).toString("base64") });
  };
  return { calls, payFetch, paidCalls: () => calls.filter((c) => c.withPayment).length };
}
/** Toll's check: answers what `answer()` returns, and keeps what it was asked */
function tollCheck(answer) {
  const asked = [];
  const tollFetch = async (url, init) => { asked.push({ url: String(url), body: JSON.parse(init.body) }); return answer(); };
  return { asked, tollFetch };
}
const ALLOW = () => jsonRes({ action: "ALLOW", warnings: [] });
const BLOCK = () => jsonRes({ action: "BLOCK", warnings: [{ code: "payee-mismatch", severity: "critical", message: "The 402 pays a wallet that is not the seller's registered agent wallet." }], "x-toll": { link: "https://t0ll.xyz/agents/x402" } });
const WARN = () => jsonRes({ action: "WARN", warnings: [{ code: "payee-unregistered", severity: "medium", message: "The seller has no registered agent wallet to check the payee against." }] });
const NOT_READ = { "HTTP 500": () => jsonRes({ error: "boom" }, 500), "the network failing": () => { throw new Error("ECONNRESET"); },
  "an answer that is not a verdict": () => jsonRes({ ok: true }), "HTTP 429": () => jsonRes({}, 429) };

const [gMaj, gMin, gPat] = JSON.parse(readFileSync(join(root, "node_modules/@tollxyz/guard/package.json"), "utf8")).version.split(".").map(Number);
const GUARD_SENDS_BUDGET = gMaj > 0 || gMin > 7 || (gMin === 7 && gPat >= 1);

test("default (no TOLL_GUARD): Toll's check reads the 402 first, and on ALLOW the payer pays", async () => {
  const route = paidRoute(), toll = tollCheck(ALLOW);
  const pay = await payerFor(KEY, {}, { payFetch: route.payFetch, tollFetch: toll.tollFetch });
  const res = await pay(PAID_URL, { headers: { accept: "application/json" } });
  assert.equal(res.status, 200);
  assert.deepEqual(route.calls.map((c) => c.withPayment), [false, true]);
  assert.equal(toll.asked.length, 1, "one check, before the payment");
  assert.equal(toll.asked[0].url, "https://t0ll.xyz/api/tx/check");
  assert.equal(toll.asked[0].body.x402.accepts[0].payTo, A2);
});

test("the check carries budgetMs = timeout minus round trip", { skip: GUARD_SENDS_BUDGET ? false : "the installed @tollxyz/guard is older than 0.7.1: budgetMs is handed to the guard (tested above) but that version does not send it" }, async () => {
  const route = paidRoute(), toll = tollCheck(ALLOW);
  await (await payerFor(KEY, {}, { payFetch: route.payFetch, tollFetch: toll.tollFetch }))(PAID_URL);
  assert.equal(toll.asked[0].body.budgetMs, GUARD_BUDGET_MS);
});

test("BLOCK: nothing is paid, and Toll's reasons come back", async () => {
  const route = paidRoute(), toll = tollCheck(BLOCK);
  const pay = await payerFor(KEY, {}, { payFetch: route.payFetch, tollFetch: toll.tollFetch });
  let err;
  await assert.rejects(pay(PAID_URL), (e) => { err = e; return true; });
  assert.equal(route.paidCalls(), 0, "no request carried a payment");
  assert.deepEqual(guardStop(err), {
    action: "BLOCK", paid: false, link: "https://t0ll.xyz/agents/x402",
    reasons: [{ code: "payee-mismatch", severity: "critical", message: "The 402 pays a wallet that is not the seller's registered agent wallet." }],
  });
});

test("WARN: the strict preset does not pay on a WARN either; it is told apart from BLOCK and its reasons come back", async () => {
  const route = paidRoute(), toll = tollCheck(WARN);
  const pay = await payerFor(KEY, {}, { payFetch: route.payFetch, tollFetch: toll.tollFetch });
  let err;
  await assert.rejects(pay(PAID_URL), (e) => { err = e; return true; });
  assert.equal(route.paidCalls(), 0);
  assert.deepEqual(guardStop(err), {
    action: "WARN", paid: false,
    reasons: [{ code: "payee-unregistered", severity: "medium", message: "The seller has no registered agent wallet to check the payee against." }],
  });
});

for (const [name, answer] of Object.entries(NOT_READ)) {
  test(`a check that could not be read (${name}): nothing is paid, and it is called NOT READ, never clear`, async () => {
    const route = paidRoute(), toll = tollCheck(answer);
    const pay = await payerFor(KEY, {}, { payFetch: route.payFetch, tollFetch: toll.tollFetch });
    let err;
    await assert.rejects(pay(PAID_URL), (e) => { err = e; return true; });
    assert.equal(route.paidCalls(), 0);
    const g = guardStop(err);
    assert.equal(g.action, "NOT READ");
    assert.equal(g.paid, false);
    assert.match(g.reasons[0].code, /^check-/);
    assert.match(g.reasons[0].message, /was not read \(.+\)\. Not read is not clear\.$/);
    const out = await guardAnswer(err).json();
    assert.equal(out.code, "guard-not-read");
    assert.doesNotMatch(JSON.stringify(out), /ALLOW|"clear"|is clear|looks clear/i);
  });
}

test("TOLL_GUARD=off: the payer pays without asking Toll", async () => {
  const route = paidRoute(), toll = tollCheck(BLOCK);
  const pay = await payerFor(KEY, { TOLL_GUARD: "off" }, { payFetch: route.payFetch, tollFetch: toll.tollFetch });
  assert.equal((await pay(PAID_URL)).status, 200);
  assert.equal(toll.asked.length, 0);
  assert.equal(route.paidCalls(), 1);
});

test("the guard on but its package missing is NOT READ too; an error that is not the guard's is left alone", async () => {
  const missing = Object.assign(new Error("missing"), { name: "GuardMissingError" });
  assert.equal(guardStop(missing).action, "NOT READ");
  assert.equal(guardStop(missing).reasons[0].code, "guard-missing");
  assert.equal((await guardAnswer(missing).json()).code, "guard-not-read");
  assert.equal(guardStop(new Error("ECONNRESET")), null);
  assert.equal(guardAnswer(new TypeError("fetch failed")), null);
});

// ---- the same, through a template: the buyer's call -> Toll's free read says 429 -> the payer -> the guard
const coinEnv = { PAY_TO, TOLL_PAYER_KEY: KEY };
const COIN_URL = "http://agent.test/check/0x00000000000000000000000000000000000000a3";
const coinAnswer = { name: "Example", sym: "EXM", flags: [{ text: "liquidity is locked", good: true }], tally: { combined: { against: 0, careful: 0, clear: 1 } }, unread: [] };
const quota = () => stub(() => jsonRes({ error: "quota" }, 429));

test("coin-safety, default: ALLOW pays Toll's x402 check and answers from it", async () => {
  const s = quota(), route = paidRoute(coinAnswer), toll = tollCheck(ALLOW);
  const res = await paid(coinApp(coinEnv, { fetch: s.fetch, payFetch: route.payFetch, tollFetch: toll.tollFetch }), COIN_URL);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).verdict, "CLEAR");
  assert.equal(toll.asked.length, 1);
  assert.equal(route.paidCalls(), 1);
});

test("coin-safety: BLOCK, WARN and NOT READ are each a 502 with the word, the reasons and nothing paid or settled", async () => {
  const cases = [
    [BLOCK, "guard-block", "BLOCK", "payee-mismatch", /answered BLOCK .* so it was not paid\. Nothing was charged\.$/],
    [WARN, "guard-warn", "WARN", "payee-unregistered", /answered WARN .* does not pay on a WARN\. Nothing was charged\.$/],
    [NOT_READ["HTTP 500"], "guard-not-read", "NOT READ", "check-server-error", /was not read, so it was not paid\. Nothing was charged\.$/],
  ];
  for (const [answer, code, action, reason, text] of cases) {
    const s = quota(), route = paidRoute(coinAnswer), toll = tollCheck(answer);
    const res = await paid(coinApp(coinEnv, { fetch: s.fetch, payFetch: route.payFetch, tollFetch: toll.tollFetch }), COIN_URL);
    assert.equal(res.status, 502, code);
    const out = await res.json();
    assert.equal(out.code, code);
    assert.match(out.error, text);
    assert.equal(out.guard.action, action);
    assert.equal(out.guard.paid, false);
    assert.equal(out.guard.reasons[0].code, reason);
    assert.ok(out.guard.reasons[0].message.length > 10, "the reason is passed on in words");
    assert.equal(route.paidCalls(), 0, "Toll's paid route was not paid");
    assert.equal(s.facilitator.filter((u) => u.endsWith("/settle")).length, 0, "the buyer was not charged");
    assert.doesNotMatch(JSON.stringify(out), new RegExp(KEY.slice(2)));
  }
});

test("coin-safety, TOLL_GUARD=off: it pays without Toll's check", async () => {
  const s = quota(), route = paidRoute(coinAnswer), toll = tollCheck(BLOCK);
  const res = await paid(coinApp({ ...coinEnv, TOLL_GUARD: "off" }, { fetch: s.fetch, payFetch: route.payFetch, tollFetch: toll.tollFetch }), COIN_URL);
  assert.equal(res.status, 200);
  assert.equal(toll.asked.length, 0);
  assert.equal(route.paidCalls(), 1);
});

test("tx-guard: a payment the guard stopped is a 502 with the word and the reasons", async () => {
  const s = quota(), route = paidRoute({ action: "ALLOW", warnings: [] }), toll = tollCheck(WARN);
  const body = JSON.stringify({ chainId: 4663, from: PAY_TO, to: A2, data: "0x", value: "0" });
  const res = await paid(txApp(coinEnv, { fetch: s.fetch, payFetch: route.payFetch, tollFetch: toll.tollFetch }),
    "http://agent.test/check", { method: "POST", headers: { "content-type": "application/json" }, body });
  assert.equal(res.status, 502);
  const out = await res.json();
  assert.equal(out.code, "guard-warn");
  assert.equal(out.guard.reasons[0].code, "payee-unregistered");
  assert.equal(route.paidCalls(), 0);
});

test("stock-researcher: a read whose payment the guard stopped is not read, and listed with the word and the reasons", async () => {
  const s = stub((url) => (url.includes("/fundamentals/") ? jsonRes({}, 429) : url.includes("/stock/") ? jsonRes({ name: "Example Corp", prices: {} }) : jsonRes({ totals: null })));
  const route = paidRoute({ revenue: 1 }), toll = tollCheck(BLOCK);
  const env = { PAY_TO, TOLL_PAYER_KEY: KEY, SEC_USER_AGENT: "Example example@example.com" };
  const res = await paid(stockApp(env, { fetch: s.fetch, payFetch: route.payFetch, tollFetch: toll.tollFetch }), "http://agent.test/brief/EXM");
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.ok(out.notRead.includes("fundamentals"));
  assert.equal(out.guard.length, 1);
  assert.equal(out.guard[0].read, "fundamentals");
  assert.equal(out.guard[0].action, "BLOCK");
  assert.equal(out.guard[0].paid, false);
  assert.equal(out.guard[0].reasons[0].code, "payee-mismatch");
  assert.equal(route.paidCalls(), 0);

  // every read stopped: a 502 that says so, with the list
  const all = stub(() => jsonRes({}, 429));
  const res2 = await paid(stockApp(env, { fetch: all.fetch, payFetch: paidRoute().payFetch, tollFetch: tollCheck(NOT_READ["HTTP 500"]).tollFetch }), "http://agent.test/brief/EXM");
  assert.equal(res2.status, 502);
  const out2 = await res2.json();
  assert.equal(out2.code, "guard");
  assert.deepEqual(out2.guard.map((g) => [g.read, g.action]), [["stock", "NOT READ"], ["fundamentals", "NOT READ"], ["insiders", "NOT READ"]]);
});
