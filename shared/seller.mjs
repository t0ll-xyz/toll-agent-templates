// Shared by every template (copied into each folder as seller.mjs by scripts/sync.mjs, so a folder works alone).
// It reads and checks the environment, builds the options for @tollxyz/x402-seller, turns Node's http requests into
// web Requests, and (lazily, only when TOLL_PAYER_KEY is set) builds the payer that pays Toll's x402 routes.
// That payer is the only code in a template that signs or pays, and it goes through Toll's guard (see THE GUARD below).
import { paywall } from "@tollxyz/x402-seller";

export const FACILITATOR = "https://x402.t0ll.xyz";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ADAPTER_MAX_BODY = 1_000_000;

/** Read PAY_TO, AGENT_ID, PRICE and PORT. Throws an Error whose message says what to set. */
export function readBase(env, defaultPrice = null) {
  const payTo = (env.PAY_TO ?? "").trim();
  if (!ADDRESS.test(payTo)) throw new Error("Set PAY_TO to the wallet that gets paid (0x + 40 hex), for example: PAY_TO=0x... npm start");
  const agentId = (env.AGENT_ID ?? "").trim();
  if (agentId && !/^\d+$/.test(agentId)) throw new Error("AGENT_ID must be digits (your ERC-8004 agent id), or leave it out");
  const price = (env.PRICE ?? "").trim() || defaultPrice;
  if (!price) throw new Error("Set PRICE to what one call costs in USDG, for example: PRICE=0.01");
  if (!/^\d+(\.\d{1,6})?$/.test(price) || Number(price) <= 0) throw new Error(`PRICE must be a number above zero with at most 6 decimals, got "${price}"`);
  const portText = (env.PORT ?? "").trim() || "4021";
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || port > 65535) throw new Error(`PORT must be a number up to 65535, got "${portText}"`);
  return { payTo, agentId: agentId || null, price, port };
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
export { json };

// BROWSER BUYERS. A page on another site can only read a 402, send the payment header and read the answer when the
// seller says so: every answer carries access-control-allow-origin: * and exposes the payment headers, and the
// browser's preflight (OPTIONS) is answered here, before anything is priced or paid.
export const EXPOSED = "PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-RESPONSE";
const PAY_HEADERS = "content-type, payment-signature, x-payment, authorization";
const HEADER_NAMES = /^[\w-]+(\s*,\s*[\w-]+)*$/;

/** the same answer with the CORS headers a browser buyer needs (a header the answer already set is kept) */
export function withCors(res) {
  const headers = new Headers(res.headers);
  headers.set("access-control-allow-origin", "*");
  if (!headers.has("access-control-expose-headers")) headers.set("access-control-expose-headers", EXPOSED);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/** the answer to a browser's preflight: any origin, the template's methods, the payment headers (plus the ones asked for) */
export function preflight(req, methods) {
  const asked = (req.headers.get("access-control-request-headers") ?? "").trim();
  return new Response(null, { status: 204, headers: {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": [...new Set([...methods, "OPTIONS"])].join(", "),
    "access-control-allow-headers": asked && HEADER_NAMES.test(asked) && asked.length <= 400 ? `${PAY_HEADERS}, ${asked.toLowerCase()}` : PAY_HEADERS,
    "access-control-expose-headers": EXPOSED,
    "access-control-max-age": "86400",
    "cache-control": "no-store",
  } });
}

/**
 * Build the fetch handler `(Request) => Response` of one template.
 * spec: { sells, description, methods, match(pathname), precheck?(req, url), maxBody?, bazaar, defaultPrice, check?(env), handle(req, env, deps) }
 * The handler is returned with `.port` and `.info` (what GET / says). `deps.fetch` stubs every upstream and the facilitator.
 */
export function makeApp(spec, env = process.env, deps = {}) {
  const base = readBase(env, spec.defaultPrice);
  if (spec.check) spec.check(env);
  const info = { sells: spec.sells, price: base.price, payTo: base.payTo, facilitator: FACILITATOR };
  const options = {
    payTo: base.payTo,
    price: base.price,
    ...(base.agentId ? { agentId: base.agentId } : {}),
    description: spec.description,
    facilitator: FACILITATOR,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    bazaar: { description: spec.description, method: spec.methods[0], ...spec.bazaar },
  };
  const paid = paywall(options, (req) => spec.handle(req, env, deps));
  const inner = async (req) => {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/") return json(info);
    if (!spec.match(url.pathname)) return json({ error: "Not found. See GET / for what this agent sells." }, 404);
    if (!spec.methods.includes(req.method)) {
      // A PLAIN GET ON A PAID ROUTE THAT IS SOLD OVER ANOTHER METHOD ANSWERS THE 402 ITSELF. Directories, censuses and
      // launch probes read a seller's terms with a GET; a 405 there made a POST-only seller look like no seller at all.
      // Only when no payment is sent: a GET that carries a payment is still a 405, so nothing is ever run or settled.
      const unpaidGet = req.method === "GET" && !req.headers.has("payment-signature") && !req.headers.has("x-payment");
      if (unpaidGet) return paid(new Request(req.url, { method: "GET", headers: req.headers }));
      return json({ error: `Use ${spec.methods.join(" or ")} here.` }, 405);
    }
    if (spec.maxBody && req.method !== "GET" && req.method !== "HEAD") {
      const declared = Number(req.headers.get("content-length") ?? 0);
      if (declared > spec.maxBody) return json({ error: `Body too large (limit ${spec.maxBody} bytes).` }, 413);
      const size = (await req.clone().arrayBuffer()).byteLength;
      if (size > spec.maxBody) return json({ error: `Body too large (limit ${spec.maxBody} bytes).` }, 413);
    }
    if (spec.precheck) {
      const early = await spec.precheck(req, url);
      if (early) return early;
    }
    return paid(req);
  };
  const app = async (req) => (req.method === "OPTIONS" ? preflight(req, spec.methods) : withCors(await inner(req)));
  app.port = base.port;
  app.info = info;
  return app;
}

/** Node http listener for a fetch handler: each request becomes a web Request, each Response is written back. */
export function nodeListener(app) {
  return async (req, res) => {
    try {
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
      const proto = headers.get("x-forwarded-proto") ?? "http";
      let body;
      if (req.method !== "GET" && req.method !== "HEAD") {
        const chunks = [];
        let size = 0;
        for await (const c of req) {
          size += c.length;
          if (size > ADAPTER_MAX_BODY) {
            res.writeHead(413, { "content-type": "application/json", "access-control-allow-origin": "*" });
            res.end(JSON.stringify({ error: "Body too large." }));
            return;
          }
          chunks.push(c);
        }
        body = Buffer.concat(chunks);
      }
      const answer = await app(new Request(`${proto}://${req.headers.host ?? "localhost"}${req.url}`, { method: req.method, headers, body }));
      res.writeHead(answer.status, Object.fromEntries(answer.headers));
      res.end(Buffer.from(await answer.arrayBuffer()));
    } catch {
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json", "access-control-allow-origin": "*" });
      res.end(JSON.stringify({ error: "The agent hit an error. Nothing was charged." }));
    }
  };
}

/** Start the template on Node's http. Prints a clear message and exits 1 when the environment is wrong. */
export async function serve(create, env = process.env) {
  const { createServer } = await import("node:http");
  let app;
  try {
    app = create(env);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
  const server = createServer(nodeListener(app));
  server.listen(app.port, () =>
    console.log(`Selling ${app.info.sells} on http://localhost:${server.address().port} (${app.info.price} USDG a call, paid to ${app.info.payTo})`));
}

/**
 * One free read of a Toll route, for a handler: { quota: true } when Toll says its free rate is used up (429), else
 * { status, data } with data = the JSON body of a 2xx answer, or null (not 2xx, not JSON, not reached). Never throws.
 */
export async function tollGet(url, env, deps = {}) {
  const get = deps.fetch ?? globalThis.fetch;
  const headers = { accept: "application/json" };
  const key = (env.TOLL_KEY ?? "").trim();
  if (key) headers["x-api-key"] = key;
  try {
    const res = await get(url, { headers, signal: AbortSignal.timeout(20_000) });
    if (res.status === 429) return { quota: true };
    if (!res.ok) return { status: res.status, data: null };
    try { return { status: res.status, data: await res.json() }; } catch { return { status: res.status, data: null }; }
  } catch {
    return { status: 0, data: null };
  }
}

/** Replace every secret in a text (the upstream may echo what it was sent). */
export function redact(text, secrets) {
  let out = String(text);
  for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join("[redacted]");
  return out;
}

const USDG_ASSET = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const payers = new Map();

// THE GUARD (on unless TOLL_GUARD=off). Before TOLL_PAYER_KEY pays a 402, Toll's check (check_tx, through
// @tollxyz/guard) reads what the 402 asks for: who gets paid against the seller's registered agent wallet, the amount
// and the asset. It runs on the guard's strict preset:
//   BLOCK      the payment is not made, and Toll's reasons come back
//   WARN       the payment is not made either (strict stops on every WARN), and Toll's reasons come back
//   not read   no answer inside the timeout, Toll not reached, or a request it would not read: the payment is not
//              made and the answer says "NOT READ". A check that was not read is never passed on as clear.
// Only an ALLOW is paid.
/** how long the payer waits for Toll's check of one 402 */
export const GUARD_TIMEOUT_MS = 5000;
/** what is left out of that for the way to Toll and back */
export const GUARD_ROUND_TRIP_MS = 1000;
/** the time budget Toll's check is given (check_tx budgetMs): the timeout minus the round trip */
export const GUARD_BUDGET_MS = GUARD_TIMEOUT_MS - GUARD_ROUND_TRIP_MS;
const GUARD_SHOWN = 8;

/** The one switch: the guard is on unless TOLL_GUARD is "off". */
export const guardOn = (env) => (env?.TOLL_GUARD ?? "").trim().toLowerCase() !== "off";

/** The options the guard runs with. deps.tollFetch is the fetch that reaches Toll's check (a test gives one). */
export const guardOptions = (deps = {}) => ({
  strict: true, timeoutMs: GUARD_TIMEOUT_MS, budgetMs: GUARD_BUDGET_MS, logger: false,
  ...(deps.tollFetch ? { fetch: deps.tollFetch } : {}),
});

/**
 * The fetch a payer may use: `inner` with Toll's check in front of every 402, or `inner` itself when TOLL_GUARD=off.
 * With the guard on and @tollxyz/guard missing it throws: nothing is paid without the check.
 */
export async function guarded(inner, env, deps = {}) {
  if (!guardOn(env)) return inner;
  let mod = deps.guard;
  if (!mod) {
    try {
      mod = await import("@tollxyz/guard");
    } catch {
      const e = new Error("Toll's guard is on but @tollxyz/guard is missing, so nothing is paid. Run: npm install @tollxyz/guard (TOLL_GUARD=off pays without the check)");
      e.name = "GuardMissingError";
      throw e;
    }
  }
  return mod.guardX402Fetch(inner, guardOptions(deps));
}

/**
 * What the guard did to a payment, read from the error it threw: { action: "BLOCK" | "WARN" | "NOT READ", paid: false,
 * reasons }. null when the error is not the guard's (Toll's paid route itself failed, the network).
 */
export function guardStop(e) {
  const name = e?.name;
  if (name === "TollBlockedError" || name === "TollPolicyError") {
    const a = e.assessment ?? {};
    const all = (Array.isArray(a.warnings) ? a.warnings : []).filter((w) => w && typeof w.message === "string");
    const link = a["x-toll"]?.link;
    return {
      action: a.action === "WARN" ? "WARN" : "BLOCK", paid: false,
      reasons: all.slice(0, GUARD_SHOWN).map((w) => ({ code: typeof w.code === "string" ? w.code : null, severity: typeof w.severity === "string" ? w.severity : null, message: w.message.slice(0, 500) })),
      ...(typeof link === "string" ? { link } : {}),
    };
  }
  if (name === "TollUnavailableError") {
    const why = typeof e.reason === "string" ? e.reason : "unavailable";
    return { action: "NOT READ", paid: false, reasons: [{ code: `check-${why}`, severity: null, message: `Toll's check of this payment was not read (${why}). Not read is not clear.` }] };
  }
  if (name === "GuardMissingError") {
    return { action: "NOT READ", paid: false, reasons: [{ code: "guard-missing", severity: null, message: "The guard is on but @tollxyz/guard is not installed on this host, so the check was not read. Not read is not clear." }] };
  }
  return null;
}

const GUARD_SAYS = {
  BLOCK: ["guard-block", "Toll's check answered BLOCK for the payment to the upstream route, so it was not paid."],
  WARN: ["guard-warn", "Toll's check answered WARN for the payment to the upstream route. The guard runs strict and does not pay on a WARN."],
  "NOT READ": ["guard-not-read", "Toll's check of the payment to the upstream route was not read, so it was not paid."],
};

/** The 502 a handler answers when the guard stopped the upstream payment (the buyer is not charged); null for any other error. */
export function guardAnswer(e) {
  const g = guardStop(e);
  if (!g) return null;
  const [code, text] = GUARD_SAYS[g.action];
  return json({ error: `${text} Nothing was charged.`, code, guard: g }, 502);
}

/**
 * A fetch that pays x402 routes on Robinhood Chain with TOLL_PAYER_KEY (a throwaway wallet with a few cents of USDG).
 * The x402 client, viem, the guard and the key are loaded only here, only when the key is set. One payment is capped
 * at 0.05 USDG. Every 402 goes through Toll's guard before it is paid, unless TOLL_GUARD=off.
 * deps (tests): payFetch = the fetch that reaches the paid route, tollFetch = the fetch that reaches Toll's check.
 */
export async function payerFor(key, env = {}, deps = {}) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(key ?? "")) throw new Error("TOLL_PAYER_KEY must be 0x + 64 hex (a throwaway wallet key)");
  const kept = deps.payFetch || deps.tollFetch || deps.guard ? null : `${key}:${guardOn(env) ? "on" : "off"}`;
  if (kept && payers.has(kept)) return payers.get(kept);
  let mods;
  try {
    mods = await Promise.all([import("@x402/fetch"), import("@x402/evm/exact/client"), import("viem/accounts")]);
  } catch {
    throw new Error("TOLL_PAYER_KEY is set but the optional packages are missing. Run: npm install @x402/fetch @x402/evm viem @tollxyz/guard");
  }
  const [{ x402Client, wrapFetchWithPayment }, { ExactEvmScheme }, { privateKeyToAccount }] = mods;
  const client = new x402Client()
    .register("eip155:4663", new ExactEvmScheme(privateKeyToAccount(key)))
    .setSpendControls({ allowedAssets: [{ network: "eip155:4663", asset: USDG_ASSET, maxAmountPerPayment: "50000" }] });
  const pay = wrapFetchWithPayment(await guarded(deps.payFetch ?? fetch, env, deps), client);
  if (kept) payers.set(kept, pay);
  return pay;
}

/** The payer a handler uses: deps.pay when a test gives one, else the lazy, guarded one for TOLL_PAYER_KEY. */
export function payOf(env, deps) {
  if (!(env.TOLL_PAYER_KEY ?? "").trim()) return null;
  return deps.pay ?? (async (url, init) => (await payerFor(env.TOLL_PAYER_KEY.trim(), env, deps))(url, init));
}
